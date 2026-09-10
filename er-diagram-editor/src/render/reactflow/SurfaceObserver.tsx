// Reports what React Flow measured back out of its provider.
//
// Same shape, and same reason, as RevealController: the pane size and the "every node has
// been measured" flag live in React Flow's internal store, which is only reachable from
// inside the provider that `Canvas` creates — and `render` may not import `store`, so
// nothing outside can subscribe to it. So the facts travel out as callback props, and this
// component, mounted inside the provider, pushes them.
//
// Who needs them:
//
//   - `onResize` — placing a new entity where the user is actually looking. The pane size
//     and the pan/zoom transform together convert "the middle of the screen" into a
//     diagram coordinate. The transform already leaves through `onViewportChange`; this is
//     the other half.
//   - `onNodesMeasured` — image export. Rasterising before React Flow has measured the
//     nodes and framed them produces a blank or half-drawn picture, and nothing downstream
//     can tell that from a correct one. Read the note on `nodesMeasured` below before
//     touching it: the obvious store field for this is a trap.
//
// It renders nothing, and it is a separate component rather than a hook in `CanvasInner`
// so that a resize does not re-run the node and edge memos there.

import { useStore } from '@xyflow/react'
import { useEffect } from 'react'

export interface PaneSize {
  width: number
  height: number
}

export interface SurfaceObserverProps {
  onResize: ((size: PaneSize) => void) | undefined
  /**
   * Called once every node has been measured and laid out — the point at which the
   * surface is worth photographing.
   */
  onNodesMeasured: (() => void) | undefined
}

export function SurfaceObserver({ onResize, onNodesMeasured }: SurfaceObserverProps): null {
  // Each value is read as a separate primitive on purpose: a selector returning
  // `{ width, height }` allocates a new object on every store change, which would
  // re-render this on every pan.
  const width = useStore((state) => state.width)
  const height = useStore((state) => state.height)

  /**
   * Every node has been measured and has a real size.
   *
   * ─────────────────────────────────────────────────────────────────────────────
   * WHY THIS IS DERIVED AND NOT `state.nodesInitialized`
   * ─────────────────────────────────────────────────────────────────────────────
   *
   * There is a field called exactly that, and reading it does not work. React Flow
   * recomputes `nodesInitialized` in ONE place — `setNodes`, i.e. when the `nodes` prop
   * changes — and at that moment the nodes it has just adopted have no measured
   * dimensions yet, so it computes `false`. Measurement happens afterwards, in
   * `updateNodeInternals`, which does NOT write the flag. Nothing sets it to true unless
   * the `nodes` prop happens to change again after measurement.
   *
   * So on a surface that renders once and never changes — which is exactly this one — the
   * flag is false forever, `onNodesMeasured` never fires, and the export sits on
   * "Rendering…" indefinitely with no error. That is what it did.
   *
   * `nodeLookup` IS updated by measurement, and `updateNodeInternals` deliberately calls
   * `set({})` afterwards ("we always want to trigger useStore calls") so that selectors
   * over it re-run. Deriving from the lookup therefore sees the truth. React Flow's own
   * `useNodesInitialized({ includeHiddenNodes: true })` does the same walk; it is not used
   * here because it also requires every node's handle bounds, which are about connection
   * geometry and say nothing about whether the boxes are drawn.
   *
   * Note this cannot be caught by a unit test: jsdom performs no layout, so nothing is
   * ever measured there and both the flag and this derivation stay false. It took running
   * the real app.
   */
  const nodesMeasured = useStore((state) => {
    if (state.nodeLookup.size === 0) return false

    for (const [, node] of state.nodeLookup) {
      const measured = node.measured
      if ((measured.width ?? 0) <= 0 || (measured.height ?? 0) <= 0) return false
    }

    return true
  })

  useEffect(() => {
    // Reporting a measurement upward is the one thing an effect is for: the value does
    // not exist until after layout. The store setter ignores an unchanged size, so a
    // resize that settles through several identical values notifies subscribers once.
    onResize?.({ width, height })
  }, [onResize, width, height])

  useEffect(() => {
    if (!nodesMeasured) return
    onNodesMeasured?.()
  }, [nodesMeasured, onNodesMeasured])

  return null
}
