// The lines drawn while a drag is lining up with something (FR-3.5).
//
// Rendered through `ViewportPortal`, which puts the children inside React Flow's own
// transformed layer — so a guide is given in diagram units and pans and zooms with the
// boxes it belongs to, for free. Positioning it in screen pixels would mean converting on
// every frame and converting again on every pan, and getting one of the two wrong is a
// line that drifts off its box only when the camera moves.
//
// `zoom` is passed in rather than read from the store. The thickness has to be divided by
// it or the hairline becomes a bar at 3x and disappears at 0.1x, and a `useStore` selector
// on the transform would re-render this on every frame of every pan — for a value that
// cannot change while a node is being dragged, which is the only time there is anything
// here to draw. See the note about viewport subscriptions in CLAUDE.md.

import { ViewportPortal } from '@xyflow/react'

import type { Guide } from './alignment'

export interface AlignmentGuidesProps {
  guides: readonly Guide[]
  zoom: number
}

/** Keeps the line a hairline at any zoom, and never thinner than a device pixel. */
function thickness(zoom: number): number {
  return zoom > 0 ? 1 / zoom : 1
}

export function AlignmentGuides(props: AlignmentGuidesProps): React.ReactElement | null {
  if (props.guides.length === 0) return null
  const width = thickness(props.zoom)

  return (
    <ViewportPortal>
      {props.guides.map((guide) => {
        const vertical = guide.axis === 'x'
        return (
          <div
            key={`${guide.axis}-${String(guide.position)}-${String(guide.start)}`}
            className="erd-guide"
            data-axis={guide.axis}
            /* Decoration for a gesture already in progress: it says nothing a sighted
               user is not already being shown by the box itself moving, and it appears
               and vanishes at pointer rate, which is exactly the sort of thing that must
               not be announced (NFR-4.4). */
            aria-hidden="true"
            style={{
              position: 'absolute',
              transform: `translate(${String(vertical ? guide.position : guide.start)}px, ${String(
                vertical ? guide.start : guide.position,
              )}px)`,
              width: vertical ? width : guide.end - guide.start,
              height: vertical ? guide.end - guide.start : width,
            }}
          />
        )
      })}
    </ViewportPortal>
  )
}
