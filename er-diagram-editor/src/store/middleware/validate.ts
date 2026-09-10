// Incremental revalidation (FR-8.5) — deliberately empty. The reasoning, so nobody has
// to rediscover it:
//
// The SRS reserved a middleware slot here on the assumption that validation would need
// to be pushed off the edit path — subscribe to the diagram store, recompute in the
// background, publish into a separate store the panel reads.
//
// It does not need to be. `domain/validation/validator.ts` caches its report in a
// WeakMap keyed by the `Diagram` object, and every mutation produces a new frozen
// diagram, so a report can never go stale and only the first caller in a given edit does
// any work. A full pass over the SRS §5.1 reference schema (120 entities, 960 fields, 150
// relationships) measures well inside a single frame — there is a budget test for it in
// `tests/unit/domain/validation.test.ts`. So the panel, the toolbar badge and the canvas
// markers all just call `validateDiagram` during render.
//
// Adding a middleware anyway would mean a second copy of the report, a window in which it
// disagrees with the diagram, and a subscription to unwind — all to defer work that is
// cheaper than the deferral.
//
// The slot is worth keeping for the case that changes the calculation: a rule that is
// genuinely expensive, such as the normalization analysis of FR-8.6 (V2). That belongs in
// a deferred second tier reported alongside the cheap rules, which is what this file
// would become. Until then there is nothing for it to do.

export {}
