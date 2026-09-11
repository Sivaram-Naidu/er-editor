/**
 * The reference schema every NFR-1.x budget is pinned to.
 *
 * SRS §5.1: 120 entities, 8 attributes each (960 attributes), 150 relationships, measured
 * on a 2020-era laptop in Chrome. NFR-2.2's ceiling of 300 comes out of the same generator
 * with different counts.
 *
 * This used to live inside `tests/perf/layout.perf.test.ts`, which was fine while the only
 * consumer measured ELK in-process. It has a second consumer now — `tests/e2e/perf.spec.ts`
 * measures the same schema in a real browser — and the two numbers are only comparable if
 * they are about the same graph. Hence one generator, imported by both.
 *
 * `tests/fixtures/*.erd.json` are NOT that schema. They are empty and invalid (no
 * top-level `id`, so importing one is rejected); the README's claim that `reference.erd.json`
 * holds 120 entities has never been true. Generate, do not read.
 */

import {
  createAttribute,
  createDiagram,
  createEntity,
  createRelationship,
  type Diagram,
  type EntityId,
  type Point,
} from '../../src/domain'

/** SRS §5.1: 120 entities, 8 attributes each, 150 relationships. */
export function referenceSchema(entityCount = 120, relationshipCount = 150): Diagram {
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

const GRID_COLUMNS = 12
const GRID_X = 420
const GRID_Y = 420

/**
 * The same schema, parked on a coarse grid.
 *
 * Load-bearing for the browser perf spec, and the reason is easy to miss. `needsLayout`
 * returns false once a document has ANY positions, so an imported diagram that already
 * carries them is NOT auto-arranged on the way in. Without that, importing runs a layout
 * immediately and the Auto-layout click under measurement then re-runs ELK on an
 * already-arranged graph, gets the same answer, and moves nothing — so the thing being
 * timed does not happen and the spec reports a flattering zero.
 *
 * The spacing is deliberately nothing like a layered layout, so every one of the 120 boxes
 * genuinely moves when ELK's answer lands.
 */
export function onAGrid(diagram: Diagram): Diagram {
  const positions: Record<EntityId, Point> = {}

  diagram.entities.forEach((entity, index) => {
    positions[entity.id] = {
      x: (index % GRID_COLUMNS) * GRID_X,
      y: Math.floor(index / GRID_COLUMNS) * GRID_Y,
    }
  })

  return { ...diagram, layout: { ...diagram.layout, positions } }
}
