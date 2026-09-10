# ADR 0002 - elkjs behind a LayoutEngine interface

**Status:** accepted (SRS S6.2, NFR-8.2)

**Decision:** elkjs `layered` for auto-layout, consumed unmodified, hidden behind
`src/layout/LayoutEngine.ts`.

**Rationale:** orthogonal edge routing with computed bend points, plus port support so
connectors attach to the specific FK row rather than the middle of a box. Dagre has
neither.

**Cost:** EPL-2.0 (weak copyleft), and GWT-transpiled Java so it is slow. The interface
makes it replaceable; running it in a Web Worker (NFR-1.4) makes it non-blocking — and
which worker, whose, is not the detail it looks like. See "Corrected" below.

## As built (Stage 7)

The interface is `src/layout/LayoutEngine.ts`; the only implementation is
`ElkLayoutEngine`, reached through `createLayoutEngine()`, which is **async** so the
import is dynamic. Nothing outside `src/layout` may import from `./elk` — that is what
keeps elkjs out of the initial bundle.

Layout of the 120-entity reference schema takes ~840 ms in-process, against NFR-1.4's
5 s budget. The 300-entity stress schema takes ~890 ms. Measured by `pnpm test:perf`.

## Corrected (10 Sep 2026): elkjs owns the worker, not us

The claim above that elkjs "lands in a 1.4 MB worker chunk" and runs off the main thread
described a build artefact, not working software. Auto-layout threw on every click, in dev
and in the production build, from Stage 7 until this was fixed — so "SQL DDL to auto-layout
in one click", the strongest path through the product, had never worked in a browser.

**What was wrong.** `src/layout/worker/layout.worker.ts` was a worker of our own that
imported `elkjs/lib/elk.bundled.js`. That is the _main-thread_ build, and its entire job is
to start a worker of its own; given no `workerFactory` it reaches for
`require('./elk-worker.min.js').Worker`, and `elk-worker.min.js` exports nothing when it is
already inside a worker — it has installed itself as the worker body instead. So
`new ELK()` threw `_Worker is not a constructor` at worker module top level.

**What it is now.** The two halves of elkjs are used as intended, and there is no protocol
of ours in between:

- `elkjs/lib/elk-worker.min.js`, imported with Vite's `?url`, IS the worker — a **classic**
  worker, because it is a browserify script rather than an ES module.
- `elkjs/lib/elk-api.js` drives it from the main thread through `new ELK({ workerUrl })`.

`layout.worker.ts` and `protocol.ts` are deleted; `client.ts` is now just the lazy owner of
one `ELK`, and `worker: { format: 'es' }` has gone from `vite.config.ts` along with the
placeholder `public/elk-worker.js` that promised a build-time copy nothing ever made.

**The decision this ADR records is unaffected**, which is the point worth keeping: the seam
is still `src/layout/LayoutEngine.ts`, elkjs is still consumed unmodified (NFR-8.2), and
`createLayoutEngine()` is still the only way in. Only the threading plumbing behind it
changed.

Measured after the change, in the production build:

|                              | before                            | after                                               |
| ---------------------------- | --------------------------------- | --------------------------------------------------- |
| Entry chunk                  | 717,768 B raw / 222,275 B gzip    | 718,191 B raw / **222,462 B gzip**                  |
| Lazy `ElkLayoutEngine` chunk | 2.89 kB / 1.28 kB gzip            | 6.82 kB / 2.71 kB gzip (elk-api inlined)            |
| elkjs payload                | `layout.worker-*.js`, 1,432,240 B | `elk-worker.min-*.js`, 1,595,334 B / 464,634 B gzip |

NFR-1.8 holds with room to spare: 217 KiB gzipped against a 500 KB budget, and the entry
chunk contains no GWT output at all (`gwtOnLoad`, `$wnd`: zero hits). Nothing elk-related is
requested until the first layout — verified by watching network requests across a click.

**Still unmeasured:** the 120-entity reference schema has never been laid out _in a
browser_. The ~840 ms above is `pnpm test:perf` calling ELK in-process on the test thread.
A four-entity sample takes ~1.06 s in Chrome end-to-end, but almost all of that is fetching
and initialising the 1.6 MB worker, so it says nothing about the algorithm at scale. NFR-1.4
is therefore half-verified: the wiring exists and the main thread is genuinely free, but the
budget has only been checked off-thread. See `NEXT.md`.

Bend points are extracted by `fromElkGraph` but not yet drawn — see the note in
`src/render/reactflow/edges/routing.ts`.
