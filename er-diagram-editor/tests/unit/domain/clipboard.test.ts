/**
 * @vitest-environment node
 *
 * Copy / cut / paste / duplicate (FR-7.4).
 *
 * The interesting half is not "does a second box appear" — it is what happens to the
 * REFERENCES. A copied column can carry a foreign key pointing outside the copied set, and
 * the clipboard outlives the document it was filled from, so a paste can land somewhere
 * that has never heard of the target. Referential integrity is the one thing the schema
 * enforces, so a reference that resolves to nothing does not render oddly — it makes the
 * document refuse to load. Every test here ends by parsing the result for that reason.
 */
import { describe, expect, it } from 'vitest'

import {
  applyLayout,
  CommandStack,
  copyEntities,
  createAttribute,
  createDiagram,
  createEntity,
  createRelationship,
  DiagramSchema,
  PASTE_OFFSET,
  pasteEntities,
  planPaste,
  setForeignKey,
  type Diagram,
  type Entity,
  type EntityId,
  type PasteResult,
} from '../../../src/domain'

function attribute(name: string, isPrimaryKey = false) {
  return createAttribute({ name, isPrimaryKey, dataType: isPrimaryKey ? 'uuid' : 'text' })
}

/** CUSTOMER ← ORDER, and a NOTE that references ORDER from outside any copy of the pair. */
function schema(): Diagram {
  const customer = createEntity({
    name: 'CUSTOMER',
    attributes: [attribute('id', true), attribute('email')],
  })
  const order = createEntity({
    name: 'ORDER',
    attributes: [attribute('id', true), attribute('customer_id')],
  })
  const note = createEntity({
    name: 'NOTE',
    attributes: [attribute('id', true), attribute('order_ref')],
  })

  const diagram = createDiagram({
    entities: [customer, order, note],
    relationships: [createRelationship({ from: customer.id, to: order.id, name: 'places' })],
  })

  const stack = new CommandStack(diagram)
  stack.execute(
    applyLayout({
      [customer.id]: { x: 0, y: 0 },
      [order.id]: { x: 400, y: 0 },
      [note.id]: { x: 800, y: 0 },
    }),
  )
  stack.execute(
    setForeignKey(order.id, order.attributes[1]!.id, {
      entityId: customer.id,
      attributeId: customer.attributes[0]!.id,
    }),
  )
  return stack.execute(
    setForeignKey(note.id, note.attributes[1]!.id, {
      entityId: order.id,
      attributeId: order.attributes[0]!.id,
    }),
  )
}

const named = (diagram: Diagram, name: string): Entity => {
  const found = diagram.entities.find((entity) => entity.name === name)
  if (found === undefined) throw new Error(`no entity named ${name}`)
  return found
}

/** Install a paste and parse the result — the loadability check. */
function applied(diagram: Diagram, result: PasteResult, label?: string): Diagram {
  const after = new CommandStack(diagram).execute(pasteEntities(result, label))
  return DiagramSchema.parse(after)
}

describe('copying entities (FR-7.4)', () => {
  it('takes only the relationships that lie wholly inside the selection', () => {
    const diagram = schema()
    const customer = named(diagram, 'CUSTOMER')

    // CUSTOMER alone: the `places` relationship has its other leg on ORDER, so it stays
    // behind rather than being half-copied.
    expect(copyEntities(diagram, new Set([customer.id])).relationships).toHaveLength(0)

    const both = copyEntities(diagram, new Set([customer.id, named(diagram, 'ORDER').id]))
    expect(both.relationships).toHaveLength(1)
    expect(both.entities).toHaveLength(2)
  })

  it('carries the positions, so a paste knows where to land', () => {
    const diagram = schema()
    const payload = copyEntities(diagram, new Set([named(diagram, 'CUSTOMER').id]))

    expect(Object.values(payload.positions)).toEqual([{ x: 0, y: 0 }])
  })
})

