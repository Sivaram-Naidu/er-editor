// Light / dark / system, in the toolbar (FR-9.3).
//
// A select rather than a two-state button, because there are three states and the third
// is the default. A button that cycles would hide `System` behind a guess about what the
// icon currently means, and there is no icon that says "whatever the OS says".
//
// The choice is written straight to the preferences table rather than routed through the
// command stack: it is not part of the document, and nobody wants Ctrl+Z to change the
// colour scheme.

import { useUiStore, type Theme } from '../../store'

import { THEME_OPTIONS, useApplyTheme } from './useApplyTheme'

export function ThemeToggle(): React.ReactElement {
  const theme = useUiStore((state) => state.theme)
  const applyTheme = useApplyTheme()

  return (
    <label className="erd-field">
      Theme
      <select
        className="erd-select"
        value={theme}
        onChange={(event) => {
          applyTheme(event.target.value as Theme)
        }}
      >
        {THEME_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}
