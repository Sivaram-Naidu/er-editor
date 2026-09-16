/**
 * @vitest-environment jsdom
 *
 * Renders EntityNode inside a React Flow provider. The suite default is `node` (see the note in vite.config.ts), so a file that
 * mounts anything has to opt back up here.
 */
import {
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  type Node,
  type NodeChange,
} from '@xyflow/react'
import { fireEvent, render, screen, type RenderResult } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  createAttribute,
  createDiagram,
  createEntity,
  createRelationship,
  type AttributeId,
  type Diagram,
  type Entity,
  type EntityId,
  type Point,
  type RelationshipId,
} from '../../../src/domain'
import {
  AlignmentGuides,
  EditorActionsProvider,
  EntityNode,
  applySelectionChanges,
  fallbackPosition,
  inFlightPositions,
  measuredDimensions,
  overlayNodes,
  reuseUnchanged,
  settledPositions,
  sizesUnchanged,
  traceSets,
  type EditorActions,
  type EntityNodeData,
  type Guide,
  type Size,
} from '../../../src/render'

/** A—B—C chain, so one-hop and two-hop are distinguishable. */
function chain(): { diagram: Diagram; a: Entity; b: Entity; c: Entity } {
  const [a, b, c] = ['A', 'B', 'C'].map((name) => createEntity({ name }))
  const diagram = createDiagram({
    entities: [a!, b!, c!],
    relationships: [
      createRelationship({ from: a!.id, to: b!.id, name: 'ab' }),
      createRelationship({ from: b!.id, to: c!.id, name: 'bc' }),
    ],
  })
  return { diagram, a: a!, b: b!, c: c! }
}

describe('traceSets (FR-4.1, FR-4.2)', () => {
  it('traces nothing when nothing is hovered', () => {
    // Load-bearing: empty sets mean Canvas leaves `data-tracing` off the container, so
    // nothing matches the dimming rule and the resting diagram renders at full strength
    // rather than uniformly faded.
    const { diagram } = chain()
    const traced = traceSets(diagram, undefined, undefined, undefined)

    expect(traced.entities.size).toBe(0)
    expect(traced.relationships.size).toBe(0)
  })

  it('hovering an entity traces it and everything one hop out', () => {
    const { diagram, a, b, c } = chain()
    const traced = traceSets(diagram, b.id, undefined, undefined)

    expect(traced.entities.has(a.id)).toBe(true)
    expect(traced.entities.has(b.id)).toBe(true)
    expect(traced.entities.has(c.id)).toBe(true)
    expect(traced.relationships.size).toBe(2)
  })

  it('stops at one hop', () => {
    const { diagram, a, c } = chain()
    const traced = traceSets(diagram, a.id, undefined, undefined)

    expect(traced.entities.has(c.id)).toBe(false)
  })

  it('hovering a relationship traces it and exactly its two endpoints', () => {
    const { diagram, a, b, c } = chain()
    const relationshipId = diagram.relationships[0]!.id
    const traced = traceSets(diagram, undefined, relationshipId, undefined)

    expect([...traced.relationships]).toEqual([relationshipId])
    expect(traced.entities.has(a.id)).toBe(true)
    expect(traced.entities.has(b.id)).toBe(true)
    expect(traced.entities.has(c.id)).toBe(false)
  })

  it('a hovered relationship wins over a hovered entity', () => {
    // Both can be set while the pointer moves from a node onto a connector crossing it.
    // The connector is the more specific target, so it takes precedence.
    const { diagram, b } = chain()
    const relationshipId = diagram.relationships[0]!.id
    const traced = traceSets(diagram, b.id, relationshipId, undefined)

    expect(traced.relationships.size).toBe(1)
  })

  it('handles a hover on an element that has just been deleted', () => {
    const { diagram } = chain()

    expect(traceSets(diagram, 'ent_gone' as EntityId, undefined, undefined).entities.size).toBe(0)
    expect(
      traceSets(diagram, undefined, 'rel_gone' as RelationshipId, undefined).entities.size,
    ).toBe(0)
  })

  it('a pinned relationship keeps tracing with nothing hovered (FR-4.4)', () => {
    // The point of the feature: the pointer has left, and the trace is still there.
    const { diagram, a, b, c } = chain()
    const relationshipId = diagram.relationships[0]!.id
    const traced = traceSets(diagram, undefined, undefined, relationshipId)

    expect([...traced.relationships]).toEqual([relationshipId])
    expect(traced.entities.has(a.id)).toBe(true)
    expect(traced.entities.has(b.id)).toBe(true)
    expect(traced.entities.has(c.id)).toBe(false)
  })

  it('a pinned relationship outranks a hovered entity, and that is the requirement', () => {
    /*
     * If hover could override the pin, FR-4.4 would fail at the one thing it exists for.
     * A trackpad pan scrolls the diagram UNDER a stationary pointer, so box after box
     * fires `mouseenter` and the pinned trace would be replaced by whatever slid beneath
     * the cursor mid-pan. A drag-pan happens to be safe because the pane takes pointer
     * capture — which is exactly why this is asserted rather than tried by hand.
     */
    const { diagram, c } = chain()
    const pinned = diagram.relationships[0]!.id
    const traced = traceSets(diagram, c.id, undefined, pinned)

    expect([...traced.relationships]).toEqual([pinned])
    expect(traced.entities.has(c.id)).toBe(false)
  })

  it('a pinned relationship outranks a hovered one too', () => {
    const { diagram } = chain()
    const pinned = diagram.relationships[0]!.id
    const hovered = diagram.relationships[1]!.id
    const traced = traceSets(diagram, undefined, hovered, pinned)

    expect([...traced.relationships]).toEqual([pinned])
  })

  it('traces a self-referencing relationship to a single entity', () => {
    const employee = createEntity({ name: 'EMPLOYEE' })
    const self = createRelationship({ from: employee.id, to: employee.id })
    const diagram = createDiagram({ entities: [employee], relationships: [self] })

    expect(traceSets(diagram, undefined, self.id, undefined).entities.size).toBe(1)
  })
})

