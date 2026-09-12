// Dispatches to the L0/L1/L2 variant for the current LOD.

import { Handle, Position, type NodeProps } from '@xyflow/react'
import { memo } from 'react'

import type { Attribute, AttributeId, Entity, Severity } from '../../../domain'
import type { LodLevel } from '../../../lib/lod'
import { useEditorActions } from '../EditorActions'

import { AttributeRow } from './AttributeRow'
import { InlineName } from './InlineName'
import { sameEntityNode } from './sameEntityNode'

/** What Canvas puts in `node.data`. */
export interface EntityNodeData extends Record<string, unknown> {
  entity: Entity
  lod: LodLevel
  /** Emphasised as part of the traced path (FR-4.1, FR-4.2). */
  isTraced: boolean
  /** Something else is traced, so this is pushed back. */
  tracedAttributeIds: ReadonlySet<AttributeId>
  selectedAttributeId: AttributeId | undefined
  /** attributeId -> "CUSTOMER.id". Resolved by the canvas, which holds the diagram. */
  foreignKeyTargets: ReadonlyMap<AttributeId, string>
  editable: boolean
  /**
   * Worst validation severity affecting this entity, including its own fields (FR-8.4).
   *
   * Field-level issues are rolled up to the box by the validator rather than drawn on the
   * row, because at L0 and L1 the offending row may not be rendered at all — and that is
   * exactly when the user most needs to be told the box needs attention.
   */
  issueSeverity: Severity | undefined
}

/**
 * How each severity is drawn on the box (FR-8.4).
 *
 * `info` is absent on purpose. FR-8.4 asks for markers on elements "with errors";
 * warnings are close enough to that to be worth the ink, but an info-level observation
 * about a correct model is not — a marker on every legitimate M:N would put a glyph on
 * half the diagram and teach the user to stop seeing them. Info lives in the panel only.
 *
 * A missing entry therefore means "draw nothing", which is also what makes this table
 * safer than a ternary: a severity added later is silently unmarked rather than silently
 * mislabelled as a warning.
 */
const ISSUE_MARKER: Partial<Record<Severity, { glyph: string; label: string }>> = {
  error: { glyph: '!', label: 'Has an error' },
  warning: { glyph: '?', label: 'Has a warning' },
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
    tracedAttributeIds,
    selectedAttributeId,
    foreignKeyTargets,
    editable,
    issueSeverity,
  } = data as unknown as EntityNodeData
  const actions = useEditorActions()

  // L0 is name-only. At 120 entities this is the difference between ~120 DOM nodes and
  // ~1,000 — the mechanism that makes NFR-1.1 reachable at all (ADR-0004).
  const rows = lod === 0 ? [] : lod === 1 ? keyAttributes(entity) : entity.attributes
  const hidden = entity.attributes.length - rows.length
  const marker = issueSeverity === undefined ? undefined : ISSUE_MARKER[issueSeverity]

  return (
    <div
      className="erd-node"
      data-kind={entity.kind}
      data-lod={lod}
      data-traced={isTraced || undefined}
      data-issue={marker === undefined ? undefined : issueSeverity}
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

        {/* The marker carries a glyph and a word, not just a colour (NFR-4.4), and the
            word is what a screen reader reads out. `title` gives the pointer the same
            information without needing a tooltip component. The detail lives in the
            panel; this is only the flag that says look there. */}
        {marker === undefined ? null : (
          <span className="erd-node__issue" data-severity={issueSeverity} title={marker.label}>
            <span aria-hidden="true">{marker.glyph}</span>
            <span className="erd-visually-hidden">{marker.label}</span>
          </span>
        )}
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

export const EntityNode = memo(EntityNodeComponent, sameEntityNode)
EntityNode.displayName = 'EntityNode'
