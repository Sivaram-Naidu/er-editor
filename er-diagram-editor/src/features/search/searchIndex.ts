// The searchable view of a diagram, and the query over it (FR-2.6).
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT THIS IS AND IS NOT
// ─────────────────────────────────────────────────────────────────────────────
//
// A flat list of records, one per searchable thing, built once per document version and
// matched against with `lib/fuzzy`. There is no index structure — no trie, no inverted
// index — because there is nothing to index. Counted from `tests/fixtures/referenceSchema.ts`,
// the 120-entity reference schema is 1,230 records (120 entities + 960 attributes + 150
// relationships) and NFR-2.2's 300-entity ceiling is roughly 3,000. NFR-1.7 allows 50 ms
// from the final keystroke; a linear pass over 3,000 short identifiers is nowhere near it.
// `tests/unit/lib/fuzzy.test.ts` holds the guard that keeps the pass linear.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY EVERY RECORD CARRIES AN `IssueTarget`
// ─────────────────────────────────────────────────────────────────────────────
//
// "Select it and bring it into view" is already written, once, for FR-8.1: `useGoToIssue`
// in features/validation-panel/useValidation.ts. It is not issue-specific in anything but
// its name — it switches on an `IssueTarget`, which is exactly this module's three kinds —
// and it carries two pieces of knowledge worth not re-deriving:
//
//   * ORDER. `selectEntities` clears the field selection when the entity changes, so an
//     attribute's `selectAttribute` has to come after it, not before. Written out at
//     useValidation.ts:53-55 because getting it backwards silently shows the inspector a
//     field from the box the user just left.
//   * A relationship is framed by BOTH its ends, not by the line's midpoint, which can sit
//     a long way from anything readable.
//
// So a record carries the target and nothing else about navigation, and the palette hands
// it straight to that hook. Re-implementing either point here is how `connect.test.ts`
// rotted: a copy that starts correct and stops tracking the original.
//
// Records are a discriminated union rather than one shape with optional fields, because
// `exactOptionalPropertyTypes` is on and every optional would need a conditional spread at
// the construction site. The union costs nothing and reads better at the call site too.

import type { Entity, EntityId, IssueTarget, Relationship } from '../../domain'
import { compareMatches, fuzzyMatch, type FuzzyMatch } from '../../lib/fuzzy'

export interface EntityRecord {
  kind: 'entity'
  /** The text matched against, and the primary line in the result row. */
  name: string
  target: IssueTarget
}

export interface AttributeRecord {
  kind: 'attribute'
  name: string
  /** FR-2.6: "Results show which entity an attribute belongs to." */
  entityName: string
  target: IssueTarget
}

export interface RelationshipRecord {
  kind: 'relationship'
  name: string
  /** "CUSTOMER → ORDER", for the secondary line. */
  between: string
  target: IssueTarget
}

export type SearchRecord = EntityRecord | AttributeRecord | RelationshipRecord

export interface SearchHit {
  record: SearchRecord
  match: FuzzyMatch
}

/**
 * Every searchable name in the diagram.
 *
 * UNNAMED THINGS ARE ABSENT, and that falls out rather than being special-cased: an
 * unnamed relationship is legal (`name: z.string().default('')` in schema.ts, surfaced as
 * a warning by FR-8.3, not rejected), and `fuzzyMatch` returns `undefined` for an empty
 * candidate. A record for one would therefore never match anything, so building it would
 * only cost memory. The same goes for an entity or attribute left blank mid-edit.
 *
 * IT TAKES THE TWO ARRAYS, NOT THE DIAGRAM, AND THAT IS THE POINT.
 *
 * Every command stamps `draft.updatedAt`, so `diagram` is a new object after any edit —
 * including every frame of a drag. Its `entities` array is NOT: Immer's structural sharing
 * hands back the same one when only positions changed. Taking the arrays makes
 * `useMemo(..., [diagram.entities, diagram.relationships])` exactly what
 * `react-hooks/exhaustive-deps` wants, so the memo key is enforced by the signature rather
 * than by a comment and an eslint-disable.
 *
 * BOTH arrays are needed, which is less obvious: a rename replaces `entities` but leaves
 * `relationships` untouched, and a relationship record's `between` is built out of entity
 * NAMES. Keyed on `relationships` alone it would still read "CUSTOMER → ORDER" after
 * CUSTOMER was renamed.
 */
export function buildSearchRecords(
  entities: readonly Entity[],
  relationships: readonly Relationship[],
): SearchRecord[] {
  const records: SearchRecord[] = []
  const nameById = new Map<EntityId, string>()

  for (const entity of entities) nameById.set(entity.id, entity.name)

  for (const entity of entities) {
    collectEntity(entity, records)
  }
  for (const relationship of relationships) {
    collectRelationship(relationship, nameById, records)
  }

  return records
}

function collectEntity(entity: Entity, into: SearchRecord[]): void {
  if (entity.name !== '') {
    into.push({
      kind: 'entity',
      name: entity.name,
      target: { kind: 'entity', entityId: entity.id },
    })
  }

  for (const attribute of entity.attributes) {
    if (attribute.name === '') continue
    into.push({
      kind: 'attribute',
      name: attribute.name,
      entityName: entity.name,
      target: { kind: 'attribute', entityId: entity.id, attributeId: attribute.id },
    })
  }
}

function collectRelationship(
  relationship: Relationship,
  nameById: ReadonlyMap<EntityId, string>,
  into: SearchRecord[],
): void {
  if (relationship.name === '') return

  // A participant whose entity has been deleted is dropped rather than rendered as a gap:
  // `between` would otherwise read "→ ORDER". The camera does not need it either — the
  // hook that performs the jump resolves the endpoints itself.
  const ends = relationship.participants.flatMap((participant) => {
    const name = nameById.get(participant.entityId)
    return name === undefined ? [] : [name]
  })

  into.push({
    kind: 'relationship',
    name: relationship.name,
    between: ends.join(' → '),
    target: { kind: 'relationship', relationshipId: relationship.id },
  })
}

/**
 * The best `limit` matches for `query`, best first.
 *
 * Sorted by `lib/fuzzy`'s ranking alone, with ONE addition: an entity outranks an
 * attribute or relationship that matched equally well. Typing `order` in a schema that has
 * an `ORDER` table and an `order_id` column on six others should put the table first —
 * they are all exact-or-prefix matches of the same length class, and the table is what the
 * user is navigating to.
 */
export function searchRecords(
  records: readonly SearchRecord[],
  query: string,
  limit = 20,
): SearchHit[] {
  const hits: SearchHit[] = []

  for (const record of records) {
    const match = fuzzyMatch(query, record.name)
    if (match !== undefined) hits.push({ record, match })
  }

  hits.sort((a, b) => {
    const byMatch = compareMatches(a.match, b.match)
    if (byMatch !== 0) return byMatch
    return kindWeight(a.record) - kindWeight(b.record)
  })

  return hits.slice(0, limit)
}

function kindWeight(record: SearchRecord): number {
  return record.kind === 'entity' ? 0 : record.kind === 'relationship' ? 1 : 2
}
