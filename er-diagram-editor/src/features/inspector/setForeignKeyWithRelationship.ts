// Setting a foreign key implies a relationship — keep the two in step.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE BUG THIS FIXES
// ─────────────────────────────────────────────────────────────────────────────
//
// `foreignKey` and `Relationship` are separate things in the IR, and they should be:
// a relationship can exist before anyone has decided which column carries it, and a
// many-to-many has no foreign key on either side.
//
// But the two entry points disagreed. Dragging a field row onto another table created
// both. Setting "References" in the inspector created only the foreign key, so the
// entity showed an FK badge with no line running anywhere — the diagram claimed a
// reference it did not draw.
//
// The rule below makes them agree in the direction that is always safe: a foreign key
// asserts that two tables are related, so if nothing already says so, say it.
//
// Deliberately NOT symmetric. Clearing a foreign key does not delete the relationship,
// and deleting a relationship does not clear foreign keys — in both directions the
// remaining fact is still true, and silently discarding a user's work to enforce tidiness
// is worse than a diagram that is merely less specific than it could be.

import {
  addRelationship,
  createRelationship,
  relationshipBetween,
  setForeignKey,
  type AttributeId,
  type Command,
  type Diagram,
  type EntityId,
  type ForeignKeyRef,
} from '../../domain'

export interface SetForeignKeyResult {
  commands: Command[]
  /** True when a relationship was created alongside the key, so the UI can say so. */
  createdRelationship: boolean
}

export function setForeignKeyWithRelationship(
  diagram: Diagram,
  entityId: EntityId,
  attributeId: AttributeId,
  target: ForeignKeyRef | null,
): SetForeignKeyResult {
  const commands: Command[] = [setForeignKey(entityId, attributeId, target)]

  if (target === null || target.entityId === entityId) {
    return { commands, createdRelationship: false }
  }

  if (relationshipBetween(diagram, entityId, target.entityId) !== undefined) {
    return { commands, createdRelationship: false }
  }

  // The referenced table is the `one` end: a foreign key points at exactly one parent
  // row, and many child rows may point at it.
  commands.push(addRelationship(createRelationship({ from: target.entityId, to: entityId })))

  return { commands, createdRelationship: true }
}
