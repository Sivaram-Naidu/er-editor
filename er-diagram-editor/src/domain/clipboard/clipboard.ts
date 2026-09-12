// Copy, cut, paste and duplicate of entities (FR-7.4).
//
// Pure, like the merge: one function works out what a paste WOULD produce and a command
// installs it. Keeping the planning out of the command is what lets the same answer be
// reused for duplicate — which is a paste that never touches the clipboard — without a
// second implementation drifting away from the first.
//
// THE HAZARD HERE IS THE SAME ONE THE MERGE HAS, arriving by a different route. A copied
// attribute can carry a `foreignKey` pointing at a column OUTSIDE the copied set, and the
// clipboard outlives the diagram it was filled from: FR-7.5 gives the user several
// documents and a switcher, so a paste can land somewhere that has never heard of the
// target. Referential integrity is the one thing the schema enforces, so a reference that
// resolves to nothing does not render oddly — it makes the document refuse to load. Every
// pasted reference is therefore re-pointed inside the pasted set, kept only if it still
// resolves in the destination, and otherwise dropped and counted.

import type {
  Attribute,
  AttributeId,
  Diagram,
  Entity,
  EntityId,
  Point,
  Relationship,
} from '../model'
import { newAttributeId, newEntityId, newRelationshipId } from '../model'

export interface ClipboardPayload {
  readonly entities: readonly Entity[]
  readonly relationships: readonly Relationship[]
  readonly positions: Readonly<Record<EntityId, Point>>
}

export interface PasteResult {
  /** The new entities, ready to append. */
  readonly entities: readonly Entity[]
  readonly relationships: readonly Relationship[]
  readonly positions: Readonly<Record<EntityId, Point>>
  /** So the caller can select what it just pasted, which is what every editor does. */
  readonly newEntityIds: readonly EntityId[]
  /**
   * References that could not be kept, because the column they pointed at is in neither the
   * pasted set nor the destination document. Counted rather than silently dropped: it is
   * real information loss, and it is the normal outcome of pasting into another diagram.
   */
  readonly foreignKeysDropped: number
}

/** How far a pasted copy sits from its original, in diagram units. */
export const PASTE_OFFSET: Point = { x: 48, y: 48 }

/**
 * Take a copy of the selected entities and the relationships that lie WHOLLY inside it.
 *
 * A relationship with one leg outside the selection is deliberately left behind rather than
 * half-copied: the paste would have to either invent an endpoint or point at the original,
 * and both are wrong in a way that is invisible on the canvas.
 */
export function copyEntities(diagram: Diagram, entityIds: ReadonlySet<EntityId>): ClipboardPayload {
  const entities = diagram.entities.filter((entity) => entityIds.has(entity.id))
  const positions: Record<EntityId, Point> = {}
  for (const entity of entities) {
    const point = diagram.layout.positions[entity.id]
    if (point !== undefined) positions[entity.id] = point
  }

  return {
    entities,
    relationships: diagram.relationships.filter((relationship) =>
      relationship.participants.every((participant) => entityIds.has(participant.entityId)),
    ),
    positions,
  }
}

/**
 * `CUSTOMER` → `CUSTOMER_copy`, and `CUSTOMER_copy_2` when that is taken as well.
 *
 * Compared case-insensitively against what is already in the document, so pasting beside an
 * existing `customer_copy` does not produce a second box whose name differs only in case —
 * which reads as a duplicate to everyone except a string comparison.
 */
