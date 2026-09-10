/**
 * @vitest-environment jsdom
 *
 * Reads and writes the document element to check the applied theme. The suite default is `node` (see the note in vite.config.ts), so a file that
 * mounts anything has to opt back up here.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ThemeToggle, useAppliedTheme } from '../../../src/features/editor'
import { THEME_KEY, sharedRepository } from '../../../src/persistence'
import { useUiStore } from '../../../src/store'

/**
 * FR-9.3: light and dark themes, following system preference by default.
 *
 * The dark palette lives in `ui/theme/tokens.css` behind `:root[data-theme='dark']`, so
 * the only thing worth asserting here is that the attribute it keys off actually gets
 * set — that is the whole mechanism, and it was the missing half for a long time.
 */
function Harness(): React.ReactElement {
  useAppliedTheme()
  return <ThemeToggle />
}

describe('theme (FR-9.3)', () => {
  beforeEach(() => {
    useUiStore.getState().setTheme('system')
    document.documentElement.removeAttribute('data-theme')
  })

  afterEach(() => {
    cleanup()
  })

  it('resolves system to a concrete palette rather than leaving it unset', () => {
    // jsdom implements no matchMedia, which stands in for "the preference is unknowable".
    // Light is the answer there, and the attribute is still written: the renderer should
    // never have to guess which palette it is in.
    render(<Harness />)

    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('applies an explicit choice', () => {
    render(<Harness />)

    fireEvent.change(screen.getByLabelText('Theme'), { target: { value: 'dark' } })

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(useUiStore.getState().theme).toBe('dark')
  })

  it('remembers the choice, so a reload does not undo it', async () => {
    render(<Harness />)

    fireEvent.change(screen.getByLabelText('Theme'), { target: { value: 'dark' } })

    expect(await sharedRepository().getPreference(THEME_KEY)).toBe('dark')
  })
})
