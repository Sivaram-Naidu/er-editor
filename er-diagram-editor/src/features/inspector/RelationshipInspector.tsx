// Name, cardinality, participation and the identifying flag (FR-1.5, FR-1.9, FR-1.12).

import type { Cardinality, Entity, Participation, Relationship } from '../../domain'
import { describeEnd } from '../../render'

import { Field, Toggle } from './controls'

export interface RelationshipInspectorProps {
  relationship: Relationship
  entityById: ReadonlyMap<string, Entity>
  onRename: (name: string) => void
  onPatchEnd: (
    end: number,
    patch: { cardinality?: Cardinality; participation?: Participation; role?: string | null },
  ) => void
  onSetIdentifying: (identifying: boolean) => void
  onDelete: () => void
}

const CARDINALITY: { value: string; label: string }[] = [
  { value: 'one-total', label: 'exactly one' },
  { value: 'one-partial', label: 'at most one' },
  { value: 'many-total', label: 'one or more' },
  { value: 'many-partial', label: 'zero or more' },
]

export function RelationshipInspector(props: RelationshipInspectorProps): React.ReactElement {
  const { relationship } = props
  const [from, to] = relationship.participants
  const fromName = props.entityById.get(from?.entityId ?? '')?.name ?? 'unnamed'
  const toName = props.entityById.get(to?.entityId ?? '')?.name ?? 'unnamed'

  // Recursive relationships have the same entity at both ends, so "CUSTOMER" twice tells
  // the user nothing. Roles are what distinguish the ends there (FR-1.12), so they are
  // only shown when they matter.
  const isRecursive = from?.entityId === to?.entityId

  return (
    <>
      <div className="erd-inspector__section">
        <h3>Relationship</h3>

        {/* Read as a sentence rather than as two dropdowns, because cardinality is the
            single most misread part of an ER diagram and prose is unambiguous. */}
        <p className="erd-inspector__reading">
          Each <strong>{fromName}</strong>{' '}
          {relationship.name === '' ? 'relates to' : relationship.name}{' '}
          <strong>{describeEnd(to?.cardinality ?? 'many', to?.participation ?? 'partial')}</strong>{' '}
          {toName}
        </p>

        <Field label="Name">
          <input
            className="erd-input"
            placeholder="e.g. places"
            value={relationship.name}
            onChange={(event) => {
              props.onRename(event.target.value)
            }}
          />
        </Field>

        <Toggle
          label="Identifying"
          checked={relationship.isIdentifying}
          onChange={props.onSetIdentifying}
          hint="The child depends on the parent for its identity. Drawn as a solid line."
        />
      </div>

      {[from, to].map((participant, index) =>
        participant === undefined ? null : (
          <div className="erd-inspector__section" key={index}>
            <h3>{index === 0 ? fromName : toName} side</h3>

            <Field label="Cardinality">
              <select
                className="erd-select erd-select--block"
                value={`${participant.cardinality}-${participant.participation}`}
                onChange={(event) => {
                  const [cardinality, participation] = event.target.value.split('-')
                  props.onPatchEnd(index, {
                    cardinality: cardinality as Cardinality,
                    participation: participation as Participation,
                  })
                }}
              >
                {CARDINALITY.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>

            {isRecursive ? (
              <Field label="Role" hint="Distinguishes the two ends, e.g. manager / report.">
                <input
                  className="erd-input"
                  value={participant.role ?? ''}
                  onChange={(event) => {
                    props.onPatchEnd(index, {
                      role: event.target.value === '' ? null : event.target.value,
                    })
                  }}
                />
              </Field>
            ) : null}
          </div>
        ),
      )}

      <div className="erd-inspector__section">
        <button type="button" className="erd-btn erd-btn--danger" onClick={props.onDelete}>
          Delete relationship
        </button>
      </div>
    </>
  )
}
