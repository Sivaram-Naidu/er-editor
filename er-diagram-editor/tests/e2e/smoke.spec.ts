import { expect, test } from '@playwright/test'

import { entity, openSample } from './helpers'

/**
 * Boot, connect, layout and storage. Pointer-level gestures live in `interaction.spec.ts`.
 *
 * "Running Playwright now keeps the harness honest — an E2E suite first wired up late
 * tends to be wired up wrong" is what this file used to say, and it was right: the suite
 * was not executed once before 10 Sep 2026, and two of its four specs failed immediately
 * on locators that had quietly become ambiguous as the UI grew. See `entity()` in
 * `helpers.ts`. `pnpm test:e2e` is part of `pnpm verify` now, so this cannot recur.
 */
test('the app boots and renders its shell', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'ER Diagram Editor' })).toBeVisible()
})

test('dragging from one table onto another creates a relationship', async ({ page }) => {
  // The one part of FR-1.4 unit tests cannot reach: React Flow's connection handling is
  // geometry and pointer capture. `buildConnectCommands` covers what the gesture MEANS;
  // this covers that the gesture fires at all.
  await openSample(page)

  const product = entity(page, 'PRODUCT')
  const customer = entity(page, 'CUSTOMER')

  // Handle to handle. Dropping on the middle of the target box — which is what this spec
  // used to do — cannot work: React Flow only completes a connection within
  // `connectionRadius` (20px) of a handle, and the centre of a 340px box is nowhere near
  // one. It failed for that reason the first time the suite was run, not because the
  // gesture was broken.
  await product.locator('.erd-handle--node.source').hover()
  await page.mouse.down()
  await customer.locator('.erd-handle--node.target').hover()
  await page.mouse.up()

  // Sample ships with three relationships; the drag makes a fourth.
  await expect(page.locator('.erd-edge')).toHaveCount(4)
})

/*
 * EXPECTED TO FAIL: auto-layout is broken in the browser. Not the spec — the feature.
 *
 * `elkjs/lib/elk.bundled.js` cannot run inside a Web Worker, and that is what
 * `src/layout/worker/layout.worker.ts` asks it to do. It throws
 * `_Worker is not a constructor` on construction, in dev and in the production build
 * alike, so the button does nothing and an imported schema stays on the placeholder grid.
 * Diagnosis and the recommended fix are in NEXT.md, Tier 1.
 *
 * Left as a failing-on-purpose spec rather than deleted or skipped: it is the proof, and
 * Playwright turns the suite red the moment it starts passing, which is the reminder to
 * drop this marker.
 */
test('auto-layout rearranges the diagram without blocking the page', async ({ page }) => {
  // Inside the body, not above it: `test.fail()` at file scope marks every test in the
  // file, which turned the whole spec red the first time it was written this way.
  test.fail()

  // The Worker and the dynamic elkjs import are browser-only, so this is the only place
  // the wiring can be exercised. The layout algorithm itself is covered in unit tests.
  await openSample(page)

  const customer = entity(page, 'CUSTOMER')

  // Move a box off its laid-out position FIRST. The sample ships already auto-laid-out, so
  // `before !== after` around a bare Auto-layout click asserts nothing — ELK returns the
  // same answer and the assertion failed the first time this spec was run. Displacing a
  // box makes the claim real: layout has to override the arrangement it finds.
  const origin = await customer.boundingBox()
  const grip = { x: origin!.x + origin!.width / 2, y: origin!.y + 12 }
  await page.mouse.move(grip.x, grip.y)
  await page.mouse.down()
  // Several small steps, not one jump: a drag arrives as a stream of moves, and a single
  // one followed straight away by the release does not register as a gesture.
  for (let step = 1; step <= 6; step++) {
    await page.mouse.move(grip.x + step * 30, grip.y + step * 26)
  }
  await page.mouse.up()

  const displaced = await customer.boundingBox()
  expect(Math.round(displaced!.x)).not.toBe(Math.round(origin!.x))

  await page.getByRole('button', { name: 'Auto-layout' }).click()

  // The button returns to its resting label once the worker replies.
  await expect(page.getByRole('button', { name: 'Auto-layout' })).toBeEnabled({ timeout: 20_000 })
  await expect(page.getByRole('alert')).toHaveCount(0)

  await expect
    .poll(async () => Math.round((await customer.boundingBox())!.x), { timeout: 10_000 })
    .not.toBe(Math.round(displaced!.x))

  // One undo step for the whole rearrangement (FR-3.4).
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(customer).toHaveCount(1)
})

test('IndexedDB is available in the real browser', async ({ page }) => {
  // Guards the assumption behind FR-7.2/7.3. If this fails, the app is silently running
  // on the in-memory fallback and nothing survives a reload.
  await page.goto('/')

  const available = await page.evaluate(() => typeof indexedDB !== 'undefined')
  expect(available).toBe(true)
})
