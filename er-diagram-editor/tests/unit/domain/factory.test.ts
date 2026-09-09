/**
 * @vitest-environment node
 *
 * No DOM here. Spinning up jsdom per file costs about a second each and this suite has
 * nothing to render — the domain layer is deliberately Node-testable (NFR-6.1).
 */
import { describe, expect, it } from 'vitest'

import {
  AttributeSchema,
  DiagramSchema,
  EntitySchema,
  FORMAT_VERSION,
  RelationshipSchema,
  createAttribute,
  createDiagram,
  createEntity,
  createGroup,
  createParticipant,
  createRelationship,
  newAttributeId,
  newEntityId,
} from '../../../src/domain/model'

/**
 * Tests for src/domain/model/factory.ts.
 *
 * The load-bearing property throughout: everything a factory produces must parse
 * against its own schema. A factory that emits something the parser rejects would let
 * the editor build a diagram it cannot save.
 */

describe('identity', () => {
  it('mints unique ids', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newEntityId()))

    expect(ids.size).toBe(500)
  })

  it('prefixes ids by kind so raw JSON stays readable', () => {
    expect(newEntityId()).toMatch(/^ent_/)
    expect(newAttributeId()).toMatch(/^att_/)
    expect(createRelationship({ from: newEntityId(), to: newEntityId() }).id).toMatch(/^rel_/)
    expect(createGroup().id).toMatch(/^grp_/)
    expect(createDiagram().id).toMatch(/^dgm_/)
  })

  it('gives every element in a diagram a distinct id', () => {
    const a = createEntity({ name: 'A', attributes: [createAttribute(), createAttribute()] })
    const b = createEntity({ name: 'B', attributes: [createAttribute()] })
    const ids = [a, b, ...a.attributes, ...b.attributes].map((element) => element.id)

    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('createAttribute', () => {
  it('produces a schema-valid attribute from no arguments', () => {
    expect(AttributeSchema.safeParse(createAttribute()).success).toBe(true)
  })

  it('starts with an empty name so inline edit has nothing to delete (FR-1.2)', () => {
    expect(createAttribute().name).toBe('')
  })

  it('defaults to a nullable, non-key, scalar attribute', () => {
    expect(createAttribute()).toMatchObject({
      isPrimaryKey: false,
      isUnique: false,
      isNullable: true,
      isDerived: false,
      isMultivalued: false,
    })
  })

  it('makes a primary key unique and non-nullable by default', () => {
    expect(createAttribute({ isPrimaryKey: true })).toMatchObject({
      isPrimaryKey: true,
      isUnique: true,
      isNullable: false,
    })
  })

  it('lets an explicit override beat the primary-key inference', () => {
    // The schema permits a nullable PK and the validation rules flag it; the factory
    // should not silently overrule a caller who asked for one.
    expect(createAttribute({ isPrimaryKey: true, isNullable: true }).isNullable).toBe(true)
  })

  it('omits optional fields entirely rather than setting them to undefined', () => {
    // exactOptionalPropertyTypes is on; absence must be real absence so the persisted
    // JSON does not accumulate empty keys.
    const attribute = createAttribute()

    expect('dataType' in attribute).toBe(false)
    expect('comment' in attribute).toBe(false)
    expect('defaultValue' in attribute).toBe(false)
    expect('children' in attribute).toBe(false)
    expect(Object.keys(attribute)).not.toContain('foreignKey')
  })

  it('includes optional fields when given', () => {
    const attribute = createAttribute({ name: 'email', dataType: 'varchar', comment: 'login' })

    expect(attribute).toMatchObject({ name: 'email', dataType: 'varchar', comment: 'login' })
  })

  it('accepts composite children and still parses', () => {
    const attribute = createAttribute({
      name: 'address',
      children: [createAttribute({ name: 'street' }), createAttribute({ name: 'city' })],
    })

    expect(attribute.children).toHaveLength(2)
    expect(AttributeSchema.safeParse(attribute).success).toBe(true)
  })
})

describe('createEntity', () => {
  it('produces a schema-valid entity from no arguments', () => {
    expect(EntitySchema.safeParse(createEntity()).success).toBe(true)
  })

  it('starts empty and strong, per FR-1.1', () => {
    expect(createEntity()).toMatchObject({ name: '', kind: 'strong', attributes: [] })
  })

  it('does not invent a primary key', () => {
    // Adding an implicit `id` would be a modelling decision the user did not make.
    // FR-8.3 surfaces a missing PK as a warning instead.
    expect(createEntity({ name: 'CUSTOMER' }).attributes).toEqual([])
  })

  it('does not share the default attributes array between entities', () => {
    const first = createEntity()
    const second = createEntity()
    first.attributes.push(createAttribute())

    expect(second.attributes).toHaveLength(0)
  })

  it('omits optional fields rather than setting them to undefined', () => {
    const entity = createEntity()

    expect('comment' in entity).toBe(false)
    expect('groupId' in entity).toBe(false)
    expect('parentId' in entity).toBe(false)
  })

  it('supports weak entities', () => {
    expect(createEntity({ name: 'ORDER_LINE', kind: 'weak' }).kind).toBe('weak')
  })
})

describe('createRelationship', () => {
  const from = newEntityId()
  const to = newEntityId()

  it('produces a schema-valid relationship', () => {
    expect(RelationshipSchema.safeParse(createRelationship({ from, to })).success).toBe(true)
  })

  it('defaults to 1 : 0..N as FR-1.5 specifies', () => {
    const [source, target] = createRelationship({ from, to }).participants

    expect(source).toMatchObject({ entityId: from, cardinality: 'one', participation: 'total' })
    expect(target).toMatchObject({ entityId: to, cardinality: 'many', participation: 'partial' })
  })

  it('differs from the schema default, which is the neutral N:N', () => {
    // The factory is opinionated about what the user just drew; the schema must stay
    // neutral about what an omitted field in a stored file means. This test exists to
    // stop the two being "helpfully" unified.
    const factoryEnds = createRelationship({ from, to }).participants.map((p) => p.cardinality)
    const schemaEnds = RelationshipSchema.parse({
      id: 'rel_1',
      participants: [{ entityId: from }, { entityId: to }],
    }).participants.map((p) => p.cardinality)

    expect(factoryEnds).toEqual(['one', 'many'])
    expect(schemaEnds).toEqual(['many', 'many'])
  })

  it('honours per-end overrides', () => {
    const relationship = createRelationship({
      from,
      to,
      fromEnd: { cardinality: 'many', participation: 'partial' },
      toEnd: { cardinality: 'many', participation: 'total' },
    })

    expect(relationship.participants.map((p) => p.cardinality)).toEqual(['many', 'many'])
    expect(relationship.participants.map((p) => p.participation)).toEqual(['partial', 'total'])
  })

  it('creates binary relationships with exactly two participants', () => {
    const relationship = createRelationship({ from, to })

    expect(relationship.kind).toBe('binary')
    expect(relationship.participants).toHaveLength(2)
  })

  it('supports recursive relationships with distinct roles (FR-1.12)', () => {
    const employee = newEntityId()
    const relationship = createRelationship({
      from: employee,
      to: employee,
      name: 'reports to',
      fromEnd: { role: 'manager' },
      toEnd: { role: 'report' },
    })

    expect(relationship.participants.map((p) => p.entityId)).toEqual([employee, employee])
    expect(relationship.participants.map((p) => p.role)).toEqual(['manager', 'report'])
    expect(RelationshipSchema.safeParse(relationship).success).toBe(true)
  })

  it('omits role when not supplied', () => {
    const [source] = createRelationship({ from, to }).participants

    expect(source && 'role' in source).toBe(false)
  })

  it('supports identifying relationships for weak entities (FR-1.9)', () => {
    expect(createRelationship({ from, to, isIdentifying: true }).isIdentifying).toBe(true)
  })
})

describe('createParticipant', () => {
  it('defaults to the neutral end, matching the schema rather than the relationship factory', () => {
    expect(createParticipant({ entityId: newEntityId() })).toMatchObject({
      cardinality: 'many',
      participation: 'partial',
    })
  })
})

describe('createDiagram', () => {
  it('produces a schema-valid diagram from no arguments', () => {
    expect(DiagramSchema.safeParse(createDiagram()).success).toBe(true)
  })

  it('stamps the current format version', () => {
    expect(createDiagram().formatVersion).toBe(FORMAT_VERSION)
  })

  it('names the diagram, since the schema forbids an empty one', () => {
    expect(createDiagram().name).toBe('Untitled diagram')
  })

  it('sets createdAt and updatedAt to the same instant', () => {
    const now = (): Date => new Date('2026-01-01T00:00:00.000Z')
    const diagram = createDiagram({ now })

    expect(diagram.createdAt).toBe('2026-01-01T00:00:00.000Z')
    expect(diagram.updatedAt).toBe(diagram.createdAt)
  })

  it('starts with an initialised, empty layout', () => {
    expect(createDiagram().layout).toEqual({ positions: {}, pinned: [] })
  })

  it('defaults to compact notation (SRS §2.2)', () => {
    expect(createDiagram().meta.notation).toBe('compact')
  })

  it('does not share mutable defaults between diagrams', () => {
    const first = createDiagram()
    const second = createDiagram()
    first.entities.push(createEntity())
    first.layout.pinned.push(newEntityId())

    expect(second.entities).toHaveLength(0)
    expect(second.layout.pinned).toHaveLength(0)
  })
})

describe('factory output is round-trip safe', () => {
  it('a diagram assembled entirely from factories parses and survives JSON', () => {
    const customer = createEntity({
      name: 'CUSTOMER',
      attributes: [
        createAttribute({ name: 'id', dataType: 'uuid', isPrimaryKey: true }),
        createAttribute({ name: 'email', dataType: 'varchar', isUnique: true }),
      ],
    })

    const order = createEntity({
      name: 'ORDER',
      attributes: [createAttribute({ name: 'id', dataType: 'uuid', isPrimaryKey: true })],
    })

    const customerPk = customer.attributes[0]!
    const customerFk = createAttribute({
      name: 'customer_id',
      dataType: 'uuid',
    })
    // Wire the foreign key by ID, not by name — the whole point of SRS §3.
    order.attributes.push({
      ...customerFk,
      foreignKey: { entityId: customer.id, attributeId: customerPk.id },
    })

    const diagram = createDiagram({
      name: 'Shop',
      entities: [customer, order],
      relationships: [createRelationship({ from: customer.id, to: order.id, name: 'places' })],
    })

    const parsed = DiagramSchema.safeParse(JSON.parse(JSON.stringify(diagram)))

    expect(parsed.success).toBe(true)
    expect(parsed.data).toEqual(diagram)
  })

  it('renaming an attribute does not break the foreign key that references it', () => {
    // The property that justifies stable IDs over name keys (SRS §3).
    const customer = createEntity({
      name: 'CUSTOMER',
      attributes: [createAttribute({ name: 'id', isPrimaryKey: true })],
    })
    const pk = customer.attributes[0]!
    const order = createEntity({
      name: 'ORDER',
      attributes: [
        {
          ...createAttribute({ name: 'customer_id' }),
          foreignKey: { entityId: customer.id, attributeId: pk.id },
        },
      ],
    })

    // Rename the referenced attribute.
    customer.attributes[0] = { ...pk, name: 'customer_uuid' }

    const diagram = createDiagram({ entities: [customer, order] })
    const parsed = DiagramSchema.safeParse(diagram)

    expect(parsed.success).toBe(true)
    expect(order.attributes[0]?.foreignKey?.attributeId).toBe(customer.attributes[0]?.id)
  })
})
