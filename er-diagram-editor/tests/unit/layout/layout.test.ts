/**
 * @vitest-environment node
 *
 * No DOM. The worker is not exercised here — see the note on the ELK block below.
 */
import { describe, expect, it } from 'vitest'

import {
  createAttribute,
  createDiagram,
  createEntity,
  createRelationship,
  type Diagram,
  type Entity,
  type EntityId,
} from '../../../src/domain'
import { fromElkGraph } from '../../../src/layout/elk/fromElkGraph'
import { optionsFor } from '../../../src/layout/elk/options'
import { toElkGraph } from '../../../src/layout/elk/toElkGraph'
import { measureAll, measureEntity } from '../../../src/layout'

function chain(count = 4): { diagram: Diagram; entities: Entity[] } {
  const entities = Array.from({ length: count }, (_, index) =>
    createEntity({
      name: `E${String(index)}`,
      attributes: [createAttribute({ name: 'id', dataType: 'uuid', isPrimaryKey: true })],
    }),
  )
  const relationships = entities
    .slice(1)
    .map((entity, index) => createRelationship({ from: entities[index]!.id, to: entity.id }))

  return { diagram: createDiagram({ entities, relationships }), entities }
}

describe('measurement', () => {
  it('grows with the number of visible rows', () => {
    const small = createEntity({ name: 'A', attributes: [createAttribute({ name: 'id' })] })
    const large = createEntity({
      name: 'A',
      attributes: Array.from({ length: 8 }, (_, i) => createAttribute({ name: `f${String(i)}` })),
    })

    expect(measureEntity(large, 2).height).toBeGreaterThan(measureEntity(small, 2).height)
  })

  it('measures L0 as name-only, whatever the field count', () => {
    // The measurement must agree with what EntityNode actually draws, or ELK spaces
    // boxes for content that is not on screen.
    const entity = createEntity({
      name: 'A',
      attributes: Array.from({ length: 20 }, (_, i) => createAttribute({ name: `f${String(i)}` })),
    })

    expect(measureEntity(entity, 0).height).toBeLessThan(measureEntity(entity, 2).height / 4)
  })

  it('counts only keys and foreign keys at L1', () => {
    const entity = createEntity({
      name: 'A',
      attributes: [
        createAttribute({ name: 'id', isPrimaryKey: true }),
        createAttribute({ name: 'note' }),
        createAttribute({ name: 'other' }),
      ],
    })

    expect(measureEntity(entity, 1).height).toBeLessThan(measureEntity(entity, 2).height)
  })

  it('clamps width to exactly the bounds canvas.css draws', () => {
    // These are not approximations to be loosened when they fail: `.erd-node` sets
    // `min-width: 160px; max-width: 300px`, with `min-width: 120px` at L0. Both clamps are
    // exact, so assert the values rather than an inequality — the previous version of this
    // test asserted `>= 160` at L0 and passed only because `measure.ts` had a single
    // 168px floor that did not match the stylesheet at any level.
    const short = createEntity({ name: 'A' })
    const long = createEntity({ name: 'a_very_long_table_name_that_runs_well_past_the_cap' })

    expect(measureEntity(long, 0).width).toBeGreaterThan(measureEntity(short, 0).width)
    expect(measureEntity(short, 0).width).toBe(120)
    expect(measureEntity(short, 2).width).toBe(160)
    expect(measureEntity(long, 2).width).toBe(300)
  })

  it('bills a row above the measured rate, so wide tables never under-measure', () => {
    /*
     * The per-row rate creeps up with the row count, because every row after the first adds
     * a 1px rule on top of a 26.3px line box: `.erd-node__attrs` measured 136px at 5 rows
     * and 1642px at 60, i.e. 27.2 to 27.37px per row.
     *
     * A flat 27 looks right on a five-row table and under-measures a 60-column one by 22px.
     * Under-measuring is the direction that makes ELK stack boxes, and it would only ever
     * have shown up on the wide tables real schemas actually have — which is why this
     * asserts the rate rather than comparing two heights loosely.
     */
    const rows = (count: number) =>
      Array.from({ length: count }, (_, index) =>
        createAttribute({ name: `field_${String(index)}` }),
      )
    const wide = createEntity({ name: 'WIDE', attributes: rows(60) })
    const bare = createEntity({ name: 'WIDE' })

    const perRow = (measureEntity(wide, 2).height - measureEntity(bare, 2).height) / 60

    expect(perRow).toBeGreaterThanOrEqual(27.37)
  })

  it('measures every entity in the diagram', () => {
    const { diagram, entities } = chain(3)
    const sizes = measureAll(diagram, 2)

    expect(Object.keys(sizes)).toHaveLength(3)
    expect(sizes[entities[0]!.id]?.width).toBeGreaterThan(0)
  })
})

