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

### Known broken

1. **No re-sync.** Importing a schema opens a NEW document and re-runs auto-layout, so any
   arrangement work is lost. A product gap rather than a bug — see Tier 2. Now the most
   visible thing on this list, because the layout it throws away is finally a real one.
2. **The inspector is drawn over the canvas, not beside it.** Selecting anything hides the
   right-hand part of the diagram, including whole tables, and they stop being clickable.
   See "Housekeeping".
3. **The minimap swallows pointer events in the bottom-right corner.** Inherent to an
   overlay minimap, but combined with 2 a good deal of the canvas is unreachable. See
   "Housekeeping".

Fixed and verified in a browser on 10 Sep 2026 — do not re-open these without new evidence:

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

- 697 unit tests in 29 files, ~58s. Coverage 92.1% statements / 83.0% branches / 93.4%
  lines against an 80% gate.
- **15 e2e specs in 2 files, ~40s, all passing.** No `test.fail()` markers left. `pnpm
test:e2e` is part of `pnpm verify`, and the config uses `channel: 'chrome'` so no browser
  download is needed.
- Bundle 718 kB raw, 222 kB gzipped. Lazy chunks: `ElkLayoutEngine` 6.8 kB with elk-api
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
  problem. Mermaid cannot lay out 100 tables readably; dbdiagram.io is DSL-first.
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

## Tier 1 — find out whether it works on real data

The name of this tier changed on 10 Sep 2026, and the change is the point. It used to be
"make it work at all", because clicking a table did not select it, the minimap was blank and
auto-layout threw. Those are fixed and verified in Chrome. What is left is not a bug list —
it is that every claim in this repository about behaviour at scale still rests on synthetic
fixtures.

### 1. Run one real schema through it

Now unblocked, and the highest-value thing left. Auto-layout works, so an imported dump
finally shows a layout rather than the placeholder grid.

`docs/SRS.md` §13.1 already admits every performance figure comes from synthetic fixtures
with uniform table sizes and tidy relationships. A real dump — 60-column tables, 200 foreign
keys into one table, names like `tbl_cust_hist_2019` — will teach more in five minutes than
another week of synthetic testing. The width estimates in `measure.ts` are exactly the kind
of thing it should break, and there is a no-overlap test that will say so.

Two numbers to collect while you are in there, because neither has ever been measured in a
browser:

- **NFR-1.4 at scale.** The 120-entity reference schema has never been laid out in Chrome.
  The ~840 ms on record is `pnpm test:perf` calling ELK in-process on the test thread. The
  four-entity sample takes ~1.06 s end to end in the browser, but that is almost entirely
  worker fetch and GWT init, so it says nothing about 120 tables. Lay out 120 and record it.
- **Whether the main thread actually stays free.** It is genuinely a worker now, so it
  should be — but NFR-1.4 says "never blocks for more than 50 ms at a time" and nobody has
  looked at a long-task trace. `postMessage` of a large graph is itself a main-thread cost,
  and so is applying the result through the command stack.

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
5. **Stop rebuilding every node object on hover.** The performance half of the
   click-to-select fix, and worth doing on its own merits — it is what CLAUDE.md's
   split-store note already promises ("hover is separated _so that_ it does not re-render
   every table"), and `Canvas` does not honour it: it takes `hoveredEntityId` as a prop and
   rebuilds all N nodes through the `baseNodes` memo on every hover. Not a correctness bug
   any more — carrying `measured` made rebuilds harmless — so this is now purely about not
   doing O(entities x attributes) work per hover at 120 tables. The move is to have
   `EntityNode` subscribe to trace state by its own id instead of receiving it in
   `node.data`. Measure first: at four entities it is free, and the cost has never been
   measured at scale.
6. Copy / paste / duplicate (FR-7.4); snap-to-grid and alignment guides (FR-3.5); keyboard
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
