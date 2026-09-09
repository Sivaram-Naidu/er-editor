// Add / edit / reorder / delete attribute commands.

import type { Attribute, AttributeId, EntityId, ForeignKeyRef } from '../model/types'

import { defineCommand, type Command } from './Command'

export function addAttribute(entityId: EntityId, attribute: Attribute): Command {
  return defineCommand({
    type: 'attribute.add',
    label: 'Add attribute',
    mutate(draft) {
      const entity = draft.entities.find((candidate) => candidate.id === entityId)
      entity?.attributes.push(attribute)
    },
  })
}

export function renameAttribute(
  entityId: EntityId,
  attributeId: AttributeId,
  name: string,
): Command {
  return defineCommand({
    type: 'attribute.rename',
    label: 'Rename attribute',
    coalesceKey: `attribute.rename:${attributeId}`,
    mutate(draft) {
      const entity = draft.entities.find((candidate) => candidate.id === entityId)
      const attribute = entity?.attributes.find((candidate) => candidate.id === attributeId)
      if (attribute !== undefined) attribute.name = name
    },
  })
}

export interface AttributePatch {
  name?: string
  /** `null` clears the field. */
  dataType?: string | null
  comment?: string | null
  defaultValue?: string | null
  isPrimaryKey?: boolean
  isUnique?: boolean
  isNullable?: boolean
  isDerived?: boolean
  isMultivalued?: boolean
}

export function updateAttribute(
  entityId: EntityId,
  attributeId: AttributeId,
  patch: AttributePatch,
): Command {
  return defineCommand({
    type: 'attribute.update',
    label: 'Update attribute',
    mutate(draft) {
      const entity = draft.entities.find((candidate) => candidate.id === entityId)
      const attribute = entity?.attributes.find((candidate) => candidate.id === attributeId)
      if (attribute === undefined) return

      if (patch.name !== undefined) attribute.name = patch.name
      if (patch.isPrimaryKey !== undefined) attribute.isPrimaryKey = patch.isPrimaryKey
      if (patch.isUnique !== undefined) attribute.isUnique = patch.isUnique
      if (patch.isNullable !== undefined) attribute.isNullable = patch.isNullable
      if (patch.isDerived !== undefined) attribute.isDerived = patch.isDerived
      if (patch.isMultivalued !== undefined) attribute.isMultivalued = patch.isMultivalued

      if (patch.dataType === null) delete attribute.dataType
      else if (patch.dataType !== undefined) attribute.dataType = patch.dataType

      if (patch.comment === null) delete attribute.comment
      else if (patch.comment !== undefined) attribute.comment = patch.comment

      if (patch.defaultValue === null) delete attribute.defaultValue
      else if (patch.defaultValue !== undefined) attribute.defaultValue = patch.defaultValue
    },
  })
}

/**
 * Delete an attribute, clearing any foreign key elsewhere that referenced it.
 *
 * Same reasoning as `deleteEntity`: a dangling `foreignKey.attributeId` fails the
 * schema's referential check, so the cleanup belongs inside the same command.
 */
export function deleteAttribute(entityId: EntityId, attributeId: AttributeId): Command {
  return defineCommand({
    type: 'attribute.delete',
    label: 'Delete attribute',
    mutate(draft) {
      const entity = draft.entities.find((candidate) => candidate.id === entityId)
      if (entity === undefined) return

      const index = entity.attributes.findIndex((candidate) => candidate.id === attributeId)
      if (index === -1) return

      entity.attributes.splice(index, 1)

      for (const other of draft.entities) {
        for (const attribute of other.attributes) {
          if (attribute.foreignKey?.attributeId === attributeId) delete attribute.foreignKey
        }
      }
    },
  })
}

/** Reorder within an entity. Attribute order is user-meaningful, so it is persisted. */
export function moveAttribute(entityId: EntityId, fromIndex: number, toIndex: number): Command {
  return defineCommand({
    type: 'attribute.move',
    label: 'Reorder attribute',
    mutate(draft) {
      const entity = draft.entities.find((candidate) => candidate.id === entityId)
      if (entity === undefined) return

      const { attributes } = entity
      if (fromIndex < 0 || fromIndex >= attributes.length) return
      if (toIndex < 0 || toIndex >= attributes.length) return

      const [moved] = attributes.splice(fromIndex, 1)
      if (moved !== undefined) attributes.splice(toIndex, 0, moved)
    },
  })
}

/** Point an attribute at a key on another entity (FR-1.11). `null` clears it. */
export function setForeignKey(
  entityId: EntityId,
  attributeId: AttributeId,
  target: ForeignKeyRef | null,
): Command {
  return defineCommand({
    type: 'attribute.setForeignKey',
    label: target === null ? 'Clear foreign key' : 'Set foreign key',
    mutate(draft) {
      const entity = draft.entities.find((candidate) => candidate.id === entityId)
      const attribute = entity?.attributes.find((candidate) => candidate.id === attributeId)
      if (attribute === undefined) return

      if (target === null) delete attribute.foreignKey
      else attribute.foreignKey = target
    },
  })
}
