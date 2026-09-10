// WARNING: an entity taking part in no relationship (FR-8.3).
//
// Suppressed below two entities. In a one-entity diagram every entity is an orphan by
// arithmetic — there is nothing to relate to — so the warning carries no information and
// would fire on the very first thing a new user creates. The check only starts saying
// something once a second entity exists and connecting them becomes a choice.
//
// The traversal itself is `graph/adjacency.orphanEntities`, which already existed for
// this requirement and is tested separately.

import { orphanEntities } from '../../graph/adjacency'
import type { Diagram } from '../../model/types'
import { entityLabel, issue, type Issue, type Rule } from '../Rule'

export const orphanEntity: Rule = {
  id: 'orphan-entity',
  title: 'Not connected to anything',
  check(diagram: Diagram): Issue[] {
    if (diagram.entities.length < 2) return []

    return orphanEntities(diagram).map((entity) =>
      issue(
        'orphan-entity',
        'warning',
        { kind: 'entity', entityId: entity.id },
        `${entityLabel(entity)} has no relationships, so it stands apart from the rest of the schema.`,
      ),
    )
  },
}
