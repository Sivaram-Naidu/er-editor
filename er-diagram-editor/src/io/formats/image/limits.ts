// How large an image a browser will actually encode.
//
// Split out of export.ts so it stays testable — and inside the coverage gate — without
// dragging in html-to-image and a DOM. Same split as trace.ts against Canvas.tsx.

/**
 * The largest side we will ask a browser to rasterise, in device pixels.
 *
 * Canvas element limits vary by browser and platform (Safari is the tightest, at around
 * 16,384 on a side, and enforces an area limit as well). Past the limit `toBlob` does not
 * throw — it resolves with a blank or truncated image, which is the failure mode most
 * likely to be shipped to someone without being noticed. So we stay well inside it and
 * scale down rather than finding out.
 */
export const MAX_IMAGE_SIDE = 12_000

export interface ImageFit {
  /** Multiply the output size by this. 1 when no scaling is needed. */
  scale: number
  /** True when the image had to be shrunk, so the caller can say so. */
  scaled: boolean
}

/**
 * Scale factor that keeps both sides inside `MAX_IMAGE_SIDE`.
 *
 * `pixelRatio` is part of the calculation, not applied afterwards: a 7,000px-wide diagram
 * is fine at 1x and over the limit at 2x, and the encoder works in device pixels.
 */
export function fitToLimit(width: number, height: number, pixelRatio: number): ImageFit {
  const longest = Math.max(width, height) * pixelRatio
  if (longest <= MAX_IMAGE_SIDE) return { scale: 1, scaled: false }

  return { scale: MAX_IMAGE_SIDE / longest, scaled: true }
}
