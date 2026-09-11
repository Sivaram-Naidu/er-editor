# What to work on next

**Working queue. Updated 10 September 2026.**

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

### Known broken

1. **NFR-1.3 is still missed for a COLD CLICK when Detail is pinned to All fields.**
   Median **99–108 ms** against a 100 ms budget. Hover is fixed — median 43–53 ms, down
   from 59–99 — and a click with the pointer already resting on the box costs **25 ms**, so
   what is left is the two arriving together. Tier 1 item 1. At the detail level the tool
   actually uses at 120 tables (Follow zoom, so L0) everything is inside budget.
   **NFR-1.4's clause is not on this list**: it was narrowed on 11 Sep 2026 to exclude the
   single task that applies a layout, which is what it was always protecting against
   interference with. See the SRS row.
2. **The p95 of any interaction measurement is not trustworthy on this machine.** Five
   passes with no code change put hover's p95 anywhere between 56 and 170 ms while the
   median moved by 10 ms. Read the medians; `perf.spec.ts` asserts on them for this reason.
3. **No re-sync.** Importing a schema opens a NEW document and re-runs auto-layout, so any
   arrangement work is lost. A product gap rather than a bug — see Tier 2. Now the most
   visible thing on this list, because the layout it throws away is finally a real one.
4. **The inspector is drawn over the canvas, not beside it.** Selecting anything hides the
   right-hand part of the diagram, including whole tables, and they stop being clickable.
   See "Housekeeping".
5. **The minimap swallows pointer events in the bottom-right corner.** Inherent to an
   overlay minimap, but combined with 3 a good deal of the canvas is unreachable. See
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

- 720 unit tests in 31 files, ~58s. Coverage 92.2% statements / 83.7% branches / 93.6%
  lines against an 80% gate.
