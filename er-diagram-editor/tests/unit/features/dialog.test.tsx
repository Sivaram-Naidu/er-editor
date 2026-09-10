/**
 * @vitest-environment jsdom
 *
 * The three things the hand-rolled modal shell got wrong (see the header of ui/Dialog.tsx).
 * A focus trap that nobody asserts on is a focus trap that quietly stops working, and it
 * is invisible to anyone using a mouse.
 *
 * The suite default is `node`, so a file that mounts anything has to opt back up here.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { Dialog } from '../../../src/ui'

/** A trigger outside the dialog, so focus has somewhere to come from and return to. */
function Host({ children }: { children?: React.ReactNode }): React.ReactElement {
  const [open, setOpen] = useState(false)

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          setOpen(true)
        }}
      >
        Open export
      </button>
      <button type="button">Behind the modal</button>
      {open ? (
        <Dialog
          title="Export"
          onClose={() => {
            setOpen(false)
          }}
        >
          {children}
        </Dialog>
      ) : null}
    </div>
  )
}

/** Radix blocks pointer events on the page behind the modal; that is the point of it. */
const user = userEvent.setup({ pointerEventsCheck: 0 })

describe('Dialog', () => {
  it('takes its accessible name from the visible heading', async () => {
    render(<Host />)
    await user.click(screen.getByRole('button', { name: 'Open export' }))

    // Not an `aria-label` that has to be kept in step with the <h2> by hand — the two
    // said different things ("Export diagram" and "Export") in the version this replaces.
    expect(screen.getByRole('dialog', { name: 'Export' })).toBeInTheDocument()
  })

  it('moves focus into the dialog on open', async () => {
    render(<Host />)
    await user.click(screen.getByRole('button', { name: 'Open export' }))

    const dialog = screen.getByRole('dialog')
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('keeps Tab inside the dialog', async () => {
    render(
      <Host>
        <button type="button">Copy</button>
        <button type="button">Download</button>
      </Host>,
    )
    await user.click(screen.getByRole('button', { name: 'Open export' }))

    const dialog = screen.getByRole('dialog')

    // Enough tabs to walk past every control in the dialog and wrap around twice. The
    // old shell let the second or third one land on the toolbar behind the overlay.
    for (let press = 0; press < 8; press += 1) {
      await user.tab()
      expect(dialog.contains(document.activeElement)).toBe(true)
    }
  })

  it('returns focus to whatever opened it', async () => {
    render(<Host />)
    const trigger = screen.getByRole('button', { name: 'Open export' })
    await user.click(trigger)

    await user.click(screen.getByRole('button', { name: 'Close' }))

    // Previously focus fell back to <body>, so the next Tab restarted at the top of the
    // page rather than where the user was. Awaited because the restore happens after the
    // dialog has unmounted, not during the click that closed it.
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger)
    })
  })

  it('closes on Escape', async () => {
    render(<Host />)
    await user.click(screen.getByRole('button', { name: 'Open export' }))

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes on the Close button', async () => {
    render(<Host />)
    await user.click(screen.getByRole('button', { name: 'Open export' }))

    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('hides the rest of the page from assistive technology while open', async () => {
    render(<Host />)
    await user.click(screen.getByRole('button', { name: 'Open export' }))

    // Note what is asserted: not `aria-modal="true"`, which is what the hand-rolled
    // panel set. Radix marks the REST of the page `aria-hidden` instead, which is the
    // stronger guarantee — `aria-modal` is advisory and unevenly implemented, and the
    // old shell set it while Tab could still walk out of the dialog, so it was
    // announcing a boundary that did not exist.
    const behind = screen.getByText('Behind the modal')
    expect(behind.closest('[aria-hidden="true"]')).not.toBeNull()
  })

  it('takes the wide panel by default', async () => {
    // The class names are load-bearing: all of the modal's layout lives on them, and
    // `.erd-modal` centring its child is why Content is nested inside Overlay.
    render(<Host />)
    await user.click(screen.getByRole('button', { name: 'Open export' }))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveClass('erd-modal__panel')
    expect(dialog).not.toHaveClass('erd-modal__panel--narrow')
  })

  it('renders the narrow variant when `narrow` is set', () => {
    render(
      <Dialog title="Open a file" onClose={() => undefined} narrow>
        <p>body</p>
      </Dialog>,
    )

    expect(screen.getByRole('dialog')).toHaveClass('erd-modal__panel--narrow')
  })
})
