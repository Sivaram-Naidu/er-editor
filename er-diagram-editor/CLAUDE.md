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
pnpm test:perf:browser
                   # NFR-1.3 / NFR-1.4 in Chrome against `vite preview`, ~2 min. Its own
                   # playwright.perf.config.ts, because these MUST measure the production
                   # build. Not in verify — wall-clock assertions are a command you run.
pnpm test:e2e      # 16 specs on the system Chrome, ~40s. No browser install needed:
                   # playwright.config.ts sets `channel: 'chrome'`. Part of verify.
```

`pnpm verify` must pass. Do not weaken a lint rule, a type, or a coverage threshold to
make it pass — those have caught real bugs repeatedly (see "Things that have gone wrong").

**The repository root is `Er_tool/`, one level up — git works from anywhere now.** There
used to be a second, stale `.git` inside `er-diagram-editor/`, frozen at a single old
commit, and git run from this directory talked to THAT one: `git status` claimed almost
everything was modified, and `git checkout -- <file>` silently reverted a file to
months-old content. It did exactly that to `useAutoLayout.ts` on 11 Sep 2026, dropping 25
lines. **Deleted 12 Sep 2026**, after verifying every one of the 216 files it tracked was
also tracked by the real repo. If an editor or a tool ever reports ~126 modified files
here again, a second `.git` has come back — look for it before believing the count.

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

**What level a box draws at is decided once, by `effectiveLod` in `lib/lod.ts`.** Both
callers matter and the second is easy to forget: the renderer uses it to decide what to
draw, and `layout/measure.ts` uses it to decide how big to tell ELK the box is. A pinned
entity (FR-2.7) draws every field at any zoom, so a `measureAll` that ignores the pin sizes
it at three rows while the browser draws fifteen and the next auto-layout puts its neighbour
underneath it. That is why the function lives in `lib` rather than in `render` — `layout`
may not import `render`, and re-deriving the rule there would be the second place that
decides the same thing.

**Every shortcut that runs a command is also a palette command.** FR-9.2's wording is
"exposing every command", and for a while it was not: the keymap bound copy, cut, paste,
duplicate and Escape and the Ctrl+K palette offered none of them. Types cannot close it —
the palette also carries commands with no key (Export, Detail, Theme), so the implication
runs one way — and the list stays hand-built in `Editor.tsx` on purpose, because that
component already owns every handler and every disabled condition. The guard is a pair test
in `tests/unit/app/app.test.tsx` that opens the palette and requires a row for every chord
the keymap answers to. Adding a shortcut means adding a palette entry, or that test fails
by name.

**Keyboard shortcuts are declared once, in `features/editor/shortcuts.ts`.** That table IS
the keymap: the window handler dispatches from it, the `?` sheet renders it, and the Ctrl+K
palette formats its hints from the same `Chord` objects. A hand-written row in the sheet is
a second description of behaviour, and the failure is silent — the reference teaches a key
nothing is bound to. `ShortcutId` plus a `Record<ShortcutId, () => void>` in `Editor.tsx`
makes the id side a type error; the one thing types cannot see, two entries claiming the
same chord, has a test. Two details are easy to get wrong and both are load-bearing:
`Ctrl+Z` declares `shift: false` or `Ctrl+Shift+Z` matches it first and redo is unreachable,
and `?` must leave `shift` unconstrained, because the CHARACTER already encodes Shift and
does so differently across layouts.

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
  - There are now FOUR tiers in `trace.ts`, and a test on the set: every change React Flow
    emits must be claimed by exactly one of them. Same shape of gap as the drag teleport
    above — each function was right on its own, and nothing asked what happened to what
    they declined.
- **And `select` changes were the third instance of it.** Dropping them is right for a
  CLICK — the store owns the selection, and React Flow reads Shift as its marquee key
  rather than its multi-select key, so its opinion of a shift-click fights ours. It is
  wrong for a MARQUEE: only React Flow knows what the rubber band covered, because it owns
  the band, the pointer capture, the viewport transform and the hit test. So Shift+drag
  drew a perfect rectangle and selected nothing, for as long as the feature was "not built
  yet". `applySelectionChanges` accepts them, and only between `onSelectionStart` and
  `onSelectionEnd`. Two details:
  - **React Flow emits selection DELTAS, not the covered set.** `getSelectionChanges`
    compares the band's new answer with its previous one, so the batch that adds the fifth
    box says nothing about the first four. Reading the latest batch selects one box out of
    five and looks almost right. Accumulate.
  - **`selectionMode` defaults to `Full`**, which asks the band to contain a box entirely.
    At 200px-wide tables a band drawn across a row of them selects nothing. `Partial`.
- **React Flow SILENTLY skips an edge whose source or target is not in `nodeLookup`.** No
  console error, no warning, no throw — checked by removing the edge filter that isolate
  mode (FR-2.8) applies and comparing the rendered edge count, the console and the warnings
  with it in place. Two consequences, in opposite directions: handing it a partial node
  list is safe, so a view that hides nodes does not have to hide their edges to avoid a
  line to nowhere; and a filter that exists to prevent one is guarding nothing, so do not
  write a test claiming it does. The filter in `Canvas.tsx` is kept for what it saves in
  edge objects BUILT — at the 300-entity ceiling, several hundred thrown away to draw two —
  and its comment says exactly that.
- **A marquee leaves a pointer-events DEAD ZONE behind it.** React Flow follows one by
  rendering `.react-flow__nodesselection-rect` around the bounding box of the selection, as
  a handle for dragging the group, and it is `pointer-events: all` over its whole area.
  With two tables selected it measured 771x272px and `elementFromPoint` on the connector
  between them returned the handle, not the connector. There is no prop: `nodesSelectionActive`
  is store state React Flow sets AFTER `onSelectionEnd` returns, so clearing it there is
  overwritten on the next line. It is removed in `canvas.css`, and nothing is lost —
  dragging any selected box already moves the whole selection as one undo step.
- **`ViewportPortal` is the right home for anything drawn in DIAGRAM units.** It mounts
  into React Flow's own transformed layer, so a child positioned at `translate(640px, 0)`
  pans and zooms with the boxes for free — but it inherits the scale, so any thickness has
  to be divided by the zoom or a hairline becomes a bar at 3x and vanishes at 0.1x. The
  portal div is last inside `.react-flow__viewport` with `z-index: auto`, so a child's own
  z-index competes directly with the nodes' (0, or 5 when traced): `.erd-guide` uses 10 and
  paints over them. Used by the alignment guides of FR-3.5; verified in Chrome by dragging
  a guide across another box's body and looking at it.
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
  - **And a scripted drag always lands short by its first step.** React Flow's
    `nodeDragThreshold` means the gesture begins on the first move that clears it, and the
    drag offset is captured at THAT point — everything between the press and that move is
    discarded. A 256-unit drag sent as 12 equal steps arrives 21 units short, which looks
    exactly like a snapping bug when you are testing snapping. Read the transform back
    rather than trusting arithmetic on the pointer delta.
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
- **A clamp hides an estimator's error, so a tolerance calibrated where it clamps is
  calibrated against nothing.** `measure.ts`'s width comes out biased ~12px high on a long
  row — deliberately, since too big spaces boxes apart and too small stacks them — but every
  wide table in `wide-names.sql` exceeds `METRICS.maxWidth` at L2 and clamps to 300 on both
  sides, so the measurement spec's 8px tolerance was measuring the clamp. L1 draws the same
  table at 288px and the bias is plainly visible. The spec checks both levels now, with a
  separate L1 tolerance and the reason written next to it. Two lessons: check the level
  where the constant is actually USED (`METRICS.moreRowHeight` is only ever drawn at L1 and
  had never once been compared with the DOM), and be suspicious of any threshold that
  passes comfortably — it may be sitting behind a clamp.
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
- **Playwright's `mouse.move` then `mouse.down` is not a fast click, but HOW slow depends on
  the gesture — measure the one you are measuring.** Each call is its own CDP round trip. A
  bare `mouse.move` then `mouse.down`, which is what `perf.spec.ts` sends, puts **47-51 ms**
  between them; `coldClick` puts **248 ms** between its FIRST move and the press, because it
  parks at (8, 8) and does a round-tripping `elementFromPoint` check before the real move
  (65 ms from that last move). The 172 ms once recorded here was the second gesture, applied
  to the first. Everything inferred from it — notably "`--erd-trace-duration` is 120 ms, so
  the hover has finished transitioning before the press arrives" — was therefore unsupported:
  at a 50 ms dwell the transition is a third done. Corrected 11 Sep 2026.
- **The obvious outstanding work is not the cause just because it is outstanding.** A cold
  click on this canvas lands with **164 CSS transitions still running** and costs 195 ms
  against 41 ms for a warm one, which reads like an open-and-shut case. Disabling every
  transition takes the count to **0** and the latency to **154 ms**. The real cost is the
  style and layout the hover left pending, which the press's own handler flushes
  synchronously — a `longtask` of 172 ms cold against no entry at all warm, with the press
  doing an identical 4 `EntityNode` / 32 `AttributeRow` renders either way. Two separate
  plausible stories about this one gesture have now died on contact with an ablation. Split
  the latency at the DOM mutation (`pointerdown → class set` versus `class set → frame`)
  before theorising: it says immediately whether you are looking at React, at the browser's
  style and layout, or at the frame pipeline.
- **`:has()` is the famously expensive selector, and on this canvas it is not what is
  expensive.** `.react-flow__node:has(.erd-node[data-traced])` asks an invalidation question
  about all 120 wrappers on every hover, which reads like an obvious cost. Both `:has()`
  rules were removed and the z-index set from React as a class on the traced wrappers
  instead, then measured against the pair restored as an ablation **in the same interleaved
  run**: 196 ms against 200 ms, and 169 ms of blocked main thread against 175 ms. Reverted.
  The lesson is not about `:has()` — it is that a reputation is not a measurement, and that
  putting the OLD code back as an ablation condition is the only way to A/B a change on this
  machine, where medians drift 80 ms between runs with nothing changed.
- **An ablation simulated inside the NEW build is not the OLD build, and this canvas proved
  it the expensive way.** `.erd-scrim` — one composited div through React Flow's
  `ViewportPortal` — replaced `.erd-canvas[data-tracing] .erd-node:not([data-traced])`, which
  set an opacity on all 111 untraced boxes and repainted their ~1,900 rows. It was measured
  as a 195 → 105-119 ms win, with "before" reproduced by restoring the per-node dimming rule
  and setting `display: none` on the scrim **within the scrim build**. That session even
  spotted the hazard — an always-present composited layer changes how Chrome layerises the
  viewport *even when invisible*, and a first attempt measured the "before" 46 ms too fast —
  and tried to correct for it with `display: none`. The correction was not enough.
  Re-measured against the real pre-scrim COMMIT with the same unchanged `perf.spec.ts`, the
  scrim is a **regression**: cold-click median 105 ms → 156 ms, blocked 97 ms → 153 ms,
  reproduced in a forward sweep, a reversed sweep and a third pair, with no hover benefit
  either (45 → 50 ms). **Reverted 12 Sep 2026.** The numbers the scrim session published as
  its "after" turned out to describe the build without the scrim.
  - **So `git checkout <commit>` is the ablation, not a CSS override.** An override can only
    neutralise declarations; it cannot remove an element, its layer, or the selector matching
    it. When the change under test adds or removes DOM, measure the two commits — build and
    all — alternating conditions and sweeping in both directions.
  - The per-node dimming rule is back, and so is `--erd-dim-opacity + 0.15` on untraced
    connectors, which exists so thin lines survive dimming.
  - **What the original diagnosis got right still stands**: the cold click's cost is the
    style and paint the hover left pending, flushed inside the press's own handler. It is
    just that one composited layer over the viewport is not cheaper than 111 repaints here.
- **A change that its own test cannot distinguish from its opposite is not a fix.** The
  deferred-hover scheduler above passed eight unit tests and an e2e assertion — and the e2e
  assertion still passed with the scheduler's behaviour inverted, which is what exposed it.
  Mutate the code and re-run the guard before believing it. **The FIXTURE hides a mechanism
  as easily as the assertion does**: the cold-click render-count guard in `redraw.test.tsx`
  passed with `tracedAttributesByEntity` deleted, because the three-box schema it started
  from has no foreign keys and that map stays empty without one. It builds its own FK now.
  - **So does the INPUT.** The re-import e2e spec imported a file that only ADDED a table,
    and passed with the merge's id mapping disabled — because a broken merge degenerates
    into "keep every existing box, append the new one", which an add-only file cannot tell
    apart from a correct merge. The fix was to the input, not the assertions: the second
    file now also changes a column on a table that must not move. When testing a merge, a
    diff, or anything else that reconciles two states, the input has to exercise every
    branch of the reconciliation — add, change and remove — or the cheapest wrong
    implementation passes. The unit suite caught this mutant on its own, which is the other
    half of the lesson: know which layer is actually doing the guarding.
- **An A/B run measured as one block per condition measures the run order, not the code.**
  Five CSS conditions swept forward made dimming look 70 ms expensive; the same sweep
  reversed put every condition within 30 ms of the others, and interleaving them one sample
  at a time produced an ordering that contradicts itself (a superset override "costing"
  167 ms more than the subset inside it). The noise floor for click latency here is around
  100 ms. Size a problem with a stopwatch if you must; never choose between two fixes with
  one. Assert a mechanism instead — render counts, commits per gesture, whether a worker
  was created.
- **A computed-style assertion against a TRANSITIONED property has to be polled.** Opacity
  on `.erd-node` transitions over `--erd-trace-duration`, so reading `getComputedStyle`
  straight after the hover lands mid-fade and reports ~1. It failed three runs out of three
  while a screenshot plainly showed two dimmed boxes. `expect.poll`, not
  `waitForTimeout` — a sleep passes today and rots when the duration changes.
- **`EdgeLabelRenderer` is a portal, so no selector descending from the edge can style the
  label.** It mounts the label into React Flow's own label layer, not inside the edge's
  `<g>`. `.erd-edge[data-traced] .erd-edge__label` had therefore never applied once since
  it was written, and a new rule to hide dimmed labels failed the same way — the labels
  stayed on screen through a hover. Repeat the state on the label element itself. Found by
  looking at a screenshot; both the unit suite and every DOM count were happy.
- **React Flow keeps its OWN `selected` on the internal node, and only re-reads yours when
  the node object's reference changes.** Reusing unchanged node objects across a render is
  the right fix for hover — `adoptUserNodes` then keeps the internals instead of rebuilding
  them — but applying it to a render where the SELECTION moved silently breaks controlled
  selection. Shift is React Flow's marquee key, not its multi-select key, so it treats a
  shift-click as a plain one and internally deselects everything else; this app treats it
  as "add to the selection". While every node object was rebuilt every render, our value was
  re-asserted constantly and the library's private opinion never survived a frame. Reuse
  silences that, and a shift-clicked pair showed one highlight while the store held two —
  the model right, only the view stale. `Canvas` therefore rebuilds every node on a
  selection render on purpose. It cost nothing: a click with the pointer at rest is 25 ms
  and 5 node renders at 120 entities, so selection was never where the saving was.
- **One shared Set in `node.data` makes every node's data change whenever it does.**
  `tracedAttributeIds` was one Set for the whole diagram, and `sameEntityNode` compares it
  by reference on purpose (comparing contents would walk every attribute of every entity).
  So a hover minted a new Set, every box answered "changed", and all 120 redrew every row —
  hover median 90-99 ms against NFR-1.3's 100 ms. It is one set PER ENTITY now, absent for
  entities with nothing traced so the shared empty Set keeps its identity. Any per-node
  field derived from a diagram-wide fact has this shape.
- **A per-element flag that expresses a diagram-wide fact is an O(N) state change.**
  `isDimmed` was a boolean on every node and edge, so starting a hover rebuilt all N-1
  elements that are NOT traced in order to say so. `data-tracing` on the canvas plus
  `.erd-node:not([data-traced])` in CSS says the same thing with one attribute. Ask whether
  the state belongs to the element or to the diagram.
- **`longtask` has a 50 ms floor, so a reading of 0 is information and not a gap.** The
  browser emits an entry only for a task that already exceeded the threshold, which is
  exactly what NFR-1.4's clause asks about and is why the observer is the right instrument.
  It also means readings near the threshold are bimodal — the same build, minutes apart,
  gives `[0, 51, 0]` then `[57, 0, 0]`. Summarise with the WORST of several runs; a median
  over values clustered on a detection threshold is noise.
  - **That rule does not transfer to a repeated gesture, and assuming it does inflates the
    number.** It is about the layout apply: ONE event per run, sitting on the 50 ms floor.
    The cold-press guard takes 25 samples all well clear of the floor, where the max is an
    extreme-value statistic that tracks background load — its first cut read 199 ms worst
    against a 153 ms median, and would have been calibrated against the wrong figure. Match
    the summary to the shape of the sample, not to the instrument.
- **A latency probe that asks "has anything changed" measures the previous sample.** The
  first version of `perf.spec.ts` asked whether ANY node was traced or selected, so each
  sample had to clear the last one first — and the cheap way to do that, parking the pointer
  at `(4, 4)` and clicking, presses whatever sits in the TOOLBAR's top-left corner rather
  than hitting the canvas. Selection therefore stayed set between samples, the predicate was
  already true when the probe armed, and it reported ~40 ms for something that takes ~120.
  It looked like a good result. Anchor the predicate to the target element's own id, skip a
  sample whose target is already in the state under test, and never assume a coordinate is
  on the canvas just because it is near the edge.
- **An interaction-latency sample has to start from an idle main thread.** Firing the next
  gesture 60 ms after the last one charges the leftover render to the new input: the same
  build measured hover at p95 44 ms with a settle and 148 ms without. Both numbers are real,
  but only the first is what NFR-1.3 asks for. `settle()` waits for three consecutive
  animation frames on schedule rather than guessing at a `waitForTimeout`.
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

- **A `<select>` is a `combobox` to the accessibility tree, so `getByRole('combobox')` is
  not specific.** The Ctrl+K palette's input, the toolbar's Detail select and its Theme
  select all answer to it — the first version of the palette's e2e specs resolved to three
  elements and failed on strict mode. Worse, some of them PASSED first: Radix marks the rest
  of the page `aria-hidden` once the dialog is open, so whether the other two are in the tree
  depends on how far the open animation has got. Always give the role a name.
- **`stopPropagation()` on an input's keydown makes every global chord unreachable from that
  input.** `InlineName` did it to stop `e` and `Delete` reaching the canvas keymap mid-word,
  which is right — but it also meant Ctrl+K could not open the palette from the one field a
  user is most likely to be in. It now stops bare keys only and lets chords through; the
  keymap's own typing guard still turns away Ctrl+Z, so undo inside a text field stays the
  browser's. Deciding a key is "not for the document" at the input and deciding it is "not
  for the keymap" at the window are two different decisions, and doing both in one place
  gets one of them wrong.
- **A test that leaves a Radix dialog open when `cleanup()` runs blinds every later test in
  the file.** Radix marks the rest of the document `aria-hidden` while a dialog is open —
  that is the mechanism that actually confines a screen reader — and it restores it on
  DISMISS, not when React Testing Library rips the tree out underneath it. The next test's
  `getByRole` then finds nothing while its `getByText` still works, because only the first
  consults accessibility. It presents as the empty state rendering its text but not its
  button, in a test that passes on its own, which is a long way from the cause. Send Escape
  in `afterEach` before unmounting. Related to the `getByRole('combobox')` note above: both
  are the same `aria-hidden` doing its job at an inconvenient moment.
- **jsdom does not implement `scrollIntoView` at all.** Not a stub that no-ops — the method
  is absent, so an unguarded call throws inside the passive effect and takes the component
  down with it. It is layout, and jsdom performs none. Feature-detect it.

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
