import { expect, test, type Page } from '@playwright/test'

import { onAGrid, referenceSchema } from '../fixtures/referenceSchema'

import { importFile } from './helpers'

/**
 * NFR-1.3 and NFR-1.4's main-thread clauses, measured in Chrome on the reference schema.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM THE REST OF tests/e2e
 * ---------------------------------------------------------
 * Two reasons, and both are load-bearing.
 *
 * 1. IT MUST RUN AGAINST THE PRODUCTION BUILD. NFR-1.4's main-thread figure sat in the SRS
 *    for a day as 323 / 142 / 473 ms. The same clicks against `vite preview` gave
 *    51 / 62 / 96 ms: React's development build — `jsxDEV`, prop validation, StrictMode's
 *    double render — was most of what had been measured. `playwright.config.ts` serves
 *    `pnpm dev`, so a perf spec sitting in that project would re-make the same mistake and
 *    report numbers five times too large. `playwright.perf.config.ts` serves
 *    `vite preview`, and `assertProductionBuild` below fails loudly rather than quietly
 *    measuring the wrong thing if that is ever undone.
 *
 * 2. IT IS A WALL-CLOCK ASSERTION, AND THOSE DO NOT BELONG IN THE GATE. This project's own
 *    convention (see `pnpm test:perf`, and the note in NEXT.md about the stray timing
 *    assertion in `validation.test.ts`) is that timing budgets are a command you run, not
 *    something that can fail `pnpm verify` on a loaded machine. `pnpm test:e2e` ignores
 *    this file; `pnpm test:perf:browser` is what runs it.
 *
 * WHAT IT IS GUARDING
 * -------------------
 * The 0 / 51 / 55 ms (120 entities) and 135 ms (300 entities) figures in the SRS came from
 * a driver script that was never checked in. They were the hardest numbers in the project
 * to get and the only ones with nothing protecting them — a regression would have been
 * completely silent, and nobody could re-measure without writing the harness again. This
 * is that harness.
 */

const LOD_OPTIONS = ['Names', 'Keys', 'All fields'] as const

/** NFR-1.3's budget: input-to-visual-feedback at p95. Reported against, not asserted. */
const INTERACTION_BUDGET_MS = 100

/**
 * The regression guard, and deliberately nowhere near the budget above.
 *
 * NFR-1.3 IS CURRENTLY MISSED, and this file is what established that: on the production
 * build at 120 entities, hover p95 runs 138–153 ms and selection p95 180–315 ms, in both
 * detail states. Keystrokes are fine at 14–20 ms. The cause is not a mystery — `Canvas`
 * takes `hoveredEntityId` and the selection as props and rebuilds all N node objects
 * through its `baseNodes` memo on every hover and every click, walking every attribute of
 * every entity. NEXT.md's Tier 3 item 5 asked for exactly this measurement before anyone
 * did the work; it has it now, and the item has been promoted.
 *
 * So the assertion cannot be the budget without leaving a permanently red command, and it
 * must not be a snug fit around today's figure either: interaction latency on this machine
 * varies by a factor of two between runs, and a tripwire that flakes gets muted. It is
 * therefore the same kind of guard `tests/perf/layout.perf.test.ts` uses and says so — an
 * order-of-magnitude check, not a benchmark. The real signal is the `MISSES NFR-1.3` flag
 * on the reported lines, which is unconditional and does not move.
 *
 * It is applied to the MEDIAN rather than the p95 because the median is what stays still
 * between runs; the p95 is what the requirement is worded against, so that is what gets
 * printed. Lower this to 100 and delete the note when item 5 lands.
 */
const INTERACTION_REGRESSION_CEILING_MS = 250

/**
 * NFR-1.4's budget as the clause is now worded: interaction must not block for more than
 * 50 ms, and the ONE terminal block when a deliberate auto-layout is applied is permitted
 * up to here.
 *
 * A tripwire, not a target, and loose on purpose. The apply sits right on `longtask`'s own
 * 50 ms floor — see `worstBlockSince` — so the worst of three runs comes back anywhere
 * between 0 and 88 ms on the same build, on the same machine, minutes apart. This catches
 * something making that materially worse; it does not fail because the laptop was busy.
 */
const APPLY_BLOCK_CEILING_MS = 200

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]!
}

/** The p95 of a sample, by nearest-rank — the definition NFR-1.3 is worded against. */
function percentile95(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]!
}