describe('fallbackPosition', () => {
  it('lays unpositioned entities out on a grid rather than stacking them at the origin', () => {
    const positions = Array.from({ length: 7 }, (_, index) => fallbackPosition(index))
    const distinct = new Set(positions.map((point) => `${String(point.x)},${String(point.y)}`))

    expect(distinct.size).toBe(7)
    expect(positions[5]?.y).toBeGreaterThan(0)
  })
})

/**
 * React Flow's `NodeProps` carries a dozen fields the node never reads (drag state,
 * z-index, absolute position). Building them all at each call site would bury what each
 * test is actually varying, so they are filled in once here.
 */
type NodeRenderProps = Parameters<typeof EntityNode>[0]

const NO_ACTIONS: EditorActions = {
  renameEntity: () => undefined,
  addAttribute: () => undefined,
  renameAttribute: () => undefined,
  selectAttribute: () => undefined,
  setEntityPinned: () => undefined,
}

function renderNode(
  data: Partial<EntityNodeData> & { entity: Entity },
  actions?: EditorActions,
): RenderResult {
  const props = {
    id: data.entity.id,
    type: 'entity',
    dragging: false,
    zIndex: 0,
    selectable: true,
    deletable: true,
    selected: false,
    draggable: true,
    isConnectable: false,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    data: {
      lod: 2,
      isTraced: false,
      tracedAttributeIds: new Set<AttributeId>(),
      selectedAttributeId: undefined,
      foreignKeyTargets: new Map<AttributeId, string>(),
      editable: false,
      hiddenNeighbours: undefined,
      isPinned: false,
      ...data,
    },
  } as unknown as NodeRenderProps

  return render(
    <ReactFlowProvider>
      <EditorActionsProvider value={actions ?? NO_ACTIONS}>
        <EntityNode {...props} />
      </EditorActionsProvider>
    </ReactFlowProvider>,
  )
}

const richEntity = (): Entity =>
  createEntity({
    name: 'ORDER',
    attributes: [
      createAttribute({ name: 'id', dataType: 'uuid', isPrimaryKey: true }),
      createAttribute({ name: 'placed_at', dataType: 'timestamptz' }),
      createAttribute({ name: 'total', dataType: 'numeric', isDerived: true }),
    ],
  })

