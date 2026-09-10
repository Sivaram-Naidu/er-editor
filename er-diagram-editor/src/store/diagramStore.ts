// Model state. Every mutation goes through CommandStack.
//
// The store is deliberately thin. It owns no editing logic: it holds the current
// document, forwards commands to the stack, and republishes the result. All the actual
// rules live in `src/domain`, where they are testable without React.
//
// The CommandStack instance is held OUTSIDE the Zustand state, in a closure. It is a
// mutable object with private fields; putting it in state would mean Zustand comparing
// a reference that never changes, and would tempt callers into reaching past the store
// to mutate the document directly.

import { create, type StoreApi, type UseBoundStore } from 'zustand'

import {
  CommandStack,
  createDiagram,
  type Command,
  type CommandStackSnapshot,
  type Diagram,
} from '../domain'

export interface DiagramStoreState {
  diagram: Diagram
  history: CommandStackSnapshot
  /** True when there are edits not yet written to storage. Drives the save indicator. */
  isDirty: boolean
  /**
   * Why the last write failed, if it did.
   *
   * A failed autosave is the one error the user must not be left to infer. Without this
   * the indicator sits on "Saving…" indefinitely — indistinguishable from a slow write —
   * while the edits pile up somewhere that is not storage (NFR-3.5).
   */
  saveError: string | undefined

  execute: (command: Command) => void
  /** Several commands, one undo step (FR-7.1). */
  transaction: (label: string, commands: readonly Command[]) => void
  undo: () => void
  redo: () => void
  /** Open a document. Clears history — see CommandStack.reset. */
  load: (diagram: Diagram) => void
  /** Called by the autosaver once a write lands. */
  markSaved: () => void
  /** Called by the autosaver when a write fails. Leaves `isDirty` set: it still is. */
  markSaveFailed: (message: string) => void
}

export interface DiagramStoreOptions {
  initial?: Diagram
  historyLimit?: number
  coalesceWindowMs?: number
  now?: () => number
}

export type DiagramStore = UseBoundStore<StoreApi<DiagramStoreState>>

/**
 * Build an isolated store.
 *
 * Exported as a factory rather than only a singleton so tests get a fresh instance per
 * case — module-level singletons leak state between tests and produce order-dependent
 * failures. The app uses the singleton below.
 */
export function createDiagramStore(options: DiagramStoreOptions = {}): DiagramStore {
  const stack = new CommandStack(options.initial ?? createDiagram(), {
    ...(options.historyLimit === undefined ? {} : { limit: options.historyLimit }),
    ...(options.coalesceWindowMs === undefined
      ? {}
      : { coalesceWindowMs: options.coalesceWindowMs }),
    ...(options.now === undefined ? {} : { now: options.now }),
  })

  return create<DiagramStoreState>()((set, get) => {
    const sameHistory = (a: CommandStackSnapshot, b: CommandStackSnapshot): boolean =>
      a.canUndo === b.canUndo &&
      a.canRedo === b.canRedo &&
      a.depth === b.depth &&
      a.undoLabel === b.undoLabel &&
      a.redoLabel === b.redoLabel

    /**
     * Republish after any stack operation.
     *
     * Nothing is written when nothing changed. CommandStack returns the SAME diagram
     * object for a no-op command, and `stack.snapshot()` is a fresh object every call,
     * so both have to be compared — Zustand notifies on every `set` regardless of
     * whether the values differ.
     *
     * Skipping the write matters for more than render cost: without it a no-op command
     * would flip `isDirty` to true and trigger an autosave of a document that had not
     * changed.
     */
    const publish = (next: Diagram, dirty: boolean): void => {
      const current = get()
      const history = stack.snapshot()

      if (next === current.diagram && sameHistory(history, current.history)) return

      set({ diagram: next, history, isDirty: dirty })
    }

    return {
      diagram: stack.state,
      history: stack.snapshot(),
      isDirty: false,
      saveError: undefined,

      execute: (command) => {
        publish(stack.execute(command), true)
      },
      transaction: (label, commands) => {
        publish(stack.transaction(label, commands), true)
      },
      undo: () => {
        publish(stack.undo(), true)
      },
      redo: () => {
        publish(stack.redo(), true)
      },
      load: (diagram) => {
        publish(stack.reset(diagram), false)
      },
      markSaved: () => {
        set({ isDirty: false, saveError: undefined })
      },
      markSaveFailed: (message) => {
        // `isDirty` deliberately stays true. The document really is unsaved, and the
        // next successful write is what clears both flags together.
        set({ saveError: message })
      },
    }
  })
}

/** The application store. */
export const useDiagramStore = createDiagramStore()
