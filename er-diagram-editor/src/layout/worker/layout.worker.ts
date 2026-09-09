// Runs ELK off the main thread (NFR-1.4).
//
// elkjs is GWT-transpiled Java and is slow — ADR-0002 accepted that on the condition it
// never blocks input. Everything ELK-related is imported *here*, so the main bundle
// contains none of it until the worker is first constructed (NFR-1.8).

import ELK from 'elkjs/lib/elk.bundled.js'

import type { LayoutWorkerRequest, LayoutWorkerResponse } from './protocol'

const elk = new ELK()

self.onmessage = (event: MessageEvent<LayoutWorkerRequest>): void => {
  const { id, graph } = event.data

  elk
    .layout(graph)
    .then((laidOut: unknown) => {
      const response: LayoutWorkerResponse = {
        id,
        ok: true,
        graph: laidOut as LayoutWorkerResponse extends { graph: infer G } ? G : never,
      }
      self.postMessage(response)
    })
    .catch((error: unknown) => {
      // Reported rather than thrown: an unhandled rejection in a worker surfaces as a
      // silent no-op on the main thread, and a layout button that does nothing with no
      // explanation is the worst outcome available.
      const response: LayoutWorkerResponse = {
        id,
        ok: false,
        message: error instanceof Error ? error.message : 'Layout failed',
      }
      self.postMessage(response)
    })
}
