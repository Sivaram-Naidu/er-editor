/**
 * @vitest-environment jsdom
 *
 * The toolbar half of FR-3.5. The suite default is `node` (see the note in
 * vite.config.ts), so a file that mounts anything has to opt back up here.
 *
 * What the canvas does with the flag is geometry and pointer events — that is
 * `tests/unit/render/alignment.test.ts` and `tests/e2e/interaction.spec.ts`. What is left
 * here is the part that has been got wrong before: a preference set in the store for this
 * session and never written down for the next one.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { SnapToggle } from '../../../src/features/editor'
import { SNAP_TO_GRID_KEY, sharedRepository } from '../../../src/persistence'
import { useUiStore } from '../../../src/store'

describe('snap to grid (FR-3.5)', () => {
  beforeEach(() => {
    useUiStore.getState().setSnapToGrid(false)
  })

  afterEach(() => {
    cleanup()
  })

  it('starts off, because an arranged diagram does not sit on any grid', () => {
    // On by default would make the first box a user touches jump before they had moved it
    // anywhere — ELK's output lands wherever the algorithm put it.
    render(<SnapToggle />)

    expect(screen.getByRole('button', { name: /Snap to grid/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('flips the flag the canvas reads', () => {
    render(<SnapToggle />)

    fireEvent.click(screen.getByRole('button', { name: /Snap to grid/ }))

    expect(useUiStore.getState().snapToGrid).toBe(true)
    expect(screen.getByRole('button', { name: /Snap to grid/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('says what the button will do as well as what it is', () => {
    // "Snap" on its own leaves a user guessing whether the button is a state or an
    // action, and `aria-pressed` alone does not read as a sentence (NFR-4.4).
    render(<SnapToggle />)
    const button = screen.getByRole('button', { name: /Snap to grid/ })

    expect(button.getAttribute('aria-label')).toContain('off')
    fireEvent.click(button)
    expect(button.getAttribute('aria-label')).toContain('on')
  })

  it('remembers the choice, so a reload does not undo it', async () => {
    render(<SnapToggle />)

    fireEvent.click(screen.getByRole('button', { name: /Snap to grid/ }))

    expect(await sharedRepository().getPreference(SNAP_TO_GRID_KEY)).toBe(true)
  })
})
