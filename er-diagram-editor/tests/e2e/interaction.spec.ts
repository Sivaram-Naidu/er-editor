import { expect, test, type Page } from '@playwright/test'

import {
  coldClick,
  entity,
  headerPoint,
  nodeBoxes,
  openSample,
  selectedIds,
  viewportZoom,
  waitForPersisted,
  type NodeBox,
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
        page
          .locator('.erd-node:not([data-traced])')
          .evaluateAll(
            (nodes) => nodes.filter((node) => Number(getComputedStyle(node).opacity) < 0.9).length,
          ),
      { message: 'the untraced boxes did not actually recede' },
    )
    .toBe(2)

  /*
   * And the connectors off the path drop their labels, while the traced one keeps its.
   *
   * Worth asserting separately because the label is NOT inside the edge it belongs to:
   * `EdgeLabelRenderer` portals it into React Flow's own label layer, so every selector
   * that descends from `.erd-edge` misses it. The first version of the CSS rule did
   * exactly that and the dimmed labels stayed on screen — caught by looking at a
   * screenshot, which no count of nodes would have shown.
   */
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

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * THE Ctrl+K PALETTE (FR-2.6, FR-9.2)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `tests/unit/features/command-palette.test.tsx` already asserts which rows appear and
 * which store a pick lands in. What is here is the half jsdom cannot reach: a real
 * Ctrl+K travelling through the Editor's window-level keymap, a real focus trap deciding
 * where the caret goes, and a camera that actually moves.
 */

/**
 * The palette's own input.
 *
 * NOT a bare `getByRole('combobox')`: a `<select>` has an implicit combobox role, so the
 * toolbar's Detail and Theme controls answer to it too and the query resolves to three
 * elements. It only ever passed by accident — Radix marks the rest of the page
 * `aria-hidden` once the dialog is open, so whether the other two are in the accessibility
 * tree depends on how far the open animation has got.
 */
function palette(page: Page) {
  return page.getByRole('combobox', { name: /search/i })
}

test('Ctrl+K opens the palette with the caret already in the box (FR-9.2)', async ({ page }) => {
  await openSample(page)

  await page.keyboard.press('Control+k')

  const box = palette(page)
  await expect(box).toBeVisible()
  /*
   * THE ASSERTION THAT EARNED ITS KEEP.
   *
   * `ui/Dialog` focuses the PANEL on open, deliberately — a screen reader should hear the
   * title before anything else. For a palette that is wrong: it opens for someone who is
   * already typing, so the first keystroke would land nowhere. `Dialog` grew an
   * `initialFocus` prop for this, and nothing but a real focus trap can tell you whether
   * it worked.
   */
  await expect(box).toBeFocused()
})

test('Ctrl+K opens the palette even while renaming a table inline', async ({ page }) => {
  // The Editor's keymap returns early when focus is in an input, so that `e` and `Delete`
  // do not edit the document while somebody is typing a name. Ctrl+K is deliberately
  // ABOVE that guard — a chord cannot be typed by accident, and the inspector and the
  // name field are two of the places a user most wants to jump away from.
  await openSample(page)
  await entity(page, 'CUSTOMER').locator('.erd-node__name').dblclick()
  await expect(page.locator('.erd-inline-input')).toBeFocused()

  await page.keyboard.press('Control+k')

  await expect(palette(page)).toBeFocused()
})

test('picking a table selects it and moves the camera to it (FR-2.6)', async ({ page }) => {
  await openSample(page)

  // Park the camera somewhere else first, or "it moved" proves nothing.
  await page.mouse.move(600, 400)
  await page.mouse.down()
  await page.mouse.move(180, 160, { steps: 8 })
  await page.mouse.up()
  const before = await page.locator('.react-flow__viewport').getAttribute('style')

  await page.keyboard.press('Control+k')
  await palette(page).fill('product')
  await expect(page.getByRole('option').first()).toContainText('PRODUCT')
  await page.keyboard.press('Enter')

  // The palette closes, the box is selected, and the viewport transform changed.
  await expect(palette(page)).toHaveCount(0)
  expect(await selectedIds(page)).toHaveLength(1)
  await expect(entity(page, 'PRODUCT')).toHaveClass(/selected/)
  await expect
    .poll(async () => page.locator('.react-flow__viewport').getAttribute('style'), {
      message: 'the camera did not move to the picked table',
    })
    .not.toBe(before)
})

