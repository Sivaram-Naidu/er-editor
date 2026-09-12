/**
 * @vitest-environment node
 *
 * No DOM here. Spinning up jsdom per file costs about a second each and this suite has
 * nothing to render — the domain layer is deliberately Node-testable (NFR-6.1).
 */
import { beforeEach, describe, expect, it } from 'vitest'

import {
  CommandStack,
  DiagramSchema,
  addAttribute,
  addEntity,
  addRelationship,
  applyLayout,
  createAttribute,
  createDiagram,
  createEntity,
  createRelationship,
  deleteAttribute,
  deleteEntity,
  deleteRelationship,
  moveAttribute,
  setEntityKind,
  setForeignKey,
  setIdentifying,
  setPinned,
  updateAttribute,
  updateEntity,
  updateParticipant,
  type Attribute,
  type Diagram,
  type Entity,
  type Relationship,
} from '../../../src/domain'

/**
 * A small but fully-wired schema: CUSTOMER 1—N ORDER, with ORDER.customer_id carrying a
 * real foreign key to CUSTOMER.id, plus layout state for both.
 *
 * Deliberately not minimal — the cascade cases are only interesting when there is
 * something to cascade INTO.
 */
function fixture(): {
  diagram: Diagram
  customer: Entity
  order: Entity
  customerPk: Attribute
  orderFk: Attribute
  places: Relationship
} {
  const customerPk = createAttribute({ name: 'id', dataType: 'uuid', isPrimaryKey: true })
  const customer = createEntity({ name: 'CUSTOMER', attributes: [customerPk] })

  const orderFk: Attribute = {
    ...createAttribute({ name: 'customer_id', dataType: 'uuid' }),
    foreignKey: { entityId: customer.id, attributeId: customerPk.id },
  }
  const order = createEntity({
    name: 'ORDER',
    attributes: [createAttribute({ name: 'id', isPrimaryKey: true }), orderFk],
  })

  const places = createRelationship({ from: customer.id, to: order.id, name: 'places' })

  const diagram: Diagram = {
    ...createDiagram({ name: 'Shop', entities: [customer, order], relationships: [places] }),
    layout: {
      positions: { [customer.id]: { x: 0, y: 0 }, [order.id]: { x: 200, y: 0 } },
      pinned: [customer.id],
    },
  }

  return { diagram, customer, order, customerPk, orderFk, places }
}

/**
 * The invariant every command must preserve.
 *
 * `DiagramSchema` rejects dangling references, so a cascade that misses something
 * produces a document the user cannot save. Asserting this after every mutation catches
 * that class of bug at the point it is introduced rather than at the export dialog.
 */
function expectSaveable(diagram: Diagram): void {
  const result = DiagramSchema.safeParse(diagram)
  expect(result.error?.issues ?? []).toEqual([])
  expect(result.success).toBe(true)
}

describe('entity commands', () => {
  let stack: CommandStack
  let f: ReturnType<typeof fixture>

  beforeEach(() => {
    f = fixture()
    stack = new CommandStack(f.diagram)
  })

  it('adds an entity', () => {
    stack.execute(addEntity(createEntity({ name: 'PRODUCT' })))

    expect(stack.state.entities.map((entity) => entity.name)).toContain('PRODUCT')
    expectSaveable(stack.state)
  })

  it('adds an entity at a position when given one', () => {
    const product = createEntity({ name: 'PRODUCT' })

    stack.execute(addEntity(product, { x: 420, y: 240 }))

    expect(stack.state.layout.positions[product.id]).toEqual({ x: 420, y: 240 })
    expectSaveable(stack.state)
  })

  it('undoes the entity and its position as one step', () => {
    // The position rides on the add command rather than a `moveEntities` beside it
    // precisely so this holds: one undo removes the box, it does not leave it behind at
    // the origin.
    const product = createEntity({ name: 'PRODUCT' })
    stack.execute(addEntity(product, { x: 420, y: 240 }))

    stack.undo()

    expect(stack.state.entities.map((entity) => entity.name)).not.toContain('PRODUCT')
    expect(stack.state.layout.positions[product.id]).toBeUndefined()
  })

  it('leaves an entity unpositioned when no position is given', () => {
    // Bulk import relies on this: auto-layout runs straight afterwards and would
    // overwrite anything written here.
    const product = createEntity({ name: 'PRODUCT' })

    stack.execute(addEntity(product))

    expect(stack.state.layout.positions[product.id]).toBeUndefined()
  })

  it('renames an entity', () => {
    stack.execute(updateEntity(f.customer.id, { name: 'CLIENT' }))

    expect(stack.state.entities[0]?.name).toBe('CLIENT')
  })

  it('clears a comment with null and leaves it alone with undefined', () => {
    stack.execute(updateEntity(f.customer.id, { comment: 'a note' }))
    expect(stack.state.entities[0]?.comment).toBe('a note')

    stack.execute(updateEntity(f.customer.id, { name: 'CUSTOMER2' }))
    expect(stack.state.entities[0]?.comment).toBe('a note')

    stack.execute(updateEntity(f.customer.id, { comment: null }))
    expect('comment' in (stack.state.entities[0] ?? {})).toBe(false)
  })

  it('marks an entity weak', () => {
    stack.execute(setEntityKind(f.order.id, 'weak'))

    expect(stack.state.entities[1]?.kind).toBe('weak')
    expectSaveable(stack.state)
  })
})

