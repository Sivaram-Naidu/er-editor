// Zoom, pan, LOD override, pinned entities.
//
// Viewport is separated from both the model and the selection for the same reason
// selection is separated from the model: panning fires continuously, and nothing that
// renders an entity's CONTENT should re-run because the canvas scrolled.
//
// Note this store holds the LIVE viewport. The persisted `layout.viewport` on the
// diagram is written on save, not on every frame — routing pan through the command
// stack would fill the undo history with camera movement.

import { create, type StoreApi, type UseBoundStore } from 'zustand'

import type { EntityId, Point } from '../domain'
import { lodForZoom, type LodLevel } from '../lib/lod'

/** FR-2.1: 10% to 300%. */
export const ZOOM_MIN = 0.1
export const ZOOM_MAX = 3

/**
 * A request for the camera to go and show something (FR-8.1, and FR-2.6 next).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A REQUEST OBJECT AND NOT A FUNCTION CALL
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * "Clicking an issue selects and REVEALS the offending element" needs `fitView`, which
 * only exists inside React Flow's provider — and `Canvas` creates that provider itself,
 * so nothing outside can reach it. The dependency rule also forbids `render` from
 * importing `store`, so the canvas cannot subscribe here either.
 *
 * So the intent travels as data: the store records what should be shown, `Canvas` takes
 * it as a prop, and a small controller inside the provider performs it. The renderer
 * stays swappable (NFR-2.5) — a different renderer honours the same request in whatever
 * way it can.
 *
 * `nonce` is what makes it a request rather than a state. Revealing the same entity
 * twice in a row is a real thing a user does (click the issue, pan away, click it
 * again), and without a changing field the second click would be indistinguishable from
 * the first and would do nothing.
 */
export interface RevealRequest {
  entityIds: readonly EntityId[]
  nonce: number
}

export interface ViewportState {
  x: number
  y: number
  zoom: number
  /**
   * Measured size of the canvas pane in CSS pixels, reported by the renderer.
   *
   * Zero until the canvas has been measured — during the first render, and permanently
   * under jsdom, which has no layout. Anything reading this must handle zero rather than
   * dividing by it; `viewportCenter` is the one place that needs to, and does.
   *
   * Kept here rather than derived on demand because the pane size and the pan/zoom
   * transform are the two halves of the same coordinate conversion, and separating them
   * would mean a second place that has to know how React Flow's transform works.
   */
  paneWidth: number
  paneHeight: number
  /** Derived from zoom, with hysteresis. Stored so the deadband has memory. */
  lod: LodLevel
  /** Toolbar override that forces a level regardless of zoom (FR-2.4). */
  lodOverride: LodLevel | undefined
  /** Hop radius for isolate mode; undefined means off (FR-2.8). */
  isolateDepth: number | undefined
  /** Outstanding camera request; undefined until something asks. See RevealRequest. */
  revealRequest: RevealRequest | undefined

  setViewport: (viewport: { x: number; y: number; zoom: number }) => void
  setPaneSize: (size: { width: number; height: number }) => void
  setZoom: (zoom: number) => void
  setLodOverride: (level: LodLevel | undefined) => void
  setIsolateDepth: (depth: number | undefined) => void
  /** Ask the canvas to bring these entities into view. No-op for an empty list. */
  revealEntities: (ids: readonly EntityId[]) => void
}

const clampZoom = (zoom: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom))

/**
 * Where the middle of the visible canvas is, in diagram coordinates.
 *
 * React Flow maps a diagram point to the screen as `point * zoom + [x, y]`, so the
 * inverse of the pane's own centre is `(paneCentre - [x, y]) / zoom`.
 *
 * `undefined`, not a guess, when the pane has not been measured. A caller placing
 * something "in view" with no idea where the view is should fall back to its own default
 * rather than put the thing at a coordinate derived from a zero-sized pane — which is
 * `-x/zoom`, i.e. the top-left corner of the visible area, and looks deliberate enough to
 * be mistaken for correct.
 */
export function viewportCenter(state: {
  x: number
  y: number
  zoom: number
  paneWidth: number
  paneHeight: number
}): Point | undefined {
  if (state.paneWidth === 0 || state.paneHeight === 0) return undefined

  return {
    x: (state.paneWidth / 2 - state.x) / state.zoom,
    y: (state.paneHeight / 2 - state.y) / state.zoom,
  }
}

export type ViewportStore = UseBoundStore<StoreApi<ViewportState>>

export function createViewportStore(): ViewportStore {
  return create<ViewportState>()((set, get) => ({
    x: 0,
    y: 0,
    zoom: 1,
    paneWidth: 0,
    paneHeight: 0,
    lod: lodForZoom(1),
    lodOverride: undefined,
    isolateDepth: undefined,
    revealRequest: undefined,

    setViewport: ({ x, y, zoom }) => {
      const clamped = clampZoom(zoom)
      const state = get()
      if (state.x === x && state.y === y && state.zoom === clamped) return

      set({ x, y, zoom: clamped, lod: lodForZoom(clamped, state.lod) })
    },

    setPaneSize: ({ width, height }) => {
      // Guarded for the same reason `setViewport` is. The renderer reports the size it
      // measured, not a size that changed; a window resize settles through several
      // identical values, and an unconditional `set` would notify every subscriber for
      // each one.
      const state = get()
      if (state.paneWidth === width && state.paneHeight === height) return

      set({ paneWidth: width, paneHeight: height })
    },

    setZoom: (zoom) => {
      const clamped = clampZoom(zoom)
      const state = get()
      if (state.zoom === clamped) return

      set({ zoom: clamped, lod: lodForZoom(clamped, state.lod) })
    },

    setLodOverride: (level) => {
      set({ lodOverride: level })
    },

    setIsolateDepth: (depth) => {
      set({ isolateDepth: depth })
    },

    revealEntities: (ids) => {
      // Nothing to frame. Writing the request anyway would make the canvas call
      // `fitView` with an empty node list, which frames the whole diagram — the
      // opposite of what "reveal this" means.
      if (ids.length === 0) return

      const previous = get().revealRequest
      set({
        revealRequest: {
          entityIds: [...ids],
          nonce: (previous?.nonce ?? 0) + 1,
        },
      })
    },
  }))
}

export const useViewportStore = createViewportStore()
