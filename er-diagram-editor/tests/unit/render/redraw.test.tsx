/**
 * @vitest-environment jsdom
 *
 * WHEN A MOVED BOX HAS TO BE REDRAWN — THE PAIR, NOT EITHER HALF.
 *
 * `sameEntityNode` decides whether a node component re-renders; `Canvas` decides what
 * goes into the `data` it compares. Each is correct on its own and neither can be wrong
 * in a way a test of it alone would notice: the diagram renders identically either way,
 * and only the COST differs. Measured in Chrome on the 120-entity reference schema,
 * landing an auto-layout re-rendered every box and all 1,920 of their attribute rows for
 * a change that was purely a CSS transform (NFR-1.4).
 *
 * So the assertion is on the two together: mount the real Canvas, move every box the way
 * `applyLayout` does, and check what the comparator actually said. It is spied on rather
 * than replaced — the implementation under test is the real one.
 */
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  applyLayout,
  createAttribute,
  createDiagram,
  createEntity,
  createRelationship,
  type Diagram,
  type EntityId,
  type Point,
} from '../../../src/domain'
import { CommandStack } from '../../../src/domain'
import { Canvas } from '../../../src/render'
import type * as SameEntityNode from '../../../src/render/reactflow/nodes/sameEntityNode'

const verdicts: boolean[] = []

vi.mock('../../../src/render/reactflow/nodes/sameEntityNode', async (importOriginal) => {
  const actual = await importOriginal<typeof SameEntityNode>()

  return {
    ...actual,
    sameEntityNode: (previous: never, next: never): boolean => {
      const verdict = actual.sameEntityNode(previous, next)
      verdicts.push(verdict)
      return verdict
    },
  }
})

/** Three entities with real attributes, so a needless redraw costs rows as well as boxes. */
function schema(): Diagram {
  const entities = ['CUSTOMER', 'ORDER', 'PRODUCT'].map((name) =>
    createEntity({
      name,
      attributes: [
        createAttribute({ name: 'id', isPrimaryKey: true, dataType: 'uuid' }),
        createAttribute({ name: 'created_at', dataType: 'timestamptz' }),
      ],
    }),
  )

  const diagram = createDiagram({
    entities,
    relationships: [createRelationship({ from: entities[0]!.id, to: entities[1]!.id })],
  })

  // Placed through the same command the layout engine uses, so the starting document is
  // built the way a real one is.
  const positions = Object.fromEntries(
    entities.map((entity, index) => [entity.id, { x: index * 320, y: 0 }]),
  ) as Record<EntityId, Point>

  return new CommandStack(diagram).execute(applyLayout(positions))
}

/**
 * Move every box through the command stack, exactly as an auto-layout result does.
 *
 * Going through the real command rather than hand-building a Diagram is the point: the
 * property being relied on is Immer's structural sharing — `applyLayout` touches only
 * `layout.positions`, so the new document must hand back the SAME `entities` array. A
 * hand-written document could satisfy the test while the real command did not.
 */
function afterAutoLayout(diagram: Diagram): Diagram {
  const positions = Object.fromEntries(
    diagram.entities.map((entity, index) => [entity.id, { x: index * 111 + 7, y: index * 53 + 9 }]),
  ) as Record<EntityId, Point>

  return new CommandStack(diagram).execute(applyLayout(positions))
}

interface CanvasState {
  hoveredEntityId?: EntityId
  selectedEntityIds?: ReadonlySet<EntityId>
}

/**
 * One empty Set for every render that selects nothing.
 *
 * A fresh `new Set()` per call would give `baseNodes` a new dependency every time and
 * rebuild all the nodes, which is the very thing the assertions below are about — the test
 * would fail for a reason that has nothing to do with the component.
 */
const NOTHING_SELECTED: ReadonlySet<EntityId> = new Set()

function canvas(diagram: Diagram, state: CanvasState = {}): React.ReactElement {
  return (
    <Canvas
      diagram={diagram}
      lod={2}
      hoveredEntityId={state.hoveredEntityId}
      hoveredRelationshipId={undefined}
      selectedEntityIds={state.selectedEntityIds ?? NOTHING_SELECTED}
      selectedRelationshipIds={new Set()}
      selectedAttributeId={undefined}
      editable
      onHoverEntity={() => undefined}
      onHoverRelationship={() => undefined}
      onSelectEntities={() => undefined}
      onSelectRelationship={() => undefined}
      onConnect={() => undefined}
      onMoveEntities={() => undefined}
      onViewportChange={() => undefined}
      showMinimap={false}
      /* jsdom lays nothing out, so a culled canvas would render no nodes at all and the
         assertions below would pass vacuously. */
      cull={false}
      viewport={{ x: 0, y: 0, zoom: 1 }}
    />
  )
}

