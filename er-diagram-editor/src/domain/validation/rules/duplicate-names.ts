// ERROR: duplicate entity names; duplicate field names within an entity (FR-8.2).
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THE COMPARISON IS CASE-INSENSITIVE
// ─────────────────────────────────────────────────────────────────────────────
//
// `Order` and `ORDER` are the same table to PostgreSQL (which folds unquoted identifiers
// to lower case) and to MySQL on Windows and macOS (case-insensitive by default). Since
// the SQL importer is the main way a 100-table diagram arrives, a case-sensitive
// comparison here would stay silent on a clash that the source database would reject —
// and staying silent about a real collision is the worse failure. A user who genuinely
// means two case-distinct names loses nothing but has to read one warning.
//
// Blank names are skipped: `empty-name` already reports them, and two unnamed fields are
// one problem (they have no names) rather than two (they have no names AND they clash).

import type { Diagram, Entity } from '../../model/types'
import { entityLabel, isBlank, issue, type Issue, type IssueTarget, type Rule } from '../Rule'

/** Fold to the form two identifiers must differ in to be genuinely distinct. */
function normalise(name: string): string {
  return name.trim().toLocaleLowerCase()
}

/**
 * Group named things by their normalised name and hand back only the groups that clash.
 *
 * Generic over the target so both halves of this rule — entities across the diagram, and
 * fields within one entity — share the grouping rather than duplicating it.
 */
function clashes<T>(
  items: readonly T[],
  nameOf: (item: T) => string,
): { name: string; members: T[] }[] {
  const groups = new Map<string, { name: string; members: T[] }>()

  for (const item of items) {
    const raw = nameOf(item)
    if (isBlank(raw)) continue

    const key = normalise(raw)
    const existing = groups.get(key)
    if (existing === undefined) groups.set(key, { name: raw.trim(), members: [item] })
    else existing.members.push(item)
  }

  return [...groups.values()].filter((group) => group.members.length > 1)
}

function entityIssues(diagram: Diagram): Issue[] {
  return clashes(diagram.entities, (entity) => entity.name).flatMap((group) =>
    group.members.map((entity) =>
      issue(
        'duplicate-names',
        'error',
        { kind: 'entity', entityId: entity.id },
        `${String(group.members.length)} entities are named "${group.name}". Entity names must be unique.`,
      ),
    ),
  )
}

function attributeIssues(entity: Entity): Issue[] {
  return clashes(entity.attributes, (attribute) => attribute.name).flatMap((group) =>
    group.members.map((attribute) => {
      const target: IssueTarget = {
        kind: 'attribute',
        entityId: entity.id,
        attributeId: attribute.id,
      }

      return issue(
        'duplicate-names',
        'error',
        target,
        `${entityLabel(entity)} has ${String(group.members.length)} fields named "${group.name}".`,
      )
    }),
  )
}

export const duplicateNames: Rule = {
  id: 'duplicate-names',
  title: 'Duplicate name',
  check(diagram: Diagram): Issue[] {
    return [...entityIssues(diagram), ...diagram.entities.flatMap(attributeIssues)]
  },
}
