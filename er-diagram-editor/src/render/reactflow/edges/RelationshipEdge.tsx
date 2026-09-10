// Relationship connector with crow's foot endpoints.

import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from '@xyflow/react'
import { memo } from 'react'

import type { Cardinality, Participation, Relationship, Severity } from '../../../domain'
import { markerFor } from '../../notation/compact'

import { tracedMarkerId } from './endpoints'

import { routeEdge } from './routing'

export interface RelationshipEdgeData extends Record<string, unknown> {
  relationship: Relationship
  sourceName: string
  targetName: string
  isTraced: boolean
  isDimmed: boolean
  /** Worst validation severity on this relationship (FR-8.4). */
  issueSeverity: Severity | undefined
}

function RelationshipEdgeComponent(props: EdgeProps): React.ReactElement {
  const data = props.data as unknown as RelationshipEdgeData
  const { relationship, isTraced, isDimmed, issueSeverity } = data
  const [from, to] = relationship.participants

  const markerUrl = (end: { cardinality: Cardinality; participation: Participation }): string => {
    const base = markerFor(end.cardinality, end.participation)
    return isTraced ? tracedMarkerId(base) : base
  }

  const [path, labelX, labelY] = routeEdge({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    targetX: props.targetX,
    targetY: props.targetY,
    sourcePosition: props.sourcePosition,
    targetPosition: props.targetPosition,
  })

  return (
    <g
      className="erd-edge"
      data-traced={isTraced || undefined}
      data-dimmed={isDimmed || undefined}
      /* Non-identifying relationships are dashed, matching Mermaid's `..` and the
         standard IE convention (FR-1.9). */
      data-identifying={relationship.isIdentifying || undefined}
      /* A connector cannot carry a badge without cluttering the very thing it is drawn
         to keep legible, so the cue here is the stroke itself. The panel holds the
         wording; an unnamed relationship is by definition one with no label to annotate.
         Never the only cue for a given issue — every one of these also appears in the
         panel with a sentence (NFR-4.4). */
      data-issue={issueSeverity}
    >
      {/* Markers are spread conditionally rather than passed as `undefined`: React Flow
          types them as optional-not-undefined, and `exactOptionalPropertyTypes` holds us
          to that. Same pattern as the domain factories.

          The traced variant is selected here rather than in CSS because markers live in
          a separate <svg> that no selector on this element can reach. */}
      <BaseEdge
        id={props.id}
        path={path}
        {...(from === undefined ? {} : { markerStart: `url(#${markerUrl(from)})` })}
        {...(to === undefined ? {} : { markerEnd: `url(#${markerUrl(to)})` })}
      />

      {/* A wide transparent stroke over the visible one. Hovering a 1.25px line is
          unreasonably fiddly; this gives the pointer a ~16px target without changing
          what is drawn (FR-4.1). */}
      <path className="erd-edge__hit" d={path} />

      {relationship.name === '' || isDimmed ? null : (
        <EdgeLabelRenderer>
          <div
            className="erd-edge__label"
            style={{
              transform: `translate(-50%, -50%) translate(${String(labelX)}px, ${String(labelY)}px)`,
            }}
          >
            {relationship.name}
          </div>
        </EdgeLabelRenderer>
      )}
    </g>
  )
}

export const RelationshipEdge = memo(RelationshipEdgeComponent)
RelationshipEdge.displayName = 'RelationshipEdge'
