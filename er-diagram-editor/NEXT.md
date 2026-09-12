# What to work on next

**Working queue. Updated 12 September 2026.**

This file exists so a session starting cold — after `/clear`, or a week later, or someone
else entirely — knows where the project actually stands and what to pick up, without
re-deriving it.

**How this relates to the other docs.** `docs/SRS.md` §4 is the requirement table (is
FR-6.5 built?) and §13 is what remains in requirement terms. This file is the **working
order**: which of those to do next, why that order, and what has already been diagnosed.
Requirement status stays in the SRS; sequencing lives here. Keep it that way — two
competing priority lists is how the SRS status table drifted in the first place.

**Update this file when you finish something.** Move the item out of its tier and write
down what you verified and how. An entry that says "fixed" without saying how it was
checked is worth nothing to the next session — see "Why the tests did not catch any of
this".

---

## Where things stand

### Verified in a real browser (Chrome, 10 Sep 2026)

Not "unit tests pass" — driven with Playwright against real Chrome, with the output looked
at. See "How to drive the real app" at the bottom.

| Thing                   | Evidence                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------ |
| App boots, sample loads | 4 entity nodes on canvas                                                             |
| Drag an entity          | Node transform tracks the cursor; drop position == last drag frame, no jump          |
| Drag then undo          | A 20-frame drag is ONE undo step ("Move entity"); one undo restores exactly; redo OK |
| PNG export              | 1860x940, whole schema at L2, badges/markers/dashes all correct                      |
| SVG export              | Same content, sharp vector text                                                      |
| Dialog focus            | Focus enters the panel, traps, and returns to the Export button on close             |
| Console                 | Zero errors through the whole flow                                                   |

### Verified in a real browser (Chrome, 10 Sep 2026 — click-to-select session)

| Thing                         | Evidence                                                                                                                                                                     |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cold click selects a table    | Pointer on the pane, then straight onto the header with no dwell: 1 node `.selected`, inspector opens on it. Was 0 before the fix.                                           |
| Cold click narrows selection  | Two selected, then a cold click on one: exactly that one stays. Was 0 selected — the reported "clears what you had".                                                         |
| Cold click after a LOD change | Switch Detail to Keys, click immediately: 1 selected. The non-hover trigger, which the hover-only theory would have missed.                                                  |
| No box ever goes invisible    | MutationObserver on `.react-flow__nodes` across a hover sweep of all 4 tables: **0** `visibility: hidden` sightings. Was 4-of-4 hidden from +38 ms to +57 ms on every hover. |
| Minimap                       | **4** `.react-flow__minimap-node` rects, 247x150 / 185x178 / 160x150 / 194x148, traced ones filled `--erd-signal`. Screenshot looked at. Was 0 rects.                        |
| Drag not regressed            | 20 distinct transforms during the gesture, dx 114 dy 57, `title="Undo Move entity"`, one undo restores to the pixel.                                                         |
| Hover trace not regressed     | 2 traced, 2 dimmed on the sample. Trace still reaches the boxes; it just no longer costs them their size.                                                                    |
| e2e suite                     | **Executed for the first time.** 14 specs against system Chrome, ~40 s. 13 pass, 1 expected-fail (auto-layout, see Tier 1).                                                  |
| Auto-layout                   | **Broken, in dev and in the production build.** Fixed in the session below.                                                                                                  |

### Verified in a real browser (Chrome, 10 Sep 2026 — auto-layout session)

Both dev and `vite preview` of the production build.

| Thing                           | Evidence                                                                                                                                                                                                              |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auto-layout button              | All 4 sample boxes move to new ELK positions. Before: `0,0 / 320,0 / 640,0 / 640,260`; after: `12,219 / 344,206 / 626,35 / 336,12`. Zero alerts, zero console errors.                                                 |
| It runs off the main thread     | Exactly one `worker` event, at `/assets/elk-worker.min-<hash>.js` in prod. An in-process fallback would satisfy every other assertion, so the spec asserts this specifically.                                         |
| It is still lazy (NFR-1.8)      | **0** workers and no elk network requests before the first layout; after it, `ElkLayoutEngine-*.js` then `elk-worker.min-*.js`.                                                                                       |
| One undo step (FR-3.4)          | Undo button reads `Undo Auto-layout`; one click restores the displaced arrangement exactly.                                                                                                                           |
| SQL import arranges the schema  | A 3-table `.sql` imports to `12,25 / 280,12 / 561,12` — **not** `fallbackPosition`'s `0,0 / 280,0 / 560,0` grid. One worker created. Screenshot looked at: a proper left-to-right chain with orthogonal FK-row edges. |
| Entry bundle still under budget | 718,191 B raw / **222,462 B gzip** (was 717,768 / 222,275). Budget 500 KB. Zero GWT fingerprints (`gwtOnLoad`, `$wnd`) in the entry chunk.                                                                            |
| Production build, not just dev  | Every row above re-run against `vite preview`. Layout took ~1.06 s end to end, including the 1.6 MB worker fetch.                                                                                                     |

### Verified in a real browser (Chrome, 10 Sep 2026 — box measurement session)

| Thing                              | Evidence                                                                                                                                      |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Overlapping boxes, 41-table schema | **0 pairs at L0, L1 and L2**, down from 26. Every rendered box now at least as tall as `measure.ts` predicted.                                |
| Rows are one line, always          | Every `.erd-attr` measures 26–27 px at L2 where they ran 26–48 px before. The 6-column table went from 333 px to 232 px.                      |
| The estimate never under-shoots    | `tests/e2e/measurement.spec.ts` compares `measureAll` against `offsetHeight` for every box and passes; over-estimates by at most 4 px.        |
| Per-row rate, measured             | `.erd-node__attrs`: 136 px at 5 rows, 163 at 6, 437 at 16, 656 at 24, **1642 at 60** — 27.2 to 27.37 px per row, creeping up. Billed at 27.4. |
| Boxes are much shorter             | L2 heights on the 41-table schema fell from 767–2963 px to **504–1711 px**.                                                                   |
| Truncation reads well              | Screenshot looked at at 100% zoom: names ellipsize, types stay aligned right, rows uniform. Full name in the `title`.                         |
| Layout still fast                  | 349 / 264 / 427 ms at L0 / L1 / L2 on 41 tables.                                                                                              |
| The ribbon is NOT fixed            | Still one vertical column, ~42% shorter. Item 2 is unchanged in kind — see the correction in its entry.                                       |

### Verified in a real browser (Chrome, 10 Sep 2026 — real-schema session)

