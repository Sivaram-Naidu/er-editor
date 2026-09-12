// Panels, dialogs, theme.

import { create, type StoreApi, type UseBoundStore } from 'zustand'

import type { Notation } from '../domain'

export type Theme = 'light' | 'dark' | 'system'
/*
 * `'palette'` is the Ctrl+K surface (FR-2.6, FR-9.2), and it lives here rather than on a
 * flag of its own for one specific reason: the Editor's window-level keymap disables
 * itself with `if (activeDialog !== undefined) return`. A palette opened through any other
 * switch would leave that guard unarmed, so `Delete` typed at the search box would delete
 * the selection behind it — which is the exact bug CLAUDE.md records for the export dialog.
 *
 * There WAS another switch: `commandPaletteOpen`, declared here and wired to nothing since
 * the stage that reserved it. It was removed rather than left as a second, broken-looking
 * way to open the same thing.
 */
export type DialogId = 'export' | 'import' | 'palette' | 'shortcuts' | 'confirmDelete' | undefined

export interface UiState {
  theme: Theme
  notation: Notation
  inspectorOpen: boolean
  validationPanelOpen: boolean
  minimapOpen: boolean
  activeDialog: DialogId

  setTheme: (theme: Theme) => void
  setNotation: (notation: Notation) => void
  toggleInspector: () => void
  toggleValidationPanel: () => void
  toggleMinimap: () => void
  openDialog: (dialog: DialogId) => void
  closeDialog: () => void
}

export type UiStore = UseBoundStore<StoreApi<UiState>>

export function createUiStore(): UiStore {
  return create<UiState>()((set) => ({
    theme: 'system',
    notation: 'compact',
    inspectorOpen: true,
    validationPanelOpen: false,
    minimapOpen: true,
    activeDialog: undefined,

    setTheme: (theme) => {
      set({ theme })
    },
    setNotation: (notation) => {
      set({ notation })
    },
    toggleInspector: () => {
      set((state) => ({ inspectorOpen: !state.inspectorOpen }))
    },
    toggleValidationPanel: () => {
      set((state) => ({ validationPanelOpen: !state.validationPanelOpen }))
    },
    toggleMinimap: () => {
      set((state) => ({ minimapOpen: !state.minimapOpen }))
    },
    openDialog: (dialog) => {
      set({ activeDialog: dialog })
    },
    closeDialog: () => {
      set({ activeDialog: undefined })
    },
  }))
}

export const useUiStore = createUiStore()
