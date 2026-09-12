// Public surface of the validation module (FR-8.x).
//
// Modelling-quality checks live here rather than in `model/schema.ts`, which validates
// STRUCTURE only. The editor must be able to hold a half-finished model — an unnamed
// entity is a legitimate intermediate state — so nothing in this module rejects
// anything. It reports.
//
// Deliberately narrow. The individual rules and the helpers they share (`issue`,
// `entityLabel`, `canonicalType`) are rule-authoring vocabulary, not application
// surface: the app asks for a report and renders it, and never reaches for one rule.
// Tests import those directly from the file that owns them.

export { SEVERITY_RANK, worstSeverity } from './Rule'
export type { Issue, IssueTarget, Rule, RuleId, Severity } from './Rule'

export { RULES } from './rules'
export { validateDiagram, type ValidationReport } from './validator'
