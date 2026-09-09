// Interface - the seam that makes elkjs replaceable (NFR-8.2, SRS §8.2).
//
// elkjs is EPL-2.0, which is weak copyleft. NFR-8.2 requires it be consumed unmodified
// and isolated behind an internal interface so it can be swapped. This is that
// interface. It is also the seam that lets layout be lazy-loaded: nothing outside
// `src/layout` imports elkjs, so it stays out of the initial bundle (NFR-1.8).

import type { Diagram, EntityId, Point } from '../domain'

/** Where a connector should bend, in diagram coordinates. */
export interface EdgeRoute {
  relationshipId: string
  bendPoints: Point[]
}

export interface LayoutResult {
  positions: Record<EntityId, Point>
  /** Orthogonal bend points from the layout engine, consumed by RelationshipEdge. */
  routes: EdgeRoute[]
}

/** FR-3.6: selectable algorithms. `layered` is the default and the only one tuned. */
export type LayoutAlgorithm = 'layered' | 'force' | 'tree'

export interface LayoutRequest {
  diagram: Diagram
  algorithm?: LayoutAlgorithm
  /** FR-3.7: lay out only these entities, leaving the rest where they are. */
  only?: readonly EntityId[]
  /** Measured sizes; ELK cannot measure text, so the caller supplies them. */
  sizes: Record<EntityId, { width: number; height: number }>
}

export interface LayoutEngine {
  readonly id: string
  layout(request: LayoutRequest): Promise<LayoutResult>
  /** Release the worker. Called when the editor unmounts. */
  dispose(): void
}
