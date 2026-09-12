// The one file you edit to add a format (NFR-6.4).
//
// See docs/adding-a-format.md. Registering an adapter here is the only wiring a new
// format needs — nothing in domain/, render/, store/ or features/ knows how many exist.

import { pngAdapter, svgAdapter } from './formats/image'
import { mermaidAdapter, mermaidImporter } from './formats/mermaid'
import { nativeJsonAdapter, nativeJsonImporter } from './formats/native-json'
import { sqlImporter } from './formats/sql'
import type { ExportAdapter, ImageExportAdapter, ImportAdapter } from './types'

export const exportAdapters: readonly ExportAdapter[] = [
  // Order is the order they appear in the dialog. The lossless format goes first because
  // it is the one that should be used for saving; Mermaid is for handing to someone else.
  nativeJsonAdapter,
  mermaidAdapter,
]

/**
 * Picture formats, kept in their own list.
 *
 * They cannot join `exportAdapters` because they have no `export(diagram)` — an image is
 * produced from the rendered canvas, not from the model (see `formats/image/export.ts`).
 * A union type would let a caller reach for `.export` on something that does not have
 * one; two lists make the difference a compile-time fact.
 */
export const imageExportAdapters: readonly ImageExportAdapter[] = [svgAdapter, pngAdapter]

export const importAdapters: readonly ImportAdapter[] = [
  nativeJsonImporter,
  mermaidImporter,
  sqlImporter,
]

/** Pick an importer from a filename. */
export function findImportAdapterForFile(filename: string): ImportAdapter | undefined {
  const lower = filename.toLowerCase()
  // `.erd.json` before `.json`, and both before a bare extension match, so a native file
  // is never handed to a generic reader.
  return importAdapters.find((adapter) => lower.endsWith(adapter.extension))
}

export function findExportAdapter(id: string): ExportAdapter | undefined {
  return exportAdapters.find((adapter) => adapter.id === id)
}

export function findImageExportAdapter(id: string): ImageExportAdapter | undefined {
  return imageExportAdapters.find((adapter) => adapter.id === id)
}
