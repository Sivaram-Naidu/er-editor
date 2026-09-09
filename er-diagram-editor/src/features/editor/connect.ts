// Commands produced by dragging one table onto another (FR-1.4).
//
// Kept out of the component so the gesture's meaning is testable without simulating a
// pointer drag — React Flow's connection handling is geometry and pointer capture, which
// jsdom cannot reproduce. The drag itself belongs in tests/e2e; what it MEANS belongs
// here.

import {
  addRelationship,
  createRelationship,
  setForeignKey,
  type AttributeId,
  type Command,
  type Diagram,
  type EntityId,
} from '../../domain'

/**
 * @param source entity the drag started from
 * @param target entity the drag ended on
 * @param sourceAttributeId set when the drag began on a specific field row
 */
export function buildConnectCommands(
  diagram: Diagram,
  source: EntityId,
  target: EntityId,
  sourceAttributeId: AttributeId | undefined,
): Command[] {
  // The drag reads child → parent: dragging ORDER onto CUSTOMER means "ORDER belongs to
  // CUSTOMER". So the target is the `one` end. Reversing this would give every dragged
  // relationship a backwards crow's foot.
  const commands: Command[] = [addRelationship(createRelationship({ from: target, to: source }))]

  const targetEntity = diagram.entities.find((entity) => entity.id === target)
  const targetKey = targetEntity?.attributes.find(
    (attribute) => attribute.isPrimaryKey || attribute.isUnique,
  )

  // Dragging ORDER.customer_id onto CUSTOMER means exactly one thing; making the user
  // then set the reference by hand would be asking them to say it twice.
  //
  // Skipped when the target has no key to reference — FR-1.11 restricts references to
  // key attributes, and inventing one would produce a diagram that exports to SQL the
  // database rejects. Skipped on a self-join too: pointing a field at a key on its own
  // table is not what dragging a box onto itself meant.
  if (sourceAttributeId !== undefined && targetKey !== undefined && source !== target) {
    commands.push(
      setForeignKey(source, sourceAttributeId, { entityId: target, attributeId: targetKey.id }),
    )
  }

  return commands
}