- **16 e2e specs in 3 files, ~47s, all passing.** No `test.fail()` markers left. `pnpm
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
  browser evidence above. What is still unproven is that it stays RESPONSIVE while doing
  it: NFR-1.3's 100 ms interaction budget is missed with Detail pinned to All fields —
  selection p95 147–162 ms at 120 entities, measured on the production build (Tier 1
  item 1). It is met at the detail level the tool actually uses at that size, which is the
  LOD mechanism doing its job, but "usable at 120 tables" has to mean usable with the
  fields showing.
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

The name of this tier has changed three times now, and the changes are the record. It was
"make it work at all" while clicking a table did nothing, the minimap was blank and
auto-layout threw. It became "find out whether it works on real data" once those were fixed,
and that investigation ran: a real 71-table PostgreSQL dump and a schema shaped like an
enterprise warehouse. Both of the things it found — boxes whose size the tool was wrong
about, and a graph shape it was indifferent to — are fixed, with browser evidence above.

What is left in this tier is the third question, which the first two were hiding: the tool
lays out 120 tables in under a second, but is it RESPONSIVE while you use them? That had
never been measured outside jsdom. It has now, and the answer is item 1.

Worth not re-deriving: 120 tables lay out in under a second in Chrome, a real dump imports
with no overlaps at all, and the ~840 ms the perf suite reports in-process was an honest
number. The tool is not slow to lay out. It is slow to respond, at one detail level, for one
identified reason.

### 1. A cold click costs a hover and a selection, back to back

**Rewritten 11 Sep 2026.** This slot used to say "stop rebuilding every node object on
hover and on selection". That work is done and measured — see the browser table above — and
it fixed hover. It did not fix the number the item was promoted for, and the reason is now
known rather than suspected.

**Already established — do not redo this.**

- **Hover is fixed.** Median at 120 entities / All fields went from 59–99 ms to 43–53 ms.
  Two changes did it: `tracedAttributeIds` is now one set PER ENTITY rather than one for
  the diagram (a shared Set minted a new identity on every hover, so `sameEntityNode`
  failed for all 120 boxes and each redrew every row), and `isDimmed` is gone from node
  data in favour of one `data-tracing` flag on the canvas with the dimming done in CSS.
- **The click itself is cheap.** With the pointer already resting on the box, selecting it
  costs **25 ms** and **5 EntityNode / 40 AttributeRow renders**. Instrumented in Chrome at
  120 entities and All fields. There is nothing left to memoise on that path.
- **What is left is the two together.** `perf.spec.ts` samples a click the way `coldClick`
  does and the way a person does — move onto the box and press with no dwell — so the hover
  render and the selection render serialise, and the probe waits for both. Median 99–108 ms.
  Neither half is over budget; the pair is.
- **Selection must NOT reuse node objects, and that is settled.** React Flow keeps its own
  `selected` on the internal node and re-reads ours only when the object reference differs.
  Reusing them left a shift-clicked pair showing one highlight while the store held two.
  `Canvas` rebuilds every node on a render where the selection moved, deliberately, and
  says so. Do not "optimise" that away — there is an e2e spec, and it is the one that
  caught it.

**What it needs.** A decision about the gesture rather than more memoisation, and probably
a measurement first: how much of the 100 ms is the hover work that a click makes redundant?
A click on a box does not need the trace treatment to be computed and painted before the
selection is — the pointer is going to stop there. Candidates worth measuring: defer the
hover trace by a frame so a press that arrives immediately supersedes it; or skip the trace
render entirely when a pointerdown is already in flight. Both change when the trace appears,
which is a visible change and wants agreeing before it is built.

Worth knowing before starting: the p95 of any of these numbers is not stable on this
machine (Known broken 2), so judge a change on the median over several passes.

### 2. Search and command palette (FR-2.6, FR-9.2)

Promoted out of Tier 3, because the reason it sat there is gone: 100-table diagrams are now
reachable in one click, so "find CUSTOMER" is the next thing standing between the tool and
being usable at that size. Note `fuse.js` and `cmdk` were removed on 10 Sep 2026 after
sitting unused through six stages; re-add them when this starts, or decide that a substring
match over a hundred table names does not need a fuzzy-search library.

## Tier 2 — make it actually useful

### 3. Re-import onto an existing diagram, preserving layout

The item that changes what the tool is. Import currently replaces the document wholesale.
What is needed: import a `.sql` or `.mmd` over the _current_ diagram, match entities by
name (importers regenerate ids, so name is the only join key), keep the positions of
everything that still exists, place only genuinely new entities, and report what was added,
removed and changed. One undo step.

Worth designing properly. It needs a decision on what happens to a renamed table (which
looks identical to a delete plus an add), and probably wants the diff shown before it is
applied.

## Tier 3 — the features that matter at 100+ tables

In order:

4. **Sticky trace on click** (FR-4.4). Today the highlight dies the moment the pointer
   leaves, so you cannot pan while tracing — which defeats tracing on any schema larger
   than one screen.
5. Copy / paste / duplicate (FR-7.4); snap-to-grid and alignment guides (FR-3.5); keyboard
   shortcut sheet (FR-9.1); marquee select (FR-2.9); isolate mode (FR-2.8 —
   `nHopNeighbourhood` is written and tested, only unwired); expanding one entity from the
   "N more" row.

---

## Not doing, and why

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

- **There are TWO git repositories here, and the inner one is stale.** The real repo is at
  `Er_tool/` (branch `fix/auto-layout-worker`, current history); `er-diagram-editor/` also
  has its own `.git`, stuck at a single commit "ER diagram editor: V1 through Stage 11".
  A `git` command run from inside `er-diagram-editor/` therefore talks to the STALE repo:
  `git status` reports almost every file as modified, and — the part that actually bites —
  `git checkout -- <file>` silently reverts the file to months-old content. It did exactly
  that to `useAutoLayout.ts` on 11 Sep 2026, dropping 25 lines including the whole
  `UseAutoLayoutRequest` fix. Run git from `Er_tool/`, or use `git -C`. The inner `.git`
  wants deleting, but that is not a change to make in passing.

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
