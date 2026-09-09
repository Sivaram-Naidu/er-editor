// nHopNeighbourhood() - powers isolate mode (FR-2.8) and hover highlight (FR-4.2).

import type { Diagram, EntityId, RelationshipId } from '../model/types'

import { incidentRelationships } from './adjacency'
import { indexOf } from './indexes'

export interface Neighbourhood {
  /** Includes the seeds themselves, at depth 0. */
  entityIds: ReadonlySet<EntityId>
  relationshipIds: ReadonlySet<RelationshipId>
  /** Hop count per entity, seeds at 0. Lets the renderer fade by distance. */
  depthByEntity: ReadonlyMap<EntityId, number>
}

/**
 * Breadth-first expansion from one or more seed entities.
 *
 * `depth` 1 is the hover case (FR-4.2: the entity, its relationships, and their far
 * ends). Depths 1–3 are the isolate-mode range (FR-2.8).
 *
 * Relationships are collected when first traversed, so at depth 1 the returned set
 * contains every relationship touching a seed — including ones whose far end is beyond
 * the depth limit. That is deliberate: FR-4.2 wants the connector highlighted even when
 * the entity at its other end is dimmed.
 */
export function nHopNeighbourhood(
  diagram: Diagram,
  seeds: readonly EntityId[],
  depth: number,
): Neighbourhood {
  const index = indexOf(diagram)
  const entityIds = new Set<EntityId>()
  const relationshipIds = new Set<RelationshipId>()
  const depthByEntity = new Map<EntityId, number>()

  let frontier: EntityId[] = []
  for (const seed of seeds) {
    if (!index.entityById.has(seed) || entityIds.has(seed)) continue
    entityIds.add(seed)
    depthByEntity.set(seed, 0)
    frontier.push(seed)
  }

  for (let hop = 0; hop < Math.max(0, depth) && frontier.length > 0; hop += 1) {
    const next: EntityId[] = []

    for (const entityId of frontier) {
      for (const relationship of incidentRelationships(diagram, entityId)) {
        relationshipIds.add(relationship.id)

        for (const participant of relationship.participants) {
          if (entityIds.has(participant.entityId)) continue
          if (!index.entityById.has(participant.entityId)) continue
          entityIds.add(participant.entityId)
          depthByEntity.set(participant.entityId, hop + 1)
          next.push(participant.entityId)
        }
      }
    }

    frontier = next
  }

  return { entityIds, relationshipIds, depthByEntity }
}

/** Connected components. Used by layout to place disjoint subgraphs sensibly. */
export function connectedComponents(diagram: Diagram): EntityId[][] {
  const remaining = new Set(diagram.entities.map((entity) => entity.id))
  const components: EntityId[][] = []

  while (remaining.size > 0) {
    const [seed] = remaining
    if (seed === undefined) break

    const component = nHopNeighbourhood(diagram, [seed], Number.POSITIVE_INFINITY)
    const ids = [...component.entityIds]
    for (const id of ids) remaining.delete(id)
    components.push(ids)
  }

  return components
}
