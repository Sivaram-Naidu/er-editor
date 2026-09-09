/**
 * @vitest-environment node
 *
 * No DOM here. Spinning up jsdom per file costs about a second each and this suite has
 * nothing to render — the domain layer is deliberately Node-testable (NFR-6.1).
 */
import { describe, expect, it } from 'vitest'

import { createDiagram } from '../../../src/domain'
import {
  DexieDiagramRepository,
  InMemoryDiagramRepository,
  createRepository,
  hasIndexedDb,
} from '../../../src/persistence'

import { describeRepositoryContract } from './repository-contract'

// Both implementations run the same suite. See the note in repository-contract.ts.
describeRepositoryContract('InMemoryDiagramRepository', () => new InMemoryDiagramRepository())

let databaseCounter = 0
describeRepositoryContract(
  'DexieDiagramRepository',
  // A fresh database per case. fake-indexeddb persists for the module lifetime, so a
  // shared name would leak rows between tests and make them order-dependent.
  () => new DexieDiagramRepository(`erd-test-${String((databaseCounter += 1))}`),
  async (repository) => {
    await (repository as DexieDiagramRepository).clear()
  },
)

describe('repository selection', () => {
  it('detects IndexedDB when present', () => {
    // Provided by fake-indexeddb/auto in tests/setup.ts, and by the browser in production.
    expect(hasIndexedDb()).toBe(true)
  })

  it('picks Dexie when IndexedDB is available', () => {
    expect(createRepository('erd-test-selection')).toBeInstanceOf(DexieDiagramRepository)
  })

  it('falls back to in-memory when IndexedDB is missing', async () => {
    const original = globalThis.indexedDB
    // @ts-expect-error — deliberately removing a global to simulate a blocked origin.
    delete globalThis.indexedDB

    try {
      const repository = createRepository()
      expect(repository).toBeInstanceOf(InMemoryDiagramRepository)

      // The fallback must actually work: the session keeps functioning, it just cannot
      // survive a reload.
      const diagram = createDiagram({ name: 'Fallback' })
      await repository.put(diagram)
      expect((await repository.get(diagram.id))?.name).toBe('Fallback')
    } finally {
      globalThis.indexedDB = original
    }
  })
})

describe('DexieDiagramRepository specifics', () => {
  it('survives being reopened, which is the whole point of it', async () => {
    // The in-memory fallback cannot do this. Reopening the same database name and
    // finding the document is the behaviour FR-7.3 recovery depends on.
    const name = 'erd-test-persistence'
    const first = new DexieDiagramRepository(name)
    const diagram = createDiagram({ name: 'Persisted' })
    await first.put(diagram)
    await first.setPreference('lastOpenedDiagramId', diagram.id)

    const second = new DexieDiagramRepository(name)

    expect((await second.get(diagram.id))?.name).toBe('Persisted')
    expect(await second.getPreference('lastOpenedDiagramId')).toBe(diagram.id)

    await second.clear()
  })

  it('clear empties both tables', async () => {
    const repository = new DexieDiagramRepository('erd-test-clear')
    await repository.put(createDiagram())
    await repository.setPreference('theme', 'dark')

    await repository.clear()

    expect(await repository.list()).toHaveLength(0)
    expect(await repository.getPreference('theme')).toBeUndefined()
  })
})
