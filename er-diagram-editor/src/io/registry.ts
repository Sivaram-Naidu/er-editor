// The one file you edit to add a format (NFR-6.4).
//
// See docs/adding-a-format.md. Registering an adapter here is the only wiring a new
// format needs — nothing in domain/, render/, store/ or features/ knows how many exist.

import { mermaidAdapter, mermaidImporter } from './formats/mermaid'
import { nativeJsonAdapter, nativeJsonImporter } from './formats/native-json'
import { sqlImporter } from './formats/sql'
import type { ExportAdapter, ImportAdapter } from './types'

export const exportAdapters: readonly ExportAdapter[] = [
  // Order is the order they appear in the dialog. The lossless format goes first because
  // it is the one that should be used for saving; Mermaid is for handing to someone else.
  nativeJsonAdapter,
  mermaidAdapter,
]

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
