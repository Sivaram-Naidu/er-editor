// Pure helpers for the canvas.
//
// Split out of Canvas.tsx so that file exports components only — React Fast Refresh
// cannot preserve state across edits to a module that mixes the two. They are also far
// easier to test without mounting React.

import type { Node, NodeChange } from '@xyflow/react'

import {
  nHopNeighbourhood,
  type Diagram,
  type EntityId,
  type Point,
  type RelationshipId,
} from '../../domain'

/** Fallback grid placement for entities with no position yet, until ELK lands. */
const GRID_COLUMNS = 5
const GRID_X = 280
const GRID_Y = 200

/** A measured box size, in diagram units. */
export interface Size {
  width: number
  height: number
}

export interface TraceSets {
  entities: ReadonlySet<EntityId>
  relationships: ReadonlySet<RelationshipId>
}

/**
 * Which elements are emphasised, and by implication which recede.
 *
 * Hovering a relationship traces it and both endpoints; hovering an entity traces it and
 * everything one hop out (FR-4.1, FR-4.2). Both are the same one-hop neighbourhood
 * question, so they share `nHopNeighbourhood` rather than each growing their own walk.
 *
 * Returning empty sets when nothing is hovered is load-bearing: `isDimmed` is then false
 * everywhere, so the diagram renders at full strength rather than uniformly faded.
 *
 * That answer is a SHARED constant rather than a fresh pair of Sets, and the identity is
 * load-bearing too. Canvas memoises this on the whole `Diagram`, which is a new object
 * after any edit including a pure move, so a fresh empty pair would travel into every
 * node's `data` and defeat the comparison in `sameEntityNode` — re-rendering all 120
 * boxes and their rows whenever a layout lands. Nothing hovered is always the same
 * nothing.
 */
const NOTHING_TRACED: TraceSets = { entities: new Set(), relationships: new Set() }

export function traceSets(
  diagram: Diagram,
  hoveredEntityId: EntityId | undefined,
  hoveredRelationshipId: RelationshipId | undefined,
  pinnedRelationshipId: RelationshipId | undefined,
): TraceSets {
  /*
   * A PINNED TRACE OUTRANKS THE POINTER, and that is the requirement rather than an
   * opinion. FR-4.4 exists so you can pan while tracing, and on a schema larger than one
   * screen that is the only way to follow a connector to its far end. If hover could
   * override it the feature would fail at exactly the moment it is meant to work: a
   * trackpad pan scrolls the diagram UNDER a stationary pointer, so box after box fires
   * `mouseenter` and the trace the user pinned would be replaced by whatever slid beneath
   * the cursor. (A drag-pan happens to be safe — the pane takes pointer capture — which is
   * precisely the sort of difference that makes "it worked when I tried it" untrustworthy.)
   *
   * Dismissing it needs no new mechanism: the pin IS the relationship selection, so Escape
   * and a click on empty canvas already clear it, both through `selectEntities([])`.
   */
  const relationshipId = pinnedRelationshipId ?? hoveredRelationshipId
  if (relationshipId !== undefined) {
    const relationship = diagram.relationships.find((candidate) => candidate.id === relationshipId)
    return {
      entities: new Set(
        relationship?.participants.map((participant) => participant.entityId) ?? [],
      ),
      relationships: new Set([relationshipId]),
    }
  }

  if (hoveredEntityId !== undefined) {
    const neighbourhood = nHopNeighbourhood(diagram, [hoveredEntityId], 1)
    return { entities: neighbourhood.entityIds, relationships: neighbourhood.relationshipIds }
  }

  return NOTHING_TRACED
}

export function fallbackPosition(index: number): Point {
  return { x: (index % GRID_COLUMNS) * GRID_X, y: Math.floor(index / GRID_COLUMNS) * GRID_Y }
}