test('a field result names its table, and picking it selects both (FR-2.6)', async ({ page }) => {
  await openSample(page)

  await page.keyboard.press('Control+k')
  await palette(page).fill('email')

  const row = page.getByRole('option').first()
  await expect(row).toContainText('email')
  // "Results show which entity an attribute belongs to" — the requirement says so in words.
  await expect(row).toContainText('CUSTOMER')

  await page.keyboard.press('Enter')
  await expect(entity(page, 'CUSTOMER')).toHaveClass(/selected/)
})

test('Escape closes the palette and leaves the document alone', async ({ page }) => {
  await openSample(page)
  const before = await page.locator('.react-flow__node').count()

  await page.keyboard.press('Control+k')
  await expect(palette(page)).toBeVisible()
  await page.keyboard.press('Escape')

  await expect(palette(page)).toHaveCount(0)
  // The keymap is disabled while a dialog is open, so nothing should have reached the
  // canvas behind it — the export dialog once let `e` add an entity from underneath.
  expect(await page.locator('.react-flow__node').count()).toBe(before)
})

test('the palette runs a command, not just a search (FR-9.2)', async ({ page }) => {
  await openSample(page)
  const before = await page.locator('.react-flow__node').count()

  await page.keyboard.press('Control+k')
  await palette(page).fill('add entity')
  await page.keyboard.press('Enter')

  await expect(page.locator('.react-flow__node')).toHaveCount(before + 1)
})

test('clicking a connector pins the trace so you can pan while following it (FR-4.4)', async ({
  page,
}) => {
  /*
   * The highlight used to die the moment the pointer left, which defeats tracing on any
   * schema bigger than one screen — you cannot follow a connector to a far end you have to
   * scroll to reach.
   *
   * The pin IS the relationship selection, so there is no new state and no second way to
   * dismiss it: Escape and a click on empty canvas already clear it.
   */
  await openSample(page)

  const edge = page.locator('.react-flow__edge').first()
  await edge.click()

  // Two endpoints traced, and the connector itself.
  await expect(page.locator('.erd-node[data-traced]')).toHaveCount(2)
  await expect(page.locator('.erd-canvas[data-tracing]')).toHaveCount(1)

  // THE POINT: move the pointer somewhere with nothing under it. A hover trace would be
  // gone by now.
  await page.mouse.move(4, 400)
  await expect(page.locator('.erd-node[data-traced]')).toHaveCount(2)

  /*
   * And it survives the pointer crossing a DIFFERENT table, which a trackpad pan does
   * constantly — the diagram scrolls under a stationary cursor, so box after box fires
   * `mouseenter`. If hover could override the pin this is where it would break, and the
   * count would still be 2 (a different 2), so the assertion is on the identity of the
   * traced boxes rather than on how many there are.
   */
  const tracedNames = async (): Promise<string[]> =>
    page
      .locator('.erd-node[data-traced]')
      .evaluateAll((nodes) =>
        nodes.map((node) => node.querySelector('.erd-node__name')?.textContent ?? ''),
      )

  const pinned = await tracedNames()
  expect(pinned).toHaveLength(2)

  /*
   * NOW PAN, which is the requirement in one gesture: FR-4.4 exists so you can follow a
   * connector to a far end you have to scroll to reach. A drag on the pane, not a
   * `waitForTimeout` and a hope — and several small steps, because a single `mouse.move`
   * between down and up registers as nothing on this canvas.
   */
  await page.mouse.move(600, 700)
  await page.mouse.down()
  for (let step = 1; step <= 8; step++) await page.mouse.move(600 - step * 50, 700)
  await page.mouse.up()

  expect(await tracedNames(), 'panning dropped the pinned trace').toEqual(pinned)

  /*
   * And hovering a DIFFERENT table does not steal it — which a trackpad pan does
   * constantly, scrolling the diagram under a stationary cursor so box after box fires
   * `mouseenter`.
   *
   * The target is chosen by asking the browser which box is on top at that point rather
   * than by name, and the pan above is what makes one available at all: the inspector
   * panel is drawn OVER the canvas and it is open here, because the pin IS a selection, so
   * before the pan BOTH untraced tables were behind it (measured: `ORDER_LINE` and
   * `PRODUCT` both hit `erd-inspector__section`). That is Known broken 5, and without
   * checking for it this test picks a covered box, no hover ever fires, and it passes
   * without testing anything — verified by mutation.
   */
  const target = await page.evaluate((traced) => {
    for (const node of document.querySelectorAll('.react-flow__node')) {
      const name = node.querySelector('.erd-node__name')?.textContent ?? ''
      if (traced.includes(name)) continue

      const rect = node.getBoundingClientRect()
      const x = rect.x + rect.width / 2
      const y = rect.y + Math.min(6, rect.height / 3)
      if (document.elementFromPoint(x, y)?.closest('.react-flow__node') === node) {
        return { name, x, y }
      }
    }
    return null
  }, pinned)

  expect(target, 'no untraced table is reachable even after panning').not.toBeNull()

  await page.mouse.move(target!.x, target!.y)

  // Asserted on WHICH boxes are traced, not how many: hovering a two-neighbour table would
  // also give a count of 2, and a count assertion would sail straight past it.
  await expect.poll(tracedNames).toEqual(pinned)

  /*
   * Escape dismisses the pin, through the selection it is derived from — and hover tracing
   * comes straight back, because the pointer is still resting on that table. Asserting
   * "nothing is traced" here was wrong and the run said so: three boxes were, which is the
   * hovered one plus its two neighbours. That is the correct behaviour, and asserting the
   * HANDOVER is worth more than asserting a zero — it says the pin outranked hover while it
   * existed and stopped outranking it the moment it did not.
   */
  await page.keyboard.press('Escape')

  await expect.poll(tracedNames).not.toEqual(pinned)
  expect(await tracedNames()).toContain(target!.name)

  // And with the pointer off every box, nothing is traced at all.
  await page.mouse.move(4, 700)
  await expect(page.locator('.erd-node[data-traced]')).toHaveCount(0)
  await expect(page.locator('.erd-canvas[data-tracing]')).toHaveCount(0)
})

