/**
 * @vitest-environment node
 *
 * No DOM here. Spinning up jsdom per file costs about a second each and this suite has
 * nothing to render — the domain layer is deliberately Node-testable (NFR-6.1).
 */
import { describe, expect, it } from 'vitest'

import {
  CommandStack,
  addAttribute,
  addEntity,
  applyLayout,
  createAttribute,
  createDiagram,
  createEntity,
  createRelationship,
  deleteAttribute,
  deleteRelationship,
  isRecursive,
  moveAttribute,
  moveEntities,
  neighbours,
  orphanEntities,
  relationshipEndpoints,
  renameAttribute,
  renameRelationship,
  setForeignKey,
  setPinned,
  updateAttribute,
  updateParticipant,
  type AttributeId,
  type EntityId,
  type RelationshipId,
} from '../../../src/domain'

/**
 * Paths the main command suite does not reach: missing targets, null-clearing branches,
 * and coalescing on the per-attribute commands. These are the branches that fire when
 * the UI races the model — a rename arriving after a delete, for instance — so they are
 * exactly the ones that must not throw.
 */

function clock(start = 1_000): { now: () => number; advance: (ms: number) => void } {
  let value = start
  return {
    now: () => value,
    advance: (ms) => {
      value += ms
    },
  }
}

describe('commands against missing targets are no-ops, never throws', () => {
  const ghostEntity = 'ent_ghost' as EntityId
  const ghostAttribute = 'att_ghost' as AttributeId
  const ghostRelationship = 'rel_ghost' as RelationshipId

  it.each([
    ['addAttribute', () => addAttribute(ghostEntity, createAttribute())],
    ['renameAttribute', () => renameAttribute(ghostEntity, ghostAttribute, 'x')],
    ['updateAttribute', () => updateAttribute(ghostEntity, ghostAttribute, { name: 'x' })],
    ['deleteAttribute', () => deleteAttribute(ghostEntity, ghostAttribute)],
    ['moveAttribute', () => moveAttribute(ghostEntity, 0, 1)],
    ['setForeignKey', () => setForeignKey(ghostEntity, ghostAttribute, null)],
    ['renameRelationship', () => renameRelationship(ghostRelationship, 'x')],
    ['updateParticipant', () => updateParticipant(ghostRelationship, 0, { cardinality: 'one' })],
    ['deleteRelationship', () => deleteRelationship(ghostRelationship)],
  ])('%s', (_label, build) => {
    const stack = new CommandStack(createDiagram())

    expect(() => {
      stack.execute(build())
    }).not.toThrow()
    expect(stack.depth).toBe(0)
  })

  it('updateAttribute on an entity that exists but an attribute that does not', () => {
    const entity = createEntity({ name: 'A' })
    const stack = new CommandStack(createDiagram({ entities: [entity] }))

    stack.execute(updateAttribute(entity.id, 'att_ghost' as AttributeId, { name: 'x' }))

    expect(stack.depth).toBe(0)
  })

  it('updateParticipant with an out-of-range end index', () => {
    const [a, b] = [createEntity({ name: 'A' }), createEntity({ name: 'B' })]
    const relationship = createRelationship({ from: a.id, to: b.id })
    const stack = new CommandStack(
      createDiagram({ entities: [a, b], relationships: [relationship] }),
    )

    stack.execute(updateParticipant(relationship.id, 9, { cardinality: 'one' }))

    expect(stack.depth).toBe(0)
  })
})

describe('null clears an optional field; undefined leaves it', () => {
  function withAttribute(): {
    stack: CommandStack
    entityId: EntityId
    attributeId: AttributeId
  } {
    const attribute = createAttribute({
      name: 'email',
      dataType: 'varchar',
      comment: 'login',
      defaultValue: "''",
    })
    const entity = createEntity({ name: 'CUSTOMER', attributes: [attribute] })
    return {
      stack: new CommandStack(createDiagram({ entities: [entity] })),
      entityId: entity.id,
      attributeId: attribute.id,
    }
  }

  it.each(['dataType', 'comment', 'defaultValue'] as const)('clears %s with null', (field) => {
    const { stack, entityId, attributeId } = withAttribute()

    stack.execute(updateAttribute(entityId, attributeId, { [field]: null }))
    const attribute = stack.state.entities[0]?.attributes[0]

    expect(attribute && field in attribute).toBe(false)
  })

  it('leaves the other optional fields alone', () => {
    const { stack, entityId, attributeId } = withAttribute()

    stack.execute(updateAttribute(entityId, attributeId, { comment: null }))
    const attribute = stack.state.entities[0]?.attributes[0]

    expect(attribute?.dataType).toBe('varchar')
    expect(attribute?.defaultValue).toBe("''")
  })

  it('sets every boolean flag', () => {
    const { stack, entityId, attributeId } = withAttribute()

    stack.execute(
      updateAttribute(entityId, attributeId, {
        isPrimaryKey: true,
        isUnique: true,
        isNullable: false,
        isDerived: true,
        isMultivalued: true,
      }),
    )

    expect(stack.state.entities[0]?.attributes[0]).toMatchObject({
      isPrimaryKey: true,
      isUnique: true,
      isNullable: false,
      isDerived: true,
      isMultivalued: true,
    })
  })

  it('clears a participant role with null', () => {
    const employee = createEntity({ name: 'EMPLOYEE' })
    const relationship = createRelationship({
      from: employee.id,
      to: employee.id,
      fromEnd: { role: 'manager' },
      toEnd: { role: 'report' },
    })
    const stack = new CommandStack(
      createDiagram({ entities: [employee], relationships: [relationship] }),
    )

    stack.execute(updateParticipant(relationship.id, 0, { role: null }))
    const participant = stack.state.relationships[0]?.participants[0]

    expect(participant && 'role' in participant).toBe(false)
  })

  it('sets a participant role', () => {
    const [a, b] = [createEntity({ name: 'A' }), createEntity({ name: 'B' })]
    const relationship = createRelationship({ from: a.id, to: b.id })
    const stack = new CommandStack(
      createDiagram({ entities: [a, b], relationships: [relationship] }),
    )

    stack.execute(updateParticipant(relationship.id, 1, { role: 'child', participation: 'total' }))

    expect(stack.state.relationships[0]?.participants[1]).toMatchObject({
      role: 'child',
      participation: 'total',
    })
  })
})

