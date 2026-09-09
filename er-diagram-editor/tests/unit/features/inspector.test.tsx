import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  createAttribute,
  createDiagram,
  createEntity,
  createRelationship,
  type Attribute,
  type Diagram,
  type Entity,
} from '../../../src/domain'
import { InspectorPanel } from '../../../src/features/inspector'
import { useDiagramStore, useSelectionStore } from '../../../src/store'

/**
 * The inspector is the surface that makes the domain commands reachable. Every control
 * writes through a command, so these tests double as proof that there is no second write
 * path: after each edit the store's history must have grown, and undo must reverse it.
 */

function fixture(): { diagram: Diagram; customer: Entity; order: Entity; pk: Attribute } {
  const pk = createAttribute({ name: 'id', dataType: 'uuid', isPrimaryKey: true })
  const customer = createEntity({ name: 'CUSTOMER', attributes: [pk] })
  const order = createEntity({
    name: 'ORDER',
    attributes: [createAttribute({ name: 'placed_at', dataType: 'timestamptz' })],
  })
  const diagram = createDiagram({
    name: 'Shop',
    entities: [customer, order],
    relationships: [createRelationship({ from: customer.id, to: order.id, name: 'places' })],
  })
  return { diagram, customer, order, pk }
}

let f: ReturnType<typeof fixture>

beforeEach(() => {
  f = fixture()
  useDiagramStore.getState().load(f.diagram)
  useSelectionStore.getState().clearSelection()
})

afterEach(() => {
  cleanup()
})

const diagramNow = (): Diagram => useDiagramStore.getState().diagram
const entityNow = (name: string): Entity | undefined =>
  diagramNow().entities.find((entity) => entity.name === name)

describe('empty and multi selection', () => {
  it('invites a selection rather than showing a blank panel', () => {
    render(<InspectorPanel />)

    expect(screen.getByText(/Select an entity or a relationship/)).toBeInTheDocument()
  })

  it('explains what a multi-selection can do', () => {
    useSelectionStore.getState().selectEntities([f.customer.id, f.order.id])
    render(<InspectorPanel />)

    expect(screen.getByText(/2 entities selected/)).toBeInTheDocument()
  })
})

describe('entity properties', () => {
  beforeEach(() => {
    useSelectionStore.getState().selectEntities([f.customer.id])
  })

  it('renames through a command, so it is undoable', () => {
    render(<InspectorPanel />)

    fireEvent.change(screen.getByDisplayValue('CUSTOMER'), { target: { value: 'CLIENT' } })

    expect(entityNow('CLIENT')).toBeDefined()
    expect(useDiagramStore.getState().history.canUndo).toBe(true)

    // Store writes issued from outside an event handler have to be wrapped: React has
    // no idea a subscription fired, so without this the assertion can read the tree
    // before the re-render commits.
    act(() => {
      useDiagramStore.getState().undo()
    })
    expect(entityNow('CUSTOMER')).toBeDefined()
  })

  it('marks an entity weak', () => {
    render(<InspectorPanel />)

    fireEvent.click(screen.getByLabelText(/Weak entity/))

    expect(entityNow('CUSTOMER')?.kind).toBe('weak')
  })

  it('sets and clears a comment', () => {
    render(<InspectorPanel />)
    const input = screen.getByLabelText('Comment')

    fireEvent.change(input, { target: { value: 'People who buy things' } })
    expect(entityNow('CUSTOMER')?.comment).toBe('People who buy things')

    fireEvent.change(screen.getByDisplayValue('People who buy things'), { target: { value: '' } })
    expect('comment' in (entityNow('CUSTOMER') ?? {})).toBe(false)
  })

  it('warns how many relationships a delete will take with it (FR-1.7)', () => {
    render(<InspectorPanel />)

    expect(screen.getByText(/also delete 1 relationship/)).toBeInTheDocument()
  })

  it('omits the cascade warning when there is nothing to cascade', () => {
    const lonely = createEntity({ name: 'LONELY' })
    useDiagramStore.getState().load(createDiagram({ entities: [lonely] }))
    useSelectionStore.getState().selectEntities([lonely.id])
    render(<InspectorPanel />)

    expect(screen.queryByText(/also delete/)).not.toBeInTheDocument()
  })

  it('deletes the entity and clears the selection', () => {
    render(<InspectorPanel />)

    fireEvent.click(screen.getByText('Delete entity'))

    expect(entityNow('CUSTOMER')).toBeUndefined()
    expect(useSelectionStore.getState().selectedEntityIds.size).toBe(0)
  })
})