function uniqueName(name: string, taken: Set<string>): string {
  const base = `${name}_copy`
  if (!taken.has(base.toLowerCase())) return base

  for (let suffix = 2; ; suffix++) {
    const candidate = `${base}_${String(suffix)}`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
}

/**
 * Work out what pasting `payload` into `diagram` produces.
 *
 * Pure and id-minting — the ids it returns are the ones that get installed, so the caller
 * can select them without a second pass to find out what landed.
 */
export function planPaste(
  diagram: Diagram,
  payload: ClipboardPayload,
  offset: Point = PASTE_OFFSET,
): PasteResult {
  const entityIds = new Map<EntityId, EntityId>()
  const attributeIds = new Map<AttributeId, AttributeId>()

  for (const entity of payload.entities) {
    entityIds.set(entity.id, newEntityId())
    for (const attribute of entity.attributes) attributeIds.set(attribute.id, newAttributeId())
  }

  // What the destination already holds, so a re-pointed reference can be checked against it
  // rather than assumed. Both maps are built once; `indexOf` caches on the Diagram OBJECT,
  // which a paste is about to replace anyway.
  const liveEntityIds = new Set(diagram.entities.map((entity) => entity.id))
  const liveAttributeIds = new Set<AttributeId>()
  for (const entity of diagram.entities) {
    for (const attribute of entity.attributes) liveAttributeIds.add(attribute.id)
  }

  const taken = new Set(diagram.entities.map((entity) => entity.name.trim().toLowerCase()))

  let foreignKeysDropped = 0

  const rekey = (attribute: Attribute): Attribute => {
    const id = attributeIds.get(attribute.id) ?? newAttributeId()
    const fk = attribute.foreignKey
    if (fk === undefined) return { ...attribute, id }

    // Inside the copied set, the reference follows the copy. Outside it, the reference is
    // kept pointing at the original only while that original is actually here.
    const target = {
      entityId: entityIds.get(fk.entityId) ?? fk.entityId,
      attributeId: attributeIds.get(fk.attributeId) ?? fk.attributeId,
    }
    const copied = entityIds.has(fk.entityId)
    if (copied || (liveEntityIds.has(target.entityId) && liveAttributeIds.has(target.attributeId))) {
      return { ...attribute, id, foreignKey: target }
    }

    foreignKeysDropped += 1
    const { foreignKey: _dropped, ...rest } = attribute
    return { ...rest, id }
  }

  const entities: Entity[] = []
  const positions: Record<EntityId, Point> = {}

  for (const entity of payload.entities) {
    const id = entityIds.get(entity.id) ?? newEntityId()
    const parentId = entity.parentId

    const pasted: Entity = {
      ...entity,
      id,
      name: uniqueName(entity.name, taken),
      attributes: entity.attributes.map(rekey),
    }
    // Every name it hands out has to be reserved immediately, or copying two tables called
    // the same thing produces two boxes called the same thing.
    taken.add(pasted.name.trim().toLowerCase())

    // A supertype link follows the copy when the parent came too, survives when the parent
    // is here already, and is dropped when it is neither — same rule as a foreign key, and
    // it dangles just as badly.
    const mappedParent = parentId === undefined ? undefined : entityIds.get(parentId)
    const keptParent =
      parentId === undefined
        ? undefined
        : (mappedParent ?? (liveEntityIds.has(parentId) ? parentId : undefined))
    if (keptParent === undefined) delete (pasted as { parentId?: unknown }).parentId
    else (pasted as { parentId?: EntityId }).parentId = keptParent

    // `groupId` is deliberately dropped: groups are not copied, so the id would point at
    // nothing in another document and at a group the user did not choose in this one.
    delete (pasted as { groupId?: unknown }).groupId

    entities.push(pasted)

    const origin = payload.positions[entity.id]
    if (origin !== undefined) positions[id] = { x: origin.x + offset.x, y: origin.y + offset.y }
  }

  const relationships = payload.relationships.map<Relationship>((relationship) => ({
    ...relationship,
    id: newRelationshipId(),
    participants: relationship.participants.map((participant) => ({
      ...participant,
      entityId: entityIds.get(participant.entityId) ?? participant.entityId,
    })),
    attributes: relationship.attributes.map((attribute) => ({
      ...attribute,
      id: newAttributeId(),
    })),
  }))

  return {
    entities,
    relationships,
    positions,
    newEntityIds: entities.map((entity) => entity.id),
    foreignKeysDropped,
  }
}
