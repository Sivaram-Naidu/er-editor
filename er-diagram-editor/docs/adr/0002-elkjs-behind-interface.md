# ADR 0002 - elkjs behind a LayoutEngine interface

**Status:** accepted (SRS S6.2, NFR-8.2)

**Decision:** elkjs `layered` for auto-layout, consumed unmodified, hidden behind
`src/layout/LayoutEngine.ts`.

**Rationale:** orthogonal edge routing with computed bend points, plus port support so
connectors attach to the specific FK row rather than the middle of a box. Dagre has
neither.

**Cost:** EPL-2.0 (weak copyleft), and GWT-transpiled Java so it is slow. The interface
makes it replaceable; the Web Worker (NFR-1.4) makes it non-blocking.

## As built (Stage 7)

The interface is `src/layout/LayoutEngine.ts`; the only implementation is
`ElkLayoutEngine`, reached through `createLayoutEngine()`, which is **async** so the
import is dynamic. Nothing outside `src/layout` may import from `./elk` — that is what
keeps elkjs out of the initial bundle.

Measured: elkjs lands in a 1.4 MB worker chunk; the main bundle grew 1.4 kB gzipped.
A session that never runs auto-layout never downloads it.

Layout of the 120-entity reference schema takes ~840 ms in-process, against NFR-1.4's
5 s budget. The 300-entity stress schema takes ~890 ms. Measured by `pnpm test:perf`.

Bend points are extracted by `fromElkGraph` but not yet drawn — see the note in
`src/render/reactflow/edges/routing.ts`.