describe('fields', () => {
  beforeEach(() => {
    useSelectionStore.getState().selectEntities([f.customer.id])
  })

  it('lists the entity fields', () => {
    render(<InspectorPanel />)
    // Two lists now: fields, then relationships.
    const [fields] = screen.getAllByRole('list')

    expect(within(fields!).getByText('id')).toBeInTheDocument()
  })

  it('adds a field and selects it, so the cursor lands where the work is', () => {
    render(<InspectorPanel />)

    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(entityNow('CUSTOMER')?.attributes).toHaveLength(2)
    expect(useSelectionStore.getState().selectedAttributeId).toBeDefined()
    // The editor for the new field appears immediately.
    expect(screen.getByText('Field')).toBeInTheDocument()
  })

  it('invites a first field when the entity has none', () => {
    useSelectionStore.getState().selectEntities([f.order.id])
    useDiagramStore.getState().load(createDiagram({ entities: [createEntity({ name: 'BLANK' })] }))
    useSelectionStore.getState().selectEntities([diagramNow().entities[0]!.id])
    render(<InspectorPanel />)

    expect(screen.getByText(/No fields yet/)).toBeInTheDocument()
  })

  it('opens the editor when a field is picked', () => {
    render(<InspectorPanel />)

    fireEvent.click(screen.getByRole('button', { name: /id/ }))

    expect(screen.getByLabelText('Type')).toHaveValue('uuid')
  })
})

describe('field constraints', () => {
  beforeEach(() => {
    useSelectionStore.getState().selectEntities([f.customer.id])
    useSelectionStore.getState().selectAttribute(f.pk.id)
  })

  it('edits the data type', () => {
    render(<InspectorPanel />)

    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'bigint' } })

    expect(entityNow('CUSTOMER')?.attributes[0]?.dataType).toBe('bigint')
  })

  it('clearing the type removes the field rather than storing an empty string', () => {
    render(<InspectorPanel />)

    fireEvent.change(screen.getByLabelText('Type'), { target: { value: '' } })

    expect('dataType' in (entityNow('CUSTOMER')?.attributes[0] ?? {})).toBe(false)
  })

  it('marking a field as the key also makes it required and unique', () => {
    // A nullable primary key is a contradiction the schema tolerates and the validator
    // flags; the UI should not be able to create one by accident.
    useSelectionStore.getState().selectEntities([f.order.id])
    const placedAt = entityNow('ORDER')!.attributes[0]!
    useSelectionStore.getState().selectAttribute(placedAt.id)
    render(<InspectorPanel />)

    fireEvent.click(screen.getByLabelText(/Primary key/))

    const updated = entityNow('ORDER')?.attributes[0]
    expect(updated).toMatchObject({ isPrimaryKey: true, isNullable: false, isUnique: true })
  })

  it('locks Required and Unique while the field is the key', () => {
    render(<InspectorPanel />)

    expect(screen.getByLabelText(/Required/)).toBeDisabled()
    expect(screen.getByLabelText(/Unique/)).toBeDisabled()
  })

  it('toggles the Chen-only shape flags', () => {
    useSelectionStore.getState().selectEntities([f.order.id])
    useSelectionStore.getState().selectAttribute(entityNow('ORDER')!.attributes[0]!.id)
    render(<InspectorPanel />)

    fireEvent.click(screen.getByLabelText(/Multivalued/))
    fireEvent.click(screen.getByLabelText(/Derived/))

    expect(entityNow('ORDER')?.attributes[0]).toMatchObject({
      isMultivalued: true,
      isDerived: true,
    })
  })

  it('deletes a field and drops the field selection', () => {
    render(<InspectorPanel />)

    fireEvent.click(screen.getByText('Delete field'))

    expect(entityNow('CUSTOMER')?.attributes).toHaveLength(0)
    expect(useSelectionStore.getState().selectedAttributeId).toBeUndefined()
  })
})

describe('foreign keys (FR-1.11)', () => {
  it('offers only entities that have a key to reference', () => {
    // ORDER has no PK or unique field, so it is not a valid target. Offering it would
    // produce a diagram that exports to SQL the database rejects.
    useSelectionStore.getState().selectEntities([f.order.id])
    useSelectionStore.getState().selectAttribute(entityNow('ORDER')!.attributes[0]!.id)
    render(<InspectorPanel />)

    const options = within(screen.getByLabelText('References')).getAllByRole('option')

    expect(options.map((option) => option.textContent)).toEqual(['Nothing', 'CUSTOMER'])
  })

  it('sets a foreign key to the target key field', () => {
    useSelectionStore.getState().selectEntities([f.order.id])
    useSelectionStore.getState().selectAttribute(entityNow('ORDER')!.attributes[0]!.id)
    render(<InspectorPanel />)

    fireEvent.change(screen.getByLabelText('References'), { target: { value: f.customer.id } })

    expect(entityNow('ORDER')?.attributes[0]?.foreignKey).toEqual({
      entityId: f.customer.id,
      attributeId: f.pk.id,
    })
  })

  it('clears a foreign key', () => {
    useSelectionStore.getState().selectEntities([f.order.id])
    useSelectionStore.getState().selectAttribute(entityNow('ORDER')!.attributes[0]!.id)
    render(<InspectorPanel />)

    fireEvent.change(screen.getByLabelText('References'), { target: { value: f.customer.id } })
    fireEvent.change(screen.getByLabelText('References'), { target: { value: '' } })

    expect(entityNow('ORDER')?.attributes[0]?.foreignKey).toBeUndefined()
  })
})