describe('EntityNode level of detail (SRS §2.2, ADR-0004)', () => {
  it('L0 shows the name and no attributes', () => {
    // The mechanism that makes 120 entities affordable: ~120 DOM nodes instead of ~1000.
    renderNode({ entity: richEntity(), lod: 0 })

    expect(screen.getByText('ORDER')).toBeInTheDocument()
    expect(screen.queryByText('placed_at')).not.toBeInTheDocument()
  })

  it('L1 shows keys only', () => {
    renderNode({ entity: richEntity(), lod: 1 })

    expect(screen.getByText('id')).toBeInTheDocument()
    expect(screen.queryByText('placed_at')).not.toBeInTheDocument()
    expect(screen.getByText('2 more')).toBeInTheDocument()
  })

  it('L2 shows every attribute', () => {
    renderNode({ entity: richEntity(), lod: 2 })

    expect(screen.getByText('id')).toBeInTheDocument()
    expect(screen.getByText('placed_at')).toBeInTheDocument()
    expect(screen.getByText('total')).toBeInTheDocument()
  })

  it('L1 also keeps foreign keys, since they are what a connector attaches to', () => {
    const entity = createEntity({
      name: 'ORDER',
      attributes: [
        createAttribute({ name: 'note' }),
        {
          ...createAttribute({ name: 'customer_id' }),
          foreignKey: { entityId: 'ent_1' as EntityId, attributeId: 'att_1' as never },
        },
      ],
    })
    renderNode({ entity, lod: 1 })

    expect(screen.getByText('customer_id')).toBeInTheDocument()
    expect(screen.queryByText('note')).not.toBeInTheDocument()
  })
})

describe('the "N more" row (FR-2.7)', () => {
  const wide = (): Entity =>
    createEntity({
      name: 'ORDER',
      attributes: [
        createAttribute({ name: 'id', isPrimaryKey: true }),
        createAttribute({ name: 'placed_at' }),
        createAttribute({ name: 'total' }),
      ],
    })

  it('is a BUTTON, because it is the row every user tries to click', () => {
    // It was a `<div>` reading "2 more" — a statement about what is missing with no way to
    // see it. Asserting the role rather than the text is the point: the text was always
    // right and the control was not there.
    renderNode({ entity: wide(), lod: 1 })

    expect(screen.getByRole('button', { name: /2 more/ })).toBeInTheDocument()
  })

  it('pins the entity when pressed', () => {
    const calls: [string, boolean][] = []
    const entity = wide()
    renderNode(
      { entity, lod: 1 },
      {
        ...NO_ACTIONS,
        setEntityPinned: (entityId, pinned) => calls.push([entityId, pinned]),
      },
    )

    fireEvent.click(screen.getByRole('button', { name: /2 more/ }))

    expect(calls).toEqual([[entity.id, true]])
  })

  it('offers the way back out, and names the STATE rather than an effect', () => {
    /*
     * "Pinned", not "Show less". At L2 releasing the pin changes nothing on screen until
     * the user zooms out, so a label naming an effect would describe something that does
     * not visibly happen. Naming the state is true at every zoom — and this row is the
     * only thing on the box that says the pin is on.
     */
    const entity = wide()
    const calls: [string, boolean][] = []
    renderNode(
      { entity, lod: 2, isPinned: true },
      {
        ...NO_ACTIONS,
        setEntityPinned: (entityId, pinned) => calls.push([entityId, pinned]),
      },
    )

    fireEvent.click(screen.getByRole('button', { name: 'Pinned' }))

    expect(calls).toEqual([[entity.id, false]])
  })

  it('offers nothing when there is nothing hidden and no pin to release', () => {
    renderNode({ entity: wide(), lod: 2 })

    expect(screen.queryByRole('button', { name: /more|Pinned/ })).not.toBeInTheDocument()
  })

  it('stays out of L0, where the DOM budget is the whole point', () => {
    // ADR-0004: L0 is name-only so 120 entities cost ~120 DOM nodes rather than ~1,000.
    // A row per box would double that to save a zoom. A pinned box always draws its own
    // footer, so there is no dead end.
    renderNode({ entity: wide(), lod: 0 })

    expect(screen.queryByRole('button', { name: /more/ })).not.toBeInTheDocument()
  })
})