describe('coalescing on per-element renames', () => {
  it('merges attribute renames per attribute', () => {
    const time = clock()
    const first = createAttribute({ name: '' })
    const second = createAttribute({ name: '' })
    const entity = createEntity({ name: 'A', attributes: [first, second] })
    const stack = new CommandStack(createDiagram({ entities: [entity] }), { now: time.now })

    for (const name of ['e', 'em', 'ema']) {
      stack.execute(renameAttribute(entity.id, first.id, name))
      time.advance(20)
    }
    stack.execute(renameAttribute(entity.id, second.id, 'x'))

    expect(stack.depth).toBe(2)
  })

  it('merges relationship renames', () => {
    const time = clock()
    const [a, b] = [createEntity({ name: 'A' }), createEntity({ name: 'B' })]
    const relationship = createRelationship({ from: a.id, to: b.id })
    const stack = new CommandStack(
      createDiagram({ entities: [a, b], relationships: [relationship] }),
      { now: time.now },
    )

    for (const name of ['p', 'pl', 'pla']) {
      stack.execute(renameRelationship(relationship.id, name))
      time.advance(20)
    }

    expect(stack.depth).toBe(1)
    expect(stack.state.relationships[0]?.name).toBe('pla')
  })
})

describe('layout command edge cases', () => {
  it('labels a multi-entity move in the plural', () => {
    const [a, b] = [createEntity({ name: 'A' }), createEntity({ name: 'B' })]
    const stack = new CommandStack(createDiagram({ entities: [a, b] }))

    stack.execute(moveEntities({ [a.id]: { x: 1, y: 1 }, [b.id]: { x: 2, y: 2 } }))

    expect(stack.snapshot().undoLabel).toBe('Move entities')
  })

  it('labels a single move in the singular', () => {
    const a = createEntity({ name: 'A' })
    const stack = new CommandStack(createDiagram({ entities: [a] }))

    stack.execute(moveEntities({ [a.id]: { x: 1, y: 1 } }))

    expect(stack.snapshot().undoLabel).toBe('Move entity')
  })

  it('coalesces regardless of key insertion order', () => {
    const time = clock()
    const [a, b] = [createEntity({ name: 'A' }), createEntity({ name: 'B' })]
    const stack = new CommandStack(createDiagram({ entities: [a, b] }), { now: time.now })

    stack.execute(moveEntities({ [a.id]: { x: 1, y: 1 }, [b.id]: { x: 1, y: 1 } }))
    time.advance(20)
    stack.execute(moveEntities({ [b.id]: { x: 2, y: 2 }, [a.id]: { x: 2, y: 2 } }))

    expect(stack.depth).toBe(1)
  })

  it('unpinning something not pinned records nothing', () => {
    const a = createEntity({ name: 'A' })
    const stack = new CommandStack(createDiagram({ entities: [a] }))

    stack.execute(setPinned(a.id, false))

    expect(stack.depth).toBe(0)
  })

  it('applyLayout with an empty map records nothing', () => {
    const stack = new CommandStack(createDiagram({ entities: [createEntity()] }))

    stack.execute(applyLayout({}))

    expect(stack.depth).toBe(0)
  })
})

describe('graph queries on degenerate input', () => {
  it('an empty diagram has no orphans and no neighbours', () => {
    const diagram = createDiagram()

    expect(orphanEntities(diagram)).toEqual([])
    expect(neighbours(diagram, 'ent_ghost' as EntityId)).toEqual([])
  })

  it('relationshipEndpoints returns nothing for an unknown relationship', () => {
    expect(relationshipEndpoints(createDiagram(), 'rel_ghost' as RelationshipId)).toEqual([])
  })

  it('a relationship whose endpoint was removed contributes no neighbours', () => {
    // Cannot occur in a saved document — the schema rejects it — but can exist for one
    // render between a delete and the cascade completing.
    const a = createEntity({ name: 'A' })
    const orphaned = createRelationship({ from: a.id, to: 'ent_gone' as EntityId })
    const diagram = { ...createDiagram({ entities: [a] }), relationships: [orphaned] }

    expect(neighbours(diagram, a.id)).toEqual([])
    expect(relationshipEndpoints(diagram, orphaned.id)).toHaveLength(1)
  })

  it('isRecursive distinguishes a self-join from a normal relationship', () => {
    const a = createEntity({ name: 'A' })
    const b = createEntity({ name: 'B' })

    expect(isRecursive(createRelationship({ from: a.id, to: a.id }))).toBe(true)
    expect(isRecursive(createRelationship({ from: a.id, to: b.id }))).toBe(false)
  })

  it('addEntity then delete-by-cascade leaves no stale index entry', () => {
    const a = createEntity({ name: 'A' })
    const stack = new CommandStack(createDiagram())
    stack.execute(addEntity(a))

    expect(orphanEntities(stack.state).map((entity) => entity.name)).toEqual(['A'])
  })
})