/** A box's transform, in diagram units — the client rect is screen pixels and moves with zoom. */
async function transformOf(page: Page, name: string): Promise<string> {
  return entity(page, name).evaluate((node) => (node as HTMLElement).style.transform)
}

test('duplicate and paste copy the selection without moving the original (FR-7.4)', async ({
  page,
}) => {
  /*
   * The assertions that matter are the ones a screenshot would not settle: that the copy is
   * a COPY rather than a second reference to the same box, and that pasting twice does not
   * put the second copy exactly on top of the first — which looks identical to nothing
   * having happened.
   */
  await openSample(page)

  const before = await transformOf(page, 'CUSTOMER')
  await entity(page, 'CUSTOMER').click()
  expect(await selectedIds(page)).toHaveLength(1)

  // DUPLICATE.
  await page.keyboard.press('Control+d')
  await expect(entity(page, 'CUSTOMER_copy')).toBeVisible()

  expect(await transformOf(page, 'CUSTOMER'), 'the original moved').toBe(before)
  expect(await transformOf(page, 'CUSTOMER_copy')).not.toBe(before)

  // One undo step, not one per box and not one per attribute.
  await page.keyboard.press('Control+z')
  await expect(entity(page, 'CUSTOMER_copy')).toHaveCount(0)
  expect(await transformOf(page, 'CUSTOMER')).toBe(before)

  // COPY, then PASTE TWICE. The second paste has to land somewhere else.
  await entity(page, 'CUSTOMER').click()
  await page.keyboard.press('Control+c')
  await page.keyboard.press('Control+v')
  await expect(entity(page, 'CUSTOMER_copy')).toBeVisible()
  await page.keyboard.press('Control+v')
  await expect(entity(page, 'CUSTOMER_copy_2')).toBeVisible()

  expect(
    await transformOf(page, 'CUSTOMER_copy_2'),
    'the second paste landed on top of the first',
  ).not.toBe(await transformOf(page, 'CUSTOMER_copy'))

  // Nothing shouted, and the document is still loadable — a dangling reference would have
  // surfaced as a validation alert rather than as a crash.
  await expect(page.getByRole('alert')).toHaveCount(0)
})

// ─────────────────────────────────────────────────────────────────────────────
// SNAP TO GRID AND ALIGNMENT GUIDES (FR-3.5)
// ─────────────────────────────────────────────────────────────────────────────
//
// These belong in a browser rather than in a unit test for two reasons that the geometry
// suite cannot cover. The magnet is applied in two places — the frames Canvas renders and
// the one it commits — and only a real gesture proves both places agree. And the guide is
// a `ViewportPortal` child stacked over React Flow's own node layer, which is a question
// about CSS stacking contexts that jsdom performs none of.

/** The exact edge coordinates a box offers on one axis: near, centre, far. */
function edgesOf(box: NodeBox, axis: 'x' | 'y'): number[] {
  const start = axis === 'x' ? box.x : box.y
  const size = axis === 'x' ? box.width : box.height
  return [start, start + size / 2, start + size]
}

