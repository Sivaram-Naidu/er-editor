// Performs a camera request from outside the React Flow provider (FR-8.1, FR-2.6).
//
// `fitView` is only reachable through `useReactFlow`, which requires being inside the
// provider that `Canvas` creates. Callers are outside it — and `render` may not import
// `store`, so they cannot subscribe from within either. The request therefore arrives as
// a prop and this component, mounted inside the provider, carries it out.
//
// It renders nothing. Its whole job is the side effect, which is why it is a component
// rather than a hook in `CanvasInner`: keeping it separate means `CanvasInner` does not
// re-run its (expensive) node and edge memos when only the camera changes.

import { useReactFlow } from '@xyflow/react'
import { useEffect, useRef } from 'react'

export interface RevealControllerProps {
  /** Changing `nonce` is the trigger; the ids say what to frame. */
  request: { entityIds: readonly string[]; nonce: number } | undefined
}

/**
 * Zoom and pan so the requested nodes are on screen.
 *
 * `maxZoom` is capped at 1 rather than left unbounded: framing a single small table
 * would otherwise zoom to several hundred percent, which is disorienting and pushes the
 * LOD to L2 for one box while the rest of the schema falls off screen. 1.0 is far enough
 * in to read the fields and near enough out to keep the neighbours visible.
 *
 * `padding` leaves the target off the very edge of the viewport, where a node sits
 * underneath the on-canvas controls.
 */
export function RevealController({ request }: RevealControllerProps): null {
  const flow = useReactFlow()
  // The nonce already performed. Compared rather than listed as a dependency so that a
  // re-render with the same request does not re-frame the canvas underneath the user.
  const performed = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (request === undefined) return
    if (performed.current === request.nonce) return
    performed.current = request.nonce

    // Nodes outside the viewport are dropped from the render tree entirely
    // (`onlyRenderVisibleElements`), so the node being revealed may not exist yet as far
    // as React Flow is concerned. `fitView` works from the node store rather than the
    // DOM, so it still resolves — but a node that has never been measured has no
    // dimensions, and framing it would land slightly off. Passing the ids and letting
    // React Flow use its own bounds is correct in both cases.
    void flow.fitView({
      nodes: request.entityIds.map((id) => ({ id })),
      duration: 300,
      maxZoom: 1,
      padding: 0.25,
    })
  }, [flow, request])

  return null
}
