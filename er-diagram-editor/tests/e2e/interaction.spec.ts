import { expect, test } from '@playwright/test'

import {
  coldClick,
  entity,
  headerPoint,
  openSample,
  selectedIds,
  waitForPersisted,
} from './helpers'

/**
 * The gestures a person makes with a pointer, in a real browser.
 *
 * This file exists because clicking a table to select it — the most basic interaction in
 * the tool — was broken in shipped code underneath 680 passing unit tests and 92%
 * coverage. It could not have been caught anywhere else: the defect was a ~19 ms window
 * in which React Flow rendered every box `visibility: hidden`, so the click was never
 * hit-tested against the node and landed on the pane behind it.
 *
 * Two rules follow from that, and both matter more than the assertions:
 *
 *   1. **Do not pause between moving the pointer and pressing it.** Every timing bug here
 *      lives in the frame or two after a re-render, and a `waitForTimeout` before the
 *      press steps right over it. `coldClick` is written to avoid that; see the note on it.
 *   2. **Do not use `locator.click()` for these.** It waits for the element to be visible
 *      before pressing, which is the condition under test.
 */

test('clicking a table selects it', async ({ page }) => {
  await openSample(page)
  const customer = entity(page, 'CUSTOMER')

  await coldClick(page, customer)

  await expect(customer).toHaveClass(/selected/)
  expect(await selectedIds(page)).toHaveLength(1)
  // Selecting is what opens the inspector, so this is the user-visible consequence.
  await expect(page.getByRole('textbox', { name: /^Name$/ })).toHaveValue('CUSTOMER')
})

test('shift-clicking a second table adds it to the selection', async ({ page }) => {
  await openSample(page)

  // CUSTOMER and ORDER, not the two on the right. Selecting anything opens the inspector,
  // and the inspector is drawn OVER the canvas rather than beside it — so ORDER_LINE and
  // PRODUCT become unclickable the moment the first selection lands. `coldClick` asserts
  // its target is really on top, which is how that surfaced. Recorded in NEXT.md.
  await coldClick(page, entity(page, 'CUSTOMER'))
  await coldClick(page, entity(page, 'ORDER'), { shift: true })

  expect(await selectedIds(page)).toHaveLength(2)
})

test('clicking one of several selected tables narrows the selection to it', async ({ page }) => {
  await openSample(page)
  const customer = entity(page, 'CUSTOMER')

  await coldClick(page, customer)
  await coldClick(page, entity(page, 'ORDER'), { shift: true })
  expect(await selectedIds(page)).toHaveLength(2)

  // The reported symptom was that this cleared the selection and made no new one.
  await coldClick(page, customer)

  expect(await selectedIds(page)).toEqual([await customer.getAttribute('data-id')])
})

test('clicking empty canvas clears the selection', async ({ page }) => {
  await openSample(page)

  await coldClick(page, entity(page, 'CUSTOMER'))
  expect(await selectedIds(page)).toHaveLength(1)

  await page.mouse.click(8, 400)

  expect(await selectedIds(page)).toHaveLength(0)
})

test('a table stays clickable straight after the detail level changes', async ({ page }) => {
  // The other trigger, and the reason the fix is about dimensions rather than about hover.
  // Changing LOD rebuilds every node object exactly as hovering does, so a click with no
  // dwell after it went the same way.
  await openSample(page)

  await page.getByLabel('Detail').selectOption({ label: 'Keys' })
  await expect(page.locator('.erd-node[data-lod="1"]').first()).toBeVisible()

  await coldClick(page, entity(page, 'CUSTOMER'))

  expect(await selectedIds(page)).toHaveLength(1)
})

test('no table is ever rendered invisible while the pointer moves over the diagram', async ({
  page,
}) => {
  // The mechanism itself, asserted directly rather than through its symptom. React Flow
  // renders a node `visibility: hidden` whenever it has no measured size, so a sighting
  // here means the app has handed it nodes without one — and every pointer gesture landing
  // in that window is lost.
  await openSample(page)
  await page.mouse.move(8, 8)

  await page.evaluate(() => {
    const seen = { count: 0 }
    Object.assign(window, { __invisible: seen })
    const observer = new MutationObserver(() => {
      seen.count += [...document.querySelectorAll('.react-flow__node')].filter(
        (node) => getComputedStyle(node).visibility === 'hidden',
      ).length
    })
    const surface = document.querySelector('.react-flow__nodes')
    if (surface !== null) {
      observer.observe(surface, { attributes: true, subtree: true, attributeFilter: ['style'] })
    }
  })

  for (const name of ['CUSTOMER', 'ORDER', 'ORDER_LINE', 'PRODUCT']) {
    const point = await headerPoint(entity(page, name))
    await page.mouse.move(point.x, point.y)
  }

  const sightings = await page.evaluate(
    () => (window as unknown as { __invisible: { count: number } }).__invisible.count,
  )
  expect(sightings).toBe(0)
})