/**
 * Refuse to measure the dev build.
 *
 * This is the whole reason the 473 ms number was wrong, so it gets an assertion rather
 * than a comment. Vite's dev server injects `/@vite/client` and serves the entry as
 * `/src/main.tsx`; a built bundle has neither and loads a hashed file out of `/assets/`.
 */
async function assertProductionBuild(page: Page): Promise<void> {
  const scripts = await page.evaluate(() =>
    [...document.querySelectorAll('script')].map((script) => script.src),
  )

  expect(
    scripts.some((src) => src.includes('/@vite/client') || src.includes('/src/main.tsx')),
    'this is the Vite DEV build — React development mode dominates its own profile, and ' +
      'every number measured here would be several times too large. Run it through ' +
      'playwright.perf.config.ts, which serves `vite preview`.',
  ).toBe(false)

  expect(
    scripts.some((src) => src.includes('/assets/')),
    'no built entry chunk was loaded, so this is not the production build',
  ).toBe(true)
}

/**
 * Frame the whole diagram, and wait for the viewport to settle.
 *
 * Not cosmetic. `onlyRenderVisibleElements` culls off-screen nodes out of the DOM
 * entirely, so how much React and the browser have to do depends on how many boxes are
 * framed — and that is the single biggest lever on every number in this file. Without
 * fitting the view before each measurement the first run is honest and the rest are taken
 * against a nearly empty canvas: the first attempt at this spec reported
 * `[51, 0, 0]`, `[84, 0, 0]`, `[54, 0, 0]`, because ELK's arrangement lands somewhere the
 * import grid's viewport was not looking. Fit first, and every run measures 120 boxes.
 */
async function fitView(page: Page): Promise<void> {
  await page.locator('.react-flow__controls-fitview').click()
  await page.waitForTimeout(800)
}

/** Import the 120-entity reference schema, already positioned so import does not arrange it. */
async function openReferenceSchema(page: Page): Promise<number> {
  const diagram = onAGrid(referenceSchema())
  // `.erd.json` is the `Diagram` itself — `exportNativeJson` is `JSON.stringify` and
  // nothing more, and it is not on the `io` barrel.
  const content = JSON.stringify(diagram, null, 2)

  await page.goto('/')
  await assertProductionBuild(page)
  await importFile(page, 'reference.erd.json', content)

  // Culling means the DOM never holds all 120. Wait on the model's own count instead.
  await expect(page.getByText(`${String(diagram.entities.length)} entities`)).toBeVisible({
    timeout: 30_000,
  })

  return diagram.entities.length
}

// ─────────────────────────────────────────────────────────────────────────────
// NFR-1.4 — the main thread while a layout is applied
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A `longtask` PerformanceObserver, which is the instrument NFR-1.4 is actually worded
 * against.
 *
 * Wall-clock timing around the click is NOT the same measurement and would pass where the
 * requirement fails: the clause is about a single uninterrupted block, and the click takes
 * a second of mostly-idle time waiting for a worker. `longtask` reports exactly the thing
 * the clause names — a task that occupied the main thread for over 50 ms.
 */
async function armLongTaskObserver(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store: number[] = []
    ;(window as unknown as { __blocks: number[] }).__blocks = store
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) store.push(entry.duration)
    }).observe({ entryTypes: ['longtask'] })
  })
}

/**
 * The worst block recorded since `mark`, or 0 if there was none.
 *
 * ZERO IS A REAL READING, AND IT MEANS SOMETHING SPECIFIC. `longtask` has a 50 ms floor by
 * definition — the browser emits an entry only for a task that already exceeded it — so
 * this instrument cannot distinguish 12 ms from 49 ms and does not try to. It answers
 * exactly the question NFR-1.4's clause asks ("did anything block for more than 50 ms, and
 * by how much"), which is why it is the right instrument and why the readings are bimodal:
 * this apply sits on the threshold, so runs come back 0, 0, 53.
 *
 * That is also why the assertion below takes the WORST of the three runs rather than the
 * median. A median over values clustered on a detection threshold is noise; the worst is
 * the only summary that means anything here, and it is the conservative one.
 */
async function worstBlockSince(page: Page, mark: number): Promise<number> {
  return page.evaluate((from) => {
    const store = (window as unknown as { __blocks: number[] }).__blocks
    return store.slice(from).reduce((worst, duration) => Math.max(worst, duration), 0)
  }, mark)
}

async function blockCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __blocks: number[] }).__blocks.length)
}

