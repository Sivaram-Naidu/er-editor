/**
 * @vitest-environment node
 *
 * The FR-8.2/FR-8.3 rule set and the validator that runs it.
 *
 * No DOM here — the whole point of putting validation in `domain` is that it is testable
 * without one (NFR-6.1). The panel that displays these issues is tested separately.
 *
 * Every rule is exercised for both outcomes (fires / stays silent) and for the specific
 * de-noising decisions written into it, because those decisions are the difference
 * between a panel people read and one they switch off.
 */
import { describe, expect, it } from 'vitest'

import {
  createAttribute,
  createDiagram,
  createEntity,
  createRelationship,
  RULES,
  SEVERITY_RANK,
  validateDiagram,
  worstSeverity,
  type Attribute,
  type Diagram,
  type Entity,
  type Issue,
  type Relationship,
} from '../../../src/domain'
// The rules and the vocabulary they share are module-internal by design — see the note
// in src/domain/validation/index.ts. Tests reach into the owning file, as the layout
// suite does for toElkGraph.
import {
  entityLabel,
  isBlank,
  relationshipLabel,
  targetKey,
} from '../../../src/domain/validation/Rule'
import { duplicateNames } from '../../../src/domain/validation/rules/duplicate-names'
import { emptyName } from '../../../src/domain/validation/rules/empty-name'
import {
  canonicalType,
  foreignKeyTypeMismatch,
} from '../../../src/domain/validation/rules/fk-type-mismatch'
import { missingPrimaryKey } from '../../../src/domain/validation/rules/missing-primary-key'
import { orphanEntity } from '../../../src/domain/validation/rules/orphan-entity'
import { unnamedRelationship } from '../../../src/domain/validation/rules/unnamed-relationship'
import { unresolvedManyToMany } from '../../../src/domain/validation/rules/unresolved-many-to-many'
import { weakEntityIdentity } from '../../../src/domain/validation/rules/weak-entity-identity'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function diagramOf(entities: Entity[], relationships: Relationship[] = []): Diagram {
  return createDiagram({ entities, relationships })
}

/** Messages only, so a failure reads as prose rather than as an object dump. */
function messages(issues: readonly Issue[]): string[] {
  return issues.map((found) => found.message)
}

function pk(name: string, dataType?: string): Attribute {
  return createAttribute({
    name,
    isPrimaryKey: true,
    ...(dataType === undefined ? {} : { dataType }),
  })
}

/**
 * Attach a foreign key to a freshly minted attribute.
 *
 * `createAttribute` has no `foreignKey` option — references are set through
 * `setForeignKey` in normal use — so the tests attach it directly.
 */
