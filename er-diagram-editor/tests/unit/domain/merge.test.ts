/**
 * @vitest-environment node
 *
 * Re-importing a schema over the diagram already on screen.
 *
 * The feature exists because import used to replace the document wholesale and throw away
 * every position. So the assertions that matter are not "did it merge" but "did the
 * arrangement survive" and "is the result still loadable" — the second one because the
 * schema enforces referential integrity, and a foreign key left pointing at a column that
 * the new dump deleted does not render oddly, it makes the document refuse to parse. Every
 * test here ends by parsing the merged result for that reason.
 */
import { describe, expect, it } from 'vitest'

import {
  applyLayout,
  applyMerge,
  CommandStack,
  createAttribute,
  createDiagram,
  createEntity,
  createRelationship,
  DiagramSchema,
  mergeDiagrams,
  newAttributeId,
  newEntityId,
  newRelationshipId,
  setForeignKey,
  type Attribute,
  type AttributeId,
  type Diagram,
  type EntityId,
  type MergeResult,
} from '../../../src/domain'

/**
 * Rebuild a document the way an importer hands one back: every id reissued.
 *
 * Not a simplification of the problem — it IS the problem. `.sql` and `.mmd` carry no ids
 * at all, so the incoming document can never share one with the canvas, and a test that
 * reused ids would pass while matching by id, which is the bug this feature fixes.
 */
function asImported(diagram: Diagram): Diagram {
  const entityIds = new Map<EntityId, EntityId>()
  const attributeIds = new Map<AttributeId, AttributeId>()

  for (const entity of diagram.entities) {
    entityIds.set(entity.id, newEntityId())
    for (const attribute of entity.attributes) attributeIds.set(attribute.id, newAttributeId())
  }

  const reissue = (attribute: Attribute): Attribute => {
    const id = attributeIds.get(attribute.id) ?? newAttributeId()
    const fk = attribute.foreignKey
    if (fk === undefined) return { ...attribute, id }
    return {
      ...attribute,
      id,
      foreignKey: {
        entityId: entityIds.get(fk.entityId) ?? fk.entityId,
        attributeId: attributeIds.get(fk.attributeId) ?? fk.attributeId,
      },
    }
  }

  return {
    ...diagram,
    entities: diagram.entities.map((entity) => ({
      ...entity,
      id: entityIds.get(entity.id) ?? newEntityId(),
      attributes: entity.attributes.map(reissue),
    })),
    relationships: diagram.relationships.map((relationship) => ({
      ...relationship,
      id: newRelationshipId(),
      participants: relationship.participants.map((participant) => ({
        ...participant,
        entityId: entityIds.get(participant.entityId) ?? participant.entityId,
      })),
    })),
    // An importer carries no coordinates, so neither does this.
    layout: { positions: {}, pinned: [] },
  }
}

function attribute(name: string, isPrimaryKey = false): Attribute {
  return createAttribute({ name, isPrimaryKey, dataType: isPrimaryKey ? 'uuid' : 'text' })
}

/** CUSTOMER ← ORDER, plus a hand-drawn NOTE that no dump will ever mention. */
function canvas(): Diagram {
  const customer = createEntity({ name: 'CUSTOMER', attributes: [attribute('id', true), attribute('email')] })
  const order = createEntity({ name: 'ORDER', attributes: [attribute('id', true), attribute('customer_id')] })
  const note = createEntity({ name: 'NOTE', attributes: [attribute('id', true), attribute('order_ref')] })

  const diagram = createDiagram({
    entities: [customer, order, note],
    relationships: [createRelationship({ from: customer.id, to: order.id, name: 'places' })],
  })

  const stack = new CommandStack(diagram)
  // Through the real commands, so the starting document is built the way a real one is.
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
    // The hazard in one line: a hand-drawn box pointing into a table the dump owns.
    setForeignKey(note.id, note.attributes[1]!.id, {
      entityId: order.id,
      attributeId: order.attributes[0]!.id,
    }),
  )
}

