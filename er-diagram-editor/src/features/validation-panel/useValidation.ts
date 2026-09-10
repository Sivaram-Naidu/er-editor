// The validation report for the current document, and the "go to this issue" action.
//
// Kept apart from the panel component so the toolbar badge and the canvas markers can
// read the same report without mounting the panel. All three end up calling
// `validateDiagram` on the same `Diagram` object, and the WeakMap cache inside it means
// only the first call in a given edit does any work — see the header of validator.ts.

import { useCallback } from 'react'

import {
  relationshipEndpoints,
  validateDiagram,
  type EntityId,
  type IssueTarget,
  type ValidationReport,
} from '../../domain'
import { useDiagramStore, useSelectionStore, useViewportStore } from '../../store'

/**
 * The current report.
 *
 * No `useMemo`: `validateDiagram` is already memoised on the diagram object itself, and a
 * second cache keyed on the same thing would only add a way for the two to disagree.
 */
export function useValidationReport(): ValidationReport {
  const diagram = useDiagramStore((state) => state.diagram)
  return validateDiagram(diagram)
}

/**
 * Select an issue's element and bring it into view — the second half of FR-8.1.
 *
 * Selection and reveal are separate stores on purpose (selection is model-adjacent,
 * the camera is not), so this is where the two are put back together for the one gesture
 * that needs both.
 */
export function useGoToIssue(): (target: IssueTarget) => void {
  const diagram = useDiagramStore((state) => state.diagram)
  const selectEntities = useSelectionStore((state) => state.selectEntities)
  const selectAttribute = useSelectionStore((state) => state.selectAttribute)
  const selectRelationships = useSelectionStore((state) => state.selectRelationships)
  const revealEntities = useViewportStore((state) => state.revealEntities)

  return useCallback(
    (target: IssueTarget) => {
      switch (target.kind) {
        case 'entity':
          selectEntities([target.entityId])
          revealEntities([target.entityId])
          return

        case 'attribute':
          // Order matters. `selectEntities` clears the field selection when the entity
          // changes — that is what stops the inspector showing a field from the box the
          // user just left — so the field has to be chosen after the entity, not before.
          selectEntities([target.entityId])
          selectAttribute(target.attributeId)
          revealEntities([target.entityId])
          return

        case 'relationship': {
          selectRelationships([target.relationshipId])
          // Framing both ends rather than the line: a connector's midpoint can sit a long
          // way from anything readable, and the two tables are what the issue is about.
          const ends: EntityId[] = relationshipEndpoints(diagram, target.relationshipId).map(
            (entity) => entity.id,
          )
          revealEntities(ends)
          return
        }
      }
    },
    [diagram, selectEntities, selectAttribute, selectRelationships, revealEntities],
  )
}
