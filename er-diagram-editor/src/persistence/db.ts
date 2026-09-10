// Dexie schema: diagrams, snapshots, preferences.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THERE IS AN INTERFACE IN FRONT OF DEXIE
// ─────────────────────────────────────────────────────────────────────────────
//
// `DiagramRepository` exists for the same reason `LayoutEngine` does (ADR-0002): the
// storage backend is the part of V1 most likely to change. SRS §9 puts a backend in V3,
// and at that point "save" becomes an HTTP call — with this seam that is a new
// implementation of one interface, not a rewrite of the store.
//
// It also makes persistence testable without IndexedDB. `InMemoryDiagramRepository`
// below is a real implementation, not a mock, so the tests exercise the same contract
// the Dexie version has to satisfy.
//
// NOTE ON localStorage: not used, deliberately. It caps around 5 MB, is synchronous —
// so it blocks the main thread and breaks NFR-1.3's 100 ms interaction budget — and
// stores strings only. The reference schema plus a 100-step history plus several saved
// diagrams exceeds that comfortably.

import Dexie, { type EntityTable } from 'dexie'

import { DiagramSchema, type Diagram, type DiagramId } from '../domain/model'

/** Row shape. The full document is stored as one blob; only lookup fields are indexed. */
export interface DiagramRecord {
  id: string
  name: string
  updatedAt: string
  formatVersion: number
  /** The complete diagram. Structured-cloned by IndexedDB, so no JSON round-trip. */
  document: Diagram
}

/** What the diagram-manager list needs, without loading every document (FR-7.5). */
export interface DiagramSummary {
  id: DiagramId
  name: string
  updatedAt: string
}

export interface PreferenceRecord {
  key: string
  value: unknown
}

export interface DiagramRepository {
  list(): Promise<DiagramSummary[]>
  get(id: DiagramId): Promise<Diagram | undefined>
  put(diagram: Diagram): Promise<void>
  remove(id: DiagramId): Promise<void>
  getPreference<T>(key: string): Promise<T | undefined>
  setPreference(key: string, value: unknown): Promise<void>
}

export const LAST_OPENED_KEY = 'lastOpenedDiagramId'
/** Preference key for the light/dark/system choice (FR-9.3). */
export const THEME_KEY = 'theme'

function toRecord(diagram: Diagram): DiagramRecord {
  return {
    id: diagram.id,
    name: diagram.name,
    updatedAt: diagram.updatedAt,
    formatVersion: diagram.formatVersion,
    document: diagram,
  }
}

function toSummary(record: DiagramRecord): DiagramSummary {
  return { id: record.id as DiagramId, name: record.name, updatedAt: record.updatedAt }
}

// ─────────────────────────────────────────────────────────────────────────────
// Dexie implementation
// ─────────────────────────────────────────────────────────────────────────────

class ErdDatabase extends Dexie {
  declare diagrams: EntityTable<DiagramRecord, 'id'>
  declare preferences: EntityTable<PreferenceRecord, 'key'>

  constructor(name: string) {
    super(name)
    // Only indexed fields are listed; `document` is stored but not indexed. Bump the
    // version and add a `.upgrade()` when this changes — separate from the document's
    // own `formatVersion`, which versions the CONTENT rather than the table layout.
    this.version(1).stores({
      diagrams: 'id, updatedAt, name',
      preferences: 'key',
    })
  }
}

export class DexieDiagramRepository implements DiagramRepository {
  readonly #db: ErdDatabase

  constructor(databaseName = 'er-diagram-editor') {
    this.#db = new ErdDatabase(databaseName)
  }

  async list(): Promise<DiagramSummary[]> {
    const records = await this.#db.diagrams.orderBy('updatedAt').reverse().toArray()
    return records.map(toSummary)
  }

  async get(id: DiagramId): Promise<Diagram | undefined> {
    const record = await this.#db.diagrams.get(id)
    if (record === undefined) return undefined

    // Re-validated on the way out, not trusted. A document can be corrupted between
    // writes by a browser crash, a quota eviction, or a hand-edited import (NFR-7.2).
    const parsed = DiagramSchema.safeParse(record.document)
    return parsed.success ? parsed.data : undefined
  }

  async put(diagram: Diagram): Promise<void> {
    await this.#db.diagrams.put(toRecord(diagram))
  }

  async remove(id: DiagramId): Promise<void> {
    await this.#db.diagrams.delete(id)
  }

  async getPreference<T>(key: string): Promise<T | undefined> {
    const record = await this.#db.preferences.get(key)
    return record?.value as T | undefined
  }

  async setPreference(key: string, value: unknown): Promise<void> {
    await this.#db.preferences.put({ key, value })
  }

  /** Test/reset hook — wipes everything. Exposed for the "start fresh" path (FR-7.3). */
  async clear(): Promise<void> {
    await this.#db.diagrams.clear()
    await this.#db.preferences.clear()
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// In-memory implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A real implementation, not a mock.
 *
 * Used by tests, and as the fallback when IndexedDB is unavailable — private browsing in
 * some browsers, or a blocked storage origin. In that case the app still works for the
 * session; it just cannot recover after a reload, which the UI should say plainly rather
 * than pretending a save succeeded.
 */
export class InMemoryDiagramRepository implements DiagramRepository {
  readonly #diagrams = new Map<string, DiagramRecord>()
  readonly #preferences = new Map<string, unknown>()

  list(): Promise<DiagramSummary[]> {
    const records = [...this.#diagrams.values()].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    )
    return Promise.resolve(records.map(toSummary))
  }

  get(id: DiagramId): Promise<Diagram | undefined> {
    const record = this.#diagrams.get(id)
    if (record === undefined) return Promise.resolve(undefined)

    const parsed = DiagramSchema.safeParse(record.document)
    return Promise.resolve(parsed.success ? parsed.data : undefined)
  }

  put(diagram: Diagram): Promise<void> {
    this.#diagrams.set(diagram.id, toRecord(diagram))
    return Promise.resolve()
  }

  remove(id: DiagramId): Promise<void> {
    this.#diagrams.delete(id)
    return Promise.resolve()
  }

  getPreference<T>(key: string): Promise<T | undefined> {
    return Promise.resolve(this.#preferences.get(key) as T | undefined)
  }

  setPreference(key: string, value: unknown): Promise<void> {
    this.#preferences.set(key, value)
    return Promise.resolve()
  }

  clear(): Promise<void> {
    this.#diagrams.clear()
    this.#preferences.clear()
    return Promise.resolve()
  }
}

/** True when IndexedDB is usable in this context. */
export function hasIndexedDb(): boolean {
  try {
    return typeof globalThis.indexedDB !== 'undefined'
  } catch {
    // Accessing indexedDB throws outright in some sandboxed iframes.
    return false
  }
}

/** Pick the best repository available. */
export function createRepository(databaseName?: string): DiagramRepository {
  return hasIndexedDb() ? new DexieDiagramRepository(databaseName) : new InMemoryDiagramRepository()
}

let shared: DiagramRepository | undefined

/**
 * The application's repository.
 *
 * A singleton because the autosaver and the diagram menu must read and write the same
 * store. Two Dexie instances over one database would work; two *in-memory* instances
 * would silently diverge, and that is the fallback path where a bug would be hardest to
 * notice.
 */
export function sharedRepository(): DiagramRepository {
  shared ??= createRepository()
  return shared
}

/** Test hook: drop the singleton so the next call builds a fresh one. */
export function resetSharedRepository(next?: DiagramRepository): void {
  shared = next
}
