import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createDiagram, createEntity, type DiagramId } from '../../../src/domain'
import type { DiagramRepository } from '../../../src/persistence'

/**
 * The behaviour every `DiagramRepository` must exhibit, run against each implementation.
 *
 * Written once and shared deliberately. The in-memory repository is not a mock — it is a
 * real fallback used when IndexedDB is blocked (private browsing, sandboxed origins), so
 * the two implementations have to agree. A suite that only exercised one would let them
 * drift, and the drift would only appear for the users least able to report it.
 */
export function describeRepositoryContract(
  name: string,
  create: () => DiagramRepository,
  teardown?: (repository: DiagramRepository) => Promise<void>,
): void {
  describe(`DiagramRepository contract: ${name}`, () => {
    let repository: DiagramRepository

    beforeEach(() => {
      repository = create()
    })

    afterEach(async () => {
      await teardown?.(repository)
    })

    it('round-trips a diagram', async () => {
      const diagram = createDiagram({
        name: 'Shop',
        entities: [createEntity({ name: 'CUSTOMER' })],
      })
      await repository.put(diagram)

      expect(await repository.get(diagram.id)).toEqual(diagram)
    })

    it('returns undefined for an unknown id', async () => {
      expect(await repository.get('dgm_nope' as DiagramId)).toBeUndefined()
    })

    it('starts empty', async () => {
      expect(await repository.list()).toEqual([])
    })

    it('lists summaries newest first', async () => {
      await repository.put({
        ...createDiagram({ name: 'Old' }),
        updatedAt: '2026-01-01T00:00:00.000Z',
      })
      await repository.put({
        ...createDiagram({ name: 'New' }),
        updatedAt: '2026-06-01T00:00:00.000Z',
      })

      expect((await repository.list()).map((summary) => summary.name)).toEqual(['New', 'Old'])
    })

    it('returns summaries, not whole documents', async () => {
      await repository.put(createDiagram({ entities: [createEntity({ name: 'A' })] }))
      const [summary] = await repository.list()

      expect(Object.keys(summary ?? {}).sort()).toEqual(['id', 'name', 'updatedAt'])
    })

    it('overwrites on repeated put rather than appending', async () => {
      const diagram = createDiagram({ name: 'First' })
      await repository.put(diagram)
      await repository.put({ ...diagram, name: 'Second' })

      expect((await repository.get(diagram.id))?.name).toBe('Second')
      expect(await repository.list()).toHaveLength(1)
    })

    it('removes', async () => {
      const diagram = createDiagram()
      await repository.put(diagram)
      await repository.remove(diagram.id)

      expect(await repository.get(diagram.id)).toBeUndefined()
      expect(await repository.list()).toHaveLength(0)
    })

    it('removing an unknown id is not an error', async () => {
      await expect(repository.remove('dgm_nope' as DiagramId)).resolves.toBeUndefined()
    })

    it('rejects a stored document that no longer validates', async () => {
      // Corruption between writes is real: a crashed write, a quota eviction, or a row
      // written by an older build. Reads are validated rather than trusted (NFR-7.2).
      const diagram = createDiagram()
      await repository.put({ ...diagram, entities: [{ id: '' }] as never })

      expect(await repository.get(diagram.id)).toBeUndefined()
    })

    it('preserves a diagram with layout, relationships and foreign keys intact', async () => {
      const pk = { ...createEntity({ name: 'CUSTOMER' }) }
      const diagram = {
        ...createDiagram({ name: 'Full', entities: [pk] }),
        layout: { positions: { [pk.id]: { x: 12, y: 34 } }, pinned: [pk.id] },
      }
      await repository.put(diagram)

      const loaded = await repository.get(diagram.id)
      expect(loaded?.layout.positions[pk.id]).toEqual({ x: 12, y: 34 })
      expect(loaded?.layout.pinned).toEqual([pk.id])
    })

    it('stores and reads preferences', async () => {
      await repository.setPreference('theme', 'dark')

      expect(await repository.getPreference<string>('theme')).toBe('dark')
    })

    it('returns undefined for an unset preference', async () => {
      expect(await repository.getPreference('missing')).toBeUndefined()
    })

    it('overwrites a preference', async () => {
      await repository.setPreference('theme', 'dark')
      await repository.setPreference('theme', 'light')

      expect(await repository.getPreference<string>('theme')).toBe('light')
    })

    it('stores a structured preference value', async () => {
      await repository.setPreference('viewport', { x: 1, y: 2, zoom: 1.5 })

      expect(await repository.getPreference('viewport')).toEqual({ x: 1, y: 2, zoom: 1.5 })
    })
  })
}
