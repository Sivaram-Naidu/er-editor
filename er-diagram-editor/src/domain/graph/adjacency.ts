// neighbours(), incidentRelationships() - model queries, no rendering.

import type { Diagram, Entity, EntityId, Relationship, RelationshipId } from '../model/types'

import { indexOf } from './indexes'

/** Every relationship the entity takes part in, at either end. */
export function incidentRelationships(diagram: Diagram, entityId: EntityId): Relationship[] {
  const index = indexOf(diagram)
  const ids = index.relationshipIdsByEntity.get(entityId) ?? []

  return ids.flatMap((id) => {
    const relationship = index.relationshipById.get(id)
    return relationship === undefined ? [] : [relationship]
  })
}

/**
 * Entities directly connected to the given one.
 *
 * Excludes the entity itself, so a self-referencing relationship (FR-1.12) contributes
 * no neighbours. Callers wanting "everything this relationship touches" should use
 * `relationshipEndpoints`.
 */
export function neighbours(diagram: Diagram, entityId: EntityId): Entity[] {
  const index = indexOf(diagram)
  const found = new Map<EntityId, Entity>()

  for (const relationship of incidentRelationships(diagram, entityId)) {
    for (const participant of relationship.participants) {
      if (participant.entityId === entityId) continue
      const entity = index.entityById.get(participant.entityId)
      if (entity !== undefined) found.set(entity.id, entity)
    }
  }

  return [...found.values()]
}

/** Distinct entities a relationship connects. One entry for a self-join. */
export function relationshipEndpoints(diagram: Diagram, relationshipId: RelationshipId): Entity[] {
  const index = indexOf(diagram)
  const relationship = index.relationshipById.get(relationshipId)
  if (relationship === undefined) return []

  const found = new Map<EntityId, Entity>()
  for (const participant of relationship.participants) {
    const entity = index.entityById.get(participant.entityId)
    if (entity !== undefined) found.set(entity.id, entity)
  }

  return [...found.values()]
}

/** True when the relationship has the same entity at more than one end (FR-1.12). */
export function isRecursive(relationship: Relationship): boolean {
  const ids = new Set(relationship.participants.map((participant) => participant.entityId))
  return ids.size < relationship.participants.length
}

/**
 * The relationship joining two entities, in either direction, if one exists.
 *
 * Used to keep foreign keys and relationships in step: a foreign key says two tables are
 * related, so setting one should not leave the diagram without a line saying so.
 */
export function relationshipBetween(
  diagram: Diagram,
  a: EntityId,
  b: EntityId,
): Relationship | undefined {
  return incidentRelationships(diagram, a).find((relationship) =>
    relationship.participants.some((participant) => participant.entityId === b),
  )
}

/** Entities that take part in no relationship at all — the FR-8.3 orphan warning. */
export function orphanEntities(diagram: Diagram): Entity[] {
  const index = indexOf(diagram)
  return diagram.entities.filter(
    (entity) => (index.relationshipIdsByEntity.get(entity.id) ?? []).length === 0,
  )
}