/** What the dump contains: everything except the hand-drawn NOTE. */
function dumpOf(diagram: Diagram): Diagram {
  const kept = diagram.entities.filter((entity) => entity.name !== 'NOTE')
  const keptIds = new Set(kept.map((entity) => entity.id))
  return asImported({
    ...diagram,
    entities: kept.map((entity) => ({
      ...entity,
      attributes: entity.attributes.map((candidate) =>
        candidate.foreignKey !== undefined && !keptIds.has(candidate.foreignKey.entityId)
          ? { ...candidate, foreignKey: undefined }
          : candidate,
      ),
    })),
    relationships: diagram.relationships.filter((relationship) =>
      relationship.participants.every((participant) => keptIds.has(participant.entityId)),
    ),
  })
}

/** The merged document, put back together and parsed — the loadability check. */
function parsed(current: Diagram, result: MergeResult): Diagram {
  return DiagramSchema.parse({
    ...current,
    entities: result.entities,
    relationships: result.relationships,
    layout: { ...current.layout, positions: result.positions, pinned: result.pinned },
  })
}

const named = (diagram: Diagram, name: string): Diagram['entities'][number] => {
  const found = diagram.entities.find((entity) => entity.name === name)
  if (found === undefined) throw new Error(`no entity named ${name}`)
  return found
}

