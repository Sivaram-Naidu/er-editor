// Create / edit cardinality / delete relationship commands.

import type { Cardinality, Participation, Relationship, RelationshipId } from '../model/types'

import { defineCommand, type Command } from './Command'

export function addRelationship(relationship: Relationship): Command {
  return defineCommand({
    type: 'relationship.add',
    label: 'Add relationship',
    mutate(draft) {
      draft.relationships.push(relationship)
    },
  })
}

export function renameRelationship(relationshipId: RelationshipId, name: string): Command {
  return defineCommand({
    type: 'relationship.rename',
    label: 'Rename relationship',
    coalesceKey: `relationship.rename:${relationshipId}`,
    mutate(draft) {
      const relationship = draft.relationships.find((candidate) => candidate.id === relationshipId)
      if (relationship !== undefined) relationship.name = name
    },
  })
}

export interface ParticipantPatch {
  cardinality?: Cardinality
  participation?: Participation
  /** `null` clears the role. */
  role?: string | null
}

/** Edit one end of a relationship (FR-1.5). `end` is the participant index. */
export function updateParticipant(
  relationshipId: RelationshipId,
  end: number,
  patch: ParticipantPatch,
): Command {
  return defineCommand({
    type: 'relationship.updateParticipant',
    label: 'Change cardinality',
    mutate(draft) {
      const relationship = draft.relationships.find((candidate) => candidate.id === relationshipId)
      const participant = relationship?.participants[end]
      if (participant === undefined) return

      if (patch.cardinality !== undefined) participant.cardinality = patch.cardinality
      if (patch.participation !== undefined) participant.participation = patch.participation

      if (patch.role === null) delete participant.role
      else if (patch.role !== undefined) participant.role = patch.role
    },
  })
}

/** Toggle identifying vs non-identifying — double diamond, solid vs dotted (FR-1.9). */
export function setIdentifying(relationshipId: RelationshipId, isIdentifying: boolean): Command {
  return defineCommand({
    type: 'relationship.setIdentifying',
    label: isIdentifying ? 'Make relationship identifying' : 'Make relationship non-identifying',
    mutate(draft) {
      const relationship = draft.relationships.find((candidate) => candidate.id === relationshipId)
      if (relationship !== undefined) relationship.isIdentifying = isIdentifying
    },
  })
}

/**
 * Delete a relationship.
 *
 * No cascade is needed: nothing in the model refers to a relationship by id, so removing
 * it cannot leave anything dangling. This is why deleting a relationship needs no
 * confirmation while deleting an entity does (FR-1.7).
 */
export function deleteRelationship(relationshipId: RelationshipId): Command {
  return defineCommand({
    type: 'relationship.delete',
    label: 'Delete relationship',
    mutate(draft) {
      const index = draft.relationships.findIndex((candidate) => candidate.id === relationshipId)
      if (index !== -1) draft.relationships.splice(index, 1)
    },
  })
}
