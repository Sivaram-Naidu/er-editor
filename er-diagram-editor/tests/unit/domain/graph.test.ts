/**
 * @vitest-environment node
 *
 * No DOM here. Spinning up jsdom per file costs about a second each and this suite has
 * nothing to render — the domain layer is deliberately Node-testable (NFR-6.1).
 */
import { describe, expect, it } from 'vitest'

import {
  connectedComponents,
  createAttribute,
  createDiagram,
  createEntity,
  createRelationship,
  findAttribute,
  findEntity,
  incidentRelationships,
  indexOf,
  isRecursive,
  isolate,
  neighbours,
  nHopNeighbourhood,
  orphanEntities,
  relationshipEndpoints,
  type Diagram,
  type EntityId,
} from '../../../src/domain'

/**
 * A chain plus an island:
 *
 *   A — B — C — D        E (no relationships)
 *
 * Enough to distinguish 1-hop from 2-hop, and to have something for
 * `connectedComponents` and `orphanEntities` to find.
 */
function chain(): { diagram: Diagram; ids: Record<string, EntityId> } {
  const entities = ['A', 'B', 'C', 'D', 'E'].map((name) => createEntity({ name }))
  const [a, b, c, d] = entities

  const relationships = [
    createRelationship({ from: a!.id, to: b!.id, name: 'ab' }),
    createRelationship({ from: b!.id, to: c!.id, name: 'bc' }),
    createRelationship({ from: c!.id, to: d!.id, name: 'cd' }),
  ]

  const ids = Object.fromEntries(entities.map((entity) => [entity.name, entity.id]))

  return { diagram: createDiagram({ entities, relationships }), ids }
}

describe('indexes', () => {
  it('finds entities, attributes and relationships by id', () => {
    const attribute = createAttribute({ name: 'id', isPrimaryKey: true })
    const entity = createEntity({ name: 'CUSTOMER', attributes: [attribute] })
    const diagram = createDiagram({ entities: [entity] })

    expect(findEntity(diagram, entity.id)?.name).toBe('CUSTOMER')
    expect(findAttribute(diagram, attribute.id)?.entityId).toBe(entity.id)
    expect(findEntity(diagram, 'ent_nope' as EntityId)).toBeUndefined()
  })

  it('caches per diagram object, so repeated lookups do not rebuild', () => {
    const { diagram } = chain()

    expect(indexOf(diagram)).toBe(indexOf(diagram))
  })

  it('builds a fresh index for a new diagram object', () => {
    const { diagram } = chain()
    const changed = { ...diagram, name: 'renamed' }

    // A new object means a new index — which is precisely why the cache cannot go
    // stale: there is no way to reach the old index from the new document.
    expect(indexOf(changed)).not.toBe(indexOf(diagram))
  })

  it('lists a self-referencing relationship once for its entity', () => {
    const employee = createEntity({ name: 'EMPLOYEE' })
    const diagram = createDiagram({
      entities: [employee],
      relationships: [createRelationship({ from: employee.id, to: employee.id })],
    })

    expect(indexOf(diagram).relationshipIdsByEntity.get(employee.id)).toHaveLength(1)
  })
})

describe('adjacency', () => {
  it('lists incident relationships at either end', () => {
    const { diagram, ids } = chain()

    expect(
      incidentRelationships(diagram, ids['B']!)
        .map((r) => r.name)
        .sort(),
    ).toEqual(['ab', 'bc'])
  })

  it('lists direct neighbours', () => {
    const { diagram, ids } = chain()
    const names = neighbours(diagram, ids['B']!)
      .map((entity) => entity.name)
      .sort()

    expect(names).toEqual(['A', 'C'])
  })

  it('excludes the entity itself from its own neighbours on a self-join', () => {
    const employee = createEntity({ name: 'EMPLOYEE' })
    const diagram = createDiagram({
      entities: [employee],
      relationships: [createRelationship({ from: employee.id, to: employee.id })],
    })

    expect(neighbours(diagram, employee.id)).toEqual([])
  })

  it('reports relationship endpoints, deduplicated for a self-join', () => {
    const employee = createEntity({ name: 'EMPLOYEE' })
    const self = createRelationship({ from: employee.id, to: employee.id })
    const diagram = createDiagram({ entities: [employee], relationships: [self] })

    expect(relationshipEndpoints(diagram, self.id)).toHaveLength(1)
    expect(isRecursive(self)).toBe(true)
  })

  it('finds orphan entities (FR-8.3)', () => {
    const { diagram } = chain()

    expect(orphanEntities(diagram).map((entity) => entity.name)).toEqual(['E'])
  })
})

