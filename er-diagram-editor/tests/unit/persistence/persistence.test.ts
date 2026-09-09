/**
 * @vitest-environment node
 *
 * No DOM here. Spinning up jsdom per file costs about a second each and this suite has
 * nothing to render — the domain layer is deliberately Node-testable (NFR-6.1).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createDiagram, createEntity, type Diagram } from '../../../src/domain'
import {
  Autosaver,
  InMemoryDiagramRepository,
  LAST_OPENED_KEY,
  parseDiagramDocument,
  recoverLastSession,
  rememberLastOpened,
  type DiagramRepository,
} from '../../../src/persistence'

// Repository behaviour itself lives in repository.test.ts, which runs one shared contract
// against both implementations. This file covers what sits on top: debouncing, recovery
// and document parsing.

/** A repository that fails on demand, for the error paths. */
class FlakyRepository extends InMemoryDiagramRepository {
  shouldFail = false
  putCount = 0

  override async put(diagram: Diagram): Promise<void> {
    this.putCount += 1
    if (this.shouldFail) throw new Error('QuotaExceededError')
    await super.put(diagram)
  }
}

describe('Autosaver', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('debounces a burst into a single write', async () => {
    const repository = new FlakyRepository()
    const autosaver = new Autosaver({ repository, delayMs: 100 })
    const diagram = createDiagram()

    for (let index = 0; index < 10; index += 1) {
      autosaver.schedule({ ...diagram, name: `v${String(index)}` })
      await vi.advanceTimersByTimeAsync(10)
    }
    await vi.advanceTimersByTimeAsync(200)

    expect(repository.putCount).toBe(1)
    expect((await repository.get(diagram.id))?.name).toBe('v9')
  })

  it('reports status transitions', async () => {
    const seen: string[] = []
    const repository = new InMemoryDiagramRepository()
    const autosaver = new Autosaver({
      repository,
      delayMs: 10,
      onStateChange: (state) => seen.push(state.status),
    })

    autosaver.schedule(createDiagram())
    await vi.advanceTimersByTimeAsync(50)

    expect(seen).toEqual(['pending', 'saving', 'saved'])
  })

  it('records lastSavedAt', async () => {
    const repository = new InMemoryDiagramRepository()
    const autosaver = new Autosaver({
      repository,
      delayMs: 10,
      now: () => Date.parse('2026-03-01T12:00:00.000Z'),
    })

    autosaver.schedule(createDiagram())
    await vi.advanceTimersByTimeAsync(50)

    expect(autosaver.state.lastSavedAt).toBe('2026-03-01T12:00:00.000Z')
  })

  it('flush writes immediately without waiting for the debounce', async () => {
    const repository = new FlakyRepository()
    const autosaver = new Autosaver({ repository, delayMs: 10_000 })

    autosaver.schedule(createDiagram())
    await autosaver.flush()

    expect(repository.putCount).toBe(1)
  })

  it('flush is a no-op with nothing queued', async () => {
    const repository = new FlakyRepository()
    const autosaver = new Autosaver({ repository })

    await autosaver.flush()

    expect(repository.putCount).toBe(0)
  })

  it('cancel discards the queued write', async () => {
    const repository = new FlakyRepository()
    const autosaver = new Autosaver({ repository, delayMs: 10 })

    autosaver.schedule(createDiagram())
    autosaver.cancel()
    await vi.advanceTimersByTimeAsync(100)

    expect(repository.putCount).toBe(0)
    expect(autosaver.state.status).toBe('idle')
  })

  it('surfaces a failure rather than swallowing it', async () => {
    const repository = new FlakyRepository()
    repository.shouldFail = true
    const autosaver = new Autosaver({ repository, delayMs: 10 })

    autosaver.schedule(createDiagram())
    await vi.advanceTimersByTimeAsync(50)

    // A silent autosave failure is the worst outcome available: the user keeps working
    // believing their edits are safe (NFR-3.5).
    expect(autosaver.state.status).toBe('error')
    expect(autosaver.state.error).toContain('Quota')
  })

  it('recovers on the next save after a failure', async () => {
    const repository = new FlakyRepository()
    repository.shouldFail = true
    const autosaver = new Autosaver({ repository, delayMs: 10 })
    const diagram = createDiagram()

    autosaver.schedule(diagram)
    await vi.advanceTimersByTimeAsync(50)
    repository.shouldFail = false
    autosaver.schedule({ ...diagram, name: 'retry' })
    await vi.advanceTimersByTimeAsync(50)

    expect(autosaver.state.status).toBe('saved')
    expect((await repository.get(diagram.id))?.name).toBe('retry')
  })

  it('serialises writes and lands the newest document last', async () => {
    // Two overlapping puts on the same key can complete out of order and leave stale
    // content behind, so a save queued mid-write must drain after it, not race it.
    const order: string[] = []
    let release: (() => void) | undefined

    const repository: DiagramRepository = {
      put: async (diagram: Diagram) => {
        order.push(`start:${diagram.name}`)
        if (diagram.name === 'first') {
          await new Promise<void>((resolve) => {
            release = resolve
          })
        }
        order.push(`end:${diagram.name}`)
      },
      list: () => Promise.resolve([]),
      get: () => Promise.resolve(undefined),
      remove: () => Promise.resolve(),
      getPreference: () => Promise.resolve(undefined),
      setPreference: () => Promise.resolve(),
    }

    const autosaver = new Autosaver({ repository, delayMs: 1 })
    const base = createDiagram()

    autosaver.schedule({ ...base, name: 'first' })
    await vi.advanceTimersByTimeAsync(5)

    autosaver.schedule({ ...base, name: 'second' })
    await vi.advanceTimersByTimeAsync(5)

    release?.()
    await vi.advanceTimersByTimeAsync(5)

    expect(order).toEqual(['start:first', 'end:first', 'start:second', 'end:second'])
  })
})

