// Light / dark / system, in the toolbar (FR-9.3).
//
// A select rather than a two-state button, because there are three states and the third
// is the default. A button that cycles would hide `System` behind a guess about what the
// icon currently means, and there is no icon that says "whatever the OS says".
//
// The choice is written straight to the preferences table rather than routed through the
// command stack: it is not part of the document, and nobody wants Ctrl+Z to change the
// colour scheme.

import { THEME_KEY, sharedRepository } from '../../persistence'
import { useUiStore, type Theme } from '../../store'

const OPTIONS: { value: Theme; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

export function ThemeToggle(): React.ReactElement {
  const theme = useUiStore((state) => state.theme)
  const setTheme = useUiStore((state) => state.setTheme)

  return (
    <label className="erd-field">
      Theme
      <select
        className="erd-select"
        value={theme}
        onChange={(event) => {
          const next = event.target.value as Theme
          setTheme(next)
          // Fire-and-forget: a preference that fails to persist costs the user one
          // re-pick after a reload, which is not worth blocking the paint for.
          void sharedRepository().setPreference(THEME_KEY, next)
        }}
      >
        {OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}
