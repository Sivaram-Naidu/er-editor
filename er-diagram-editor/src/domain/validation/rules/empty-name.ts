// ERROR: an entity or a field with no name (FR-8.2, "empty required name").
//
// This is the rule the whole panel was justified by — `schema.ts` deliberately lets an
// empty name parse, because FR-1.1 drops a new entity straight into inline name-edit and
// the store has to be able to hold what the user is looking at. That makes an unnamed
// element a legitimate INTERMEDIATE state and an illegitimate FINAL one, which is
// precisely the kind of thing a validation panel exists to say.
//
// Composite children (FR-1.10) are not checked. `graph/indexes.ts` indexes top-level
// attributes only and the inspector can only select a top-level field, so an issue on a
// nested child would be un-revealable — see the note on `IssueTarget`.

import type { Diagram } from '../../model/types'
import { entityLabel, isBlank, issue, type Issue, type Rule } from '../Rule'

export const emptyName: Rule = {
  id: 'empty-name',
  title: 'Missing name',
  check(diagram: Diagram): Issue[] {
    const issues: Issue[] = []

    for (const entity of diagram.entities) {
      if (isBlank(entity.name)) {
        issues.push(
          issue(
            'empty-name',
            'error',
            { kind: 'entity', entityId: entity.id },
            'This entity has no name.',
          ),
        )
      }

      for (const attribute of entity.attributes) {
        if (!isBlank(attribute.name)) continue

        issues.push(
          issue(
            'empty-name',
            'error',
            { kind: 'attribute', entityId: entity.id, attributeId: attribute.id },
            `A field on ${entityLabel(entity)} has no name.`,
          ),
        )
      }
    }

    return issues
  },
}
