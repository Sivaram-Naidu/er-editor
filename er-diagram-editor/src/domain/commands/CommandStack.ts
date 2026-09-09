// History, transactions and drag coalescing. Min 100 steps (FR-7.1).

import { applyPatches, enablePatches, produceWithPatches, type Patch } from 'immer'

import type { Diagram } from '../model/types'

import type { Command } from './Command'

// Immer ships the patches plugin opt-in: `produceWithPatches` throws at runtime, not
// compile time, until this is called. Enabling it here rather than in an app entry point
// keeps the domain layer self-contained — it must work under plain Node with no bootstrap
// (NFR-6.1) — and `enablePatches` is idempotent, so repeat calls are harmless.
enablePatches()

export interface HistoryEntry {
  readonly label: string
  readonly patches: readonly Patch[]
  readonly inversePatches: readonly Patch[]
  readonly coalesceKey: string | undefined
  readonly at: number
}

export interface CommandStackOptions {
  /** FR-7.1 requires a minimum of 100. */
  limit?: number
  /** Consecutive same-key commands closer together than this merge. */
  coalesceWindowMs?: number
  /** Injectable clock, for deterministic tests. */
  now?: () => number
}

export interface CommandStackSnapshot {
  canUndo: boolean
  canRedo: boolean
  undoLabel: string | undefined
  redoLabel: string | undefined
  depth: number
}

const DEFAULT_LIMIT = 100
const DEFAULT_COALESCE_WINDOW_MS = 500

/**
 * The single write path for the diagram.
 *
 * Nothing else may produce a new Diagram. That is what makes undo total rather than
 * best-effort: a mutation that bypassed the stack would leave a gap in the history that
 * undo would silently skip, restoring a state the user never saw.
 */
export class CommandStack {
  #state: Diagram
  readonly #undo: HistoryEntry[] = []
  readonly #redo: HistoryEntry[] = []
  readonly #limit: number
  readonly #coalesceWindowMs: number
  readonly #now: () => number

  constructor(initial: Diagram, options: CommandStackOptions = {}) {
    this.#state = initial
    this.#limit = Math.max(1, options.limit ?? DEFAULT_LIMIT)
    this.#coalesceWindowMs = options.coalesceWindowMs ?? DEFAULT_COALESCE_WINDOW_MS
    this.#now = options.now ?? ((): number => Date.now())
  }

  get state(): Diagram {
    return this.#state
  }

  get canUndo(): boolean {
    return this.#undo.length > 0
  }

  get canRedo(): boolean {
    return this.#redo.length > 0
  }

  /** Depth of the undo history, after coalescing and trimming. */
  get depth(): number {
    return this.#undo.length
  }

  snapshot(): CommandStackSnapshot {
    return {
      canUndo: this.canUndo,
      canRedo: this.canRedo,
      undoLabel: this.#undo.at(-1)?.label,
      redoLabel: this.#redo.at(-1)?.label,
      depth: this.#undo.length,
    }
  }

  /** Run one command and record it. */
  execute(command: Command): Diagram {
    return this.#run(command.label, command.coalesceKey, (draft) => {
      command.mutate(draft)
    })
  }

  /**
   * Run several commands as ONE undo step (FR-7.1: "compound operations — auto-layout,
   * cascade delete, import — undo as one step").
   *
   * An empty list records nothing, so a cascade that turned out to have nothing to
   * cascade does not leave a dead entry the user has to undo twice.
   */
  transaction(label: string, commands: readonly Command[]): Diagram {
    if (commands.length === 0) return this.#state

    return this.#run(label, undefined, (draft) => {
      for (const command of commands) command.mutate(draft)
    })
  }

  undo(): Diagram {
    const entry = this.#undo.pop()
    if (entry === undefined) return this.#state

    this.#state = applyPatches(this.#state, entry.inversePatches as Patch[])
    this.#redo.push(entry)
    return this.#state
  }

  redo(): Diagram {
    const entry = this.#redo.pop()
    if (entry === undefined) return this.#state

    this.#state = applyPatches(this.#state, entry.patches as Patch[])
    this.#undo.push(entry)
    return this.#state
  }

  /**
   * Replace the document wholesale — opening a file, or creating a new one.
   *
   * History is discarded rather than preserved. Undoing across a file open would
   * restore a diagram the user is no longer looking at, which is worse than not
   * offering the undo at all.
   */
  reset(diagram: Diagram): Diagram {
    this.#state = diagram
    this.#undo.length = 0
    this.#redo.length = 0
    return this.#state
  }

  /** Drop history but keep the current document. */
  clearHistory(): void {
    this.#undo.length = 0
    this.#redo.length = 0
  }

  // ── internals ──────────────────────────────────────────────────────────────

  #run(label: string, coalesceKey: string | undefined, mutate: (draft: Diagram) => void): Diagram {
    const [next, patches, inversePatches] = produceWithPatches(this.#state, (draft) => {
      mutate(draft)
      // Stamped centrally rather than in each command, so no command can forget it, and
      // because it belongs to the act of editing rather than to any particular edit.
      // It is part of the patch set, so undo restores the previous value too.
      draft.updatedAt = new Date(this.#now()).toISOString()
    })

    // A command that changed nothing records nothing. Without this, toggling a checkbox
    // twice, or dropping an entity exactly where it started, would leave undo steps that
    // appear to do nothing when triggered.
    //
    // The test is "did anything OTHER than the timestamp change", not "how many patches
    // are there". Counting was tried and is wrong in both directions: the updatedAt stamp
    // emits no patch when the clock has not moved since the last edit, so a real change
    // could be mistaken for a no-op.
    const changedSomething = patches.some((patch) => patch.path[0] !== 'updatedAt')
    if (!changedSomething) return this.#state

    this.#state = next
    this.#redo.length = 0

    const at = this.#now()
    const previous = this.#undo.at(-1)
    const canCoalesce =
      previous !== undefined &&
      coalesceKey !== undefined &&
      previous.coalesceKey === coalesceKey &&
      at - previous.at <= this.#coalesceWindowMs

    if (canCoalesce) {
      // Forward patches replay oldest-first; inverse patches must replay newest-first,
      // so the merged inverse is the NEW one followed by the OLD one.
      this.#undo[this.#undo.length - 1] = {
        label: previous.label,
        patches: [...previous.patches, ...patches],
        inversePatches: [...inversePatches, ...previous.inversePatches],
        coalesceKey,
        at,
      }
      return this.#state
    }

    this.#undo.push({ label, patches, inversePatches, coalesceKey, at })

    // Trim from the oldest end. Discarded entries are unreachable rather than corrupt:
    // `#state` is already the post-edit document, so dropping old inverse patches only
    // shortens how far back the user can travel.
    while (this.#undo.length > this.#limit) this.#undo.shift()

    return this.#state
  }
}
