// Owns the ELK worker (NFR-1.4).
//
// ─────────────────────────────────────────────────────────────────────────────
// ELKJS OWNS THE THREAD, AND IT HAS TO
// ─────────────────────────────────────────────────────────────────────────────
//
// This file used to hand-roll the worker: a `layout.worker.ts` of our own that imported
// `elkjs/lib/elk.bundled.js`, plus a request/response protocol to talk to it. That cannot
// work, and never did — auto-layout threw on every click in dev and in the production
// build, so an imported SQL schema stayed on the placeholder grid.
//
// `elk.bundled.js` is the MAIN-THREAD build, and its whole job is to start a worker of its
// own. Given no `workerFactory` it reaches for the fake in-process one:
//
//   var _Worker = require('./elk-worker.min.js').Worker
//
// and `elk-worker.min.js` decides what to be from its environment:
//
//   if (typeof document === 'undefined' && typeof self !== 'undefined') {
//     self.onmessage = dispatcher.saveDispatch          // "I am the worker body"
//   } else if (typeof module !== 'undefined' && module.exports) {
//     module.exports = { default: FakeWorker, Worker: FakeWorker }
//   }
//
// Inside a real Worker the first branch wins, so nothing is exported, `_Worker` is
// undefined, and `new ELK()` throws `_Worker is not a constructor` at module top level.
//
// So the worker script to run is `elk-worker.min.js` itself — that is what it is for — and
// the API to drive it from the main thread is `elk-api.js`, which does nothing but marshal
// requests to a worker you give it. Both halves are now used as intended, and there is no
// protocol of ours in the middle.
//
// NFR-8.2 (elkjs consumed unmodified, isolated behind an internal interface) is unaffected:
// the seam is `src/layout/LayoutEngine.ts`, and it has not moved.

import ELK, { type ELK as ElkApi } from 'elkjs/lib/elk-api.js'
/*
 * `?url` yields the URL of the emitted asset, not its contents, so importing it costs
 * nothing — the 1.6 MB of GWT-compiled layout code is fetched when the Worker is
 * constructed, and `#ensureElk` makes sure that is on first use rather than at load
 * (NFR-1.8).
 *
 * A CLASSIC worker, which is why this is `?url` and not `?worker`: `elk-worker.min.js` is
 * a plain browserify script that assigns `self.onmessage`, not an ES module. elk-api's
 * default factory is `new Worker(url)` with no `{ type: 'module' }`, which is exactly
 * right; supplying a module worker instead fails to parse it.
 */
import elkWorkerUrl from 'elkjs/lib/elk-worker.min.js?url'

import type { ElkLaidOutGraph } from '../elk/fromElkGraph'
import type { ElkGraph } from '../elk/toElkGraph'

/**
 * Runs ELK off the main thread, one worker per instance.
 *
 * The worker is created lazily on the first layout, not at construction. Creating it is
 * what pulls elkjs over the network, so an editor session that never runs auto-layout
 * never pays for it (NFR-1.8) — note that elk-api builds its Worker inside its own
 * constructor, so `new ELK()` cannot be hoisted to a field initialiser without giving
 * that up.
 */
export class LayoutWorkerClient {
  #elk: ElkApi | undefined

  #ensureElk(): ElkApi {
    this.#elk ??= new ELK({ workerUrl: elkWorkerUrl })
    return this.#elk
  }

  async layout(graph: ElkGraph): Promise<ElkLaidOutGraph> {
    /*
     * ELK returns the graph it was given, with `x`/`y` written onto every child and
     * `sections` onto every edge. `ElkGraph` is deliberately the narrow "what we send"
     * shape and `ElkLaidOutGraph` the narrow "what we read back" one, and elkjs's declared
     * return type is assignable to the latter, so this needs no cast — worth stating,
     * because it did have one until lint pointed out it was doing nothing. `fromElkGraph`
     * treats every coordinate as optional regardless, so a field ELK declines to fill
     * degrades to 0 rather than to arithmetic on `undefined`.
     */
    return this.#ensureElk().layout(graph)
  }

  dispose(): void {
    this.#elk?.terminateWorker()
    this.#elk = undefined
  }
}
