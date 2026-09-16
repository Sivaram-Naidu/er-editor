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

// ─────────────────────────────────────────────────────────────────────────────
// ISOLATE MODE (FR-2.8)
// ─────────────────────────────────────────────────────────────────────────────
//
// "Entities more than N hops away are hidden or heavily dimmed." This tool HIDES them,
// and the choice is about what isolate is for. Dimming already means "off the traced
// path" (FR-4.1), so a second dimmed state would say two different things with one
// treatment — and at a hundred tables dimming saves nothing, while the reason to isolate
// at a hundred tables is that there is too much on screen.
//
// Hiding has one honesty problem, and this is where it is dealt with rather than in the
// renderer: a box at the EDGE of the view keeps connections to entities that are now
// hidden, so it reads as having fewer relationships than it has. `hiddenNeighbours` counts
// them per entity, so the view can say "and three more beyond here" instead of quietly
// lying about the shape of the schema.

export interface Isolation {
  /** Entities to draw: the seeds and everything within `depth` hops. */
  entityIds: ReadonlySet<EntityId>
  /**
   * Relationships to draw — the ones with EVERY end inside the view.
   *
   * Not `Neighbourhood.relationshipIds`, which deliberately includes connectors leading
   * out of the neighbourhood because the hover treatment wants them highlighted. Drawing
   * one of those here would be an edge pointing at a node that is not on the canvas.
   */
  relationshipIds: ReadonlySet<RelationshipId>
  /**
   * How many distinct neighbours each visible entity has that the view is not showing.
   *
   * Absent rather than zero for entities with none, so the common case is a lookup miss
   * and the renderer can fall through to "nothing hidden" without a per-node value that
   * changes identity.
   */
  hiddenNeighbours: ReadonlyMap<EntityId, number>
}

/**
 * What to draw when isolating `seeds` to `depth` hops.
 *
 * An empty `seeds` returns an empty isolation — the caller decides what that means, and
 * the editor treats it as "not isolating anything" rather than as "show nothing", because
 * a blank canvas is not a useful answer to having deselected everything.
 */
export function isolate(diagram: Diagram, seeds: readonly EntityId[], depth: number): Isolation {
  const { entityIds } = nHopNeighbourhood(diagram, seeds, depth)
  const relationshipIds = new Set<RelationshipId>()
  const hidden = new Map<EntityId, Set<EntityId>>()

  for (const entityId of entityIds) {
    for (const relationship of incidentRelationships(diagram, entityId)) {
      const outside = relationship.participants
        .map((participant) => participant.entityId)
        .filter((id) => !entityIds.has(id))

      if (outside.length === 0) {
        relationshipIds.add(relationship.id)
        continue
      }

      // Counted per ENTITY rather than per relationship: two connectors to the same
      // hidden table are one table you cannot see, and "+2" would overstate it.
      let beyond = hidden.get(entityId)
      if (beyond === undefined) {
        beyond = new Set<EntityId>()
        hidden.set(entityId, beyond)
      }
      for (const id of outside) beyond.add(id)
    }
  }

  return {
    entityIds,
    relationshipIds,
    hiddenNeighbours: new Map([...hidden].map(([id, beyond]) => [id, beyond.size])),
  }
}
