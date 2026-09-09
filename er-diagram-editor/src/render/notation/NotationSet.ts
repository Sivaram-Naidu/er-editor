// Interface: glyphs, endpoint shapes, node shapes (NFR-6.5).
//
// A notation is a way of DRAWING the model, never a change to it. Everything here is a
// pure function of an already-valid `Attribute` or `Participant`, so adding Chen, Barker
// or UML means adding a directory under `src/render/notation/` and touching nothing else.

import type { Attribute, Cardinality, Participation } from '../../domain'

/** One badge on an attribute row. */
export interface AttributeBadge {
  /** Short glyph. Must read at 11px. */
  glyph: string
  /** Announced to screen readers and shown in the legend (NFR-4.4, NFR-4.6). */
  label: string
  tone: 'key' | 'ref' | 'shape'
}

export interface NotationSet {
  readonly id: string
  readonly label: string
  /** Badges for an attribute, in display order. */
  badges(attribute: Attribute): AttributeBadge[]
  /** SVG marker id for one end of a connector. */
  endpointMarker(cardinality: Cardinality, participation: Participation): string
  /** Plain-English reading of one end, for the hover tooltip (FR-4.3). */
  describeEnd(cardinality: Cardinality, participation: Participation): string
}
