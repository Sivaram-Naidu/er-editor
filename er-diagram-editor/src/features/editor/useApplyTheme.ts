// Setting the theme, in one place (FR-9.3).
//
// Its own file rather than living beside `ThemeToggle`, for two reasons: a component file
// that also exports hooks and constants loses React Fast Refresh, and the toolbar select is
// no longer the only caller — the Ctrl+K palette offers the same three choices (FR-9.2).

import { useCallback } from 'react'

import { THEME_KEY, sharedRepository } from '../../persistence'
import { useUiStore, type Theme } from '../../store'

/** The three choices, in the order the toolbar shows them. */
export const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

/**
 * Set the theme AND remember it.
 *
 * Shared so the palette cannot drift from the toolbar. Changing the theme is two steps —
 * the store for this session, the preferences table for the next one — and a second call
 * site doing only the first would look right and silently forget the choice on reload.
 *
 * Deliberately not routed through the command stack: the theme is not part of the
 * document, and nobody wants Ctrl+Z to change the colour scheme.
 */
export function useApplyTheme(): (next: Theme) => void {
  const setTheme = useUiStore((state) => state.setTheme)
  return useCallback(
    (next: Theme) => {
      setTheme(next)
      // Fire-and-forget: a preference that fails to persist costs the user one re-pick
      // after a reload, which is not worth blocking the paint for.
      void sharedRepository().setPreference(THEME_KEY, next)
    },
    [setTheme],
  )
}
