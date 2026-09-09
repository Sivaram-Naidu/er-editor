// The renderer's use of the LOD vocabulary (FR-2.4, FR-2.7).
//
// The vocabulary itself — the level type, the thresholds, the zoom mapping — lives in
// `src/lib/lod.ts` so that `store/viewportStore.ts` can use it without `store` importing
// `render`, which SRS §8.1 forbids. See the note there.

import { lodForZoom, type LodLevel } from '../lib/lod'

export { LOD_HYSTERESIS, LOD_THRESHOLDS, lodForZoom, type LodLevel } from '../lib/lod'

/**
 * The level an individual entity should render at.
 *
 * A pinned entity is always full detail regardless of zoom (FR-2.7); otherwise a global
 * toolbar override wins over the zoom-derived level (FR-2.4).
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