describe('deleteEntity cascade (FR-1.7)', () => {
  let stack: CommandStack
  let f: ReturnType<typeof fixture>

  beforeEach(() => {
    f = fixture()
    stack = new CommandStack(f.diagram)
  })

  it('removes the entity', () => {
    stack.execute(deleteEntity(f.customer.id))

    expect(stack.state.entities.map((entity) => entity.name)).toEqual(['ORDER'])
  })

  it('removes relationships that referenced it', () => {
    stack.execute(deleteEntity(f.customer.id))

    expect(stack.state.relationships).toHaveLength(0)
  })

  it('clears foreign keys on other entities that pointed at it', () => {
    stack.execute(deleteEntity(f.customer.id))

    const survivingOrder = stack.state.entities[0]
    const fk = survivingOrder?.attributes.find((a) => a.name === 'customer_id')

    expect(fk).toBeDefined()
    expect('foreignKey' in (fk ?? {})).toBe(false)
  })

  it('removes its layout position and pin', () => {
    stack.execute(deleteEntity(f.customer.id))

    expect(stack.state.layout.positions[f.customer.id]).toBeUndefined()
    expect(stack.state.layout.pinned).not.toContain(f.customer.id)
  })

  it('clears parentId on any ISA subtype that named it', () => {
    const child: Entity = { ...createEntity({ name: 'VIP' }), parentId: f.customer.id }
    const withChild = new CommandStack({ ...f.diagram, entities: [...f.diagram.entities, child] })

    withChild.execute(deleteEntity(f.customer.id))
    const survivingChild = withChild.state.entities.find((entity) => entity.name === 'VIP')

    expect(survivingChild && 'parentId' in survivingChild).toBe(false)
    expectSaveable(withChild.state)
  })

  it('leaves the diagram saveable', () => {
    // The single most important assertion in this file: a missed cascade produces a
    // document that parses today and fails at save time.
    stack.execute(deleteEntity(f.customer.id))

    expectSaveable(stack.state)
  })

  it('undoes as ONE step, restoring entity, relationship, foreign key, position and pin', () => {
    const before = stack.state
    stack.execute(deleteEntity(f.customer.id))

    expect(stack.depth).toBe(1)
    stack.undo()

    expect(stack.state).toEqual(before)
  })

  it('is a no-op for an unknown entity', () => {
    stack.execute(deleteEntity(createEntity().id))

    expect(stack.depth).toBe(0)
  })

  it('removes both ends of a recursive relationship (FR-1.12)', () => {
    const employee = createEntity({ name: 'EMPLOYEE' })
    const reportsTo = createRelationship({
      from: employee.id,
      to: employee.id,
      name: 'reports to',
    })
    const recursive = new CommandStack(
      createDiagram({ entities: [employee], relationships: [reportsTo] }),
    )

    recursive.execute(deleteEntity(employee.id))

    expect(recursive.state.relationships).toHaveLength(0)
    expectSaveable(recursive.state)
  })
})

describe('attribute commands', () => {
  let stack: CommandStack
  let f: ReturnType<typeof fixture>

  beforeEach(() => {
    f = fixture()
    stack = new CommandStack(f.diagram)
  })

  it('adds an attribute to the right entity', () => {
    stack.execute(addAttribute(f.customer.id, createAttribute({ name: 'email' })))

    expect(stack.state.entities[0]?.attributes.map((a) => a.name)).toEqual(['id', 'email'])
    expectSaveable(stack.state)
  })

  it('updates flags', () => {
    stack.execute(updateAttribute(f.order.id, f.orderFk.id, { isNullable: false }))

    const attribute = stack.state.entities[1]?.attributes.find((a) => a.id === f.orderFk.id)
    expect(attribute?.isNullable).toBe(false)
  })

  it('clears dataType with null', () => {
    stack.execute(updateAttribute(f.customer.id, f.customerPk.id, { dataType: null }))

    const attribute = stack.state.entities[0]?.attributes[0]
    expect(attribute && 'dataType' in attribute).toBe(false)
  })

  it('deleting a referenced attribute clears the foreign key pointing at it', () => {
    stack.execute(deleteAttribute(f.customer.id, f.customerPk.id))

    const fk = stack.state.entities[1]?.attributes.find((a) => a.id === f.orderFk.id)
    expect(fk && 'foreignKey' in fk).toBe(false)
    expectSaveable(stack.state)
  })

  it('reorders attributes', () => {
    stack.execute(moveAttribute(f.order.id, 0, 1))

    expect(stack.state.entities[1]?.attributes.map((a) => a.name)).toEqual(['customer_id', 'id'])
  })

  it('ignores an out-of-range reorder', () => {
    stack.execute(moveAttribute(f.order.id, 0, 99))

    expect(stack.depth).toBe(0)
  })

  it('sets and clears a foreign key', () => {
    const email = createAttribute({ name: 'email' })
    stack.execute(addAttribute(f.customer.id, email))
    stack.execute(
      setForeignKey(f.order.id, f.orderFk.id, {
        entityId: f.customer.id,
        attributeId: email.id,
      }),
    )

    expect(stack.state.entities[1]?.attributes[1]?.foreignKey?.attributeId).toBe(email.id)
    expectSaveable(stack.state)

    stack.execute(setForeignKey(f.order.id, f.orderFk.id, null))
    expect(stack.state.entities[1]?.attributes[1]?.foreignKey).toBeUndefined()
  })
})