| Thing                                                | Evidence                                                                                                                                                                                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pagila, 71 tables of real third-party PostgreSQL DDL | Imports to 72 entities / 36 relationships. **Zero** import warnings, alerts, console errors. **Zero overlapping boxes at L0, L1 and L2.** Layout 354 / 346 / 573 ms.                                                      |
| NFR-1.4 timing at 120 entities                       | **606 ms (L0), 370 ms (L1), 945 ms (L2)** against a 5 s budget. Consistent with the ~840 ms `test:perf` reports in-process, so the algorithm figure was honest.                                                           |
| NFR-1.4's 50 ms main-thread clause                   | **Violated.** A `longtask` observer records blocks of **323 ms (L0), 142 ms (L1), 473 ms (L2)**. **Corrected 11 Sep 2026: these are DEV-BUILD figures** — the shipped build blocks for 51/62/96 ms. See the 11 Sep table. |
| 120 identical tables, laid out                       | Clean grid, no overlaps, minimap populated, edges routed. Screenshot looked at — and this is exactly why the synthetic fixture proves nothing.                                                                            |
| 41 tables with realistic names                       | Every rendered box taller than `measure.ts` predicted, worst by **586 px (86%)**; **26 overlapping pairs**, worst 300x530 px.                                                                                             |
| Hub-and-spoke at L2                                  | 40 tables onto one hub renders as a single vertical ribbon, ~1,000 px wide by ~40,000 px tall. Screenshot looked at: unreadable at any zoom.                                                                              |
| The `.erd.json` fixtures                             | `reference.erd.json` / `stress.erd.json` / `small.erd.json` are empty **and invalid** — no top-level `id`, so importing one is rejected. Their README claimed 120 and 300 entities.                                       |

### Verified in a real browser (Chrome, 11 Sep 2026 — hub layout session)

| Thing                               | Evidence                                                                                                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 41-table hub schema, extent         | L0 **3038x889** (was 708x3864), L1 **3376x1484** (was 838x7264), L2 **3186x4275** (was 838x21134). Aspect 0.18/0.12/0.04 → **3.42/2.27/0.75**. L2 is five times shorter. |
| All boxes present, none overlapping | 41 of 41 rendered after fitView, **0 overlapping pairs** at every detail level.                                                                                          |
| It reads as a diagram               | Screenshot looked at: hub on the left, 40 dependents in a ~7-column block, orthogonal edges, table and key names legible. Was a 1px-wide ribbon.                         |
| Pagila is untouched                 | 1726x1536 / 2657x1966 / 4063x2992 — **byte-identical** to the same run with the split disabled. A real schema whose tables are mostly unrelated does not trigger it.     |
| 120-entity reference is a wash      | L0 1616x2105 vs 1616x2047 disabled; L2 4945x3090 vs 4945x3205. Marginally squarer at L2, no overlaps either way.                                                         |
| Layout still fast                   | 344 / 321 / 728 ms at L0 / L1 / L2 on 41 tables. `pnpm test:perf` budgets still pass.                                                                                    |

### Verified in a real browser (Chrome, 11 Sep 2026 — main-thread blocking session)

Production build (`vite preview`) unless stated. Every figure is the **median worst
`longtask` block over three runs**, measured with the fixture pre-positioned on a grid so
importing it does NOT auto-arrange and the Auto-layout click genuinely moves every box.

| Thing                                           | Evidence                                                                                                                                                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The 323/142/473 ms on record were DEV numbers   | Same harness, same clicks: **dev 303 / 340 / 417 ms**, **production build 51 / 62 / 96 ms** at L0 / L1 / L2 on 120 entities. React's development build dominates its own profile.                      |
| Where the time actually goes                    | CPU profile of the apply, DEV build: Immer **~15 ms**, validation **~7 ms**, store publish **<1 ms**. The block is React render and commit, not the command. Revalidation was a red herring.           |
| A move redrew every box's contents              | Render counters inside the page: one layout at 120 entities / L2 cost **120 EntityNode renders and 1,920 AttributeRow renders**. After the fix: **0 and 0**.                                           |
| Blocks, 120 entities (L0 / L1 / L2)             | **51 / 62 / 96 ms → 0 / 51 / 55 ms.** L0 no longer produces a long task at all; L2 is 43% shorter. The budget is 50 ms, so L1 and L2 still miss it — narrowly.                                         |
| Blocks, 300 entities (NFR-2.2 ceiling), L2      | **202 ms → 135 ms.** Still 2.7x the budget, which is why the item stays in Tier 1.                                                                                                                     |
| `startTransition` around the apply does nothing | Measured rather than assumed: 57 ms at 120 and 128 ms at 300, i.e. unchanged. `useSyncExternalStore` de-opts a transition to synchronous rendering, and both stores use it. **Do not redo this.**      |
| A reference-stable `edges` array does nothing   | Also measured: 56 ms at 120 and 139 ms at 300, unchanged. Rebuilding the edge array is not the cost. **Do not redo this either.**                                                                      |
| Nothing regressed                               | Screenshots looked at: 120 boxes laid out, minimap populated, edges routed. Hover traces 3 boxes and dims 15, with the connectors highlighted. Inline rename redraws the box. **Zero console errors.** |
| The gate                                        | `pnpm verify` green, all 16 e2e specs included.                                                                                                                                                        |

### Verified in a real browser (Chrome, 11 Sep 2026 — NFR-1.3 / NFR-1.4 session)

Production build (`vite preview`), 120-entity reference schema, all boxes framed before
every measurement. `pnpm test:perf:browser` reproduces every row.

| Thing                                       | Evidence                                                                                                                                                                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The layout apply, worst `longtask` of 3 runs | **57 / 58 / 66 ms (L0), 0 / 0 / 0 ms (L1), 58 / 58 / 73 ms (L2)** over three separate invocations. `longtask` has a 50 ms floor by definition, so an L1 reading of 0 means "no task crossed the clause's threshold at all".   |
| NFR-1.4's clause, narrowed rather than met   | The residue is one task at the end of a deliberate, once-per-session action. Buying it back means staging positions over frames while FR-3.4 still demands one undo step — a second two-tier overlay. Decision recorded in the SRS row. |
| NFR-1.3, measured in a browser at last       | Follow zoom: hover p95 **49 / 56 / 57 ms**, selection **68 / 74 / 82 ms**, keystroke **13 ms**. All inside the 100 ms budget, over three runs.                                                                               |
| NFR-1.3, pinned to All fields                | **Missed.** Selection p95 **147 / 161 / 162 ms** on every run; hover **83 / 91 / 195 ms**. Keystrokes fine at 13–16 ms. This is Tier 1 item 1, promoted out of Tier 3 on the strength of it.                                  |
| The measurement is honest about itself       | `t0` is the trusted event's own `timeStamp`, not a driver-side clock, so the CDP round trip is excluded; `t1` is taken in the `requestAnimationFrame` after the change is observable, so React's render and commit are included. |
| The dev-build trap cannot recur              | `perf.spec.ts` asserts no `/@vite/client` and an `/assets/` entry chunk before it measures anything, and `playwright.config.ts` refuses to run the file at all.                                                              |
| Nothing regressed                            | `pnpm verify` green. Zero `role="alert"` after every layout.                                                                                                                                                                |

### Verified in a real browser (Chrome, 11 Sep 2026 — node-rebuild session)

Production build, 120 entities, all boxes framed, Detail pinned to All fields, 25 samples
per gesture. **Medians, because the p95 is not stable on this machine** — the tail tracks
background load and moved between 56 and 170 ms across five passes with no code change,
while the median moved by 10 ms. `pnpm test:perf:browser` reproduces it.

