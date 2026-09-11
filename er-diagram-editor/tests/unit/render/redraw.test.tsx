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

function canvas(diagram: Diagram): React.ReactElement {
  return (
    <Canvas
      diagram={diagram}
      lod={2}
      hoveredEntityId={undefined}
      hoveredRelationshipId={undefined}
      selectedEntityIds={new Set()}
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