// ─────────────────────────────────────────────────────────────────────────────
// A DRAG HAS TWO TIERS, AND THE REASON IS NOT PERFORMANCE ALONE
// ─────────────────────────────────────────────────────────────────────────────
//
// React Flow emits a `position` change on every pointer frame with `dragging: true`, then
// one final change with `dragging: false`.
//
// Committing every frame through the command stack is not an option: each one is an Immer
// pass over the document, a store publish, a revalidation and a rebuild of every node and
// edge. At 120 entities that is the whole write path at pointer rate, which is what
// NFR-1.3 exists to prevent.
//
// But dropping the in-flight frames is not an option either, and this is the part that was
// got wrong. The comment here used to assert that "React Flow holds the in-flight position
// itself, so the node still follows the cursor with nothing committed behind it." That is
// true of React Flow's UNCONTROLLED mode. This canvas is controlled — node positions come
// from `diagram.layout.positions` on every render — and in controlled mode React Flow only
// REPORTS the drag; applying it is the consumer's job. So nothing applied it. The box sat
// still through the entire gesture and appeared at the destination on release: a teleport,
// confirmed in Chrome with the node's transform frozen at `matrix(1,0,0,1,0,0)` for the
// whole drag.
//
// So the two tiers: in-flight positions go into local component state, which is cheap and
// makes the box track the cursor; the settled one goes through the command stack, which is
// what lands in the document and in the undo history. One gesture, one undo step, and a
// box that moves while you move it.

/**
 * In-flight drag positions — the ones to render but NOT commit.
 *
 * Keyboard nudges never appear here: they arrive already settled.
 */
export function inFlightPositions(changes: readonly NodeChange[]): Record<EntityId, Point> {
  const moving: Record<EntityId, Point> = {}

  for (const change of changes) {
    if (change.type === 'position' && change.position !== undefined && change.dragging === true) {
      moving[change.id as EntityId] = change.position
    }
  }

  return moving
}

/**
 * The moves worth committing, out of a batch of React Flow node changes.
 *
 * Only `position` changes. `dimensions` is NOT derived from the model and has its own
 * tier — see `measuredDimensions` — and neither is a MARQUEE result, which has a fourth;
 * see `applySelectionChanges`.
 *
 * And only SETTLED ones — see the note above for what the other tier is for.
 */
export function settledPositions(changes: readonly NodeChange[]): Record<EntityId, Point> {
  const moved: Record<EntityId, Point> = {}

  for (const change of changes) {
    if (change.type === 'position' && change.position !== undefined && !change.dragging) {
      moved[change.id as EntityId] = change.position
    }
  }

  return moved
}

// ─────────────────────────────────────────────────────────────────────────────
// MEASURED DIMENSIONS ARE REACT FLOW'S FACT, AND IT HAS TO BE GIVEN BACK
// ─────────────────────────────────────────────────────────────────────────────
//
// A node's size is not in the document. It is whatever the browser laid the box out at,
// which React Flow measures with a ResizeObserver and reports as a `dimensions` change.
// This file used to drop those on the stated grounds that dimensions are "derived from the
// model". They are not — they are measured from the DOM, and React Flow's own
// `applyNodeChanges` writes them straight back onto the node as `measured`.
//
// Dropping them broke two things, because React Flow re-adopts nodes by REFERENCE equality
// (`adoptUserNodes`: it keeps the internal node only when the incoming object is the same
// object as last time). Every rebuild of the node array therefore handed React Flow a node
// with no `measured`, and it dutifully forgot the size it had just measured:
//
//   1. `NodeWrapper` renders `visibility: hasDimensions ? 'visible' : 'hidden'`, so every
//      box went `visibility: hidden` for the one frame until the ResizeObserver fired
//      again — measured at ~19 ms in Chrome. A click inside that window is not hit-tested
//      against the node at all; it lands on `.react-flow__pane` behind it, so `onPaneClick`
//      fired and CLEARED the selection instead of making one. Clicking a table to select it
//      — the most basic gesture in the tool — worked only if you held still first.
//   2. The minimap reads the USER node's dimensions (`nodeHasDimensions(internals.userNode)`)
//      and returns null without them. Since measurement only ever wrote to the internal
//      node, that was false forever and the minimap was a permanently empty white box.
//
// One `if` in `handleNodesChange` and a `measured` field on the node fixes both, and makes
// every rebuild trigger — hover, selection, LOD, any edit — non-destructive rather than
// just the hover one.

/**
 * The sizes React Flow has measured, out of a batch of node changes.
 *
 * These must be carried on the node objects handed back to React Flow, or it forgets them
 * on the next rebuild — see the note above for what that costs.
 */
