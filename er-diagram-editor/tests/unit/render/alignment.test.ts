/**
 * @vitest-environment node
 *
 * Alignment guides and the magnet behind them (FR-3.5). Pure geometry — nothing here
 * mounts anything, so the file stays on the suite default rather than paying for jsdom.
 *
 * The last describe is the one that matters most. Snapping is not one unit: the position
 * a user SEES is produced by the in-flight tier and the position that is STORED by the
 * settled tier, and a feature that moves boxes has to give both the same answer or the box
 * flicks off its guide at the instant the button comes up. That is the shape of defect this
 * project has shipped before — see the two-tier position test in canvas.test.tsx.
 */
import { describe, expect, it } from 'vitest'

import type { EntityId, Point } from '../../../src/domain'
import {
  alignDrag,
  alignmentGuides,
  inFlightPositions,
  sameGuides,
  settledPositions,
  type Guide,
  type Rect,
} from '../../../src/render'

const id = (name: string): EntityId => name as EntityId

/** A 200x100 box, which is roughly what a three-field table measures at L2. */
function box(x: number, y: number, width = 200, height = 100): Rect {
  return { x, y, width, height }
}

function verticalAt(guides: readonly Guide[], position: number): Guide | undefined {
  return guides.find((guide) => guide.axis === 'x' && guide.position === position)
}

function horizontalAt(guides: readonly Guide[], position: number): Guide | undefined {
  return guides.find((guide) => guide.axis === 'y' && guide.position === position)
}

describe('alignmentGuides (FR-3.5)', () => {
  it('reports nothing when there is nothing to line up with', () => {
    const result = alignmentGuides(box(10, 10), [], 6)

    expect(result.guides).toEqual([])
    expect(result.offset).toEqual({ x: 0, y: 0 })
  })

  it('pulls a near-miss onto the edge exactly, and draws the line there', () => {
    // 4px short of sharing a left edge with a box at x = 500.
    const result = alignmentGuides(box(496, 300), [box(500, 0)], 6)

    expect(result.offset.x).toBe(4)
    expect(verticalAt(result.guides, 500)).toBeDefined()
  })

  it('leaves a miss outside the tolerance alone', () => {
    const result = alignmentGuides(box(489, 300), [box(500, 0)], 6)

    expect(result.offset).toEqual({ x: 0, y: 0 })
    expect(result.guides).toEqual([])
  })

  it('lines up centres, not only edges', () => {
    // A 100-wide box centred at 150 against a 200-wide box centred at 152.
    const result = alignmentGuides(box(100, 400, 100, 60), [box(52, 0)], 6)

    expect(result.offset.x).toBe(2)
    expect(verticalAt(result.guides, 152)).toBeDefined()
  })

  it('takes the nearest alignment when several are in range', () => {
    // Left edge is 5 away from one box, right edge 1 away from another. A drag can only
    // be nudged one way, so the nearest is the one being reached for.
    const result = alignmentGuides(box(100, 400), [box(105, 0), box(301, 0)], 6)

    expect(result.offset.x).toBe(1)
  })

  it('draws one line through every box sharing the position, not just the first', () => {
    const column = [box(500, 0), box(500, 200), box(500, 400)]
    const result = alignmentGuides(box(497, 900), column, 6)

    expect(verticalAt(result.guides, 500)).toBeDefined()
    expect(
      result.guides.filter((guide) => guide.axis === 'x' && guide.position === 500),
    ).toHaveLength(1)
  })

  it('runs the line far enough to reach both ends of what it is explaining', () => {
    // The guide has to touch the box at the top and the dragged box 900 down, or it
    // reads as decoration rather than as a statement about the two of them.
    const result = alignmentGuides(box(497, 900), [box(500, 0)], 6)
    const guide = verticalAt(result.guides, 500)

    expect(guide?.start).toBe(0)
    expect(guide?.end).toBe(1000)
  })

  it('lines up horizontally on the same three edges', () => {
    const result = alignmentGuides(box(900, 204), [box(0, 200)], 6)

    expect(result.offset.y).toBe(-4)
    expect(horizontalAt(result.guides, 200)).toBeDefined()
  })

  it('a tolerance of zero still reports an exact alignment, and asks for no movement', () => {
    // The snap-to-grid case. The grid has already placed both boxes; the guide confirms
    // it, and a second magnet on top would pull them straight back off the grid.
    const exact = alignmentGuides(box(500, 300), [box(500, 0)], 0)
    expect(exact.offset).toEqual({ x: 0, y: 0 })
    expect(verticalAt(exact.guides, 500)).toBeDefined()

    const near = alignmentGuides(box(498, 300), [box(500, 0)], 0)
    expect(near.guides).toEqual([])
  })
})

