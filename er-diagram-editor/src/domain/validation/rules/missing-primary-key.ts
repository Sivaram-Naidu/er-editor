// WARNING: an entity with no primary key (FR-8.3).
//
// ─────────────────────────────────────────────────────────────────────────────
// WEAK ENTITIES ARE INCLUDED, WITH DIFFERENT WORDING
// ─────────────────────────────────────────────────────────────────────────────
//
// Strictly, a weak entity has no primary key of its own — it has a PARTIAL key (a
// discriminator) that is unique only within its owner. So "no primary key" is the wrong
// sentence for a weak entity, and the temptation is to skip them entirely.
//
// Skipping them would be worse. The IR has no `isPartialKey` flag (SRS §3), so a weak
// entity's discriminator is recorded as `isPrimaryKey` like any other key — meaning a
// weak entity with zero key fields has nothing marking its discriminator either, which
// is a real gap the user wants to see. It is reported, with a sentence that says what is
// actually missing.
//
// This rule stays a warning rather than an error because an entity mid-authoring
// legitimately has no key yet, and because a pure conceptual model may never assign one.

import type { Diagram } from '../../model/types'
import { entityLabel, issue, type Issue, type Rule } from '../Rule'

export const missingPrimaryKey: Rule = {
  id: 'missing-primary-key',
  title: 'No primary key',
  check(diagram: Diagram): Issue[] {
    return diagram.entities.flatMap((entity) => {
      if (entity.attributes.some((attribute) => attribute.isPrimaryKey)) return []

      const message =
        entity.kind === 'weak'
          ? `${entityLabel(entity)} is a weak entity but no field is marked as its key, so nothing distinguishes one row from another within its owner.`
          : `${entityLabel(entity)} has no primary key, so its rows cannot be told apart.`

      return [
        issue('missing-primary-key', 'warning', { kind: 'entity', entityId: entity.id }, message),
      ]
    })
  },
}
