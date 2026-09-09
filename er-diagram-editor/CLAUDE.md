# ER Diagram Editor — working notes

Read this before changing anything. It carries the decisions and the traps; the reasoning
behind each is in the file it concerns.

## What this is

A browser-based ER diagram editor. **V1 is single-user, offline-capable, and has no
backend** — everything lives in IndexedDB and in files the user downloads. That constraint
is deliberate and shapes a lot of the design; do not add a server without discussing it.

Full requirements: `docs/SRS.md`. Requirement ids (FR-1.4, NFR-2.4) are referenced
throughout the source — when you touch code that cites one, read it.

## Commands

```bash
pnpm verify        # typecheck + lint + test + build. Run this before saying you are done.
pnpm dev
pnpm test          # unit only, ~30s
pnpm test:coverage # enforces 80%; the build fails below it
pnpm test:perf     # layout budgets, slow, run when touching layout or measurement
pnpm test:e2e      # needs `pnpm exec playwright install chromium` first
```

`pnpm verify` must pass. Do not weaken a lint rule, a type, or a coverage threshold to
make it pass — those have caught real bugs repeatedly (see "Things that have gone wrong").

## Architecture, and the rule that enforces it

```
ui  ←  features  ←  store  ←  domain
                 ↑           ↑
             render  ←──── io, layout
```

- `domain/` — pure TypeScript. No React, no DOM, no rendering library. Unit-testable
  under plain Node. This is where the model, the commands and the graph queries live.
- `io/` — import/export adapters. Imports `domain` only.
- `layout/` — elkjs, behind an interface. Imports `domain` only.
- `render/` — React Flow canvas and notation. Imports `domain` and `layout`.
- `persistence/` — Dexie/IndexedDB. Imports `domain` and `io`.
- `store/` — Zustand. Imports `domain` and `persistence`.
- `features/` — may import anything below it.
- `lib/` and `ui/` — leaves, importable anywhere, importing nothing but each other.

**This is enforced by ESLint and by 48 tests** in `tests/unit/architecture/`. Both the
relative form (`../render/x`) and the alias form (`@/render/x`) are checked, because the
first rule alone silently misses the second.

If the boundary rule fires, the import is usually the symptom and the layering is the
bug. It has twice pointed at something genuinely misplaced rather than being an obstacle:
`parseDiagramDocument` belonged in `io`, not `persistence`; the LOD vocabulary belonged in
`lib`, not `render`.

## Non-negotiables

**Every model mutation goes through a command.** `src/domain/commands/`. Nothing else may
produce a new `Diagram`. A mutation that bypasses the stack leaves a hole in the undo
history that silently restores a state the user never saw. If you are reaching for
`set({ diagram: ... })`, stop.

Commands supply only `mutate(draft)`. The inverse is derived from Immer patches — do not
hand-write an `invert`. `enablePatches()` is called in `CommandStack.ts`; Immer does not
enable it by default and fails at runtime, not compile time.

**`exactOptionalPropertyTypes` is on and stays on.** `{ comment: undefined }` is not
assignable to `{ comment?: string }`. Use the `optional()` helper in
`domain/model/factory.ts`, or a conditional spread. It keeps the persisted JSON free of
stray keys. If a specific field becomes genuinely awkward, flag it rather than relaxing
the flag.

**Zod `.default()` vs `.prefault()`.** Zod 4's `.default()` short-circuits parsing — the
value is never validated and nested defaults never run. The rule and the reason for every
field is documented in the header of `domain/model/schema.ts`. Read it before adding a
field; getting this wrong produces a type that lies about runtime.

**The schema validates structure, not modelling quality.** Empty names, missing primary
keys and orphan entities all parse — the editor must be able to hold a half-finished
model. Referential integrity is the exception and IS enforced, because a dangling
reference makes a document unloadable. Modelling-quality checks belong in
`domain/validation/`.

**Attributes are keyed by stable id, never by name.** Renaming a column must not break the
foreign key referencing it.

## Performance shape

The three mechanisms that make 100+ tables viable, in `docs/adr/0004-lod-rendering.md`:

1. **Level of detail** — L0 name only, L1 keys, L2 all fields, driven by zoom with
   hysteresis. Without it, 120 entities is ~1,000 DOM nodes at all times.
2. **Viewport culling** — `onlyRenderVisibleElements` on React Flow.
3. **Split stores** — hover fires at pointer rate and lives in `selectionStore`, apart
   from the model. Merging them re-renders every table on every pointer move.

