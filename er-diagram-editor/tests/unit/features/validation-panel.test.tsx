/**
 * @vitest-environment jsdom
 *
 * Mounts the problems panel and its toggle. The suite default is `node` (see the note in vite.config.ts), so a file that
 * mounts anything has to opt back up here.
 */
import { act, cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  createAttribute,
  createDiagram,
  createEntity,
  createRelationship,
  type Attribute,
  type Diagram,
  type Entity,
  type Relationship,
} from '../../../src/domain'
import { ValidationPanel, ValidationToggle } from '../../../src/features/validation-panel'
import {
  useDiagramStore,
  useSelectionStore,
  useUiStore,
  useViewportStore,
} from '../../../src/store'

/**
 * FR-8.1's two halves: the panel lists issues by severity, and clicking one selects and
 * reveals the offending element. Plus FR-8.4's badge.
 *
 * The rules themselves are covered in tests/unit/domain/validation.test.ts. What is
 * asserted here is the wiring the user actually touches — that a click lands the right
 * selection in the right store, and that a field-level issue selects its entity AND the
 * field, which is the case most easily got wrong.
 *
 * `revealEntities` is checked through the store rather than through the canvas: the
 * camera move itself is React Flow geometry and belongs in the Playwright suite, but
 * whether the request was made at all is logic, and testable here.
 */

interface Fixture {
  diagram: Diagram
  customer: Entity
  order: Entity
  nameless: Entity
  unnamedRelationship: Relationship
  namelessField: Attribute
}

/**
 * Deliberately messy, with one finding in each tier:
 *
 *   CUSTOMER — clean: named, keyed, connected.
 *   ORDER    — has an unnamed field (error) and its FK type disagrees (warning).
 *   (blank)  — unnamed (error), no key (warning), unconnected (warning).
 *   places   — unnamed relationship (warning).
 *   tagged   — many-to-many (info).
 */
function fixture(): Fixture {
  const customerKey = createAttribute({ name: 'id', dataType: 'integer', isPrimaryKey: true })
  const customer = createEntity({ name: 'CUSTOMER', attributes: [customerKey] })

  const namelessField: Attribute = {
    ...createAttribute({ name: '', dataType: 'text' }),
    foreignKey: { entityId: customer.id, attributeId: customerKey.id },
  }
  const order = createEntity({
    name: 'ORDER',
    attributes: [
      createAttribute({ name: 'id', dataType: 'integer', isPrimaryKey: true }),
      namelessField,
    ],
  })

  const nameless = createEntity({ name: '' })

  const unnamedRelationship = createRelationship({ from: customer.id, to: order.id })
  const manyToMany = createRelationship({
    from: customer.id,
    to: order.id,
    name: 'tagged with',
    fromEnd: { cardinality: 'many' },
    toEnd: { cardinality: 'many' },
  })

  const diagram = createDiagram({
    name: 'Messy',
    entities: [customer, order, nameless],
    relationships: [unnamedRelationship, manyToMany],
  })

  return { diagram, customer, order, nameless, unnamedRelationship, namelessField }
}

let f: Fixture

beforeEach(() => {
  f = fixture()
  useDiagramStore.getState().load(f.diagram)
  useSelectionStore.getState().clearSelection()
})

afterEach(() => {
  cleanup()
  // The ui store is a module singleton, so a toggle here would otherwise leak into
  // whichever file vitest runs next and open the panel in an unrelated test.
  if (useUiStore.getState().validationPanelOpen) useUiStore.getState().toggleValidationPanel()
})

const noop = (): void => {}

const selection = () => useSelectionStore.getState()
const reveal = () => useViewportStore.getState().revealRequest

