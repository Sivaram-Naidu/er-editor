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
import { useCallback, useMemo, useState } from 'react'

import {
  indexOf,
  type AttributeId,
  type Diagram,
  type EntityId,
  type Point,
  type RelationshipId,
  type Severity,
} from '../../domain'
import type { LodLevel } from '../../lib/lod'

import { RelationshipEdge, type RelationshipEdgeData } from './edges/RelationshipEdge'
import { CrowsFootMarkers } from './edges/endpoints'
import { EntityNode, type EntityNodeData } from './nodes/EntityNode'
import { SurfaceObserver, type PaneSize } from './SurfaceObserver'
import { RevealController } from './RevealController'
import {
  fallbackPosition,
  inFlightPositions,
  measuredDimensions,
  overlayNodes,
  reuseUnchanged,
  settledPositions,
  sizesUnchanged,
  traceSets,
  type Size,
} from './trace'

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
  /**
   * The measured size of the drawing surface, whenever it changes.
   *
   * Optional because it is only needed to convert screen coordinates to diagram ones —
   * a read-only surface that never places anything can leave it out. See PaneObserver.
   */
  onPaneResize?: (size: PaneSize) => void
  /**
   * Called once React Flow has measured and framed every node — see SurfaceObserver.
   *
   * Only the image export surface needs it: it is the signal that the DOM is worth
   * rasterising.
   */
  onNodesMeasured?: () => void
  showMinimap: boolean
  /**
   * Worst validation severity per element, for the inline markers of FR-8.4.
   *
   * Passed in rather than computed here because `render` may not import `store` and must
   * not know that a validator exists — it draws what it is told. Both default to empty,
   * so a read-only surface (export preview, print) can omit them and draw no markers.
   */
  issueSeverityByEntity?: ReadonlyMap<EntityId, Severity>
  issueSeverityByRelationship?: ReadonlyMap<RelationshipId, Severity>
  /** Camera request from outside the provider — see RevealController. */
  revealRequest?: { entityIds: readonly EntityId[]; nonce: number } | undefined
  /**
   * Drop off-screen nodes from the render tree. On by default, and should stay on for
   * anything a user interacts with — it is the single most important performance flag
   * here (NFR-2.4).
   *
   * The one caller that turns it off is the image export surface, which needs every node
   * in the DOM at once so it can be rasterised. Culling there would silently produce a
   * picture of one screenful and omit the rest of the schema.
   */
  cull?: boolean
  /**
   * Pin the camera instead of framing the graph on mount.
   *
   * Interactive surfaces omit this and get `fitView`, which is the right behaviour when
   * you do not know the container size in advance. The export surface does know it — it
   * sized the container from the diagram's own bounds — and needs zoom to be exactly 1,
   * because `fitView` applies its own padding and would rasterise the whole schema at
   * around 0.8 scale, which is visibly soft text for no reason.
   */
  viewport?: Viewport
}

const NO_SEVERITIES: ReadonlyMap<string, Severity> = new Map()

/** Shared for the same reason as `NOTHING_TRACED` in trace.ts — see the note there. */
const NO_TRACED_ATTRIBUTES: ReadonlySet<AttributeId> = new Set()