describe('toElkGraph', () => {
  it('sends every entity and relationship', () => {
    const { diagram } = chain(4)
    const graph = toElkGraph({ diagram, sizes: measureAll(diagram, 2) })

    expect(graph.children).toHaveLength(4)
    expect(graph.edges).toHaveLength(3)
  })

  it('uses orthogonal routing, which is why ELK was chosen over dagre (ADR-0002)', () => {
    expect(optionsFor('layered')['elk.edgeRouting']).toBe('ORTHOGONAL')
  })

  it('sends only the selection when one is given (FR-3.7)', () => {
    const { diagram, entities } = chain(4)
    const only = [entities[0]!.id, entities[1]!.id]
    const graph = toElkGraph({ diagram, sizes: measureAll(diagram, 2), only })

    expect(graph.children.map((node) => node.id)).toEqual(only)
  })

  it('drops relationships that leave the selection, which ELK would reject', () => {
    const { diagram, entities } = chain(4)
    const graph = toElkGraph({
      diagram,
      sizes: measureAll(diagram, 2),
      only: [entities[0]!.id, entities[1]!.id],
    })

    // E0—E1 is inside; E1—E2 leaves it.
    expect(graph.edges).toHaveLength(1)
  })

  it('drops self-joins, which some algorithms reject outright', () => {
    const employee = createEntity({ name: 'EMPLOYEE' })
    const diagram = createDiagram({
      entities: [employee],
      relationships: [createRelationship({ from: employee.id, to: employee.id })],
    })

    expect(toElkGraph({ diagram, sizes: measureAll(diagram, 2) }).edges).toHaveLength(0)
  })

  it('falls back to a default size for an unmeasured entity rather than sending zero', () => {
    // A zero-sized node makes ELK overlap everything on top of it.
    const { diagram } = chain(2)
    const graph = toElkGraph({ diagram, sizes: {} })

    expect(graph.children.every((node) => node.width > 0 && node.height > 0)).toBe(true)
  })

  it('switches algorithm presets', () => {
    const { diagram } = chain(2)

    expect(
      toElkGraph({ diagram, sizes: {}, algorithm: 'tree' }).layoutOptions['elk.algorithm'],
    ).toBe('mrtree')
    expect(
      toElkGraph({ diagram, sizes: {}, algorithm: 'force' }).layoutOptions['elk.algorithm'],
    ).toBe('force')
  })
})

describe('fromElkGraph', () => {
  it('rounds positions to whole pixels', () => {
    const result = fromElkGraph({ children: [{ id: 'ent_1', x: 10.4, y: 20.6 }] })

    expect(result.positions['ent_1' as EntityId]).toEqual({ x: 10, y: 21 })
  })

  it('treats a missing coordinate as the origin', () => {
    const result = fromElkGraph({ children: [{ id: 'ent_1' }] })

    expect(result.positions['ent_1' as EntityId]).toEqual({ x: 0, y: 0 })
  })

  it('shifts by the offset, so laying out a selection does not teleport it', () => {
    const result = fromElkGraph({ children: [{ id: 'ent_1', x: 0, y: 0 }] }, { x: 500, y: 300 })

    expect(result.positions['ent_1' as EntityId]).toEqual({ x: 500, y: 300 })
  })

  it('reads bend points for orthogonal routing', () => {
    const result = fromElkGraph({
      edges: [
        {
          id: 'rel_1',
          sections: [
            {
              startPoint: { x: 0, y: 0 },
              endPoint: { x: 100, y: 100 },
              bendPoints: [
                { x: 50, y: 0 },
                { x: 50, y: 100 },
              ],
            },
          ],
        },
      ],
    })

    expect(result.routes[0]?.bendPoints).toHaveLength(2)
  })

  it('reports no route for a straight edge, so the renderer keeps its own path', () => {
    const result = fromElkGraph({
      edges: [
        { id: 'rel_1', sections: [{ startPoint: { x: 0, y: 0 }, endPoint: { x: 9, y: 0 } }] },
      ],
    })

    expect(result.routes).toHaveLength(0)
  })

  it('survives an empty result', () => {
    expect(fromElkGraph({})).toEqual({ positions: {}, routes: [] })
  })
})

