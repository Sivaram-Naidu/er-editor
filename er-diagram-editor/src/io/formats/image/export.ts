// Canvas -> PNG / SVG via html-to-image (FR-6.5).
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS ADAPTER HAS A DIFFERENT SHAPE FROM EVERY OTHER ONE
// ─────────────────────────────────────────────────────────────────────────────
//
// Every other export adapter is `(diagram: Diagram) => string`. This one cannot be, and
// the reason is not a wrinkle worth hiding: an image is not a serialisation of the model,
// it is a photograph of the renderer. What ends up in the file depends on the notation,
// the level of detail, the theme, and the CSS — none of which the IR knows about.
//
// Writing it as `(diagram) => string` would have meant building a second renderer inside
// `io` that draws SVG from the model directly, and that second renderer would drift from
// the one on screen within a release. "Export what the user sees" is the requirement, so
// the input is what the user sees: a DOM subtree.
//
// So `ImageExportAdapter` is its own interface (see io/types.ts) with its own registry
// list, rather than a member of `exportAdapters` that violates the contract the others
// keep. The declarative loss report is shared — the capability set is the same mechanism.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THE CALLER SUPPLIES THE ELEMENT AND THE TRANSFORM
// ─────────────────────────────────────────────────────────────────────────────
//
// The live canvas runs `onlyRenderVisibleElements` (NFR-2.4), so nodes outside the
// viewport are not in the DOM at all. Rasterising the on-screen canvas would produce an
// image of the current screenful and silently omit the rest of the schema — the worst
// kind of wrong, because it looks like a successful export. Framing the whole diagram is
// therefore the caller's job (see features/export/ExportSurface.tsx), and this module
// only takes the finished element and the size to write.

import { toBlob, toSvg } from 'html-to-image'

export type ImageFormat = 'png' | 'svg'

export interface ImageRenderRequest {
  /** The element to rasterise, already laid out at the size being written. */
  element: HTMLElement
  /** Output size in CSS pixels, before `pixelRatio`. */
  width: number
  height: number
  /**
   * Inline transform applied to `element` for the duration of the capture.
   *
   * html-to-image clones the node, so this never touches what is on screen. The caller
   * uses it to pan and scale the whole graph into the output box.
   */
  transform: string
  /**
   * Painted behind the diagram. Required, not optional: a PNG with a transparent
   * background pasted into a document with a dark theme shows dark text on dark paper,
   * and the user has no way to tell why.
   */
  backgroundColor: string
  /** PNG only. 2 gives a file that stays sharp on a retina display and when zoomed. */
  pixelRatio?: number
}

/**
 * SVG presentation properties that CSS may be setting, which have to be inlined by hand.
 *
 * Not an arbitrary list: these are the ones `canvas.css` and the notation set actually use
 * on edges, markers and glyphs. Add to it if a rule starts styling something else.
 */
const SVG_PRESENTATION = [
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-opacity',
  'marker-start',
  'marker-mid',
  'marker-end',
  'opacity',
  'color',
] as const

/**
 * Copy computed SVG styling onto inline style attributes, in place.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NECESSARY, AND WHAT IT LOOKED LIKE WITHOUT IT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * html-to-image does not embed stylesheets. It walks the subtree and copies each
 * element's COMPUTED style onto an inline `style` attribute, which is what survives being
 * cloned into an `<svg><foreignObject>`. But it guards that copy with an
 * `instanceof HTMLElement` check — and an `SVGElement` is not an `HTMLElement`.
 *
 * So every SVG element in the capture arrives with no styling at all, and falls back to
 * the SVG defaults: `fill: black`, `stroke: none`. The entity boxes are HTML, so they came
 * out perfect; the relationship edges are `<path>` elements whose `fill: none` lives in
 * `canvas.css`, so each one filled the area enclosed by its own bezier curve. The export
 * was a correct-looking diagram with two big black inkblots across it. Every automated
 * check passed: the file was a valid PNG, the right size, the right background, and 151 kB
 * of plausible content.
 *
 * MUTATES the tree it is given. That is only safe because the export surface is built for
 * this one capture and unmounted straight afterwards — never call it on the live canvas.
 */
function inlineSvgPresentation(root: HTMLElement): void {
  for (const element of root.querySelectorAll('svg, svg *')) {
    if (!(element instanceof SVGElement)) continue

    const computed = getComputedStyle(element)
    for (const property of SVG_PRESENTATION) {
      const value = computed.getPropertyValue(property)
      // Skipping empties keeps the emitted SVG from doubling in size with `fill: ;`
      // noise, and leaves a property the element never had alone.
      if (value !== '') element.style.setProperty(property, value)
    }
  }
}

/** Fails rather than returning a blank image, so the dialog can say what happened. */
export async function renderImage(format: ImageFormat, request: ImageRenderRequest): Promise<Blob> {
  inlineSvgPresentation(request.element)

  const options = {
    width: request.width,
    height: request.height,
    backgroundColor: request.backgroundColor,
    style: {
      width: `${String(request.width)}px`,
      height: `${String(request.height)}px`,
      transform: request.transform,
      transformOrigin: 'top left',
    },
    // The measurement rows React Flow leaves in the DOM, and the on-canvas controls,
    // are chrome rather than diagram. Nothing else is filtered: an element the renderer
    // draws is an element the export shows, or the two have diverged.
    filter: (node: HTMLElement) => {
      const className = typeof node.className === 'string' ? node.className : ''
      return (
        !className.includes('react-flow__minimap') && !className.includes('react-flow__controls')
      )
    },
  }

  if (format === 'svg') {
    // `toSvg` returns a data URL holding an SVG document with the CSS inlined and fonts
    // embedded, which is what makes the file portable. Decoding it back to a Blob keeps
    // one save path for both formats.
    const dataUrl = await toSvg(request.element, options)
    const svg = decodeURIComponent(dataUrl.replace(/^data:image\/svg\+xml;charset=utf-8,/, ''))
    return new Blob([svg], { type: 'image/svg+xml' })
  }

  const blob = await toBlob(request.element, { ...options, pixelRatio: request.pixelRatio ?? 2 })
  // `toBlob` resolves with null when the canvas could not be encoded — usually because
  // the request was still over the browser's limit despite `fitToLimit` in ./limits.
  // Returning it would hand the caller an empty download.
  if (blob === null) {
    throw new Error('The image could not be encoded. Try exporting a smaller diagram.')
  }
  return blob
}
