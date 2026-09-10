/**
 * @vitest-environment node
 *
 * Pure arithmetic. The suite default is `node` (see the note in vite.config.ts) and there
 * is nothing here to render.
 */
import { describe, expect, it } from 'vitest'

import type { Point } from '../../../src/domain'
import { placeNewEntity } from '../../../src/features/editor'
import { viewportCenter } from '../../../src/store'

describe('placeNewEntity', () => {
  const size = { width: 200, height: 100 }

  it('centres the box on the point rather than hanging it off the corner', () => {
    const point = placeNewEntity({ center: { x: 500, y: 400 }, size, taken: [] })

    expect(point).toEqual({ x: 400, y: 350 })
  })

  it('leaves the entity unpositioned when the canvas has not been measured', () => {
    // This is the case that keeps the renderer's fallback grid meaningful: on the very
    // first render there is no view to be in the middle of.
    expect(placeNewEntity({ center: undefined, size, taken: [] })).toBeUndefined()
  })

  it('steps aside rather than stacking on an entity already there', () => {
    const first = placeNewEntity({ center: { x: 500, y: 400 }, size, taken: [] })
    expect(first).toBeDefined()

    const second = placeNewEntity({ center: { x: 500, y: 400 }, size, taken: [first as Point] })

    expect(second).not.toEqual(first)
    // Diagonally, so the offset is visible on both axes and the header of the box
    // underneath stays readable.
    expect(second?.x).toBeGreaterThan((first as Point).x)
    expect(second?.y).toBeGreaterThan((first as Point).y)
  })

  it('keeps stepping for a run of additions, so none of them land on each other', () => {
    const taken: Point[] = []
    for (let index = 0; index < 6; index += 1) {
      const point = placeNewEntity({ center: { x: 0, y: 0 }, size, taken })
      expect(point).toBeDefined()
      taken.push(point as Point)
    }

    const distinct = new Set(taken.map((point) => `${String(point.x)},${String(point.y)}`))
    expect(distinct.size).toBe(6)
  })

  it('gives up and stacks rather than walking off into the distance', () => {
    // A user who has filled the cascade has stopped caring where boxes land; drifting
    // further and further from the viewport centre would be worse than overlapping.
    const taken: Point[] = []
    for (let index = 0; index < 40; index += 1) {
      taken.push({ x: index * 32 - 100, y: index * 32 - 50 })
    }

    const point = placeNewEntity({ center: { x: 0, y: 0 }, size, taken })

    expect(point).toEqual({ x: -100, y: -50 })
  })

  it('ignores an entity that is near on one axis only', () => {
    // Directly above is not "already there": a box 500px below the candidate does not
    // hide it, so stepping aside would move the new entity for no reason.
    const point = placeNewEntity({
      center: { x: 500, y: 400 },
      size,
      taken: [{ x: 400, y: 900 }],
    })

    expect(point).toEqual({ x: 400, y: 350 })
  })
})

describe('viewportCenter', () => {
  it('inverts the pan and zoom to find the middle of the visible area', () => {
    // A 1000x600 pane, panned 100 left and 50 up, at 2x: the point under the middle of
    // the screen is ((1000/2) - -100) / 2 = 300, ((600/2) - -50) / 2 = 175.
    const center = viewportCenter({ x: -100, y: -50, zoom: 2, paneWidth: 1000, paneHeight: 600 })

    expect(center).toEqual({ x: 300, y: 175 })
  })

  it('is the pane centre when the camera is at the origin at 1x', () => {
    expect(viewportCenter({ x: 0, y: 0, zoom: 1, paneWidth: 800, paneHeight: 400 })).toEqual({
      x: 400,
      y: 200,
    })
  })

  it('returns undefined rather than a guess when the pane has no size', () => {
    // Zero happens for real: the first render, and every jsdom test. Dividing anyway
    // would return the top-left corner of the visible area, which looks deliberate.
    expect(viewportCenter({ x: 0, y: 0, zoom: 1, paneWidth: 0, paneHeight: 600 })).toBeUndefined()
    expect(viewportCenter({ x: 0, y: 0, zoom: 1, paneWidth: 800, paneHeight: 0 })).toBeUndefined()
  })
})
