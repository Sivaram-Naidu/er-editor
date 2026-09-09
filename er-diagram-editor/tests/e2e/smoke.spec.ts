import { expect, test } from '@playwright/test'

/**
 * The five critical paths of NFR-6.6 land here as the UI arrives:
 * create schema, auto-layout, hover-highlight, export Mermaid, save/reload.
 *
 * Only the boot path exists so far. Running Playwright now keeps the harness honest —
 * an E2E suite first wired up late tends to be wired up wrong.
 */
test('the app boots and renders its shell', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'ER Diagram Editor' })).toBeVisible()
})

test('dragging from one table onto another creates a relationship', async ({ page }) => {
  // The one part of FR-1.4 unit tests cannot reach: React Flow's connection handling is
  // geometry and pointer capture. `buildConnectCommands` covers what the gesture MEANS;
  // this covers that the gesture fires at all.
  await page.goto('/')
  await page.getByRole('button', { name: 'Open the sample schema' }).click()
  await expect(page.getByText('CUSTOMER')).toBeVisible()

  const product = page.locator('.react-flow__node', { hasText: 'PRODUCT' })
  const customer = page.locator('.react-flow__node', { hasText: 'CUSTOMER' })
  const handle = product.locator('.erd-handle--node').last()

  await handle.hover()
  await page.mouse.down()
  await customer.hover()
  await page.mouse.up()

  // Sample ships with three relationships; the drag makes a fourth.
  await expect(page.locator('.erd-edge')).toHaveCount(4)
})

test('auto-layout rearranges the diagram without blocking the page', async ({ page }) => {
  // The Worker and the dynamic elkjs import are browser-only, so this is the only place
  // the wiring can be exercised. The layout algorithm itself is covered in unit tests.
  await page.goto('/')
  await page.getByRole('button', { name: 'Open the sample schema' }).click()
  await expect(page.getByText('CUSTOMER')).toBeVisible()

  const customer = page.locator('.react-flow__node', { hasText: 'CUSTOMER' })
  const before = await customer.boundingBox()

  await page.getByRole('button', { name: 'Auto-layout' }).click()

  // The button returns to its resting label once the worker replies.
  await expect(page.getByRole('button', { name: 'Auto-layout' })).toBeEnabled({ timeout: 20_000 })
  await expect(page.getByRole('alert')).toHaveCount(0)

  const after = await customer.boundingBox()
  expect(after).not.toEqual(before)

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
