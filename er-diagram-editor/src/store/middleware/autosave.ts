// Debounced persist (FR-7.2).
//
// Wiring rather than logic: the debouncing and serialisation live in
// `src/persistence/autosave.ts`, which is testable without a store. This subscribes a
// store to that.

import { Autosaver, rememberLastOpened, type DiagramRepository } from '../../persistence'
import type { DiagramStore } from '../diagramStore'

export interface AttachAutosaveOptions {
  store: DiagramStore
  repository: DiagramRepository
  delayMs?: number
}

export interface AutosaveHandle {
  autosaver: Autosaver
  /** Unsubscribe and flush anything outstanding. */
  detach: () => Promise<void>
}

export function attachAutosave(options: AttachAutosaveOptions): AutosaveHandle {
  const { store, repository } = options

  const autosaver = new Autosaver({
    repository,
    ...(options.delayMs === undefined ? {} : { delayMs: options.delayMs }),
    onStateChange: (state) => {
      // Both terminal states are forwarded. Reporting only success is what leaves a
      // failed save looking identical to a slow one — see `saveError` on the store.
      if (state.status === 'saved') store.getState().markSaved()
      else if (state.status === 'error') {
        store.getState().markSaveFailed(state.error ?? 'Could not save to this browser.')
      }
    },
  })

  let lastDiagram = store.getState().diagram

  const unsubscribe = store.subscribe((state) => {
    // Reference comparison is sufficient and cheap: CommandStack returns a new frozen
    // object for every real change and the SAME object for a no-op, so this fires
    // exactly when something actually changed.
    if (state.diagram === lastDiagram) return

    const previousId = lastDiagram.id
    lastDiagram = state.diagram
    autosaver.schedule(state.diagram)

    if (state.diagram.id !== previousId) {
      void rememberLastOpened(repository, state.diagram.id)
    }
  })

  // A debounced save that has not fired yet is lost when the tab closes — precisely when
  // the user assumes their work is safe. `pagehide` is used rather than `beforeunload`
  // because it also fires when a mobile browser backgrounds the tab.
  const flushNow = (): void => {
    void autosaver.flush()
  }
  const hasWindow = typeof globalThis.addEventListener === 'function'
  if (hasWindow) {
    globalThis.addEventListener('pagehide', flushNow)
    globalThis.addEventListener('visibilitychange', flushNow)
  }

  return {
    autosaver,
    detach: async () => {
      unsubscribe()
      if (hasWindow) {
        globalThis.removeEventListener('pagehide', flushNow)
        globalThis.removeEventListener('visibilitychange', flushNow)
      }
      await autosaver.flush()
    },
  }
}
