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
pnpm verify        # typecheck + lint + test + build + e2e. Run before saying you are done.
pnpm dev
pnpm test          # unit only, ~55s on this machine
pnpm test:coverage # enforces 80%; NOT part of verify — run it yourself
pnpm test:perf     # layout budgets, slow, run when touching layout or measurement
pnpm test:e2e      # 16 specs on the system Chrome, ~40s. No browser install needed:
                   # playwright.config.ts sets `channel: 'chrome'`. Part of verify.
```

`pnpm verify` must pass. Do not weaken a lint rule, a type, or a coverage threshold to
make it pass — those have caught real bugs repeatedly (see "Things that have gone wrong").

**Run git from the repository root, one level up.** There is a second, stale `.git` inside
`er-diagram-editor/`, frozen at a single old commit. Git commands run from this directory
talk to that one: `git status` claims almost everything is modified, and `git checkout --
<file>` silently reverts a file to months-old content. `cd ..` first, or use `git -C`.

## Architecture, and the rule that enforces it

```
ui  ←  features  ←  store  ←  domain
                 ↑           ↑
             render  ←──── io, layout
```

Each layer's exact allowed imports are the `ALLOWED` map in `eslint.config.js`, with the
reasoning at the point of denial.

**This is enforced by ESLint and by 49 tests** in `tests/unit/architecture/`. Both the
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

**Do not subscribe to the viewport from `features`.** `x`/`y`/`zoom` change on every frame
of a pan, so a selector on them re-renders the editor and re-runs the canvas's node and
edge memos at pointer rate — the exact cost that splitting the viewport into its own store
exists to avoid. Read it imperatively where it is needed: `handleAddEntity` in `Editor.tsx`
calls `useViewportStore.getState()` inside the callback, and says why.

**Culling is why image export has its own canvas.** `onlyRenderVisibleElements` means
off-screen nodes are ABSENT from the DOM, not clipped, so rasterising the live canvas
produces a picture of one screenful. `features/export/ExportSurface.tsx` mounts a second,
off-screen `Canvas` with `cull={false}` for this. It is the only caller allowed to turn
culling off.

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
  rejects. `tests/unit/io/mermaid.test.ts` runs the real parser. Keep it that way. This is
  also why `mermaid` is still in `devDependencies` after being dropped from the bundle —
  it is a test dependency, not dead weight.
- **`useEffect(..., [props])`.** Both dialogs registered their Escape listener this way.
  `props` is a fresh object every render, so the listener was torn down and re-added on
  every keystroke anywhere in the tree. Depend on the field you use, not on `props`.
- **`aria-modal="true"` on a panel with no focus trap.** It announces a boundary that does
  not exist. Modals go through `ui/Dialog` now; do not hand-roll another one.
- **A window-level keydown listener with a modal open.** A focus trap cannot reach it, so
  `e` and `Delete` were still editing the document behind the export dialog. The keymap in
  `Editor.tsx` returns early while `activeDialog` is set.
- **Assuming React Flow applies its own drag.** It does not, in controlled mode — it only
  REPORTS the drag and the consumer must apply it. `settledPositions` dropped every
  in-flight frame on the stated grounds that "React Flow holds the in-flight position
  itself"; that is true of uncontrolled mode only, so nothing applied it and a dragged box
  sat frozen under the cursor until release. A drag now has **two tiers** — in-flight
  positions in local component state, the settled one through the command stack. The note
  is in `trace.ts`.
  - The unit tests all passed. `settledPositions` did exactly what its own tests asked, and
    no test asked whether anything consumed the frames it dropped. A per-function test
    cannot catch a gap BETWEEN two functions; the pair now has its own test.
- **Dropping React Flow's `dimensions` changes.** They were declined on the stated grounds
  that dimensions are "derived from the model". They are not — they are measured from the
  DOM, and `applyNodeChanges` writes them back as `node.measured`. React Flow re-adopts
  nodes by **reference equality**, so every rebuild of the node array handed it objects with
  no `measured` and it forgot the size it had just reported. Consequences, neither of which
  looks like a dimensions bug:
  - `NodeWrapper` renders `visibility: hasDimensions ? 'visible' : 'hidden'`, so every box
    went invisible for ~19 ms after any rebuild — hover, selection, LOD, any edit. A click
    inside that window was never hit-tested against the node; it landed on the pane, so
    `onPaneClick` fired and **clicking a table cleared the selection instead of making
    one**.
  - The minimap reads the **user** node's size, not the internal one, so
    `nodeHasDimensions` was false forever and it drew nothing at all. The `nodeColor` prop
    is about fill colour and was never the reason it looked empty.
  - There are now three tiers in `trace.ts`, not two, and a test on the trio: every change
    React Flow emits must be claimed by exactly one of them. Same shape of gap as the drag
    teleport above — each function was right on its own, and nothing asked what happened to
    what they declined.
- **`elkjs/lib/elk.bundled.js` cannot run inside a Web Worker.** It is the main-thread
  build, and its job is to start a worker of its own: with no `workerFactory` it does
  `require('./elk-worker.min.js').Worker`, and `elk-worker.min.js` decides what to be from
  `typeof document === 'undefined' && typeof self !== 'undefined'` — true inside a worker, so
  it installs itself as the worker body and exports nothing. `new ELK()` then throws
  `_Worker is not a constructor` at worker module top level. Auto-layout has therefore never
  worked in a browser, in dev or in production, while `pnpm test:perf` happily measured the
  algorithm in-process on the test thread. **Fixed 10 Sep 2026** by letting elkjs own the
  thread: `elk-api.js` on the main thread driving `elk-worker.min.js` — imported with
  Vite's `?url` — as a **classic** worker. It is a browserify script, not an ES module, so
  `{ type: 'module' }` will not load it; `workerUrl` alone is enough, because elk-api's
  default factory is already `new Worker(url)`. `tests/unit/architecture/elk-entry-points.test.ts`
  now fails if `elk.bundled.js` is imported from `src/` again — worth knowing that the
  main-thread placement of it is the _silent_ failure, since it works by blocking the UI in
  an in-process fake worker and would pass every test here. See ADR-0002 "Corrected".
- **A hook that reads a prop, called in the same tick as the state change it should react
  to.** `Editor.tsx` did `load(imported); autoLayout.run()`. `run` closes over the
  `diagram` PROP, so it arranged the document being replaced — on a fresh session the empty
  one, which `ElkLayoutEngine` short-circuits, so auto-layout on import was a silent no-op:
  no worker, no error, no positions. The store was already correct; React had simply not
  re-rendered yet. `run` now takes the document to arrange, and the caller passes it
  explicitly. Anything that loads and then acts on what it loaded has this shape — pass the
  value, do not re-read it.
- **Playwright's `locator.click()` cannot catch a visibility bug**, because its actionability
  checks wait for the element to be visible before pressing. The 19 ms window above is
  politely waited out and the click passes. Interaction specs on this canvas use raw
  `mouse.move` / `down` / `up` with no pause between the move and the press — see
  `coldClick` in `tests/e2e/helpers.ts`. Related: `test.fail()` outside a test body marks
  every test in the file.
- **Four ELK options that sound like they fix a wide layer and do nothing.** A table
  referenced by forty others puts all forty at one dependency depth, and `layered` stacks a
  depth into one column — 838x21134px, a ribbon unreadable at any zoom or detail level.
  `elk.aspectRatio`, `elk.layered.wrapping.strategy`,
  `elk.layered.highDegreeNodes.treatment` and `nodePlacement.strategy: NETWORK_SIMPLEX` all
  produce **byte-identical** output on it — verified against a sanity check that
  `elk.spacing.nodeNode` DOES change the output, so the options were reaching ELK.
  `wrapping.strategy` is the trap: it wraps a long chain of LAYERS into rows, and the
  problem is one layer with too many nodes IN it. The fix layers the graph ourselves and
  hands ELK partitions — `src/layout/elk/wideLayers.ts`. Two halves of it are easy to lose:
  - **`nodePlacement.strategy` must become `SIMPLE`, or partitioning buys almost nothing**
    (21134 → 19125px). The default `BRANDES_KOEPF` aligns nodes with their edges to
    straighten them, so it spreads the forty dependents back across the hub's whole edge
    fan. Applied only when a split happens — straight edges are worth having otherwise.
  - **Layer by dependency depth, not breadth-first distance from the hub.** BFS numbers a
    dependency chain backwards, so the chain reads right-to-left while the rest of the
    diagram reads left-to-right — the one thing ADR-0002 chose a layered algorithm for.
    There is a test asserting a chain keeps its order.
- **A test that feeds its own estimate back in cannot validate the estimate.**
  `tests/unit/layout` had a spec named "produces no overlapping boxes" whose comment
  claimed "if the measurements in measure.ts drift away from what canvas.css draws, this is
  what catches it". It passed `measureAll` output to ELK and then checked for overlap using
  _that same output_, so all it ever asserted was that ELK honoured the sizes it was given.
  No unit test can do better here — jsdom performs no layout, so there is no rendered height
  to disagree with. `tests/e2e/measurement.spec.ts` compares the estimate against
  `offsetHeight` in Chrome, which is the only place the two can disagree.
- **`measure.ts`'s constants have to be MEASURED, not read off canvas.css by eye.** The
  previous set was wrong about the header (36 vs 38), the add-field row (24 vs 27), the "N
  more" row (folded into the add row, actually 30), the border (uncounted, and 2px or 4px
  depending on selection and validation state), and both width clamps (320/168 against a
  stylesheet that says 300/160/120). Two related traps:
  - **A flat per-row height under-measures at scale.** The true rate is ~27.37px, not 27,
    because every row after the first adds a 1px rule to a 26.3px line box. A flat 27 looks
    correct on a five-row table and under-measures a 60-column one by 22px — so the error
    only appears on the wide tables real schemas have. `tests/fixtures/wide-names.sql` keeps
    a 60-column table for exactly this, and there is a unit guard on the rate.
  - **Bias every constant so the estimate comes out LARGE.** Too big spaces boxes slightly
    further apart than needed; too small makes ELK stack them.
- **`text-overflow: ellipsis` does nothing on a flex item without `min-width: 0`.** A flex
  item's default `min-width: auto` refuses to shrink below its content, so the name overflows
  the box and the ellipsis never appears. This is why rows can be pinned to one line at all,
  and pinning them is what makes the flat row height in `measure.ts` true by construction
  rather than by calibration — while a name could wrap, no fixed per-character width could
  predict the height, because where a name breaks depends on its glyphs (measured 6.2 to
  10.2 px per character on real column names) rather than on its length.
- **React Flow passes a node's POSITION to the node component as a prop.** `NodeWrapper`
  renders `<NodeComponent … positionAbsoluteX positionAbsoluteY …>`, so `memo(EntityNode)`
  with the default comparison re-renders the whole box — header, every attribute row, every
  badge, every per-row handle — whenever the box moves, even though the wrapper above it is
  what applies the CSS transform. Free while one box is dragged; ruinous when a layout
  lands and all of them move at once: 120 `EntityNode` and **1,920 `AttributeRow`** renders
  for the 120-entity reference schema. `sameEntityNode` declines those two props and
  compares everything else. For it to hold, `Canvas` must also keep the Set and the Map
  inside `node.data` reference-stable across a move — both are memoised on
  `diagram.entities`, not on `diagram`, because Immer's structural sharing means a
  position-only command hands back the SAME entities array. `traceSets` returns a shared
  `NOTHING_TRACED` for the same reason. The defect is invisible from either side: the
  diagram renders identically, only the cost differs, so the test is on the pair
  (`tests/unit/render/redraw.test.tsx`).
- **`startTransition` cannot break up an update that comes from a Zustand store.** React
  de-opts a transition containing a `useSyncExternalStore` read to synchronous rendering, to
  avoid tearing — so wrapping `execute(applyLayout(…))` in `startTransition` time-slices
  nothing. Measured, not assumed: identical block durations at 120 and 300 entities. Every
  store here is Zustand, so this applies to all of them.
- **Measure performance against the production build, not `pnpm dev`.** NFR-1.4's
  main-thread numbers sat in the SRS for a day as 323/142/473 ms; the same clicks against
  `vite preview` gave 51/62/96 ms. React's development build — `jsxDEV`, prop validation,
  StrictMode's double render — was most of what was being measured. Use `vite preview`, and
  take the median of at least three runs: single runs on this canvas vary by ±20 ms.
- **Three separate ways to ship a broken image export.** All three produced a file, none
  threw, and all three passed every check a unit test can make. See `docs/SRS.md` §13.1.
  - `useStore(s => s.nodesInitialized)` is a **stale flag**. React Flow recomputes it only
    in `setNodes` — before measurement — and never again. Derive from `nodeLookup`, which
    measurement does update (`updateNodeInternals` calls `set({})` for exactly this).
  - **html-to-image carries the captured element's own computed styles into the clone.**
    Capturing the off-screen wrapper took `left: -100000px` with it and produced a blank
    image. Capture a statically positioned child; that is why `ExportSurface` has two divs.
  - **html-to-image styles `HTMLElement` only, and `SVGElement` is not one.** All SVG in a
    capture loses its CSS and falls back to `fill: black`. `inlineSvgPresentation` in
    `io/formats/image/export.ts` copies it across by hand.

## Testing conventions

- **The suite default is `node`.** Files that mount components opt back UP with
  `@vitest-environment jsdom` on line 1. It used to be the other way round, and all 24
  files paid for jsdom whether they touched the DOM or not. Note what this did and did not
  buy: ~110s of aggregate environment setup and the memory of 16 needless jsdom instances,
  but almost nothing on the wall clock — those setups ran in parallel across workers, and
  the run is dominated by per-file worker spawn. Do not expect the run to get faster;
  expect it not to get slower as suites are added.
- Vitest takes `*.test.ts`; Playwright takes `*.spec.ts`. They must not overlap.
- Non-null assertions are allowed **in tests only** — there, `entities[0]!` _is_ the
  assertion. `src/` keeps the rule.
- Prefer testing against the real library over a mock: real ELK for layout, real Mermaid
  for export, `fake-indexeddb` for Dexie. Each has caught something a mock would not.
- Coverage exclusions in `vite.config.ts` each carry a reason. Not-yet-written modules are
  listed individually so the gate rises as they land, rather than being lowered to
  accommodate them.
- **An exclusion that defers to `tests/e2e` is a promise, so check the promise is kept.**
  Both of the standing ones turned out to be empty: `Canvas.tsx` deferred pointer behaviour
  to a suite that had never been executed (five interaction bugs shipped under it), and
  `src/layout/worker/**` was excluded because it "constructs a real Worker" — which does not
  work. If you exclude a module, add the e2e spec in the same change.

## What to do next

**Read `NEXT.md` first.** It is the working queue: what is broken right now, what has
already been diagnosed (so you do not redo it), the tiers in priority order with the
reasoning, and the recipe for driving the real app in a browser. Update it when you finish
something.

`docs/SRS.md` §13 remains the requirement-level view of what is unbuilt, and §13.1 holds
the standing caveat that nothing has been tested against a real schema. Requirement status
lives in the SRS; sequencing lives in `NEXT.md`. Do not start a third list.

## Where the reasoning lives

- `docs/SRS.md` — requirements, and §2 for why compact notation is the default over Chen.
- `docs/adr/` — six decision records: React Flow, elkjs behind an interface, the command
  pattern, LOD rendering, the Stage 1 version deviations, the repository seam.
- `docs/mermaid-mapping.md` — what Mermaid export can and cannot represent.
- `docs/adding-a-format.md` — the recipe for a new import/export adapter.
- `docs/SRS.md` §7.3 — why image export does not fit the `ExportAdapter` interface, and why
  that is deliberate rather than a leak.
- `NEXT.md` — the working queue: what is broken, what is diagnosed, what to do next.
- `UPGRADING.md` — scripts and the stale-file hazard.
