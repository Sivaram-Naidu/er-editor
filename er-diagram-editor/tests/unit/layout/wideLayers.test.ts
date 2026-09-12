/**
 * @vitest-environment node
 *
 * No DOM here. Spinning up jsdom per file costs about a second each and this suite has
 * nothing to render — the domain layer is deliberately Node-testable (NFR-6.1).
 */
import { describe, expect, it } from 'vitest'

import { splitWideLayers, type LayerEdge } from '../../../src/layout/elk/wideLayers'

/** `a -> b` for each pair, in the shape ELK edges take. */
const edges = (...pairs: [string, string][]): LayerEdge[] =>
  pairs.map(([from, to]) => ({ sources: [from], targets: [to] }))

/** One table referenced by `count` others — the shape that becomes a ribbon. */
function hubAndSpoke(count: number): { ids: string[]; links: LayerEdge[] } {
  const spokes = Array.from({ length: count }, (_, index) => `spoke${String(index)}`)
  return {
    ids: [...spokes, 'hub'],
    links: spokes.map((spoke) => ({ sources: [spoke], targets: ['hub'] })),
  }
}

describe('splitWideLayers', () => {
  it('splits nothing when every dependency layer is comfortable', () => {
    // The load-bearing case: an ordinary schema must come out of this untouched, because an
    // empty map is what makes `toElkGraph` attach no partitions and `options.ts` leave the
    // node placement strategy alone.
    const ids = ['a', 'b', 'c', 'd']
    const links = edges(['a', 'b'], ['b', 'c'], ['c', 'd'])

    expect(splitWideLayers(ids, links).size).toBe(0)
  })

  it('splits a crowded layer into several partitions', () => {
    const { ids, links } = hubAndSpoke(40)

    const partitions = splitWideLayers(ids, links)

    // 40 spokes share depth 0; ceil(sqrt(40)) = 7 per partition, so 6 partitions, plus one
    // for the hub at depth 1.
    expect(partitions.size).toBe(41)
    expect(new Set(partitions.values()).size).toBeGreaterThan(2)
  })

  it('puts the hub after every one of its dependents', () => {
    const { ids, links } = hubAndSpoke(40)

    const partitions = splitWideLayers(ids, links)
    const hub = partitions.get('hub')
    const spokes = [...partitions.entries()].filter(([id]) => id !== 'hub')

    for (const [id, partition] of spokes) {
      expect(partition, `${id} should come before the hub`).toBeLessThan(hub!)
    }
  })

  /**
   * THE ONE THAT CAUGHT A REAL MISTAKE.
   *
   * The first version numbered layers by breadth-first distance from the hub, which walks
   * a dependency chain BACKWARDS: the table furthest from the hub got the highest index and
   * was laid out on the right, so the chain read right-to-left while the rest of the
   * diagram read left-to-right. Reading a schema left-to-right by dependency depth is the
   * whole reason ADR-0002 chose a layered algorithm, so this is not cosmetic.
   */
  it('keeps a dependency chain in order even when a hub is present', () => {
    const { ids, links } = hubAndSpoke(30)
    const chain = ['c0', 'c1', 'c2', 'c3', 'c4', 'c5']
    const withChain = [...ids, ...chain]
    const withChainLinks = [
      ...links,
      ...edges(['c0', 'c1'], ['c1', 'c2'], ['c2', 'c3'], ['c3', 'c4'], ['c4', 'c5'], ['c5', 'hub']),
    ]

    const partitions = splitWideLayers(withChain, withChainLinks)

    for (let step = 1; step < chain.length; step += 1) {
      expect(
        partitions.get(chain[step]!)!,
        `${chain[step]!} must come after ${chain[step - 1]!}`,
      ).toBeGreaterThan(partitions.get(chain[step - 1]!)!)
    }
  })

  it('ignores tables with no relationships when deciding a layer is crowded', () => {
    /*
     * A schema with a dozen lookup tables would otherwise look crowded at depth 0 and get
     * the whole treatment, including the `SIMPLE` node placement that costs edge
     * straightness everywhere. Unrelated tables are packed by
     * `elk.separateConnectedComponents`, not by the layering. Measured on Pagila: counting
     * them changed the layout, excluding them leaves it identical to before.
     */
    const ids = ['a', 'b', ...Array.from({ length: 30 }, (_, i) => `lonely${String(i)}`)]

    expect(splitWideLayers(ids, edges(['a', 'b'])).size).toBe(0)
  })

  it('terminates on a reference cycle', () => {
    // A -> B -> A is legal in the model; the validator only warns. Longest-path layering
    // has no answer for a cycle, so it is capped rather than left to spin.
    const { ids, links } = hubAndSpoke(20)
    const cyclic = [...links, { sources: ['hub'], targets: ['spoke0'] }]

    expect(() => splitWideLayers(ids, cyclic)).not.toThrow()
    expect(splitWideLayers(ids, cyclic).size).toBeGreaterThan(0)
  })

  it('is stable for the same input', () => {
    // Positions must not shuffle between runs on the same diagram.
    const { ids, links } = hubAndSpoke(25)

    expect([...splitWideLayers(ids, links)]).toEqual([...splitWideLayers(ids, links)])
  })

  it('handles an empty diagram and a diagram with no relationships', () => {
    expect(splitWideLayers([], []).size).toBe(0)
    expect(splitWideLayers(['only'], []).size).toBe(0)
  })

  it('ignores a self-reference when computing depth', () => {
    // FR-1.12 allows a self-join. It says nothing about ordering and must not push a table
    // one layer deeper than itself.
    const ids = ['a', 'b']

    expect(splitWideLayers(ids, edges(['a', 'a'], ['a', 'b'])).size).toBe(0)
  })
})