describe('alignDrag (FR-3.5)', () => {
  const sizes = {
    [id('a')]: { width: 200, height: 100 },
    [id('b')]: { width: 200, height: 100 },
    [id('c')]: { width: 200, height: 100 },
  }
  const positions = {
    [id('a')]: { x: 0, y: 0 },
    [id('b')]: { x: 500, y: 0 },
    [id('c')]: { x: 500, y: 300 },
  }

  it('nudges the dragged box onto its neighbour', () => {
    const result = alignDrag({
      moving: { [id('a')]: { x: 497, y: 600 } },
      positions,
      sizes,
      tolerance: 6,
    })

    expect(result.positions[id('a')]).toEqual({ x: 500, y: 600 })
    expect(verticalAt(result.guides, 500)).toBeDefined()
  })

  it('never aligns a box with where it used to be', () => {
    // `positions` still holds the pre-drag coordinate of the box under the cursor. If it
    // were a candidate, every box would be magnetised to its own starting point and a
    // small deliberate nudge would be impossible.
    const result = alignDrag({
      moving: { [id('a')]: { x: 3, y: 2 } },
      positions: { [id('a')]: { x: 0, y: 0 } },
      sizes: { [id('a')]: { width: 200, height: 100 } },
      tolerance: 6,
    })

    expect(result.positions[id('a')]).toEqual({ x: 3, y: 2 })
    expect(result.guides).toEqual([])
  })

  it('moves a multi-selection as one block, by one offset', () => {
    // Not per box: aligning each member separately would pull the selection apart, which
    // is the one thing a group drag must never do.
    const result = alignDrag({
      moving: { [id('a')]: { x: 497, y: 600 }, [id('b')]: { x: 797, y: 640 } },
      positions: { ...positions, [id('b')]: { x: 500, y: 0 } },
      sizes,
      tolerance: 6,
    })

    const a = result.positions[id('a')]!
    const b = result.positions[id('b')]!
    expect(b.x - a.x).toBe(300)
    expect(b.y - a.y).toBe(40)
  })

  it('ignores a box whose size has never been measured', () => {
    // No size means the browser has never laid it out, so it has never been on screen —
    // and a guide to a box nobody has seen is a guide to nothing.
    const result = alignDrag({
      moving: { [id('a')]: { x: 497, y: 600 } },
      positions,
      sizes: { [id('a')]: { width: 200, height: 100 } },
      tolerance: 6,
    })

    expect(result.positions[id('a')]).toEqual({ x: 497, y: 600 })
    expect(result.guides).toEqual([])
  })

  it('returns the drag untouched when the dragged box itself is unmeasured', () => {
    const result = alignDrag({
      moving: { [id('a')]: { x: 497, y: 600 } },
      positions,
      sizes: { [id('b')]: { width: 200, height: 100 } },
      tolerance: 6,
    })

    expect(result.positions[id('a')]).toEqual({ x: 497, y: 600 })
    expect(result.guides).toEqual([])
  })

  it('only considers boxes inside the visible rectangle', () => {
    // At 120 tables some edge is within a few pixels of almost any cursor position, so
    // without this the drag feels magnetised to something the user cannot see.
    const request = {
      moving: { [id('a')]: { x: 497, y: 600 } },
      positions,
      sizes,
      tolerance: 6,
    }

    // No frame given: every entity is a candidate, and `c` pulls the drag onto x = 500.
    expect(alignDrag(request).positions[id('a')]).toEqual({ x: 500, y: 600 })

    // A frame `c` overlaps: the same pull, for the same reason.
    const framed = alignDrag({ ...request, visible: { x: 400, y: 350, width: 600, height: 600 } })
    expect(framed.positions[id('a')]).toEqual({ x: 500, y: 600 })

    // A frame neither `b` nor `c` reaches: nothing to line up with, so nothing moves.
    const blind = alignDrag({ ...request, visible: { x: 0, y: 550, width: 300, height: 300 } })
    expect(blind.positions[id('a')]).toEqual({ x: 497, y: 600 })
    expect(blind.guides).toEqual([])
  })
})