function CanvasInner(props: CanvasProps): React.ReactElement {
  const { diagram, lod, hoveredEntityId, hoveredRelationshipId } = props
  const { onMoveEntities } = props

  // Stable empty defaults, so an omitted prop does not produce a new Map on every render
  // and invalidate the node/edge memos below.
  const issueSeverityByEntity = props.issueSeverityByEntity ?? NO_SEVERITIES
  const issueSeverityByRelationship = props.issueSeverityByRelationship ?? NO_SEVERITIES

  /**
   * Positions of whatever is being dragged right now, before it is committed.
   *
   * Local to this component on purpose. It is written at pointer rate, so it must not
   * reach the document, the command stack or the undo history — see the two-tier note in
   * trace.ts. It holds only during a gesture and is empty the rest of the time.
   */
  const [dragged, setDragged] = useState<Record<EntityId, Point>>({})

  /**
   * The sizes React Flow has measured for each box, so it can be handed them back.
   *
   * Not a cache and not an optimisation — load-bearing. React Flow forgets a node's
   * measured size whenever the node object it is given is not the same object as last
   * time, and forgetting it makes the box briefly un-clickable and the minimap
   * permanently empty. The full chain is in trace.ts under `measuredDimensions`.
   *
   * Entries for deleted entities are left in place. They are only ever read by node id,
   * so a stale one is inert, and pruning would mean walking the record on the render path
   * to save a few bytes per entity.
   */
  const [measured, setMeasured] = useState<Record<EntityId, Size>>({})

  /**
   * The pinned trace (FR-4.4), derived from the selection rather than stored beside it.
   *
   * Reusing the selection is what keeps this from being a feature: no new state, no second
   * way to dismiss, and Escape and a pane click already do the right thing. Reduced to a
   * SCALAR before it reaches the memo below on purpose — passing the Set would put a value
   * that changes identity on every selection change into `traced`'s dependencies, and
   * `tracedAttributesByEntity` is memoised on `traced`, so every selection render would
   * hand each box a new set and redraw all of them. That is the defect NFR-1.3's guard in
   * `tests/unit/render/redraw.test.tsx` exists to catch.
   */
  const pinnedRelationshipId =
    props.selectedRelationshipIds.size === 1
      ? [...props.selectedRelationshipIds][0]
      : undefined

  const traced = useMemo(
    () => traceSets(diagram, hoveredEntityId, hoveredRelationshipId, pinnedRelationshipId),
    [diagram, hoveredEntityId, hoveredRelationshipId, pinnedRelationshipId],
  )

  const isTracing = traced.entities.size > 0 || traced.relationships.size > 0

  /**
   * Which attribute rows sit on the traced path, so an FK row can be picked out rather
   * than the whole box (FR-4.5) — as one set PER ENTITY, not one set for the diagram.
   *
   * The split is the point. A single shared Set has a new identity on every hover, so
   * every node's `data` carried a new `tracedAttributeIds` reference, `sameEntityNode`
   * returned false for all of them, and all 120 boxes redrew every row to highlight a
   * handful. Per entity, the few boxes with a traced FK row get a new Set and every other
   * box keeps the SHARED empty one, whose identity never changes.
   *
   * Entities with no traced rows are deliberately ABSENT from the Map rather than mapped
   * to an empty Set, so the lookup below falls through to `NO_TRACED_ATTRIBUTES` and the
   * stability is by construction rather than by remembering to reuse a constant here.
   *
   * Still memoised on `diagram.entities` rather than on `diagram`: moving a box produces
   * a new `Diagram` but the SAME `entities` array — Immer only copies the path it
   * mutated, and `applyLayout` touches `layout.positions` — so a position change does not
   * disturb any of this.
   */
  const tracedAttributesByEntity = useMemo(() => {
    const byEntity = new Map<EntityId, ReadonlySet<AttributeId>>()
    if (!isTracing) return byEntity

    for (const entity of diagram.entities) {
      let ids: Set<AttributeId> | undefined
      for (const attribute of entity.attributes) {
        const fk = attribute.foreignKey
        if (fk !== undefined && traced.entities.has(fk.entityId)) {
          ids ??= new Set<AttributeId>()
          ids.add(attribute.id)
        }
      }
      if (ids !== undefined) byEntity.set(entity.id, ids)
    }
    return byEntity
  }, [diagram.entities, isTracing, traced])

  /**
   * "CUSTOMER.id" for every foreign key. An FK badge that only says "FK" is a marker
   * rather than information — the question in a large schema is always "referencing
   * what?".
   *
   * Keyed on `diagram.entities` for the same reason as above: this is derived from
   * entities alone, so rebuilding it when a position changes would hand every node a new
   * Map and re-render every row for a move. That is also why the entity lookup is built
   * here rather than taken from `indexOf(diagram)` — that index is cached on the Diagram
   * OBJECT, so a position change misses the cache and rebuilds all four of its maps.
   */
  const foreignKeyTargets = useMemo(() => {
    const targets = new Map<AttributeId, string>()
    const entityById = new Map(diagram.entities.map((entity) => [entity.id, entity]))

    for (const entity of diagram.entities) {
      for (const attribute of entity.attributes) {
        const fk = attribute.foreignKey
        if (fk === undefined) continue
        const target = entityById.get(fk.entityId)
        const column = target?.attributes.find((candidate) => candidate.id === fk.attributeId)
        if (target !== undefined && column !== undefined) {
          targets.set(attribute.id, `${target.name || 'unnamed'}.${column.name || 'unnamed'}`)
        }
      }
    }
    return targets
  }, [diagram.entities])

  const baseNodes = useMemo<Node<EntityNodeData>[]>(() => {
    return diagram.entities.map((entity, index) => ({
      id: entity.id,
      type: 'entity',
      position: diagram.layout.positions[entity.id] ?? fallbackPosition(index),
      selected: props.selectedEntityIds.has(entity.id),
      data: {
        entity,
        lod,
        isTraced: traced.entities.has(entity.id),
        tracedAttributeIds: tracedAttributesByEntity.get(entity.id) ?? NO_TRACED_ATTRIBUTES,
        selectedAttributeId: props.selectedAttributeId,
        foreignKeyTargets,
        editable: props.editable,
        issueSeverity: issueSeverityByEntity.get(entity.id),
      },
    }))
  }, [
    diagram,
    lod,
    traced,
    tracedAttributesByEntity,
    foreignKeyTargets,
    props.selectedEntityIds,
    props.selectedAttributeId,
    props.editable,
    issueSeverityByEntity,
  ])

  /**
   * The base nodes with the dragged ones moved and the measured sizes reattached.
   *
   * `overlayNodes` lives in trace.ts, next to the three extractors that feed it, because
   * the assertion worth making is about the whole pipeline rather than any one part of it.
   */
  const overlaid = useMemo<Node<EntityNodeData>[]>(() => {
    if (Object.keys(dragged).length === 0 && Object.keys(measured).length === 0) {
      return baseNodes
    }

    return overlayNodes(baseNodes, dragged, measured)
  }, [baseNodes, dragged, measured])

  /*
   * WHAT REACT FLOW IS ALREADY HOLDING, SO THE UNCHANGED NODES CAN BE HANDED BACK
   *
   * `reuseUnchanged` needs the previous array, and the obvious home for it — a ref — is
   * not available: `react-hooks/refs` forbids reading or writing one during render, and it
   * is right to, because a ref read during render can leave the output disagreeing with
   * what React committed.
   *
   * So it is state, adjusted DURING render rather than in an effect. That is the same
   * pattern `InlineName` uses to re-sync a draft, and it is in CLAUDE.md for the same
   * reason: an effect would commit the un-reused array first and correct it on a second
   * pass, which is the cascading render `react-hooks/set-state-in-effect` exists to stop.
   *
   * It converges in one extra pass of this component and no more. On the second pass the
   * memo above is a cache hit, so `overlaid` is the same array; every node in it then
   * matches the one just stored; `reuseUnchanged` returns that stored array unchanged; and
   * the condition below is false. Children render once, with the final array.
   *
   * ── AND WHY SELECTION IS EXEMPT FROM ALL OF IT ──────────────────────────────────────
   *
   * `adoptUserNodes` keeping a node's internals on reference equality is the whole reason
   * reuse works — and those internals INCLUDE `selected`. React Flow maintains its own idea
   * of what is selected as well as reading ours, and the two disagree routinely: Shift is
   * React Flow's marquee key, not its multi-select key, so it treats a shift-click as a
   * plain one and internally deselects everything else. This app treats it as "add to the
   * selection" (FR-2.7), and the store is the authority.
   *
   * While every node object was rebuilt on every render, our `selected` was re-asserted
   * constantly and React Flow's private opinion never survived a frame. Reuse silences
   * that: hand back the same object and the library keeps its own answer. Shift-clicking a
   * second table left one box highlighted while the store held two — the model was right
   * and only the view was stale, which is the hardest version of this to notice.
   *
   * So a render in which the selection changed rebuilds every node, deliberately. It is
   * the render where being right matters and the one place the saving is not worth having:
   * a selection change is one per click, where a hover is one per pointer frame.
   */
  const [held, setHeld] = useState<{
    selection: ReadonlySet<EntityId>
    nodes: Node<EntityNodeData>[]
  }>({ selection: props.selectedEntityIds, nodes: overlaid })

  const selectionMoved = held.selection !== props.selectedEntityIds
  const nodes = selectionMoved ? overlaid : reuseUnchanged(held.nodes, overlaid)
  if (selectionMoved || nodes !== held.nodes) {
    setHeld({ selection: props.selectedEntityIds, nodes })
  }

  const edges = useMemo<Edge<RelationshipEdgeData>[]>(() => {
    const { entityById } = indexOf(diagram)

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
            sourceName: entityById.get(from.entityId)?.name ?? '',
            targetName: entityById.get(to.entityId)?.name ?? '',
            isTraced: traced.relationships.has(relationship.id),
            issueSeverity: issueSeverityByRelationship.get(relationship.id),
          },
          selected: props.selectedRelationshipIds.has(relationship.id),
        },
      ]
    })
  }, [diagram, traced, props.selectedRelationshipIds, issueSeverityByRelationship])

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
      // Which changes count, and why, lives in trace.ts — see the two-tier note there.
      const moving = inFlightPositions(changes)
      if (Object.keys(moving).length > 0) {
        setDragged((previous) => ({ ...previous, ...moving }))
      }

      // Give React Flow back the sizes it measured, or it forgets them on the next
      // rebuild of the node array and the box stops being clickable. See trace.ts.
      const sized = measuredDimensions(changes)
      if (Object.keys(sized).length > 0) {
        setMeasured((previous) =>
          sizesUnchanged(previous, sized) ? previous : { ...previous, ...sized },
        )
      }

      const moved = settledPositions(changes)
      if (Object.keys(moved).length > 0) {
        // The gesture is over, so the whole overlay goes — not just the settled ids. A
        // partial clear would leave anything still in it pinned to a stale position with
        // no gesture left to move it. Both this and the commit happen in one event, so
        // React batches them and the node never renders between the two.
        setDragged((previous) => (Object.keys(previous).length === 0 ? previous : {}))
        onMoveEntities(moved)
      }
    },
    [onMoveEntities],
  )

  return (
    /*
     * ONE FLAG FOR "SOMETHING IS TRACED", AND THE DIMMING IS CSS FROM HERE DOWN.
     *
     * Everything off the traced path recedes (FR-4.1), which used to be a per-element
     * `isDimmed` boolean in `node.data` and `edge.data`. That made dimming an O(N) state
     * change: starting a hover flipped the flag on all N-1 boxes that are NOT traced, so
     * every node object and every edge object was rebuilt to express a fact about the
     * diagram as a whole rather than anything about a particular box.
     *
     * `.erd-canvas[data-tracing] .erd-node:not([data-traced])` says the same thing with
     * one attribute on one div, and leaves `isTraced` — which really is per-box, and
     * really does change for only the handful on the path — as the only trace state a node
     * carries. See canvas.css.
     */
    <div className="erd-canvas" data-tracing={isTracing || undefined}>
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
         * schema size. See the `cull` prop for the one surface that opts out. */
        onlyRenderVisibleElements={props.cull ?? true}
        minZoom={0.1}
        maxZoom={3}
        proOptions={{ hideAttribution: true }}
        {...(props.viewport === undefined
          ? { fitView: true }
          : { defaultViewport: props.viewport })}
        /* Selection is owned by the store, so React Flow's own drag-select stays off;
         * the marquee arrives later wired to the same store. */
        selectionOnDrag={false}
        panOnDrag
        /* Drag-to-connect is the gesture people reach for first in a diagram tool.
         * Leaving it off meant the only route to a relationship was select-two-then-R,
         * which is discoverable only if you already know it is there. */
        nodesConnectable={props.editable}
        /* Both editing gates come off the same flag. `nodesDraggable` defaults to true,
         * so before this a surface declaring `editable={false}` still let the user drag
         * boxes — and `onNodesChange` still fired `onMoveEntities`, which means the
         * "read-only" preview was writing move commands into the document it was
         * previewing. Connecting was gated; moving was not. */
        nodesDraggable={props.editable}
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
        <SurfaceObserver onResize={props.onPaneResize} onNodesMeasured={props.onNodesMeasured} />
        <RevealController request={props.revealRequest} />
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
