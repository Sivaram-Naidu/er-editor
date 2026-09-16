// Level-of-detail vocabulary shared by viewport state and the renderer.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS IS IN `lib` AND NOT IN `render`
// ─────────────────────────────────────────────────────────────────────────────
//
// SRS §8 lists this as `src/render/lod.ts`. That placement conflicts with the §8.1
// dependency rule, and the conflict is real rather than pedantic: LOD level is part of
// the viewport's state (it is what the camera is showing), so `store/viewportStore.ts`
// needs the type and the threshold function — but `store` may not import `render`.
//
// The resolution splits it by nature rather than by feature:
//
//   lib/lod.ts     the vocabulary — the level type, the zoom thresholds, the pure
//                  mapping between them, and the rule that resolves a pin and an override
//                  into the level one box draws at. No React, no DOM, importable from
//                  anywhere.
//   render/lod.ts  the renderer's use of that vocabulary — it re-exports the above and
//                  adds whatever binds it to a component tree.
//
// `effectiveLod` lived in `render/lod.ts` until 16 Sep 2026, when FR-2.7's pins were
// finally wired to a control. `layout/measure.ts` has to size a PINNED box at full detail
// or ELK spaces it as if it were showing three rows and the boxes overlap — and `layout`
// may not import `render`. Re-deriving the rule there would have been the second place
// that decides what level a box draws at, which is how the two drift.
//
// The alternative, relaxing the boundary so `store` may import `render`, would have
// bought one import at the cost of the rule that keeps the layers honest.

/** L0 overview, L1 keys only, L2 full attributes. */
export type LodLevel = 0 | 1 | 2

/** SRS §2.2: below 40% overview, 40–90% keys, above 90% full. */
export const LOD_THRESHOLDS = { l0ToL1: 0.4, l1ToL2: 0.9 } as const

/**
 * Deadband applied when moving DOWN in detail.
 *
 * Without it, a zoom sitting on a boundary flickers between two levels on every wheel
 * tick — the risk ADR-0004 calls out. Detail is gained at the nominal threshold and lost
 * slightly below it, so the level is sticky in the direction the user is likely to
 * reverse.
 */
export const LOD_HYSTERESIS = 0.05

/**
 * Map a zoom factor to a detail level.
 *
 * Pass the previous level to engage hysteresis; omit it for a cold read.
 */
export function lodForZoom(zoom: number, previous?: LodLevel): LodLevel {
  const gainAt1 = LOD_THRESHOLDS.l0ToL1
  const gainAt2 = LOD_THRESHOLDS.l1ToL2
  const loseAt1 = gainAt1 - LOD_HYSTERESIS
  const loseAt2 = gainAt2 - LOD_HYSTERESIS

  if (previous === undefined) {
    if (zoom >= gainAt2) return 2
    if (zoom >= gainAt1) return 1
    return 0
  }

  // Asymmetric by design: gaining detail uses the nominal threshold, losing it uses the
  // threshold minus the deadband.
  if (previous === 2) {
    if (zoom >= loseAt2) return 2
    return zoom >= loseAt1 ? 1 : 0
  }
  if (previous === 1) {
    if (zoom >= gainAt2) return 2
    return zoom >= loseAt1 ? 1 : 0
  }
  if (zoom >= gainAt2) return 2
  return zoom >= gainAt1 ? 1 : 0
}

/**
 * The level an individual entity draws at, given the view's level (FR-2.4, FR-2.7).
 *
 * A pinned entity is full detail whatever the zoom and whatever the toolbar says — that
 * IS the pin. Otherwise a global override wins over the zoom-derived level.
 *
 * Both callers matter and neither may be skipped: the renderer uses it to decide what to
 * draw, and `layout/measure.ts` uses it to decide how big to tell ELK the box is. A box
 * measured at one level and drawn at another is the overlap failure in CLAUDE.md.
 */
export function effectiveLod(base: LodLevel, isPinned: boolean, override?: LodLevel): LodLevel {
  if (isPinned) return 2
  return override ?? base
}

/** Convenience for callers holding only a zoom value. */
export function entityLod(
  zoom: number,
  isPinned: boolean,
  override?: LodLevel,
  previous?: LodLevel,
): LodLevel {
  return effectiveLod(lodForZoom(zoom, previous), isPinned, override)
}
