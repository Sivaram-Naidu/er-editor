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

import { lodForZoom, type LodLevel } from '../lib/lod'

/** FR-2.1: 10% to 300%. */
export const ZOOM_MIN = 0.1
export const ZOOM_MAX = 3

export interface ViewportState {
  x: number
  y: number
  zoom: number
  /** Derived from zoom, with hysteresis. Stored so the deadband has memory. */
  lod: LodLevel
  /** Toolbar override that forces a level regardless of zoom (FR-2.4). */
  lodOverride: LodLevel | undefined
  /** Hop radius for isolate mode; undefined means off (FR-2.8). */
  isolateDepth: number | undefined

  setViewport: (viewport: { x: number; y: number; zoom: number }) => void
  setZoom: (zoom: number) => void
  setLodOverride: (level: LodLevel | undefined) => void
  setIsolateDepth: (depth: number | undefined) => void
}

const clampZoom = (zoom: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom))

export type ViewportStore = UseBoundStore<StoreApi<ViewportState>>

export function createViewportStore(): ViewportStore {
  return create<ViewportState>()((set, get) => ({
    x: 0,
    y: 0,
    zoom: 1,
    lod: lodForZoom(1),
    lodOverride: undefined,
    isolateDepth: undefined,

    setViewport: ({ x, y, zoom }) => {
      const clamped = clampZoom(zoom)
      const state = get()
      if (state.x === x && state.y === y && state.zoom === clamped) return

      set({ x, y, zoom: clamped, lod: lodForZoom(clamped, state.lod) })
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
  }))
}

export const useViewportStore = createViewportStore()