export function measuredDimensions(changes: readonly NodeChange[]): Record<EntityId, Size> {
  const sized: Record<EntityId, Size> = {}

  for (const change of changes) {
    if (change.type === 'dimensions' && change.dimensions !== undefined) {
      sized[change.id as EntityId] = change.dimensions
    }
  }

  return sized
}

// ─────────────────────────────────────────────────────────────────────────────
// SELECTION IS THE STORE'S, EXCEPT FOR THE ONE THING ONLY REACT FLOW KNOWS
// ─────────────────────────────────────────────────────────────────────────────
//
// `select` changes are dropped everywhere else, and that is right: the store owns the
// selection, and accepting React Flow's opinion on a click would fight it for the same
// fact. The library treats Shift as its marquee key rather than as a multi-select key, so
// it reads a shift-click as a plain one and internally deselects everything else — while
// this app reads it as "add to the selection" (FR-2.7). There is a note in CLAUDE.md about
// what that cost the first time.
//
// A MARQUEE is the exception, for the same reason `dimensions` was: it is not a derivation
// of anything in the document. Only React Flow knows which boxes the rubber band covered —
// it owns the band, the pointer capture, the viewport transform and the hit test. So the
// result is input, like a drag, and the consumer's job is to pick it up.
//
// The subtlety that makes this a function rather than one line: React Flow emits DELTAS.
// `getSelectionChanges` compares the band's new answer with its previous one and reports
// only what differs, so a batch late in the gesture says "c was added" and says nothing at
// all about a and b, which the band has covered since the first frame. Reading the last
// batch would select one box out of five. The deltas have to be accumulated.

/**
 * `current`, with one batch of React Flow's select changes folded in.
 *
 * Returns `current` itself when the batch says nothing about selection, so a gesture's
 * many position and dimension batches do not each mint a new Set.
 */
export function applySelectionChanges(
  current: ReadonlySet<EntityId>,
  changes: readonly NodeChange[],
): ReadonlySet<EntityId> {
  let next: Set<EntityId> | undefined

  for (const change of changes) {
    if (change.type !== 'select') continue
    next ??= new Set(current)
    if (change.selected) next.add(change.id as EntityId)
    else next.delete(change.id as EntityId)
  }

  return next ?? current
}

/**
 * Whether every size in `incoming` is already recorded in `known`, at the same value.
 *
 * The guard that keeps this off the render loop. React Flow re-emits a `dimensions` change
 * whenever it re-measures, which includes re-measuring to the size it already had; storing
 * that unchanged value would still produce a new state object, a new node array, and
 * another adopt — a render per observer tick for no new information.
 */
export function sizesUnchanged(
  known: Readonly<Record<EntityId, Size>>,
  incoming: Readonly<Record<EntityId, Size>>,
): boolean {
  for (const [id, size] of Object.entries(incoming) as [EntityId, Size][]) {
    const current = known[id]
    if (current === undefined || current.width !== size.width || current.height !== size.height) {
      return false
    }
  }

  return true
}

/**
 * The base nodes with in-flight drag positions and measured sizes laid over the top.
 *
 * Kept out of the expensive node memo in Canvas — that one walks every attribute of every
 * entity to resolve foreign key targets and traced rows, and must not re-run per pointer
 * frame. This overlay returns the SAME object for every node with nothing to overlay,
 * which is what keeps `memo` on EntityNode effective: only the dragged box re-renders, not
 * the other 119.
 *
 * Exported because the interesting assertion is about this function together with the
 * three extractors above — see the "tiers together" tests. The click-to-select bug lived
 * exactly here, in the gap between "React Flow reported a size" and "a node carried it".
 */