describe('EntityNode notation cues', () => {
  it('labels a weak entity in text as well as by its border (NFR-4.4)', () => {
    renderNode({ entity: createEntity({ name: 'ORDER_LINE', kind: 'weak' }), lod: 2 })

    expect(screen.getByText('weak')).toBeInTheDocument()
  })

  it('names an unnamed entity rather than rendering an empty box', () => {
    renderNode({ entity: createEntity(), lod: 2 })

    expect(screen.getAllByText('unnamed').length).toBeGreaterThan(0)
  })

  it('exposes badge meanings as accessible titles', () => {
    renderNode({ entity: richEntity(), lod: 2 })

    expect(screen.getByTitle('Primary key')).toBeInTheDocument()
    expect(screen.getByTitle('Derived')).toBeInTheDocument()
  })

  it('names the foreign key target in the badge, not just "FK"', () => {
    // A badge reading only "FK" is a marker; the question in a large schema is always
    // "referencing what?". The target rides in the title so it costs no column.
    const entity = createEntity({
      name: 'ORDER',
      attributes: [
        {
          ...createAttribute({ name: 'customer_id' }),
          foreignKey: { entityId: 'ent_1' as EntityId, attributeId: 'att_1' as never },
        },
      ],
    })
    const fk = entity.attributes[0]!
    renderNode({
      entity,
      lod: 2,
      foreignKeyTargets: new Map([[fk.id, 'CUSTOMER.id']]),
    })

    expect(screen.getByTitle('Foreign key → CUSTOMER.id')).toBeInTheDocument()
  })

  it('falls back to a bare FK title when the target cannot be resolved', () => {
    const entity = createEntity({
      name: 'ORDER',
      attributes: [
        {
          ...createAttribute({ name: 'customer_id' }),
          foreignKey: { entityId: 'ent_1' as EntityId, attributeId: 'att_1' as never },
        },
      ],
    })
    renderNode({ entity, lod: 2 })

    expect(screen.getByTitle('Foreign key')).toBeInTheDocument()
  })

  it('marks nullable fields with a trailing ?, and required fields without one', () => {
    // Nullability had no cue at all before, despite being in the model and in the
    // Mermaid export.
    const entity = createEntity({
      name: 'ORDER',
      attributes: [
        createAttribute({ name: 'id', dataType: 'uuid', isPrimaryKey: true }),
        createAttribute({ name: 'note', dataType: 'text' }),
      ],
    })
    const { container } = renderNode({ entity, lod: 2 })
    const types = [...container.querySelectorAll('.erd-attr__type')].map((n) => n.textContent)

    expect(types).toEqual(['uuid', 'text?'])
  })

  it('marks the traced and dimmed states as data attributes, not inline styles', () => {
    // The trace treatment lives entirely in CSS so it can be restyled per notation and
    // suppressed under prefers-reduced-motion without touching the component.
    const { container } = renderNode({ entity: richEntity(), isTraced: true })

    expect(container.querySelector('.erd-node[data-traced]')).not.toBeNull()
  })
})

describe('settledPositions (NFR-1.1)', () => {
  const at = (id: string, x: number, y: number, dragging: boolean) =>
    ({ id, type: 'position', position: { x, y }, dragging }) as const

  it('ignores the frames emitted while a drag is still running', () => {
    // The whole point: each of these committed would run an Immer pass over the document
    // and rebuild every node and edge, at pointer rate.
    const moved = settledPositions([at('a', 10, 10, true), at('a', 20, 20, true)])

    expect(Object.keys(moved)).toHaveLength(0)
  })

  it('takes the position the drag settled on', () => {
    const moved = settledPositions([at('a', 10, 10, true), at('a', 99, 42, false)])

    expect(moved).toEqual({ a: { x: 99, y: 42 } })
  })

  it('commits every entity of a multi-selection drag as one batch', () => {
    // One batch is one `moveEntities` command, so a group drag is a single undo step.
    const moved = settledPositions([at('a', 1, 1, false), at('b', 2, 2, false)])

    expect(moved).toEqual({ a: { x: 1, y: 1 }, b: { x: 2, y: 2 } })
  })

  it('commits a keyboard nudge, which arrives already settled', () => {
    const moved = settledPositions([at('a', 5, 0, false)])

    expect(moved).toEqual({ a: { x: 5, y: 0 } })
  })

  it('ignores changes that are not positions', () => {
    // `select` is derived from the model, so accepting it here would fight the store for
    // ownership of the same fact. `dimensions` is NOT derived — it is measured from the
    // DOM — and it is claimed by `measuredDimensions` instead. This extractor only has to
    // leave it alone; see "the three tiers together" for the test that nothing drops it.
    const moved = settledPositions([
      { id: 'a', type: 'select', selected: true },
      { id: 'a', type: 'dimensions', dimensions: { width: 10, height: 10 } },
    ])

    expect(Object.keys(moved)).toHaveLength(0)
  })
})

describe('inFlightPositions', () => {
  const at = (id: string, x: number, y: number, dragging: boolean) =>
    ({ id, type: 'position', position: { x, y }, dragging }) as const

  it('reports the frames emitted while a drag is running', () => {
    const moving = inFlightPositions([at('a', 10, 10, true), at('a', 20, 20, true)])

    // The last frame wins: it is the one the box should be drawn at.
    expect(moving).toEqual({ a: { x: 20, y: 20 } })
  })

  it('ignores the settled frame, which the other tier commits', () => {
    const moving = inFlightPositions([at('a', 99, 42, false)])

    expect(Object.keys(moving)).toHaveLength(0)
  })

  it('reports every entity of a group drag', () => {
    const moving = inFlightPositions([at('a', 1, 1, true), at('b', 2, 2, true)])

    expect(moving).toEqual({ a: { x: 1, y: 1 }, b: { x: 2, y: 2 } })
  })

  it('ignores changes that are not positions', () => {
    const moving = inFlightPositions([
      { id: 'a', type: 'select', selected: true },
      { id: 'a', type: 'dimensions', dimensions: { width: 10, height: 10 } },
    ])

    expect(Object.keys(moving)).toHaveLength(0)
  })
})

