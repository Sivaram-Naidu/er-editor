/**
 * The searchable view of a diagram (FR-2.6).
 *
 * `node`, not jsdom — this half is pure. The palette component has its own file.
 */
import { describe, expect, it } from 'vitest'

import {
  createAttribute,
  createDiagram,
  createEntity,
  createRelationship,
  type Diagram,
} from '../../../src/domain'
import { buildSearchRecords, searchRecords } from '../../../src/features/search'

function schema(): Diagram {
  const customer = createEntity({
    name: 'CUSTOMER',
    attributes: [
      createAttribute({ name: 'id', isPrimaryKey: true, dataType: 'uuid' }),
      createAttribute({ name: 'email_address', dataType: 'text' }),
    ],
  })
  const order = createEntity({
    name: 'ORDER',
    attributes: [
      createAttribute({ name: 'id', isPrimaryKey: true, dataType: 'uuid' }),
      createAttribute({ name: 'placed_at', dataType: 'timestamptz' }),
    ],
  })
  const places = createRelationship({ name: 'places', from: customer.id, to: order.id })

  return createDiagram({
    name: 'shop',
    entities: [customer, order],
    relationships: [places],
  })
}

function build(diagram: Diagram) {
  return buildSearchRecords(diagram.entities, diagram.relationships)
}

describe('buildSearchRecords', () => {
  it('covers entities, attributes and relationships', () => {
    const records = build(schema())
    const names = records.map((record) => record.name).sort()

    expect(names).toEqual([
      'CUSTOMER',
      'ORDER',
      'email_address',
      'id',
      'id',
      'placed_at',
      'places',
    ])
  })

  it('says which entity an attribute belongs to — FR-2.6 asks for this by name', () => {
    const records = build(schema())
    const emails = records.filter((record) => record.name === 'email_address')

    expect(emails).toHaveLength(1)
    expect(emails[0]).toMatchObject({ kind: 'attribute', entityName: 'CUSTOMER' })
  })

  it('keeps the two same-named `id` columns apart by their owner', () => {
    // The obvious way to build this index — keyed by name — would collapse these two, and
    // a schema of a hundred tables has an `id` on nearly all of them.
    const records = build(schema())
    const ids = records.filter((record) => record.name === 'id')

    expect(ids).toHaveLength(2)
    expect(ids.map((record) => (record.kind === 'attribute' ? record.entityName : '')).sort()).toEqual([
      'CUSTOMER',
      'ORDER',
    ])
  })

  it('names both ends of a relationship, in order', () => {
    const records = build(schema())
    const places = records.find((record) => record.kind === 'relationship')

    expect(places).toMatchObject({ between: 'CUSTOMER → ORDER' })
  })

  it('carries a target the go-to hook already understands', () => {
    // The records deliberately do not describe the camera move — `useGoToIssue` does, and
    // it is the only place that knows selection order matters for an attribute.
    const records = build(schema())

    expect(records.find((record) => record.name === 'CUSTOMER')?.target).toMatchObject({
      kind: 'entity',
    })
    expect(records.find((record) => record.name === 'email_address')?.target).toMatchObject({
      kind: 'attribute',
    })
    expect(records.find((record) => record.name === 'places')?.target).toMatchObject({
      kind: 'relationship',
    })
  })

  describe('unnamed things', () => {
    it('leaves out an unnamed relationship rather than indexing a blank', () => {
      // `name: z.string().default('')` — an unnamed relationship is legal and is reported
      // by FR-8.3 as a warning, not rejected. It must not become a searchable blank.
      const base = schema()
      const [first] = base.relationships
      const anonymous = createRelationship({
        from: first!.participants[0]!.entityId,
        to: first!.participants[1]!.entityId,
      })
      const diagram = { ...base, relationships: [...base.relationships, anonymous] }

      const relationships = build(diagram).filter((record) => record.kind === 'relationship')
      expect(relationships).toHaveLength(1)
      expect(relationships[0]?.name).toBe('places')
    })

    it('leaves out an entity or field that is blank mid-edit', () => {
      const base = schema()
      const blank = createEntity({ name: '', attributes: [createAttribute({ name: '' })] })
      const diagram = { ...base, entities: [...base.entities, blank] }

      expect(build(diagram).every((record) => record.name !== '')).toBe(true)
    })
  })

  it('drops a participant whose entity is gone rather than rendering a gap', () => {
    const base = schema()
    // Delete CUSTOMER but leave the relationship pointing at it.
    const diagram = { ...base, entities: base.entities.slice(1) }

    const places = build(diagram).find((record) => record.kind === 'relationship')
    expect(places?.between).toBe('ORDER')
  })
})

describe('searchRecords', () => {
  it('finds a table by an acronym of its name', () => {
    const records = build(schema())
    expect(searchRecords(records, 'cust')[0]?.record.name).toBe('CUSTOMER')
  })

  it('puts the table above a field that matched as well', () => {
    // Typing `order` in a real schema matches the ORDER table and every `order_id` column
    // on every other table. The table is what someone is navigating to.
    const base = schema()
    const withColumn = {
      ...base,
      entities: [
        ...base.entities,
        createEntity({ name: 'SHIPMENT', attributes: [createAttribute({ name: 'order' })] }),
      ],
    }

    expect(searchRecords(build(withColumn), 'order')[0]?.record.kind).toBe('entity')
  })

  it('returns nothing for an empty query, so the palette can own that state', () => {
    expect(searchRecords(build(schema()), '')).toEqual([])
    expect(searchRecords(build(schema()), '   ')).toEqual([])
  })

  it('caps the result list', () => {
    const many = createDiagram({
      name: 'wide',
      entities: Array.from({ length: 50 }, (_, index) =>
        createEntity({ name: `TABLE_${String(index)}` }),
      ),
    })

    expect(searchRecords(build(many), 'table', 20)).toHaveLength(20)
  })
})
