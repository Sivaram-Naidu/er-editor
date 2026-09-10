/**
 * @vitest-environment node
 *
 * The rasterisation itself needs a real canvas and is covered by tests/e2e; what is
 * asserted here is the arithmetic and the declared capability set, both of which are
 * pure. See the exclusion note for `image/export.ts` in vite.config.ts.
 *
 * It spans `io/formats/image` and `features/export/bounds` on purpose: they are two halves
 * of one answer to "what does a picture of this diagram look like", and splitting the
 * tests across two files would hide the fact that the sizes have to agree.
 */
import { describe, expect, it } from 'vitest'

import {
  createAttribute,
  createDiagram,
  createEntity,
  createRelationship,
  type Diagram,
} from '../../../src/domain'
import {
  MAX_IMAGE_SIDE,
  computeLoss,
  fitToLimit,
  imageCapabilities,
  imageExplanations,
  imageExportAdapters,
  pngAdapter,
  svgAdapter,
} from '../../../src/io'
import { EXPORT_PADDING, diagramBounds, surfaceGeometry } from '../../../src/features/export'

describe('fitToLimit', () => {
  it('does not scale an image that is already inside the limit', () => {
    expect(fitToLimit(1200, 800, 2)).toEqual({ scale: 1, scaled: false })
  })

  it('counts the pixel ratio, because the encoder works in device pixels', () => {
    // 7,000 CSS px is comfortable at 1x and over the limit at 2x. Applying the ratio
    // afterwards would have produced a blank PNG for exactly the diagrams big enough to
    // matter.
    expect(fitToLimit(7000, 500, 1).scaled).toBe(false)
    expect(fitToLimit(7000, 500, 2).scaled).toBe(true)
  })

  it('scales the longest side down to exactly the limit', () => {
    const fit = fitToLimit(20_000, 4000, 1)

    expect(fit.scaled).toBe(true)
    expect(20_000 * fit.scale).toBeCloseTo(MAX_IMAGE_SIDE)
  })

  it('measures the longest side, whichever axis it is on', () => {
    expect(fitToLimit(4000, 20_000, 1)).toEqual(fitToLimit(20_000, 4000, 1))
  })
})

describe('image adapters', () => {
  it('offers both formats, and neither claims to be importable', () => {
    expect(imageExportAdapters.map((adapter) => adapter.id)).toEqual(['svg', 'png'])

    // The format-level caveat has nowhere to live in the per-element loss report, so it
    // rides on the adapter. If it goes missing, the dialog silently stops warning that a
    // picture is a dead end.
    for (const adapter of imageExportAdapters) {
      expect(adapter.note).toMatch(/cannot be opened back/)
    }
  })

  it('declares png and svg as pictures of the same render', () => {
    // Two formats, one renderer: if these ever diverge it means one of them is being
    // drawn differently, which is a bug rather than a feature.
    expect(pngAdapter.capabilities).toBe(svgAdapter.capabilities)
  })

  it('reports what an image cannot show, and stays quiet about what it can', () => {
    const owner = createEntity({ name: 'CUSTOMER' })
    const commented = createAttribute({ name: 'email', comment: 'PII' })
    const plain = createAttribute({ name: 'id', isPrimaryKey: true })

    const diagram: Diagram = {
      ...createDiagram({ name: 'Shop' }),
      entities: [{ ...owner, attributes: [plain, commented] }],
      relationships: [],
    }

    const report = computeLoss(diagram, imageCapabilities, imageExplanations)
    const constructs = report.map((item) => item.construct)

    // Comments are hover tooltips on the canvas; a tooltip cannot be rasterised.
    expect(constructs).toContain('comment')
    // Primary keys ARE drawn — the PK badge — so reporting them would be noise.
    expect(constructs).not.toContain('primaryKey')
    // And positions are the one thing an image keeps better than any text format.
    expect(constructs).not.toContain('position')
  })

  it('does not report a loss for a relationship an image draws in full', () => {
    const a = createEntity({ name: 'A' })
    const b = createEntity({ name: 'B' })
    const diagram: Diagram = {
      ...createDiagram({ name: 'Pair' }),
      entities: [a, b],
      relationships: [createRelationship({ from: a.id, to: b.id })],
    }

    const report = computeLoss(diagram, imageCapabilities, imageExplanations)

    expect(report.map((item) => item.construct)).not.toContain('binaryRelationship')
    expect(report.map((item) => item.construct)).not.toContain('cardinality')
  })
})

describe('diagramBounds', () => {
  it('has no bounds for an empty diagram, rather than a zero-sized rectangle', () => {
    // A zero rectangle would sail through `surfaceGeometry` and produce a 96x96 image of
    // nothing, which looks like a successful export.
    expect(diagramBounds(createDiagram({ name: 'Empty' }), 2)).toBeUndefined()
  })

  it('spans from the top-left corner of the first box to the bottom-right of the last', () => {
    const a = createEntity({ name: 'A' })
    const b = createEntity({ name: 'B' })
    const diagram: Diagram = {
      ...createDiagram({ name: 'Two' }),
      entities: [a, b],
      layout: {
        ...createDiagram({ name: 'Two' }).layout,
        positions: { [a.id]: { x: 100, y: 50 }, [b.id]: { x: 600, y: 400 } },
      },
    }

    const bounds = diagramBounds(diagram, 2)

    expect(bounds?.x).toBe(100)
    expect(bounds?.y).toBe(50)
    // Wide enough to include the second box itself, not just its origin.
    expect(bounds?.width).toBeGreaterThan(500)
    expect(bounds?.height).toBeGreaterThan(350)
  })

  it('includes an entity that has never been positioned', () => {
    // Those land on the renderer's fallback grid, which is off to the right and down.
    // Leaving them out would crop them out of the picture.
    const diagram: Diagram = {
      ...createDiagram({ name: 'Unplaced' }),
      entities: [createEntity({ name: 'A' }), createEntity({ name: 'B' })],
    }

    const bounds = diagramBounds(diagram, 2)

    expect(bounds).toBeDefined()
    expect(bounds?.width).toBeGreaterThan(280)
  })
})

describe('surfaceGeometry', () => {
  it('pads the drawing and puts its top-left corner at the padding, at 1:1', () => {
    const geometry = surfaceGeometry({ x: 100, y: 50, width: 800, height: 600 })

    expect(geometry.width).toBe(800 + EXPORT_PADDING * 2)
    expect(geometry.height).toBe(600 + EXPORT_PADDING * 2)
    // The camera cancels the diagram's own origin, so a schema laid out at x = 4000 is
    // framed identically to one laid out at x = 0.
    expect(geometry.viewport).toEqual({
      x: EXPORT_PADDING - 100,
      y: EXPORT_PADDING - 50,
      zoom: 1,
    })
  })

  it('keeps zoom at exactly 1, so exported text is not resampled', () => {
    expect(surfaceGeometry({ x: 0, y: 0, width: 12_345, height: 99 }).viewport.zoom).toBe(1)
  })
})