| Thing                                        | Evidence                                                                                                                                                                              |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hover, the number the item was promoted for  | Median **59 / 90 / 99 ms → 43 / 46 / 48 / 50 / 53 ms** over three passes before and five after. Roughly halved and consistent.                                                        |
| What actually cost that                      | `tracedAttributeIds` was ONE Set for the whole diagram, so a hover minted a new one, `sameEntityNode` compared it by reference, and all 120 boxes redrew every row. Now one set per entity. |
| Dimming stopped being an O(N) state change   | `isDimmed` was a per-node boolean, so starting a hover rebuilt all N-1 untraced nodes to say so. Now one `data-tracing` flag on the canvas and a `:not([data-traced])` rule in CSS.    |
| A click, with the pointer already on the box | **25 ms median**, and **5 EntityNode / 40 AttributeRow renders** per selection at 120 entities. The click itself is not the problem and never was.                                    |
| A COLD click is still ~100 ms                | Median **99–108 ms** at All fields, unchanged by this work. Move-then-press with no dwell makes the hover render and the selection render run back to back. New item 1 below.         |
| Selection deliberately does NOT reuse nodes  | React Flow keeps its own `selected` on the internal node and re-reads ours only when the object reference differs. Reusing left a shift-clicked pair showing one highlight while the store held two. |
| Nothing regressed                            | `pnpm verify` green, 16 e2e specs, 720 unit tests. The shift-click regression above was caught by the e2e suite, not by review.                                                       |

### Verified in a real browser (Chrome, 11 Sep 2026 — cold-click mechanism session)

Production build, 120 entities, Detail pinned to All fields, all boxes framed. 20 samples
per condition, and the conditions are **interleaved one sample at a time** rather than swept,
because a swept A/B on this canvas measures the run order (see "Known broken" 2).

Every primary reading is a COUNT or a block duration taken at the instant of the trusted
`pointerdown`, from inside the page, with no driver round trip between the move and the
press — inserting one changes the gap under study.

| Condition                    | pointerdown→frame | →DOM | DOM→frame | EntityNode | AttributeRow | transitions running | blocked (longtask) |
| ---------------------------- | ----------------- | ---- | --------- | ---------- | ------------ | ------------------- | ------------------ |
| COLD (settle → move → press) | **195 ms**        | 190  | 6         | **4**      | **32**       | 164                 | **172 ms**         |
| WARM (move → settle → press) | **41 ms**         | 36   | 5         | **4**      | **32**       | 0                   | **0 ms**           |
| COLD, dimming neutralised    | 119 ms            | 112  | 6         | 4          | 32           | 42                  | 104 ms             |
| COLD, all trace CSS off      | 111 ms            | 104  | 7         | 4          | 32           | 0                   | 97 ms              |
| COLD, all transitions off    | 154 ms            | —    | —         | 4          | 32           | **0**               | —                  |