test.describe('NFR-1.4 — applying a layout', () => {
  test('the reference schema lays out without an oversized main-thread block', async ({ page }) => {
    test.setTimeout(300_000)

    const count = await openReferenceSchema(page)
    await armLongTaskObserver(page)

    const autoLayout = page.getByRole('button', { name: 'Auto-layout' })
    const undo = page.getByRole('button', { name: /^Undo$/ })
    const worst: { label: string; runs: number[] }[] = []

    for (const label of LOD_OPTIONS) {
      // Box heights — and therefore how much the browser has to lay out — depend on the
      // detail level the layout ran at, so it is pinned rather than left to follow zoom.
      await page.getByLabel('Detail').selectOption({ label })
      const runs: number[] = []

      // Three runs, median reported: single runs on this canvas vary by ±20 ms.
      for (let run = 0; run < 3; run++) {
        // Identical starting conditions for every run — see `fitView`.
        await fitView(page)
        const mark = await blockCount(page)

        await autoLayout.click()
        await expect(autoLayout).toBeEnabled({ timeout: 60_000 })
        await expect(undo).toHaveAttribute('title', 'Undo Auto-layout', { timeout: 30_000 })
        // The block lands when React commits, which is after the button re-enables.
        await page.waitForTimeout(600)

        runs.push(await worstBlockSince(page, mark))

        /*
         * Undo, so the next run has something to move.
         *
         * ELK is deterministic: clicking Auto-layout on an already-arranged graph returns
         * the same positions, nothing moves, React commits nothing and the measurement
         * comes back a flattering zero. Undo puts the 120 boxes back on the import grid,
         * which is what makes the next click a real rearrangement. It is also the cheapest
         * way to get there — re-importing costs a page load and a parse per run.
         */
        await undo.click()
        await expect(undo).not.toHaveAttribute('title', 'Undo Auto-layout', { timeout: 30_000 })
        await page.waitForTimeout(400)
      }

      worst.push({ label, runs })
    }

    const report = worst
      .map(
        ({ label, runs }) =>
          `${label} ${Math.max(...runs).toFixed(0)}ms [${runs.map((run) => run.toFixed(0)).join(', ')}]`,
      )
      .join(' · ')
    console.log(
      `NFR-1.4 worst longtask over 3 runs, ${String(count)} entities — ${report} ` +
        `(0 = no task exceeded longtask's 50 ms floor)`,
    )

    for (const { label, runs } of worst) {
      expect(
        Math.max(...runs),
        `applying a layout at "${label}" blocked the main thread for longer than any ` +
          `measurement on record. See NEXT.md and SRS NFR-1.4 before raising the ceiling.`,
      ).toBeLessThan(APPLY_BLOCK_CEILING_MS)
    }

    expect(await page.getByRole('alert').count(), 'the layout reported an error').toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// NFR-1.3 — input to visual feedback
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wait until the main thread is genuinely idle.
 *
 * NFR-1.3 is a per-interaction budget, so each sample has to START from rest. Without this
 * the loop below fires the next gesture while React is still rebuilding all 120 node
 * objects from the last one, and the probe charges that leftover work to the new input:
 * the same build measured hover at p95 44 ms with a settle between samples and 148 ms
 * without one. The second figure is a pointer-sweep stress test, which is a fair thing to
 * want and is NOT what the requirement says.
 *
 * Idle is defined here as three consecutive animation frames arriving on schedule. A magic
 * `waitForTimeout` would do the same job on a quiet machine and silently fail to on a busy
 * one, which is the failure mode this whole file exists to avoid.
 */
async function settle(page: Page, timeoutMs = 2_000): Promise<void> {
  await page.evaluate(async (limit) => {
    const deadline = performance.now() + limit
    let calm = 0
    let last = performance.now()

    while (calm < 3 && performance.now() < deadline) {
      await new Promise((resolve) => requestAnimationFrame(resolve))
      const now = performance.now()
      calm = now - last < 20 ? calm + 1 : 0
      last = now
    }
  }, timeoutMs)
}

/**
 * Arm a latency probe on ONE named box, then read the measurement after the gesture.
 *
 * THREE THINGS HERE ARE NOT OBVIOUS, AND ALL THREE MATTER.
 *
 * `t0` is taken from the TRUSTED EVENT'S OWN `timeStamp`, not from the driver. Playwright
 * runs out of process, so a `performance.now()` on the driver side before `mouse.move`
 * measures the CDP round trip as well as the app. A trusted event's `timeStamp` is on the
 * page's `performance.now()` timeline and is set when the browser created the event, which
 * is the moment the requirement means by "input".
 *
 * `t1` is taken inside a `requestAnimationFrame` AFTER the change is observable, not at the
 * moment the DOM changed. The requirement says visual FEEDBACK, and a DOM mutation is not
 * visible until the frame that paints it. rAF runs after the task that mutated — including
 * all of React's synchronous render and commit — so the frame callback is the closest
 * honest proxy for "the user can now see it". Slightly pessimistic, which is the right
 * direction for a budget.
 *
 * The predicate is anchored to the TARGET BOX'S OWN id, and that is not fussiness. The
 * first version of this asked whether *any* node was traced or selected, which forced each
 * sample to clear the previous state first — and the only cheap way to do that was to park
 * the pointer at (4, 4) and click. (4, 4) is in the TOOLBAR, not on the canvas, so every
 * "clear" was pressing whatever control sits in the top-left corner. It produced a
 * selection p95 of 297 ms on one run against 120 ms on the next, which is what sent
 * somebody looking. Asking about one named box needs no clearing at all.
 *
 * A sample whose target is ALREADY traced or selected is skipped rather than recorded:
 * hovering a box that is a neighbour of the last one leaves it traced, and the probe would
 * otherwise see its predicate satisfied at t0 and report a flattering near-zero.
 */
async function armLatencyProbe(
  page: Page,
  eventType: 'pointermove' | 'pointerdown',
  targetId: string,
  feedback: 'traced' | 'selected',
): Promise<void> {
  await page.evaluate(
    ({ type, id, kind }) => {
      const probe: { t0?: number; t1?: number; skipped?: boolean } = {}
      ;(window as unknown as { __probe: typeof probe }).__probe = probe

      const node = (): Element | null =>
        document.querySelector(`.react-flow__node[data-id="${id}"]`)

      const settled = (): boolean => {
        const target = node()
        if (target === null) return false
        return kind === 'selected'
          ? target.classList.contains('selected')
          : target.querySelector('.erd-node[data-traced]') !== null
      }

      // Already in the state under test, so there is no transition left to time.
      if (settled()) {
        probe.skipped = true
        return
      }

      const onInput = (event: Event): void => {
        if (!event.isTrusted || probe.t0 !== undefined) return
        probe.t0 = event.timeStamp
        window.removeEventListener(type, onInput, true)
      }
      window.addEventListener(type, onInput, true)

      // Polled per frame rather than through a MutationObserver, so that the timestamp is
      // the FRAME'S and not the mutation's.
      const tick = (): void => {
        if (probe.t0 !== undefined && settled()) {
          probe.t1 = performance.now()
          return
        }
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    },
    { type: eventType, id: targetId, kind: feedback },
  )
}

async function readLatency(page: Page): Promise<number | undefined> {
  return page.evaluate(async () => {
    const probe = (window as unknown as {
      __probe: { t0?: number; t1?: number; skipped?: boolean }
    }).__probe
    if (probe.skipped === true) return undefined
    // Give the probe a few frames to land before declaring it a miss.
    for (let frame = 0; frame < 40 && probe.t1 === undefined; frame++) {
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }
    return probe.t0 === undefined || probe.t1 === undefined ? undefined : probe.t1 - probe.t0
  })
}

/**
 * The two detail states worth measuring, and why both.
 *
 * "Follow zoom" is what someone actually sees with 120 tables framed: the LOD drops to
 * names-only, which is the mechanism ADR-0004 exists to provide and the state the tool is
 * meant to be used in at this size. "All fields" is the worst case, reachable in one click
 * from the toolbar, and NFR-2.1 says every NFR-1 budget must hold at 120 entities without
 * qualifying it by zoom. A number from only one of them would be arguable; both are not.
 */
const DETAIL_STATES = [
  { name: 'follow zoom', value: 'auto' },
  { name: 'all fields', value: '2' },
] as const

for (const detail of DETAIL_STATES) {
  test.describe(`NFR-1.3 — input to visual feedback (${detail.name})`, () => {
    test('hover, selection and inline-edit keystrokes stay inside the p95 budget', async ({
      page,
    }) => {
      test.setTimeout(300_000)

      await openReferenceSchema(page)
      await page.getByLabel('Detail').selectOption(detail.value)
      await fitView(page)

      const boxes = page.locator('.react-flow__node')
      const onScreen = await boxes.count()
      expect(onScreen, 'no boxes are rendered, so there is nothing to hover').toBeGreaterThan(4)

      // Aim at each box's header, and carry its id so the probe can ask about that box
      // specifically rather than about "anything on the canvas" — see `armLatencyProbe`.
      const targets: { id: string; x: number; y: number }[] = []
      for (let index = 0; index < onScreen; index++) {
        const box = boxes.nth(index)
        const rect = await box.boundingBox()
        const id = await box.getAttribute('data-id')
        if (rect !== null && rect.width > 0 && id !== null) {
          targets.push({ id, x: rect.x + rect.width / 2, y: rect.y + Math.min(6, rect.height / 3) })
        }
      }

      const hover: number[] = []
      const select: number[] = []
      const keystroke: number[] = []

      // HOVER. Straight from one box to the next, which is what a person reading a diagram
      // does. A target that the previous hover already traced is skipped by the probe.
      for (const target of targets) {
        if (hover.length >= 25) break
        await settle(page)
        await armLatencyProbe(page, 'pointermove', target.id, 'traced')
        await page.mouse.move(target.x, target.y)
        const measured = await readLatency(page)
        if (measured !== undefined) hover.push(measured)
      }

      // SELECTION. Move and press with no pause between them — `coldClick` explains why
      // that matters on this canvas, and it is also what a person does. A cold click on a
      // box narrows the selection to it, so no clearing step is needed between samples.
      for (const target of targets) {
        if (select.length >= 25) break
        await settle(page)
        await armLatencyProbe(page, 'pointerdown', target.id, 'selected')
        await page.mouse.move(target.x, target.y)
        await page.mouse.down()
        await page.mouse.up()
        const measured = await readLatency(page)
        if (measured !== undefined) select.push(measured)
      }

      // INLINE EDIT KEYSTROKES. `InlineName`'s input is controlled, so the character is on
      // screen only once React has re-rendered with the new draft — which is what makes
      // this a keystroke measurement rather than a test of the browser's native echo.
      await boxes.first().locator('.erd-node__name').dblclick()
      await expect(page.locator('.erd-inline-input')).toBeVisible()

      for (let sample = 0; sample < 25; sample++) {
        await settle(page)
        await page.evaluate(() => {
          const probe: { t0?: number; t1?: number } = {}
          ;(window as unknown as { __probe: typeof probe }).__probe = probe
          const before =
            document.querySelector<HTMLInputElement>('.erd-inline-input')?.value.length ?? 0

          const onKey = (event: Event): void => {
            if (!event.isTrusted || probe.t0 !== undefined) return
            probe.t0 = event.timeStamp
            window.removeEventListener('keydown', onKey, true)
          }
          window.addEventListener('keydown', onKey, true)

          const tick = (): void => {
            const now = document.querySelector<HTMLInputElement>('.erd-inline-input')
            if (probe.t0 !== undefined && (now?.value.length ?? 0) > before) {
              probe.t1 = performance.now()
              return
            }
            requestAnimationFrame(tick)
          }
          requestAnimationFrame(tick)
        })

        await page.keyboard.press('x')
        const measured = await readLatency(page)
        if (measured !== undefined) keystroke.push(measured)
      }

      await page.keyboard.press('Escape')

      const measurements = [
        ['hover', hover],
        ['selection', select],
        ['keystroke', keystroke],
      ] as const

      for (const [name, samples] of measurements) {
        expect(samples.length, `no ${name} latency samples were captured`).toBeGreaterThan(9)
        const p95 = percentile95(samples)
        console.log(
          `NFR-1.3 ${name} (${detail.name}): p95 ${p95.toFixed(0)}ms, ` +
            `median ${median(samples).toFixed(0)}ms, worst ${Math.max(...samples).toFixed(0)}ms, ` +
            `n=${String(samples.length)}` +
            (p95 < INTERACTION_BUDGET_MS ? '' : '  ← MISSES NFR-1.3'),
        )
      }

      /*
       * Assertions come after ALL the logging, deliberately, and softly.
       *
       * One failing expectation would otherwise abort the test and the remaining figures
       * would never be printed — which is most of what someone runs this for. `expect.soft`
       * records the failure and carries on.
       */
      for (const [name, samples] of measurements) {
        expect
          .soft(
            median(samples),
            `${name} feedback at "${detail.name}" is several times worse than anything on ` +
              `record. NFR-1.3's budget is ${String(INTERACTION_BUDGET_MS)}ms at p95 and is ` +
              `already missed — see INTERACTION_REGRESSION_CEILING_MS before touching this.`,
          )
          .toBeLessThan(INTERACTION_REGRESSION_CEILING_MS)
      }
    })
  })
}