describe('nHopNeighbourhood', () => {
  it('depth 0 returns just the seed', () => {
    const { diagram, ids } = chain()
    const result = nHopNeighbourhood(diagram, [ids['B']!], 0)

    expect([...result.entityIds]).toEqual([ids['B']])
    expect(result.relationshipIds.size).toBe(0)
  })

  it('depth 1 is the hover case: the entity, its connectors, and their far ends', () => {
    const { diagram, ids } = chain()
    const result = nHopNeighbourhood(diagram, [ids['B']!], 1)

    expect(result.entityIds.size).toBe(3)
    expect(result.entityIds.has(ids['A']!)).toBe(true)
    expect(result.entityIds.has(ids['C']!)).toBe(true)
    expect(result.relationshipIds.size).toBe(2)
  })

  it('depth 2 reaches two hops', () => {
    const { diagram, ids } = chain()
    const result = nHopNeighbourhood(diagram, [ids['A']!], 2)

    expect(result.entityIds.has(ids['C']!)).toBe(true)
    expect(result.entityIds.has(ids['D']!)).toBe(false)
  })

  it('records hop distance so the renderer can fade by depth', () => {
    const { diagram, ids } = chain()
    const result = nHopNeighbourhood(diagram, [ids['A']!], 3)

    expect(result.depthByEntity.get(ids['A']!)).toBe(0)
    expect(result.depthByEntity.get(ids['B']!)).toBe(1)
    expect(result.depthByEntity.get(ids['C']!)).toBe(2)
    expect(result.depthByEntity.get(ids['D']!)).toBe(3)
  })

  it('includes a connector whose far end is beyond the depth limit', () => {
    // FR-4.2 wants the relationship highlighted even when the entity it leads to stays
    // dimmed, so relationships are collected on traversal rather than on arrival.
    const { diagram, ids } = chain()
    const result = nHopNeighbourhood(diagram, [ids['A']!], 1)

    expect(result.entityIds.has(ids['C']!)).toBe(false)
    expect(result.relationshipIds.size).toBe(1)
  })

  it('accepts multiple seeds', () => {
    const { diagram, ids } = chain()
    const result = nHopNeighbourhood(diagram, [ids['A']!, ids['D']!], 0)

    expect(result.entityIds.size).toBe(2)
  })

  it('ignores unknown seeds', () => {
    const { diagram } = chain()

    expect(nHopNeighbourhood(diagram, ['ent_nope' as EntityId], 2).entityIds.size).toBe(0)
  })

  it('terminates on a cycle', () => {
    const [a, b, c] = ['A', 'B', 'C'].map((name) => createEntity({ name }))
    const diagram = createDiagram({
      entities: [a!, b!, c!],
      relationships: [
        createRelationship({ from: a!.id, to: b!.id }),
        createRelationship({ from: b!.id, to: c!.id }),
        createRelationship({ from: c!.id, to: a!.id }),
      ],
    })

    const result = nHopNeighbourhood(diagram, [a!.id], Number.POSITIVE_INFINITY)

    expect(result.entityIds.size).toBe(3)
  })
})

describe('connectedComponents', () => {
  it('separates the chain from the island', () => {
    const { diagram } = chain()
    const components = connectedComponents(diagram)

    expect(components).toHaveLength(2)
    expect(components.map((component) => component.length).sort()).toEqual([1, 4])
  })

  it('returns nothing for an empty diagram', () => {
    expect(connectedComponents(createDiagram())).toEqual([])
  })

  it('treats every isolated entity as its own component', () => {
    const diagram = createDiagram({
      entities: [createEntity({ name: 'A' }), createEntity({ name: 'B' })],
    })

    expect(connectedComponents(diagram)).toHaveLength(2)
  })
})

