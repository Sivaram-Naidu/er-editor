// Stable ID generation. Attributes carry IDs, not just names (SRS §3).
//
// Renaming an attribute must never break a foreign key reference, so every element is
// keyed by an opaque ID that is generated once and never derived from user-visible text.
//
// This module is deliberately untyped with respect to the domain: `lib` is a leaf layer
// and may not import `domain` (SRS §8.1). Branding happens at the domain boundary, in
// `src/domain/model/factory.ts`.

/** Short, human-recognisable prefixes so raw IDs are readable in exported JSON and logs. */
export const ID_PREFIX = {
  diagram: 'dgm',
  entity: 'ent',
  attribute: 'att',
  relationship: 'rel',
  group: 'grp',
} as const

export type IdPrefix = (typeof ID_PREFIX)[keyof typeof ID_PREFIX]

/**
 * Generate a fresh, collision-resistant ID.
 *
 * Uses `crypto.randomUUID` where available (all NFR-5.1 target browsers, and Node 19+).
 * The fallback exists only for exotic non-secure contexts; it is not cryptographically
 * strong, which is fine because these IDs are never used as secrets or capabilities.
 */
export function newId(prefix: IdPrefix): string {
  // `crypto` is typed as always present, but is genuinely absent in non-secure contexts
  // and in some embedded webviews, so the guard is a runtime check rather than a type
  // one — hence reading it off `globalThis` as a loose value first.
  const webCrypto = (globalThis as { crypto?: Crypto }).crypto
  const unique =
    typeof webCrypto?.randomUUID === 'function'
      ? webCrypto.randomUUID()
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`

  return `${prefix}_${unique}`
}
