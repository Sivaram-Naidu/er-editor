// IR -> ELK JSON, including ports for FK-row edge attachment.

import type { Diagram, EntityId } from '../../domain'
import type { LayoutAlgorithm, LayoutRequest } from '../LayoutEngine'

import { optionsFor } from './options'

export interface ElkNode {
  id: string
  width: number
  height: number
}

export interface ElkEdge {
  id: string
  sources: string[]
  targets: string[]
}

export interface ElkGraph {
  id: string
  layoutOptions: Record<string, string>
  children: ElkNode[]
  edges: ElkEdge[]
}

const FALLBACK_SIZE = { width: 180, height: 60 }

/**
 * Translate a diagram into the graph ELK expects.
 *
 * Only entities in scope are sent. FR-3.7 allows laying out a selection, and ELK has no
 * concept of "leave these alone" — the way to honour it is to not mention them.
 *
 * Relationships with an endpoint outside the scope are dropped rather than sent with a
 * dangling reference, which ELK rejects outright.
 */
export function toElkGraph(request: LayoutRequest): ElkGraph {
  const { diagram } = request
  const scope =
    request.only === undefined || request.only.length === 0
      ? new Set(diagram.entities.map((entity) => entity.id))
      : new Set(request.only)

  const children: ElkNode[] = diagram.entities
    .filter((entity) => scope.has(entity.id))
    .map((entity) => ({
      id: entity.id,
      ...(request.sizes[entity.id] ?? FALLBACK_SIZE),
    }))

  const edges: ElkEdge[] = diagram.relationships.flatMap((relationship) => {
    const [from, to] = relationship.participants
    if (from === undefined || to === undefined) return []
    if (!scope.has(from.entityId) || !scope.has(to.entityId)) return []
    // A self-join has nothing to lay out — ELK would route it as a degenerate edge and
    // some algorithms reject it. It is drawn as a loop by the renderer instead.
    if (from.entityId === to.entityId) return []

    return [{ id: relationship.id, sources: [from.entityId], targets: [to.entityId] }]
  })

  return {
    id: 'root',
    layoutOptions: optionsFor(request.algorithm ?? 'layered'),
    children,
    edges,
  }
}

export function scopedEntityIds(diagram: Diagram, only?: readonly EntityId[]): EntityId[] {
  if (only === undefined || only.length === 0) return diagram.entities.map((entity) => entity.id)
  return [...only]
}

export type { LayoutAlgorithm }