describe('sameGuides', () => {
  const a: Guide = { axis: 'x', position: 500, start: 0, end: 700 }

  it('is true for the same lines in the same places', () => {
    expect(sameGuides([a], [{ ...a }])).toBe(true)
  })

  it('is false when a line moved', () => {
    expect(sameGuides([a], [{ ...a, position: 501 }])).toBe(false)
  })

  it('is false when a line grew', () => {
    // The span changes as the dragged box travels along the guide, and a stale span is a
    // line that stops short of the box it is explaining.
    expect(sameGuides([a], [{ ...a, end: 900 }])).toBe(false)
  })

  it('is false when a line appeared', () => {
    expect(sameGuides([a], [a, { axis: 'y', position: 0, start: 0, end: 200 }])).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// THE TIERS AGAIN — BECAUSE SNAPPING SPANS BOTH OF THEM
// ─────────────────────────────────────────────────────────────────────────────

describe('alignment across the two drag tiers (FR-3.5)', () => {
  const at = (nodeId: string, x: number, y: number, dragging: boolean) =>
    ({ id: nodeId, type: 'position', position: { x, y }, dragging }) as const

  const sizes = {
    [id('a')]: { width: 200, height: 100 },
    [id('b')]: { width: 200, height: 100 },
  }
  const positions = { [id('a')]: { x: 0, y: 0 }, [id('b')]: { x: 500, y: 0 } }
  const snap = (moving: Record<EntityId, Point>) =>
    alignDrag({ moving, positions, sizes, tolerance: 6 })

  /**
   * THE TEST THAT WOULD CATCH THE OBVIOUS WAY TO GET THIS WRONG.
   *
   * The in-flight tier renders and the settled tier commits — two call sites, one
   * question. Run only the rendered frames through the magnet and the box sits on the
   * guide for the whole gesture and then jumps back off it by up to the tolerance the
   * moment the button is released, because the raw position was what got stored. Nothing
   * about either tier on its own would look wrong.
   */
  it('commits the position it last drew', () => {
    const changes = [at('a', 497, 300, true), at('a', 497, 300, false)]

    const drawn = snap(inFlightPositions([changes[0]!]))
    const committed = snap(settledPositions([changes[1]!]))

    expect(committed.positions[id('a')]).toEqual(drawn.positions[id('a')])
    expect(committed.positions[id('a')]).toEqual({ x: 500, y: 300 })
  })

  it('is stateless, so the magnet holds the box while the pointer drifts inside it', () => {
    // Three consecutive raw frames, each a pixel apart and all within tolerance of the
    // same edge, must all render at the edge — no memory of the previous answer needed,
    // and nothing to reset if the gesture is interrupted.
    const drawn = [496, 497, 498].map(
      (x) => snap(inFlightPositions([at('a', x, 300, true)])).positions[id('a')],
    )

    expect(drawn).toEqual([
      { x: 500, y: 300 },
      { x: 500, y: 300 },
      { x: 500, y: 300 },
    ])
  })

  it('lets go once the pointer leaves the tolerance band', () => {
    const escaped = snap(inFlightPositions([at('a', 488, 300, true)])).positions[id('a')]

    expect(escaped).toEqual({ x: 488, y: 300 })
  })
})