export function overlayNodes<T extends Node>(
  nodes: readonly T[],
  dragged: Readonly<Record<EntityId, Point>>,
  measured: Readonly<Record<EntityId, Size>>,
): T[] {
  return nodes.map((node) => {
    const id = node.id as EntityId
    const position = dragged[id]
    const size = measured[id]
    if (position === undefined && size === undefined) return node

    // Spread conditionally: `exactOptionalPropertyTypes` rejects an explicit
    // `measured: undefined`, and it would be wrong anyway — that is precisely the value
    // that makes React Flow treat the box as unmeasured.
    return {
      ...node,
      ...(position === undefined ? {} : { position }),
      ...(size === undefined ? {} : { measured: size }),
    }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// REACT FLOW RE-ADOPTS BY REFERENCE, SO HANDING IT THE SAME OBJECT IS THE FIX
// ─────────────────────────────────────────────────────────────────────────────
//
// `adoptUserNodes` keeps a node's internals only when the incoming object IS the object
// it was given last time. Every rebuild of the node array therefore costs an adopt per
// node and a wrapper render per node, whether or not anything about that node changed —
// and `Canvas` rebuilds the whole array on every hover and every click, because
// `baseNodes` depends on the trace sets and on the selection.
//
// Measured on the production build at 120 entities, before this: hover p95 83–195 ms and
// selection p95 147–162 ms, against NFR-1.3's 100 ms. Neither is the node BODY redrawing
// — `sameEntityNode` already stops that — it is 120 new objects per pointer event.
//
// So the array is still rebuilt, which is cheap, and then every node that came out
// equivalent to the one React Flow already holds is swapped back for that exact object.
// A hover then changes four node objects instead of a hundred and twenty.
//
// THIS HAS TO RUN LAST, after `overlayNodes`. The overlay reattaches `measured` to every
// node that has a size, which is all of them once React Flow has measured, so comparing
// before it would find every node different on every render and reuse nothing.

/** Shallow equality over a node's `data`, which is a fresh object on every rebuild. */
function sameData(previous: unknown, next: unknown): boolean {
  if (Object.is(previous, next)) return true
  if (typeof previous !== 'object' || typeof next !== 'object') return false
  if (previous === null || next === null) return false

  const before = previous as Record<string, unknown>
  const after = next as Record<string, unknown>
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])

  for (const key of keys) {
    if (!Object.is(before[key], after[key])) return false
  }

  return true
}

/**
 * Is this node indistinguishable from the one React Flow already holds?
 *
 * Every own key is compared, so a field added to the node later cannot silently stop
 * being noticed — the failure mode of a hand-maintained list. Two exceptions:
 *
 * `position` is compared by VALUE. `fallbackPosition` mints a fresh `{x, y}` on every
 * render for any entity that has no position yet, so comparing it by reference would
 * refuse to reuse exactly the nodes that never move.
 *
 * `data` is compared shallowly, because `Canvas` builds a new `data` object for every
 * node on every render — it has to, since that object is where the node's draw state
 * lives. Its fields are individually reference-stable by construction; that is what the
 * memos in `Canvas` are for, and `sameEntityNode` relies on the same property.
 */
function sameNode<T extends Node>(previous: T, next: T): boolean {
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)])

  for (const key of keys) {
    if (key === 'data' || key === 'position') continue
    const before = (previous as unknown as Record<string, unknown>)[key]
    const after = (next as unknown as Record<string, unknown>)[key]
    if (!Object.is(before, after)) return false
  }

  if (previous.position.x !== next.position.x || previous.position.y !== next.position.y) {
    return false
  }

  return sameData(previous.data, next.data)
}

/**
 * `next`, with every unchanged node replaced by the object from `previous`.
 *
 * Returns `previous` itself when nothing at all changed, so React Flow's `StoreUpdater`
 * can skip the update entirely rather than re-adopting a hundred and twenty identical
 * nodes — the array reference is what it watches.
 */
export function reuseUnchanged<T extends Node>(previous: readonly T[], next: readonly T[]): T[] {
  // Runs on every render of Canvas, not only when the node array is rebuilt, so the case
  // where nothing upstream changed at all is worth not walking.
  if (previous === next) return previous as T[]
  if (previous.length === 0) return [...next]

  const held = new Map(previous.map((node) => [node.id, node]))
  let reusedCount = 0

  const merged = next.map((node) => {
    const existing = held.get(node.id)
    if (existing !== undefined && sameNode(existing, node)) {
      reusedCount++
      return existing
    }
    return node
  })

  return reusedCount === next.length && next.length === previous.length ? (previous as T[]) : merged
}
