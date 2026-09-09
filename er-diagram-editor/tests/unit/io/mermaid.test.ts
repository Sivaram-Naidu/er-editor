/**
 * @vitest-environment jsdom
 *
 * jsdom, not node: the real mermaid parser is used at the bottom of this file and it
 * touches the DOM during initialisation.
 */
import { describe, expect, it } from 'vitest'

import {
  createAttribute,
  createDiagram,
  createEntity,
  createRelationship,
  type Diagram,
  type Entity,
} from '../../../src/domain'
import { exportMermaid, mermaidAdapter, nativeJsonAdapter } from '../../../src/io'

function shop(): { diagram: Diagram; customer: Entity; order: Entity } {
  const customerId = createAttribute({ name: 'id', dataType: 'uuid', isPrimaryKey: true })
  const customer = createEntity({
    name: 'CUSTOMER',
    attributes: [
      customerId,
      createAttribute({ name: 'email', dataType: 'varchar(255)', isUnique: true }),
    ],
  })
  const order = createEntity({
    name: 'ORDER',
    attributes: [
      createAttribute({ name: 'id', dataType: 'uuid', isPrimaryKey: true }),
      {
        ...createAttribute({ name: 'customer_id', dataType: 'uuid' }),
        foreignKey: { entityId: customer.id, attributeId: customerId.id },
      },
    ],
  })

  return {
    diagram: createDiagram({
      name: 'Shop',
      entities: [customer, order],
      relationships: [createRelationship({ from: customer.id, to: order.id, name: 'places' })],
    }),
    customer,
    order,
  }
}

describe('Mermaid output shape', () => {
  it('opens with an erDiagram declaration', () => {
    expect(exportMermaid(shop().diagram).content).toContain('erDiagram')
  })

  it('emits a block per entity', () => {
    const content = exportMermaid(shop().diagram).content

    expect(content).toContain('CUSTOMER {')
    expect(content).toContain('ORDER {')
  })

  it('emits type, name and key marker per field', () => {
    expect(exportMermaid(shop().diagram).content).toContain('uuid id PK')
  })

  it('marks unique fields UK and foreign keys FK', () => {
    const content = exportMermaid(shop().diagram).content

    expect(content).toContain('UK')
    expect(content).toContain('customer_id FK')
  })

  it('strips punctuation from type names, which Mermaid cannot parse', () => {
    // `varchar(255)` is a parse error in Mermaid; `varchar_255_` is not.
    const content = exportMermaid(shop().diagram).content

    expect(content).not.toContain('varchar(255)')
    expect(content).toContain('varchar_255_')
  })

  it('falls back to `string` for an untyped field', () => {
    const entity = createEntity({ name: 'A', attributes: [createAttribute({ name: 'note' })] })
    const content = exportMermaid(createDiagram({ entities: [entity] })).content

    expect(content).toContain('string note')
  })

  it('names an unnamed entity rather than emitting an unparseable empty block', () => {
    const content = exportMermaid(createDiagram({ entities: [createEntity()] })).content

    expect(content).toContain('ENTITY_1 {')
  })

  it('disambiguates duplicate entity names', () => {
    // Two blocks with the same name silently merge their fields in Mermaid.
    const diagram = createDiagram({
      entities: [createEntity({ name: 'ORDER' }), createEntity({ name: 'ORDER' })],
    })
    const content = exportMermaid(diagram).content

    expect(content).toContain('ORDER {')
    expect(content).toContain('ORDER_2 {')
  })
})

