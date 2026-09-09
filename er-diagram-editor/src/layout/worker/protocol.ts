// Messages exchanged with the layout worker.
//
// Structured-cloneable only: no class instances, no functions. The diagram is not sent —
// only the graph ELK needs — which keeps the copy small at 120 entities.

import type { ElkGraph } from '../elk/toElkGraph'
import type { ElkLaidOutGraph } from '../elk/fromElkGraph'

export interface LayoutWorkerRequest {
  id: number
  graph: ElkGraph
}

export type LayoutWorkerResponse =
  { id: number; ok: true; graph: ElkLaidOutGraph } | { id: number; ok: false; message: string }
