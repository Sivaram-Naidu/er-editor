/**
 * @vitest-environment node
 *
 * No DOM here. Spinning up jsdom per file costs about a second each and this suite has
 * nothing to render — the domain layer is deliberately Node-testable (NFR-6.1).
 */
import { describe, expect, it } from 'vitest'

import {
  CommandStack,
  createAttribute,
  createDiagram,
  createEntity,
  type Diagram,
} from '../../../src/domain'
import { buildConnectCommands as connect } from '../../../src/features/editor'

/**
 * Drag-to-connect (FR-1.4).
 *
 * Exercises the real `buildConnectCommands`, not a copy of it — an earlier version of
 * this file reimplemented the logic, which meant a change in the editor would not have
 * failed anything here.
 *
 * The pointer drag that calls it is covered by tests/e2e: React Flow's connection
 * handling is geometry and pointer capture, which jsdom cannot reproduce.
 */
function fixture(): {
  diagram: Diagram
  customer: ReturnType<typeof createEntity>
  order: ReturnType<typeof createEntity>
} {
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

describe('drag from a box edge', () => {
  it('creates one relationship', () => {
    const f = fixture()
    const stack = new CommandStack(f.diagram)

    stack.transaction('Add relationship', connect(f.diagram, f.order.id, f.customer.id, undefined))

    expect(stack.state.relationships).toHaveLength(1)
  })

  it('points the relationship from the target to the source, so the drag reads parent → child', () => {
    // Dragging ORDER → CUSTOMER means "ORDER belongs to CUSTOMER", so CUSTOMER is the
    // one end. Reversing this would give every drag a backwards crow's foot.
    const f = fixture()
    const stack = new CommandStack(f.diagram)

    stack.transaction('Add relationship', connect(f.diagram, f.order.id, f.customer.id, undefined))
    const [from, to] = stack.state.relationships[0]!.participants

    expect(from?.entityId).toBe(f.customer.id)
    expect(from?.cardinality).toBe('one')
    expect(to?.entityId).toBe(f.order.id)
    expect(to?.cardinality).toBe('many')
  })

  it('sets no foreign key, because no field was named', () => {
    const f = fixture()
    const stack = new CommandStack(f.diagram)

    stack.transaction('Add relationship', connect(f.diagram, f.order.id, f.customer.id, undefined))
    const orderFields = stack.state.entities[1]?.attributes

    expect(orderFields?.[0]?.foreignKey).toBeUndefined()
  })
})

describe('drag from a field row', () => {
  it('wires the foreign key to the target key as well', () => {
    // Dragging ORDER.customer_id onto CUSTOMER means exactly one thing; making the user
    // then set the reference by hand would be asking them to say it twice.
    const f = fixture()
    const fk = f.order.attributes[0]!
    const stack = new CommandStack(f.diagram)

    stack.transaction('Add relationship', connect(f.diagram, f.order.id, f.customer.id, fk.id))

    expect(stack.state.entities[1]?.attributes[0]?.foreignKey).toEqual({
      entityId: f.customer.id,
      attributeId: f.customer.attributes[0]!.id,
    })
  })

  it('is a single undo step for both the line and the key', () => {
    const f = fixture()
    const fk = f.order.attributes[0]!
    const stack = new CommandStack(f.diagram)

    stack.transaction('Add relationship', connect(f.diagram, f.order.id, f.customer.id, fk.id))
    expect(stack.depth).toBe(1)

    stack.undo()
    expect(stack.state).toEqual(f.diagram)
  })

  it('skips the foreign key when the target has no key to reference', () => {
    // FR-1.11 restricts references to key attributes; inventing one here would produce a
    // diagram that exports to SQL the database rejects.
    const keyless = createEntity({ name: 'NOTES', attributes: [createAttribute({ name: 'body' })] })
    const source = createEntity({ name: 'A', attributes: [createAttribute({ name: 'ref' })] })
    const diagram = createDiagram({ entities: [keyless, source] })
    const stack = new CommandStack(diagram)

    stack.transaction(
      'Add relationship',
      connect(diagram, source.id, keyless.id, source.attributes[0]!.id),
    )

    expect(stack.state.relationships).toHaveLength(1)
    expect(stack.state.entities[1]?.attributes[0]?.foreignKey).toBeUndefined()
  })

  it('does not wire a self-referencing field to its own entity', () => {
    // A self-join is legitimate (FR-1.12), but pointing a field at a key on the same
    // table is not what the user meant by dragging the box onto itself.
    const employee = createEntity({
      name: 'EMPLOYEE',
      attributes: [
        createAttribute({ name: 'id', isPrimaryKey: true }),
        createAttribute({ name: 'manager_id' }),
      ],
    })
    const diagram = createDiagram({ entities: [employee] })
    const stack = new CommandStack(diagram)

    stack.transaction(
      'Add relationship',
      connect(diagram, employee.id, employee.id, employee.attributes[1]!.id),
    )

    expect(stack.state.relationships).toHaveLength(1)
    expect(stack.state.entities[0]?.attributes[1]?.foreignKey).toBeUndefined()
  })

  it('leaves the diagram saveable', () => {
    const f = fixture()
    const fk = f.order.attributes[0]!
    const stack = new CommandStack(f.diagram)

    stack.transaction('Add relationship', connect(f.diagram, f.order.id, f.customer.id, fk.id))

    expect(stack.state.relationships[0]?.participants).toHaveLength(2)
    expect(stack.state.entities[1]?.attributes[0]?.foreignKey?.entityId).toBe(f.customer.id)
  })
})
