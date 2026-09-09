// Per-field controls: type, constraints and the foreign key target (FR-1.3, FR-1.11).

import type { Attribute, AttributeId, Entity, ForeignKeyRef } from '../../domain'

import { Field, Toggle } from './controls'

/**
 * Common SQL types, offered as autocomplete rather than as a closed list.
 *
 * SRS §11 leaves the type system as an open question and V1 answers it with free text
 * (FR-1.3): the tool does not target a dialect, and rejecting `citext` or `jsonb[]`
 * because they are not on a list would be worse than accepting a typo. The datalist
 * makes the common case fast without making the uncommon case impossible.
 */
const COMMON_TYPES = [
  'uuid',
  'int',
  'bigint',
  'smallint',
  'serial',
  'varchar(255)',
  'text',
  'boolean',
  'date',
  'timestamptz',
  'numeric(10,2)',
  'json',
  'jsonb',
]

export interface AttributeEditorProps {
  entity: Entity
  attribute: Attribute
  /** Everything a foreign key could point at. */
  entities: readonly Entity[]
  onPatch: (patch: Record<string, unknown>) => void
  onSetForeignKey: (target: ForeignKeyRef | null) => void
  onDelete: () => void
  onMove: (direction: -1 | 1) => void
  canMoveUp: boolean
  canMoveDown: boolean
}

export function AttributeEditor(props: AttributeEditorProps): React.ReactElement {
  const { attribute } = props

  /**
   * Only key attributes are offered as foreign key targets.
   *
   * FR-1.11 requires the picker be "restricted to key attributes". Referencing a
   * non-unique column is not a foreign key in any relational sense, and offering it
   * would produce a diagram that exports to SQL the database would reject.
   */
  const targetableEntities = props.entities.filter((entity) =>
    entity.attributes.some((candidate) => candidate.isPrimaryKey || candidate.isUnique),
  )
  const fkEntity = props.entities.find((entity) => entity.id === attribute.foreignKey?.entityId)
  const fkColumns = (fkEntity?.attributes ?? []).filter(
    (candidate) => candidate.isPrimaryKey || candidate.isUnique,
  )

  return (
    <div className="erd-inspector__section">
      <div className="erd-inspector__sectionhead">
        <h3>Field</h3>
        <div className="erd-inspector__rowactions">
          <button
            type="button"
            className="erd-btn erd-btn--small"
            disabled={!props.canMoveUp}
            onClick={() => {
              props.onMove(-1)
            }}
            title="Move field up"
          >
            ↑
          </button>
          <button
            type="button"
            className="erd-btn erd-btn--small"
            disabled={!props.canMoveDown}
            onClick={() => {
              props.onMove(1)
            }}
            title="Move field down"
          >
            ↓
          </button>
        </div>
      </div>

      {/* "Field name" rather than "Name": the entity section above is visible at the
          same time and also has a Name. Two identically-labelled inputs in one panel are
          ambiguous to read and ambiguous to a screen reader. */}
      <Field label="Field name">
        <input
          className="erd-input"
          value={attribute.name}
          onChange={(event) => {
            props.onPatch({ name: event.target.value })
          }}
        />
      </Field>

      <Field label="Type">
        <input
          className="erd-input"
          list="erd-common-types"
          placeholder="e.g. varchar(255)"
          value={attribute.dataType ?? ''}
          onChange={(event) => {
            props.onPatch({ dataType: event.target.value === '' ? null : event.target.value })
          }}
        />
        <datalist id="erd-common-types">
          {COMMON_TYPES.map((type) => (
            <option key={type} value={type} />
          ))}
        </datalist>
      </Field>

      <fieldset className="erd-toggles">
        <legend>Constraints</legend>
        <Toggle
          label="Primary key"
          checked={attribute.isPrimaryKey}
          onChange={(checked) => {
            // A primary key that is nullable is a contradiction the schema tolerates and
            // the validator flags. Rather than let the UI create one, marking a field as
            // the key also makes it required and unique — the same inference
            // createAttribute() makes, so both paths agree.
            props.onPatch(
              checked
                ? { isPrimaryKey: true, isNullable: false, isUnique: true }
                : { isPrimaryKey: false },
            )
          }}
          hint="Underlined on the diagram. Several fields can share the key."
        />
        <Toggle
          label="Unique"
          checked={attribute.isUnique}
          disabled={attribute.isPrimaryKey}
          onChange={(checked) => {
            props.onPatch({ isUnique: checked })
          }}
        />
        <Toggle
          label="Required"
          checked={!attribute.isNullable}
          disabled={attribute.isPrimaryKey}
          onChange={(checked) => {
            props.onPatch({ isNullable: !checked })
          }}
          hint="Nullable fields show a ? after the type."
        />
        <Toggle
          label="Multivalued"
          checked={attribute.isMultivalued}
          onChange={(checked) => {
            props.onPatch({ isMultivalued: checked })
          }}
          hint="Double oval in Chen notation."
        />
        <Toggle
          label="Derived"
          checked={attribute.isDerived}
          onChange={(checked) => {
            props.onPatch({ isDerived: checked })
          }}
          hint="Computed, not stored. Dashed underline."
        />
      </fieldset>

      <Field label="References">
        <select
          className="erd-select erd-select--block"
          value={attribute.foreignKey?.entityId ?? ''}
          onChange={(event) => {
            const entityId = event.target.value
            if (entityId === '') {
              props.onSetForeignKey(null)
              return
            }
            const target = props.entities.find((entity) => entity.id === entityId)
            const column = target?.attributes.find(
              (candidate) => candidate.isPrimaryKey || candidate.isUnique,
            )
            if (target !== undefined && column !== undefined) {
              props.onSetForeignKey({ entityId: target.id, attributeId: column.id })
            }
          }}
        >
          <option value="">Nothing</option>
          {targetableEntities.map((entity) => (
            <option key={entity.id} value={entity.id}>
              {entity.name === '' ? 'unnamed' : entity.name}
            </option>
          ))}
        </select>
      </Field>

      {attribute.foreignKey === undefined ? null : (
        <Field label="Key">
          <select
            className="erd-select erd-select--block"
            value={attribute.foreignKey.attributeId}
            onChange={(event) => {
              if (fkEntity === undefined) return
              props.onSetForeignKey({
                entityId: fkEntity.id,
                attributeId: event.target.value as AttributeId,
              })
            }}
          >
            {fkColumns.map((column) => (
              <option key={column.id} value={column.id}>
                {column.name === '' ? 'unnamed' : column.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field label="Field comment">
        <input
          className="erd-input"
          value={attribute.comment ?? ''}
          onChange={(event) => {
            props.onPatch({ comment: event.target.value === '' ? null : event.target.value })
          }}
        />
      </Field>

      <button type="button" className="erd-btn erd-btn--danger" onClick={props.onDelete}>
        Delete field
      </button>
    </div>
  )
}
