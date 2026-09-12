// The app clipboard (FR-7.4).
//
// In memory, not `navigator.clipboard`. V1 is offline and single-user (SRS §1.2), nothing
// copied here needs to leave the tab, and the system clipboard would add a permission
// prompt and an async boundary in exchange for nothing the requirement asks for.
//
// It deliberately OUTLIVES a diagram switch: FR-7.5 gives the user several documents and a
// switcher, so copying tables from one into another is the obvious thing to want. That is
// also what makes `planPaste` check every reference against the destination instead of
// trusting it — a payload can arrive somewhere that has never heard of its foreign keys.

import { create, type StoreApi, type UseBoundStore } from 'zustand'

import type { ClipboardPayload } from '../domain'

export interface ClipboardState {
  payload: ClipboardPayload | undefined
  /**
   * How many times the CURRENT payload has been pasted.
   *
   * Pasting twice without it puts the second copy exactly on top of the first, which looks
   * like nothing happened. Each paste steps one offset further out, and a fresh copy resets
   * the count.
   */
  pasteCount: number

  copy: (payload: ClipboardPayload) => void
  notePasted: () => void
  clear: () => void
}

export type ClipboardStore = UseBoundStore<StoreApi<ClipboardState>>

export function createClipboardStore(): ClipboardStore {
  return create<ClipboardState>()((set) => ({
    payload: undefined,
    pasteCount: 0,

    copy: (payload) => {
      set({ payload, pasteCount: 0 })
    },
    notePasted: () => {
      set((state) => ({ pasteCount: state.pasteCount + 1 }))
    },
    clear: () => {
      set({ payload: undefined, pasteCount: 0 })
    },
  }))
}

export const useClipboardStore = createClipboardStore()