test('hovering a table traces its neighbourhood and pushes the rest back', async ({ page }) => {
  // FR-4.1, FR-4.2. Also the regression guard on the fix: trace state still reaches the
  // boxes, it just no longer costs them their measured size.
  await openSample(page)

  const point = await headerPoint(entity(page, 'CUSTOMER'))
  await page.mouse.move(point.x, point.y)

  // CUSTOMER and its one-hop neighbour ORDER.
  await expect(page.locator('.erd-node[data-traced]')).toHaveCount(2)

  /*
   * The other two recede, and the assertion is on the RENDERED opacity rather than on a
   * `data-dimmed` attribute, because there is no longer one to count. Dimming used to be a
   * per-node boolean, which made starting a hover an O(N) state change — every box that is
   * NOT traced had to be rebuilt to say so. It is now one `data-tracing` flag on the
   * canvas and a `:not([data-traced])` rule in CSS.
   *
   * Asserting the computed style is the point: an attribute could be renamed or a selector
   * could stop matching and the diagram would quietly stop dimming, which is a visual
   * regression no attribute count would catch.
   */
  await expect(page.locator('.erd-canvas[data-tracing]')).toHaveCount(1)

  /*
   * POLLED, because opacity is TRANSITIONED (`--erd-trace-duration`, canvas.css). A bare
   * read lands mid-fade and reports something close to 1, which is what the first version
   * of this did — it failed three runs out of three while the screenshot plainly showed
   * two dimmed boxes. `expect.poll` retries until the transition has landed; a
   * `waitForTimeout` would pass here and rot the moment the duration changed.
   */
  await expect
    .poll(
      async () =>
        page.locator('.erd-scrim').evaluate((scrim) => Number(getComputedStyle(scrim).opacity)),
      { message: 'the scrim did not fade in, so nothing is receding' },
    )
    .toBeGreaterThan(0.1)

  /*
   * And it is dimming the RIGHT things, which is the half a single opacity reading cannot
   * see. The scrim only works because it sits between the untraced boxes and the traced
   * ones in the viewport's stacking context — get that wrong and it either dims nothing or
   * dims the traced path along with everything else, both of which leave its own opacity
   * looking perfectly correct.
   */
  const bands = await page.evaluate(() => {
    const z = (selector: string): number =>
      Number(getComputedStyle(document.querySelector(selector)!).zIndex)
    return {
      scrim: z('.erd-scrim'),
      traced: z('.react-flow__node:has(.erd-node[data-traced])'),
      untraced: z('.react-flow__node:not(:has(.erd-node[data-traced]))'),
    }
  })
  expect(bands.untraced, 'untraced boxes must sit BEHIND the scrim').toBeLessThan(bands.scrim)
  expect(bands.traced, 'traced boxes must sit IN FRONT of the scrim').toBeGreaterThan(bands.scrim)

  // At rest it is invisible, so it can stay mounted and cost a composite rather than a
  // React commit per hover.
  await page.mouse.move(4, 400)
  await expect
    .poll(async () =>
      page.locator('.erd-scrim').evaluate((scrim) => Number(getComputedStyle(scrim).opacity)),
    )
    .toBe(0)

  /*
   * And the connectors off the path drop their labels, while the traced one keeps its.
   *
   * Worth asserting separately because the label is NOT inside the edge it belongs to:
   * `EdgeLabelRenderer` portals it into React Flow's own label layer, so every selector
   * that descends from `.erd-edge` misses it. The first version of the CSS rule did
   * exactly that and the dimmed labels stayed on screen — caught by looking at a
   * screenshot, which no count of nodes would have shown.
   */
  await page.mouse.move(point.x, point.y)
  await expect(page.locator('.erd-node[data-traced]')).toHaveCount(2)
  await expect(page.locator('.erd-edge__label:visible')).toHaveCount(1)
  await expect(page.locator('.erd-edge__label[data-traced]')).toBeVisible()
})

test('dragging a table moves it, follows the cursor, and is one undo step', async ({ page }) => {
  // The drag teleport: in controlled mode React Flow only REPORTS a drag, so if nothing
  // applies the in-flight frames the box sits frozen under the cursor and jumps to the
  // destination on release. Asserting the final position alone would pass on that bug,
  // which is why the transforms during the gesture are collected too.
  await openSample(page)
  const customer = entity(page, 'CUSTOMER')
  const before = await customer.boundingBox()

  const start = await headerPoint(customer)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()

  const transforms = new Set<string>()
  for (let frame = 1; frame <= 12; frame++) {
    await page.mouse.move(start.x + frame * 8, start.y + frame * 4)
    transforms.add(await customer.evaluate((node) => node.style.transform))
  }
  await page.mouse.up()

  expect(transforms.size, 'the box did not move during the gesture').toBeGreaterThan(8)

  const after = await customer.boundingBox()
  expect(Math.round(after!.x - before!.x)).toBeGreaterThan(80)

  // FR-7.4 / NFR-1.3: one gesture is one undo step, not one per pointer frame.
  await expect(page.getByRole('button', { name: /Undo/ })).toHaveAttribute(
    'title',
    'Undo Move entity',
  )
  await page.getByRole('button', { name: /Undo/ }).click()

  const undone = await customer.boundingBox()
  expect(Math.round(undone!.x)).toBe(Math.round(before!.x))
  expect(Math.round(undone!.y)).toBe(Math.round(before!.y))
})

test('the minimap draws a box for every table (FR-2.5)', async ({ page }) => {
  // Was an empty white box. The minimap reads the USER node's dimensions, which nothing
  // populated, so it drew nothing at all — permanently, not for a frame.
  await openSample(page)

  const rects = page.locator('.react-flow__minimap-node')
  await expect(rects).toHaveCount(4)

  // Non-zero, or they are drawn but invisible, which is the same empty box to a user.
  const sizes = await rects.evaluateAll((nodes) =>
    nodes.map((node) => ({
      width: Number(node.getAttribute('width')),
      height: Number(node.getAttribute('height')),
    })),
  )
  for (const size of sizes) {
    expect(size.width).toBeGreaterThan(0)
    expect(size.height).toBeGreaterThan(0)
  }
})

test('the diagram survives a reload (FR-7.2, FR-7.3)', async ({ page }) => {
  await openSample(page)

  await waitForPersisted(page)
  await page.reload()

  await expect(entity(page, 'CUSTOMER')).toBeVisible()
  await expect(page.locator('.react-flow__node')).toHaveCount(4)
})
