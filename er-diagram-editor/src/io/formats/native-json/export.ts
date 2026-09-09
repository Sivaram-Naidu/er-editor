// IR -> .erd.json. Lossless save format (FR-6.4).

import type { Diagram } from '../../../domain'
import type { ExportResult } from '../../types'

/**
 * The whole document, verbatim.
 *
 * Indented rather than minified: an `.erd.json` sitting in a repository is going to be
 * diffed and occasionally hand-edited, and a single-line file is useless for both. The
 * size cost is recovered by transport compression.
 */
export function exportNativeJson(diagram: Diagram): ExportResult {
  return { content: `${JSON.stringify(diagram, null, 2)}\n`, lossReport: [] }
}
