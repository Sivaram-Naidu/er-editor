// <ReactFlow> host: onlyRenderVisibleElements, MiniMap, Controls (FR-2.1–2.5).

import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type Viewport,
} from '@xyflow/react'
import { useCallback, useMemo } from 'react'

import type { AttributeId, Diagram, EntityId, Point, RelationshipId } from '../../domain'
import type { LodLevel } from '../../lib/lod'

import { RelationshipEdge, type RelationshipEdgeData } from './edges/RelationshipEdge'
import { CrowsFootMarkers } from './edges/endpoints'
import { EntityNode, type EntityNodeData } from './nodes/EntityNode'
import { fallbackPosition, traceSets } from './trace'

const nodeTypes = { entity: EntityNode }
const edgeTypes = { relationship: RelationshipEdge }

export interface CanvasProps {
  diagram: Diagram
  lod: LodLevel
  hoveredEntityId: EntityId | undefined
  hoveredRelationshipId: RelationshipId | undefined
  selectedEntityIds: ReadonlySet<EntityId>
  selectedRelationshipIds: ReadonlySet<RelationshipId>
  selectedAttributeId: AttributeId | undefined
  /** Editing is off for read-only surfaces (print, export preview). */
  editable: boolean
  onHoverEntity: (id: EntityId | undefined) => void
  onHoverRelationship: (id: RelationshipId | undefined) => void
  onSelectEntities: (ids: EntityId[], additive: boolean) => void
  onSelectRelationship: (id: RelationshipId) => void
  /**
   * Drag from one entity to another (FR-1.4).
   *
   * `sourceAttributeId` is set when the drag started on a specific field row rather than
   * on the box edge, which lets the caller wire the foreign key at the same time.
   */
  onConnect: (
    source: EntityId,
    target: EntityId,
    sourceAttributeId: AttributeId | undefined,
  ) => void
  onMoveEntities: (positions: Record<EntityId, Point>) => void
  onViewportChange: (viewport: Viewport) => void
  showMinimap: boolean
}

