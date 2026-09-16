/**
 * @vitest-environment jsdom
 *
 * Mounts the whole app shell, so it needs a DOM. The suite default is `node` (see the note in vite.config.ts), so a file that
 * mounts anything has to opt back up here.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import App from '../../../src/App'
import { createDiagram } from '../../../src/domain'
import { EDITOR_SHORTCUTS, type ShortcutId } from '../../../src/features/editor'
import { formatChord } from '../../../src/lib'
import { DexieDiagramRepository, LAST_OPENED_KEY } from '../../../src/persistence'
import { useDiagramStore, useSelectionStore } from '../../../src/store'

/**
 * Boot-path tests: does the app actually mount, and do the layers talk to each other.
 *
 * Everything here shares one module-level store and one IndexedDB origin, so both are
 * reset between cases. Without the reset these tests pass or fail depending on order —
 * the first case's autosave persists the sample, and recovery then restores it into the
 * second, which is the feature working correctly but is not what that case is testing.
 */
describe('App boot', () => {
  beforeEach(async () => {
    await new DexieDiagramRepository('er-diagram-editor').clear()
    useDiagramStore.getState().load(createDiagram())
    useSelectionStore.getState().clearSelection()
  })

  afterEach(() => {
    cleanup()
  })

  it('shows the empty state on a first run', async () => {
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('Start with a table.')).toBeInTheDocument()
    })
  })

  it('loads the sample schema, exercising every V1 notation cue', async () => {
    render(<App />)
    await waitFor(() => {
      expect(screen.getByText('Start with a table.')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Open the sample schema'))

    await waitFor(() => {
      expect(screen.getByText('CUSTOMER')).toBeInTheDocument()
    })
    expect(screen.getByText('ORDER_LINE')).toBeInTheDocument()
    // Weak entity, primary key and derived-field cues all render.
    expect(screen.getByText('weak')).toBeInTheDocument()
    expect(screen.getAllByTitle('Primary key').length).toBeGreaterThan(0)
    // The FK badge names its target rather than only saying "FK".
    expect(screen.getAllByTitle(/^Foreign key →/).length).toBeGreaterThan(0)
    expect(screen.getByText(/4 entities/)).toBeInTheDocument()
  })

  it('adds an entity from the toolbar and reflects it in the count', async () => {
    render(<App />)
    await waitFor(() => {
      expect(screen.getByText('Start with a table.')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Add your first entity' }))

    await waitFor(() => {
      expect(screen.getByText('ENTITY_1')).toBeInTheDocument()
    })
    expect(screen.getByText(/1 entity\b/)).toBeInTheDocument()
  })

  it('undo is offered after an edit and reverses it', async () => {
    render(<App />)
    await waitFor(() => {
      expect(screen.getByText('Start with a table.')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Add your first entity' }))
    await waitFor(() => {
      expect(screen.getByText('ENTITY_1')).toBeInTheDocument()
    })

    const undo = screen.getByRole('button', { name: 'Undo' })
    expect(undo).toBeEnabled()
    fireEvent.click(undo)

    await waitFor(() => {
      expect(screen.getByText('Start with a table.')).toBeInTheDocument()
    })
  })

  it('restores the previous session on reload (FR-7.3)', async () => {
    const repository = new DexieDiagramRepository('er-diagram-editor')
    const saved = createDiagram({ name: 'Recovered' })
    await repository.put(saved)
    await repository.setPreference(LAST_OPENED_KEY, saved.id)

    render(<App />)

    await waitFor(() => {
      expect(useDiagramStore.getState().diagram.name).toBe('Recovered')
    })
  })

  it('reports a corrupt session instead of failing to start', async () => {
    const repository = new DexieDiagramRepository('er-diagram-editor')
    await repository.setPreference(LAST_OPENED_KEY, 'dgm_missing')

    render(<App />)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('could not be read')
    })
    // The app is still usable, which is the point — FR-7.3's "discard and start new"
    // path only exists if it boots this far.
    expect(screen.getByText('Start with a table.')).toBeInTheDocument()
  })
})

describe('inspector visibility', () => {
  beforeEach(async () => {
    await new DexieDiagramRepository('er-diagram-editor').clear()
    useDiagramStore.getState().load(createDiagram())
    useSelectionStore.getState().clearSelection()
  })

  it('keeps the panel out of the way until something is selected', async () => {
    // 288px of "select something" permanently narrows the canvas, which is the thing
    // the user is here to look at.
    render(<App />)
    await waitFor(() => {
      expect(screen.getByText('Start with a table.')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Open the sample schema' }))
    await waitFor(() => {
      expect(screen.getByText('CUSTOMER')).toBeInTheDocument()
    })

    expect(screen.queryByRole('complementary', { name: 'Properties' })).not.toBeInTheDocument()
  })

  it('shows the panel on selection and hides it again on deselect', async () => {
    render(<App />)
    await waitFor(() => {
      expect(screen.getByText('Start with a table.')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Open the sample schema' }))
    await waitFor(() => {
      expect(screen.getByText('CUSTOMER')).toBeInTheDocument()
    })

    act(() => {
      useSelectionStore
        .getState()
        .selectEntities([useDiagramStore.getState().diagram.entities[0]!.id])
    })
    expect(await screen.findByRole('complementary', { name: 'Properties' })).toBeInTheDocument()

    act(() => {
      useSelectionStore.getState().clearSelection()
    })
    await waitFor(() => {
      expect(screen.queryByRole('complementary', { name: 'Properties' })).not.toBeInTheDocument()
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// THE PALETTE AGAINST THE KEYMAP (FR-9.2)
// ─────────────────────────────────────────────────────────────────────────────
//
// FR-9.2's wording is "a command palette exposing EVERY command". For a while it was not:
// the keymap bound copy, cut, paste, duplicate and Escape, the `?` sheet listed all five
// because it renders the keymap directly, and the palette offered none of them. Nothing
// failed. The palette was simply smaller than the requirement, and it stayed that way
// until the sheet was built beside it and the two could be read together.
//
// Types cannot close this one. `EDITOR_SHORTCUTS` and `paletteCommands` are different
// shapes for good reasons — the palette carries commands with no key at all (Export,
// Detail, Theme), so the implication only runs one way — and the palette list is built
// inside `Editor.tsx` on purpose, because that component already owns every handler and
// every disabled condition. A registry would be the second list this test exists to
// prevent.
//
// So it is asserted through the DOM, on the pair: open the palette and require a row for
// every chord the keymap answers to.

/**
 * The one shortcut the palette is allowed not to offer.
 *
 * Opening the palette from inside the palette. Everything else — including Escape, which
 * has an obvious key and is offered anyway — is a command, and FR-9.2 said every one.
 */
const NOT_IN_THE_PALETTE: readonly ShortcutId[] = ['palette']

describe('the command palette against the keymap (FR-9.2)', () => {
  beforeEach(async () => {
    await new DexieDiagramRepository('er-diagram-editor').clear()
    useDiagramStore.getState().load(createDiagram())
    useSelectionStore.getState().clearSelection()
  })

  afterEach(() => {
    /*
     * DISMISS THE DIALOG BEFORE UNMOUNTING, or every later test goes half-blind.
     *
     * Radix marks the rest of the document `aria-hidden` while a dialog is open, which is
     * the mechanism that actually confines a screen reader to it. It restores that on
     * dismiss — not when the tree is torn out from underneath it by `cleanup()`. A test
     * that ends with the palette open therefore leaves `aria-hidden` on the app container,
     * and the NEXT test's `getByRole` finds nothing while its `getByText` still works,
     * because only the first consults accessibility.
     *
     * That asymmetry is what makes this expensive to diagnose: it presents as the empty
     * state rendering its text but not its button, in a test that passes on its own.
     */
    fireEvent.keyDown(document, { key: 'Escape' })
    cleanup()
  })

  it('offers a command for every keyboard shortcut that runs one', async () => {
    render(<App />)
    await waitFor(() => {
      expect(screen.getByText('Start with a table.')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Open the sample schema' }))
    await waitFor(() => {
      expect(screen.getByText('CUSTOMER')).toBeInTheDocument()
    })

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    const listbox = await screen.findByRole('listbox')

    // Match on the HINT rather than the label: it is the same `Chord` object the keymap
    // tests with, so a row carrying it is proof the palette offers that key's command —
    // and it survives the dynamic labels ("Undo Move entity") that a name match would not.
    const hints = within(listbox)
      .getAllByRole('option')
      .flatMap((option) => [...option.querySelectorAll('kbd')].map((key) => key.textContent))

    const expected = EDITOR_SHORTCUTS.filter(
      (shortcut) => shortcut.id !== undefined && !NOT_IN_THE_PALETTE.includes(shortcut.id),
    )

    expect(expected.length).toBeGreaterThan(5)
    for (const shortcut of expected) {
      const chord = formatChord(shortcut.chords[0]!, { mac: false })
      expect(
        hints,
        `the keymap runs "${shortcut.label}" on ${chord} and the palette does not offer it`,
      ).toContain(chord)
    }
  })

  it('greys out the ones that need a selection, rather than offering a no-op', async () => {
    // A command that is offered and then does nothing is worse than one that is visibly
    // unavailable — which is the whole reason `disabled` is duplicated from the handlers.
    render(<App />)
    await waitFor(() => {
      expect(screen.getByText('Start with a table.')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Open the sample schema' }))
    await waitFor(() => {
      expect(screen.getByText('CUSTOMER')).toBeInTheDocument()
    })

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    const listbox = await screen.findByRole('listbox')

    const copy = within(listbox).getByRole('option', { name: /Copy selection/ })
    expect(copy).toHaveAttribute('aria-disabled', 'true')
  })

  it('runs a clipboard command that the keymap would have run', async () => {
    // The end-to-end claim: picking it from the palette does the same thing as the key.
    render(<App />)
    await waitFor(() => {
      expect(screen.getByText('Start with a table.')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Open the sample schema' }))
    await waitFor(() => {
      expect(screen.getByText('CUSTOMER')).toBeInTheDocument()
    })

    act(() => {
      useSelectionStore
        .getState()
        .selectEntities([useDiagramStore.getState().diagram.entities[0]!.id])
    })

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    const listbox = await screen.findByRole('listbox')
    fireEvent.click(within(listbox).getByRole('option', { name: /Duplicate selection/ }))

    await waitFor(() => {
      expect(useDiagramStore.getState().diagram.entities).toHaveLength(5)
    })
    expect(useDiagramStore.getState().history.undoLabel).toBe('Duplicate')
  })
})