| Thing                                          | Evidence                                                                                                                                                                                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The press does identical React work either way** | **4 `EntityNode` and 32 `AttributeRow` renders, in every condition, in every run.** Counters read inside the page, snapshotted in the capture phase of the trusted `pointerdown` and again at the frame showing `.selected`. This is the comparison item 1 asked for, and it comes back a dead heat. |
| So the extra cost is not React                 | Follows from the row above by the item's own decision rule. What it is instead is below.                                                                                                                                                  |
| It is not the frame pipeline either            | `DOM→frame` — the class landing to the frame that can show it — is **5-7 ms in every condition**, cold and warm alike. All of the difference is in `pointerdown → the class actually being set`: 190 ms cold against 36 ms warm.           |
| It is synchronous blocking, not queueing       | A `longtask` overlapping the press measures **172 ms cold and nothing at all warm** (warm produces no entry, so it is under `longtask`'s 50 ms floor). The cold press blocks the main thread inside its own task.                          |
| **The running transitions are a correlate, not a cause** | 164 CSS transitions are still running when the cold press lands, against 0 for warm — which looks like the answer and is not. Disabling every transition takes the count to **0** and leaves the latency at **154 ms**. Ablated, not assumed. |
| Roughly half the cost is the trace's own repaint | Neutralising the dimming rule alone: 195 → **119 ms**. Neutralising every trace declaration: → **111 ms**. So the visual half of a hover is real and is about 80 ms of it.                                                                 |
| The other half survives with the trace invisible | With every trace declaration neutralised the press still blocks for **97 ms**. What is left is the hover's DOM attribute mutations and the style re-matching they force — and note a CSS override cannot remove the **`:has()` matching cost**, only the declarations, so this ablation under-states that half. |
| **The 172 ms gap on record is the wrong gesture** | The move→press gap in the gesture `perf.spec.ts` actually measures is **47-51 ms** (one run 121). The 172 ms belongs to `coldClick`, which parks at (8,8) and does a round-tripping `elementFromPoint` check first: measured **248 ms** from its first move and **65 ms** from its last. See the correction in item 1. |
| **Removing the `:has()` rules changes nothing** | Measured on 12 Sep 2026 by restoring the pair as an ablation and interleaving it against the version without them: **196 ms vs 200 ms latency, 169 ms vs 175 ms blocked**, n=20 each, same run. Reverted. |
| Dimming holds up on a second run       | **196 → 122 ms** with the dimming rule neutralised, blocked **169 → 109 ms**, in the same interleaved run. Consistent with the 195 → 119 on the run above. |

### Verified in a real browser (Chrome, 12 Sep 2026 — scrim session) — **WRONG, and reverted the same day**

> **Do not trust the numbers in this section.** Everything below is left in place because the
> mistake is the lesson, not because the figures hold. The "before" condition was reproduced
> by a CSS override **inside the scrim build** instead of by checking out the previous commit,
> and that is not the same thing — an override cannot remove an element or the layer it
> creates. Measured commit against commit, the scrim is a 50 ms **regression** on the gesture
> it was built for. See the narrowing session below; `.erd-scrim` was reverted on 12 Sep 2026.

Production build, 120 entities, All fields, 20 samples per condition, conditions
**interleaved**. The "before" is the per-node dimming restored as an ablation, so before and
after are one run rather than two — and it is `display: none` on the scrim rather than
`opacity: 0`, because an always-present composited layer changes how Chrome layerises the
viewport even when invisible, and a first attempt measured the "before" 46 ms too fast.

| Condition                          | pointerdown→frame | blocked | style | paint+ |
| ---------------------------------- | ----------------- | ------- | ----- | ------ |
| BEFORE — dimming on every box      | 119 / 139 / 139 / 135 | 106 / 119 / 120 / 117 | 16-21 ms | 94-105 |
| **AFTER — one scrim**              | **105 / 114 / 119 / 115** | **84 / 102 / 98 / 101** | **11-14 ms** | **78-90** |
| Ceiling — no dimming at all        | 107 / 106 / 107 / 113 | 92 / 91 / 93 / 95 | 13-14 ms | 72-83 |
| WARM (pointer already on the box)  | 36 / 37 / 35 / 36 | 0 | 2 ms | 41-49 |

| Thing                                   | Evidence                                                                                                                                                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The scrim reaches the ceiling           | AFTER lands **at or below** the figure for removing dimming outright, across four runs, while still dimming. ~20 ms of latency and ~20 ms of blocked main thread against the per-node rule.            |
| It is dimming the right things          | Measured in the page mid-hover: scrim opacity **0.45** at z **1**, traced wrappers at z **5**, untraced at z **0**, and an untraced box's OWN opacity is **1** — it is not dimming itself any more.    |
| Edges stay behind boxes                 | Screenshot looked at. The first build lifted the whole `.react-flow__edges` layer over the scrim and **every connector drew through every untraced table** — a grid of lines crossing boxes. Only traced edges are lifted now (`zIndex: 2` per edge). |
| Render counts still identical           | 4 `EntityNode` / 32 `AttributeRow` charged to the press, unchanged in every condition. The scrim changes what the browser paints, not what React does.                                                 |
| It is still outside NFR-1.3             | 105-119 ms against a 100 ms budget. Narrowed, not met. See item 1.                                                                                                                                    |
| The gate                                | `pnpm verify` green, 16 e2e specs, including the hover spec rewritten onto the new mechanism.                                                                                                          |

### Verified in a real browser (Chrome, 12 Sep 2026 — Ctrl+K palette session)

| Thing                                | Evidence                                                                                                                                                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ctrl+K opens it, caret already inside | `ui/Dialog` focuses the PANEL by design, so a palette dropped into it would swallow the first keystroke. It grew an `initialFocus` prop; the spec asserts `toBeFocused()` on the input itself, which only a real focus trap can answer. |
| …including mid-rename                 | `InlineName` called `stopPropagation()` on every keydown, so the chord never reached the window keymap. It now lets modifier chords through — `e`/`Delete` are still stopped, and Ctrl+Z is still turned away by the keymap's own typing guard. Found by the spec, not by review. |
| Picking a table selects AND moves the camera | Pan away first, then Ctrl+K → "product" → Enter: one id selected, `PRODUCT` carries `.selected`, and `.react-flow__viewport`'s transform is not what it was. Asserting selection alone would pass on a broken camera. |
| A field result names its table        | Ctrl+K → "email" → the first row reads `email_address` AND `CUSTOMER`. FR-2.6 asks for this in words, so it is asserted in words.                                                                                              |
| Escape closes it and changes nothing  | Node count identical either side. The keymap is disabled while a dialog is open — the export dialog once let `e` add an entity from underneath it.                                                                             |
| It runs commands, not just searches   | Ctrl+K → "add entity" → Enter adds a box. FR-9.2's half, end to end.                                                                                                                                                          |
| The matcher is not a library          | 1,230 records at 120 entities, ~3,000 at NFR-2.2's ceiling; 0.8 ms and 2.0 ms per query against NFR-1.7's 50 ms. `fuse.js` + `cmdk` would have been 13,488 B gzip for speed nobody needs.                                       |
| The listbox is a listbox              | A `<select>` has an implicit `combobox` role, so `getByRole('combobox')` matched the toolbar's Detail and Theme controls too and resolved to three elements. Every palette locator is by accessible name now. |

### Verified in a real browser (Chrome, 12 Sep 2026 — NFR-1.3 narrowing session)

Started as a decision session for Tier 1 item 1 with no `src/` change: narrow the clause, and
build the guard the decision was conditional on. **The guard's first run contradicted the
number the decision had been argued from, and chasing that down found the previous session's
fix to be a 50 ms regression.** Production build, 120 entities, 25 samples per gesture,
`pnpm test:perf:browser`.

**The ablation, commit against commit.** Same `perf.spec.ts` throughout — it has not changed
since `fb191b8`, so the instrument is identical at every point. `CI=1` so Playwright refuses
to reuse a preview server instead of silently measuring the previous condition's build.
Selection median at All fields:

| Condition                          | forward sweep | reversed sweep | third pair |
| ---------------------------------- | ------------- | -------------- | ---------- |
| **A — before the scrim (`8924ab4`)** | **103 ms**    | **107 ms**     | **105 ms** |
| B — the scrim (`a49f970`)          | 156 ms        | 153 ms         | 187 ms     |
| C — palette / HEAD (`ac15f3b`)     | 154 ms        | 156 ms         | —          |

| Thing                                                    | Evidence                                                                                                                                                                                                                                                              |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The scrim is a regression, not a fix**                 | Same ordering forward and reversed, three pairs, ±4 ms within condition A. No hover benefit either: median **45 ms (A) vs 50 ms (B)**. The palette (`1d904d5`) adds nothing — B and C are indistinguishable. **Reverted.**                                             |
| Why the scrim session could not see it                   | It reproduced "before" with a CSS override **inside the scrim build** — per-node dimming restored, `display: none` on the scrim. An override neutralises declarations; it cannot remove an element or the layer it creates. That session even caught the layerisation hazard ("46 ms too fast") and corrected with `display: none`; the correction was not enough. |
| The published "after" described the wrong build          | The scrim session's AFTER was 105–119 ms latency / 84–102 ms blocked. That is what the build **without** the scrim measures today: **108 ms / 97 ms**. Its BEFORE and AFTER were, in effect, the wrong way round.                                                     |
| After the revert, on the same harness                    | Follow zoom: hover p95 **58 ms**, selection p95 **95 ms**, keystrokes **12 ms** — all inside budget, so the narrowing's premise holds. All fields: hover p95 **64 ms**, keystrokes **12 ms**, cold click **p95 177 / median 108 ms**, blocked median **97 ms**.        |
| The render-count guard fails when the mechanism does     | Mutated `Canvas.tsx` twice and re-ran. Un-memoising `tracedAttributesByEntity` kills it (React render loop); keying that memo on the selection as well trips the assertion itself — **2 boxes redrawn against 1**. The other six tests in the file pass under both mutants, so this one is what catches it. `Canvas.tsx` restored byte-identical (`git diff` empty). |
| It would have passed with a weaker fixture               | `schema()` has no foreign keys, so `tracedAttributesByEntity` stays empty mid-hover and both mutants survive. The test builds its own FK through `setForeignKey` for that reason — checked by deleting the mechanism, not assumed.                                     |
| The block figure is a median, deliberately               | First cut reported the worst of 25 samples and read 199 ms, which is an extreme-value statistic tracking background load. CLAUDE.md's "summarise with the WORST" rule is for the layout apply — once per run, sitting on `longtask`'s 50 ms floor — and does not transfer to 25 samples all well clear of it. |
| Nothing regressed in the revert                          | `pnpm verify` green: 765 unit tests in 34 files, 22 e2e specs including the palette's, typecheck and lint clean. The revert restored the per-node dimming rule, the lighter dim on untraced connectors, and the pre-scrim hover assertions in `interaction.spec.ts`; the palette specs merged through it untouched. |

### Verified in a real browser (Chrome, 12 Sep 2026 — re-import session)

FR-6.9, the Tier 2 item. `pnpm test:e2e`, plus nine unit tests on the merge itself. The
useful part of this session is what mutation testing said about the first version of the
e2e spec.

| Thing                                               | Evidence                                                                                                                                                                                                                                              |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The layout survives a re-import                     | Import a 3-table `.sql`, let ELK arrange it, then open a 4-table version over it and merge: the transform of **every pre-existing box is byte-identical**, and the new table lands clear to the right of them. Asserted per box by name, because DOM order is not stable across a merge. |
| **The first version of that spec proved nothing**   | With `mapEntityId` mutated to return the incoming id — the core mechanism disabled — it still **passed**. A broken id map degenerates into "keep every existing box, append the new one", which is indistinguishable from a correct merge if all the file changes is to ADD a table. |
| What fixed it                                       | The second file now also adds a column to an existing table, and the spec asserts that column is visible on the box that did not move. Re-run against the same mutant: **fails**. A merge and an append can finally be told apart.                     |
| The same trap, one level down                       | The unit suite caught the mutant on its own (`unchanged` drops to 0, everything reports as `missing`) — so the e2e spec was the weak one, not the mechanism. Worth knowing which layer is actually doing the guarding.                                  |
| Foreign keys survive, and the result still parses   | A hand-drawn table pointing into a re-imported one keeps its FK, because matched attributes keep their existing ids. Every merge test ends by parsing the merged document: referential integrity is enforced, so a dangling `foreignKey.attributeId` does not render oddly, it refuses to load. Mutating attribute-id preservation kills three tests. |
| A dropped column clears the FK, and says so         | Re-import without the referenced column: the FK is cleared, `foreignKeysCleared` is 1, the preview reports it, and the document still parses.                                                                                                          |
| Change detection was wrong, and a test caught it    | First cut compared entities BEFORE remapping foreign keys, so every table carrying one reported as changed on a re-import of an identical file. Moved after the remap.                                                                                 |
| Re-importing the same file is a no-op               | No duplicated entities, no duplicated relationships — relationships match on remapped participants plus name. Without that, every re-import doubles every edge.                                                                                        |
| The preview is the thing that gets applied          | Both come from the same call to `mergeDiagrams`. A separately-derived description for display is how a preview starts lying about what the button does.                                                                                                |
| The gate                                            | `pnpm verify` green: 774 unit tests in 35 files, 23 e2e specs, typecheck and lint clean.                                                                                                                                                               |

### Verified in a real browser (Chrome, 12 Sep 2026 — sticky trace session)

FR-4.4, Tier 3 item 1. A small change — the pin is derived from the selection rather than
stored beside it — and again the useful part is what the mutants said about the spec.

| Thing                                             | Evidence                                                                                                                                                                                                                                    |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clicking a connector pins its trace               | Two endpoints `data-traced`, canvas `data-tracing`, and it is **still there after the pointer moves to empty canvas** — where a hover trace is gone.                                                                                        |
| It survives a real pan                            | An eight-step drag on the pane, and the traced set is identical after it. This is the requirement in one gesture: you cannot follow a connector to a far end you have to scroll to reach if scrolling drops the highlight.                   |
| **A pinned trace outranks the pointer**           | Hovering a different table does not steal it. Asserted on WHICH boxes are traced, not how many — hovering a two-neighbour table also gives a count of 2, and a count assertion sails straight past it.                                       |
| The e2e spec needed two rounds of mutation to bite | With a hovered entity allowed to override the pin, the first version **passed**. Cause: the obvious hover target sits behind the inspector, so no `mouseenter` ever fired. The second version asserts `elementFromPoint` first — and then found there was no reachable untraced table at all until the pan, which is Known broken 5 measured rather than recalled: `ORDER_LINE` and `PRODUCT` both hit `erd-inspector__section`. |
| Escape is a handover, not a blank                 | Asserting "nothing traced" after Escape failed with 3 — correctly, because the pointer was resting on a table and hover resumed. The spec now asserts the handover (the traced set changes to the hovered table's neighbourhood) and only then, with the pointer clear of every box, that nothing is traced. Worth more than the zero it replaced. |
| No new state, no second dismissal path            | The pin is `selectedRelationshipIds` when it holds exactly one. Reduced to a scalar before it reaches the `traced` memo on purpose: passing the Set would put an identity that changes on every selection into `tracedAttributesByEntity`'s dependencies and redraw every box on a selection render — the NFR-1.3 defect its own guard exists to catch.                      |
| The gate                                          | `pnpm verify` green: 777 unit tests in 35 files, 24 e2e specs, typecheck and lint clean.                                                                                                                                                     |

### Known broken

1. **NFR-1.3 is met as narrowed, and one gesture is 8 ms outside it by decision.** At Detail:
   Follow zoom — what the tool renders 120 tables at — hover p95 **58 ms**, selection p95
   **95 ms**, keystrokes **12 ms**, all inside the 100 ms budget. Pinned to All fields a COLD
   click (pointer arrives and presses with no dwell) is **median 108 ms, blocking 97 ms**;
   the clause was narrowed on 12 Sep 2026 to the detail level the tool selects for itself and
   that gesture is exempted with its figure, the way NFR-1.4's clause was on 11 Sep. Nothing
   left in it has a name — removing dimming entirely still cost 106-113 ms. **Buying the last
   8 ms back means making the hover itself cheaper, which is a redesign of how trace state
   reaches the nodes. Not queued; see "Not doing, and why".**
   **NFR-1.4's clause is not on this list either**, for the same reason: narrowed on 11 Sep
   2026 to exclude the single task that applies a layout. See the SRS rows.
2. **~~A composited scrim makes the cold click cheaper.~~ It makes it 50 ms more expensive,
   and was reverted on 12 Sep 2026.** Left on this list as a warning rather than as work: the
   scrim session's ablation reproduced its "before" with a CSS override inside the scrim build
   instead of checking out the previous commit, which cannot remove an element or the layer it
   creates, and it published figures that describe the wrong build. Commit against commit,
   forward and reversed: **105 ms without, 156 ms with**. If anyone proposes a single
   composited dim layer over this viewport again, that is the measurement to beat.
3. **Interaction timings on this machine have a noise floor of roughly 100 ms, which is
   bigger than most changes worth making.** Five passes with no code change put hover's p95
   anywhere between 56 and 170 ms while its median moved by 10 ms — so read the medians,
   and `perf.spec.ts` asserts on them for that reason. But medians are not safe either
   across a long run: an A/B of five CSS conditions drifted by ~90 ms between the forward
   and reversed sweep, and produced a self-contradictory ordering even when interleaved
   (the cold-click mechanism session above has the numbers). **Use time to size a problem,
   never to choose between
   two fixes.** For that, assert a mechanism — render counts, commits per gesture, whether
   a worker was created — the way `redraw.test.tsx` and the auto-layout spec do.
4. **~~No re-sync.~~ Built 12 Sep 2026 (FR-6.9).** Opening a file over a diagram that
   already has tables now offers a merge: match by name, keep every position, place only what
   is new, and show what it will do before it does it. One undo step. Deleting tables the
   file omits is opt-in and off by default. A renamed table reads as one added plus one
   missing — see the SRS row for why that is the decision rather than a limitation.
5. **The inspector is drawn over the canvas, not beside it.** Selecting anything hides the
   right-hand part of the diagram, including whole tables, and they stop being clickable.
   See "Housekeeping".
6. **The minimap swallows pointer events in the bottom-right corner.** Inherent to an
   overlay minimap, but combined with 4 a good deal of the canvas is unreachable. See
   "Housekeeping".

Fixed and verified in a browser on 10–11 Sep 2026 — do not re-open these without new
evidence:

- ~~A hub-and-spoke schema is unusable at L2.~~ **Fixed 11 Sep 2026.** None of ELK's own
  options touch it: `elk.aspectRatio`, `elk.layered.wrapping.strategy` and
  `elk.layered.highDegreeNodes.treatment` all produce byte-identical output, because
  `wrapping` wraps a long chain of layers and the problem is one layer with too many nodes
  in it. The fix does the layering itself — compute dependency depth, split any crowded
  depth into partitions, hand ELK the answer (`src/layout/elk/wideLayers.ts`). L2 went from
  838x21134 to 3186x4275, and Pagila is byte-identical to before.

- ~~`measure.ts` under-measures every box whose column names wrap.~~ Rows are now pinned to
  one line in CSS (`text-overflow: ellipsis`, with the full name in the `title`), so the
  flat per-row height is correct by construction rather than by calibration. 26 overlapping
  pairs → 0. The constants were re-measured off the DOM rather than read off the stylesheet
  by eye, and the per-row rate turned out to be 27.37 px rather than 27 — a flat 27
  under-measures a 60-column table by 22 px, which is why the fixture now contains one.

- ~~Auto-layout does nothing, and throws.~~ **Two independent defects, not one.**
  `elk.bundled.js` cannot run inside a Web Worker — it is the main-thread build whose job is
  to start one. And separately, `autoLayout.run()` read the pre-import `diagram` prop, so
  the import path arranged the document it had just replaced; on a fresh session that is the
  empty one, which the engine short-circuits, so it was a silent no-op. Fixed by letting
  elkjs own the worker and by passing the imported document explicitly.

- ~~Clicking an entity does not select it, and clears the selection you had.~~ Root cause was
  that the app dropped React Flow's `dimensions` changes; every node rebuild therefore
  un-measured every box and made it `visibility: hidden` for ~19 ms. Fixed by carrying
  `measured` on the node objects. See the browser table above.
- ~~The minimap is an empty white box.~~ Same root cause, permanent form: the minimap reads
  the _user_ node's size. Fixed by the same change. The `nodeColor` comment in `Canvas.tsx`
  was a red herring — it fixes the fill colour, and was never why the box was empty.

### Numbers, so drift stays visible

- 777 unit tests in 35 files, ~48s. Coverage 92.7% statements / 83.9% branches / 93.9%
  lines against an 80% gate.
- **24 e2e specs in 3 files, ~52s, all passing.** No `test.fail()` markers left. `pnpm
test:e2e` is part of `pnpm verify`, and the config uses `channel: 'chrome'` so no browser
  download is needed.
- **3 browser perf specs in `tests/e2e/perf.spec.ts`, ~2 min, run by `pnpm
test:perf:browser` and by nothing else.** A separate `playwright.perf.config.ts`, because
  they must be served by `vite preview` rather than `pnpm dev` and because wall-clock
  assertions do not belong in the gate. `playwright.config.ts` has a `testIgnore` for them
  and says why.
- Bundle 719 kB raw, 225 kB gzipped. Lazy chunks: `ElkLayoutEngine` 6.8 kB with elk-api
  inlined, and `elk-worker.min` 1,595 kB / 465 kB gzipped — both fetched on first layout
  only, never at boot.
- 8 validation rules; 3 importers (`.erd.json`, `.mmd`, `.sql`); 4 export formats
  (`.erd.json`, `.mmd`, PNG, SVG).

---

## The assessment behind this ordering

### Is the tool useful?

The bet is sound; the tool is not yet. Three things are genuinely differentiated and worth
protecting:

- **Large schemas.** LOD + viewport culling + hover-tracing is a real answer to a real
  problem. Mermaid cannot lay out 100 tables readably; dbdiagram.io is DSL-first. **Now evidenced** (11 Sep 2026): 120 tables lay out cleanly in under a second in
  Chrome, a real 71-table dump imports with no overlaps at all, and the two shapes that
  broke it — realistic column names, and one hub with 40 dependents — are both fixed with
  browser evidence above. Whether it stays RESPONSIVE while doing it was the last open
  question, and it is now settled (12 Sep 2026): NFR-1.3 is met at the detail level the tool
  renders 120 tables at — hover p95 58 ms, selection p95 95 ms, keystrokes 12 ms. With Detail
  pinned to All fields, hover and keystrokes are inside budget there too; what sits outside
  is the single case of pressing a box in the same motion as arriving on it, at a median
  108 ms against 100, exempted in the SRS with its figure. "Usable at 120 tables" does have
  to mean usable with the fields showing, and on this evidence it is.
- **Nothing leaves the browser.** No backend, no telemetry. A wedge the SaaS tools
  structurally cannot serve: anyone under NDA, under compliance, or air-gapped.
- **SQL DDL to auto-layout in one click.** The strongest path in the product, and as of
  10 Sep 2026 it works end to end — verified in Chrome against the production build, not
  just in dev. The layout half had never worked before that, and it took two separate
  fixes.

Two things block it. One is the bug list above. The other is more important, and is the
reason Tier 2 exists:

**The layout is the user's work product, and the tool throws it away.** The strongest use
case — "make my existing database navigable" — means re-importing after every migration.
Import builds a fresh `Diagram` with regenerated entity ids and re-runs auto-layout, so
every position the user arranged is lost. That makes this a one-shot snapshot generator,
which is something Mermaid already gives away for free. Fixing it turns the tool into a
living document, and it is worth more than any remaining feature on the roadmap.

### Why the tests did not catch any of this

Every defect found on 10 Sep 2026 — drag teleporting, image export hanging, image export
blank, image export inkblotted, click-to-select — sat underneath 680 passing tests and 92%
coverage. All five were in the same gap: between "verified by unit test" and "works when a
human clicks it".

The cause is visible in `vite.config.ts`. `tests/e2e` is excluded from `pnpm test`; the four
Playwright specs have never run (the browsers were not even installed); and `Canvas.tsx` is
coverage-excluded on the reasoning that its behaviour is _"geometry and pointer events —
meaningless to assert in jsdom. Covered by tests/e2e."_

That division of labour is right. The half it defers to never ran, so those exclusions were
load-bearing promises with nothing behind them. Which is why Tier 1 is about closing the
seam, not about the individual bugs.

**Update, 10 Sep 2026: the seam is closed, and it paid for itself immediately.** The suite
now runs in `pnpm verify` against the system Chrome. On its first execution:

- Two of the four existing specs failed on their own locators. `getByText('CUSTOMER')`
  matched the CUSTOMER box _and_ the `customer_id` field; `hasText: 'ORDER'` matched ORDER
  and ORDER_LINE. Both had rotted silently as the UI grew rows.
- The drag-to-connect spec dropped the connection on the middle of the target box, which
  React Flow cannot accept — it only completes within `connectionRadius` (20px) of a
  handle. It had never been a valid gesture.
- The auto-layout spec asserted `before !== after` around a bare Auto-layout click on a
  sample that ships already laid out, so it asserted nothing.
- And then, once it did assert something, it found that **auto-layout was broken
  outright** — fixed on 10 Sep 2026, and it needed two separate fixes rather than one.

One more lesson from that fix, worth keeping: the auto-layout spec now asserts a `worker`
event fires, not merely that the boxes moved. elkjs has an in-process fallback that would
have satisfied every other assertion in that spec while blocking the main thread — the exact
NFR-1.4 violation the worker exists to prevent. **When a requirement is about HOW something
runs, assert the mechanism and not only the outcome.**

The same reasoning applied to the other coverage exclusion nobody had checked:
`src/layout/worker/**` was excluded because it "constructs a real Worker and dynamically
imports elkjs" — and nothing had ever constructed that Worker in a browser. It did not work.
That one is now backed by a spec that clicks Auto-layout in Chrome and asserts the boxes
move. Treat every remaining exclusion in `vite.config.ts` as unverified until an e2e spec
covers it, and add the spec in the same change as the exclusion.

The architecture is not the problem and does not need rework. Enforced layer boundaries,
patch-derived undo inverses, schema-as-source-of-truth, WeakMap-cached derivations: every
fix on 10 Sep was a few lines _because_ the structure held. The quality effort simply went
almost entirely into the layers a unit test can reach.

---

## Tier 1 — what running it on real data found

**This tier is CLEAR as of 12 Sep 2026.** The name changed three times and the changes are
the record. It was "make it work at all" while clicking a table did nothing, the minimap was
blank and auto-layout threw. It became "find out whether it works on real data" once those
were fixed, and that investigation ran: a real 71-table PostgreSQL dump and a schema shaped
like an enterprise warehouse. Both of the things it found — boxes whose size the tool was
wrong about, and a graph shape it was indifferent to — are fixed, with browser evidence
above.

The third question, which the first two were hiding, was whether the tool is RESPONSIVE
while you use 120 tables rather than merely able to arrange them. It is, at the detail level
it renders them at: hover p95 58 ms, selection p95 95 ms, keystrokes 12 ms, all inside
NFR-1.3's budget. One gesture at a pinned detail level the tool does not choose for itself
sits 8 ms outside it, is exempted in the SRS with its figure, and has no named cost left in
it. That closes the tier.

Worth not re-deriving: 120 tables lay out in under a second in Chrome, a real dump imports
with no overlaps at all, and the ~840 ms the perf suite reports in-process was an honest
number. The tool is not slow to lay out, and it is no longer slow to respond.

**The last thing this tier taught, at some cost: `git checkout <commit>` is the ablation.**
A CSS override inside the new build is not the old build — it neutralises declarations but
cannot remove an element or the layer it creates. The scrim went in as a 195 → 110 ms win
measured that way and came out as a 105 → 156 ms regression measured commit against commit.
Both sweeps, three pairs, same unchanged harness.

## Tier 2 — make it actually useful

**Clear as of 12 Sep 2026.** The one item in it — re-import onto an existing diagram — is
built and is FR-6.9. Import used to replace the document wholesale, so opening an updated
dump threw away every position the user had arranged; it now matches by name, keeps the
layout, places only what is new, and shows what it will do before doing it.

The design decision the item asked for, taken and recorded: **a renamed table reads as one
added plus one missing.** With the name as the only join key a rename is indistinguishable
from a drop plus an add, and inferring it from column overlap would silently move the wrong
box on the occasions it guessed wrong. Reporting both, in a preview, one undo step away, is
the honest version. The diff the item wanted shown before applying is the preview itself,
computed by the same pure function that then gets applied — not a second description of it.

## Tier 3 — the features that matter at 100+ tables

In order:

1. Copy / paste / duplicate (FR-7.4); snap-to-grid and alignment guides (FR-3.5); keyboard
   shortcut sheet (FR-9.1); marquee select (FR-2.9); isolate mode (FR-2.8 —
   `nHopNeighbourhood` is written and tested, only unwired); expanding one entity from the
   "N more" row.

---

## Not doing, and why

- **The last 8 ms of the cold click.** Pressing a box in the same motion as arriving on it
  costs a median 108 ms at pinned All fields against NFR-1.3's 100 ms, and the clause is
  narrowed to exempt it. Closing it means making the hover itself cheaper — a redesign of how
  trace state reaches the nodes — and there is no named cost left to remove: the press does
  identical React work cold and warm, and removing dimming entirely still cost 106-113 ms.
  Against a median that drifts ~10 ms on this machine, an 8 ms win could not be demonstrated
  even if it were real. **The one thing already tried and reverted is a single composited dim
  layer, which cost 50 ms rather than saving any** — see Known broken 2 before proposing it
  again.
- **Chen mode** (FR-5.3 to FR-5.7). Five requirements and a second rendering surface, for a
  notation the SRS's own §2 argues against at scale. If it is ever built, build the focused
  sub-view (FR-5.4) only.
- **N-ary relationships, ISA hierarchies, subject areas.** Correctly parked as V2 with slots
  reserved in the IR. Adding one means touching the schema, every adapter's capability set,
  and the renderer.
- **A backend.** V1 is deliberately offline with no server (SRS §1.2), and that constraint is
  one of the three things that makes the tool distinctive. Do not add one without discussing
  it first.

---

## Housekeeping worth doing while nearby

- **~~There are TWO git repositories here, and the inner one is stale.~~ Deleted 12 Sep
  2026.** `er-diagram-editor/` had its own `.git` stuck at a single commit "ER diagram
  editor: V1 through Stage 11", so git run from inside this directory talked to the STALE
  repo: `git status` reported almost every file as modified (126 of them, which is how it
  finally got noticed — an editor with this folder as its workspace root showed the count),
  and `git checkout -- <file>` silently reverted a file to months-old content. It did
  exactly that to `useAutoLayout.ts` on 11 Sep 2026, dropping 25 lines including the whole
  `UseAutoLayoutRequest` fix. Removed after checking that all 216 files it tracked were also
  tracked by the real repo at `Er_tool/`. Git now resolves to `Er_tool/` from anywhere in
  the tree, and `cd ..` / `git -C` are no longer needed. **If a tool ever reports ~126
  modified files here again, a second `.git` is back — check for one before believing it.**

- **`useGoToIssue` is misnamed, and `features/search` now imports it from
  `features/validation-panel`.** It is not issue-specific in anything but its name — it
  switches on an `IssueTarget`, which is the same three kinds the search index emits, and it
  owns two things worth not duplicating: that `selectAttribute` must come AFTER
  `selectEntities` (which clears it), and that a relationship is framed by both its ends.
  Copying twenty lines rather than importing them is how `connect.test.ts` rotted, so the
  import stands — but the hook wants renaming to `useGoToTarget` and moving somewhere
  neither feature owns. Left alone deliberately so a feature commit did not also refactor a
  different feature.

- **The three `.erd.json` fixtures are empty and invalid, and want deleting or
  populating.** `tests/fixtures/README.md` described `reference.erd.json` as 120 entities
  used by "all NFR-1.x performance budgets"; it has none, and no top-level `id`, so
  importing it is rejected outright. Nothing reads any of them — the budgets come from
  `referenceSchema()` inside `tests/perf/layout.perf.test.ts`. The README now says so, but
  the files are still there. Either populate them from that generator, or delete them and
  point the README at the generator.

- **~~The SRS status table is stale on FR-8.1/FR-8.2.~~ Done** — those rows and §13 now read
  correctly. The auto-layout rows (FR-3.1, FR-3.2, FR-3.4, FR-6.8, NFR-1.4) were corrected
  the same way on 10 Sep 2026: every one said "Done" for a feature that throws in every
  browser. Worth remembering why, because it will happen again — the table is written from
  what the unit suite proves, so a row can be entirely honest about the code and still be
  wrong about the product.
- **`tests/unit/domain/validation.test.ts` holds a wall-clock assertion**
  (`expect(perRun).toBeLessThan(16)`) that failed once under 28-way worker contention and
  passed on retry. By this project's own convention that belongs in `pnpm test:perf`, not the
  gate. Left alone deliberately, so it does not look like a gate was weakened to go green —
  but it will flake again.
- **A possible selection race.** While writing a test on 10 Sep, `selectedEntityIds` was
  occasionally empty immediately after "Add your first entity" under coverage
  instrumentation, meaning a newly added entity is sometimes not selected and the inspector
  does not open. Only reproduced under slow timing. It was suspected of sharing a cause with
  the click-to-select bug; that one is now fixed and this has not been seen again, so retest
  before spending time on it.

- **"Saved" is displayed before anything is saved.** Measured in Chrome: the indicator reads
  "Saved" — never "Saving…", no `data-dirty` — for the whole ~640 ms between the sample
  appearing on screen and the row reaching IndexedDB, because opening a diagram never marks
  the store dirty while autosave's 800 ms debounce runs. A reload or a closed tab inside that
  window loses the document while the UI claims it is safe. `Autosaver` and the `isDirty`
  wiring are both fine in isolation; what is missing is that opening a document should mark
  it unsaved. The e2e suite works around it with `waitForPersisted` in `tests/e2e/helpers.ts`
  rather than trusting the indicator.

- **The inspector panel is drawn over the canvas, not beside it.** At both 1280x720 and
  1400x900, selecting anything puts the panel on top of the two right-hand tables of the
  four-box sample: `document.elementFromPoint` on their headers returns
  `erd-inspector__section`, and they cannot be clicked or connected. On a wide schema this
  hides real work behind the panel that just opened. Either lay the panel out beside the
  canvas so React Flow's container shrinks (and let `fitView` frame the smaller area), or
  inset the viewport by the panel width while it is open. The e2e specs avoid it by
  multi-selecting only the two left-hand tables; `coldClick` in `tests/e2e/helpers.ts`
  asserts its target is topmost, which is how this surfaced.

- **The minimap steals pointer events from the bottom-right of the canvas.** At 1280x720 it
  sits on PRODUCT's connection handle in the sample, so that table cannot be connected at
  all — which is why `playwright.config.ts` runs at 1400x900 and says so. Standard for an
  overlay minimap, but it wants either a way to hide it (there is no UI toggle, only the
  `showMinimap` prop) or a smaller footprint.

---

## How to drive the real app

**Start with `pnpm test:e2e`.** The suite runs now, covers the pointer gestures, and is part
of `pnpm verify`; a one-off driver script is for exploring something the suite does not
cover yet. `tests/e2e/helpers.ts` already has `entity()`, `openSample()`, `coldClick()` and
`waitForPersisted()`, and each carries the reason it is shaped the way it is.

Everything below is hard-won on 10 Sep 2026. Without it you will spend an hour
rediscovering it.

```bash
npx vite --port 5173 --strictPort &
until curl -sf http://localhost:5173 >/dev/null; do sleep 1; done
```

Stop it by **PID**, not by killing the npm wrapper — that leaves the listener alive and the
next run hits a port clash:

```bash
netstat -ano | grep ":5173.*LISTENING"   # PID is the last column
```

Driving it:

- **There is no `chromium-cli` on this machine and no Playwright browsers installed.** Use
  the system Chrome: `chromium.launch({ channel: 'chrome', headless: true })`. Avoids the
  ~150 MB download and works today. `playwright.config.ts` does the same with
  `channel: 'chrome'`, which is why `pnpm test:e2e` needs no install step.
- **Open the sample first.** A fresh browser profile boots to the empty state, not to a
  diagram. Click "Open the sample schema" or nothing will be on the canvas.
- **A driver script outside the project cannot resolve `@playwright/test`.** Import it by
  absolute path to
  `node_modules/.pnpm/@playwright+test@<version>/node_modules/@playwright/test/index.js` —
  and it is CommonJS, so use a default import and destructure `chromium` from it.
- **Chrome has `showSaveFilePicker`, and Playwright cannot drive a native OS save dialog.**
  Delete it in an init script to force the object-URL download path:
  `await context.addInitScript(() => { delete window.showSaveFilePicker })`. Consequence:
  the File System Access branch of `saveBlobFile` is exercised by nothing at all.
- **The export surface unmounts as soon as the blob is saved**, well under a second. To
  inspect it, poll from inside the page with `requestAnimationFrame` and stash the result on
  `window`, rather than reading the DOM from the driver after a `waitForTimeout`.
- **Look at the image.** Every image-export bug found produced a valid file of the right
  size with the right background colour. Byte counts and dimensions prove nothing.

Loading a schema of your own:

- **`importFile` in `tests/e2e/helpers.ts` takes a filename and a string**, deletes
  `showOpenFilePicker` so Playwright can drive the `<input type="file">` fallback, and
  clicks through the dialog. A driver script can do the same with
  `fc.setFiles({ name, mimeType, buffer })` — no temp file needed.
- **A `.erd.json` needs `id`, `createdAt` and `updatedAt`** at the top level as well as
  `entities`/`relationships`, or the import is rejected. The checked-in fixtures do not have
  them.
- **Measure boxes with `offsetWidth`/`offsetHeight`, not `getBoundingClientRect`.** Nodes
  sit inside React Flow's scaled viewport, so the client rect is screen pixels while
  `offset*` is the pre-transform layout size — the same unit ELK and `measure.ts` work in.
  Positions come from `style.transform`, which is also pre-scale.
- **Culling breaks any "count all the boxes" measurement.** `onlyRenderVisibleElements`
  means off-screen nodes are absent from the DOM, so an overlap sweep sees only what is
  framed — 7 of 41 before fitting the view, 25 after. Click
  `.react-flow__controls-fitview` and use a tall window, and treat the count as a floor.
- **Pin the detail level before measuring.** Box heights depend on the LOD the layout ran
  at, and LOD follows zoom unless the Detail select is set explicitly.
- **For main-thread blocking, use a `longtask` PerformanceObserver** inside the page. It
  reports exactly what NFR-1.4 is worded against, which wall-clock timing around a click
  does not.

Interaction-specific, learned while fixing click-to-select:

- **`locator.click()` cannot catch a visibility bug.** Playwright's actionability checks
  wait for the element to be visible before pressing, so a box that is `visibility: hidden`
  for 19 ms is politely waited out and the click passes. Every timing bug on this canvas
  needs raw `mouse.move` / `mouse.down` / `mouse.up` with **no pause between the move and
  the press** — which is also what a person does. See `coldClick`.
- **A single `mouse.move` between down and up is not a drag.** It registers as nothing.
  Send several small steps.
- **Assert the thing you are about to click is actually on top.** `document.elementFromPoint`
  plus `closest('.react-flow__node')` turns "the click silently went somewhere else" into a
  named failure. Both the inspector panel and the minimap cover parts of the canvas, so this
  is not hypothetical.
- **`hasText` is a substring match over the whole box.** `hasText: 'CUSTOMER'` matches the
  ORDER box too, because ORDER has a `customer_id` field. Anchor on `.erd-node__name` with a
  whole-string regex — `entity()` does.
- **`test.fail()` outside a test body marks every test in the file.** It has to be the first
  statement _inside_ the test.
- **Do not wait on the "Saved" indicator to mean saved.** It does not. Poll IndexedDB —
  `waitForPersisted` does — and see Housekeeping for why.