function CanvasInner(props: CanvasProps): React.ReactElement {
  const { diagram, lod, hoveredEntityId, hoveredRelationshipId } = props
  const { onMoveEntities } = props

  const traced = useMemo(
    () => traceSets(diagram, hoveredEntityId, hoveredRelationshipId),
    [diagram, hoveredEntityId, hoveredRelationshipId],
  )

  const isTracing = traced.entities.size > 0 || traced.relationships.size > 0

  const nodes = useMemo<Node<EntityNodeData>[]>(() => {
    // Which attribute rows sit on the traced path, so an FK row can be picked out rather
    // than the whole box (FR-4.5).
    const tracedAttributeIds = new Set<string>()
    if (isTracing) {
      for (const entity of diagram.entities) {
        for (const attribute of entity.attributes) {
          const fk = attribute.foreignKey
          if (fk !== undefined && traced.entities.has(fk.entityId)) {
            tracedAttributeIds.add(attribute.id)
          }
        }
      }
    }

    // "CUSTOMER.id" for every foreign key, resolved once per diagram change. An FK badge
    // that only says "FK" is a marker rather than information — the question in a large
    // schema is always "referencing what?".
    const foreignKeyTargets = new Map<string, string>()
    const entityById = new Map(diagram.entities.map((entity) => [entity.id, entity]))
    for (const entity of diagram.entities) {
      for (const attribute of entity.attributes) {
        const fk = attribute.foreignKey
        if (fk === undefined) continue
        const target = entityById.get(fk.entityId)
        const column = target?.attributes.find((candidate) => candidate.id === fk.attributeId)
        if (target !== undefined && column !== undefined) {
          foreignKeyTargets.set(
            attribute.id,
            `${target.name || 'unnamed'}.${column.name || 'unnamed'}`,
          )
        }
      }
    }

    return diagram.entities.map((entity, index) => ({
      id: entity.id,
      type: 'entity',
      position: diagram.layout.positions[entity.id] ?? fallbackPosition(index),
      selected: props.selectedEntityIds.has(entity.id),
      data: {
        entity,
        lod,
        isTraced: traced.entities.has(entity.id),
        isDimmed: isTracing && !traced.entities.has(entity.id),
        tracedAttributeIds,
        selectedAttributeId: props.selectedAttributeId,
        foreignKeyTargets,
        editable: props.editable,
      },
    }))
  }, [
    diagram,
    lod,
    traced,
    isTracing,
    props.selectedEntityIds,
    props.selectedAttributeId,
    props.editable,
  ])

  const edges = useMemo<Edge<RelationshipEdgeData>[]>(() => {
    const nameById = new Map(diagram.entities.map((entity) => [entity.id, entity.name]))

    return diagram.relationships.flatMap((relationship) => {
      const [from, to] = relationship.participants
      if (from === undefined || to === undefined) return []

      return [
        {
          id: relationship.id,
          type: 'relationship',
          source: from.entityId,
          target: to.entityId,
          data: {
            relationship,
            sourceName: nameById.get(from.entityId) ?? '',
            targetName: nameById.get(to.entityId) ?? '',
            isTraced: traced.relationships.has(relationship.id),
            isDimmed: isTracing && !traced.relationships.has(relationship.id),
          },
          selected: props.selectedRelationshipIds.has(relationship.id),
        },
      ]
    })
  }, [diagram, traced, isTracing, props.selectedRelationshipIds])

  /** Handle ids are `<attributeId>-source` / `-target`; box handles have no id. */
  const attributeIdFromHandle = (handle: string | null | undefined): AttributeId | undefined => {
    if (handle === null || handle === undefined) return undefined
    const trimmed = handle.replace(/-(source|target)$/, '')
    return trimmed === handle ? undefined : (trimmed as AttributeId)
  }

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (connection.source === '' || connection.target === '') return
      props.onConnect(
        connection.source as EntityId,
        connection.target as EntityId,
        attributeIdFromHandle(connection.sourceHandle),
      )
    },
    [props],
  )

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      // Only position changes are forwarded. Everything else React Flow wants to track
      // (dimensions, selection) is derived from the model, so accepting it here would
      // fight the store for ownership of the same fact.
      const moved: Record<EntityId, Point> = {}
      for (const change of changes) {
        if (change.type === 'position' && change.position !== undefined) {
          moved[change.id as EntityId] = change.position
        }
      }
      if (Object.keys(moved).length > 0) onMoveEntities(moved)
    },
    [onMoveEntities],
  )

  return (
    <div className="erd-canvas">
      <CrowsFootMarkers />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={handleNodesChange}
        onNodeMouseEnter={(_event, node) => {
          props.onHoverEntity(node.id as EntityId)
        }}
        onNodeMouseLeave={() => {
          props.onHoverEntity(undefined)
        }}
        onEdgeMouseEnter={(_event, edge) => {
          props.onHoverRelationship(edge.id as RelationshipId)
        }}
        onEdgeMouseLeave={() => {
          props.onHoverRelationship(undefined)
        }}
        onNodeClick={(event, node) => {
          props.onSelectEntities([node.id as EntityId], event.shiftKey)
        }}
        onEdgeClick={(_event, edge) => {
          props.onSelectRelationship(edge.id as RelationshipId)
        }}
        onPaneClick={() => {
          props.onSelectEntities([], false)
        }}
        onMove={(_event, viewport) => {
          props.onViewportChange(viewport)
        }}
        /* The most important performance flag on this component: nodes outside the
         * viewport are dropped from the render tree entirely (NFR-2.4). Together with
         * LOD it keeps drawn element count proportional to screen area rather than to
         * schema size. */
        onlyRenderVisibleElements
        minZoom={0.1}
        maxZoom={3}
        proOptions={{ hideAttribution: true }}
        fitView
        /* Selection is owned by the store, so React Flow's own drag-select stays off;
         * the marquee arrives later wired to the same store. */
        selectionOnDrag={false}
        panOnDrag
        /* Drag-to-connect is the gesture people reach for first in a diagram tool.
         * Leaving it off meant the only route to a relationship was select-two-then-R,
         * which is discoverable only if you already know it is there. */
        nodesConnectable={props.editable}
        onConnect={handleConnect}
        /* Click the dot on one table, then click the other — no drag precision, and it
         * works on a trackpad. Same handles as the drag, so there is nothing extra to
         * discover. */
        connectOnClick
        connectionLineStyle={{
          stroke: 'var(--erd-signal)',
          strokeWidth: 2,
          strokeDasharray: '4 3',
        }}
        /* Self-joins are legitimate (FR-1.12), so the only invalid connection is one with
         * a missing end. React Flow already prevents those, so nothing is rejected here. */
        deleteKeyCode={null}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="var(--erd-grid)" />
        <Controls showInteractive={false} />
        {props.showMinimap ? (
          /* `nodeColor` is required, not decorative. MiniMap derives a node's fill from
             its inline style; ours are styled by CSS class, so without this it draws
             invisible rectangles and the minimap renders as an empty white box.
             Traced nodes take the signal colour so the minimap shows where you are
             looking, which is most of its value at 120 entities (FR-2.5). */
          <MiniMap
            pannable
            zoomable
            ariaLabel="Diagram overview"
            className="erd-minimap"
            nodeColor={(node) =>
              (node.data as unknown as EntityNodeData).isTraced
                ? 'var(--erd-signal)'
                : 'var(--erd-rule-strong)'
            }
            nodeStrokeWidth={0}
            maskColor="var(--erd-minimap-mask)"
          />
        ) : null}
      </ReactFlow>
    </div>
  )
}

export function Canvas(props: CanvasProps): React.ReactElement {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  )
}