describe('field order', () => {
  beforeEach(() => {
    const many = createEntity({
      name: 'MANY',
      attributes: [
        createAttribute({ name: 'a' }),
        createAttribute({ name: 'b' }),
        createAttribute({ name: 'c' }),
      ],
    })
    useDiagramStore.getState().load(createDiagram({ entities: [many] }))
    useSelectionStore.getState().selectEntities([many.id])
  })

  it('moves a field down', () => {
    useSelectionStore.getState().selectAttribute(entityNow('MANY')!.attributes[0]!.id)
    render(<InspectorPanel />)

    fireEvent.click(screen.getByTitle('Move field down'))

    expect(entityNow('MANY')?.attributes.map((a) => a.name)).toEqual(['b', 'a', 'c'])
  })

  it('disables Up on the first field and Down on the last', () => {
    useSelectionStore.getState().selectAttribute(entityNow('MANY')!.attributes[0]!.id)
    render(<InspectorPanel />)

    expect(screen.getByTitle('Move field up')).toBeDisabled()
    expect(screen.getByTitle('Move field down')).toBeEnabled()
  })
})

describe('relationships (FR-1.5, FR-1.9)', () => {
  beforeEach(() => {
    useSelectionStore.getState().selectRelationships([f.diagram.relationships[0]!.id])
  })

  it('reads the cardinality back as a sentence', () => {
    // Cardinality is the most misread part of an ER diagram; two dropdowns do not say
    // what they mean together.
    render(<InspectorPanel />)

    expect(screen.getByText(/Each/)).toHaveTextContent('CUSTOMER')
    expect(screen.getByText(/Each/)).toHaveTextContent('zero or more')
  })

  it('renames the relationship', () => {
    render(<InspectorPanel />)

    fireEvent.change(screen.getByDisplayValue('places'), { target: { value: 'submits' } })

    expect(diagramNow().relationships[0]?.name).toBe('submits')
  })

  it('changes cardinality on one end only', () => {
    render(<InspectorPanel />)
    const [, targetEnd] = screen.getAllByLabelText('Cardinality')

    fireEvent.change(targetEnd!, { target: { value: 'one-total' } })

    expect(diagramNow().relationships[0]?.participants.map((p) => p.cardinality)).toEqual([
      'one',
      'one',
    ])
  })

  it('toggles identifying', () => {
    render(<InspectorPanel />)

    fireEvent.click(screen.getByLabelText(/Identifying/))

    expect(diagramNow().relationships[0]?.isIdentifying).toBe(true)
  })

  it('hides the role field on an ordinary relationship', () => {
    // Two different entities are already distinguishable by name; a role would be noise.
    render(<InspectorPanel />)

    expect(screen.queryByLabelText('Role')).not.toBeInTheDocument()
  })

  it('deletes the relationship without touching the entities', () => {
    render(<InspectorPanel />)

    fireEvent.click(screen.getByText('Delete relationship'))

    expect(diagramNow().relationships).toHaveLength(0)
    expect(diagramNow().entities).toHaveLength(2)
  })
})

describe('recursive relationships (FR-1.12)', () => {
  it('offers a role on each end, since both ends name the same entity', () => {
    const employee = createEntity({ name: 'EMPLOYEE' })
    const self = createRelationship({ from: employee.id, to: employee.id, name: 'reports to' })
    useDiagramStore.getState().load(createDiagram({ entities: [employee], relationships: [self] }))
    useSelectionStore.getState().selectRelationships([self.id])

    render(<InspectorPanel />)

    expect(screen.getAllByLabelText('Role')).toHaveLength(2)
  })

  it('sets a role on one end', () => {
    const employee = createEntity({ name: 'EMPLOYEE' })
    const self = createRelationship({ from: employee.id, to: employee.id, name: 'reports to' })
    useDiagramStore.getState().load(createDiagram({ entities: [employee], relationships: [self] }))
    useSelectionStore.getState().selectRelationships([self.id])

    render(<InspectorPanel />)
    fireEvent.change(screen.getAllByLabelText('Role')[0]!, { target: { value: 'manager' } })

    expect(diagramNow().relationships[0]?.participants[0]?.role).toBe('manager')
  })
})