If you change `measure.ts`, run `pnpm test:perf`. The measurements must track what
`canvas.css` actually draws, or ELK overlaps boxes. There is a no-overlap test that
catches this.

Editing callbacks reach canvas nodes through **context**, not `node.data`. React Flow
rebuilds `data` on every change; callbacks there defeat the `memo` on `EntityNode`.

## Things that have gone wrong before

- **Counting Immer patches to detect a no-op.** The `updatedAt` stamp emits no patch when
  the clock has not moved, so real edits looked like no-ops. Inspect patch _paths_.
- **`role="menu"` around a textbox.** A menu may not contain one. It also made the buttons
  invisible to a `getByRole('button')` query — which is what a screen reader experiences.
- **Hint text inside a `<label>`.** It joins the accessible name: "RoleDistinguishes the
  two ends…". Hints go outside, attached with `aria-describedby`.
- **`setState` in an effect.** Two occurrences, both flagged by lint, both real races.
  Derive during render, or guard against a stale async response.
- **A test that reimplemented the code it tested.** `connect.test.ts` copy-pasted logic out
  of `Editor.tsx` and would have passed forever. Extract and import the real thing.
- **Substring assertions on generated Mermaid.** They pass happily on a file Mermaid
  rejects. `tests/unit/io/mermaid.test.ts` runs the real parser. Keep it that way.
- **A tar extract leaving a renamed file behind.** `tests/unit/architecture/no-stale-files.test.ts`
  catches this. Not relevant once the project is in git.

## Testing conventions

- DOM-free suites declare `@vitest-environment node` at the top. jsdom costs ~1s per file.
- Vitest takes `*.test.ts`; Playwright takes `*.spec.ts`. They must not overlap.
- Non-null assertions are allowed **in tests only** — there, `entities[0]!` _is_ the
  assertion. `src/` keeps the rule.
- Prefer testing against the real library over a mock: real ELK for layout, real Mermaid
  for export, `fake-indexeddb` for Dexie. Each has caught something a mock would not.
- Coverage exclusions in `vite.config.ts` each carry a reason. Not-yet-written modules are
  listed individually so the gate rises as they land, rather than being lowered to
  accommodate them.

## Current state

Working: entity/attribute/relationship authoring (drag, click-to-connect, or panel),
undo/redo, auto-layout (elkjs in a worker, lazy-loaded), zoom-driven LOD, hover-to-trace
highlighting, autosave and session recovery, multiple saved diagrams, export to Mermaid
and native JSON, import from `.sql` (PostgreSQL/MySQL), `.mmd` and `.erd.json`.

~535 tests, ~91% coverage.

## What to do next

In priority order, with the reasoning:

1. **Validation panel.** `domain/validation/` has `Rule.ts`, `validator.ts` and five rule
   files as stubs; the panel at `features/validation-panel/` is a stub too. FR-8.1 to
   FR-8.4. Highest value because the code already "knows" about problems the user cannot
   see — an unnamed field, a missing primary key, an orphan table.
2. **Search / command palette (`Ctrl+K`).** FR-2.6, FR-9.2. `fuse.js` and `cmdk` are
   already dependencies. At 100 tables this is worth more than everything below it.
3. **Edges attaching to the FK row** rather than box centres. Per-row handles exist but
   edges ignore them; needs a fallback for L0/L1 where those handles are not rendered.
4. Marquee select (FR-2.9); isolate mode (FR-2.8 — `nHopNeighbourhood` is written and
   tested, just unwired); expanding one entity via the "N more" row; PNG/SVG export
   (FR-6.5); DBML export (one directory plus a registry line).

Deferred to V2 by design, with slots reserved in the IR: n-ary relationships, ISA
hierarchies, subject areas, snapshots and diff.

**Two caveats worth acting on early.** Nothing has been tested against a real 100-table
schema — the performance fixtures are synthetic, with uniform table sizes and tidy
relationships. And `pnpm test:e2e` has never actually been executed; four tests are
written and waiting on `playwright install`.

## Where the reasoning lives

- `docs/SRS.md` — requirements, and §2 for why compact notation is the default over Chen.
- `docs/adr/` — six decision records: React Flow, elkjs behind an interface, the command
  pattern, LOD rendering, the Stage 1 version deviations, the repository seam.
- `docs/mermaid-mapping.md` — what Mermaid export can and cannot represent.
- `docs/adding-a-format.md` — the recipe for a new import/export adapter.
- `UPGRADING.md` — scripts and the stale-file hazard.
