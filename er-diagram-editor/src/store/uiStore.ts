// Panels, dialogs, theme.

import { create, type StoreApi, type UseBoundStore } from 'zustand'

import type { Notation } from '../domain'

export type Theme = 'light' | 'dark' | 'system'
export type DialogId = 'export' | 'import' | 'shortcuts' | 'confirmDelete' | undefined

export interface UiState {
  theme: Theme
  notation: Notation
  inspectorOpen: boolean
  validationPanelOpen: boolean
  minimapOpen: boolean
  commandPaletteOpen: boolean
  activeDialog: DialogId

  setTheme: (theme: Theme) => void
  setNotation: (notation: Notation) => void
  toggleInspector: () => void
  toggleValidationPanel: () => void
  toggleMinimap: () => void
  setCommandPaletteOpen: (open: boolean) => void
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
    commandPaletteOpen: false,
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
    setCommandPaletteOpen: (open) => {
      set({ commandPaletteOpen: open })
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
