# ADR 0006 - A repository interface in front of Dexie

**Status:** accepted (Stage 4b)

**Decision:** persistence is reached through `DiagramRepository`, with two
implementations — `DexieDiagramRepository` (IndexedDB) and `InMemoryDiagramRepository`.

**Rationale:** the same reasoning as ADR-0002. Storage is the part of V1 most likely to
change: SRS §9 puts a backend in V3, at which point "save" becomes an HTTP call. With the
seam that is a new implementation of one interface rather than a change to the store.

The in-memory implementation is not a test double. It is the real fallback when IndexedDB
is blocked — private browsing in some browsers, sandboxed origins — where the session
keeps working but cannot survive a reload.

**Consequence:** the two implementations must not drift. Both run the same contract suite
in `tests/unit/persistence/repository-contract.ts`. A suite covering only one would let
them diverge, and the divergence would only show up for the users least able to report it.

**Why not localStorage:** ~5 MB cap, synchronous (so it blocks the main thread and breaks
NFR-1.3's 100 ms interaction budget), and strings only. The reference schema plus a
100-step history plus several saved diagrams exceeds that comfortably.

## Coverage boundary

`fileSystem.ts` is excluded from unit coverage and covered by Playwright instead. File
pickers, downloads and the File System Access API have no meaningful fake; a unit test
there would assert that the mock was called, not that the feature works.
