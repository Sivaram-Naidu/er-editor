// LayoutEngine implementation backed by elkjs.

import type { EntityId, Point } from '../../domain'
import type { LayoutEngine, LayoutRequest, LayoutResult } from '../LayoutEngine'
import { LayoutWorkerClient } from '../worker/client'

import { fromElkGraph } from './fromElkGraph'
import { toElkGraph } from './toElkGraph'

/**
 * Top-left of the entities being laid out, as they sit today.
 *
 * ELK always returns coordinates starting near the origin. For a full-diagram layout
 * that is fine, but for a selection (FR-3.7) it would teleport those entities to the
 * top-left corner, away from the rest of the diagram they belong with.
 */
function currentOrigin(request: LayoutRequest): Point {
  const scope = request.only
  if (scope === undefined || scope.length === 0) return { x: 0, y: 0 }

  const points = scope
    .map((id) => request.diagram.layout.positions[id])
    .filter((point): point is Point => point !== undefined)

  if (points.length === 0) return { x: 0, y: 0 }

  return {
    x: Math.min(...points.map((point) => point.x)),
    y: Math.min(...points.map((point) => point.y)),
  }
}

export class ElkLayoutEngine implements LayoutEngine {
  readonly id = 'elk'
  readonly #client = new LayoutWorkerClient()

  async layout(request: LayoutRequest): Promise<LayoutResult> {
    const graph = toElkGraph(request)

    // Nothing to arrange. Short-circuited before spawning the worker, so an empty
    // diagram never pays to download elkjs.
    if (graph.children.length === 0) return { positions: {}, routes: [] }

    // A single node has no layout to compute; ELK would return it at the origin and
    // move an entity the user never asked to move.
    if (graph.children.length === 1) {
      const only = graph.children[0]
      const existing = request.diagram.layout.positions[only?.id as EntityId]
      return {
        positions: existing === undefined ? {} : { [only?.id as EntityId]: existing },
        routes: [],
      }
    }

    const laidOut = await this.#client.layout(graph)
    return fromElkGraph(laidOut, currentOrigin(request))
  }

  dispose(): void {
    this.#client.dispose()
  }
}
