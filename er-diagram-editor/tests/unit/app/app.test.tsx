import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import App from '../../../src/App'
import { createDiagram } from '../../../src/domain'
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
