/**
 * @vitest-environment node
 *
 * Zustand stores are plain objects and the repository runs on fake-indexeddb, which is
 * pure JS. Nothing here renders, so there is no DOM to need.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  addEntity,
  createDiagram,
  createEntity,
  deleteEntity,
  renameEntity,
  type EntityId,
  type RelationshipId,
} from '../../../src/domain'
import { lodForZoom } from '../../../src/lib/lod'
import { InMemoryDiagramRepository } from '../../../src/persistence'
import {
  ZOOM_MAX,
  ZOOM_MIN,
  attachAutosave,
  createDiagramStore,
  createSelectionStore,
  createUiStore,
  createViewportStore,
  viewportCenter,
} from '../../../src/store'

describe('diagramStore', () => {
  it('starts clean with an empty history', () => {
    const store = createDiagramStore()

    expect(store.getState().isDirty).toBe(false)
    expect(store.getState().history.canUndo).toBe(false)
  })

  it('routes every mutation through the command stack', () => {
    const store = createDiagramStore()
    store.getState().execute(addEntity(createEntity({ name: 'CUSTOMER' })))

    expect(store.getState().diagram.entities).toHaveLength(1)
    expect(store.getState().history.canUndo).toBe(true)
    expect(store.getState().isDirty).toBe(true)
  })

  it('publishes a new diagram reference on a real change', () => {
    const store = createDiagramStore()
    const before = store.getState().diagram

    store.getState().execute(addEntity(createEntity()))

    expect(store.getState().diagram).not.toBe(before)
  })

  it('publishes the SAME reference for a no-op, so subscribers do not re-render', () => {
    const entity = createEntity({ name: 'CUSTOMER' })
    const store = createDiagramStore({ initial: createDiagram({ entities: [entity] }) })
    const before = store.getState().diagram

    store.getState().execute(renameEntity(entity.id, 'CUSTOMER'))

    expect(store.getState().diagram).toBe(before)
  })

  it('does not notify subscribers for a no-op command', () => {
    const entity = createEntity({ name: 'CUSTOMER' })
    const store = createDiagramStore({ initial: createDiagram({ entities: [entity] }) })
    const listener = vi.fn()
    store.subscribe(listener)

    store.getState().execute(renameEntity(entity.id, 'CUSTOMER'))

    // The command produced no patches, so `isDirty` and `history` are unchanged too.
    expect(listener).not.toHaveBeenCalled()
  })

  it('undo and redo move through history', () => {
    const store = createDiagramStore()
    store.getState().execute(addEntity(createEntity()))
    store.getState().undo()

    expect(store.getState().diagram.entities).toHaveLength(0)
    expect(store.getState().history.canRedo).toBe(true)

    store.getState().redo()
    expect(store.getState().diagram.entities).toHaveLength(1)
  })

  it('load replaces the document and clears history and the dirty flag', () => {
    const store = createDiagramStore()
    store.getState().execute(addEntity(createEntity()))

    store.getState().load(createDiagram({ name: 'Opened' }))

    expect(store.getState().diagram.name).toBe('Opened')
    expect(store.getState().history.canUndo).toBe(false)
    expect(store.getState().isDirty).toBe(false)
  })

  it('markSaveFailed records why, and leaves the document dirty because it is', () => {
    const store = createDiagramStore()
    store.getState().execute(addEntity(createEntity({ name: 'CUSTOMER' })))

    store.getState().markSaveFailed('QuotaExceededError')

    expect(store.getState().saveError).toBe('QuotaExceededError')
    // The edits really are unwritten. Clearing this would say the opposite.
    expect(store.getState().isDirty).toBe(true)
  })

  it('a later successful save clears the error', () => {
    const store = createDiagramStore()
    store.getState().markSaveFailed('Storage is full')

    store.getState().markSaved()

    expect(store.getState().saveError).toBeUndefined()
    expect(store.getState().isDirty).toBe(false)
  })

  it('markSaved clears the dirty flag without touching the document', () => {
    const store = createDiagramStore()
    store.getState().execute(addEntity(createEntity()))
    const diagram = store.getState().diagram

    store.getState().markSaved()

    expect(store.getState().isDirty).toBe(false)
    expect(store.getState().diagram).toBe(diagram)
  })

  it('transaction is one undo step', () => {
    const store = createDiagramStore()
    store.getState().transaction('Import', [addEntity(createEntity()), addEntity(createEntity())])

    expect(store.getState().diagram.entities).toHaveLength(2)
    store.getState().undo()
    expect(store.getState().diagram.entities).toHaveLength(0)
  })

  it('gives each factory instance its own isolated state', () => {
    const first = createDiagramStore()
    const second = createDiagramStore()
    first.getState().execute(addEntity(createEntity()))

    expect(second.getState().diagram.entities).toHaveLength(0)
  })
})

describe('selectionStore', () => {
  let store: ReturnType<typeof createSelectionStore>
  const a = 'ent_a' as EntityId
  const b = 'ent_b' as EntityId
  const r1 = 'rel_1' as RelationshipId

  beforeEach(() => {
    store = createSelectionStore()
  })

  it('replaces the selection by default and extends when additive', () => {
    store.getState().selectEntities([a])
    expect([...store.getState().selectedEntityIds]).toEqual([a])

    store.getState().selectEntities([b])
    expect([...store.getState().selectedEntityIds]).toEqual([b])

    store.getState().selectEntities([a], true)
    expect(store.getState().selectedEntityIds.size).toBe(2)
  })

  it('toggles an entity in and out', () => {
    store.getState().toggleEntity(a)
    expect(store.getState().selectedEntityIds.has(a)).toBe(true)

    store.getState().toggleEntity(a)
    expect(store.getState().selectedEntityIds.has(a)).toBe(false)
  })

  it('selecting a relationship clears an entity selection', () => {
    // The inspector shows one kind of thing at a time; a mixed selection has no
    // coherent property set to edit.
    store.getState().selectEntities([a])
    store.getState().selectRelationships([r1])

    expect(store.getState().selectedEntityIds.size).toBe(0)
    expect(store.getState().selectedRelationshipIds.has(r1)).toBe(true)
  })

  it('does not notify when hover is set to the value it already has', () => {
    // The hot path. Zustand notifies on every `set`, identical value or not, so the
    // guard is what keeps a pointer-move across one connector from waking subscribers
    // dozens of times a second (NFR-1.1).
    store.getState().setHoveredEntity(a)
    const listener = vi.fn()
    store.subscribe(listener)

    store.getState().setHoveredEntity(a)
    store.getState().setHoveredEntity(a)

    expect(listener).not.toHaveBeenCalled()

    store.getState().setHoveredEntity(b)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('reconcile drops references to deleted elements', () => {
    store.getState().selectEntities([a, b])
    store.getState().setHoveredEntity(b)
    store.getState().setPinnedHighlight(r1)

    store.getState().reconcile(new Set([a]), new Set())

    expect([...store.getState().selectedEntityIds]).toEqual([a])
    expect(store.getState().hoveredEntityId).toBeUndefined()
    expect(store.getState().pinnedHighlightRelationshipId).toBeUndefined()
  })

  it('reconcile writes nothing when everything still exists', () => {
    store.getState().selectEntities([a])
    const listener = vi.fn()
    store.subscribe(listener)

    store.getState().reconcile(new Set([a, b]), new Set([r1]))

    expect(listener).not.toHaveBeenCalled()
  })
})

describe('viewportStore', () => {
  it('clamps zoom to the FR-2.1 range', () => {
    const store = createViewportStore()

    store.getState().setZoom(99)
    expect(store.getState().zoom).toBe(ZOOM_MAX)

    store.getState().setZoom(0.001)
    expect(store.getState().zoom).toBe(ZOOM_MIN)
  })

  it('derives the LOD level from zoom', () => {
    const store = createViewportStore()

    store.getState().setZoom(0.2)
    expect(store.getState().lod).toBe(0)

    store.getState().setZoom(0.6)
    expect(store.getState().lod).toBe(1)

    store.getState().setZoom(1.5)
    expect(store.getState().lod).toBe(2)
  })

  it('writes nothing when the viewport did not move', () => {
    const store = createViewportStore()
    store.getState().setViewport({ x: 10, y: 10, zoom: 1 })
    const listener = vi.fn()
    store.subscribe(listener)

    store.getState().setViewport({ x: 10, y: 10, zoom: 1 })

    expect(listener).not.toHaveBeenCalled()
  })

  it('holds a toolbar override independently of zoom', () => {
    const store = createViewportStore()
    store.getState().setZoom(0.2)
    store.getState().setLodOverride(2)

    expect(store.getState().lod).toBe(0)
    expect(store.getState().lodOverride).toBe(2)
  })

  it('starts with no measured pane, so nothing can place from a guess', () => {
    const store = createViewportStore()

    expect(store.getState().paneWidth).toBe(0)
    expect(store.getState().paneHeight).toBe(0)
    expect(viewportCenter(store.getState())).toBeUndefined()
  })

  it('records the pane size the renderer reports', () => {
    const store = createViewportStore()

    store.getState().setPaneSize({ width: 1200, height: 800 })

    expect(viewportCenter(store.getState())).toEqual({ x: 600, y: 400 })
  })

  it('writes nothing when the pane size did not change', () => {
    // A window resize settles through several identical values, and every write here
    // notifies every subscriber.
    const store = createViewportStore()
    store.getState().setPaneSize({ width: 1200, height: 800 })
    const listener = vi.fn()
    store.subscribe(listener)

    store.getState().setPaneSize({ width: 1200, height: 800 })

    expect(listener).not.toHaveBeenCalled()
  })
})

describe('LOD hysteresis (ADR-0004)', () => {
  it('maps zoom to a level on a cold read', () => {
    expect(lodForZoom(0.3)).toBe(0)
    expect(lodForZoom(0.4)).toBe(1)
    expect(lodForZoom(0.9)).toBe(2)
  })

  it('gains detail at the nominal threshold', () => {
    expect(lodForZoom(0.4, 0)).toBe(1)
    expect(lodForZoom(0.9, 1)).toBe(2)
  })

  it('holds the higher level slightly below the threshold', () => {
    // The deadband: at 0.87 a level-2 view stays at 2, while a level-1 view stays at 1.
    expect(lodForZoom(0.87, 2)).toBe(2)
    expect(lodForZoom(0.87, 1)).toBe(1)
  })

  it('does not flicker when zoom oscillates around a boundary', () => {
    let level = lodForZoom(0.92)
    const seen = new Set([level])

    for (const zoom of [0.89, 0.91, 0.88, 0.92, 0.87, 0.9]) {
      level = lodForZoom(zoom, level)
      seen.add(level)
    }

    // Without hysteresis this sequence would toggle between 1 and 2 six times.
    expect([...seen]).toEqual([2])
  })

  it('still drops the level on a decisive zoom out', () => {
    expect(lodForZoom(0.5, 2)).toBe(1)
    expect(lodForZoom(0.1, 2)).toBe(0)
  })
})

describe('uiStore', () => {
  it('toggles panels', () => {
    const store = createUiStore()
    const before = store.getState().inspectorOpen

    store.getState().toggleInspector()

    expect(store.getState().inspectorOpen).toBe(!before)
  })

  it('opens and closes dialogs', () => {
    const store = createUiStore()
    store.getState().openDialog('export')
    expect(store.getState().activeDialog).toBe('export')

    store.getState().closeDialog()
    expect(store.getState().activeDialog).toBeUndefined()
  })

  it('defaults to compact notation (SRS §2.2)', () => {
    expect(createUiStore().getState().notation).toBe('compact')
  })
})

describe('attachAutosave', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('persists edits after the debounce and clears the dirty flag', async () => {
    const repository = new InMemoryDiagramRepository()
    const store = createDiagramStore()
    const handle = attachAutosave({ store, repository, delayMs: 10 })

    store.getState().execute(addEntity(createEntity({ name: 'CUSTOMER' })))
    await vi.advanceTimersByTimeAsync(50)

    const saved = await repository.get(store.getState().diagram.id)
    expect(saved?.entities).toHaveLength(1)
    expect(store.getState().isDirty).toBe(false)

    await handle.detach()
  })

  it('surfaces a failed write rather than leaving the indicator mid-save', async () => {
    // The failure mode this guards: a save that never lands looks exactly like a save
    // still in flight, so the user keeps typing into something that is not storing it.
    const repository = new InMemoryDiagramRepository()
    vi.spyOn(repository, 'put').mockRejectedValue(new Error('QuotaExceededError'))

    const store = createDiagramStore()
    const handle = attachAutosave({ store, repository, delayMs: 10 })

    store.getState().execute(addEntity(createEntity({ name: 'CUSTOMER' })))
    await vi.advanceTimersByTimeAsync(50)

    expect(store.getState().saveError).toBe('QuotaExceededError')
    expect(store.getState().isDirty).toBe(true)

    await handle.detach()
  })

  it('does not write when nothing changed', async () => {
    const entity = createEntity({ name: 'CUSTOMER' })
    const repository = new InMemoryDiagramRepository()
    const store = createDiagramStore({ initial: createDiagram({ entities: [entity] }) })
    const handle = attachAutosave({ store, repository, delayMs: 10 })

    store.getState().execute(renameEntity(entity.id, 'CUSTOMER'))
    await vi.advanceTimersByTimeAsync(50)

    expect(await repository.list()).toHaveLength(0)
    await handle.detach()
  })

  it('persists the post-undo state', async () => {
    const repository = new InMemoryDiagramRepository()
    const store = createDiagramStore()
    const handle = attachAutosave({ store, repository, delayMs: 10 })

    store.getState().execute(addEntity(createEntity()))
    await vi.advanceTimersByTimeAsync(50)
    store.getState().undo()
    await vi.advanceTimersByTimeAsync(50)

    expect((await repository.get(store.getState().diagram.id))?.entities).toHaveLength(0)
    await handle.detach()
  })

  it('detach flushes anything still queued', async () => {
    const repository = new InMemoryDiagramRepository()
    const store = createDiagramStore()
    const handle = attachAutosave({ store, repository, delayMs: 10_000 })

    store.getState().execute(addEntity(createEntity()))
    await handle.detach()

    expect(await repository.list()).toHaveLength(1)
  })

  it('stops writing after detach', async () => {
    const repository = new InMemoryDiagramRepository()
    const store = createDiagramStore()
    const handle = attachAutosave({ store, repository, delayMs: 10 })
    await handle.detach()

    store.getState().execute(addEntity(createEntity()))
    await vi.advanceTimersByTimeAsync(100)

    expect(await repository.list()).toHaveLength(0)
  })
})

describe('store integration', () => {
  it('a cascade delete keeps selection and persistence consistent', async () => {
    vi.useFakeTimers()
    const entity = createEntity({ name: 'CUSTOMER' })
    const repository = new InMemoryDiagramRepository()
    const diagramStore = createDiagramStore({ initial: createDiagram({ entities: [entity] }) })
    const selection = createSelectionStore()
    const handle = attachAutosave({ store: diagramStore, repository, delayMs: 10 })

    selection.getState().selectEntities([entity.id])
    diagramStore.getState().execute(deleteEntity(entity.id))

    const surviving = new Set(diagramStore.getState().diagram.entities.map((e) => e.id))
    selection.getState().reconcile(surviving, new Set())
    await vi.advanceTimersByTimeAsync(50)

    expect(selection.getState().selectedEntityIds.size).toBe(0)
    expect((await repository.get(diagramStore.getState().diagram.id))?.entities).toHaveLength(0)

    await handle.detach()
  })
})