/** Does `name` share an exact edge with any other box on this axis? */
function sharesAnEdge(boxes: NodeBox[], name: string, axis: 'x' | 'y'): boolean {
  const subject = boxes.find((box) => box.name === name)
  if (subject === undefined) return false

  return boxes
    .filter((box) => box.name !== name)
    .some((other) =>
      edgesOf(subject, axis).some((mine) =>
        edgesOf(other, axis).some((theirs) => Math.abs(mine - theirs) < 0.001),
      ),
    )
}

test('a drag lines up with its neighbours, and lands exactly where the guide said', async ({
  page,
}) => {
  /*
   * The regression this is really guarding: alignment is computed twice, once for the
   * frames that are DRAWN and once for the frame that is STORED. Snap only the drawn ones
   * and the box rides the guide for the whole gesture and then flicks off it by up to the
   * tolerance the moment the button comes up — and every unit test of either half still
   * passes, because each half is right on its own.
   */
  await openSample(page)

  // PRODUCT starts at (640, 260), which lines up with nothing horizontally: the other
  // three all sit at y = 0 and none of them is 260 tall.
  expect(sharesAnEdge(await nodeBoxes(page), 'PRODUCT', 'y')).toBe(false)

  const zoom = await viewportZoom(page)
  const product = entity(page, 'PRODUCT')
  const start = await headerPoint(product)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()

  let guidesSeen = 0
  for (let frame = 1; frame <= 20; frame++) {
    await page.mouse.move(start.x, start.y - (256 * zoom * frame) / 20)
    guidesSeen = Math.max(guidesSeen, await page.locator('.erd-guide').count())
  }

  expect(guidesSeen, 'no alignment guide was ever drawn').toBeGreaterThan(0)
  const drawn = await product.evaluate((node) => (node as HTMLElement).style.transform)
  await page.mouse.up()

  const committed = await product.evaluate((node) => (node as HTMLElement).style.transform)
  expect(committed, 'the box jumped when the button came up').toBe(drawn)

  // And the place it landed is an exact alignment rather than wherever the pointer was.
  expect(sharesAnEdge(await nodeBoxes(page), 'PRODUCT', 'y')).toBe(true)

  // The guides are a gesture, not a state: nothing is left on the canvas afterwards.
  await expect(page.locator('.erd-guide')).toHaveCount(0)

  // Still one undo step for the whole drag (FR-7.1).
  await expect(page.getByRole('button', { name: /Undo/ })).toHaveAttribute(
    'title',
    'Undo Move entity',
  )
})

test('the magnet lets go, so a deliberate offset survives', async ({ page }) => {
  // The other half of the feature, and the failure it prevents is worse than no snapping
  // at all: a tool that quietly refuses to put a box where you put it.
  await openSample(page)

  const zoom = await viewportZoom(page)
  const customer = entity(page, 'CUSTOMER')
  const start = await headerPoint(customer)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  for (let frame = 1; frame <= 20; frame++) {
    await page.mouse.move(start.x, start.y + (40 * zoom * frame) / 20)
  }
  await page.mouse.up()

  const boxes = await nodeBoxes(page)
  const moved = boxes.find((box) => box.name === 'CUSTOMER')!
  expect(moved.y, 'the drag was pulled back to the row it started on').toBeGreaterThan(20)
  expect(sharesAnEdge(boxes, 'CUSTOMER', 'y'), 'a far-off edge still captured the drag').toBe(false)
})

test('snap to grid rounds the drop to the grid, and says whether it is on (FR-3.5)', async ({
  page,
}) => {
  await openSample(page)

  const toggle = page.getByRole('button', { name: /Snap to grid/ })
  await expect(toggle, 'snapping starts on, which an ELK layout does not sit on').toHaveAttribute(
    'aria-pressed',
    'false',
  )
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')

  const zoom = await viewportZoom(page)
  const order = entity(page, 'ORDER')
  const start = await headerPoint(order)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  // Deliberately not multiples of 16, and not equal, so a stuck axis fails too.
  for (let frame = 1; frame <= 10; frame++) {
    await page.mouse.move(start.x + (53 * zoom * frame) / 10, start.y + (91 * zoom * frame) / 10)
  }
  await page.mouse.up()

  const moved = (await nodeBoxes(page)).find((box) => box.name === 'ORDER')!
  expect(moved.x % 16, `x landed at ${String(moved.x)}, which is off the grid`).toBe(0)
  expect(moved.y % 16, `y landed at ${String(moved.y)}, which is off the grid`).toBe(0)
  expect(moved.x, 'the box did not move at all').not.toBe(320)
})