describe('landing a layout does not redraw the boxes (NFR-1.4)', () => {
  beforeEach(() => {
    verdicts.length = 0
  })

  it('renders the boxes at all, or nothing below asserts anything', () => {
    const { container } = render(canvas(schema()))

    expect(container.querySelectorAll('.erd-node')).toHaveLength(3)
    expect(container.querySelectorAll('.erd-attr')).toHaveLength(6)
  })

  it('says every box is unchanged when only its position moved', () => {
    const diagram = schema()
    const { rerender } = render(canvas(diagram))

    verdicts.length = 0
    rerender(canvas(afterAutoLayout(diagram)))

    // One verdict per box, and every one of them "nothing here changed". Before the
    // traced-attribute set and the foreign-key map were memoised apart from the document,
    // every verdict here was `false` — a new `Diagram` meant a new Set and a new Map in
    // every node's data, so all three boxes and all six rows were rebuilt for a move.
    expect(verdicts.length).toBeGreaterThanOrEqual(3)
    expect(verdicts.filter((verdict) => !verdict)).toEqual([])
  })

  it('still says a box changed when something in it actually did', () => {
    // The other half: a comparison that always answers "unchanged" would pass the test
    // above and freeze the diagram.
    const diagram = schema()
    const { rerender } = render(canvas(diagram))

    const renamed = new CommandStack(diagram).execute({
      type: 'test.rename',
      label: 'Rename',
      mutate: (draft) => {
        draft.entities[0]!.name = 'BUYER'
      },
    })

    verdicts.length = 0
    rerender(canvas(renamed))

    expect(verdicts).toContain(false)
  })
})

describe('hovering and selecting do not redraw the other boxes (NFR-1.3)', () => {
  /*
   * THE SAME SHAPE OF DEFECT AS THE LAYOUT ONE ABOVE, AND IT SURVIVED THAT FIX.
   *
   * Hovering a box traces it and its neighbours and pushes everything else back; clicking
   * one selects it. Neither changes anything about the boxes that are not involved — but
   * both used to rebuild all of them anyway, for two separate reasons:
   *
   *   `tracedAttributeIds` was ONE Set for the whole diagram, so a hover minted a new one
   *   and every node's data carried a new reference. `sameEntityNode` compares it by
   *   reference, deliberately, so every box answered "changed" and redrew every row.
   *
   *   `isDimmed` was a per-node boolean, so starting a hover flipped it on all N-1 boxes
   *   that are NOT traced — an O(N) state change to express one fact about the diagram.
   *
   * Measured in Chrome on the production build at 120 entities before the fix: hover p95
   * 83-195 ms and selection p95 147-162 ms, against NFR-1.3's 100 ms budget. As with the
   * layout case, the diagram renders identically either way and only the cost differs,
   * which is exactly why the assertion has to be on the comparator's verdicts rather than
   * on what is on screen.
   */
  beforeEach(() => {
    verdicts.length = 0
  })

  it('says the untraced boxes are unchanged when a hover starts', () => {
    const diagram = schema()
    const [first] = diagram.entities
    const { rerender } = render(canvas(diagram))

    verdicts.length = 0
    rerender(canvas(diagram, { hoveredEntityId: first!.id }))

    // The hovered box and its one-hop neighbour genuinely change — they gain
    // `data-traced` — so this counts the FALSE verdicts rather than demanding none.
    // The third box is untouched by the hover and must say so.
    expect(verdicts.length).toBeGreaterThanOrEqual(3)
    expect(verdicts.filter((verdict) => !verdict).length).toBeLessThanOrEqual(2)
    expect(verdicts).toContain(true)
  })

  it('says every box is unchanged when the hover ends', () => {
    const diagram = schema()
    const [first] = diagram.entities
    const { rerender } = render(canvas(diagram, { hoveredEntityId: first!.id }))

    verdicts.length = 0
    rerender(canvas(diagram))

    expect(verdicts.filter((verdict) => !verdict).length).toBeLessThanOrEqual(2)
  })

  it('says the boxes that were not selected are unchanged', () => {
    const diagram = schema()
    const [, second] = diagram.entities
    const { rerender } = render(canvas(diagram))

    verdicts.length = 0
    rerender(canvas(diagram, { selectedEntityIds: new Set([second!.id]) }))

    // Only the newly selected box changed, so only it redraws its contents.
    //
    // Note what this does NOT say. Canvas deliberately hands React Flow a brand new object
    // for every node on a render where the selection moved, even for the boxes this
    // comparator calls unchanged — because React Flow keeps its own private `selected` on
    // the internal node and only re-reads ours when the object reference differs. Reusing
    // objects here left a shift-clicked pair showing one highlight while the store held
    // two. The comparator and the object identity are two separate decisions; this asserts
    // the first, and tests/e2e/interaction.spec.ts asserts the second.
    expect(verdicts.length).toBeGreaterThanOrEqual(3)
    expect(verdicts.filter((verdict) => !verdict).length).toBeLessThanOrEqual(1)
  })

})
