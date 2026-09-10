// The rule set. Adding a rule is a file plus a line here.
//
// Order matters only as a tie-break: `validator.ts` sorts by severity first, then by rule
// id, so this array's order does not reach the panel. It is kept in FR-8.2-then-FR-8.3
// order — errors before warnings before info — so the file reads like the requirement.

import { duplicateNames } from './duplicate-names'
import { emptyName } from './empty-name'
import { foreignKeyTypeMismatch } from './fk-type-mismatch'
import { missingPrimaryKey } from './missing-primary-key'
import { orphanEntity } from './orphan-entity'
import { unnamedRelationship } from './unnamed-relationship'
import { unresolvedManyToMany } from './unresolved-many-to-many'
import { weakEntityIdentity } from './weak-entity-identity'

import type { Rule } from '../Rule'

/**
 * Every rule the validator runs.
 *
 * FR-8.2's "relationship with a missing endpoint" has no rule here on purpose. It is
 * unreachable: `schema.ts` rejects a dangling participant at parse time, `deleteEntity`
 * cascades its relationships, and `deleteAttribute` clears inbound foreign keys. A rule
 * for it would be dead code that no test could exercise honestly.
 */
export const RULES: readonly Rule[] = [
  emptyName,
  duplicateNames,
  weakEntityIdentity,
  missingPrimaryKey,
  orphanEntity,
  foreignKeyTypeMismatch,
  unnamedRelationship,
  unresolvedManyToMany,
]

export { duplicateNames } from './duplicate-names'
export { emptyName } from './empty-name'
export { canonicalType, foreignKeyTypeMismatch } from './fk-type-mismatch'
export { missingPrimaryKey } from './missing-primary-key'
export { orphanEntity } from './orphan-entity'
export { unnamedRelationship } from './unnamed-relationship'
export { unresolvedManyToMany } from './unresolved-many-to-many'
export { weakEntityIdentity } from './weak-entity-identity'
