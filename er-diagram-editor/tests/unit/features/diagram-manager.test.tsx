import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import App from '../../../src/App'
import { createDiagram, createEntity } from '../../../src/domain'
import { DexieDiagramRepository, sharedRepository } from '../../../src/persistence'
import { useDiagramStore, useSelectionStore } from '../../../src/store'

/**
 * Getting out of the diagram you are in, and back into one you left (FR-7.5).
 *
 * Before this, the app had exactly one document: once a diagram had a table the empty
 * state was unreachable, and anything made earlier sat in storage with nothing able to
 * open it.
 */
describe('diagram menu', () => {
  beforeEach(async () => {
    await new DexieDiagramRepository('er-diagram-editor').clear()
    useDiagramStore.getState().load(createDiagram())
    useSelectionStore.getState().clearSelection()
  })

  afterEach(() => {
    cleanup()
  })

  const diagram = (): ReturnType<typeof useDiagramStore.getState>['diagram'] =>
    useDiagramStore.getState().diagram

  async function boot(): Promise<void> {
    render(<App />)
    await waitFor(() => {
      expect(screen.getByText('Start with a table.')).toBeInTheDocument()
    })
  }

  it('shows the diagram title as the menu trigger', async () => {
    await boot()

    expect(screen.getByRole('button', { name: /Untitled diagram/ })).toBeInTheDocument()
  })

  it('renames the diagram, undoably', async () => {
    await boot()
    fireEvent.click(screen.getByRole('button', { name: /Untitled diagram/ }))

    fireEvent.change(screen.getByLabelText('Diagram name'), { target: { value: 'Shop schema' } })

    expect(diagram().name).toBe('Shop schema')
    act(() => {
      useDiagramStore.getState().undo()
    })
    expect(diagram().name).toBe('Untitled diagram')
  })

  it('creates a new diagram and returns to the empty state', async () => {
    await boot()
    fireEvent.click(screen.getByRole('button', { name: 'Open the sample schema' }))
    await waitFor(() => {
      expect(screen.getByText('CUSTOMER')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /Sample shop/ }))
    fireEvent.click(screen.getByRole('button', { name: 'New diagram' }))

    // The way back to the "home page": the empty state is reachable again.
    await waitFor(() => {
      expect(screen.getByText('Start with a table.')).toBeInTheDocument()
    })
    expect(diagram().entities).toHaveLength(0)
  })

  it('lists previously saved diagrams and reopens one', async () => {
    const earlier = createDiagram({
      name: 'Earlier work',
      entities: [createEntity({ name: 'LEGACY' })],
    })
    await sharedRepository().put(earlier)

    await boot()
    fireEvent.click(screen.getByRole('button', { name: /Untitled diagram/ }))

    const entry = await screen.findByRole('button', { name: /^Earlier work/ })
    fireEvent.click(entry)

    await waitFor(() => {
      expect(diagram().name).toBe('Earlier work')
    })
    expect(diagram().entities[0]?.name).toBe('LEGACY')
  })

  it('does not offer the diagram you are already in', async () => {
    await sharedRepository().put(createDiagram({ name: 'Other' }))
    await boot()

    fireEvent.click(screen.getByRole('button', { name: /Untitled diagram/ }))

    expect(await screen.findByRole('button', { name: /^Other/ })).toBeInTheDocument()
    // Only the trigger, not a list entry.
    expect(screen.queryAllByRole('button', { name: /Untitled diagram/ })).toHaveLength(1)
  })

  it('says so plainly when nothing else is saved', async () => {
    await boot()
    fireEvent.click(screen.getByRole('button', { name: /Untitled diagram/ }))

    expect(screen.getByText(/Nothing else saved yet/)).toBeInTheDocument()
  })

  it('deletes a saved diagram', async () => {
    await sharedRepository().put(createDiagram({ name: 'Disposable' }))
    await boot()
    fireEvent.click(screen.getByRole('button', { name: /Untitled diagram/ }))
    await screen.findByRole('button', { name: /^Disposable/ })

    fireEvent.click(screen.getByRole('button', { name: 'Delete Disposable' }))

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /^Disposable/ })).not.toBeInTheDocument()
    })
  })

  it('closes on Escape', async () => {
    await boot()
    fireEvent.click(screen.getByRole('button', { name: /Untitled diagram/ }))
    expect(screen.getByLabelText('Diagram name')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => {
      expect(screen.queryByLabelText('Diagram name')).not.toBeInTheDocument()
    })
  })

  it('clears the selection when switching documents', async () => {
    // Selection holds ids belonging to the document being left; carrying them across
    // would leave the inspector editing a table that is no longer on screen.
    await boot()
    fireEvent.click(screen.getByRole('button', { name: 'Open the sample schema' }))
    await waitFor(() => {
      expect(screen.getByText('CUSTOMER')).toBeInTheDocument()
    })
    act(() => {
      useSelectionStore.getState().selectEntities([diagram().entities[0]!.id])
    })

    fireEvent.click(screen.getByRole('button', { name: /Sample shop/ }))
    fireEvent.click(screen.getByRole('button', { name: 'New diagram' }))

    await waitFor(() => {
      expect(useSelectionStore.getState().selectedEntityIds.size).toBe(0)
    })
  })
})