describe('the panel', () => {
  it('groups issues under a heading per severity, worst first', () => {
    render(<ValidationPanel onClose={noop} />)

    const headings = screen.getAllByRole('heading', { level: 3 }).map((node) => node.textContent)

    expect(headings.map((text) => text?.replace(/\d+/g, '').trim())).toEqual([
      'Errors',
      'Warnings',
      'Observations',
    ])
  })

  it('counts the issues in each heading', () => {
    render(<ValidationPanel onClose={noop} />)

    // One M:N, and nothing else reports at info level.
    expect(screen.getByRole('heading', { name: /Observations/ }).textContent).toContain('1')
  })

  it('summarises the totals in the header', () => {
    render(<ValidationPanel onClose={noop} />)

    const header = screen.getByRole('heading', { level: 2 }).closest('header')
    expect(header).not.toBeNull()
    expect(header?.textContent).toMatch(/error/)
    expect(header?.textContent).toMatch(/warning/)
  })

  it('says what was checked when there is nothing to report', () => {
    // An empty list is only reassuring if it says what it looked for.
    const key = createAttribute({ name: 'id', dataType: 'integer', isPrimaryKey: true })
    const a = createEntity({ name: 'CUSTOMER', attributes: [key] })
    const b = createEntity({
      name: 'ORDER',
      attributes: [createAttribute({ name: 'id', dataType: 'integer', isPrimaryKey: true })],
    })
    useDiagramStore.getState().load(
      createDiagram({
        entities: [a, b],
        relationships: [createRelationship({ from: a.id, to: b.id, name: 'places' })],
      }),
    )

    render(<ValidationPanel onClose={noop} />)

    expect(screen.getByText(/Nothing to report/)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument()
  })

  it('offers each issue as a button, not an unfocusable row', () => {
    // NFR-3.2: reachable by keyboard. A div with onClick is not.
    render(<ValidationPanel onClose={noop} />)

    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBeGreaterThan(1)
  })

  it('closes on the hide control', () => {
    let closed = false
    render(
      <ValidationPanel
        onClose={() => {
          closed = true
        }}
      />,
    )

    screen.getByRole('button', { name: 'Hide' }).click()

    expect(closed).toBe(true)
  })
})

describe('clicking an issue', () => {
  /** The first issue button whose message contains `text`. */
  function issueButton(text: string | RegExp): HTMLElement {
    const match = screen
      .getAllByRole('button')
      .find((button) =>
        typeof text === 'string'
          ? button.textContent?.includes(text)
          : text.test(button.textContent ?? ''),
      )

    expect(match).toBeDefined()
    return match as HTMLElement
  }

  it('selects the entity an entity-level issue names', () => {
    render(<ValidationPanel onClose={noop} />)

    issueButton('This entity has no name.').click()

    expect([...selection().selectedEntityIds]).toEqual([f.nameless.id])
  })

  it('reveals the entity as well as selecting it', () => {
    render(<ValidationPanel onClose={noop} />)

    issueButton('This entity has no name.').click()

    expect(reveal()?.entityIds).toEqual([f.nameless.id])
  })

  it('selects both the entity and the field for a field-level issue', () => {
    // The order matters in the implementation: selecting an entity clears the field
    // selection, so choosing the field first would silently lose it.
    render(<ValidationPanel onClose={noop} />)

    issueButton('A field on ORDER has no name.').click()

    expect([...selection().selectedEntityIds]).toEqual([f.order.id])
    expect(selection().selectedAttributeId).toBe(f.namelessField.id)
  })

  it('selects the relationship for a relationship-level issue', () => {
    render(<ValidationPanel onClose={noop} />)

    issueButton(/has no name, so the line does not say what it means/).click()

    expect([...selection().selectedRelationshipIds]).toEqual([f.unnamedRelationship.id])
    expect(selection().selectedEntityIds.size).toBe(0)
  })

  it('frames both ends of a relationship rather than the line itself', () => {
    // A connector's midpoint can sit a long way from anything readable; the two tables
    // are what the issue is about.
    render(<ValidationPanel onClose={noop} />)

    issueButton(/has no name, so the line does not say what it means/).click()

    expect(reveal()?.entityIds).toHaveLength(2)
    expect(reveal()?.entityIds).toContain(f.customer.id)
    expect(reveal()?.entityIds).toContain(f.order.id)
  })

  it('re-reveals on a second click of the same issue', () => {
    // The user clicks an issue, pans away, and clicks it again. Without a changing nonce
    // the second click would be indistinguishable from the first and do nothing.
    render(<ValidationPanel onClose={noop} />)

    issueButton('This entity has no name.').click()
    const first = reveal()?.nonce

    issueButton('This entity has no name.').click()
    const second = reveal()?.nonce

    expect(first).toBeDefined()
    expect(second).toBe((first ?? 0) + 1)
  })
})

describe('the toolbar badge', () => {
  it('counts errors and warnings but not observations', () => {
    render(<ValidationToggle />)

    const button = screen.getByRole('button')
    const label = button.getAttribute('aria-label') ?? ''
    const errors = Number(/(\d+) errors/.exec(label)?.[1] ?? '0')
    const warnings = Number(/(\d+) warnings/.exec(label)?.[1] ?? '0')

    expect(errors).toBeGreaterThan(0)
    expect(warnings).toBeGreaterThan(0)
    expect(within(button).getByText(String(errors + warnings))).toBeInTheDocument()
  })

  it('says what the number counts, for a screen reader', () => {
    // "Issues 7" read aloud does not say what 7 is.
    render(<ValidationToggle />)

    expect(screen.getByRole('button').getAttribute('aria-label')).toMatch(
      /^Issues: \d+ errors, \d+ warnings$/,
    )
  })

  it('shows no number at all on a clean diagram', () => {
    const key = createAttribute({ name: 'id', dataType: 'integer', isPrimaryKey: true })
    const a = createEntity({ name: 'CUSTOMER', attributes: [key] })
    const b = createEntity({
      name: 'ORDER',
      attributes: [createAttribute({ name: 'id', dataType: 'integer', isPrimaryKey: true })],
    })
    useDiagramStore.getState().load(
      createDiagram({
        entities: [a, b],
        relationships: [createRelationship({ from: a.id, to: b.id, name: 'places' })],
      }),
    )

    render(<ValidationToggle />)

    const button = screen.getByRole('button')
    expect(button.getAttribute('aria-label')).toBe('Issues: none found')
    expect(button.textContent).toBe('Issues')
  })

  it('marks the badge as an error when any error is present', () => {
    render(<ValidationToggle />)

    const badge = screen.getByRole('button').querySelector('.erd-validation-toggle__badge')
    expect(badge?.getAttribute('data-severity')).toBe('error')
  })

  it('marks the badge as a warning when there are warnings but no errors', () => {
    // Two named, keyed, unconnected entities: orphan warnings only.
    const a = createEntity({
      name: 'CUSTOMER',
      attributes: [createAttribute({ name: 'id', isPrimaryKey: true })],
    })
    const b = createEntity({
      name: 'PRODUCT',
      attributes: [createAttribute({ name: 'id', isPrimaryKey: true })],
    })
    useDiagramStore.getState().load(createDiagram({ entities: [a, b] }))

    render(<ValidationToggle />)

    const badge = screen.getByRole('button').querySelector('.erd-validation-toggle__badge')
    expect(badge?.getAttribute('data-severity')).toBe('warning')
  })

  it('reports its open state to assistive technology', () => {
    render(<ValidationToggle />)

    const button = screen.getByRole('button')
    expect(button.getAttribute('aria-expanded')).toBe('false')

    act(() => {
      button.click()
    })

    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true')
  })
})
