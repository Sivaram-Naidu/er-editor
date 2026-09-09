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
  LayoutStateSchema,
  MAX_COMPOSITE_DEPTH,
  RelationshipSchema,
  attributeDepth,
} from '../../../src/domain/model'
import type { AttributeInput, DiagramInput } from '../../../src/domain/model'

/**
 * Tests for src/domain/model/schema.ts.
 *
 * Grouped by the promise each block is protecting, not by field, because the point of
 * most of these is a design decision that would otherwise be invisible.
 */

// ── Fixtures ─────────────────────────────────────────────────────────────────

const minimalAttribute = (over: Partial<AttributeInput> = {}): AttributeInput => ({
  id: 'att_1',
  name: 'id',
  ...over,
})

const minimalDiagram = (over: Partial<DiagramInput> = {}): DiagramInput => ({
  id: 'dgm_1',
  ...over,
})

// ─────────────────────────────────────────────────────────────────────────────
describe('defaults: `.default()` fields', () => {
  it('fills attribute flags without requiring them in the document', () => {
    const attribute = AttributeSchema.parse(minimalAttribute())

    expect(attribute).toMatchObject({
      isPrimaryKey: false,
      isUnique: false,
      isNullable: true,
      isDerived: false,
      isMultivalued: false,
    })
  })

  it('leaves `children` absent rather than defaulting it to an empty array', () => {
    // Absent means "scalar attribute"; `[]` means "composite with no parts yet".
    // Collapsing the two would lose that distinction on every round-trip.
    const attribute = AttributeSchema.parse(minimalAttribute())

    expect('children' in attribute).toBe(false)
    expect(AttributeSchema.parse(minimalAttribute({ children: [] })).children).toEqual([])
  })

  it('defaults both relationship ends to the neutral "many / partial", not to 1:N', () => {
    // The asymmetric 1:0..N of FR-1.5 belongs to createRelationship(), not to the
    // format. A hand-written file that omits both cardinalities means N:N.
    const relationship = RelationshipSchema.parse({
      id: 'rel_1',
      participants: [{ entityId: 'ent_1' }, { entityId: 'ent_2' }],
    })

    expect(relationship.participants.map((p) => p.cardinality)).toEqual(['many', 'many'])
    expect(relationship.participants.map((p) => p.participation)).toEqual(['partial', 'partial'])
  })

  it('defaults formatVersion so pre-versioning documents still load', () => {
    expect(DiagramSchema.parse(minimalDiagram()).formatVersion).toBe(FORMAT_VERSION)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('defaults: `.prefault()` fields', () => {
  it('runs nested defaults inside `layout` — the case `.default({})` would break', () => {
    // With `.default({})` Zod 4 short-circuits and hands back a bare `{}`, so
    // `positions` and `pinned` would be missing at runtime while the inferred type
    // claimed they were present. `.prefault({})` parses the empty object instead.
    const diagram = DiagramSchema.parse(minimalDiagram())

    expect(diagram.layout.positions).toEqual({})
    expect(diagram.layout.pinned).toEqual([])
  })

  it('runs nested defaults inside `meta`', () => {
    expect(DiagramSchema.parse(minimalDiagram()).meta.notation).toBe('compact')
  })

  it('produces a diagram name that satisfies the field\u2019s own min(1) constraint', () => {
    const { name } = DiagramSchema.parse(minimalDiagram())

    expect(name).toBe('Untitled diagram')
    // The guarantee `.prefault` buys: the default is held to the same rule as input,
    // so it cannot drift to a value the constraint was meant to forbid.
    expect(DiagramSchema.shape.name.safeParse(name).success).toBe(true)
  })

  it('produces ISO-8601 timestamps that survive re-parsing', () => {
    const diagram = DiagramSchema.parse(minimalDiagram())

    expect(DiagramSchema.safeParse({ ...diagram }).success).toBe(true)
    expect(new Date(diagram.createdAt).toISOString()).toBe(diagram.createdAt)
  })

  it('leaves an explicitly supplied layout untouched', () => {
    const diagram = DiagramSchema.parse(
      minimalDiagram({ layout: { positions: { ent_1: { x: 10, y: 20 } }, pinned: ['ent_1'] } }),
    )

    expect(diagram.layout.positions['ent_1' as never]).toEqual({ x: 10, y: 20 })
    expect(diagram.layout.pinned).toEqual(['ent_1'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('structural validity vs modelling quality', () => {
  // The schema answers "can this document be loaded?"; src/domain/validation answers
  // "is this a good model?". These cases must PARSE so the editor can hold a
  // half-finished diagram (FR-1.1 drops a new entity straight into inline name-edit).

  it.each([
    ['an empty entity name', { id: 'ent_1', name: '' }],
    ['an entity with no attributes', { id: 'ent_1', name: 'CUSTOMER' }],
    [
      'an entity with no primary key',
      { id: 'ent_1', name: 'CUSTOMER', attributes: [minimalAttribute({ name: 'email' })] },
    ],
    ['a weak entity with no identifying relationship', { id: 'ent_1', name: 'X', kind: 'weak' }],
  ])('accepts %s — that is a validation warning, not a parse error', (_label, input) => {
    expect(EntitySchema.safeParse(input).success).toBe(true)
  })

  it('accepts an unnamed relationship', () => {
    const relationship = RelationshipSchema.parse({
      id: 'rel_1',
      participants: [{ entityId: 'ent_1' }, { entityId: 'ent_2' }],
    })

    expect(relationship.name).toBe('')
  })

  it('rejects a missing id — that is structural, not stylistic', () => {
    expect(EntitySchema.safeParse({ name: 'CUSTOMER' }).success).toBe(false)
  })

  it('rejects an empty id string', () => {
    expect(EntitySchema.safeParse({ id: '', name: 'CUSTOMER' }).success).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('recursive composite attributes', () => {
  it('parses one level of nesting', () => {
    const parsed = EntitySchema.parse({
      id: 'ent_1',
      name: 'CUSTOMER',
      attributes: [
        minimalAttribute({
          id: 'att_1',
          name: 'address',
          children: [minimalAttribute({ id: 'att_2', name: 'street' })],
        }),
      ],
    })

    expect(parsed.attributes[0]?.children?.[0]?.name).toBe('street')
    // Nested children get the same defaults as top-level attributes.
    expect(parsed.attributes[0]?.children?.[0]?.isNullable).toBe(true)
  })

  it('rejects nesting deeper than MAX_COMPOSITE_DEPTH', () => {
    const result = EntitySchema.safeParse({
      id: 'ent_1',
      name: 'CUSTOMER',
      attributes: [
        minimalAttribute({
          id: 'att_1',
          name: 'address',
          children: [
            minimalAttribute({
              id: 'att_2',
              name: 'street',
              children: [minimalAttribute({ id: 'att_3', name: 'number' })],
            }),
          ],
        }),
      ],
    })

    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toContain('nest 1 level deep')
  })

  it('measures depth: scalar 0, one level 1, two levels 2', () => {
    const scalar = AttributeSchema.parse(minimalAttribute())
    const oneLevel = AttributeSchema.parse(
      minimalAttribute({ children: [minimalAttribute({ id: 'att_2' })] }),
    )
    const twoLevels = AttributeSchema.parse(
      minimalAttribute({
        children: [
          minimalAttribute({ id: 'att_2', children: [minimalAttribute({ id: 'att_3' })] }),
        ],
      }),
    )

    expect(attributeDepth(scalar)).toBe(0)
    expect(attributeDepth(oneLevel)).toBe(MAX_COMPOSITE_DEPTH)
    expect(attributeDepth(twoLevels)).toBe(2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('relationship arity', () => {
  const participants = (count: number): { entityId: string }[] =>
    Array.from({ length: count }, (_, index) => ({ entityId: `ent_${String(index)}` }))

  it.each([
    ['binary', 1, false],
    ['binary', 2, true],
    ['binary', 3, false],
    ['nary', 2, false],
    ['nary', 3, true],
    ['nary', 4, true],
    ['isa', 1, false],
    ['isa', 2, true],
  ])('%s with %i participants → valid: %s', (kind, count, expected) => {
    const result = RelationshipSchema.safeParse({
      id: 'rel_1',
      kind,
      participants: participants(count),
    })

    expect(result.success).toBe(expected)
  })

  it('explains the arity failure rather than just rejecting', () => {
    const result = RelationshipSchema.safeParse({
      id: 'rel_1',
      kind: 'binary',
      participants: participants(3),
    })

    expect(result.error?.issues[0]?.message).toContain('exactly 2 participants, got 3')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('referential integrity (NFR-7.2 — untrusted input)', () => {
  const twoEntities = [
    {
      id: 'ent_1',
      name: 'CUSTOMER',
      attributes: [{ id: 'att_1', name: 'id', isPrimaryKey: true }],
    },
    { id: 'ent_2', name: 'ORDER', attributes: [] },
  ]

  it('accepts a fully-wired diagram', () => {
    const result = DiagramSchema.safeParse(
      minimalDiagram({
        entities: twoEntities,
        relationships: [
          { id: 'rel_1', participants: [{ entityId: 'ent_1' }, { entityId: 'ent_2' }] },
        ],
      }),
    )

    expect(result.success).toBe(true)
  })

  it('rejects a relationship pointing at a non-existent entity', () => {
    const result = DiagramSchema.safeParse(
      minimalDiagram({
        entities: twoEntities,
        relationships: [
          { id: 'rel_1', participants: [{ entityId: 'ent_1' }, { entityId: 'ent_MISSING' }] },
        ],
      }),
    )

    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toContain("unknown entity 'ent_MISSING'")
  })

  it('rejects duplicate entity ids', () => {
    const result = DiagramSchema.safeParse(
      minimalDiagram({ entities: [twoEntities[0]!, twoEntities[0]!] }),
    )

    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toContain('Duplicate entity id')
  })

  it('rejects duplicate relationship ids', () => {
    const relationship = {
      id: 'rel_1',
      participants: [{ entityId: 'ent_1' }, { entityId: 'ent_2' }],
    }
    const result = DiagramSchema.safeParse(
      minimalDiagram({ entities: twoEntities, relationships: [relationship, relationship] }),
    )

    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toContain('Duplicate relationship id')
  })

  it('rejects a foreign key pointing at an unknown attribute', () => {
    const result = DiagramSchema.safeParse(
      minimalDiagram({
        entities: [
          twoEntities[0]!,
          {
            id: 'ent_2',
            name: 'ORDER',
            attributes: [
              {
                id: 'att_9',
                name: 'customer_id',
                foreignKey: { entityId: 'ent_1', attributeId: 'att_MISSING' },
              },
            ],
          },
        ],
      }),
    )

    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toContain("unknown attribute 'att_MISSING'")
  })

  it('rejects a foreign key whose attribute belongs to a different entity than it names', () => {
    // The subtle bug branded IDs cannot catch: both fields are the right TYPE, but the
    // attribute lives somewhere other than the entity the reference claims.
    const result = DiagramSchema.safeParse(
      minimalDiagram({
        entities: [
          twoEntities[0]!,
          {
            id: 'ent_2',
            name: 'ORDER',
            attributes: [
              { id: 'att_5', name: 'own_field' },
              {
                id: 'att_6',
                name: 'bad_fk',
                // att_5 exists, but on ent_2 — not on ent_1 as claimed.
                foreignKey: { entityId: 'ent_1', attributeId: 'att_5' },
              },
            ],
          },
        ],
      }),
    )

    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toContain("belongs to entity 'ent_2'")
  })

  it('rejects an entity in a non-existent group', () => {
    const result = DiagramSchema.safeParse(
      minimalDiagram({ entities: [{ id: 'ent_1', name: 'X', groupId: 'grp_MISSING' }] }),
    )

    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toContain("unknown group 'grp_MISSING'")
  })

  it('rejects an ISA subtype whose supertype does not exist', () => {
    const result = DiagramSchema.safeParse(
      minimalDiagram({ entities: [{ id: 'ent_1', name: 'X', parentId: 'ent_MISSING' }] }),
    )

    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toContain('Supertype references unknown entity')
  })

  it('tolerates a stale layout entry for a deleted entity', () => {
    // Deleting an entity and undoing the delete (FR-7.1) should restore its position,
    // so the layout map is allowed to outlive the entity it describes.
    const result = DiagramSchema.safeParse(
      minimalDiagram({ layout: { positions: { ent_GONE: { x: 1, y: 2 } } } }),
    )

    expect(result.success).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('viewport bounds mirror FR-2.1 (10%–300%)', () => {
  const layoutWithZoom = (zoom: number): unknown => ({
    positions: {},
    pinned: [],
    viewport: { x: 0, y: 0, zoom },
  })

  it.each([
    [0.09, false],
    [0.1, true],
    [1, true],
    [3, true],
    [3.01, false],
  ])('zoom %f → valid: %s', (zoom, expected) => {
    expect(LayoutStateSchema.safeParse(layoutWithZoom(zoom)).success).toBe(expected)
  })

  it('rejects a non-finite position', () => {
    expect(
      LayoutStateSchema.safeParse({ positions: { ent_1: { x: Number.NaN, y: 0 } } }).success,
    ).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('round-trip stability', () => {
  it('re-parsing a parsed diagram is a fixed point', () => {
    // Guards the format against a default that is not idempotent — the class of bug
    // that makes a file change every time it is opened and saved.
    const once = DiagramSchema.parse(
      minimalDiagram({
        entities: [
          {
            id: 'ent_1',
            name: 'CUSTOMER',
            attributes: [{ id: 'att_1', name: 'id', isPrimaryKey: true }],
          },
          { id: 'ent_2', name: 'ORDER' },
        ],
        relationships: [
          {
            id: 'rel_1',
            name: 'places',
            participants: [
              { entityId: 'ent_1', cardinality: 'one', participation: 'total' },
              { entityId: 'ent_2' },
            ],
          },
        ],
      }),
    )

    const twice = DiagramSchema.parse(JSON.parse(JSON.stringify(once)))

    expect(twice).toEqual(once)
  })

  it('survives JSON serialisation without gaining undefined-valued keys', () => {
    const diagram = DiagramSchema.parse(minimalDiagram({ entities: [{ id: 'ent_1', name: 'X' }] }))
    const serialised = JSON.stringify(diagram)

    expect(serialised).not.toContain('null')
    expect(DiagramSchema.safeParse(JSON.parse(serialised)).success).toBe(true)
  })
})
