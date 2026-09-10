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
 */
export function traceSets(
  diagram: Diagram,
  hoveredEntityId: EntityId | undefined,
  hoveredRelationshipId: RelationshipId | undefined,
): TraceSets {
  if (hoveredRelationshipId !== undefined) {
    const relationship = diagram.relationships.find(
      (candidate) => candidate.id === hoveredRelationshipId,
    )
    return {
      entities: new Set(
        relationship?.participants.map((participant) => participant.entityId) ?? [],
      ),
      relationships: new Set([hoveredRelationshipId]),
    }
  }

  if (hoveredEntityId !== undefined) {
    const neighbourhood = nHopNeighbourhood(diagram, [hoveredEntityId], 1)
    return { entities: neighbourhood.entityIds, relationships: neighbourhood.relationshipIds }
  }

  return { entities: new Set(), relationships: new Set() }
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
 * Only `position` changes. `selected` is derived from the model, so accepting it would
 * fight the store for ownership of the same fact — but `dimensions` is NOT, and dropping
 * it was a bug for as long as this comment claimed otherwise. See `measuredDimensions`.
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
