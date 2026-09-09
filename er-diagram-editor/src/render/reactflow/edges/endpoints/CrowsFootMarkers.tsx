// Crow's foot / IE endpoint glyph components.
//
// Rendered as SVG <marker> defs once per canvas and referenced by url(#id). Markers are
// used rather than per-edge glyph elements because the browser then handles rotation to
// the path tangent — with 150 relationships, recomputing that in JS on every layout
// change would be pure waste.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY EACH MARKER IS DEFINED TWICE
// ─────────────────────────────────────────────────────────────────────────────
//
// Markers live in their own <svg>, not inside the edge, so no CSS selector can reach
// them from `.erd-edge[data-traced]`. Without a second set the endpoints stay resting
// grey while the line they terminate turns blue — the trace visibly stops short of the
// glyph, which is exactly the join the eye is trying to follow (FR-4.1).
//
// SVG's `context-stroke` keyword would solve this in one definition, but Safari only
// gained it recently and a silently-grey endpoint on older Safari is worse than eight
// small marker defs. So each glyph is emitted twice and the edge picks a set.

import { CROWSFOOT_MARKERS, type CrowsfootMarkerId } from '../../../notation/compact'

import { tracedMarkerId } from './markerId'

interface GlyphProps {
  stroke: string
  fill: string
}

/** Exactly one: a single crossbar. */
function OneTotal({ stroke }: GlyphProps): React.ReactElement {
  return <path d="M6 2 V12" stroke={stroke} strokeWidth="1.5" fill="none" />
}

/** At most one: ring for optional, then the crossbar. */
function OnePartial({ stroke, fill }: GlyphProps): React.ReactElement {
  return (
    <>
      <circle cx="4" cy="7" r="3" stroke={stroke} strokeWidth="1.5" fill={fill} />
      <path d="M11 2 V12" stroke={stroke} strokeWidth="1.5" fill="none" />
    </>
  )
}

/** One or more: crossbar, then the foot. */
function ManyTotal({ stroke }: GlyphProps): React.ReactElement {
  return (
    <>
      <path d="M4 2 V12" stroke={stroke} strokeWidth="1.5" fill="none" />
      <path d="M17 7 L8 2 M17 7 L8 7 M17 7 L8 12" stroke={stroke} strokeWidth="1.5" fill="none" />
    </>
  )
}

/** Zero or more: ring, then the foot. The commonest end in a real schema. */
function ManyPartial({ stroke, fill }: GlyphProps): React.ReactElement {
  return (
    <>
      <circle cx="4" cy="7" r="3" stroke={stroke} strokeWidth="1.5" fill={fill} />
      <path d="M17 7 L8 2 M17 7 L8 7 M17 7 L8 12" stroke={stroke} strokeWidth="1.5" fill="none" />
    </>
  )
}

const GLYPHS: Record<CrowsfootMarkerId, (props: GlyphProps) => React.ReactElement> = {
  [CROWSFOOT_MARKERS['one-total']]: OneTotal,
  [CROWSFOOT_MARKERS['one-partial']]: OnePartial,
  [CROWSFOOT_MARKERS['many-total']]: ManyTotal,
  [CROWSFOOT_MARKERS['many-partial']]: ManyPartial,
}

/** The `one-total` glyph is narrower, so its refX differs. */
const WIDTH: Record<CrowsfootMarkerId, number> = {
  [CROWSFOOT_MARKERS['one-total']]: 14,
  [CROWSFOOT_MARKERS['one-partial']]: 18,
  [CROWSFOOT_MARKERS['many-total']]: 18,
  [CROWSFOOT_MARKERS['many-partial']]: 18,
}

interface MarkerProps {
  id: string
  glyphId: CrowsfootMarkerId
  traced: boolean
}

function Marker({ id, glyphId, traced }: MarkerProps): React.ReactElement {
  const Glyph = GLYPHS[glyphId]
  const width = WIDTH[glyphId]
  const stroke = traced ? 'var(--erd-signal)' : 'var(--erd-rule-strong)'

  return (
    <marker
      id={id}
      viewBox={`0 0 ${String(width)} 14`}
      refX={width - 1}
      refY="7"
      markerWidth={width}
      markerHeight="14"
      /* Constant size in DIAGRAM space, so glyphs scale with zoom like the rest of the
         drawing rather than staying a fixed screen size. */
      markerUnits="userSpaceOnUse"
      orient="auto-start-reverse"
    >
      {/* The ring is filled with the paper colour so the connector does not show
          through it — an unfilled ring reads as a different glyph entirely. */}
      <Glyph stroke={stroke} fill="var(--erd-paper)" />
    </marker>
  )
}

export function CrowsFootMarkers(): React.ReactElement {
  const ids = Object.values(CROWSFOOT_MARKERS)

  return (
    <svg className="erd-markers" aria-hidden="true">
      <defs>
        {ids.map((id) => (
          <Marker key={id} id={id} glyphId={id} traced={false} />
        ))}
        {ids.map((id) => (
          <Marker key={tracedMarkerId(id)} id={tracedMarkerId(id)} glyphId={id} traced />
        ))}
      </defs>
    </svg>
  )
}
