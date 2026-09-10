// The rule vocabulary: what a rule is, what it reports, and how an issue names its subject.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY SEVERITY LIVES ON THE ISSUE AND NOT ON THE RULE
// ─────────────────────────────────────────────────────────────────────────────
//
// `duplicate-names` reports two different things (a clashing entity name and a clashing
// field name within one entity) and `empty-name` reports two more. It would be possible
// to give the RULE a severity and let issues inherit it, but then a rule that ever needed
// two severities would have the fact recorded in two places, and the two would drift.
// Severity is a property of the FINDING, so it lives on the finding. Rules are free to
// emit whatever mix they need; nothing has to agree with anything else.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY ISSUE IDS ARE DERIVED RATHER THAN GENERATED
// ─────────────────────────────────────────────────────────────────────────────
//
// Validation re-runs on every edit, producing a fresh array each time. If ids were
// minted with `newId()`, React would see an entirely new list on every keystroke and
// discard the DOM for rows that had not changed — and any per-issue UI state (focus, a
// "reveal" in flight) would be lost with it. `${ruleId}:${targetKey(target)}` is stable
// for as long as the finding is: the same problem on the same element keeps the same id
// across revalidations, and a fixed problem's id simply stops appearing.
//
// This holds because no rule reports two findings about the same element. If one ever
// needs to, it must extend the key rather than let two issues collide.

import type {
  Attribute,
  AttributeId,
  Diagram,
  Entity,
  EntityId,
  Relationship,
  RelationshipId,
} from '../model/types'

// ─────────────────────────────────────────────────────────────────────────────
// Severity
// ─────────────────────────────────────────────────────────────────────────────

/**
 * FR-8.1's three tiers.
 *
 * `error`   — the model says something contradictory or incomplete enough that an
 *             exporter or a reader would be misled. Duplicate names, a blank name, a
 *             weak entity with nothing to identify it.
 * `warning` — the model is coherent but probably not what was meant. No primary key,
 *             an orphan table, a foreign key whose type disagrees with its target.
 * `info`    — an observation, not a defect. Nothing here needs fixing for the diagram
 *             to be correct.
 */
export type Severity = 'error' | 'warning' | 'info'

/**
 * Lower is worse. Used for sorting the panel and for reducing several issues on one
 * element down to the single worst, which is what the canvas marker shows (FR-8.4).
 */
export const SEVERITY_RANK: Readonly<Record<Severity, number>> = {
  error: 0,
  warning: 1,
  info: 2,
}

/** Worst of two severities. */
export function worstSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[a] <= SEVERITY_RANK[b] ? a : b
}

// ─────────────────────────────────────────────────────────────────────────────
// What an issue points at
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The element an issue is about, in a form the panel can hand straight to the selection
 * store (FR-8.1: "clicking an issue selects and reveals the offending element").
 *
 * An attribute target carries its owning `entityId` as well, because selecting a field
 * means selecting its entity and then the field within it — the panel would otherwise
 * have to search the diagram to find out where the field lives.
 *
 * There is deliberately no target for a composite child attribute. `graph/indexes.ts`
 * indexes top-level attributes only, and the inspector can only select a top-level
 * field, so an issue on a nested child would be un-revealable — a row the user can see
 * but not act on. The rules validate top-level fields and say so where it matters.
 */
export type IssueTarget =
  | { kind: 'entity'; entityId: EntityId }
  | { kind: 'attribute'; entityId: EntityId; attributeId: AttributeId }
  | { kind: 'relationship'; relationshipId: RelationshipId }

/** Stable, collision-free key for a target. See the note on issue ids above. */
export function targetKey(target: IssueTarget): string {
  switch (target.kind) {
    case 'entity':
      return `entity:${target.entityId}`
    case 'attribute':
      return `attribute:${target.entityId}/${target.attributeId}`
    case 'relationship':
      return `relationship:${target.relationshipId}`
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Issues and rules
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every rule in the set. A literal union rather than `string` so the registry in
 * `rules/index.ts` cannot fall out of step with the files, and so a typo in a rule id
 * fails to compile instead of producing an issue nothing can group.
 */
export type RuleId =
  | 'empty-name'
  | 'duplicate-names'
  | 'weak-entity-identity'
  | 'missing-primary-key'
  | 'orphan-entity'
  | 'fk-type-mismatch'
  | 'unnamed-relationship'
  | 'unresolved-many-to-many'

export interface Issue {
  /** `${ruleId}:${targetKey}` — stable across revalidation. */
  id: string
  ruleId: RuleId
  severity: Severity
  /** One sentence, naming the element and what is wrong with it. */
  message: string
  target: IssueTarget
}

export interface Rule {
  id: RuleId
  /** Group heading in the panel. Names the problem, not the fix. */
  title: string
  /** Pure: same diagram in, same issues out. No caching here — see validator.ts. */
  check: (diagram: Diagram) => Issue[]
}

/** Build an issue with its derived id. The only sanctioned way to make one. */
export function issue(
  ruleId: RuleId,
  severity: Severity,
  target: IssueTarget,
  message: string,
): Issue {
  return { id: `${ruleId}:${targetKey(target)}`, ruleId, severity, message, target }
}

// ─────────────────────────────────────────────────────────────────────────────
// Naming things in messages
// ─────────────────────────────────────────────────────────────────────────────
//
// Messages have to name elements that may have no name — that is the point of half these
// rules. The canvas already writes "unnamed" in that case, so these match it rather than
// inventing a second vocabulary for the same absence.

/**
 * A name that is present but says nothing.
 *
 * Trimmed rather than compared to `''` because a name of spaces is an absent name as far
 * as the reader is concerned, and the canvas renders it as an empty box either way.
 * Shared so `empty-name` and `duplicate-names` agree on what "unnamed" means — otherwise
 * two blank names could be reported both as missing AND as a clash, which is two errors
 * describing one problem.
 */
export function isBlank(name: string): boolean {
  return name.trim() === ''
}

/** `CUSTOMER`, or `unnamed entity` when it has no name yet. */
export function entityLabel(entity: Entity): string {
  return isBlank(entity.name) ? 'unnamed entity' : entity.name
}

/** `CUSTOMER.email`, degrading to `unnamed entity`/`unnamed field` as needed. */
export function attributeLabel(entity: Entity, attribute: Attribute): string {
  const field = isBlank(attribute.name) ? 'unnamed field' : attribute.name
  return `${entityLabel(entity)}.${field}`
}

/** A relationship's name, or a description of its ends when it has none. */
export function relationshipLabel(
  relationship: Relationship,
  entityById: ReadonlyMap<EntityId, Entity>,
): string {
  if (!isBlank(relationship.name)) return relationship.name

  const ends = relationship.participants.map((participant) => {
    const entity = entityById.get(participant.entityId)
    return entity === undefined ? 'unknown' : entityLabel(entity)
  })

  return `the relationship between ${ends.join(' and ')}`
}
