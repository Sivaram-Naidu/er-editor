import { useEffect, useState } from 'react'

import { Editor, useAppliedTheme } from './features/editor'
import { THEME_KEY, hasIndexedDb, recoverLastSession, sharedRepository } from './persistence'
import { attachAutosave, useDiagramStore, useUiStore, type Theme } from './store'

const THEMES: readonly Theme[] = ['light', 'dark', 'system']

/** Storage is untrusted like any other input: a hand-edited row must not set an
 * attribute nothing has styles for. */
function readTheme(value: unknown): Theme | undefined {
  return THEMES.find((candidate) => candidate === value)
}

/**
 * Boot: restore the last session, then wire autosave.
 *
 * Recovery runs before autosave is attached, so restoring a document does not
 * immediately re-save it (FR-7.2, FR-7.3).
 */
export default function App(): React.ReactElement {
  const [ready, setReady] = useState(false)
  const [problem, setProblem] = useState<string | undefined>(undefined)

  // Read once, not in an effect: it never changes for the life of the page, and the
  // repository has already fallen back to the in-memory one by the time anything renders.
  // Saying so is the whole point — that fallback works perfectly until the tab closes,
  // which is exactly when the user finds out it was never really saving (db.ts).
  const [storageIsEphemeral] = useState(() => !hasIndexedDb())

  // Applied before anything paints, boot screen included, so there is no flash of the
  // light palette on the way to a dark one.
  useAppliedTheme()

  useEffect(() => {
    // The same instance the diagram menu reads from — see sharedRepository().
    const repository = sharedRepository()
    let detach: (() => Promise<void>) | undefined
    // Boxed rather than a bare `let`: TypeScript narrows a captured boolean to its
    // initial value across an `await`, so the guard below would be flagged as always
    // false even though the cleanup sets it. The object defeats that narrowing without
    // needing a lint suppression.
    const lifecycle = { cancelled: false }

    void (async () => {
      const recovered = await recoverLastSession(repository)
      // Read alongside the document, not after it, so that every suspension point sits
      // ABOVE the one cancellation check and every write to shared state sits below it.
      // A second check further down would be dead code anyway: TypeScript narrows the
      // flag to false the moment the first one passes.
      const storedTheme = readTheme(
        await repository.getPreference<unknown>(THEME_KEY).catch(() => undefined),
      )
      if (lifecycle.cancelled) return

      if (recovered.diagram !== undefined) useDiagramStore.getState().load(recovered.diagram)
      setProblem(recovered.problem)
      // Restored before `ready` flips, so the choice is in place for the first render
      // rather than applied over it.
      if (storedTheme !== undefined) useUiStore.getState().setTheme(storedTheme)

      detach = attachAutosave({ store: useDiagramStore, repository }).detach
      setReady(true)
    })()

    return () => {
      lifecycle.cancelled = true
      void detach?.()
    }
  }, [])

  if (!ready) {
    return (
      <div className="erd-boot" role="status">
        Loading your diagram…
      </div>
    )
  }

  return (
    <>
      {problem === undefined ? null : (
        <div className="erd-banner" role="alert">
          {problem} Starting from an empty diagram.
        </div>
      )}
      {!storageIsEphemeral ? null : (
        <div className="erd-banner erd-banner--warning" role="alert">
          This browser will not let the page store anything — private browsing, or storage blocked
          for this site. Your work stays in this tab only, so export it before you close it.
        </div>
      )}
      <Editor />
    </>
  )
}