describe('re-importing a schema over the current diagram', () => {
  it('keeps every position and every id when the file has not changed', () => {
    const current = canvas()
    const result = mergeDiagrams(current, dumpOf(current), { removeMissing: false })

    // The whole point of the feature, stated as plainly as it can be.
    expect(result.positions).toEqual(current.layout.positions)

    for (const entity of current.entities) {
      expect(result.entities.some((candidate) => candidate.id === entity.id)).toBe(true)
    }
    expect(result.summary.added).toEqual([])
    expect(result.summary.changed).toEqual([])
    expect(result.summary.unchanged).toBe(2)
    expect(parsed(current, result).entities).toHaveLength(3)
  })

  it('does not draw a second copy of every relationship', () => {
    const current = canvas()
    const result = mergeDiagrams(current, dumpOf(current), { removeMissing: false })

    // Matching on remapped participants plus name is what makes this hold. Without it a
    // re-import of the same dump doubles the edges, every time it is run.
    expect(result.relationships).toHaveLength(current.relationships.length)
    expect(result.summary.relationshipsAdded).toBe(0)
    expect(result.summary.relationshipsRemoved).toBe(0)
  })

  it('adds a new table without moving anything already placed', () => {
    const current = canvas()
    const dump = dumpOf(current)
    const withNewTable: Diagram = {
      ...dump,
      entities: [
        ...dump.entities,
        createEntity({ name: 'INVOICE', attributes: [attribute('id', true)] }),
      ],
    }

    const result = mergeDiagrams(current, withNewTable, { removeMissing: false })

    expect(result.summary.added).toEqual(['INVOICE'])
    for (const [id, point] of Object.entries(current.layout.positions)) {
      expect(result.positions[id as EntityId]).toEqual(point)
    }

    // Placed clear of everything already on the canvas rather than on top of it, and
    // WITHOUT re-running auto-layout, which would rearrange the very thing being preserved.
    const invoice = named(parsed(current, result), 'INVOICE')
    const placed = result.positions[invoice.id]
    expect(placed).toBeDefined()
    const rightmost = Math.max(...Object.values(current.layout.positions).map((p) => p.x))
    expect(placed!.x).toBeGreaterThan(rightmost)
  })

  it('keeps a hand-drawn foreign key pointing into a re-imported table', () => {
    const current = canvas()
    const before = named(current, 'NOTE').attributes[1]!.foreignKey
    expect(before).toBeDefined()

    const result = mergeDiagrams(current, dumpOf(current), { removeMissing: false })
    const merged = parsed(current, result)

    // THE REASON IDS ARE PRESERVED. ORDER's attributes came from the dump with fresh ids;
    // if the merge had adopted those, NOTE's foreign key would dangle and this parse would
    // throw rather than return.
    expect(named(merged, 'NOTE').attributes[1]!.foreignKey).toEqual(before)
    expect(result.summary.foreignKeysCleared).toBe(0)
  })

  it('clears a foreign key whose column the new schema dropped, and says so', () => {
    const current = canvas()
    const dump = dumpOf(current)
    const withoutOrderId: Diagram = {
      ...dump,
      entities: dump.entities.map((entity) =>
        entity.name === 'ORDER'
          ? { ...entity, attributes: entity.attributes.filter((a) => a.name !== 'id') }
          : entity,
      ),
    }

    const result = mergeDiagrams(current, withoutOrderId, { removeMissing: false })

    expect(result.summary.foreignKeysCleared).toBe(1)
    expect(named(parsed(current, result), 'NOTE').attributes[1]!.foreignKey).toBeUndefined()
  })

  it('keeps a table the file does not mention, unless asked to remove it', () => {
    const current = canvas()
    const dump = dumpOf(current)

    const kept = mergeDiagrams(current, dump, { removeMissing: false })
    expect(kept.summary.missing).toEqual(['NOTE'])
    expect(kept.summary.removed).toBe(0)
    expect(parsed(current, kept).entities).toHaveLength(3)

    const removed = mergeDiagrams(current, dump, { removeMissing: true })
    expect(removed.summary.removed).toBe(1)
    const after = parsed(current, removed)
    expect(after.entities.map((entity) => entity.name)).toEqual(['CUSTOMER', 'ORDER'])
    // Its position goes with it, or the layout accumulates keys for boxes that do not exist.
    expect(Object.keys(removed.positions)).toHaveLength(2)
  })

  it('reads a renamed table as one added and one missing, deliberately', () => {
    const current = canvas()
    const dump = dumpOf(current)
    const renamed: Diagram = {
      ...dump,
      entities: dump.entities.map((entity) =>
        entity.name === 'ORDER' ? { ...entity, name: 'ORDER_HEADER' } : entity,
      ),
    }

    const result = mergeDiagrams(current, renamed, { removeMissing: false })

    // THE DECISION, ASSERTED SO IT STAYS A DECISION. A rename is indistinguishable from a
    // drop plus an add when the name is the only join key, and guessing at it by comparing
    // column sets would silently move the wrong box when it guessed wrong. It is reported
    // as both instead, where a human can see it and undo in one step.
    expect(result.summary.added).toEqual(['ORDER_HEADER'])
    // NOTE is missing from every dump by construction; ORDER is missing because it was
    // renamed, and that is the half this test is about.
    expect(result.summary.missing).toEqual(['ORDER', 'NOTE'])
  })

  it('does not pair duplicate names off at random', () => {
    const current = canvas()
    const dump = dumpOf(current)
    const twice: Diagram = {
      ...dump,
      entities: [
        ...dump.entities,
        createEntity({ name: 'CUSTOMER', attributes: [attribute('id', true)] }),
      ],
    }

    const result = mergeDiagrams(current, twice, { removeMissing: false })

    // The schema permits duplicate names, so the second CUSTOMER has to become a new box
    // rather than quietly overwriting the one that is already placed.
    expect(result.summary.added).toEqual(['CUSTOMER'])
    expect(result.positions[named(current, 'CUSTOMER').id]).toEqual({ x: 0, y: 0 })
    expect(parsed(current, result).entities).toHaveLength(4)
  })

  it('is one undo step, and undo puts the positions back exactly', () => {
    const current = canvas()
    const dump = dumpOf(current)
    const result = mergeDiagrams(current, dump, { removeMissing: true })

    const stack = new CommandStack(current)
    const merged = stack.execute(applyMerge(result))
    expect(merged.entities).toHaveLength(2)

    const undone = stack.undo()
    expect(undone).toBeDefined()
    expect(undone.entities).toHaveLength(3)
    expect(undone.layout.positions).toEqual(current.layout.positions)
    // And the removed table comes back whole, foreign key included.
    expect(named(undone, 'NOTE').attributes[1]!.foreignKey).toBeDefined()
  })
})
