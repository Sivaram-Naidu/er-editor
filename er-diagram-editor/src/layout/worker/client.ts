// Promise-based worker wrapper.

import type { ElkGraph } from '../elk/toElkGraph'
import type { ElkLaidOutGraph } from '../elk/fromElkGraph'

import type { LayoutWorkerRequest, LayoutWorkerResponse } from './protocol'

type Pending = {
  resolve: (graph: ElkLaidOutGraph) => void
  reject: (error: Error) => void
}

/**
 * Owns the worker and matches replies to requests.
 *
 * The worker is created lazily on the first layout, not at module load. Constructing it
 * is what pulls elkjs over the network, so an editor session that never runs auto-layout
 * never pays for it (NFR-1.8).
 */
export class LayoutWorkerClient {
  #worker: Worker | undefined
  #nextId = 1
  readonly #pending = new Map<number, Pending>()

  #ensureWorker(): Worker {
    if (this.#worker !== undefined) return this.#worker

    const worker = new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module' })

    worker.onmessage = (event: MessageEvent<LayoutWorkerResponse>): void => {
      const response = event.data
      const pending = this.#pending.get(response.id)
      if (pending === undefined) return
      this.#pending.delete(response.id)

      if (response.ok) pending.resolve(response.graph)
      else pending.reject(new Error(response.message))
    }

    worker.onerror = (event: ErrorEvent): void => {
      // A worker-level failure kills every request in flight; failing them individually
      // is what lets the caller show a message rather than hang forever.
      const error = new Error(event.message || 'Layout worker failed')
      for (const pending of this.#pending.values()) pending.reject(error)
      this.#pending.clear()
    }

    this.#worker = worker
    return worker
  }

  layout(graph: ElkGraph): Promise<ElkLaidOutGraph> {
    const worker = this.#ensureWorker()
    const id = this.#nextId++

    return new Promise<ElkLaidOutGraph>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject })
      const request: LayoutWorkerRequest = { id, graph }
      worker.postMessage(request)
    })
  }

  dispose(): void {
    this.#worker?.terminate()
    this.#worker = undefined
    for (const pending of this.#pending.values()) {
      pending.reject(new Error('Layout cancelled'))
    }
    this.#pending.clear()
  }
}