describe('recovery', () => {
  it('restores the last opened diagram', async () => {
    const repository = new InMemoryDiagramRepository()
    const diagram = createDiagram({ name: 'Session' })
    await repository.put(diagram)
    await rememberLastOpened(repository, diagram.id)

    const result = await recoverLastSession(repository)

    expect(result.diagram?.name).toBe('Session')
    expect(result.problem).toBeUndefined()
  })

  it('returns nothing on a first run', async () => {
    const result = await recoverLastSession(new InMemoryDiagramRepository())

    expect(result.diagram).toBeUndefined()
    expect(result.problem).toBeUndefined()
  })

  it('explains a corrupt autosave instead of throwing', async () => {
    // FR-7.3 requires an explicit "discard and start new" path — which the user can only
    // reach if the app boots far enough to offer it.
    const repository = new InMemoryDiagramRepository()
    await repository.setPreference(LAST_OPENED_KEY, 'dgm_missing')

    const result = await recoverLastSession(repository)

    expect(result.diagram).toBeUndefined()
    expect(result.problem).toContain('could not be read')
  })

  it('reports storage failures rather than propagating them', async () => {
    const repository: DiagramRepository = {
      list: () => Promise.reject(new Error('nope')),
      get: () => Promise.reject(new Error('nope')),
      put: () => Promise.reject(new Error('nope')),
      remove: () => Promise.reject(new Error('nope')),
      getPreference: () => Promise.reject(new Error('Storage disabled')),
      setPreference: () => Promise.reject(new Error('nope')),
    }

    const result = await recoverLastSession(repository)

    expect(result.problem).toBe('Storage disabled')
  })
})

describe('parseDiagramDocument', () => {
  it('accepts a valid document', () => {
    const diagram = createDiagram({ entities: [createEntity({ name: 'A' })] })
    const result = parseDiagramDocument(JSON.parse(JSON.stringify(diagram)))

    expect(result.ok).toBe(true)
  })

  it('reports where an invalid document went wrong', () => {
    const result = parseDiagramDocument({ id: 'dgm_1', entities: [{ name: 'no id' }] })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.problem).toContain('entities.0.id')
  })

  it('rejects a non-object', () => {
    expect(parseDiagramDocument('not a diagram').ok).toBe(false)
    expect(parseDiagramDocument(null).ok).toBe(false)
  })
})
