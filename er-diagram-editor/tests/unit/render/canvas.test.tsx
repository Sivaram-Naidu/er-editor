import { ReactFlowProvider } from '@xyflow/react'
import { render, screen, type RenderResult } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  createAttribute,
  createDiagram,
  createEntity,
  createRelationship,
  type Diagram,
  type Entity,
  type EntityId,
  type RelationshipId,
} from '../../../src/domain'
import { EntityNode, fallbackPosition, traceSets, type EntityNodeData } from '../../../src/render'

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
    // Load-bearing: empty sets mean `isDimmed` is false everywhere, so the resting
    // diagram renders at full strength rather than uniformly faded.
    const { diagram } = chain()
    const traced = traceSets(diagram, undefined, undefined)

    expect(traced.entities.size).toBe(0)
    expect(traced.relationships.size).toBe(0)
  })

  it('hovering an entity traces it and everything one hop out', () => {
    const { diagram, a, b, c } = chain()
    const traced = traceSets(diagram, b.id, undefined)

    expect(traced.entities.has(a.id)).toBe(true)
    expect(traced.entities.has(b.id)).toBe(true)
    expect(traced.entities.has(c.id)).toBe(true)
    expect(traced.relationships.size).toBe(2)
  })

  it('stops at one hop', () => {
    const { diagram, a, c } = chain()
    const traced = traceSets(diagram, a.id, undefined)

    expect(traced.entities.has(c.id)).toBe(false)
  })

  it('hovering a relationship traces it and exactly its two endpoints', () => {
    const { diagram, a, b, c } = chain()
    const relationshipId = diagram.relationships[0]!.id
    const traced = traceSets(diagram, undefined, relationshipId)

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
    const traced = traceSets(diagram, b.id, relationshipId)

    expect(traced.relationships.size).toBe(1)
  })

  it('handles a hover on an element that has just been deleted', () => {
    const { diagram } = chain()

    expect(traceSets(diagram, 'ent_gone' as EntityId, undefined).entities.size).toBe(0)
    expect(traceSets(diagram, undefined, 'rel_gone' as RelationshipId).entities.size).toBe(0)
  })

  it('traces a self-referencing relationship to a single entity', () => {
    const employee = createEntity({ name: 'EMPLOYEE' })
    const self = createRelationship({ from: employee.id, to: employee.id })
    const diagram = createDiagram({ entities: [employee], relationships: [self] })

    expect(traceSets(diagram, undefined, self.id).entities.size).toBe(1)
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

function renderNode(data: Partial<EntityNodeData> & { entity: Entity }): RenderResult {
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
      isDimmed: false,
      tracedAttributeIds: new Set<string>(),
      selectedAttributeId: undefined,
      foreignKeyTargets: new Map<string, string>(),
      editable: false,
      ...data,
    },
  } as unknown as NodeRenderProps

  return render(
    <ReactFlowProvider>
      <EntityNode {...props} />
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
