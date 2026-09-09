// Turning a chosen file into a diagram (FR-6.8).
//
// Kept out of the component so the routing and the dialect handling are testable without
// a file picker.

import type { Diagram } from '../../domain'
import { findImportAdapterForFile, importSql, type SqlDialect } from '../../io'

export interface ImportOutcome {
  diagram: Diagram
  warnings: string[]
}

export interface ImportFileOptions {
  filename: string
  content: string
  /** Only consulted for `.sql`. `auto` sniffs the script's own fingerprints. */
  dialect: SqlDialect | 'auto'
}

/**
 * Route a file to its importer.
 *
 * `.sql` is special-cased because it is the only format with an option. Everything else
 * goes through the registry, so adding a format needs no change here.
 *
 * Throws with a readable message rather than returning a result type: every caller shows
 * the message to the user, and there is nothing sensible to do with a half-read file.
 */
export function importFile(options: ImportFileOptions): ImportOutcome {
  const { filename, content } = options

  if (filename.toLowerCase().endsWith('.sql')) {
    const name = filename.replace(/\.sql$/i, '')
    return importSql(content, { dialect: options.dialect, diagramName: name })
  }

  const adapter = findImportAdapterForFile(filename)
  if (adapter === undefined) {
    throw new Error(`Cannot read "${filename}". Supported files are .erd.json, .mmd and .sql.`)
  }

  const result = adapter.import(content)
  return { diagram: result.diagram, warnings: result.warnings }
}

/** Whether an imported diagram needs arranging — only the native format carries layout. */
export function needsLayout(diagram: Diagram): boolean {
  return Object.keys(diagram.layout.positions).length === 0 && diagram.entities.length > 1
}
