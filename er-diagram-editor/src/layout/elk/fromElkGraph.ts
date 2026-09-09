// ELK result -> LayoutState (positions and edge bend points).

import type { EntityId, Point } from '../../domain'
import type { EdgeRoute, LayoutResult } from '../LayoutEngine'

interface ElkLaidOutNode {
  id: string
  x?: number
  y?: number
}

interface ElkSection {
  startPoint: Point
  endPoint: Point
  bendPoints?: Point[]
}

interface ElkLaidOutEdge {
  id: string
  sections?: ElkSection[]
}

export interface ElkLaidOutGraph {
  children?: ElkLaidOutNode[]
  edges?: ElkLaidOutEdge[]
}

/**
 * Read positions and bend points back out.
 *
 * `offset` shifts the whole result. When laying out a selection (FR-3.7) ELK returns
 * coordinates starting at the origin, which would teleport the selection to the top-left
 * of the canvas; shifting by where the selection already was keeps it in place.
 */
export function fromElkGraph(graph: ElkLaidOutGraph, offset: Point = { x: 0, y: 0 }): LayoutResult {
  const positions: Record<EntityId, Point> = {}

  for (const node of graph.children ?? []) {
    positions[node.id as EntityId] = {
      x: Math.round((node.x ?? 0) + offset.x),
      y: Math.round((node.y ?? 0) + offset.y),
    }
  }

  const routes: EdgeRoute[] = (graph.edges ?? []).flatMap((edge) => {
    const section = edge.sections?.[0]
    if (section === undefined) return []

    const bendPoints = (section.bendPoints ?? []).map((point) => ({
      x: Math.round(point.x + offset.x),
      y: Math.round(point.y + offset.y),
    }))
    if (bendPoints.length === 0) return []

    return [{ relationshipId: edge.id, bendPoints }]
  })

  return { positions, routes }
}
