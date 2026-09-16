// Snap-to-grid and alignment guides while dragging (FR-3.5).
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THE GRID HALF IS ONE PROP AND THIS HALF IS A FILE
// ─────────────────────────────────────────────────────────────────────────────
//
// React Flow already owns grid snapping: `snapToGrid` / `snapGrid` round the position it
// REPORTS, so both tiers of the drag — the frames Canvas renders and the one it commits —
// see the same rounded number and nothing here has to know about it. Alignment has no
// such support, and cannot: it is a question about the OTHER boxes, and only the consumer
// knows where those are.
//
// So this module answers one question, purely: given the box (or boxes) under the cursor
// and everything else on screen, which edges line up, and how far would the drag have to
// move for them to line up exactly?
//
// ─────────────────────────────────────────────────────────────────────────────
// THE MAGNET IS STATELESS, AND THAT IS THE POINT
// ─────────────────────────────────────────────────────────────────────────────
//
// `alignDrag` is a function of the RAW pointer position, never of the last answer it gave.
// Move the pointer a pixel while a guide is within tolerance and the raw position changes
// but the snapped one does not, so the box sits on the guide until the pointer leaves the
// tolerance band — the magnetic feel — with no gesture state to keep in step and nothing
// to reset if a drag is interrupted.
//
// It also means the settled frame can go through the same call as the last in-flight frame
// and land in the same place. Committing the raw position instead would flick the box off
// the guide by up to the tolerance at the instant the button comes up, which is the most
// visible bug this feature could have.

import type { EntityId, Point } from '../../../domain'

import type { Size } from '../trace'

/** A box in diagram units — position is its top-left, as React Flow reports it. */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * One line to draw, in diagram units.
 *
 * `axis: 'x'` is a VERTICAL line at `position` — it pins an x coordinate. `start`/`end`
 * are its extent along the other axis, chosen so the line reaches both the box being
 * dragged and every box it is lining up with. That is what makes it read as a
 * relationship between them rather than as decoration.
 */
export interface Guide {
  axis: 'x' | 'y'
  position: number
  start: number
  end: number
}

export interface Alignment {
  guides: Guide[]
  /** How far the drag has to move for the guides to be exact. Zero when nothing matched. */
  offset: Point
}

/**
 * Left/centre/right as fractions of the width — top/middle/bottom of the height.
 *
 * Three edges per axis rather than two is what makes centring work, and centring is the
 * one alignment nobody can get right by eye.
 */
const EDGES = [0, 0.5, 1] as const

/** Floating-point slack when deciding whether two deltas are the same delta. */
const EPSILON = 0.01

function edgesOf(rect: Rect, axis: 'x' | 'y'): number[] {
  const start = axis === 'x' ? rect.x : rect.y
  const size = axis === 'x' ? rect.width : rect.height
  return EDGES.map((fraction) => start + size * fraction)
}

interface AxisMatch {
  offset: number
  /** Guide position → the boxes that put a guide there, which is what sets its span. */
  lines: Map<number, Rect[]>
}

/**
 * The closest alignment on one axis, and every edge that shares it.
 *
 * Two passes rather than one. The first finds the SMALLEST offset inside the tolerance,
 * because a drag can only be nudged one way and the nearest alignment is the one being
 * reached for. The second then collects every pair that lands on exactly that offset, so
 * lining up with a column of six boxes draws one line through all six rather than picking
 * one of them arbitrarily.
 */
function matchAxis(
  moving: Rect,
  others: readonly Rect[],
  axis: 'x' | 'y',
  tolerance: number,
): AxisMatch {
  const mine = edgesOf(moving, axis)
  let offset = Number.POSITIVE_INFINITY

  for (const other of others) {
    for (const theirs of edgesOf(other, axis)) {
      for (const own of mine) {
        const delta = theirs - own
        if (Math.abs(delta) <= tolerance && Math.abs(delta) < Math.abs(offset)) offset = delta
      }
    }
  }

  const lines = new Map<number, Rect[]>()
  if (!Number.isFinite(offset)) return { offset: 0, lines }

  for (const other of others) {
    for (const theirs of edgesOf(other, axis)) {
      for (const own of mine) {
        if (Math.abs(theirs - own - offset) > EPSILON) continue
        lines.set(theirs, [...(lines.get(theirs) ?? []), other])
      }
    }
  }

  return { offset, lines }
}

function unionOf(boxes: readonly Rect[]): Rect {
  const x = Math.min(...boxes.map((box) => box.x))
  const y = Math.min(...boxes.map((box) => box.y))
  const right = Math.max(...boxes.map((box) => box.x + box.width))
  const bottom = Math.max(...boxes.map((box) => box.y + box.height))
  return { x, y, width: right - x, height: bottom - y }
}

