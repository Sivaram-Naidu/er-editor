// Consume ELK bend points; orthogonal fallback.

import { getSmoothStepPath, type Position } from '@xyflow/react'

export interface RoutingInput {
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  sourcePosition: Position
  targetPosition: Position
  /** Bend points from ELK, once the layout engine is wired up (FR-3.1). */
  bendPoints?: readonly { x: number; y: number }[]
}

/**
 * Orthogonal routing.
 *
 * `getSmoothStepPath` is the interim router: right angles with a small corner radius,
 * which is the IE convention and reads far better than bezier curves at density —
 * curves crossing each other are hard to trace, and tracing is the whole point of FR-4.1.
 *
 * ELK now supplies computed bend points and `fromElkGraph` extracts them, but they are
 * NOT yet passed in here. They describe a route between two boxes at the positions ELK
 * chose, so the first time the user drags a node they become wrong — and a connector
 * that bends through empty space is worse than one that never claimed to be optimal.
 *
 * Consuming them needs an invalidation story, which belongs with incremental layout
 * (FR-3.8, V2). The parameter exists so that lands as a change here and nowhere else.
 */
export function routeEdge(input: RoutingInput): [path: string, labelX: number, labelY: number] {
  const points = input.bendPoints
  if (points !== undefined && points.length > 0) {
    const segments = [
      `M ${String(input.sourceX)},${String(input.sourceY)}`,
      ...points.map((point) => `L ${String(point.x)},${String(point.y)}`),
      `L ${String(input.targetX)},${String(input.targetY)}`,
    ]
    const middle = points[Math.floor(points.length / 2)]
    return [segments.join(' '), middle?.x ?? input.targetX, middle?.y ?? input.targetY]
  }

  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX: input.sourceX,
    sourceY: input.sourceY,
    targetX: input.targetX,
    targetY: input.targetY,
    sourcePosition: input.sourcePosition,
    targetPosition: input.targetPosition,
    borderRadius: 4,
  })

  return [path, labelX, labelY]
}
