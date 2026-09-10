// Runs the rule set and caches the result per diagram (FR-8.5).
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT "INCREMENTALLY, WITHOUT BLOCKING INPUT" MEANS HERE
// ─────────────────────────────────────────────────────────────────────────────
//
// FR-8.5 asks for validation that "runs incrementally on change without blocking input".
// Read literally that suggests diffing the model and revalidating only the elements that
// moved. It is not built that way, and the reason is worth recording rather than
// discovering later.
//
// The whole rule set is O(entities + attributes + relationships) with small constants —
// eight passes over a few thousand objects. Against the 300-entity stress fixture it is
// well inside a frame, so a full revalidation is already cheaper than the bookkeeping
// that per-element invalidation would need, and it cannot go stale. Diffing would buy
// nothing and would add a second source of truth about what the diagram contains.
//
// What DOES matter is not repeating the work. The result is cached in a WeakMap keyed by
// the `Diagram` object itself — the same trick `graph/indexes.ts` uses, and sound for the
// same reason: every mutation goes through the command stack and produces a NEW frozen
// diagram, so a cached report is reachable only from the exact object it was computed
// from. There is nothing to invalidate and no code path that can observe a report
// disagreeing with its diagram.
//
// The consequence is that `validateDiagram` is safe to call during render, from as many
// components as want it. The panel, the toolbar badge and the canvas markers all read the
// same report and only the first call in a given edit pays for it.
//
// If a rule is ever added that is genuinely expensive — a normalization analysis of the
// FR-8.6 kind — the place to handle it is a deferred second tier, not a diff.

import type { Diagram, EntityId, RelationshipId } from '../model/types'

import { RULES } from './rules'
import { SEVERITY_RANK, worstSeverity, type Issue, type Rule, type Severity } from './Rule'

export interface ValidationReport {
  /** Sorted: errors first, then by rule, then by message. Stable across revalidation. */
  issues: readonly Issue[]
  counts: Readonly<Record<Severity, number>>
  /**
   * What the panel toggle shows (FR-8.4).
   *
   * Errors and warnings only. `info` is an observation about a correct model, so folding
   * it into a badge would put a permanent number on the toggle of a healthy diagram and
   * teach the user that the badge means nothing.
   */
  badgeCount: number
  /** Worst severity affecting each entity, including issues on its own fields (FR-8.4). */
  severityByEntity: ReadonlyMap<EntityId, Severity>
  /** Worst severity affecting each relationship (FR-8.4). */
  severityByRelationship: ReadonlyMap<RelationshipId, Severity>
}

const cache = new WeakMap<Diagram, ValidationReport>()

/** Errors first, then grouped by rule so the panel reads as a checklist. */
function compare(a: Issue, b: Issue): number {
  const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
  if (bySeverity !== 0) return bySeverity

  const byRule = a.ruleId.localeCompare(b.ruleId)
  if (byRule !== 0) return byRule

  return a.message.localeCompare(b.message)
}

function accumulate<K>(into: Map<K, Severity>, key: K, severity: Severity): void {
  const existing = into.get(key)
  into.set(key, existing === undefined ? severity : worstSeverity(existing, severity))
}

function build(diagram: Diagram): ValidationReport {
  const issues = RULES.flatMap((rule: Rule) => rule.check(diagram)).sort(compare)

  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 }
  const severityByEntity = new Map<EntityId, Severity>()
  const severityByRelationship = new Map<RelationshipId, Severity>()

  for (const found of issues) {
    counts[found.severity] += 1

    switch (found.target.kind) {
      case 'entity':
        accumulate(severityByEntity, found.target.entityId, found.severity)
        break
      // A problem with a field is a problem with the box the field is in, as far as the
      // canvas is concerned: at L0 and L1 the row may not even be drawn, so the marker
      // has to sit on the entity or it would be invisible exactly when the diagram is
      // too zoomed-out to inspect by hand.
      case 'attribute':
        accumulate(severityByEntity, found.target.entityId, found.severity)
        break
      case 'relationship':
        accumulate(severityByRelationship, found.target.relationshipId, found.severity)
        break
    }
  }

  return {
    issues,
    counts,
    badgeCount: counts.error + counts.warning,
    severityByEntity,
    severityByRelationship,
  }
}

/**
 * Validate a diagram (FR-8.2, FR-8.3). Cheap to call repeatedly — see the cache note.
 *
 * Pure with respect to the diagram: same object in, identical report out, every time.
 */
export function validateDiagram(diagram: Diagram): ValidationReport {
  const cached = cache.get(diagram)
  if (cached !== undefined) return cached

  const built = build(diagram)
  cache.set(diagram, built)
  return built
}