describe('the two position tiers together', () => {
  const at = (id: string, x: number, y: number, dragging: boolean) =>
    ({ id, type: 'position', position: { x, y }, dragging }) as const

  /**
   * THE TEST THAT WAS MISSING.
   *
   * `settledPositions` was correct on its own, and its own tests passed: it dropped the
   * in-flight frames, exactly as asked. What nothing asserted was that anything else
   * PICKED THEM UP. Nothing did, so a dragged entity stayed frozen under the cursor and
   * appeared at the destination on release — the teleport, reproduced in Chrome with the
   * node's transform stuck at `matrix(1,0,0,1,0,0)` for the whole gesture.
   *
   * A test per function cannot catch that. This one is about the pair: every position
   * change a drag emits has to be claimed by exactly one tier — rendered, or committed,
   * never dropped.
   */
  it('claims every position change in exactly one tier', () => {
    const changes = [
      at('a', 10, 10, true),
      at('a', 20, 20, true),
      at('a', 30, 30, false),
      at('b', 5, 5, true),
      at('b', 6, 6, false),
    ]

    for (const change of changes) {
      const inFlight = Object.keys(inFlightPositions([change])).length
      const settled = Object.keys(settledPositions([change])).length

      expect(
        inFlight + settled,
        `${change.id} at dragging=${String(change.dragging)} was claimed by ${String(inFlight + settled)} tiers`,
      ).toBe(1)
    }
  })

  it('never renders and commits the same frame', () => {
    // Both tiers claiming a frame would commit a document write per pointer frame, which
    // is the cost NFR-1.3 exists to prevent.
    const frame = at('a', 7, 7, true)

    expect(Object.keys(inFlightPositions([frame]))).toEqual(['a'])
    expect(Object.keys(settledPositions([frame]))).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// MEASURED SIZES — THE THIRD TIER
// ─────────────────────────────────────────────────────────────────────────────

describe('measuredDimensions', () => {
  const sized = (id: string, width: number, height: number) =>
    ({ id, type: 'dimensions', dimensions: { width, height } }) as const

  it('takes the size React Flow measured', () => {
    expect(measuredDimensions([sized('a', 240, 120)])).toEqual({
      a: { width: 240, height: 120 },
    })
  })

  it('takes a size for every node in a batch', () => {
    // The first measurement pass reports every node at once, and that is the batch that
    // matters: miss it and the whole diagram is briefly un-clickable, not one box.
    expect(measuredDimensions([sized('a', 10, 20), sized('b', 30, 40)])).toEqual({
      a: { width: 10, height: 20 },
      b: { width: 30, height: 40 },
    })
  })

  it('ignores changes that are not dimensions', () => {
    const changes: NodeChange[] = [
      { id: 'a', type: 'position', position: { x: 1, y: 1 }, dragging: false },
      { id: 'a', type: 'select', selected: true },
    ]

    expect(Object.keys(measuredDimensions(changes))).toHaveLength(0)
  })

  it('ignores a dimensions change that carries no dimensions', () => {
    // React Flow emits `{ type: 'dimensions', resizing: true }` from its resize control,
    // with no size attached.
    const changes: NodeChange[] = [{ id: 'a', type: 'dimensions', resizing: true }]

    expect(Object.keys(measuredDimensions(changes))).toHaveLength(0)
  })
})

describe('sizesUnchanged', () => {
  // `EntityId` is branded, so a literal key needs the cast. The ids themselves are
  // opaque to every function under test here.
  const known = { a: { width: 10, height: 20 } } as Record<EntityId, Size>
  const sizes = (record: Record<string, Size>): Record<EntityId, Size> => record

  it('is true when the incoming size is the one already recorded', () => {
    expect(sizesUnchanged(known, sizes({ a: { width: 10, height: 20 } }))).toBe(true)
  })

  it('is false for a node that has never been measured', () => {
    expect(sizesUnchanged(known, sizes({ b: { width: 10, height: 20 } }))).toBe(false)
  })

  it('is false when the width changed', () => {
    expect(sizesUnchanged(known, sizes({ a: { width: 11, height: 20 } }))).toBe(false)
  })

  it('is false when the height changed', () => {
    expect(sizesUnchanged(known, sizes({ a: { width: 10, height: 21 } }))).toBe(false)
  })

  it('is false if any one of several sizes changed', () => {
    const two = sizes({ ...known, b: { width: 1, height: 1 } })

    expect(
      sizesUnchanged(two, sizes({ a: { width: 10, height: 20 }, b: { width: 2, height: 1 } })),
    ).toBe(false)
  })
})

describe('applySelectionChanges (FR-2.9)', () => {
  const select = (id: string, selected: boolean) => ({ id, type: 'select', selected }) as const

  it('ACCUMULATES, because React Flow reports deltas and not the whole band', () => {
    /*
     * THE TRAP THIS FUNCTION EXISTS FOR.
     *
     * `getSelectionChanges` compares the band's new answer with its previous one and emits
     * only the difference, so the batch that adds the fifth box says nothing about the
     * first four — they have been covered since the first frame and have not CHANGED.
     * Reading the latest batch, which is what every other tier in this file does, would
     * select one box out of five and look almost right.
     */
    let covered = applySelectionChanges(new Set<EntityId>(), [select('a', true)])
    covered = applySelectionChanges(covered, [select('b', true)])
    covered = applySelectionChanges(covered, [select('c', true)])

    expect([...covered].sort()).toEqual(['a', 'b', 'c'])
  })

  it('drops a box the band has moved off', () => {
    const covered = applySelectionChanges(new Set(['a', 'b'] as EntityId[]), [select('a', false)])

    expect([...covered]).toEqual(['b'])
  })

  it('returns the SAME set when the batch says nothing about selection', () => {
    // Identity, not equality. A band drag emits position and dimension batches too, and
    // minting a new Set for each would publish state — and rebuild the node array — on
    // every pointer frame rather than only when the covered set moves.
    const covered: ReadonlySet<EntityId> = new Set(['a'] as EntityId[])
    const changes: NodeChange[] = [
      { id: 'a', type: 'position', position: { x: 1, y: 1 }, dragging: true },
      { id: 'a', type: 'dimensions', dimensions: { width: 10, height: 10 } },
    ]

    expect(applySelectionChanges(covered, changes)).toBe(covered)
  })
})

describe('the four tiers together', () => {
  const node = (id: string): Node => ({ id, position: { x: 0, y: 0 }, data: {} })

  /**
   * THE OTHER TEST THAT WAS MISSING, AND THE SAME SHAPE AS THE POSITION ONE ABOVE.
   *
   * A node's measured size is not in the document — it is whatever the browser laid the
   * box out at, which React Flow measures and reports as a `dimensions` change. Those
   * changes were dropped, on the stated grounds that dimensions are "derived from the
   * model". They are not.
   *
   * React Flow re-adopts nodes by REFERENCE equality, so every rebuild of the node array
   * handed it objects carrying no `measured` and it forgot the size it had just reported.
   * It then rendered each box `visibility: hidden` until the next measurement — ~19 ms in
   * Chrome — and a click inside that window was not hit-tested against the node at all.
   * It landed on the pane behind, so clicking a table CLEARED the selection instead of
   * making one. The minimap, which reads the user node's size, was empty permanently.
   *
   * Every extractor passed its own tests. Nothing asked whether the change they each
   * declined was picked up by anything else, which is the same gap the position tiers had.
   */
  it('claims every change React Flow emits in exactly one tier', () => {
    const empty: ReadonlySet<EntityId> = new Set()
    const changes: NodeChange[] = [
      { id: 'a', type: 'position', position: { x: 10, y: 10 }, dragging: true },
      { id: 'a', type: 'position', position: { x: 30, y: 30 }, dragging: false },
      { id: 'a', type: 'dimensions', dimensions: { width: 240, height: 120 } },
      { id: 'b', type: 'dimensions', dimensions: { width: 180, height: 90 } },
      // The fourth tier, added with the marquee (FR-2.9). `select` used to be claimed by
      // NOTHING — React Flow drew a rubber band over the canvas and the selection it
      // computed went nowhere, which is the same shape of gap as the two above.
      { id: 'a', type: 'select', selected: true },
      { id: 'b', type: 'select', selected: false },
    ]

    changes.forEach((change, index) => {
      const claims =
        Object.keys(inFlightPositions([change])).length +
        Object.keys(settledPositions([change])).length +
        Object.keys(measuredDimensions([change])).length +
        // Identity, not size: a `select: false` on an empty set legitimately produces an
        // empty answer, and the question here is whether the tier reacted at all.
        (applySelectionChanges(empty, [change]) === empty ? 0 : 1)

      expect(
        claims,
        `change ${String(index)} (${change.type}) was claimed by ${String(claims)} tiers`,
      ).toBe(1)
    })
  })

  it('keeps every measured size React Flow itself would keep', () => {
    // The oracle is the library's own reducer: `applyNodeChanges` writes a dimensions
    // change straight onto the node as `measured`, which is the contract a controlled
    // graph is expected to honour. Agreeing with it IS the assertion — a mock could not
    // have told us we had the contract wrong.
    const base = [node('a'), node('b')]
    const changes: NodeChange[] = [
      { id: 'a', type: 'dimensions', dimensions: { width: 240, height: 120 } },
      { id: 'b', type: 'dimensions', dimensions: { width: 180, height: 90 } },
    ]

    const ours = overlayNodes(base, {}, measuredDimensions(changes))
    const theirs = applyNodeChanges(changes, base)

    expect(ours.map((candidate) => candidate.measured)).toEqual(
      theirs.map((candidate) => candidate.measured),
    )
    expect(ours.map((candidate) => candidate.measured)).toEqual([
      { width: 240, height: 120 },
      { width: 180, height: 90 },
    ])
  })

  it('a node rebuilt from an unchanged model still carries its measured size', () => {
    // The click-to-select bug in one assertion. Hovering, selecting, changing LOD and any
    // edit all rebuild the node objects out of the diagram; none of them changes how big a
    // box is, so all of them have to come out the other side still measured.
    const measured = measuredDimensions([
      { id: 'a', type: 'dimensions', dimensions: { width: 240, height: 120 } },
    ])

    const rebuilt = overlayNodes([node('a')], {}, measured)

    expect(rebuilt[0]!.measured).toEqual({ width: 240, height: 120 })
  })

  it('a drag moves a box without unmeasuring it', () => {
    // Both overlays at once. Losing the size mid-gesture would hide the box under the
    // cursor and drop the drag.
    const measured = { a: { width: 240, height: 120 } } as Record<EntityId, Size>
    const dragging = inFlightPositions([
      { id: 'a', type: 'position', position: { x: 55, y: 66 }, dragging: true },
    ])

    const [moved] = overlayNodes([node('a')], dragging, measured)

    expect(moved!.position).toEqual({ x: 55, y: 66 })
    expect(moved!.measured).toEqual({ width: 240, height: 120 })
  })

  it('leaves untouched nodes as the same object, so memo still holds', () => {
    // 120 boxes must not all re-render because one of them moved.
    const base = [node('a'), node('b')]

    const out = overlayNodes(base, { a: { x: 1, y: 1 } } as Record<EntityId, Point>, {})

    expect(out[0]).not.toBe(base[0])
    expect(out[1]).toBe(base[1])
  })

  /*
   * REUSING NODE OBJECTS — THE HALF `sameEntityNode` CANNOT SEE.
   *
   * That comparator decides whether a box redraws its CONTENTS. It says nothing about the
   * cost of handing React Flow a hundred and twenty freshly built node objects, which it
   * re-adopts one by one because `adoptUserNodes` keeps a node's internals only when the
   * incoming object IS the object it was given last time. Canvas rebuilds that array on
   * every hover and every click, so this is what stops the rebuild reaching the library.
   *
   * Measured in Chrome on the production build at 120 entities: hover p95 83-195 ms and
   * selection p95 147-162 ms against NFR-1.3's 100 ms budget, with every one of those
   * boxes answering "nothing in me changed".
   */
  describe('reuseUnchanged', () => {
    it('hands back the previous object for a node that did not change', () => {
      const previous = [node('a'), node('b')]
      const rebuilt = [node('a'), node('b')]

      const out = reuseUnchanged(previous, rebuilt)

      expect(out[0]).toBe(previous[0])
      expect(out[1]).toBe(previous[1])
      expect(out[0]).not.toBe(rebuilt[0])
    })

    it('returns the previous ARRAY when nothing at all changed', () => {
      // React Flow's StoreUpdater watches the array reference. Returning the same one
      // means a render where nothing moved costs it nothing at all, rather than an adopt
      // per node to discover that.
      const previous = [node('a'), node('b')]

      expect(reuseUnchanged(previous, [node('a'), node('b')])).toBe(previous)
    })

    it('keeps the node that changed, and only that one', () => {
      const previous = [node('a'), node('b'), node('c')]
      const rebuilt = [node('a'), { ...node('b'), selected: true }, node('c')]

      const out = reuseUnchanged(previous, rebuilt)

      expect(out[0]).toBe(previous[0])
      expect(out[1]).toBe(rebuilt[1])
      expect(out[2]).toBe(previous[2])
    })

    it('notices a change inside data, which is a new object on every rebuild', () => {
      // The field that matters here is `isTraced`. Comparing `data` by reference would
      // reuse nothing; comparing it deeply would walk every attribute of every entity,
      // which is the cost being avoided. Shallow is the only right answer, and it relies
      // on Canvas keeping each field in `data` reference-stable.
      const previous = [{ ...node('a'), data: { isTraced: false } }]
      const rebuilt = [{ ...node('a'), data: { isTraced: true } }]

      expect(reuseUnchanged(previous, rebuilt)[0]).toBe(rebuilt[0])
    })

    it('compares position by value, so an unplaced node is still reusable', () => {
      // `fallbackPosition` mints a fresh `{x, y}` per render for any entity with no
      // position yet, so comparing position by reference would refuse to reuse exactly
      // the nodes that never move.
      const previous = [{ ...node('a'), position: { x: 5, y: 6 } }]
      const rebuilt = [{ ...node('a'), position: { x: 5, y: 6 } }]

      expect(reuseUnchanged(previous, rebuilt)[0]).toBe(previous[0])
    })

    it('does not reuse across a change in the node set', () => {
      const previous = [node('a'), node('b')]

      const out = reuseUnchanged(previous, [node('a')])

      expect(out).toHaveLength(1)
      expect(out).not.toBe(previous)
      expect(out[0]).toBe(previous[0])
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// ALIGNMENT GUIDES — THE ARITHMETIC BETWEEN A Guide AND A div (FR-3.5)
// ─────────────────────────────────────────────────────────────────────────────
//
// Which lines to draw is `alignment.ts`, and it has its own suite. What is left here is
// the step that turns one of its answers into geometry, where the two axes mean opposite
// things — a guide with `axis: 'x'` is a VERTICAL line, so `position` is its x and
// `start`/`end` are its y extent. Swapping those produces a plausible-looking element in
// the wrong place, which every test of the pure half would still pass.
//
// Mounted inside a real `<ReactFlow>` because `ViewportPortal` renders into a div the
// library owns; with no provider it renders nothing and the assertions would pass on an
// empty document. That the portal is stacked ABOVE the node layer is a CSS question and
// belongs in `tests/e2e/interaction.spec.ts`, which has it.

describe('AlignmentGuides (FR-3.5)', () => {
  function renderGuides(guides: Guide[], zoom: number): RenderResult {
    return render(
      <ReactFlowProvider>
        <ReactFlow nodes={[]} edges={[]}>
          <AlignmentGuides guides={guides} zoom={zoom} />
        </ReactFlow>
      </ReactFlowProvider>,
    )
  }

  it('draws nothing at all when nothing is aligned', () => {
    const { container } = renderGuides([], 1)

    expect(container.querySelectorAll('.erd-guide')).toHaveLength(0)
  })

  it('draws a vertical line at the x it pins, spanning the y range', () => {
    const { container } = renderGuides([{ axis: 'x', position: 500, start: 40, end: 300 }], 1)
    const line = container.querySelector<HTMLElement>('.erd-guide')

    expect(line?.dataset['axis']).toBe('x')
    expect(line?.style.transform).toBe('translate(500px, 40px)')
    expect(line?.style.height).toBe('260px')
  })

  it('draws a horizontal line at the y it pins, spanning the x range', () => {
    const { container } = renderGuides([{ axis: 'y', position: 178, start: 320, end: 836 }], 1)
    const line = container.querySelector<HTMLElement>('.erd-guide')

    expect(line?.style.transform).toBe('translate(320px, 178px)')
    expect(line?.style.width).toBe('516px')
  })

  it('divides the thickness by the zoom, so the line stays a hairline', () => {
    // It lives inside React Flow's scaled layer, so an undivided 1px is a 3px bar at 3x
    // and invisible at 0.1x.
    const { container } = renderGuides([{ axis: 'x', position: 0, start: 0, end: 10 }], 4)

    expect(container.querySelector<HTMLElement>('.erd-guide')?.style.width).toBe('0.25px')
  })

  it('is hidden from assistive technology', () => {
    // It appears and vanishes at pointer rate, and says nothing a sighted user is not
    // already being told by the box moving under their hand (NFR-4.4).
    const { container } = renderGuides([{ axis: 'y', position: 0, start: 0, end: 10 }], 1)

    expect(container.querySelector('.erd-guide')?.getAttribute('aria-hidden')).toBe('true')
  })
})
