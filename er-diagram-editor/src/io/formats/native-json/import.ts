// .erd.json -> IR, Zod-validated and migrated (FR-6.4, NFR-7.2).

import { parseDiagramDocument } from '../../parseDocument'
import type { ImportResult } from '../../types'

/**
 * Parse a file the user chose.
 *
 * Treated as untrusted: a `.erd.json` can arrive from a colleague, a repository, or a
 * hand edit, and the schema is the only thing standing between a malformed document and
 * a renderer that assumes it is well-formed.
 */
export function importNativeJson(content: string): ImportResult {
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch {
    throw new Error('That file is not valid JSON.')
  }

  const parsed = parseDiagramDocument(raw)
  if (!parsed.ok) throw new Error(`That file is not a valid diagram: ${parsed.problem}`)

  return { diagram: parsed.diagram, warnings: [] }
}
