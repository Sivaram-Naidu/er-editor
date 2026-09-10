# ER Diagram Editor

A browser-based ER diagram editor built for schemas that are too big to read as pictures —
100+ entities, drawn in compact crow's-foot notation, with level-of-detail rendering so the
drawn element count tracks screen area rather than schema size.

**V1 is single-user, offline-capable, and has no backend.** Every diagram lives in the
browser's IndexedDB and in files you download or open from local disk. There are no
accounts, no server, and no network calls beyond fetching the app's own assets.

## Quick start

```bash
pnpm install
pnpm dev            # http://localhost:5173
```

Requires Node 20+ and pnpm 12 (`packageManager` in `package.json` pins the exact version).

## What it does

| Area           | Capability                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Authoring**  | Entities, weak entities, attributes with types and constraints, foreign keys, binary and self-referencing relationships.              |
| **Canvas**     | Drag-to-connect, inline rename, hover-to-trace one hop out, minimap, viewport culling, three levels of detail driven by zoom.         |
| **Layout**     | Automatic layered layout via elkjs in a worker, so a 300-entity arrange does not block input.                                         |
| **Validation** | Eight rules — missing primary keys, orphan entities, duplicate names, FK type mismatches, weak-entity identity — in a problems panel. |
| **Undo**       | Every model and layout mutation is a command; 100 steps, with compound operations undoing as one.                                     |
| **Import**     | `.erd.json`, Mermaid `.mmd`, and SQL DDL (`.sql`, PostgreSQL and MySQL). Formats without coordinates get auto-laid out on open.       |
| **Export**     | `.erd.json` (lossless, the save format), Mermaid `.mmd`, and PNG / SVG. Every export reports exactly what the format could not hold.  |
| **Storage**    | IndexedDB via Dexie, with debounced autosave and an in-memory fallback where IndexedDB is unavailable.                                |

Per-requirement status — Done, Partial, or Open, with the gap stated for each Partial —
is the table in [`docs/SRS.md`](docs/SRS.md) §4.

## Commands

```bash
pnpm dev            # dev server
pnpm build          # tsc -b && vite build
pnpm verify         # typecheck + lint + test + build. The gate; run it before you push.

pnpm test           # unit tests
pnpm test:watch
pnpm test:coverage  # enforces 80% on domain, io, store, persistence, lib, render, features
pnpm test:perf      # layout budgets — slow and machine-dependent, run when touching layout
pnpm test:e2e       # needs `pnpm exec playwright install chromium` first

pnpm lint           # eslint, including the layer-boundary rules
pnpm format         # prettier
```

## How it is put together

```
ui  ←  features  ←  store  ←  domain
                 ↑           ↑
             render  ←──── io, layout
```

- **`domain/`** — the internal representation and everything that reasons about it: Zod
  schemas, the command stack, graph indexes, validation rules. No React, no DOM; runs
  under plain Node.
- **`io/`** — import and export adapters behind one interface, with a declared capability
  set per format that drives the loss report.
- **`layout/`** — elkjs behind a `LayoutEngine` interface, driven from a worker.
- **`render/`** — React Flow host, entity/edge components, notation sets.
- **`store/`** — Zustand stores, deliberately split: the model, the selection, the
  viewport, and UI state are separate so pointer-rate updates do not re-render tables.
- **`features/`** — the assembled surfaces: editor shell, inspector, dialogs, panels.
- **`persistence/`** — Dexie repository behind a seam, plus the File System Access calls.

Those arrows are not a suggestion. They are enforced by ESLint rules generated from the
`ALLOWED` map in `eslint.config.js` and by the tests in `tests/unit/architecture/`, in both
the relative (`../render/x`) and alias (`@/render/x`) import forms.

Two rules matter more than the rest, and breaking either produces bugs that are hard to
trace back:

1. **Every model mutation goes through a command** (`domain/commands/`). Nothing else may
   produce a new `Diagram`. A mutation that bypasses the stack leaves a hole in the undo
   history that silently restores a state the user never saw.
2. **Attributes are keyed by stable id, never by name**, so renaming a column cannot break
   a foreign key that references it.

## Where the reasoning lives

| Document                                             | What is in it                                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [`CLAUDE.md`](CLAUDE.md)                             | Working notes: the non-negotiables, the performance shape, and the traps that have caught people. |
| [`docs/SRS.md`](docs/SRS.md)                         | Requirements with status, §2 for why compact notation beats Chen at scale, §13 for what remains.  |
| [`docs/adr/`](docs/adr/)                             | Six decision records: React Flow, elkjs behind an interface, the command pattern, LOD, the seam.  |
| [`docs/file-format.md`](docs/file-format.md)         | The `.erd.json` format and its versioning.                                                        |
| [`docs/mermaid-mapping.md`](docs/mermaid-mapping.md) | What Mermaid export can and cannot represent, construct by construct.                             |
| [`docs/adding-a-format.md`](docs/adding-a-format.md) | The recipe for a new import/export adapter — one directory plus one registry line.                |
| [`UPGRADING.md`](UPGRADING.md)                       | Applying a stage archive, and the stale-file hazard it creates.                                   |

## Stack

React 19 + TypeScript (strict, with `exactOptionalPropertyTypes`), Vite, React Flow
(`@xyflow/react`) for the canvas, elkjs for layout, Zustand for state, Immer for the
command stack's patch-derived inverses, Zod as the source of truth for the model types,
Dexie for IndexedDB, Tailwind for utility styling over hand-written component CSS,
Vitest + Testing Library for unit tests, Playwright for the paths jsdom cannot reach.

The justification for each choice is in `docs/SRS.md` §6 and the ADRs.
