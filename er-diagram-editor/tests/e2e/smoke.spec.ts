import { expect, test, type Page } from '@playwright/test'

import {
  entity,
  importFile,
  mergeFile,
  nodeTransforms,
  openSample,
  waitForPersisted,
} from './helpers'

/** Three tables in a chain: the shape a layered layout has an obvious answer for. */
const CHAIN_SQL = `
CREATE TABLE customers (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE
);
CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id)
);
CREATE TABLE order_lines (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  quantity INTEGER NOT NULL
);
`

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

test('auto-layout rearranges the diagram without blocking the page', async ({ page }) => {
  // The Worker and the dynamic elkjs import are browser-only, so this is the only place
  // the wiring can be exercised — and for six stages nothing did, so it did not work at
  // all. The layout algorithm itself is covered in unit tests; this covers that a click
  // reaches ELK and the answer reaches the canvas.
  await openSample(page)

  // Layout must happen off the main thread (NFR-1.4, FR-3.2). Asserting the worker is
  // real is the only way to tell that apart from ELK running in-process: elkjs has an
  // in-process fallback that would satisfy every other assertion here while blocking the
  // UI on a 300-table schema.
  const workers: string[] = []
  page.on('worker', (worker) => workers.push(worker.url()))

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

  // Nothing should have been downloaded yet — the engine is built on first use (NFR-1.8).
  expect(workers, 'the layout worker was created before it was needed').toHaveLength(0)

  await page.getByRole('button', { name: 'Auto-layout' }).click()

  // The button returns to its resting label once the worker replies.
  await expect(page.getByRole('button', { name: 'Auto-layout' })).toBeEnabled({ timeout: 20_000 })
  // `role="alert"` is where a layout failure surfaces, so this is the assertion that
  // would have caught `_Worker is not a constructor` — the whole reason this spec exists.
  await expect(page.getByRole('alert')).toHaveCount(0)

  await expect
    .poll(async () => Math.round((await customer.boundingBox())!.x), { timeout: 10_000 })
    .not.toBe(Math.round(displaced!.x))

  expect(workers, 'layout did not run in a worker').toHaveLength(1)
  expect(workers[0]).toContain('elk-worker')

  // One undo step for the whole rearrangement (FR-3.4), and it says what it undoes.
  await expect(page.getByRole('button', { name: /Undo/ })).toHaveAttribute(
    'title',
    'Undo Auto-layout',
  )
  await page.getByRole('button', { name: /Undo/ }).click()
  await expect
    .poll(async () => Math.round((await customer.boundingBox())!.x), { timeout: 5_000 })
    .toBe(Math.round(displaced!.x))
})

