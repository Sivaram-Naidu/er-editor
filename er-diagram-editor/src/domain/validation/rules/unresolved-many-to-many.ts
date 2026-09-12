// INFO: a many-to-many relationship not resolved into an associative entity (FR-8.3).
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS IS INFO AND NOT A WARNING
// ─────────────────────────────────────────────────────────────────────────────
//
// FR-8.3 lists this among the warnings. It is reported at `info` instead, deliberately.
//
// An M:N relationship is not a defect in a CONCEPTUAL model — it is the normal and
// correct way to say "students take courses". It only becomes a problem in a LOGICAL or
// PHYSICAL model, where it has to become a join table before it can exist in SQL. The IR
// does not record which of those three a diagram is (SRS §3), so this rule cannot tell
// the difference and would fire on every correct conceptual M:N.
//
// A warning tier that fires on correct models is a warning tier users learn to ignore,
// which costs more than this check is worth. `info` says the same thing without claiming
// something is wrong — and FR-8.1 defines an info tier that otherwise has no members,
// since normalization hints (FR-8.6) are V2.
//
// If the IR ever gains a conceptual/logical/physical marker, this becomes a warning on
// the logical and physical settings and disappears on the conceptual one.

import { indexOf } from '../../graph'
import type { Diagram } from '../../model/types'
import { issue, relationshipLabel, type Issue, type Rule } from '../Rule'

export const unresolvedManyToMany: Rule = {
  id: 'unresolved-many-to-many',
  title: 'Many-to-many not resolved to a join entity',
  check(diagram: Diagram): Issue[] {
    // Shares the cached index rather than rebuilding it — see the note in
    // unnamed-relationship.ts.
    const { entityById } = indexOf(diagram)

    return diagram.relationships.flatMap((relationship) => {
      if (relationship.kind !== 'binary') return []

      const everyEndIsMany =
        relationship.participants.length === 2 &&
        relationship.participants.every((participant) => participant.cardinality === 'many')
      if (!everyEndIsMany) return []

      return [
        issue(
          'unresolved-many-to-many',
          'info',
          { kind: 'relationship', relationshipId: relationship.id },
          `${relationshipLabel(relationship, entityById)} is many-to-many. A relational schema needs a join entity between the two; a conceptual model does not.`,
        ),
      ]
    })
  },
}
