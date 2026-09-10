// Badges, inline edit, per-row connection handle (FR-4.5).

import { Handle, Position } from '@xyflow/react'

import type { Attribute, EntityId } from '../../../domain'
import { compactBadges } from '../../notation/compact'
import { useEditorActions } from '../EditorActions'

import { InlineName } from './InlineName'

export interface AttributeRowProps {
  entityId: EntityId
  attribute: Attribute
  /** Per-row handles let a connector attach to the FK row rather than the box (FR-4.5). */
  showHandles: boolean
  /** True when this row's foreign key is part of the traced path. */
  isTraced: boolean
  isSelected: boolean
  /** "CUSTOMER.id" — resolved by the canvas, which is the only thing holding the diagram. */
  foreignKeyTarget: string | undefined
  editable: boolean
}

const toneClass: Record<string, string> = {
  key: 'erd-badge erd-badge--key',
  ref: 'erd-badge erd-badge--ref',
  shape: 'erd-badge erd-badge--shape',
}

/**
 * A foreign key badge that only says "FK" is a marker, not information — in a 100-table
 * schema the question is always "referencing what?". The target rides in the badge title
 * so it is one hover away without spending a column on it.
 */
function badgeTitle(label: string, foreignKeyTarget: string | undefined): string {
  if (label !== 'Foreign key') return label
  return foreignKeyTarget === undefined ? label : `Foreign key → ${foreignKeyTarget}`
}

export function AttributeRow(props: AttributeRowProps): React.ReactElement {
  const { attribute } = props
  const badges = compactBadges(attribute)
  const actions = useEditorActions()

  return (
    <div
      className="erd-attr"
      data-traced={props.isTraced || undefined}
      data-selected={props.isSelected || undefined}
      onClick={() => {
        actions.selectAttribute(props.entityId, attribute.id)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') actions.selectAttribute(props.entityId, attribute.id)
      }}
      role="button"
      tabIndex={-1}
    >
      {props.showHandles ? (
        <>
          <Handle
            type="target"
            position={Position.Left}
            id={`${attribute.id}-target`}
            className="erd-handle"
          />
          <Handle
            type="source"
            position={Position.Right}
            id={`${attribute.id}-source`}
            className="erd-handle"
          />
        </>
      ) : null}

      {/* Primary keys are underlined, not merely coloured — the standard ER cue, and it
          survives greyscale and colour-blindness (NFR-4.4). Derived attributes take a
          dashed underline, mirroring the dashed oval of Chen notation. */}
      {props.editable ? (
        <InlineName
          value={attribute.name}
          placeholder="unnamed"
          ariaLabel={`Rename field ${attribute.name}`}
          className="erd-attr__name"
          displayProps={{
            'data-key': attribute.isPrimaryKey || undefined,
            'data-derived': attribute.isDerived || undefined,
          }}
          onCommit={(next) => {
            actions.renameAttribute(props.entityId, attribute.id, next)
          }}
        />
      ) : (
        <span
          className="erd-attr__name"
          /* Read-only surfaces clip the same way the editable ones do, so they need the
             same tooltip — this is the only place the full name is available. */
          title={attribute.name === '' ? undefined : attribute.name}
          data-key={attribute.isPrimaryKey || undefined}
          data-derived={attribute.isDerived || undefined}
        >
          {attribute.name === '' ? <em className="erd-attr__unnamed">unnamed</em> : attribute.name}
        </span>
      )}

      {/* Nullability had no cue at all before: a row gave no way to tell NOT NULL from
          nullable, even though the model carries it and Mermaid export uses it.
          A trailing `?` is the cheapest legible marker — it costs no column, reads at
          11px, and is familiar from optional-type syntax. The SQL convention of
          annotating NOT NULL instead was rejected because required columns are the
          minority in most schemas, so it would print more ink, not less. */}
      {attribute.dataType === undefined && !attribute.isNullable ? null : (
        <span className="erd-attr__type" title={attribute.isNullable ? 'Nullable' : 'Required'}>
          {attribute.dataType ?? ''}
          {attribute.isNullable ? <span className="erd-attr__nullable">?</span> : null}
        </span>
      )}

      {badges.length === 0 ? null : (
        <span className="erd-attr__badges">
          {badges.map((badge) => (
            <abbr
              key={badge.label}
              className={toneClass[badge.tone] ?? 'erd-badge'}
              title={badgeTitle(badge.label, props.foreignKeyTarget)}
            >
              {badge.glyph}
            </abbr>
          ))}
        </span>
      )}
    </div>
  )
}
