// Image adapter registration (FR-6.5).

import type { ImageExportAdapter } from '../../types'

import { imageCapabilities } from './capabilities'

/**
 * Both formats share one capability set, because both are pictures of the same render.
 *
 * The difference between them is what happens after the file lands: SVG stays sharp at
 * any size and its text is selectable and searchable, which is what you want in a
 * document or a wiki. PNG is a bitmap, which is what you want when the destination is a
 * chat window or a tool that will not render SVG. SVG goes first because for a schema
 * diagram it is almost always the better answer.
 */
export const svgAdapter: ImageExportAdapter = {
  id: 'svg',
  format: 'svg',
  label: 'SVG image',
  extension: '.svg',
  mimeType: 'image/svg+xml',
  capabilities: imageCapabilities,
  note: 'An image cannot be opened back into the editor. Keep the .erd.json if this diagram is still being worked on.',
}

export const pngAdapter: ImageExportAdapter = {
  id: 'png',
  format: 'png',
  label: 'PNG image',
  extension: '.png',
  mimeType: 'image/png',
  capabilities: imageCapabilities,
  note: 'An image cannot be opened back into the editor. Keep the .erd.json if this diagram is still being worked on.',
}

export { imageCapabilities, imageExplanations } from './capabilities'
export { renderImage, type ImageFormat, type ImageRenderRequest } from './export'
export { MAX_IMAGE_SIDE, fitToLimit, type ImageFit } from './limits'
