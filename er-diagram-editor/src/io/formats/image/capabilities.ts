// Declared CapabilitySet for PNG / SVG export (FR-6.5).
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT A CAPABILITY SET MEANS FOR A PICTURE
// ─────────────────────────────────────────────────────────────────────────────
//
// For every other adapter, "exact" means the construct round-trips: export it, import it,
// get it back. No image round-trips, so read literally, every entry here would be
// `dropped` and the loss report would be a wall of noise that says one thing — "this is a
// picture" — twenty times.
//
// So for this format the question the capability set answers is the one a user actually
// has when they export a PNG to paste into a document: **is it visible in the image?**
// `exact` means the construct is drawn and legible; `approximated` means something stands
// in for it; `dropped` means you cannot see it at all.
//
// The format-level truth — that a picture cannot be read back in — is stated once, in the
// adapter's `note`, where it belongs.
//
// This is measured against the compact notation at full detail (L2), which is what the
// export surface renders regardless of the zoom the user is at. Every entry below is a
// claim about specific markup, so each names it: if that markup changes, this changes.

import type { LossExplanations } from '../../capabilities'
import type { CapabilitySet } from '../../types'

export const imageCapabilities: CapabilitySet = {
  // Drawn as the box and its rows, with the type and a trailing `?` for nullability —
  // see AttributeRow.
  entity: 'exact',
  attribute: 'exact',
  dataType: 'exact',
  nullable: 'exact',

  // Row badges from `compactBadges`: PK, UQ, FK.
  primaryKey: 'exact',
  unique: 'exact',
  foreignKey: 'exact',

  // Badges too — ⊞ and ⌁.
  multivaluedAttribute: 'exact',
  derivedAttribute: 'exact',

  // The "weak" tag in the node header, plus the double border.
  weakEntity: 'exact',

  // Crow's-foot markers carry cardinality and participation; a dashed line marks a
  // non-identifying relationship; a self-join draws as a loop.
  binaryRelationship: 'exact',
  cardinality: 'exact',
  participation: 'exact',
  identifyingRelationship: 'exact',
  recursiveRelationship: 'exact',

  // The one construct an image keeps better than any text format: the picture IS the
  // layout, at the positions the user arranged.
  position: 'exact',

  // The ∷ badge says a field is composite, but the child names are not drawn — so you can
  // see that there is structure without seeing what it is.
  compositeAttribute: 'approximated',

  // Comments live in `title` attributes, which are hover tooltips. A tooltip cannot be
  // rasterised; there is nowhere for the text to go.
  comment: 'dropped',

  // V2 constructs with slots reserved in the IR but no renderer yet (SRS §8.2). Declared
  // so that adding one to the model forces a decision here rather than silently exporting
  // a diagram with a hole in it.
  naryRelationship: 'dropped',
  relationshipAttribute: 'dropped',
  isaHierarchy: 'dropped',
  group: 'dropped',
}

export const imageExplanations: LossExplanations = {
  compositeAttribute:
    'The field is marked composite, but its child fields are not drawn — the canvas does not render them either.',
  comment: 'Comments are hover tooltips on the canvas, and a tooltip cannot be rasterised.',
  naryRelationship: 'Not yet rendered on the canvas, so it cannot appear in an image of it.',
  relationshipAttribute: 'Not yet rendered on the canvas, so it cannot appear in an image of it.',
  isaHierarchy: 'Not yet rendered on the canvas, so it cannot appear in an image of it.',
  group: 'Subject areas are not yet drawn, so they cannot appear in an image of the canvas.',
}