describe('pasting (FR-7.4)', () => {
  it('gives every copy a fresh id and a unique name', () => {
    const diagram = schema()
    const customer = named(diagram, 'CUSTOMER')
    const result = planPaste(diagram, copyEntities(diagram, new Set([customer.id])))
    const after = applied(diagram, result)

    expect(after.entities).toHaveLength(4)
    expect(named(after, 'CUSTOMER_copy')).toBeDefined()
    expect(named(after, 'CUSTOMER_copy').id).not.toBe(customer.id)
    // And the attributes are new too, or the original's columns would be shared by two
    // boxes and renaming one would rename both.
    expect(named(after, 'CUSTOMER_copy').attributes[0]!.id).not.toBe(customer.attributes[0]!.id)
  })

  it('keeps counting when the obvious name is already taken', () => {
    let diagram = schema()
    const customer = named(diagram, 'CUSTOMER')

    diagram = applied(diagram, planPaste(diagram, copyEntities(diagram, new Set([customer.id]))))
    diagram = applied(diagram, planPaste(diagram, copyEntities(diagram, new Set([customer.id]))))

    expect(diagram.entities.map((entity) => entity.name)).toContain('CUSTOMER_copy')
    expect(diagram.entities.map((entity) => entity.name)).toContain('CUSTOMER_copy_2')
  })

  it('offsets the copy so it does not land exactly on the original', () => {
    const diagram = schema()
    const customer = named(diagram, 'CUSTOMER')
    const result = planPaste(diagram, copyEntities(diagram, new Set([customer.id])))
    const after = applied(diagram, result)

    expect(after.layout.positions[named(after, 'CUSTOMER_copy').id]).toEqual(PASTE_OFFSET)
    // The original has not moved.
    expect(after.layout.positions[customer.id]).toEqual({ x: 0, y: 0 })
  })

  it('reconnects a copied relationship between the COPIES, not the originals', () => {
    const diagram = schema()
    const ids = new Set([named(diagram, 'CUSTOMER').id, named(diagram, 'ORDER').id])
    const after = applied(diagram, planPaste(diagram, copyEntities(diagram, ids)))

    const copies = new Set([named(after, 'CUSTOMER_copy').id, named(after, 'ORDER_copy').id])
    expect(after.relationships).toHaveLength(2)

    const pasted = after.relationships.filter((relationship) =>
      relationship.participants.every((participant) => copies.has(participant.entityId)),
    )
    // Exactly one new edge, and it joins the two copies. Pointing at an original would look
    // identical on the canvas until you moved one.
    expect(pasted).toHaveLength(1)
  })

  it('a foreign key inside the copied set follows the copy', () => {
    const diagram = schema()
    const ids = new Set([named(diagram, 'CUSTOMER').id, named(diagram, 'ORDER').id])
    const after = applied(diagram, planPaste(diagram, copyEntities(diagram, ids)))

    const fk = named(after, 'ORDER_copy').attributes[1]!.foreignKey
    expect(fk?.entityId).toBe(named(after, 'CUSTOMER_copy').id)
    expect(fk?.attributeId).toBe(named(after, 'CUSTOMER_copy').attributes[0]!.id)
  })

  it('a foreign key pointing OUT of the copied set keeps pointing at the original', () => {
    const diagram = schema()
    // ORDER alone: its customer_id still references CUSTOMER, which is not being copied but
    // is right here in the document, so the copy shares the parent.
    const result = planPaste(diagram, copyEntities(diagram, new Set([named(diagram, 'ORDER').id])))
    const after = applied(diagram, result)

    expect(result.foreignKeysDropped).toBe(0)
    expect(named(after, 'ORDER_copy').attributes[1]!.foreignKey?.entityId).toBe(
      named(diagram, 'CUSTOMER').id,
    )
  })

  it('drops a reference that the destination has never heard of, and counts it', () => {
    const source = schema()
    const payload = copyEntities(source, new Set([named(source, 'ORDER').id]))

    // The case the clipboard makes possible: paste into a DIFFERENT document (FR-7.5), where
    // the table this foreign key points at does not exist. Keeping it would produce a
    // document that cannot be loaded at all.
    const elsewhere = createDiagram({ name: 'Another diagram' })
    const result = planPaste(elsewhere, payload)

    expect(result.foreignKeysDropped).toBe(1)
    const after = applied(elsewhere, result)
    expect(after.entities).toHaveLength(1)
    expect(after.entities[0]!.attributes[1]!.foreignKey).toBeUndefined()
  })

  it('is one undo step, and undo removes every copy', () => {
    const diagram = schema()
    const ids = new Set([named(diagram, 'CUSTOMER').id, named(diagram, 'ORDER').id])
    const result = planPaste(diagram, copyEntities(diagram, ids))

    const stack = new CommandStack(diagram)
    const after = stack.execute(pasteEntities(result))
    expect(after.entities).toHaveLength(5)
    expect(after.relationships).toHaveLength(2)

    const undone = stack.undo()
    expect(undone).toBeDefined()
    expect(undone.entities).toHaveLength(3)
    expect(undone.relationships).toHaveLength(1)
    expect(Object.keys(undone.layout.positions)).toHaveLength(3)
  })

  it('reports the ids it created, so the caller can select them', () => {
    const diagram = schema()
    const ids = new Set([named(diagram, 'CUSTOMER').id, named(diagram, 'ORDER').id])
    const result = planPaste(diagram, copyEntities(diagram, ids))

    expect(result.newEntityIds).toHaveLength(2)
    expect(new Set(result.newEntityIds)).toEqual(
      new Set(result.entities.map((entity) => entity.id)),
    )
    // None of them is an id that was already in the document.
    const existing = new Set<EntityId>(diagram.entities.map((entity) => entity.id))
    expect(result.newEntityIds.some((id) => existing.has(id))).toBe(false)
  })
})