describe('relationship commands', () => {
  let stack: CommandStack
  let f: ReturnType<typeof fixture>

  beforeEach(() => {
    f = fixture()
    stack = new CommandStack(f.diagram)
  })

  it('adds a relationship', () => {
    const product = createEntity({ name: 'PRODUCT' })
    stack.execute(addEntity(product))
    stack.execute(addRelationship(createRelationship({ from: f.order.id, to: product.id })))

    expect(stack.state.relationships).toHaveLength(2)
    expectSaveable(stack.state)
  })

  it('changes cardinality on one end only', () => {
    stack.execute(updateParticipant(f.places.id, 1, { cardinality: 'one' }))

    const participants = stack.state.relationships[0]?.participants
    expect(participants?.map((p) => p.cardinality)).toEqual(['one', 'one'])
  })

  it('toggles identifying', () => {
    stack.execute(setIdentifying(f.places.id, true))

    expect(stack.state.relationships[0]?.isIdentifying).toBe(true)
  })

  it('deleting a relationship needs no cascade and leaves entities intact', () => {
    stack.execute(deleteRelationship(f.places.id))

    expect(stack.state.relationships).toHaveLength(0)
    expect(stack.state.entities).toHaveLength(2)
    expectSaveable(stack.state)
  })
})

describe('layout commands', () => {
  let stack: CommandStack
  let f: ReturnType<typeof fixture>

  beforeEach(() => {
    f = fixture()
    stack = new CommandStack(f.diagram)
  })

  it('applyLayout replaces positions as one step', () => {
    stack.execute(
      applyLayout({ [f.customer.id]: { x: 10, y: 10 }, [f.order.id]: { x: 20, y: 20 } }),
    )

    expect(stack.state.layout.positions[f.customer.id]).toEqual({ x: 10, y: 10 })
    expect(stack.depth).toBe(1)
  })

  it('applyLayout leaves untouched entities where they were (FR-3.7)', () => {
    stack.execute(applyLayout({ [f.customer.id]: { x: 99, y: 99 } }))

    expect(stack.state.layout.positions[f.order.id]).toEqual({ x: 200, y: 0 })
  })

  it('two auto-layouts are two undo steps', () => {
    stack.execute(applyLayout({ [f.customer.id]: { x: 1, y: 1 } }))
    stack.execute(applyLayout({ [f.customer.id]: { x: 2, y: 2 } }))

    expect(stack.depth).toBe(2)
  })

  it('pins and unpins', () => {
    stack.execute(setPinned(f.order.id, true))
    expect(stack.state.layout.pinned).toContain(f.order.id)

    stack.execute(setPinned(f.order.id, false))
    expect(stack.state.layout.pinned).not.toContain(f.order.id)
  })

  it('pinning an already-pinned entity records nothing', () => {
    stack.execute(setPinned(f.customer.id, true))

    expect(stack.depth).toBe(0)
  })
})

describe('every command leaves the diagram saveable', () => {
  it('after a long mixed sequence, and after undoing all of it', () => {
    const f = fixture()
    const stack = new CommandStack(f.diagram)
    const product = createEntity({ name: 'PRODUCT' })
    const sku = createAttribute({ name: 'sku', isPrimaryKey: true })

    stack.execute(addEntity(product))
    stack.execute(addAttribute(product.id, sku))
    stack.execute(addRelationship(createRelationship({ from: product.id, to: f.order.id })))
    stack.execute(setEntityKind(f.order.id, 'weak'))
    stack.execute(setIdentifying(f.places.id, true))
    stack.execute(applyLayout({ [product.id]: { x: 400, y: 0 } }))
    stack.execute(deleteAttribute(f.customer.id, f.customerPk.id))
    stack.execute(deleteEntity(product.id))
    expectSaveable(stack.state)

    while (stack.canUndo) stack.undo()

    expect(stack.state).toEqual(f.diagram)
    expectSaveable(stack.state)
  })
})
