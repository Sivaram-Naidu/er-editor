// ERROR: a weak entity with no identifying relationship (FR-8.2).
//
// A weak entity has no key of its own; it borrows identity from an owner through an
// identifying relationship (SRS §1.4). Without one it cannot be identified at all, which
// makes it the one modelling error in this set that has no reasonable reading.
//
// FR-1.9 already blocks marking an entity weak when there is no candidate relationship,
// so this cannot be reached by that route. It is still live through three others: a `.sql`
// or `.mmd` import, deleting the identifying relationship afterwards, and clearing the
// relationship's own "identifying" flag. A UI guard on one entry point is not the same
// thing as an invariant.

import { incidentRelationships } from '../../graph/adjacency'
import type { Diagram } from '../../model/types'
import { entityLabel, issue, type Issue, type Rule } from '../Rule'

export const weakEntityIdentity: Rule = {
  id: 'weak-entity-identity',
  title: 'Weak entity has no identifying relationship',
  check(diagram: Diagram): Issue[] {
    return diagram.entities.flatMap((entity) => {
      if (entity.kind !== 'weak') return []

      const identifying = incidentRelationships(diagram, entity.id).some(
        (relationship) => relationship.isIdentifying,
      )
      if (identifying) return []

      return [
        issue(
          'weak-entity-identity',
          'error',
          { kind: 'entity', entityId: entity.id },
          `${entityLabel(entity)} is a weak entity, so it needs an identifying relationship to an owner. It has none.`,
        ),
      ]
    })
  },
}
