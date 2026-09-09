// Relationships of the selected entity, and a way to add one (FR-1.4).
//
// The third route to a relationship, alongside drag and click-to-connect. It exists for
// two cases neither gesture handles: connecting to a table that is off-screen, and
// working without a pointer at all (NFR-3.2).
//
// It doubles as the answer to "what is this table connected to?", which at 100 tables is
// not obvious from looking at the canvas.

import type { Entity, Relationship, RelationshipId } from '../../domain'

import { Field } from './controls'

export interface EntityRelationshipsProps {
  entity: Entity
  relationships: readonly Relationship[]
  entityById: ReadonlyMap<string, Entity>
  /** Every other entity, as connection candidates. */
  candidates: readonly Entity[]
  onSelectRelationship: (id: RelationshipId) => void
  onConnectTo: (otherId: Entity['id']) => void
}

function otherEndName(
  relationship: Relationship,
  entity: Entity,
  entityById: ReadonlyMap<string, Entity>,
): string {
  const other = relationship.participants.find((participant) => participant.entityId !== entity.id)
  // Undefined means a self-join: both ends are this entity.
  if (other === undefined) return `${entity.name || 'unnamed'} (itself)`
  return entityById.get(other.entityId)?.name || 'unnamed'
}

export function EntityRelationships(props: EntityRelationshipsProps): React.ReactElement {
  const { entity, relationships } = props

  return (
    <div className="erd-inspector__section">
      <h3>Relationships</h3>

      {relationships.length === 0 ? (
        <p className="erd-inspector__empty">Not connected to anything yet.</p>
      ) : (
        <ul className="erd-fieldlist">
          {relationships.map((relationship) => (
            <li key={relationship.id}>
              <button
                type="button"
                className="erd-fieldlist__item"
                onClick={() => {
                  props.onSelectRelationship(relationship.id)
                }}
              >
                <span>{otherEndName(relationship, entity, props.entityById)}</span>
                <span className="erd-fieldlist__type">
                  {relationship.name === '' ? 'unnamed' : relationship.name}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {props.candidates.length === 0 ? null : (
        <Field label="Connect to" hint="Adds a 1 : 0..N relationship you can then adjust.">
          {/* Resets to the placeholder after each use, so it reads as an action rather
              than as a setting that now holds a value. */}
          <select
            className="erd-select erd-select--block"
            value=""
            onChange={(event) => {
              if (event.target.value === '') return
              props.onConnectTo(event.target.value as Entity['id'])
            }}
          >
            <option value="">Choose an entity…</option>
            {props.candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name === '' ? 'unnamed' : candidate.name}
              </option>
            ))}
          </select>
        </Field>
      )}
    </div>
  )
}
