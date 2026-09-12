// Off-screen render of the WHOLE diagram, for image export (FR-6.5).
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THE LIVE CANVAS CANNOT BE PHOTOGRAPHED
// ─────────────────────────────────────────────────────────────────────────────
//
// The obvious implementation of "export the canvas as PNG" is to point html-to-image at
// the canvas that is already on screen. It does not work here, and it fails quietly.
//
// The editing canvas runs `onlyRenderVisibleElements` (NFR-2.4): nodes outside the
// viewport are not dimmed or clipped, they are absent from the DOM. A capture of it is
// therefore a picture of the current screenful — on a 100-table schema, a handful of
// tables and a lot of white space. The file opens, the image looks deliberate, and the
// missing 90 tables are only noticed by whoever the diagram was sent to.
//
// So export renders its own surface: a second canvas, mounted off-screen, sized to the
// diagram's own bounds, with culling turned off so every node is in the DOM at once and
// the camera pinned at 1:1 so nothing is scaled. That is what gets rasterised.
//
// It also renders at L2 and read-only on purpose. L2 because an exported picture of a
// schema whose fields are hidden is not worth having, whatever zoom the user happened to
// be at; read-only because the "add field" row and the connection handles are editing
// affordances, and an image of them is an image of a tool rather than of a schema.
//
// The cost is real — every node mounted, no culling — which is why the dialog mounts this
// only while an export is actually running, and unmounts it the moment the blob exists.

import { useCallback, useEffect, useRef } from 'react'

import type { Diagram, EntityId, RelationshipId } from '../../domain'
import { Canvas } from '../../render'

import { diagramBounds, surfaceGeometry, type SurfaceGeometry } from './bounds'

/** The level of detail an exported image is drawn at, regardless of the current zoom. */
const EXPORT_LOD = 2

const NO_ENTITIES: ReadonlySet<EntityId> = new Set()
const NO_RELATIONSHIPS: ReadonlySet<RelationshipId> = new Set()

/** Nothing on this surface is interactive; see the note at the call site. */
const noop = (): void => {}

export interface ExportSurfaceProps {
  diagram: Diagram
  /**
   * Called once, with the element to rasterise and the size to write, when every node has
   * been measured and framed.
   *
   * The element is the container, not React Flow's inner viewport: the container is
   * already exactly the output size with the drawing laid out inside it, so there is no
   * transform for the caller to reconstruct.
   */
  onReady: (element: HTMLElement, geometry: SurfaceGeometry) => void
  /** Called instead of `onReady` when there is nothing to draw. */
  onEmpty: () => void
}

export function ExportSurface({
  diagram,
  onReady,
  onEmpty,
}: ExportSurfaceProps): React.ReactElement | null {
  const containerRef = useRef<HTMLDivElement>(null)
  // Guards against a second delivery: `nodesInitialized` can flip more than once as
  // React Flow settles, and firing `onReady` twice would run two exports and hand the
  // user two downloads for one click.
  const delivered = useRef(false)

  const bounds = diagramBounds(diagram, EXPORT_LOD)
  const geometry = bounds === undefined ? undefined : surfaceGeometry(bounds)
  const isEmpty = geometry === undefined

  useEffect(() => {
    if (isEmpty) onEmpty()
  }, [isEmpty, onEmpty])

  const handleMeasured = useCallback(() => {
    if (delivered.current) return
    const element = containerRef.current
    if (element === null || geometry === undefined) return

    delivered.current = true
    // One frame of slack after React Flow reports the nodes measured: the measurement is
    // what triggers its final position write, and rasterising in the same tick can catch
    // the boxes one layout pass stale.
    requestAnimationFrame(() => {
      onReady(element, geometry)
    })
  }, [geometry, onReady])

  if (geometry === undefined) return null

  return (
    /*
     * TWO nested divs, and the nesting is load-bearing.
     *
     * The outer one is what moves the render off-screen. Off-screen rather than
     * `display: none` or `visibility: hidden`, because html-to-image reads computed styles
     * and sizes from a real layout and a hidden subtree has neither. `aria-hidden` and
     * `inert` keep it out of the accessibility tree and the tab order while it is there.
     *
     * The inner one is what gets captured, and it exists ONLY so that the captured element
     * has no offset of its own. html-to-image clones the element and embeds the clone in an
     * SVG `<foreignObject>`, carrying its computed styles across — including
     * `position: fixed; left: -100000px`, which puts the clone a hundred thousand pixels
     * outside the SVG's viewport. The output is then a correctly sized, correctly
     * coloured, completely empty image. No error, no warning: a 37 kB PNG of nothing.
     *
     * Capturing a plain statically-positioned child instead means there is no offset to
     * carry across. Do not collapse these two divs back into one.
     */
    <div className="erd-export-surface" aria-hidden="true" inert>
      <div
        className="erd-export-surface__page"
        ref={containerRef}
        style={{ width: `${String(geometry.width)}px`, height: `${String(geometry.height)}px` }}
      >
        <Canvas
          diagram={diagram}
          lod={EXPORT_LOD}
          hoveredEntityId={undefined}
          hoveredRelationshipId={undefined}
          selectedEntityIds={NO_ENTITIES}
          selectedRelationshipIds={NO_RELATIONSHIPS}
          selectedAttributeId={undefined}
          editable={false}
          cull={false}
          viewport={geometry.viewport}
          showMinimap={false}
          onNodesMeasured={handleMeasured}
          /* Nothing here can be interacted with, so every callback is a no-op rather than a
           wire back into the store. An export must not be able to modify the document it
           is exporting — and with `editable={false}` the canvas gates dragging and
           connecting too, so there is nothing left to fire them. */
          onHoverEntity={noop}
          onHoverRelationship={noop}
          onSelectEntities={noop}
          onSelectRelationship={noop}
          onConnect={noop}
          onMoveEntities={noop}
          onViewportChange={noop}
        />
      </div>
    </div>
  )
}
