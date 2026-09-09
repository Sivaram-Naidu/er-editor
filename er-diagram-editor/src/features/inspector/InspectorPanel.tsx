// Right-panel property editors (FR-1.8).
//
// The panel owns types, constraints, foreign keys and cardinality — the properties
// edited occasionally, which benefit from labelled controls. Names and field lists are
// edited constantly and stay on the canvas, where the eyes already are.
//
// Every control writes through a command, so everything here is undoable and coalesced
// exactly like a canvas edit. There is no second write path.

import { useMemo } from 'react'

import {
  addAttribute,
  addRelationship,
  createAttribute,
  createRelationship,
  deleteAttribute,
  deleteEntity,
  deleteRelationship,
  incidentRelationships,
  moveAttribute,
  renameRelationship,
  setEntityKind,
  setIdentifying,
  updateAttribute,
  updateEntity,
  updateParticipant,
  type Cardinality,
  type ForeignKeyRef,
  type Participation,
} from '../../domain'
import { useDiagramStore, useSelectionStore } from '../../store'

import { AttributeEditor } from './AttributeEditor'
import { EntityRelationships } from './EntityRelationships'
import { EntityInspector } from './EntityInspector'
import { RelationshipInspector } from './RelationshipInspector'
import { setForeignKeyWithRelationship } from './setForeignKeyWithRelationship'

function EmptySelection(): React.ReactElement {
  return (
    <div className="erd-inspector__section">
      <p className="erd-inspector__empty">
        Select an entity or a relationship to edit it. Double-click a name on the diagram to rename
        it.
      </p>
    </div>
  )
}

export function InspectorPanel(): React.ReactElement {
  const diagram = useDiagramStore((state) => state.diagram)
  const execute = useDiagramStore((state) => state.execute)
  const transaction = useDiagramStore((state) => state.transaction)

  const selectedEntityIds = useSelectionStore((state) => state.selectedEntityIds)
  const selectedRelationshipIds = useSelectionStore((state) => state.selectedRelationshipIds)
  const selectedAttributeId = useSelectionStore((state) => state.selectedAttributeId)
  const selectAttribute = useSelectionStore((state) => state.selectAttribute)
  const selectRelationships = useSelectionStore((state) => state.selectRelationships)
  const clearSelection = useSelectionStore((state) => state.clearSelection)

  const entityById = useMemo(
    () => new Map(diagram.entities.map((entity) => [entity.id as string, entity])),
    [diagram.entities],
  )

  const entity =
    selectedEntityIds.size === 1 ? entityById.get([...selectedEntityIds][0] ?? '') : undefined

  const relationship =
    selectedRelationshipIds.size === 1
      ? diagram.relationships.find((candidate) => candidate.id === [...selectedRelationshipIds][0])
      : undefined

  const attribute =
    entity === undefined
      ? undefined
      : entity.attributes.find((candidate) => candidate.id === selectedAttributeId)

  const attributeIndex =
    entity === undefined || attribute === undefined
      ? -1
      : entity.attributes.findIndex((candidate) => candidate.id === attribute.id)

  return (
    <aside className="erd-inspector" aria-label="Properties">
      {selectedEntityIds.size > 1 ? (
        <div className="erd-inspector__section">
          <p className="erd-inspector__empty">
            {selectedEntityIds.size} entities selected. Press R to connect two of them, or Delete to
            remove them.
          </p>
        </div>
      ) : null}

      {relationship !== undefined ? (
        <RelationshipInspector
          relationship={relationship}
          entityById={entityById}
          onRename={(name) => {
            execute(renameRelationship(relationship.id, name))
          }}
          onPatchEnd={(
            end: number,
            patch: {
              cardinality?: Cardinality
              participation?: Participation
              role?: string | null
            },
          ) => {
            execute(updateParticipant(relationship.id, end, patch))
          }}
          onSetIdentifying={(identifying) => {
            execute(setIdentifying(relationship.id, identifying))
          }}
          onDelete={() => {
            execute(deleteRelationship(relationship.id))
            clearSelection()
          }}
        />
      ) : null}

      {entity !== undefined ? (
        <>
          <EntityInspector
            entity={entity}
            selectedAttributeId={selectedAttributeId}
            relationshipCount={incidentRelationships(diagram, entity.id).length}
            onRename={(name) => {
              execute(updateEntity(entity.id, { name }))
            }}
            onSetComment={(comment) => {
              execute(updateEntity(entity.id, { comment }))
            }}
            onSetWeak={(weak) => {
              execute(setEntityKind(entity.id, weak ? 'weak' : 'strong'))
            }}
            onAddAttribute={() => {
              const created = createAttribute()
              execute(addAttribute(entity.id, created))
              // Selecting the new field puts the cursor where the user is about to work,
              // rather than leaving them to hunt for the empty row they just made.
              selectAttribute(created.id)
            }}
            onSelectAttribute={(next) => {
              selectAttribute(next.id)
            }}
            onDelete={() => {
              execute(deleteEntity(entity.id))
              clearSelection()
            }}
          />

          <EntityRelationships
            entity={entity}
            relationships={incidentRelationships(diagram, entity.id)}
            entityById={entityById}
            candidates={diagram.entities.filter((candidate) => candidate.id !== entity.id)}
            onSelectRelationship={(id) => {
              selectRelationships([id])
            }}
            onConnectTo={(otherId) => {
              execute(addRelationship(createRelationship({ from: entity.id, to: otherId })))
            }}
          />

          {attribute === undefined ? null : (
            <AttributeEditor
              entity={entity}
              attribute={attribute}
              entities={diagram.entities}
              canMoveUp={attributeIndex > 0}
              canMoveDown={attributeIndex >= 0 && attributeIndex < entity.attributes.length - 1}
              onPatch={(patch) => {
                execute(updateAttribute(entity.id, attribute.id, patch))
              }}
              onSetForeignKey={(target: ForeignKeyRef | null) => {
                // Setting a reference also draws the relationship when none exists — see
                // setForeignKeyWithRelationship.ts for why, and why it is one-way.
                const { commands } = setForeignKeyWithRelationship(
                  diagram,
                  entity.id,
                  attribute.id,
                  target,
                )
                transaction('Set reference', commands)
              }}
              onMove={(direction) => {
                execute(moveAttribute(entity.id, attributeIndex, attributeIndex + direction))
              }}
              onDelete={() => {
                execute(deleteAttribute(entity.id, attribute.id))
                selectAttribute(undefined)
              }}
            />
          )}
        </>
      ) : null}

      {entity === undefined && relationship === undefined && selectedEntityIds.size === 0 ? (
        <EmptySelection />
      ) : null}
    </aside>
  )
}
