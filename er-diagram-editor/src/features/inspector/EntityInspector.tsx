// Entity properties, and the list of its fields (FR-1.8, FR-1.9).

import type { Attribute, Entity } from '../../domain'

import { Field, Toggle } from './controls'

export interface EntityInspectorProps {
  entity: Entity
  selectedAttributeId: string | undefined
  onRename: (name: string) => void
  onSetComment: (comment: string | null) => void
  onSetWeak: (weak: boolean) => void
  onAddAttribute: () => void
  onSelectAttribute: (attribute: Attribute) => void
  onDelete: () => void
  relationshipCount: number
}

export function EntityInspector(props: EntityInspectorProps): React.ReactElement {
  const { entity } = props

  return (
    <>
      <div className="erd-inspector__section">
        <h3>Entity</h3>

        <Field label="Name">
          <input
            className="erd-input"
            placeholder="e.g. CUSTOMER"
            value={entity.name}
            onChange={(event) => {
              props.onRename(event.target.value)
            }}
          />
        </Field>

        <Toggle
          label="Weak entity"
          checked={entity.kind === 'weak'}
          onChange={props.onSetWeak}
          hint="No identity of its own; identified through a parent. Drawn with a double border."
        />

        <Field label="Comment">
          <input
            className="erd-input"
            value={entity.comment ?? ''}
            onChange={(event) => {
              props.onSetComment(event.target.value === '' ? null : event.target.value)
            }}
          />
        </Field>
      </div>

      <div className="erd-inspector__section">
        <div className="erd-inspector__sectionhead">
          <h3>Fields</h3>
          <button type="button" className="erd-btn erd-btn--small" onClick={props.onAddAttribute}>
            Add
          </button>
        </div>

        {entity.attributes.length === 0 ? (
          <p className="erd-inspector__empty">
            No fields yet. Add one to give this entity a primary key.
          </p>
        ) : (
          <ul className="erd-fieldlist">
            {entity.attributes.map((attribute) => (
              <li key={attribute.id}>
                <button
                  type="button"
                  className="erd-fieldlist__item"
                  data-selected={props.selectedAttributeId === attribute.id || undefined}
                  onClick={() => {
                    props.onSelectAttribute(attribute)
                  }}
                >
                  <span data-key={attribute.isPrimaryKey || undefined}>
                    {attribute.name === '' ? 'unnamed' : attribute.name}
                  </span>
                  <span className="erd-fieldlist__type">{attribute.dataType ?? ''}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="erd-inspector__section">
        <button type="button" className="erd-btn erd-btn--danger" onClick={props.onDelete}>
          Delete entity
        </button>
        {props.relationshipCount > 0 ? (
          // FR-1.7 wants the cascade stated before it happens, not discovered afterwards.
          <p className="erd-inspector__hint">
            This will also delete {props.relationshipCount}{' '}
            {props.relationshipCount === 1 ? 'relationship' : 'relationships'}.
          </p>
        ) : null}
      </div>
    </>
  )
}
