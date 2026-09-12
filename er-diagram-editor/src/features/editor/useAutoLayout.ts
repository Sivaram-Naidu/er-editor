// Auto-layout, driven from the toolbar (FR-3.1 to FR-3.4).

import { useCallback, useEffect, useRef, useState } from 'react'

import { applyLayout, type Diagram, type EntityId } from '../../domain'
import {
  createLayoutEngine,
  measureAll,
  type LayoutAlgorithm,
  type LayoutEngine,
} from '../../layout'
import type { LodLevel } from '../../lib/lod'

export interface AutoLayoutState {
  isRunning: boolean
  error: string | undefined
}

export interface UseAutoLayoutRequest {
  /**
   * The document to arrange, when it is not the one currently on screen.
   *
   * Load-bearing for import. `run` otherwise closes over the `diagram` prop as it stood
   * at the last render, and a caller that loads a document and arranges it in the same
   * tick — which is exactly what importing does — hands ELK the document it just
   * replaced. On a fresh session that is the empty one, so `ElkLayoutEngine`
   * short-circuits it and returns no positions: no worker, no error, no layout, and the
   * imported schema sits on the placeholder grid. Importing over an existing diagram was
   * worse, laying out the previous entities and writing positions under ids the new
   * document does not have.
   */
  diagram?: Diagram
  only?: readonly EntityId[]
  algorithm?: LayoutAlgorithm
}

export interface UseAutoLayout extends AutoLayoutState {
  run: (request?: UseAutoLayoutRequest) => Promise<void>
}

export interface UseAutoLayoutOptions {
  diagram: Diagram
  lod: LodLevel
  execute: (command: ReturnType<typeof applyLayout>) => void
}

export function useAutoLayout(options: UseAutoLayoutOptions): UseAutoLayout {
  const { diagram, lod, execute } = options
  const [isRunning, setRunning] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  // Held in a ref rather than state: creating it triggers the dynamic import, and it
  // must survive re-renders without re-downloading elkjs.
  const engineRef = useRef<LayoutEngine | undefined>(undefined)
  const runIdRef = useRef(0)

  useEffect(
    () => () => {
      engineRef.current?.dispose()
      engineRef.current = undefined
    },
    [],
  )

  const run = useCallback(
    async (request?: UseAutoLayoutRequest) => {
      // The run counter makes a stale result harmless. Pressing the button twice on a
      // large schema would otherwise let the first, slower result land after the second
      // and silently overwrite it.
      const runId = ++runIdRef.current
      setRunning(true)
      setError(undefined)

      try {
        // The caller's document wins over the rendered one — see `UseAutoLayoutRequest`.
        const target = request?.diagram ?? diagram

        engineRef.current ??= await createLayoutEngine()
        const result = await engineRef.current.layout({
          diagram: target,
          sizes: measureAll(target, lod),
          ...(request?.only === undefined ? {} : { only: request.only }),
          ...(request?.algorithm === undefined ? {} : { algorithm: request.algorithm }),
        })

        if (runId !== runIdRef.current) return
        if (Object.keys(result.positions).length === 0) return

        // One command, so the whole rearrangement is a single undo step (FR-3.4).
        execute(applyLayout(result.positions))
      } catch (cause) {
        if (runId !== runIdRef.current) return
        setError(cause instanceof Error ? cause.message : 'Layout failed')
      } finally {
        if (runId === runIdRef.current) setRunning(false)
      }
    },
    [diagram, lod, execute],
  )

  return { run, isRunning, error }
}
