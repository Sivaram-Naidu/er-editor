/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'

import {
  CommandStack,
  createAttribute,
  createDiagram,
  createEntity,
  createRelationship,
  relationshipBetween,
  type Diagram,
  type Entity,
} from '../../../src/domain'
import { setForeignKeyWithRelationship } from '../../../src/features/inspector'

/**
 * A foreign key set from the inspector must also draw the relationship.
 *
 * The bug this pins: dragging a field row onto another table created both, while setting
 * "References" in the panel created only the key — leaving an FK badge with no line
 * running anywhere. Two entry points, two different outcomes, from the same intent.
 */
function fixture(): { diagram: Diagram; customer: Entity; order: Entity } {
  const customer = createEntity({
    name: 'CUSTOMER',
    attributes: [createAttribute({ name: 'id', dataType: 'uuid', isPrimaryKey: true })],
  })
  const order = createEntity({
    name: 'ORDER',
    attributes: [createAttribute({ name: 'customer_id', dataType: 'uuid' })],
  })
  return { diagram: createDiagram({ entities: [customer, order] }), customer, order }
}

describe('setForeignKeyWithRelationship', () => {
  it('creates the relationship when none exists', () => {
    const f = fixture()
    const stack = new CommandStack(f.diagram)
    const { commands, createdRelationship } = setForeignKeyWithRelationship(
      f.diagram,
      f.order.id,
      f.order.attributes[0]!.id,
      { entityId: f.customer.id, attributeId: f.customer.attributes[0]!.id },
    )

    stack.transaction('Set reference', commands)

    expect(createdRelationship).toBe(true)
    expect(stack.state.relationships).toHaveLength(1)
    expect(stack.state.entities[1]?.attributes[0]?.foreignKey?.entityId).toBe(f.customer.id)
  })

  it('makes the referenced table the "one" end', () => {
    // A foreign key points at exactly one parent row; many children may point at it.
    const f = fixture()
    const stack = new CommandStack(f.diagram)
    stack.transaction(
      'Set reference',
      setForeignKeyWithRelationship(f.diagram, f.order.id, f.order.attributes[0]!.id, {
        entityId: f.customer.id,
        attributeId: f.customer.attributes[0]!.id,
      }).commands,
    )

    const [from, to] = stack.state.relationships[0]!.participants
    expect(from?.entityId).toBe(f.customer.id)
    expect(from?.cardinality).toBe('one')
    expect(to?.cardinality).toBe('many')
  })

  it('is one undo step for both the key and the line', () => {
    const f = fixture()
    const stack = new CommandStack(f.diagram)
    stack.transaction(
      'Set reference',
      setForeignKeyWithRelationship(f.diagram, f.order.id, f.order.attributes[0]!.id, {
        entityId: f.customer.id,
        attributeId: f.customer.attributes[0]!.id,
      }).commands,
    )

    expect(stack.depth).toBe(1)
    stack.undo()
    expect(stack.state).toEqual(f.diagram)
  })

  it('does not duplicate an existing relationship', () => {
    const f = fixture()
    const existing = createRelationship({ from: f.customer.id, to: f.order.id, name: 'places' })
    const diagram: Diagram = { ...f.diagram, relationships: [existing] }
    const stack = new CommandStack(diagram)

    const { createdRelationship } = setForeignKeyWithRelationship(
      diagram,
      f.order.id,
      f.order.attributes[0]!.id,
      { entityId: f.customer.id, attributeId: f.customer.attributes[0]!.id },
    )
    stack.transaction(
      'Set reference',
      setForeignKeyWithRelationship(diagram, f.order.id, f.order.attributes[0]!.id, {
        entityId: f.customer.id,
        attributeId: f.customer.attributes[0]!.id,
      }).commands,
    )

    expect(createdRelationship).toBe(false)
    expect(stack.state.relationships).toHaveLength(1)
  })

  it('matches an existing relationship regardless of its direction', () => {
    // ORDER → CUSTOMER already relates them; adding a key the other way round must not
    // draw a second line between the same pair.
    const f = fixture()
    const reversed = createRelationship({ from: f.order.id, to: f.customer.id })
    const diagram: Diagram = { ...f.diagram, relationships: [reversed] }

    expect(
      setForeignKeyWithRelationship(diagram, f.order.id, f.order.attributes[0]!.id, {
        entityId: f.customer.id,
        attributeId: f.customer.attributes[0]!.id,
      }).createdRelationship,
    ).toBe(false)
  })

  it('clearing a key leaves the relationship alone', () => {
    // Asymmetric on purpose: the tables are still related even once the column carrying
    // it is gone. Silently deleting the user's line to enforce tidiness is worse.
    const f = fixture()
    const existing = createRelationship({ from: f.customer.id, to: f.order.id })
    const diagram: Diagram = { ...f.diagram, relationships: [existing] }
    const stack = new CommandStack(diagram)

    stack.transaction(
      'Set reference',
      setForeignKeyWithRelationship(diagram, f.order.id, f.order.attributes[0]!.id, null).commands,
    )

    expect(stack.state.relationships).toHaveLength(1)
  })

  it('draws nothing for a self-reference', () => {
    const employee = createEntity({
      name: 'EMPLOYEE',
      attributes: [
        createAttribute({ name: 'id', isPrimaryKey: true }),
        createAttribute({ name: 'manager_id' }),
      ],
    })
    const diagram = createDiagram({ entities: [employee] })

    const { createdRelationship } = setForeignKeyWithRelationship(
      diagram,
      employee.id,
      employee.attributes[1]!.id,
      { entityId: employee.id, attributeId: employee.attributes[0]!.id },
    )

    expect(createdRelationship).toBe(false)
  })
})

describe('relationshipBetween', () => {
  it('finds a relationship in either direction', () => {
    const f = fixture()
    const relationship = createRelationship({ from: f.customer.id, to: f.order.id })
    const diagram: Diagram = { ...f.diagram, relationships: [relationship] }

    expect(relationshipBetween(diagram, f.customer.id, f.order.id)?.id).toBe(relationship.id)
    expect(relationshipBetween(diagram, f.order.id, f.customer.id)?.id).toBe(relationship.id)
  })

  it('returns nothing for unrelated entities', () => {
    const f = fixture()

    expect(relationshipBetween(f.diagram, f.customer.id, f.order.id)).toBeUndefined()
  })
})
