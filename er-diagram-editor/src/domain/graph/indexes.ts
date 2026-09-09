// id -> element maps kept in sync for O(1) lookup.
//
// The index is derived, never stored. It is cached in a WeakMap keyed by the Diagram
// object itself, which is sound because every mutation goes through the command stack
// and produces a NEW frozen Diagram (Immer). A stale index is therefore unreachable:
// the only way to get the cached value is to hold the exact object it was built from.
//
// That removes the usual "keep the index in sync" problem entirely — there is nothing
// to invalidate, and no code path that can observe an index that disagrees with its
// diagram.

import type {
  Attribute,
  AttributeId,
  Diagram,
  Entity,
  EntityId,
  Relationship,
  RelationshipId,
} from '../model/types'

export interface AttributeLocation {
  attribute: Attribute
  entityId: EntityId
}

export interface DiagramIndex {
  entityById: ReadonlyMap<EntityId, Entity>
  relationshipById: ReadonlyMap<RelationshipId, Relationship>
  /** Top-level attributes only; composite children are not separately indexed. */
  attributeById: ReadonlyMap<AttributeId, AttributeLocation>
  /** Every relationship each entity participates in, including both ends of a self-join. */
  relationshipIdsByEntity: ReadonlyMap<EntityId, readonly RelationshipId[]>
}

const cache = new WeakMap<Diagram, DiagramIndex>()

function build(diagram: Diagram): DiagramIndex {
  const entityById = new Map<EntityId, Entity>()
  const attributeById = new Map<AttributeId, AttributeLocation>()
  const relationshipById = new Map<RelationshipId, Relationship>()
  const relationshipIdsByEntity = new Map<EntityId, RelationshipId[]>()

  for (const entity of diagram.entities) {
    entityById.set(entity.id, entity)
    relationshipIdsByEntity.set(entity.id, [])
    for (const attribute of entity.attributes) {
      attributeById.set(attribute.id, { attribute, entityId: entity.id })
    }
  }

  for (const relationship of diagram.relationships) {
    relationshipById.set(relationship.id, relationship)

    // A self-referencing relationship (FR-1.12) names the same entity twice; it should
    // appear once in that entity's incident list, not twice.
    const seen = new Set<EntityId>()
    for (const participant of relationship.participants) {
      if (seen.has(participant.entityId)) continue
      seen.add(participant.entityId)
      relationshipIdsByEntity.get(participant.entityId)?.push(relationship.id)
    }
  }

  return { entityById, relationshipById, attributeById, relationshipIdsByEntity }
}

/** Build (or reuse) the lookup index for a diagram. O(n) on first call, O(1) after. */
export function indexOf(diagram: Diagram): DiagramIndex {
  const cached = cache.get(diagram)
  if (cached !== undefined) return cached

  const built = build(diagram)
  cache.set(diagram, built)
  return built
}

export function findEntity(diagram: Diagram, id: EntityId): Entity | undefined {
  return indexOf(diagram).entityById.get(id)
}

export function findRelationship(diagram: Diagram, id: RelationshipId): Relationship | undefined {
  return indexOf(diagram).relationshipById.get(id)
}

export function findAttribute(diagram: Diagram, id: AttributeId): AttributeLocation | undefined {
  return indexOf(diagram).attributeById.get(id)
}
