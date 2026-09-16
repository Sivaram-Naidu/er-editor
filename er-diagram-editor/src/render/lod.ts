// The renderer's use of the LOD vocabulary (FR-2.4, FR-2.7).
//
// The vocabulary itself — the level type, the thresholds, the zoom mapping, and the pin
// and override rule — lives in `src/lib/lod.ts` so that `store/viewportStore.ts` and
// `layout/measure.ts` can use it without importing `render`, which SRS §8.1 forbids. See
// the note there for why `effectiveLod` moved.
//
// This file is the renderer's door onto it. It is deliberately a re-export rather than an
// empty file: `render/index.ts` has published these names since Stage 1 and the tests
// import them from there.

export {
  LOD_HYSTERESIS,
  LOD_THRESHOLDS,
  effectiveLod,
  entityLod,
  lodForZoom,
  type LodLevel,
} from '../lib/lod'
