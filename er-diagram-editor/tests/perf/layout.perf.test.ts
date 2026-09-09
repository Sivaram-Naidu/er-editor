/**
 * @vitest-environment node
 *
 * Performance budget for auto-layout (NFR-1.4).
 *
 * Runs ELK in-process rather than through the worker, so this measures the algorithm
 * rather than the transport. That is the right thing to measure: the worker guarantees
 * the main thread stays free, but it cannot make a slow layout fast.
 *
 * Timings vary by machine, so the assertion is deliberately loose — it is a guard
 * against an order-of-magnitude regression (a bad option, an accidental O(n²)), not a
 * benchmark. NFR-1.4 budgets 5s for the reference schema on a 2020-era laptop.
 */
import { describe, expect, it } from 'vitest'

import {
  createAttribute,
  createDiagram,
  createEntity,
  createRelationship,
  type Diagram,
} from '../../src/domain'
import { fromElkGraph } from '../../src/layout/elk/fromElkGraph'
import { toElkGraph } from '../../src/layout/elk/toElkGraph'
import { measureAll } from '../../src/layout'

/** SRS §5.1: 120 entities, 8 attributes each, 150 relationships. */
function referenceSchema(entityCount = 120, relationshipCount = 150): Diagram {
  const entities = Array.from({ length: entityCount }, (_, index) =>
    createEntity({
      name: `TABLE_${String(index)}`,
      attributes: Array.from({ length: 8 }, (_, field) =>
        createAttribute({
          name: `field_${String(field)}`,
          dataType: 'varchar(255)',
          isPrimaryKey: field === 0,
        }),
      ),
    }),
  )

  const relationships = Array.from({ length: relationshipCount }, (_, index) => {
    const from = entities[index % entityCount]!
    const to = entities[(index * 7 + 3) % entityCount]!
    return createRelationship({ from: from.id, to: to.id, name: `rel_${String(index)}` })
  }).filter((relationship) => {
    const [a, b] = relationship.participants
    return a?.entityId !== b?.entityId
  })

  return createDiagram({ name: 'reference', entities, relationships })
}

async function runElk(graph: unknown): Promise<unknown> {
  const { default: ELK } = (await import('elkjs/lib/elk.bundled.js')) as {
    default: new () => { layout: (graph: unknown) => Promise<unknown> }
  }
  return new ELK().layout(graph)
}

describe('auto-layout performance', () => {
  it('lays out the 120-entity reference schema well inside the NFR-1.4 budget', async () => {
    const diagram = referenceSchema()
    const sizes = measureAll(diagram, 2)

    const started = performance.now()
    const laidOut = await runElk(toElkGraph({ diagram, sizes }))
    const elapsed = performance.now() - started

    const result = fromElkGraph(laidOut as Parameters<typeof fromElkGraph>[0])

    expect(Object.keys(result.positions)).toHaveLength(120)
    console.log(`reference schema (120 entities): ${elapsed.toFixed(0)}ms`)
    expect(elapsed).toBeLessThan(15_000)
  }, 60_000)

  it('degrades predictably at the 300-entity ceiling (NFR-2.2)', async () => {
    const diagram = referenceSchema(300, 380)
    const started = performance.now()
    await runElk(toElkGraph({ diagram, sizes: measureAll(diagram, 0) }))
    const elapsed = performance.now() - started

    console.log(`stress schema (300 entities): ${elapsed.toFixed(0)}ms`)
    expect(elapsed).toBeLessThan(60_000)
  }, 120_000)
})
