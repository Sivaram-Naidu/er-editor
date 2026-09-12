/**
 * @vitest-environment jsdom
 *
 * The Ctrl+K palette (FR-2.6, FR-9.2). The suite default is `node`, so a file that mounts
 * anything has to opt back up here.
 *
 * WHAT IS ASSERTED HERE, AND WHAT IS NOT.
 *
 * Here: the wiring a user touches that jsdom can actually see — which rows appear for a
 * query, which store a pick lands in, and the combobox/listbox contract. That contract is
 * asserted deliberately rather than assumed: this project has broken the same pattern
 * three separate ways (`role="menu"` around a textbox, hint text inside a `<label>`,
 * `aria-modal` with no focus trap), and every one of them was invisible to a mouse.
 *
 * Not here: that Ctrl+K opens it, that the caret lands in the box, and that the camera
 * moves. The first two are a real keydown against a real focus trap and the third is React
 * Flow geometry — `tests/e2e/interaction.spec.ts` covers them in Chrome.
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createAttribute,
  createDiagram,
  createEntity,
  createRelationship,
  type Diagram,
} from '../../../src/domain'
import { CommandPalette, type PaletteCommand } from '../../../src/features/search'
import { useDiagramStore, useSelectionStore, useViewportStore } from '../../../src/store'

function fixture(): Diagram {
  const customer = createEntity({
    name: 'CUSTOMER',
    attributes: [createAttribute({ name: 'email_address', dataType: 'text' })],
  })
  const order = createEntity({
    name: 'ORDER_LINE',
    attributes: [createAttribute({ name: 'quantity', dataType: 'int' })],
  })
  return createDiagram({
    name: 'shop',
    entities: [customer, order],
    relationships: [createRelationship({ name: 'places', from: customer.id, to: order.id })],
  })
}

function commands(overrides: Partial<PaletteCommand>[] = []): PaletteCommand[] {
  const base: PaletteCommand[] = [
    { id: 'add-entity', label: 'Add entity', hint: 'E', disabled: false, run: vi.fn() },
    { id: 'auto-layout', label: 'Auto-layout', hint: undefined, disabled: false, run: vi.fn() },
    {
      id: 'add-relationship',
      label: 'Add relationship',
      hint: 'R',
      disabled: true,
      run: vi.fn(),
    },
  ]
  return base.map((command, index) => ({ ...command, ...overrides[index] }))
}

/**
 * Mount against the diagram that is IN THE STORE.
 *
 * Not a fresh `fixture()`: every call mints new ids, and `useGoToIssue` resolves what it
 * was handed against the store's copy. Two diagrams that look identical and share no ids
 * is a silent no-op, which is the failure this helper exists to make impossible.
 */
function mount(list: PaletteCommand[], onClose = vi.fn()) {
  const diagram = useDiagramStore.getState().diagram
  render(<CommandPalette diagram={diagram} commands={list} onClose={onClose} />)
  return { onClose, input: screen.getByRole('combobox') }
}

/** The visible rows, in order, as a screen reader would enumerate them. */
function optionLabels(): string[] {
  return screen.getAllByRole('option').map((option) => option.textContent ?? '')
}

beforeEach(() => {
  const diagram = fixture()
  useDiagramStore.setState({ diagram })
  useSelectionStore.getState().clearSelection()
})

afterEach(() => {
  cleanup()
})

