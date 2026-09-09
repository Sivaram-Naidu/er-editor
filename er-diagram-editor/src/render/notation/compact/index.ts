// V1 default: crow's foot / Information Engineering (FR-5.1, FR-5.2).
//
// The compact set carries every Chen-only construct as a row badge rather than as a
// separate node, which is what buys the ~10x information density SRS §2.1 argues for.
// Nothing is lost — multivalued, derived and composite attributes are all still
// distinguishable, they are just re-encoded.

import type { Attribute, Cardinality, Participation } from '../../../domain'
import type { AttributeBadge, NotationSet } from '../NotationSet'

/**
 * Crow's-foot marker ids, defined once in `Canvas.tsx` and referenced by url(#id).
 *
 * Naming is `<cardinality>-<participation>`: the outer glyph shows cardinality (bar for
 * one, crow's foot for many) and the inner shows participation (bar for mandatory, ring
 * for optional). That is the standard IE reading, so a user who knows the notation needs
 * no legend.
 */
export const CROWSFOOT_MARKERS = {
  'one-total': 'erd-one-total',
  'one-partial': 'erd-one-partial',
  'many-total': 'erd-many-total',
  'many-partial': 'erd-many-partial',
} as const

export type CrowsfootMarkerId = (typeof CROWSFOOT_MARKERS)[keyof typeof CROWSFOOT_MARKERS]

export function markerFor(cardinality: Cardinality, participation: Participation): string {
  return CROWSFOOT_MARKERS[`${cardinality}-${participation}`]
}

/**
 * Badges for one attribute.
 *
 * Order is fixed rather than incidental: key status first because it is what the eye
 * looks for when scanning an entity, then referential, then shape. A stable order means
 * a column of rows produces a readable column of badges.
 */
export function compactBadges(attribute: Attribute): AttributeBadge[] {
  const badges: AttributeBadge[] = []

  if (attribute.isPrimaryKey) badges.push({ glyph: 'PK', label: 'Primary key', tone: 'key' })
  else if (attribute.isUnique) badges.push({ glyph: 'UQ', label: 'Unique', tone: 'key' })

  if (attribute.foreignKey !== undefined) {
    badges.push({ glyph: 'FK', label: 'Foreign key', tone: 'ref' })
  }

  // The three Chen-only constructs. Glyphs are pictographic rather than lettered so they
  // stay distinct from the two-letter key badges above at a glance.
  if (attribute.isMultivalued) {
    badges.push({ glyph: '⊞', label: 'Multivalued', tone: 'shape' })
  }
  if (attribute.isDerived) {
    badges.push({ glyph: '⌁', label: 'Derived', tone: 'shape' })
  }
  if (attribute.children !== undefined) {
    badges.push({ glyph: '∷', label: 'Composite', tone: 'shape' })
  }

  return badges
}

/** "exactly one" / "zero or more" — the words used in the hover tooltip (FR-4.3). */
export function describeEnd(cardinality: Cardinality, participation: Participation): string {
  if (cardinality === 'one') return participation === 'total' ? 'exactly one' : 'at most one'
  return participation === 'total' ? 'one or more' : 'zero or more'
}

export const compactNotation: NotationSet = {
  id: 'compact',
  label: "Crow's foot",
  badges: compactBadges,
  endpointMarker: markerFor,
  describeEnd,
}