describe('Mermaid relationships', () => {
  it('writes the 1 : 0..N default as ||..o{', () => {
    expect(exportMermaid(shop().diagram).content).toMatch(/CUSTOMER \|\|\.\.o\{ ORDER/)
  })

  it('uses a solid line for identifying and a dotted one otherwise (FR-1.9)', () => {
    const f = shop()
    const identifying: Diagram = {
      ...f.diagram,
      relationships: [
        createRelationship({
          from: f.customer.id,
          to: f.order.id,
          name: 'owns',
          isIdentifying: true,
        }),
      ],
    }

    expect(exportMermaid(identifying).content).toContain('||--o{')
    expect(exportMermaid(f.diagram).content).toContain('||..o{')
  })

  it('mirrors the cardinality token per side', () => {
    // Mermaid's left and right tokens are mirror images; getting one wrong silently
    // inverts the relationship.
    const f = shop()
    const manyToMany: Diagram = {
      ...f.diagram,
      relationships: [
        createRelationship({
          from: f.customer.id,
          to: f.order.id,
          fromEnd: { cardinality: 'many', participation: 'partial' },
          toEnd: { cardinality: 'many', participation: 'partial' },
        }),
      ],
    }

    expect(exportMermaid(manyToMany).content).toContain('}o..o{')
  })

  it('labels an unnamed relationship rather than emitting an empty label', () => {
    const f = shop()
    const unnamed: Diagram = {
      ...f.diagram,
      relationships: [createRelationship({ from: f.customer.id, to: f.order.id })],
    }

    expect(exportMermaid(unnamed).content).toContain('"relates to"')
  })
})

describe('Mermaid approximations', () => {
  it('keeps Chen-only flags as field comments rather than dropping them', () => {
    const entity = createEntity({
      name: 'CUSTOMER',
      attributes: [
        createAttribute({ name: 'phones', dataType: 'text', isMultivalued: true }),
        createAttribute({ name: 'total', dataType: 'int', isDerived: true }),
      ],
    })
    const content = exportMermaid(createDiagram({ entities: [entity] })).content

    expect(content).toContain('multivalued')
    expect(content).toContain('derived')
  })

  it('notes weak entities in a header comment', () => {
    const weak = createEntity({ name: 'ORDER_LINE', kind: 'weak' })
    const content = exportMermaid(createDiagram({ entities: [weak] })).content

    expect(content).toContain('%% Weak entities')
    expect(content).toContain('ORDER_LINE')
  })

  it('flattens composite attributes to parent_child fields', () => {
    const entity = createEntity({
      name: 'CUSTOMER',
      attributes: [
        createAttribute({
          name: 'address',
          children: [
            createAttribute({ name: 'street', dataType: 'text' }),
            createAttribute({ name: 'city', dataType: 'text' }),
          ],
        }),
      ],
    })
    const content = exportMermaid(createDiagram({ entities: [entity] })).content

    expect(content).toContain('address_street')
    expect(content).toContain('address_city')
  })

  it('escapes quotes in comments, which would otherwise end the string early', () => {
    const entity = createEntity({
      name: 'A',
      attributes: [createAttribute({ name: 'x', comment: 'the "main" one' })],
    })

    expect(exportMermaid(createDiagram({ entities: [entity] })).content).not.toContain(
      '"the "main"',
    )
  })
})

describe('the loss report (FR-6.3)', () => {
  it('is empty for a diagram Mermaid can hold exactly', () => {
    const entity = createEntity({
      name: 'A',
      attributes: [createAttribute({ name: 'id', dataType: 'int', isPrimaryKey: true })],
    })

    expect(exportMermaid(createDiagram({ entities: [entity] })).lossReport).toEqual([])
  })

  it('reports a weak entity as approximated, naming it', () => {
    const weak = createEntity({ name: 'ORDER_LINE', kind: 'weak' })
    const report = exportMermaid(createDiagram({ entities: [weak] })).lossReport
    const item = report.find((entry) => entry.construct === 'weakEntity')

    expect(item?.treatment).toBe('approximated')
    expect(item?.elementLabel).toBe('ORDER_LINE')
  })

  it('reports positions as dropped, since Mermaid lays out its own diagram', () => {
    const entity = createEntity({ name: 'A' })
    const diagram: Diagram = {
      ...createDiagram({ entities: [entity] }),
      layout: { positions: { [entity.id]: { x: 1, y: 2 } }, pinned: [] },
    }

    expect(
      exportMermaid(diagram).lossReport.find((entry) => entry.construct === 'position')?.treatment,
    ).toBe('dropped')
  })

  it('does not report a construct the diagram never uses', () => {
    const entity = createEntity({ name: 'A' })
    const report = exportMermaid(createDiagram({ entities: [entity] })).lossReport

    expect(report.some((entry) => entry.construct === 'multivaluedAttribute')).toBe(false)
  })

  it('reports each construct once per element, not once per occurrence', () => {
    const entity = createEntity({
      name: 'A',
      attributes: [
        createAttribute({ name: 'a', isMultivalued: true }),
        createAttribute({ name: 'b', isMultivalued: true }),
      ],
    })
    const report = exportMermaid(createDiagram({ entities: [entity] })).lossReport

    expect(report.filter((entry) => entry.construct === 'multivaluedAttribute')).toHaveLength(2)
  })

  it('explains each loss in plain words', () => {
    const weak = createEntity({ name: 'W', kind: 'weak' })
    const report = exportMermaid(createDiagram({ entities: [weak] })).lossReport

    expect(report.every((entry) => entry.detail.length > 20)).toBe(true)
  })
})

describe('the native format is lossless (FR-6.4)', () => {
  it('reports nothing lost even for a diagram full of Chen constructs', () => {
    const weak = createEntity({
      name: 'W',
      kind: 'weak',
      attributes: [createAttribute({ name: 'a', isMultivalued: true, isDerived: true })],
    })

    expect(nativeJsonAdapter.export(createDiagram({ entities: [weak] })).lossReport).toEqual([])
  })

  it('round-trips through JSON unchanged', () => {
    const diagram = shop().diagram
    const content = nativeJsonAdapter.export(diagram).content

    expect(JSON.parse(content)).toEqual(JSON.parse(JSON.stringify(diagram)))
  })
})

describe('the exported file actually parses as Mermaid', () => {
  /**
   * The assertion that matters most, and the one no amount of string-matching replaces.
   *
   * FR-6.1 requires the output open in Mermaid Live Editor without error. Testing that
   * with substring checks would pass happily on a file Mermaid rejects — a stray
   * parenthesis in a type name, an empty entity block, a duplicated name. So this runs
   * the real parser.
   */
  async function parse(content: string): Promise<void> {
    const mermaid = (await import('mermaid')).default
    mermaid.initialize({ startOnLoad: false })
    await mermaid.parse(content)
  }

  it('parses the shop schema', async () => {
    await expect(parse(exportMermaid(shop().diagram).content)).resolves.toBeUndefined()
  }, 30_000)

  it('parses a diagram using every construct we can express', async () => {
    const parent = createEntity({
      name: 'CUSTOMER',
      attributes: [
        createAttribute({ name: 'id', dataType: 'uuid', isPrimaryKey: true }),
        createAttribute({ name: 'email', dataType: 'varchar(255)', isUnique: true }),
        createAttribute({ name: 'phones', dataType: 'text', isMultivalued: true }),
        createAttribute({
          name: 'address',
          children: [createAttribute({ name: 'city', dataType: 'text' })],
        }),
      ],
    })
    const weak = createEntity({
      name: 'ORDER_LINE',
      kind: 'weak',
      attributes: [createAttribute({ name: 'line no', dataType: 'numeric(10,2)' })],
    })
    const employee = createEntity({ name: 'EMPLOYEE' })

    const diagram = createDiagram({
      name: 'Everything',
      entities: [parent, weak, employee, createEntity()],
      relationships: [
        createRelationship({ from: parent.id, to: weak.id, name: 'has', isIdentifying: true }),
        createRelationship({
          from: employee.id,
          to: employee.id,
          name: 'reports to',
          fromEnd: { role: 'manager' },
        }),
      ],
    })

    await expect(parse(exportMermaid(diagram).content)).resolves.toBeUndefined()
  }, 30_000)

  it('parses a diagram whose names would break a naive exporter', async () => {
    const awkward = createEntity({
      name: 'Order Items (2024)',
      attributes: [createAttribute({ name: 'total $', dataType: 'numeric(10,2)' })],
    })
    const other = createEntity({ name: 'Order Items (2024)' })

    const diagram = createDiagram({ entities: [awkward, other] })

    await expect(parse(exportMermaid(diagram).content)).resolves.toBeUndefined()
  }, 30_000)
})

describe('the adapter registry', () => {
  it('offers the lossless format first', () => {
    expect(nativeJsonAdapter.id).toBe('native-json')
    expect(mermaidAdapter.extension).toBe('.mmd')
  })
})