describe('CommandPalette', () => {
  it('is a combobox controlling a listbox, not a menu', () => {
    // `role="menu"` may not contain a textbox, and the last time one did here it also made
    // its own buttons invisible to a `getByRole('button')` query — which is exactly what a
    // screen reader experiences.
    const { input } = mount(commands())

    expect(screen.queryByRole('menu')).toBeNull()
    expect(input).toHaveAttribute('aria-controls', screen.getByRole('listbox').id)
    expect(input).toHaveAttribute('aria-autocomplete', 'list')
  })

  it('names the input with aria-label alone, with no hint text folded in', () => {
    // Hint text inside a `<label>` joins the accessible name — it produced
    // "RoleDistinguishes the two ends…" the last time. For a combobox that string is the
    // one thing read on focus.
    const { input } = mount(commands())
    const name = input.getAttribute('aria-label') ?? ''

    expect(name).toMatch(/search/i)
    expect(name).not.toContain(input.getAttribute('placeholder'))
  })

  it('lists every command when the box is empty, and no diagram rows', () => {
    mount(commands())

    expect(optionLabels()).toEqual(['Add entityE', 'Auto-layout', 'Add relationshipR'])
    expect(screen.queryByRole('group', { name: 'Diagram' })).toBeNull()
  })

  it('shows a disabled command rather than hiding it', () => {
    // FR-9.2 is a discoverability requirement. Hiding a command is how someone concludes
    // it does not exist; greying it out says "not right now".
    mount(commands())
    const row = screen.getByRole('option', { name: /Add relationship/ })

    expect(row).toHaveAttribute('aria-disabled', 'true')
  })

  it('searches tables and fields, with the diagram above the commands', async () => {
    const user = userEvent.setup()
    const { input } = mount(commands())

    await user.type(input, 'order')

    const groups = screen.getAllByRole('group').map((group) => group.getAttribute('aria-label'))
    expect(groups[0]).toBe('Diagram')
    expect(optionLabels()[0]).toContain('ORDER_LINE')
  })

  it('says which entity a field belongs to — FR-2.6 asks for this by name', async () => {
    const user = userEvent.setup()
    const { input } = mount(commands())

    await user.type(input, 'email')

    const row = screen.getByRole('option', { name: /email_address/ })
    expect(within(row).getByText('CUSTOMER')).toBeInTheDocument()
  })

  it('finds a table by an acronym, which is what makes it fuzzy', async () => {
    const user = userEvent.setup()
    const { input } = mount(commands())

    await user.type(input, 'ol')

    expect(optionLabels()[0]).toContain('ORDER_LINE')
  })

  it('reports no matches rather than an empty box', async () => {
    const user = userEvent.setup()
    const { input } = mount(commands())

    await user.type(input, 'zzzz')

    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(screen.getByText(/no tables, fields or commands/i)).toBeInTheDocument()
  })

  describe('the keyboard', () => {
    it('moves the active option without moving focus off the input', async () => {
      // `aria-activedescendant`, not a roving tabindex. Moving DOM focus would stop the
      // user typing, and would take the event target off the input — which is what keeps
      // the Editor's own `isTyping` guard armed over the palette.
      const user = userEvent.setup()
      const { input } = mount(commands())

      const first = input.getAttribute('aria-activedescendant')
      await user.keyboard('{ArrowDown}')

      expect(document.activeElement).toBe(input)
      expect(input.getAttribute('aria-activedescendant')).not.toBe(first)
    })

    it('runs the active command on Enter and closes', async () => {
      const user = userEvent.setup()
      const list = commands()
      const { onClose } = mount(list)

      await user.keyboard('{ArrowDown}{Enter}')

      expect(list[1]?.run).toHaveBeenCalledOnce()
      expect(onClose).toHaveBeenCalledOnce()
    })

    it('skips a disabled command rather than stopping on it', async () => {
      // Three commands, the third disabled. Two ArrowDowns from the top would land on it
      // if disabled rows were traversable; the cursor should stay on the second.
      const user = userEvent.setup()
      const list = commands()
      mount(list)

      await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')

      expect(list[2]?.run).not.toHaveBeenCalled()
      expect(list[1]?.run).toHaveBeenCalledOnce()
    })

    it('selects and reveals a table, which is FR-2.6 in one gesture', async () => {
      const user = userEvent.setup()
      const { input, onClose } = mount(commands())
      const diagram = useDiagramStore.getState().diagram
      const customer = diagram.entities.find((entity) => entity.name === 'CUSTOMER')

      await user.type(input, 'customer')
      await user.keyboard('{Enter}')

      expect([...useSelectionStore.getState().selectedEntityIds]).toEqual([customer?.id])
      // The camera request itself is React Flow geometry and belongs in the Playwright
      // suite; that the request was MADE is logic, and testable here.
      expect(useViewportStore.getState().revealRequest?.entityIds).toEqual([customer?.id])
      expect(onClose).toHaveBeenCalledOnce()
    })

    it('selects the field AND its entity when a field is picked', async () => {
      // The order is load-bearing: `selectEntities` clears the field selection when the
      // entity changes, so a field picked before its entity would be dropped. `useGoToIssue`
      // owns that ordering and this is the assertion that it is still being used.
      const user = userEvent.setup()
      const { input } = mount(commands())
      const diagram = useDiagramStore.getState().diagram
      const customer = diagram.entities.find((entity) => entity.name === 'CUSTOMER')

      await user.type(input, 'email')
      await user.keyboard('{Enter}')

      const selection = useSelectionStore.getState()
      expect([...selection.selectedEntityIds]).toEqual([customer?.id])
      expect(selection.selectedAttributeId).toBe(customer?.attributes[0]?.id)
    })
  })

  it('activates a row on click as well as on Enter', async () => {
    const user = userEvent.setup()
    const list = commands()
    const { onClose } = mount(list)

    await user.click(screen.getByRole('option', { name: /Auto-layout/ }))

    expect(list[1]?.run).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('does nothing when a disabled command is clicked', async () => {
    const user = userEvent.setup()
    const list = commands()
    const { onClose } = mount(list)

    await user.click(screen.getByRole('option', { name: /Add relationship/ }))

    expect(list[2]?.run).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })
})
