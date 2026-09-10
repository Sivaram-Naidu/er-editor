// Where a newly created entity goes.
//
// Pure, and separate from Editor.tsx, for the reason connect.ts is: this is the part with
// the arithmetic and the edge cases, and it is worth testing without mounting a canvas.

import type { Point } from '../../domain'

/** Diagonal step between stacked entities, and how close counts as "already taken". */
const CASCADE_STEP = 32
/**
 * How many times to step aside before giving up and stacking.
 *
 * Twelve steps is ~380px diagonally, which is well clear of any single box, and a user who
 * has added twelve entities without moving one has told us they do not care where they
 * land.
 */
const CASCADE_LIMIT = 12

export interface PlacementRequest {
  /**
   * The middle of the visible canvas, in diagram coordinates, or `undefined` when the
   * canvas has not been measured yet.
   */
  center: Point | undefined
  /** The new box's size, so it is centred on the point rather than hung off it. */
  size: { width: number; height: number }
  /** Every position already in use, to avoid dropping the new box exactly on one. */
  taken: readonly Point[]
}

/**
 * The position for a new entity, or `undefined` to leave it unpositioned.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS AT ALL
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Before this, `handleAddEntity` left the position unset and the renderer fell back to a
 * grid slot derived from the entity's index. On a fresh diagram that looks fine. On a
 * canvas the user has panned or zoomed — which is every canvas with more than a screenful
 * of schema on it — grid slot 27 is somewhere off screen, so pressing "Add entity"
 * appeared to do nothing at all. The entity WAS created; the undo history filled up with
 * boxes the user never saw and could not find.
 *
 * Returning `undefined` when the pane has not been measured keeps that fallback for the
 * one case where it is right: there is no view to be in yet.
 */
export function placeNewEntity(request: PlacementRequest): Point | undefined {
  if (request.center === undefined) return undefined

  const origin = {
    x: Math.round(request.center.x - request.size.width / 2),
    y: Math.round(request.center.y - request.size.height / 2),
  }

  // Adding several entities in a row — which is how anyone starts a diagram — would
  // otherwise put every one of them at the same point, and the user would see one box and
  // an entity count that disagreed with it.
  for (let step = 0; step < CASCADE_LIMIT; step += 1) {
    const candidate = { x: origin.x + step * CASCADE_STEP, y: origin.y + step * CASCADE_STEP }
    const occupied = request.taken.some(
      (point) =>
        Math.abs(point.x - candidate.x) < CASCADE_STEP &&
        Math.abs(point.y - candidate.y) < CASCADE_STEP,
    )
    if (!occupied) return candidate
  }

  return origin
}
