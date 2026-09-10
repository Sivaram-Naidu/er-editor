// Add / rename / update / delete entity commands.

import type { Entity, EntityId, EntityKind, Point } from '../model/types'

import { defineCommand, type Command } from './Command'

/**
 * Add an entity, optionally at a known position.
 *
 * `position` is part of THIS command rather than a `moveEntities` alongside it, because
 * an entity and the place it was put are one action to the user: undo should remove the
 * box, not leave it behind at the origin. A transaction would also work, but it would put
 * a coalescing move command in the history for something that never moved.
 *
 * Omitting it leaves the entity unpositioned, which the renderer draws on its fallback
 * grid. That is the right behaviour for a bulk import, where auto-layout follows
 * immediately and any position written here would be overwritten.
 */
export function addEntity(entity: Entity, position?: Point): Command {
  return defineCommand({
    type: 'entity.add',
    label: 'Add entity',
    mutate(draft) {
      draft.entities.push(entity)
      if (position !== undefined) draft.layout.positions[entity.id] = position
    },
  })
}

/**
 * Rename an entity.
 *
 * Coalesces per entity, so typing a name is one undo step rather than one per keystroke,
 * while renaming two entities in quick succession stays two steps.
 */
export function renameEntity(entityId: EntityId, name: string): Command {
  return defineCommand({
    type: 'entity.rename',
    label: 'Rename entity',
    coalesceKey: `entity.rename:${entityId}`,
    mutate(draft) {
      const entity = draft.entities.find((candidate) => candidate.id === entityId)
      if (entity !== undefined) entity.name = name
    },
  })
}

export interface EntityPatch {
  name?: string
  kind?: EntityKind
  comment?: string | null
}

/** `comment: null` clears the field; `undefined` leaves it alone. */
export function updateEntity(entityId: EntityId, patch: EntityPatch): Command {
  return defineCommand({
    type: 'entity.update',
    label: 'Update entity',
    mutate(draft) {
      const entity = draft.entities.find((candidate) => candidate.id === entityId)
      if (entity === undefined) return

      if (patch.name !== undefined) entity.name = patch.name
      if (patch.kind !== undefined) entity.kind = patch.kind
      if (patch.comment === null) delete entity.comment
      else if (patch.comment !== undefined) entity.comment = patch.comment
    },
  })
}

/**
 * Delete an entity and everything that would otherwise dangle (FR-1.7).
 *
 * This is ONE command rather than a transaction of several, because the cleanup is not
 * optional: a diagram left holding a relationship to a deleted entity fails
 * `DiagramSchema`'s referential-integrity check and cannot be saved. Splitting it would
 * make it possible to apply half.
 *
 * Removed alongside the entity:
 *   - every relationship it participates in, at either end
 *   - every foreign key on OTHER entities that points at it or at one of its attributes
 *   - its layout position and pin
 *   - the `parentId` of any ISA subtype that named it as supertype
 *
 * Nothing here is hand-inverted. Immer records what was removed, so undo restores the
 * entity, its relationships and its inbound foreign keys in one step.
 */
export function deleteEntity(entityId: EntityId): Command {
  return defineCommand({
    type: 'entity.delete',
    label: 'Delete entity',
    mutate(draft) {
      const index = draft.entities.findIndex((candidate) => candidate.id === entityId)
      if (index === -1) return

      const removed = draft.entities[index]
      const removedAttributeIds = new Set(removed?.attributes.map((a) => a.id) ?? [])

      draft.entities.splice(index, 1)

      draft.relationships = draft.relationships.filter(
        (relationship) =>
          !relationship.participants.some((participant) => participant.entityId === entityId),
      )

      for (const entity of draft.entities) {
        if (entity.parentId === entityId) delete entity.parentId

        for (const attribute of entity.attributes) {
          const fk = attribute.foreignKey
          if (fk === undefined) continue
          if (fk.entityId === entityId || removedAttributeIds.has(fk.attributeId)) {
            delete attribute.foreignKey
          }
        }
      }

      // Rebuilt rather than `delete`d: `positions` is keyed by a branded id, and a
      // dynamic delete on an index signature is both a lint smell and a deopt on large
      // maps. Immer still records this as a targeted patch set, not a whole-object
      // replace, so undo restores the removed entry alone.
      const { [entityId]: _removedPosition, ...remainingPositions } = draft.layout.positions
      draft.layout.positions = remainingPositions
      draft.layout.pinned = draft.layout.pinned.filter((pinned) => pinned !== entityId)
    },
  })
}

/**
 * Rename the diagram itself.
 *
 * Lives here rather than in a `diagram.commands.ts` of its own because it is currently
 * the only document-level edit; it moves when there is a second.
 *
 * Coalesced like any other rename, so typing a title is one undo step.
 */
export function renameDiagram(name: string): Command {
  return defineCommand({
    type: 'diagram.rename',
    label: 'Rename diagram',
    coalesceKey: 'diagram.rename',
    mutate(draft) {
      // `.min(1)` on the schema means an empty title would make the document unsaveable,
      // so the placeholder stands in until the user types something real.
      draft.name = name === '' ? 'Untitled diagram' : name
    },
  })
}

/** Mark an entity weak or strong (FR-1.9). */
export function setEntityKind(entityId: EntityId, kind: EntityKind): Command {
  return defineCommand({
    type: 'entity.setKind',
    label: kind === 'weak' ? 'Make entity weak' : 'Make entity strong',
    mutate(draft) {
      const entity = draft.entities.find((candidate) => candidate.id === entityId)
      if (entity !== undefined) entity.kind = kind
    },
  })
}
