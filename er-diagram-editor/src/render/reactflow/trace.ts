// Pure helpers for the canvas.
//
// Split out of Canvas.tsx so that file exports components only — React Fast Refresh
// cannot preserve state across edits to a module that mixes the two. They are also far
// easier to test without mounting React.

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
