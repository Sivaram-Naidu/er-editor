---
description: Work the next item from NEXT.md, verify it for real, and update the queue
argument-hint: optional scope, e.g. "tier 1" or "tier 1 item 3"
---

Read `er-diagram-editor/NEXT.md` before anything else. It is the working queue: the tiers
are in priority order, each item carries what has already been diagnosed, and the bottom of
the file has the recipe for driving the real app in a browser.

**Scope for this run:** $ARGUMENTS

If that is empty, take the single highest-priority item — the first unfinished item in the
lowest-numbered tier — and do that one. Do not silently work through a whole tier unless the
scope above asks for it.

## How to do the work

1. **Do not redo diagnosis that is already written down.** Items carry a "already
   established — do not redo this" block where earlier sessions did the work. Start from it.

2. **Respect the stop points.** Some items say the approach needs agreeing first (Tier 1
   item 1 is one: the fix is a design change to how trace state reaches the nodes). When you
   hit one, come back with a recommendation and a question instead of building it. That is
   not stopping short — it is the item's own instruction.

3. **Verify it the way the item can actually fail.** This is the whole lesson of the file:
   five bugs shipped underneath 680 passing tests and 92% coverage because they lived in the
   gap between "unit test passes" and "works when a human clicks it".
   - Anything touching interaction, rendering, layout or export: drive the real app in
     Chrome using the recipe in NEXT.md, and **look at the result**. A valid file of the
     right size proves nothing.
   - Add or extend a test that would have caught the bug. Where the defect sat between two
     units that were each individually correct, the test belongs on the pair — see the
     two-tier position test in `tests/unit/render/canvas.test.tsx` for the shape of that.

4. **Run the gate** from `er-diagram-editor/`: `pnpm verify` (typecheck, lint, test, build).
   Do not weaken a lint rule, a type, or a coverage threshold to make it pass.

## How to close the item out

5. **Update `er-diagram-editor/NEXT.md`:**
   - Remove the finished item from its tier.
   - Add a row to the "Verified in a real browser" table saying what was checked and the
     concrete evidence — the measurement, not the word "fixed". That record is what stops
     the next session redoing the work or distrusting it.
   - Refresh the "Numbers" block if the test count, coverage or bundle size moved.
   - If the item is only partly done, leave it in its tier and write down exactly where it
     got to and what is left. Do not mark it done.

6. **Anything new you discover goes in the file, not into this run.** If you find a
   separate bug while working (which is how click-to-select surfaced), add it to
   "Known broken" or the right tier and carry on with the item at hand. Say so in your
   report.

7. **Do not start a third list.** Requirement status lives in `docs/SRS.md`; sequencing
   lives in `NEXT.md`. If an SRS row is now wrong, correct that row.

8. **Record a trap if one bit you.** If the bug came from a library behaving unlike its
   documentation or its name suggests, add it to the "Things that have gone wrong before"
   list in `er-diagram-editor/CLAUDE.md`, briefly.

9. **Commit the completed item on its own.** The default branch is `main`; if the working
   tree is still on it, create a working branch first. Leave unrelated changes out of the
   commit.

Finally, report what you did, what you verified and how, and what is now at the top of the
queue.
