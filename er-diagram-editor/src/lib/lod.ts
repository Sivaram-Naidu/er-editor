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
//                  mapping between them. No React, no DOM, importable from anywhere.
//   render/lod.ts  the renderer's use of that vocabulary — pin overrides and, later,
//                  the hooks that bind it to a component tree.
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
