// New / open / save / recent diagrams (FR-7.5).

import { useCallback, useEffect, useState } from 'react'

import { createDiagram, type Diagram, type DiagramId } from '../../domain'
import { rememberLastOpened, sharedRepository, type DiagramSummary } from '../../persistence'

export interface DiagramLibrary {
  /** Every saved diagram, newest first. */
  saved: DiagramSummary[]
  refresh: () => Promise<void>
  createNew: () => Diagram
  open: (id: DiagramId) => Promise<Diagram | undefined>
  remove: (id: DiagramId) => Promise<void>
}

/**
 * Reads the saved-diagram list and produces new ones.
 *
 * Writing is not this hook's job — the autosaver already persists whatever the store
 * holds. So `createNew` and `open` return a diagram for the caller to `load()`, and the
 * save follows on its own. Having two things write the same rows is how a diagram gets
 * saved under the wrong id.
 */
export function useDiagramLibrary(currentId: DiagramId | undefined): DiagramLibrary {
  const [saved, setSaved] = useState<DiagramSummary[]>([])

  // No loading flag on purpose. Listing summaries from IndexedDB takes single-digit
  // milliseconds, so a spinner would flash rather than inform — and setting one
  // synchronously inside the effect below is exactly the cascading render that
  // react-hooks/set-state-in-effect warns about.
  const refresh = useCallback(async () => {
    try {
      setSaved(await sharedRepository().list())
    } catch {
      // Storage being unavailable is already surfaced at boot; the menu degrades to
      // "nothing saved" rather than breaking the toolbar.
      setSaved([])
    }
  }, [])

  // Re-read whenever the current document changes identity, so a diagram created in this
  // session appears in the list without a manual refresh.
  //
  // Inlined rather than calling `refresh()`, for two reasons: the lint rule cannot see
  // that the write happens after an await, and more usefully the guard below drops a
  // response that arrives after the user has already switched documents again.
  useEffect(() => {
    const lifecycle = { cancelled: false }

    void (async () => {
      const list = await sharedRepository()
        .list()
        // Storage being unavailable is already surfaced at boot; the menu degrades to
        // "nothing saved" rather than breaking the toolbar.
        .catch((): DiagramSummary[] => [])

      if (!lifecycle.cancelled) setSaved(list)
    })()

    return () => {
      lifecycle.cancelled = true
    }
  }, [currentId])

  const createNew = useCallback((): Diagram => {
    const diagram = createDiagram()
    void rememberLastOpened(sharedRepository(), diagram.id)
    return diagram
  }, [])

  const open = useCallback(async (id: DiagramId): Promise<Diagram | undefined> => {
    const diagram = await sharedRepository().get(id)
    if (diagram !== undefined) await rememberLastOpened(sharedRepository(), id)
    return diagram
  }, [])

  const remove = useCallback(
    async (id: DiagramId) => {
      await sharedRepository().remove(id)
      await refresh()
    },
    [refresh],
  )

  return { saved, refresh, createNew, open, remove }
}