describe('against the real ELK library', () => {
  /**
   * Runs elkjs directly rather than through the worker.
   *
   * The worker is a transport detail; what can actually be wrong is the graph we hand
   * ELK. A hand-rolled fixture would only prove the fixture is well-formed, so these
   * feed real `toElkGraph` output into the real library and read it back with real
   * `fromElkGraph` — which is the contract that breaks silently if an option name is
   * misspelled or a node is sent with no size.
   */
  async function runElk(graph: unknown): Promise<unknown> {
    const { default: ELK } = (await import('elkjs/lib/elk.bundled.js')) as {
      default: new () => { layout: (graph: unknown) => Promise<unknown> }
    }
    return new ELK().layout(graph)
  }

  /**
   * THE TEST THAT WOULD HAVE CAUGHT THE RIBBON.
   *
   * One table referenced by forty others puts all forty at the same dependency depth, and
   * `layered` stacks a depth into one column. Every other spec in this file passes on that
   * layout: there are no overlaps, every entity has a position, the chain reads left to
   * right. It is simply 838px wide and 21,134px tall — a ribbon nobody can read at any zoom
   * or any detail level. What no assertion here looked at was the SHAPE of the result.
   *
   * `splitWideLayers` fixes it by splitting the crowded depth into partitions, which is a
   * property of `toElkGraph` plus ELK together — neither half is wrong on its own, so the
   * test belongs on the pair.
   */
  it('lays a hub out as a block rather than a 21,000px ribbon', async () => {
    const spokes = Array.from({ length: 40 }, (_, index) =>
      createEntity({
        name: `SPOKE_${String(index)}`,
        attributes: Array.from({ length: 8 }, (_, field) =>
          createAttribute({ name: `field_${String(field)}`, dataType: 'varchar(255)' }),
        ),
      }),
    )
    const hub = createEntity({
      name: 'HUB',
      attributes: Array.from({ length: 20 }, (_, field) =>
        createAttribute({ name: `hub_field_${String(field)}`, dataType: 'varchar(255)' }),
      ),
    })
    const diagram = createDiagram({
      entities: [...spokes, hub],
      relationships: spokes.map((spoke) => createRelationship({ from: spoke.id, to: hub.id })),
    })

    const sizes = measureAll(diagram, 2)
    const result = fromElkGraph(
      (await runElk(toElkGraph({ diagram, sizes }))) as Parameters<typeof fromElkGraph>[0],
    )

    const boxes = Object.entries(result.positions).map(([id, point]) => ({
      x: point.x,
      y: point.y,
      width: sizes[id as EntityId]?.width ?? 0,
      height: sizes[id as EntityId]?.height ?? 0,
    }))
    const width =
      Math.max(...boxes.map((box) => box.x + box.width)) - Math.min(...boxes.map((box) => box.x))
    const height =
      Math.max(...boxes.map((box) => box.y + box.height)) - Math.min(...boxes.map((box) => box.y))

    /*
     * A generous band, on purpose: the exact numbers move with the type scale and with ELK
     * versions, and this is a guard against a pathological shape rather than a pixel
     * assertion. Before the fix this came out at 0.04, and a screen is about 1.6.
     */
    expect(
      width / height,
      `${String(Math.round(width))}x${String(Math.round(height))}`,
    ).toBeGreaterThan(0.25)
    expect(height, 'taller than any screen can show at a readable zoom').toBeLessThan(9_000)
  }, 30_000)

  it('accepts our graph and returns a position for every entity', async () => {
    const { diagram, entities } = chain(6)
    const graph = toElkGraph({ diagram, sizes: measureAll(diagram, 2) })

    const result = fromElkGraph((await runElk(graph)) as Parameters<typeof fromElkGraph>[0])

    expect(Object.keys(result.positions)).toHaveLength(6)
    for (const entity of entities) {
      expect(result.positions[entity.id]).toBeDefined()
    }
  }, 30_000)

  it('produces no overlapping boxes', async () => {
    // The one property that actually matters to a reader. If the measurements in
    // measure.ts drift away from what canvas.css draws, this is what catches it.
    const { diagram } = chain(8)
    const sizes = measureAll(diagram, 2)
    const result = fromElkGraph(
      (await runElk(toElkGraph({ diagram, sizes }))) as Parameters<typeof fromElkGraph>[0],
    )

    const boxes = Object.entries(result.positions).map(([id, point]) => ({
      left: point.x,
      top: point.y,
      right: point.x + (sizes[id as EntityId]?.width ?? 0),
      bottom: point.y + (sizes[id as EntityId]?.height ?? 0),
    }))

    for (let a = 0; a < boxes.length; a += 1) {
      for (let b = a + 1; b < boxes.length; b += 1) {
        const first = boxes[a]!
        const second = boxes[b]!
        const overlaps =
          first.left < second.right &&
          first.right > second.left &&
          first.top < second.bottom &&
          first.bottom > second.top
        expect(overlaps).toBe(false)
      }
    }
  }, 30_000)

  it('lays a chain out left to right, by dependency depth', async () => {
    const { diagram, entities } = chain(4)
    const result = fromElkGraph(
      (await runElk(toElkGraph({ diagram, sizes: measureAll(diagram, 2) }))) as Parameters<
        typeof fromElkGraph
      >[0],
    )

    const xs = entities.map((entity) => result.positions[entity.id]?.x ?? 0)
    for (let index = 1; index < xs.length; index += 1) {
      expect(xs[index]!).toBeGreaterThan(xs[index - 1]!)
    }
  }, 30_000)

  it('keeps disconnected components apart rather than stacking them', async () => {
    const { diagram } = chain(3)
    const island = createEntity({ name: 'ISLAND' })
    const withIsland: Diagram = { ...diagram, entities: [...diagram.entities, island] }
    const result = fromElkGraph(
      (await runElk(
        toElkGraph({ diagram: withIsland, sizes: measureAll(withIsland, 2) }),
      )) as Parameters<typeof fromElkGraph>[0],
    )

    expect(result.positions[island.id]).toBeDefined()
    expect(Object.keys(result.positions)).toHaveLength(4)
  }, 30_000)
})
