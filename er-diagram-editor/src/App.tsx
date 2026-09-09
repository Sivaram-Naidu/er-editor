import { useEffect, useState } from 'react'

import { Editor } from './features/editor'
import { recoverLastSession, sharedRepository } from './persistence'
import { attachAutosave, useDiagramStore } from './store'

/**
 * Boot: restore the last session, then wire autosave.
 *
 * Recovery runs before autosave is attached, so restoring a document does not
 * immediately re-save it (FR-7.2, FR-7.3).
 */
export default function App(): React.ReactElement {
  const [ready, setReady] = useState(false)
  const [problem, setProblem] = useState<string | undefined>(undefined)

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
      if (lifecycle.cancelled) return

      if (recovered.diagram !== undefined) useDiagramStore.getState().load(recovered.diagram)
      setProblem(recovered.problem)

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
      <Editor />
    </>
  )
}
