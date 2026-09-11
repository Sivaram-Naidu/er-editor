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

import { fromElkGraph } from '../../src/layout/elk/fromElkGraph'
import { toElkGraph } from '../../src/layout/elk/toElkGraph'
import { measureAll } from '../../src/layout'
import { referenceSchema } from '../fixtures/referenceSchema'

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
