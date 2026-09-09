// Dispatches to the L0/L1/L2 variant for the current LOD.

import { Handle, Position, type NodeProps } from '@xyflow/react'
import { memo } from 'react'

import type { Attribute, AttributeId, Entity } from '../../../domain'
import type { LodLevel } from '../../../lib/lod'
import { useEditorActions } from '../EditorActions'

import { AttributeRow } from './AttributeRow'
import { InlineName } from './InlineName'

/** What Canvas puts in `node.data`. */
export interface EntityNodeData extends Record<string, unknown> {
  entity: Entity
  lod: LodLevel
  /** Emphasised as part of the traced path (FR-4.1, FR-4.2). */
  isTraced: boolean
  /** Something else is traced, so this is pushed back. */
  isDimmed: boolean
  tracedAttributeIds: ReadonlySet<string>
  selectedAttributeId: AttributeId | undefined
  /** attributeId -> "CUSTOMER.id". Resolved by the canvas, which holds the diagram. */
  foreignKeyTargets: ReadonlyMap<string, string>
  editable: boolean
}

/** L1 shows only the attributes that carry identity or a reference (SRS §2.2). */
function keyAttributes(entity: Entity): Attribute[] {
  return entity.attributes.filter(
    (attribute) => attribute.isPrimaryKey || attribute.foreignKey !== undefined,
  )
}

function EntityNodeComponent({ data }: NodeProps): React.ReactElement {
  const {
    entity,
    lod,
    isTraced,
    isDimmed,
    tracedAttributeIds,
    selectedAttributeId,
    foreignKeyTargets,
    editable,
  } = data as unknown as EntityNodeData
  const actions = useEditorActions()

  // L0 is name-only. At 120 entities this is the difference between ~120 DOM nodes and
  // ~1,000 — the mechanism that makes NFR-1.1 reachable at all (ADR-0004).
  const rows = lod === 0 ? [] : lod === 1 ? keyAttributes(entity) : entity.attributes
  const hidden = entity.attributes.length - rows.length

  return (
    <div
      className="erd-node"
      data-kind={entity.kind}
      data-lod={lod}
      data-traced={isTraced || undefined}
      data-dimmed={isDimmed || undefined}
    >
      {/* Box-level handles. Per-row handles appear at L2, where the rows exist. */}
      <Handle type="target" position={Position.Left} className="erd-handle erd-handle--node" />
      <Handle type="source" position={Position.Right} className="erd-handle erd-handle--node" />

      <header className="erd-node__header">
        {editable ? (
          <InlineName
            value={entity.name}
            placeholder="unnamed"
            ariaLabel={`Rename entity ${entity.name}`}
            className="erd-node__name"
            onCommit={(next) => {
              actions.renameEntity(entity.id, next)
            }}
          />
        ) : (
          <span className="erd-node__name">
            {entity.name === '' ? <em className="erd-attr__unnamed">unnamed</em> : entity.name}
          </span>
        )}
        {/* Weak entities are drawn with a doubled border; the word is here for screen
            readers and for anyone who does not know the convention (NFR-4.4). */}
        {entity.kind === 'weak' ? <span className="erd-node__kind">weak</span> : null}
      </header>

      {rows.length === 0 ? null : (
        <div className="erd-node__attrs">
          {rows.map((attribute) => (
            <AttributeRow
              key={attribute.id}
              entityId={entity.id}
              attribute={attribute}
              showHandles={lod === 2}
              isTraced={tracedAttributeIds.has(attribute.id)}
              isSelected={selectedAttributeId === attribute.id}
              foreignKeyTarget={foreignKeyTargets.get(attribute.id)}
              editable={editable}
            />
          ))}
        </div>
      )}

      {hidden > 0 && lod === 1 ? <div className="erd-node__more">{hidden} more</div> : null}

      {/* Adding a field belongs on the box, not in the panel: it is the second most
          common edit after renaming, and putting it here keeps the eyes on the diagram.
          Only at L2, where the field list is actually visible. */}
      {editable && lod === 2 ? (
        <button
          type="button"
          className="erd-node__add"
          onClick={() => {
            actions.addAttribute(entity.id)
          }}
          onPointerDown={(event) => {
            event.stopPropagation()
          }}
        >
          + Add field
        </button>
      ) : null}
    </div>
  )
}

// Memoised on `data` identity. Canvas rebuilds node data only when the diagram, the LOD
// or the traced set changes, so panning and zooming within a level re-render nothing.
export const EntityNode = memo(EntityNodeComponent)
EntityNode.displayName = 'EntityNode'