function referencing(attribute: Attribute, entityId: Entity['id'], attributeId: string): Attribute {
  return {
    ...attribute,
    foreignKey: { entityId, attributeId: attributeId as Attribute['id'] },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared vocabulary
// ─────────────────────────────────────────────────────────────────────────────

describe('the rule vocabulary', () => {
  it('treats a whitespace-only name as absent', () => {
    expect(isBlank('')).toBe(true)
    expect(isBlank('   ')).toBe(true)
    expect(isBlank('\t\n')).toBe(true)
    expect(isBlank('a')).toBe(false)
    expect(isBlank('  a  ')).toBe(false)
  })

  it('names an unnamed entity the same way the canvas does', () => {
    expect(entityLabel(createEntity({ name: 'CUSTOMER' }))).toBe('CUSTOMER')
    expect(entityLabel(createEntity({ name: '   ' }))).toBe('unnamed entity')
  })

  it('describes an unnamed relationship by its ends', () => {
    const a = createEntity({ name: 'STUDENT' })
    const b = createEntity({ name: 'COURSE' })
    const byId = new Map([a, b].map((entity) => [entity.id, entity]))

    const named = createRelationship({ from: a.id, to: b.id, name: 'enrols in' })
    expect(relationshipLabel(named, byId)).toBe('enrols in')

    const unnamed = createRelationship({ from: a.id, to: b.id })
    expect(relationshipLabel(unnamed, byId)).toBe('the relationship between STUDENT and COURSE')
  })

  it('falls back to "unknown" for an end it cannot resolve', () => {
    // Deliberately an empty map: the label helper must not throw on a participant whose
    // entity is missing, even though the schema makes that unreachable in a real load.
    const a = createEntity({ name: 'STUDENT' })
    const b = createEntity({ name: 'COURSE' })
    const relationship = createRelationship({ from: a.id, to: b.id })

    expect(relationshipLabel(relationship, new Map())).toBe(
      'the relationship between unknown and unknown',
    )
  })

  it('keys each target kind distinctly', () => {
    const entity = createEntity({ name: 'A' })
    const attribute = pk('id')
    const relationship = createRelationship({ from: entity.id, to: entity.id })

    expect(targetKey({ kind: 'entity', entityId: entity.id })).toBe(`entity:${entity.id}`)
    expect(targetKey({ kind: 'attribute', entityId: entity.id, attributeId: attribute.id })).toBe(
      `attribute:${entity.id}/${attribute.id}`,
    )
    expect(targetKey({ kind: 'relationship', relationshipId: relationship.id })).toBe(
      `relationship:${relationship.id}`,
    )
  })

  it('ranks severities worst-first and reduces pairs to the worse one', () => {
    expect(SEVERITY_RANK.error).toBeLessThan(SEVERITY_RANK.warning)
    expect(SEVERITY_RANK.warning).toBeLessThan(SEVERITY_RANK.info)

    // Both argument orders, because `worstSeverity` is used as a fold and must be
    // commutative or the accumulated marker severity would depend on issue order.
    expect(worstSeverity('warning', 'error')).toBe('error')
    expect(worstSeverity('error', 'warning')).toBe('error')
    expect(worstSeverity('info', 'warning')).toBe('warning')
    expect(worstSeverity('warning', 'info')).toBe('warning')
    expect(worstSeverity('error', 'error')).toBe('error')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// empty-name (FR-8.2)
// ─────────────────────────────────────────────────────────────────────────────

describe('empty-name', () => {
  it('reports an entity with no name', () => {
    const issues = emptyName.check(diagramOf([createEntity({ name: '' })]))

    expect(issues).toHaveLength(1)
    expect(issues[0]!.severity).toBe('error')
    expect(issues[0]!.target.kind).toBe('entity')
    expect(issues[0]!.message).toBe('This entity has no name.')
  })

  it('reports a name that is only whitespace', () => {
    expect(emptyName.check(diagramOf([createEntity({ name: '  \t ' })]))).toHaveLength(1)
  })

  it('reports an unnamed field and says which entity it is on', () => {
    const entity = createEntity({ name: 'CUSTOMER', attributes: [createAttribute({ name: '' })] })
    const issues = emptyName.check(diagramOf([entity]))

    expect(issues).toHaveLength(1)
    expect(issues[0]!.target).toEqual({
      kind: 'attribute',
      entityId: entity.id,
      attributeId: entity.attributes[0]!.id,
    })
    expect(issues[0]!.message).toBe('A field on CUSTOMER has no name.')
  })

  it('reports the entity and the field separately when both are unnamed', () => {
    const entity = createEntity({ name: '', attributes: [createAttribute({ name: '' })] })
    const issues = emptyName.check(diagramOf([entity]))

    expect(issues).toHaveLength(2)
    expect(messages(issues)).toContain('A field on unnamed entity has no name.')
  })

  it('stays silent on a fully named entity', () => {
    const entity = createEntity({ name: 'CUSTOMER', attributes: [pk('id')] })
    expect(emptyName.check(diagramOf([entity]))).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// duplicate-names (FR-8.2)
// ─────────────────────────────────────────────────────────────────────────────

describe('duplicate-names', () => {
  it('reports every member of a clash, not just the later one', () => {
    const issues = duplicateNames.check(
      diagramOf([createEntity({ name: 'ORDER' }), createEntity({ name: 'ORDER' })]),
    )

    expect(issues).toHaveLength(2)
    expect(issues.every((found) => found.severity === 'error')).toBe(true)
    expect(issues[0]!.message).toContain('2 entities are named "ORDER"')
  })

  it('counts a three-way clash correctly', () => {
    const issues = duplicateNames.check(
      diagramOf(['ORDER', 'ORDER', 'ORDER'].map((name) => createEntity({ name }))),
    )

    expect(issues).toHaveLength(3)
    expect(issues[0]!.message).toContain('3 entities are named')
  })

  it('catches a clash that differs only by case, because the database would too', () => {
    const issues = duplicateNames.check(
      diagramOf([createEntity({ name: 'Order' }), createEntity({ name: 'ORDER' })]),
    )

    expect(issues).toHaveLength(2)
  })

  it('catches a clash that differs only by surrounding whitespace', () => {
    const issues = duplicateNames.check(
      diagramOf([createEntity({ name: 'ORDER' }), createEntity({ name: '  ORDER ' })]),
    )

    expect(issues).toHaveLength(2)
  })

  it('leaves genuinely distinct names alone', () => {
    const issues = duplicateNames.check(
      diagramOf([createEntity({ name: 'ORDER' }), createEntity({ name: 'ORDER_LINE' })]),
    )

    expect(issues).toEqual([])
  })

  it('does not also call two blank names a clash', () => {
    // empty-name owns this. Reporting it twice would be two errors about one problem.
    const issues = duplicateNames.check(
      diagramOf([createEntity({ name: '' }), createEntity({ name: '   ' })]),
    )

    expect(issues).toEqual([])
  })

  it('reports duplicate fields within one entity', () => {
    const entity = createEntity({
      name: 'CUSTOMER',
      attributes: [createAttribute({ name: 'email' }), createAttribute({ name: 'EMAIL' })],
    })
    const issues = duplicateNames.check(diagramOf([entity]))

    expect(issues).toHaveLength(2)
    expect(issues[0]!.message).toBe('CUSTOMER has 2 fields named "email".')
    expect(issues[0]!.target.kind).toBe('attribute')
  })

  it('scopes field clashes to their own entity', () => {
    // `id` on two different tables is not a clash — it is the most common column name
    // there is.
    const a = createEntity({ name: 'CUSTOMER', attributes: [pk('id')] })
    const b = createEntity({ name: 'ORDER', attributes: [pk('id')] })

    expect(duplicateNames.check(diagramOf([a, b]))).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// weak-entity-identity (FR-8.2)
// ─────────────────────────────────────────────────────────────────────────────

describe('weak-entity-identity', () => {
  it('reports a weak entity with no relationships at all', () => {
    const weak = createEntity({ name: 'ORDER_LINE', kind: 'weak' })
    const issues = weakEntityIdentity.check(diagramOf([weak]))

    expect(issues).toHaveLength(1)
    expect(issues[0]!.severity).toBe('error')
    expect(issues[0]!.message).toContain('ORDER_LINE is a weak entity')
  })

  it('reports a weak entity whose only relationship is not identifying', () => {
    const owner = createEntity({ name: 'ORDER' })
    const weak = createEntity({ name: 'ORDER_LINE', kind: 'weak' })
    const relationship = createRelationship({ from: owner.id, to: weak.id })

    expect(weakEntityIdentity.check(diagramOf([owner, weak], [relationship]))).toHaveLength(1)
  })

  it('is satisfied by an identifying relationship', () => {
    const owner = createEntity({ name: 'ORDER' })
    const weak = createEntity({ name: 'ORDER_LINE', kind: 'weak' })
    const relationship = createRelationship({
      from: owner.id,
      to: weak.id,
      isIdentifying: true,
    })

    expect(weakEntityIdentity.check(diagramOf([owner, weak], [relationship]))).toEqual([])
  })

  it('says nothing about strong or associative entities', () => {
    const strong = createEntity({ name: 'CUSTOMER' })
    const associative = createEntity({ name: 'ENROLMENT', kind: 'associative' })

    expect(weakEntityIdentity.check(diagramOf([strong, associative]))).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// missing-primary-key (FR-8.3)
// ─────────────────────────────────────────────────────────────────────────────

describe('missing-primary-key', () => {
  it('warns about an entity with fields but no key', () => {
    const entity = createEntity({
      name: 'CUSTOMER',
      attributes: [createAttribute({ name: 'email' })],
    })
    const issues = missingPrimaryKey.check(diagramOf([entity]))

    expect(issues).toHaveLength(1)
    expect(issues[0]!.severity).toBe('warning')
    expect(issues[0]!.message).toBe(
      'CUSTOMER has no primary key, so its rows cannot be told apart.',
    )
  })

  it('warns about an entity with no fields at all', () => {
    expect(missingPrimaryKey.check(diagramOf([createEntity({ name: 'CUSTOMER' })]))).toHaveLength(1)
  })

  it('is satisfied by a single primary key field', () => {
    const entity = createEntity({ name: 'CUSTOMER', attributes: [pk('id')] })
    expect(missingPrimaryKey.check(diagramOf([entity]))).toEqual([])
  })

  it('words it differently for a weak entity, which has a partial key rather than a PK', () => {
    const weak = createEntity({ name: 'ORDER_LINE', kind: 'weak' })
    const issues = missingPrimaryKey.check(diagramOf([weak]))

    expect(issues).toHaveLength(1)
    expect(issues[0]!.message).toContain('is a weak entity but no field is marked as its key')
    expect(issues[0]!.message).not.toContain('has no primary key')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// orphan-entity (FR-8.3)
// ─────────────────────────────────────────────────────────────────────────────

describe('orphan-entity', () => {
  it('says nothing about a lone entity, which has nothing to connect to', () => {
    expect(orphanEntity.check(diagramOf([createEntity({ name: 'CUSTOMER' })]))).toEqual([])
  })

  it('says nothing about an empty diagram', () => {
    expect(orphanEntity.check(diagramOf([]))).toEqual([])
  })

  it('warns about both entities once there are two and neither is connected', () => {
    const issues = orphanEntity.check(
      diagramOf([createEntity({ name: 'CUSTOMER' }), createEntity({ name: 'PRODUCT' })]),
    )

    expect(issues).toHaveLength(2)
    expect(issues[0]!.severity).toBe('warning')
  })

  it('is satisfied once they are connected', () => {
    const a = createEntity({ name: 'CUSTOMER' })
    const b = createEntity({ name: 'ORDER' })
    const relationship = createRelationship({ from: a.id, to: b.id })

    expect(orphanEntity.check(diagramOf([a, b], [relationship]))).toEqual([])
  })

  it('picks out the one isolated entity among connected ones', () => {
    const a = createEntity({ name: 'CUSTOMER' })
    const b = createEntity({ name: 'ORDER' })
    const island = createEntity({ name: 'AUDIT_LOG' })
    const relationship = createRelationship({ from: a.id, to: b.id })

    const issues = orphanEntity.check(diagramOf([a, b, island], [relationship]))

    expect(issues).toHaveLength(1)
    expect(issues[0]!.message).toContain('AUDIT_LOG')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// fk-type-mismatch (FR-8.3)
// ─────────────────────────────────────────────────────────────────────────────

describe('canonicalType', () => {
  it('folds spellings of the integer family together', () => {
    for (const spelling of ['int', 'INT', 'integer', 'int4', 'serial', 'serial4', ' Integer ']) {
      expect(canonicalType(spelling)).toBe('int')
    }
    for (const spelling of ['int8', 'bigint', 'bigserial', 'serial8']) {
      expect(canonicalType(spelling)).toBe('bigint')
    }
    for (const spelling of ['int2', 'smallint', 'smallserial', 'serial2']) {
      expect(canonicalType(spelling)).toBe('smallint')
    }
  })

  it('drops integer display width, which carries no type information', () => {
    expect(canonicalType('int(11)')).toBe('int')
    expect(canonicalType('bigint(20)')).toBe('bigint')
  })

  it('keeps precision on types where it changes what fits', () => {
    expect(canonicalType('varchar(255)')).toBe('varchar(255)')
    expect(canonicalType('character varying(255)')).toBe('varchar(255)')
    expect(canonicalType('numeric(10, 2)')).toBe('numeric(10,2)')
    expect(canonicalType('DECIMAL( 10 , 2 )')).toBe('numeric(10,2)')
  })

  it('folds the remaining common synonym pairs', () => {
    expect(canonicalType('bool')).toBe('boolean')
    expect(canonicalType('character')).toBe('char')
    expect(canonicalType('float8')).toBe('double precision')
    // Our own SQL importer shortens `double precision` to `double`, so both spellings
    // occur in one diagram whenever an imported table meets a hand-typed one.
    expect(canonicalType('double')).toBe('double precision')
    expect(canonicalType('double')).toBe(canonicalType('double precision'))
    expect(canonicalType('float4')).toBe('real')
    expect(canonicalType('timestamp with time zone')).toBe('timestamptz')
    expect(canonicalType('timestamp without time zone')).toBe('timestamp')
    expect(canonicalType('time with time zone')).toBe('timetz')
    expect(canonicalType('time without time zone')).toBe('time')
  })

  it('preserves the with/without-time-zone distinction, which changes the meaning', () => {
    expect(canonicalType('timestamptz')).not.toBe(canonicalType('timestamp'))
  })

  it('normalises the spelling of a type it does not know, but keeps it intact', () => {
    expect(canonicalType('  MY_ENUM  ')).toBe('my_enum')
    expect(canonicalType('geography(Point, 4326)')).toBe('geography(point,4326)')
  })

  it('collapses internal whitespace so one spelling cannot beat another on spacing', () => {
    expect(canonicalType('character   varying(30)')).toBe('varchar(30)')
  })
})

describe('fk-type-mismatch', () => {
  /** ORDER.customer_id -> CUSTOMER.id, with the two types under test. */
  function pointingAt(fkType: string | undefined, pkType: string | undefined): Diagram {
    const key = pk('id', pkType)
    const customer = createEntity({ name: 'CUSTOMER', attributes: [key] })

    const reference = referencing(
      createAttribute({
        name: 'customer_id',
        ...(fkType === undefined ? {} : { dataType: fkType }),
      }),
      customer.id,
      key.id,
    )
    const order = createEntity({ name: 'ORDER', attributes: [reference] })

    return diagramOf([customer, order])
  }

  it('warns when the two types genuinely differ', () => {
    const issues = foreignKeyTypeMismatch.check(pointingAt('text', 'integer'))

    expect(issues).toHaveLength(1)
    expect(issues[0]!.severity).toBe('warning')
    expect(issues[0]!.message).toBe(
      'ORDER.customer_id is text but references CUSTOMER.id, which is integer.',
    )
  })

  it('stays silent when the types match exactly', () => {
    expect(foreignKeyTypeMismatch.check(pointingAt('integer', 'integer'))).toEqual([])
  })

  it('stays silent on integer vs serial, which is the commonest Postgres shape', () => {
    expect(foreignKeyTypeMismatch.check(pointingAt('integer', 'serial'))).toEqual([])
  })

  it('stays silent on varchar vs character varying', () => {
    expect(
      foreignKeyTypeMismatch.check(pointingAt('varchar(20)', 'character varying(20)')),
    ).toEqual([])
  })

  it('stays silent on MySQL display width', () => {
    expect(foreignKeyTypeMismatch.check(pointingAt('int(11)', 'int'))).toEqual([])
  })

  it('stays silent when an imported column meets a hand-typed one', () => {
    // `io/formats/sql/import.ts` writes `double` where the DDL said `double precision`.
    // A schema that was partly imported and partly authored holds both spellings.
    expect(foreignKeyTypeMismatch.check(pointingAt('double', 'double precision'))).toEqual([])
  })

  it('warns when a reference is narrower than the key it points at', () => {
    expect(foreignKeyTypeMismatch.check(pointingAt('varchar(50)', 'varchar(255)'))).toHaveLength(1)
  })

  it('warns across the time-zone distinction', () => {
    expect(foreignKeyTypeMismatch.check(pointingAt('timestamp', 'timestamptz'))).toHaveLength(1)
  })

  it('says nothing when either side has no type — that is unknown, not mismatched', () => {
    expect(foreignKeyTypeMismatch.check(pointingAt(undefined, 'integer'))).toEqual([])
    expect(foreignKeyTypeMismatch.check(pointingAt('integer', undefined))).toEqual([])
    expect(foreignKeyTypeMismatch.check(pointingAt(undefined, undefined))).toEqual([])
    expect(foreignKeyTypeMismatch.check(pointingAt('   ', 'integer'))).toEqual([])
    expect(foreignKeyTypeMismatch.check(pointingAt('integer', '  '))).toEqual([])
  })

  it('says nothing about an attribute with no foreign key', () => {
    const entity = createEntity({ name: 'CUSTOMER', attributes: [pk('id', 'integer')] })
    expect(foreignKeyTypeMismatch.check(diagramOf([entity]))).toEqual([])
  })

  it('does not throw when the referenced attribute is missing', () => {
    // Unreachable through a parsed document — the schema enforces FK integrity and both
    // delete commands clear inbound references — but the rule is pure and must not
    // assume its caller parsed anything.
    const customer = createEntity({ name: 'CUSTOMER', attributes: [pk('id', 'integer')] })
    const dangling = referencing(
      createAttribute({ name: 'customer_id', dataType: 'text' }),
      customer.id,
      'attr_does_not_exist',
    )
    const order = createEntity({ name: 'ORDER', attributes: [dangling] })

    expect(foreignKeyTypeMismatch.check(diagramOf([customer, order]))).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// unnamed-relationship (FR-8.3)
// ─────────────────────────────────────────────────────────────────────────────

describe('unnamed-relationship', () => {
  it('warns about a relationship with no name', () => {
    const a = createEntity({ name: 'CUSTOMER' })
    const b = createEntity({ name: 'ORDER' })
    const relationship = createRelationship({ from: a.id, to: b.id })

    const issues = unnamedRelationship.check(diagramOf([a, b], [relationship]))

    expect(issues).toHaveLength(1)
    expect(issues[0]!.severity).toBe('warning')
    expect(issues[0]!.target).toEqual({ kind: 'relationship', relationshipId: relationship.id })
    expect(issues[0]!.message).toContain('the relationship between CUSTOMER and ORDER')
  })

  it('is satisfied by any non-blank name', () => {
    const a = createEntity({ name: 'CUSTOMER' })
    const b = createEntity({ name: 'ORDER' })
    const relationship = createRelationship({ from: a.id, to: b.id, name: 'places' })

    expect(unnamedRelationship.check(diagramOf([a, b], [relationship]))).toEqual([])
  })

  it('treats a whitespace-only name as no name', () => {
    const a = createEntity({ name: 'CUSTOMER' })
    const b = createEntity({ name: 'ORDER' })
    const relationship = createRelationship({ from: a.id, to: b.id, name: '  ' })

    expect(unnamedRelationship.check(diagramOf([a, b], [relationship]))).toHaveLength(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// unresolved-many-to-many (FR-8.3, reported at info — see the rule's header)
// ─────────────────────────────────────────────────────────────────────────────

describe('unresolved-many-to-many', () => {
  it('notes an M:N relationship at info level, not as a warning', () => {
    const a = createEntity({ name: 'STUDENT' })
    const b = createEntity({ name: 'COURSE' })
    const relationship = createRelationship({
      from: a.id,
      to: b.id,
      name: 'enrols in',
      fromEnd: { cardinality: 'many' },
      toEnd: { cardinality: 'many' },
    })

    const issues = unresolvedManyToMany.check(diagramOf([a, b], [relationship]))

    expect(issues).toHaveLength(1)
    expect(issues[0]!.severity).toBe('info')
    expect(issues[0]!.target).toEqual({ kind: 'relationship', relationshipId: relationship.id })
    expect(issues[0]!.message).toContain('many-to-many')
  })

  it('says nothing about the 1:N default that drag-to-connect produces', () => {
    const a = createEntity({ name: 'CUSTOMER' })
    const b = createEntity({ name: 'ORDER' })
    const relationship = createRelationship({ from: a.id, to: b.id })

    expect(unresolvedManyToMany.check(diagramOf([a, b], [relationship]))).toEqual([])
  })

  it('says nothing when only one end is many', () => {
    const a = createEntity({ name: 'CUSTOMER' })
    const b = createEntity({ name: 'ORDER' })
    const relationship = createRelationship({
      from: a.id,
      to: b.id,
      fromEnd: { cardinality: 'many' },
      toEnd: { cardinality: 'one' },
    })

    expect(unresolvedManyToMany.check(diagramOf([a, b], [relationship]))).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The validator
// ─────────────────────────────────────────────────────────────────────────────

describe('validateDiagram', () => {
  /**
   * One diagram carrying findings from every tier:
   *
   *   CUSTOMER  — named, has a PK, connected. Clean.
   *   ORDER     — named, has a PK, connected, but its FK type disagrees. Warning.
   *   (blank)   — unnamed, unconnected, no PK. Error plus warnings.
   *   the M:N   — info.
   */
  function mixed(): Diagram {
    const customerKey = pk('id', 'integer')
    const customer = createEntity({ name: 'CUSTOMER', attributes: [customerKey] })

    const orderFk = referencing(
      createAttribute({ name: 'customer_id', dataType: 'text' }),
      customer.id,
      customerKey.id,
    )
    const order = createEntity({ name: 'ORDER', attributes: [pk('id', 'integer'), orderFk] })

    const nameless = createEntity({ name: '' })

    const places = createRelationship({ from: customer.id, to: order.id, name: 'places' })
    const tags = createRelationship({
      from: customer.id,
      to: order.id,
      name: 'tagged with',
      fromEnd: { cardinality: 'many' },
      toEnd: { cardinality: 'many' },
    })

    return diagramOf([customer, order, nameless], [places, tags])
  }

  it('runs every registered rule, each declared once', () => {
    expect(RULES).toHaveLength(8)
    expect(new Set(RULES.map((rule) => rule.id)).size).toBe(RULES.length)
  })

  it('sorts errors before warnings before info', () => {
    const { issues } = validateDiagram(mixed())
    const ranks = issues.map((found) => SEVERITY_RANK[found.severity])

    expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
  })

  it('groups a severity tier by rule, so the panel reads as a checklist', () => {
    const entities = ['', '', ''].map((name) => createEntity({ name }))
    const { issues } = validateDiagram(diagramOf(entities))
    const errorRules = issues
      .filter((found) => found.severity === 'error')
      .map((found) => found.ruleId)

    expect(errorRules).toEqual([...errorRules].sort((a, b) => a.localeCompare(b)))
  })

  it('counts each tier and keeps info out of the badge', () => {
    const report = validateDiagram(mixed())

    expect(report.counts.error).toBeGreaterThan(0)
    expect(report.counts.warning).toBeGreaterThan(0)
    expect(report.counts.info).toBe(1)
    expect(report.badgeCount).toBe(report.counts.error + report.counts.warning)
  })

  it('is empty and quiet on a clean diagram', () => {
    const a = createEntity({ name: 'CUSTOMER', attributes: [pk('id', 'integer')] })
    const b = createEntity({ name: 'ORDER', attributes: [pk('id', 'integer')] })
    const relationship = createRelationship({ from: a.id, to: b.id, name: 'places' })

    const report = validateDiagram(diagramOf([a, b], [relationship]))

    expect(report.issues).toEqual([])
    expect(report.badgeCount).toBe(0)
    expect(report.counts).toEqual({ error: 0, warning: 0, info: 0 })
    expect(report.severityByEntity.size).toBe(0)
    expect(report.severityByRelationship.size).toBe(0)
  })

  it('rolls a field-level issue up to its entity, so the marker is visible at L0', () => {
    const entity = createEntity({
      name: 'CUSTOMER',
      attributes: [pk('id'), createAttribute({ name: '' })],
    })
    const report = validateDiagram(diagramOf([entity]))

    expect(report.severityByEntity.get(entity.id)).toBe('error')
  })

  it('keeps the worst severity when one entity has issues of several tiers', () => {
    // Unnamed (error) and also without a primary key (warning).
    const entity = createEntity({ name: '' })
    const report = validateDiagram(diagramOf([entity]))

    expect(report.counts.error).toBeGreaterThan(0)
    expect(report.counts.warning).toBeGreaterThan(0)
    expect(report.severityByEntity.get(entity.id)).toBe('error')
  })

  it('indexes relationship issues separately from entity issues', () => {
    const a = createEntity({ name: 'CUSTOMER', attributes: [pk('id')] })
    const b = createEntity({ name: 'ORDER', attributes: [pk('id')] })
    const relationship = createRelationship({ from: a.id, to: b.id })

    const report = validateDiagram(diagramOf([a, b], [relationship]))

    expect(report.severityByRelationship.get(relationship.id)).toBe('warning')
    expect(report.severityByEntity.has(a.id)).toBe(false)
  })

  it('returns the identical report object for the same diagram', () => {
    // The WeakMap cache is what makes this safe to call during render from the panel,
    // the toolbar badge and the canvas at once.
    const diagram = mixed()

    expect(validateDiagram(diagram)).toBe(validateDiagram(diagram))
  })

  it('recomputes for a different diagram object, reaching the same conclusion', () => {
    const first = mixed()
    const second = { ...first }

    expect(validateDiagram(second)).not.toBe(validateDiagram(first))
    expect(validateDiagram(second).issues).toEqual(validateDiagram(first).issues)
  })

  it('gives an issue the same id across revalidation, so the panel does not churn', () => {
    const entity = createEntity({ name: '' })
    const before = validateDiagram(diagramOf([entity]))
    const after = validateDiagram(diagramOf([entity]))

    expect(after.issues.map((found) => found.id)).toEqual(before.issues.map((found) => found.id))
  })

  it('gives every issue in a report a distinct id', () => {
    const report = validateDiagram(mixed())
    const ids = report.issues.map((found) => found.id)

    expect(new Set(ids).size).toBe(ids.length)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// FR-8.5: a full revalidation is cheap enough that no diffing is needed
// ─────────────────────────────────────────────────────────────────────────────

describe('cost of a full revalidation', () => {
  /** SRS §5.1's reference shape: 120 entities, 8 fields each, 150 relationships. */
  function referenceSchema(): Diagram {
    const entities = Array.from({ length: 120 }, (_, index) =>
      createEntity({
        name: `ENTITY_${String(index)}`,
        attributes: [
          pk('id', 'integer'),
          ...Array.from({ length: 7 }, (_unused, field) =>
            createAttribute({ name: `field_${String(field)}`, dataType: 'text' }),
          ),
        ],
      }),
    )

    const relationships = Array.from({ length: 150 }, (_, index) => {
      const from = entities[index % entities.length]!
      const to = entities[(index + 1) % entities.length]!
      return createRelationship({ from: from.id, to: to.id, name: `rel_${String(index)}` })
    })

    return diagramOf(entities, relationships)
  }

  it('validates the reference schema well inside a frame', () => {
    const diagram = referenceSchema()

    // A fresh object each iteration, so the WeakMap cache cannot flatter the measurement.
    const started = performance.now()
    for (let run = 0; run < 10; run += 1) validateDiagram({ ...diagram })
    const perRun = (performance.now() - started) / 10

    // Loose by an order of magnitude, like the layout budget: this guards against an
    // accidental O(n²) in a rule, not against machine variance. It backs the claim in
    // validator.ts that a full pass is cheaper than diffing would be.
    expect(perRun).toBeLessThan(16)
  })
})
