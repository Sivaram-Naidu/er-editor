import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import App from '../../../src/App'
import { createDiagram } from '../../../src/domain'
import { DexieDiagramRepository } from '../../../src/persistence'
import { useDiagramStore, useSelectionStore } from '../../../src/store'

/**
 * The authoring path, end to end and through the real UI only.
 *
 * This is the test that answers "can someone actually build a schema with this?" — the
 * question Stage 6 exists to fix. Every step goes through a rendered control; nothing
 * reaches into the store to set up state mid-flow.
 */
describe('building a schema through the UI', () => {
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

  it('creates two entities, names them, adds fields, and connects them', async () => {
    render(<App />)
    await waitFor(() => {
      expect(screen.getByText('Start with a table.')).toBeInTheDocument()
    })

    // ── Two entities, from the toolbar ────────────────────────────────────
    fireEvent.click(screen.getByRole('button', { name: 'Add your first entity' }))
    await waitFor(() => {
      expect(diagram().entities).toHaveLength(1)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add entity' }))
    await waitFor(() => {
      expect(diagram().entities).toHaveLength(2)
    })

    // ── Rename the second through the inspector ───────────────────────────
    const second = diagram().entities[1]!
    act(() => {
      useSelectionStore.getState().selectEntities([second.id])
    })
    const nameInput = await screen.findByDisplayValue('ENTITY_2')
    fireEvent.change(nameInput, { target: { value: 'ORDER' } })
    expect(diagram().entities[1]?.name).toBe('ORDER')

    // ── Give it a primary key ─────────────────────────────────────────────
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    const typeInput = await screen.findByLabelText('Type')
    fireEvent.change(screen.getByLabelText('Field name'), { target: { value: 'id' } })
    fireEvent.change(typeInput, { target: { value: 'uuid' } })
    fireEvent.click(screen.getByLabelText(/Primary key/))

    expect(diagram().entities[1]?.attributes[0]).toMatchObject({
      name: 'id',
      dataType: 'uuid',
      isPrimaryKey: true,
      isNullable: false,
    })

    // ── Connect the two, from the toolbar ─────────────────────────────────
    const first = diagram().entities[0]!
    act(() => {
      useSelectionStore.getState().selectEntities([first.id, second.id])
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add relationship' })).toBeEnabled()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add relationship' }))

    expect(diagram().relationships).toHaveLength(1)
    // FR-1.5: a newly drawn relationship defaults to 1 : 0..N.
    expect(diagram().relationships[0]?.participants.map((p) => p.cardinality)).toEqual([
      'one',
      'many',
    ])
  })

  it('points a field at another entity’s key through the References picker', async () => {
    render(<App />)
    await waitFor(() => {
      expect(screen.getByText('Start with a table.')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Open the sample schema'))
    await waitFor(() => {
      expect(screen.getByText('CUSTOMER')).toBeInTheDocument()
    })

    const product = diagram().entities.find((entity) => entity.name === 'PRODUCT')!
    act(() => {
      useSelectionStore.getState().selectEntities([product.id])
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Add' }))

    const references = await screen.findByLabelText('References')
    const options = within(references)
      .getAllByRole('option')
      .map((o) => o.textContent)
    // Only entities with a key are offered (FR-1.11).
    expect(options).toContain('CUSTOMER')

    const customer = diagram().entities.find((entity) => entity.name === 'CUSTOMER')!
    fireEvent.change(references, { target: { value: customer.id } })

    const added = diagram()
      .entities.find((entity) => entity.name === 'PRODUCT')
      ?.attributes.at(-1)
    expect(added?.foreignKey?.entityId).toBe(customer.id)
  })

  it('everything done through the UI reverses with undo', async () => {
    render(<App />)
    await waitFor(() => {
      expect(screen.getByText('Start with a table.')).toBeInTheDocument()
    })
    const before = diagram()

    fireEvent.click(screen.getByRole('button', { name: 'Add your first entity' }))
    await waitFor(() => {
      expect(diagram().entities).toHaveLength(1)
    })
    act(() => {
      useSelectionStore.getState().selectEntities([diagram().entities[0]!.id])
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Add' }))
    fireEvent.click(await screen.findByLabelText(/Multivalued/))

    act(() => {
      while (useDiagramStore.getState().history.canUndo) useDiagramStore.getState().undo()
    })

    expect(diagram()).toEqual(before)
  })
})