test('importing a SQL schema arranges it instead of leaving it on the grid', async ({ page }) => {
  /*
   * "SQL DDL to auto-layout in one click" is the product's strongest path, and both halves
   * of it were broken. The second half was not the elkjs wiring: `autoLayout.run()` read
   * the `diagram` PROP, which on the render that triggered the import is still the
   * document being replaced. On a fresh session that is the empty one, so the engine
   * short-circuited it and returned nothing — no worker, no error, no layout.
   *
   * Hence the assertion is against the placeholder grid specifically. `fallbackPosition`
   * lays unpositioned entities out at 280px intervals on one row, and a left-to-right
   * layered layout of a three-table chain looks similar enough at a glance that only the
   * exact coordinates tell them apart.
   */
  const workers: string[] = []
  page.on('worker', (worker) => workers.push(worker.url()))

  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Open the sample schema' })).toBeVisible()

  await importFile(page, 'chain.sql', CHAIN_SQL)

  await expect(page.locator('.react-flow__node')).toHaveCount(3)
  await expect(page.getByRole('alert')).toHaveCount(0)

  // Positions are read off the node transform, which is in diagram units — the bounding
  // box is in screen pixels and moves with fitView, so it cannot be compared to a grid.
  await expect
    .poll(async () => nodeTransforms(page), { timeout: 20_000 })
    .not.toEqual(['translate(0px, 0px)', 'translate(280px, 0px)', 'translate(560px, 0px)'])

  expect(workers, 'the import did not run layout in a worker').toHaveLength(1)

  // A layered layout of a chain puts each table right of the last, and ELK's own spacing
  // is not a multiple of the 280px grid.
  const xs = (await nodeTransforms(page)).map((transform) =>
    Number(/translate\(([-\d.]+)px/.exec(transform)?.[1] ?? NaN),
  )
  expect(xs[0]).toBeLessThan(xs[1]!)
  expect(xs[1]).toBeLessThan(xs[2]!)
})

test('the save indicator does not claim "Saved" before anything is saved', async ({ page }) => {
  // The bug this pins was measured in Chrome: the indicator read "Saved" — never
  // "Saving…", no `data-dirty` — for the whole ~640 ms between the sample appearing and
  // the row reaching IndexedDB, because opening a document never marked the store dirty.
  // A reload inside that window lost the document while the UI said it was safe, and the
  // browser is the only copy of the user's work (SRS §1.2).
  //
  // Asserted on the indicator rather than on `waitForPersisted`, deliberately: the helper
  // exists BECAUSE the indicator could not be trusted, so trusting it here is the point.
  await page.goto('/')
  await page.getByRole('button', { name: 'Open the sample schema' }).click()
  await expect(entity(page, 'CUSTOMER')).toBeVisible()

  // The document is on screen and in memory only. 800 ms of debounce to observe this in.
  const status = page.locator('.erd-status').filter({ hasText: /Saving|Saved/ })
  await expect(status).toHaveText('Saving…')
  await expect(status).toHaveAttribute('data-dirty', 'true')

  // And it resolves on its own, rather than sticking on "Saving…" forever.
  await expect(status).toHaveText('Saved', { timeout: 10_000 })
  await waitForPersisted(page)
})

test('a reopened diagram is not announced as unsaved', async ({ page }) => {
  // The other half, and the reason `load` takes `persisted` rather than always marking
  // dirty: boot recovery reads the document out of IndexedDB, and the autosave
  // subscription attaches AFTER that load — so a document marked dirty here would sit on
  // "Saving…" forever with no write scheduled to clear it.
  await openSample(page)
  await waitForPersisted(page)

  await page.reload()
  await expect(entity(page, 'CUSTOMER')).toBeVisible()

  const status = page.locator('.erd-status').filter({ hasText: /Saving|Saved/ })
  await expect(status).toHaveText('Saved')
})

test('IndexedDB is available in the real browser', async ({ page }) => {
  // Guards the assumption behind FR-7.2/7.3. If this fails, the app is silently running
  // on the in-memory fallback and nothing survives a reload.
  await page.goto('/')

  const available = await page.evaluate(() => typeof indexedDB !== 'undefined')
  expect(available).toBe(true)
})

/**
 * The same chain, plus one table the diagram has never seen AND a new column on one it
 * already has.
 *
 * The extra column is not decoration. Without it the spec cannot tell a real merge apart
 * from "keep every existing box and append the new one", which is what a broken id mapping
 * degenerates into — verified by mutation: with `mapEntityId` returning the incoming id the
 * first version of this test still passed.
 */
const CHAIN_SQL_PLUS = `
CREATE TABLE customers (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE
);
CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  status VARCHAR(32) NOT NULL
);
CREATE TABLE order_lines (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  quantity INTEGER NOT NULL
);
CREATE TABLE payments (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  amount INTEGER NOT NULL
);
`

/** Every box's transform, keyed by the name on it — DOM order is not stable across a merge. */
async function placements(page: Page): Promise<Record<string, string>> {
  return page.locator('.react-flow__node').evaluateAll((nodes) =>
    Object.fromEntries(
      nodes.map((node) => [
        node.querySelector('.erd-node__name')?.textContent?.trim() ?? '?',
        (node as HTMLElement).style.transform,
      ]),
    ),
  )
}

test('re-importing a schema keeps the layout and only places what is new', async ({ page }) => {
  /*
   * The feature that changes what the tool is. Import used to replace the document
   * wholesale, so every position a user had arranged was thrown away the moment they opened
   * an updated dump — which on a 120-table diagram is the only work worth anything.
   *
   * The assertion that matters is the EXACT transform of the tables that were already
   * there. "Four boxes are on screen" would pass against a full re-import followed by a
   * fresh auto-layout, which is precisely the behaviour being replaced.
   */
  await page.goto('/')
  await importFile(page, 'chain.sql', CHAIN_SQL)
  await expect(page.locator('.react-flow__node')).toHaveCount(3)

  // Wait for the imported layout to land, or "unchanged" would mean "still on the grid".
  await expect
    .poll(async () => nodeTransforms(page), { timeout: 20_000 })
    .not.toEqual(['translate(0px, 0px)', 'translate(280px, 0px)', 'translate(560px, 0px)'])

  const before = await placements(page)
  expect(Object.keys(before)).toHaveLength(3)

  await mergeFile(page, 'chain-plus.sql', CHAIN_SQL_PLUS)

  // Culling removes off-screen nodes from the DOM entirely, and the new table is placed
  // clear of the existing ones — so frame the diagram before counting anything.
  await page.locator('.react-flow__controls-fitview').click()
  await expect(page.locator('.react-flow__node')).toHaveCount(4)
  await expect(page.getByRole('alert')).toHaveCount(0)

  // The table that CHANGED in the file shows its new column, at the position it already
  // had. This is the half that separates a merge from an append.
  await expect(entity(page, 'orders').getByText('status')).toBeVisible()

  const after = await placements(page)

  // Not one box moved.
  for (const [name, transform] of Object.entries(before)) {
    expect(after[name], `${name} moved`).toBe(transform)
  }

  // And the new one was placed, clear to the right rather than on top of anything.
  const newcomer = Object.keys(after).find((name) => before[name] === undefined)
  expect(newcomer, 'the new table is not on the canvas').toBeDefined()
  const xOf = (transform: string): number =>
    Number(/translate\(([-\d.]+)px/.exec(transform)?.[1] ?? NaN)
  const rightmostBefore = Math.max(...Object.values(before).map(xOf))
  expect(xOf(after[newcomer!]!)).toBeGreaterThan(rightmostBefore)
})
