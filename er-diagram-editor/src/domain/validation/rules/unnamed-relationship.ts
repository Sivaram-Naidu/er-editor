// WARNING: a relationship with no name (FR-8.3).
//
// Unlike entity and field names, a relationship name is genuinely optional in the model:
// `RelationshipSchema.name` carries `.default('')` precisely so an unnamed relationship
// is legal, and Mermaid's `erDiagram` labels are optional too. Drag-to-connect (FR-1.4)
// therefore produces one on every gesture, by design.
//
// It is a warning rather than an error because the diagram is still readable without it —
// crow's-foot cardinality says most of what the line means — but at 100 tables an
// unlabelled connector is the difference between a schema you can read and one you have
// to reconstruct.

import { indexOf } from '../../graph'
import type { Diagram } from '../../model/types'
import { isBlank, issue, relationshipLabel, type Issue, type Rule } from '../Rule'

export const unnamedRelationship: Rule = {
  id: 'unnamed-relationship',
  title: 'Relationship has no name',
  check(diagram: Diagram): Issue[] {
    // The graph module already keeps this map, cached in a WeakMap against the diagram
    // object itself, so building a second one per rule is duplicated work on every edit.
    const { entityById } = indexOf(diagram)

    return diagram.relationships.flatMap((relationship) => {
      if (!isBlank(relationship.name)) return []

      return [
        issue(
          'unnamed-relationship',
          'warning',
          { kind: 'relationship', relationshipId: relationship.id },
          `${relationshipLabel(relationship, entityById)} has no name, so the line does not say what it means.`,
        ),
      ]
    })
  },
}
