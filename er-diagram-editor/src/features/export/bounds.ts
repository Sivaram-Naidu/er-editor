// How big a picture of the whole diagram has to be.
//
// Pure and separate from the component for the usual reason: this is the arithmetic, and
// it is worth testing without mounting a canvas or a browser.

import type { Diagram } from '../../domain'
import { measureEntity } from '../../layout'
import { fallbackPosition, type LodLevel } from '../../render'

/**
 * Margin around the drawing, in diagram units.
 *
 * Two jobs. The obvious one is that a diagram flush against the edge of an image looks
 * cropped. The load-bearing one is slack: `measureEntity` estimates node sizes from the
 * model rather than measuring the DOM (see the header of layout/measure.ts), so the real
 * boxes can be a few pixels wider than the bounds computed here. Without a margin, that
 * difference would clip the right-hand column of a table.
 */
export const EXPORT_PADDING = 48

export interface DiagramBounds {
  /** Top-left of the drawing, in diagram coordinates. */
  x: number
  y: number
  width: number
  height: number
}

/**
 * The rectangle every entity fits inside, at the given level of detail.
 *
 * Positions are resolved exactly as `Canvas` resolves them — the stored position, falling
 * back to the placeholder grid slot for an entity that has never been placed — so the
 * bounds describe what will actually be drawn rather than what the layout intended. An
 * empty diagram has no bounds; the caller decides what to do about that rather than being
 * handed a zero-sized rectangle that looks valid.
 */
export function diagramBounds(diagram: Diagram, lod: LodLevel): DiagramBounds | undefined {
  if (diagram.entities.length === 0) return undefined

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  diagram.entities.forEach((entity, index) => {
    const position = diagram.layout.positions[entity.id] ?? fallbackPosition(index)
    // `editable: false` — the export surface is read-only, so there is no "add field" row
    // at the bottom of each box and the boxes are correspondingly shorter.
    const size = measureEntity(entity, lod, false)

    minX = Math.min(minX, position.x)
    minY = Math.min(minY, position.y)
    maxX = Math.max(maxX, position.x + size.width)
    maxY = Math.max(maxY, position.y + size.height)
  })

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

export interface SurfaceGeometry {
  /** Size of the off-screen container, and of the image written from it. */
  width: number
  height: number
  /** Camera that puts the drawing at `EXPORT_PADDING` from the top-left, at 1:1. */
  viewport: { x: number; y: number; zoom: number }
}

/** Container size and camera for a 1:1 picture of the whole diagram. */
export function surfaceGeometry(bounds: DiagramBounds): SurfaceGeometry {
  return {
    width: Math.ceil(bounds.width + EXPORT_PADDING * 2),
    height: Math.ceil(bounds.height + EXPORT_PADDING * 2),
    viewport: { x: EXPORT_PADDING - bounds.x, y: EXPORT_PADDING - bounds.y, zoom: 1 },
  }
}