describe('isolate (FR-2.8)', () => {
  it('draws the seed and everything within the hop limit', () => {
    const { diagram, ids } = chain()
    const view = isolate(diagram, [ids['B']!], 1)

    expect([...view.entityIds].sort()).toEqual([ids['A']!, ids['B']!, ids['C']!].sort())
  })

  /**
   * THE INVARIANT THE RENDERER DEPENDS ON.
   *
   * `Canvas` filters nodes by `entityIds` and edges by `relationshipIds`, separately. If
   * those two could disagree — a relationship inside the view with a participant outside
   * it — React Flow would be handed an edge pointing at a node that is not on the canvas,
   * which is a console warning and a line to nowhere rather than a crash. Asserted over
   * every depth rather than on one case, because the boundary is exactly where it would
   * go wrong.
   */
  it('never reports a relationship with an end outside the view', () => {
    const { diagram, ids } = chain()

    for (const depth of [0, 1, 2, 3, 4]) {
      for (const seed of Object.values(ids)) {
        const view = isolate(diagram, [seed], depth)

        for (const relationshipId of view.relationshipIds) {
          const relationship = diagram.relationships.find(
            (candidate) => candidate.id === relationshipId,
          )
          for (const participant of relationship?.participants ?? []) {
            expect(
              view.entityIds.has(participant.entityId),
              `at depth ${String(depth)} a drawn connector leads to a hidden entity`,
            ).toBe(true)
          }
        }
      }
    }
  })

  it('drops the connector that leads out of the view', () => {
    // B—C exists and C is hidden at depth 0, so drawing it would be a line to nowhere.
    const { diagram, ids } = chain()
    const view = isolate(diagram, [ids['B']!], 0)

    expect(view.relationshipIds.size).toBe(0)
  })

  it('counts what each boundary entity is hiding, so the view does not lie', () => {
    // At 1 hop from A: A and B are drawn, and B still connects to C. A box that looks
    // like a leaf when it is not is a false statement about the schema, not a cosmetic
    // loss — which is why this is a count rather than nothing.
    const { diagram, ids } = chain()
    const view = isolate(diagram, [ids['A']!], 1)

    expect(view.hiddenNeighbours.get(ids['B']!)).toBe(1)
    expect(view.hiddenNeighbours.has(ids['A']!)).toBe(false)
  })

  it('counts hidden TABLES, not hidden connectors', () => {
    // Two relationships between the same pair is one table you cannot see. "+2" would
    // overstate what is missing, which is the opposite of the badge's purpose.
    const [a, b] = ['A', 'B'].map((name) => createEntity({ name }))
    const diagram = createDiagram({
      entities: [a!, b!],
      relationships: [
        createRelationship({ from: a!.id, to: b!.id, name: 'one' }),
        createRelationship({ from: a!.id, to: b!.id, name: 'two' }),
      ],
    })

    expect(isolate(diagram, [a!.id], 0).hiddenNeighbours.get(a!.id)).toBe(1)
  })

  it('keeps a self-referencing relationship, which has no far end to be outside', () => {
    // FR-1.12. Both participants are the same entity, so the connector is fully inside
    // the moment that entity is — and it must not be counted as something hidden.
    const entity = createEntity({ name: 'EMPLOYEE' })
    const diagram = createDiagram({
      entities: [entity],
      relationships: [createRelationship({ from: entity.id, to: entity.id, name: 'manages' })],
    })

    const view = isolate(diagram, [entity.id], 0)

    expect(view.relationshipIds.size).toBe(1)
    expect(view.hiddenNeighbours.size).toBe(0)
  })

  it('isolates nothing when nothing is seeded', () => {
    // The editor reads this as "not isolating" and shows the whole diagram. Taking it
    // literally — draw the empty set — is a blank canvas, which is not a useful answer to
    // having pressed Escape.
    const { diagram } = chain()
    const view = isolate(diagram, [], 2)

    expect(view.entityIds.size).toBe(0)
    expect(view.relationshipIds.size).toBe(0)
  })

  it('leaves an orphan entity alone with itself', () => {
    const { diagram, ids } = chain()
    const view = isolate(diagram, [ids['E']!], 3)

    expect([...view.entityIds]).toEqual([ids['E']!])
    expect(view.hiddenNeighbours.size).toBe(0)
  })
})