describe('every inspector edit is undoable', () => {
  it('a sequence of edits reverses cleanly back to the starting document', () => {
    useSelectionStore.getState().selectEntities([f.customer.id])
    useSelectionStore.getState().selectAttribute(f.pk.id)
    render(<InspectorPanel />)

    fireEvent.change(screen.getByDisplayValue('CUSTOMER'), { target: { value: 'CLIENT' } })
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'bigint' } })
    fireEvent.click(screen.getByLabelText(/Weak entity/))

    act(() => {
      while (useDiagramStore.getState().history.canUndo) useDiagramStore.getState().undo()
    })

    expect(diagramNow()).toEqual(f.diagram)
  })
})

describe('relationships section (FR-1.4)', () => {
  beforeEach(() => {
    useSelectionStore.getState().selectEntities([f.customer.id])
  })

  it('lists what the entity is connected to', () => {
    render(<InspectorPanel />)

    expect(screen.getByText('Relationships')).toBeInTheDocument()
    const lists = screen.getAllByRole('list')
    expect(within(lists[1]!).getByText('ORDER')).toBeInTheDocument()
  })

  it('says so plainly when nothing is connected', () => {
    const lonely = createEntity({ name: 'LONELY' })
    useDiagramStore.getState().load(createDiagram({ entities: [lonely] }))
    useSelectionStore.getState().selectEntities([lonely.id])
    render(<InspectorPanel />)

    expect(screen.getByText('Not connected to anything yet.')).toBeInTheDocument()
  })

  it('connects to a chosen entity — the keyboard and off-screen route', () => {
    const other = createEntity({ name: 'FAR_AWAY' })
    useDiagramStore
      .getState()
      .load(createDiagram({ entities: [createEntity({ name: 'HERE' }), other] }))
    useSelectionStore.getState().selectEntities([diagramNow().entities[0]!.id])
    render(<InspectorPanel />)

    fireEvent.change(screen.getByLabelText('Connect to'), { target: { value: other.id } })

    expect(diagramNow().relationships).toHaveLength(1)
  })

  it('does not offer the entity itself as a target', () => {
    render(<InspectorPanel />)
    const options = within(screen.getByLabelText('Connect to'))
      .getAllByRole('option')
      .map((option) => option.textContent)

    expect(options).not.toContain('CUSTOMER')
    expect(options).toContain('ORDER')
  })

  it('selecting a listed relationship opens its editor', () => {
    render(<InspectorPanel />)
    const lists = screen.getAllByRole('list')

    fireEvent.click(within(lists[1]!).getByText('ORDER'))

    expect(useSelectionStore.getState().selectedRelationshipIds.size).toBe(1)
  })
})

describe('setting a reference also draws the line', () => {
  it('creates the relationship the foreign key implies', () => {
    // The panel used to create only the key, leaving an FK badge with no connector.
    // Two unrelated entities, so there is nothing for it to reuse.
    const parent = createEntity({
      name: 'PARENT',
      attributes: [createAttribute({ name: 'id', isPrimaryKey: true })],
    })
    const child = createEntity({
      name: 'CHILD',
      attributes: [createAttribute({ name: 'parent_id' })],
    })
    useDiagramStore.getState().load(createDiagram({ entities: [parent, child] }))
    useSelectionStore.getState().selectEntities([child.id])
    useSelectionStore.getState().selectAttribute(child.attributes[0]!.id)
    render(<InspectorPanel />)

    fireEvent.change(screen.getByLabelText('References'), { target: { value: parent.id } })

    expect(diagramNow().relationships).toHaveLength(1)
    expect(entityNow('CHILD')?.attributes[0]?.foreignKey?.entityId).toBe(parent.id)
  })

  it('reuses the existing relationship rather than drawing a second one', () => {
    // CUSTOMER and ORDER are already related in the fixture.
    useSelectionStore.getState().selectEntities([f.order.id])
    useSelectionStore.getState().selectAttribute(entityNow('ORDER')!.attributes[0]!.id)
    render(<InspectorPanel />)

    fireEvent.change(screen.getByLabelText('References'), { target: { value: f.customer.id } })

    expect(diagramNow().relationships).toHaveLength(1)
    expect(entityNow('ORDER')?.attributes[0]?.foreignKey?.entityId).toBe(f.customer.id)
  })
})
