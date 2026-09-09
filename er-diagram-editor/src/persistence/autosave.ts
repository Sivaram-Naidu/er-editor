// Autosave scheduling and last-saved timestamp (FR-7.2).

import type { Diagram } from '../domain/model'

import type { DiagramRepository } from './db'

export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

export interface AutosaveState {
  status: SaveStatus
  /** ISO timestamp of the last successful write, for the "saved 2m ago" indicator. */
  lastSavedAt: string | undefined
  error: string | undefined
}

export interface AutosaveOptions {
  repository: DiagramRepository
  /** Debounce window. Long enough to coalesce a burst of typing, short enough to feel safe. */
  delayMs?: number
  onStateChange?: (state: AutosaveState) => void
  now?: () => number
}

const DEFAULT_DELAY_MS = 800

/**
 * Debounced write-behind.
 *
 * Debounced rather than throttled because the cost of a save is bounded and the risk is
 * data loss: what matters is that the LAST edit lands, not that intermediate ones do.
 *
 * Saves are serialised. If an edit arrives while a write is in flight, the newer document
 * is queued rather than written concurrently — two overlapping `put`s on the same key can
 * land out of order and leave older content in the store.
 */
export class Autosaver {
  readonly #repository: DiagramRepository
  readonly #delayMs: number
  readonly #onStateChange: ((state: AutosaveState) => void) | undefined
  readonly #now: () => number

  #timer: ReturnType<typeof setTimeout> | undefined
  #pending: Diagram | undefined
  #inFlight = false
  #state: AutosaveState = { status: 'idle', lastSavedAt: undefined, error: undefined }

  constructor(options: AutosaveOptions) {
    this.#repository = options.repository
    this.#delayMs = options.delayMs ?? DEFAULT_DELAY_MS
    this.#onStateChange = options.onStateChange
    this.#now = options.now ?? ((): number => Date.now())
  }

  get state(): AutosaveState {
    return this.#state
  }

  /** Queue a save. Repeated calls inside the window replace the queued document. */
  schedule(diagram: Diagram): void {
    this.#pending = diagram
    this.#setState({ status: 'pending', error: undefined })

    if (this.#timer !== undefined) clearTimeout(this.#timer)
    this.#timer = setTimeout(() => {
      void this.flush()
    }, this.#delayMs)
  }

  /**
   * Write immediately.
   *
   * Called on explicit save, and on `visibilitychange`/`pagehide` — a debounced save that
   * has not fired yet is lost when the tab closes, which is exactly the moment the user
   * expects their work to be safe.
   */
  async flush(): Promise<void> {
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer)
      this.#timer = undefined
    }

    if (this.#pending === undefined) return

    if (this.#inFlight) {
      // A write is running; leave the newer document queued and let the running write
      // pick it up when it drains.
      return
    }

    this.#inFlight = true

    try {
      // Drains rather than recursing. A save can be queued while `await put` is in
      // flight, so the loop re-reads `#pending` each pass and keeps writing until it is
      // genuinely empty. Serialising this way matters: two overlapping `put`s on the
      // same key can land out of order and leave stale content in storage.
      while (this.#pending !== undefined) {
        const diagram = this.#pending
        this.#pending = undefined
        this.#setState({ status: 'saving' })

        try {
          await this.#repository.put(diagram)
          this.#setState({
            status: 'saved',
            lastSavedAt: new Date(this.#now()).toISOString(),
            error: undefined,
          })
        } catch (error) {
          // Surfaced rather than swallowed. A silent autosave failure is the worst
          // outcome available here — the user keeps working believing their edits are
          // safe (NFR-3.5).
          this.#setState({
            status: 'error',
            error: error instanceof Error ? error.message : 'Save failed',
          })
        }
      }
    } finally {
      this.#inFlight = false
    }
  }

  /** Drop any queued save without writing. Used when discarding a recovered session. */
  cancel(): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer)
    this.#timer = undefined
    this.#pending = undefined
    this.#setState({ status: 'idle' })
  }

  #setState(patch: Partial<AutosaveState>): void {
    this.#state = { ...this.#state, ...patch }
    this.#onStateChange?.(this.#state)
  }
}