/** The extent of the dragged box and its partners along the axis the line runs down. */
function spanOf(
  axis: 'x' | 'y',
  moved: Rect,
  partners: readonly Rect[],
): { start: number; end: number } {
  const span = unionOf([moved, ...partners])
  return axis === 'x'
    ? { start: span.x, end: span.x + span.width }
    : { start: span.y, end: span.y + span.height }
}

/**
 * Which edges line up, and how far to move so that they line up exactly.
 *
 * A tolerance of zero is meaningful rather than a way of switching this off: it reports
 * the alignments that are ALREADY exact and asks for no movement, which is what snapping
 * to the grid wants. The grid is then the discipline, and a second magnet fighting it
 * would pull boxes back off it.
 */
export function alignmentGuides(
  moving: Rect,
  others: readonly Rect[],
  tolerance: number,
): Alignment {
  const x = matchAxis(moving, others, 'x', tolerance)
  const y = matchAxis(moving, others, 'y', tolerance)
  const moved: Rect = { ...moving, x: moving.x + x.offset, y: moving.y + y.offset }

  const guides: Guide[] = []
  for (const [position, partners] of x.lines) {
    guides.push({ axis: 'x', position, ...spanOf('y', moved, partners) })
  }
  for (const [position, partners] of y.lines) {
    guides.push({ axis: 'y', position, ...spanOf('x', moved, partners) })
  }

  return { guides, offset: { x: x.offset, y: y.offset } }
}

/**
 * Are these the same lines, in the same places?
 *
 * The guard that keeps guide state off the render loop, and the sibling of
 * `sizesUnchanged` in trace.ts. A drag recomputes its guides on every pointer frame and
 * the answer is the same for most of them — a fresh array each time would publish new
 * state, and a new array identity, for no new information.
 */
export function sameGuides(previous: readonly Guide[], next: readonly Guide[]): boolean {
  if (previous === next) return true
  if (previous.length !== next.length) return false

  return previous.every((guide, index) => {
    const other = next[index]
    return (
      other !== undefined &&
      guide.axis === other.axis &&
      guide.position === other.position &&
      guide.start === other.start &&
      guide.end === other.end
    )
  })
}

export interface DragAlignmentRequest {
  /** The raw in-flight (or settled) positions React Flow reported for the dragged boxes. */
  moving: Readonly<Record<EntityId, Point>>
  /** Committed positions of every entity, the ones being dragged included. */
  positions: Readonly<Record<EntityId, Point>>
  /**
   * Sizes React Flow measured. An entity with no entry takes no part, in either role.
   *
   * That is the right failure: a size only reaches this record once the browser has laid
   * the box out, so an entity without one has never been on screen — and a guide to a box
   * nobody has seen is a guide to nothing.
   */
  sizes: Readonly<Record<EntityId, Size>>
  /**
   * Only boxes intersecting this rectangle are candidates, in diagram units.
   *
   * Alignment is something you SEE, so what it can pull towards has to be what is on
   * screen. Without the limit, at 120 tables some edge is within a few pixels of almost
   * any cursor position, and the drag feels magnetised to nothing visible. Omit it and
   * every entity is a candidate — which is what a test wants, and what a surface with no
   * viewport of its own would want.
   */
  visible?: Rect
  /** In diagram units, so the caller divides its pixel budget by the zoom. */
  tolerance: number
}

export interface DragAlignment {
  /** The dragged positions, nudged onto the guides. Same keys as `moving`. */
  positions: Record<EntityId, Point>
  guides: Guide[]
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

/**
 * One drag frame: the positions to render, and the lines to draw beside them.
 *
 * The dragged boxes are treated as ONE box — their union — so a multi-selection drag
 * aligns as a block rather than each member pulling a different way.
 */
export function alignDrag(request: DragAlignmentRequest): DragAlignment {
  const { moving, positions, sizes, tolerance } = request

  const movingEntries = Object.entries(moving) as [EntityId, Point][]
  const movingBoxes: Rect[] = []
  for (const [id, point] of movingEntries) {
    const size = sizes[id]
    if (size !== undefined) movingBoxes.push({ x: point.x, y: point.y, ...size })
  }

  if (movingBoxes.length === 0) return { positions: { ...moving }, guides: [] }

  const movingIds = new Set<string>(Object.keys(moving))
  const others: Rect[] = []
  for (const [id, point] of Object.entries(positions) as [EntityId, Point][]) {
    if (movingIds.has(id)) continue
    const size = sizes[id]
    if (size === undefined) continue
    const rect: Rect = { x: point.x, y: point.y, ...size }
    if (request.visible !== undefined && !intersects(rect, request.visible)) continue
    others.push(rect)
  }

  const { guides, offset } = alignmentGuides(unionOf(movingBoxes), others, tolerance)

  const nudged: Record<EntityId, Point> = {}
  for (const [id, point] of movingEntries) {
    nudged[id] = { x: point.x + offset.x, y: point.y + offset.y }
  }

  return { positions: nudged, guides }
}
