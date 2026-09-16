import { expect, type Locator, type Page } from '@playwright/test'

import type { Diagram } from '../../src/domain'

/**
 * The entity box named exactly `name`.
 *
 * Not `page.locator('.react-flow__node', { hasText: 'CUSTOMER' })`, which is what these
 * specs used to say. `hasText` is a substring match over the whole box, so on the sample
 * schema it resolved "CUSTOMER" to the CUSTOMER box AND the ORDER box — ORDER has a
 * `customer_id` field. "ORDER" matched both ORDER and ORDER_LINE for the same reason. Both
 * specs failed the first time the suite was ever executed, which is the whole point of
 * executing it.
 *
 * Anchoring on `.erd-node__name` with a whole-string regex names the box and nothing
 * inside it.
 */
export function entity(page: Page, name: string): Locator {
  return page
    .locator('.react-flow__node')
    .filter({ has: page.locator('.erd-node__name', { hasText: new RegExp(`^${name}$`) }) })
}

/** Load the four-entity sample and wait for it to be on the canvas. */
export async function openSample(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: 'Open the sample schema' }).click()
  await expect(entity(page, 'CUSTOMER')).toBeVisible()
  // React Flow measures on the frame after mount; give it that frame before any gesture.
  await expect(page.locator('.react-flow__node')).toHaveCount(4)
}

/** Ids of the entities currently selected, in DOM order. */
export async function selectedIds(page: Page): Promise<string[]> {
  return page
    .locator('.react-flow__node.selected')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-id') ?? ''))
}

/** A point on a box's header — the part a user aims at to select or drag it. */
export async function headerPoint(box: Locator): Promise<{ x: number; y: number }> {
  const rect = await box.boundingBox()
  expect(rect, 'the box has no layout, so there is nothing to click').not.toBeNull()
  return { x: rect!.x + rect!.width / 2, y: rect!.y + 12 }
}

/**
 * Click a box the way a person does: pointer somewhere else, then straight onto the box
 * and press, with no pause in between.
 *
 * RAW MOUSE EVENTS ON PURPOSE. `locator.click()` runs Playwright's actionability checks
 * first, and one of them is "wait until the element is visible" — which is exactly the
 * state under test. Clicking a table used to fail because every box was
 * `visibility: hidden` for ~19 ms after any node rebuild, and `locator.click()` politely
 * waits that window out and passes. A person does not.
 *
 * Asserts the box is genuinely the top element at that point first, so an overlapping
 * panel fails loudly instead of quietly clicking through to something else.
 */
export async function coldClick(
  page: Page,
  box: Locator,
  options: { shift?: boolean } = {},
): Promise<void> {
  const id = await box.getAttribute('data-id')
  await page.mouse.move(8, 8)
  const point = await headerPoint(box)

  const topmost = await page.evaluate((at) => {
    const element = document.elementFromPoint(at.x, at.y)
    return element?.closest('.react-flow__node')?.getAttribute('data-id') ?? 'nothing clickable'
  }, point)
  expect(topmost, 'something is covering the box that was about to be clicked').toBe(id)

  if (options.shift === true) await page.keyboard.down('Shift')
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await page.mouse.up()
  if (options.shift === true) await page.keyboard.up('Shift')
}

/**
 * Wait until the document has actually reached IndexedDB.
 *
 * NOT `expect(page.getByText('Saved')).toBeVisible()`, which is what the reload spec tried
 * first. The indicator reads "Saved" from the moment a diagram is opened, while autosave is
 * still inside its 800 ms debounce window and the `diagrams` store is empty — measured at
 * ~640 ms of "Saved" with nothing saved. A reload inside that window loses the document,
 * and the spec that relied on the indicator failed exactly there. See NEXT.md.
 */
export async function waitForPersisted(page: Page): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate(
          async () =>
            new Promise<number>((resolve) => {
              const request = indexedDB.open('er-diagram-editor')
              request.onsuccess = (): void => {
                const db = request.result
                if (![...db.objectStoreNames].includes('diagrams')) {
                  resolve(0)
                  return
                }
                const count = db.transaction('diagrams', 'readonly').objectStore('diagrams').count()
                count.onsuccess = (): void => {
                  resolve(count.result)
                }
                count.onerror = (): void => {
                  resolve(0)
                }
              }
              request.onerror = (): void => {
                resolve(0)
              }
            }),
        ),
      { timeout: 10_000, message: 'the diagram never reached IndexedDB' },
    )
    .toBeGreaterThan(0)
}

/**
 * The documents the autosaver has actually written, as stored.
 *
 * `waitForPersisted` above answers "has anything been saved yet", which is the right
 * question for the reload spec — it opens the sample and waits for the row count to go
 * from zero to one. It is the WRONG question for any change made afterwards: the count is
 * already one, so it returns immediately and a reload can still race the 800 ms debounce.
 * The pin spec failed exactly there, on a pin that was in fact saved a second later.
 *
 * So this returns the content, and the caller polls for the change it is waiting on.
 */
export async function storedDiagrams(page: Page): Promise<Diagram[]> {
  return page.evaluate(
    async () =>
      new Promise<Diagram[]>((resolve) => {
        const request = indexedDB.open('er-diagram-editor')
        request.onsuccess = (): void => {
          const db = request.result
          if (![...db.objectStoreNames].includes('diagrams')) {
            resolve([])
            return
          }
          const all = db.transaction('diagrams', 'readonly').objectStore('diagrams').getAll()
          all.onsuccess = (): void => {
            resolve((all.result as { document: Diagram }[]).map((record) => record.document))
          }
          all.onerror = (): void => {
            resolve([])
          }
        }
        request.onerror = (): void => {
          resolve([])
        }
      }),
  )
}

/** Every node's `transform`, in DOM order. Diagram units, not screen pixels. */
export async function nodeTransforms(page: Page): Promise<string[]> {
  return page
    .locator('.react-flow__node')
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).style.transform))
}

/** A box in DIAGRAM units, which is the unit alignment and snapping are specified in. */
export interface NodeBox {
  name: string
  x: number
  y: number
  width: number
  height: number
}

/**
 * Every node's rectangle, in diagram units.
 *
 * Position comes from `style.transform` and size from `offsetWidth`/`offsetHeight`, both
 * of which are PRE-transform — a node sits inside React Flow's scaled viewport, so
 * `getBoundingClientRect` would report screen pixels and mix the two units together. See
 * the note in NEXT.md; this is the same mistake the measurement spec had to avoid.
 */
export async function nodeBoxes(page: Page): Promise<NodeBox[]> {
  return page.locator('.react-flow__node').evaluateAll((nodes) =>
    nodes.map((node) => {
      const element = node as HTMLElement
      const matrix = new DOMMatrix(element.style.transform)
      return {
        name: element.querySelector('.erd-node__name')?.textContent ?? '',
        x: matrix.e,
        y: matrix.f,
        width: element.offsetWidth,
        height: element.offsetHeight,
      }
    }),
  )
}

/** The zoom React Flow settled on, needed to turn a diagram distance into a pointer one. */
export async function viewportZoom(page: Page): Promise<number> {
  return page.evaluate(() => {
    const viewport = document.querySelector('.react-flow__viewport')
    if (viewport === null) return 1
    return new DOMMatrix(getComputedStyle(viewport).transform).a
  })
}

/**
 * Open a file through the app's own "Open file" dialog.
 *
 * Chrome has `showOpenFilePicker`, and Playwright cannot drive a native OS file dialog, so
 * it is deleted first to force `openTextFile`'s `<input type="file">` fallback. That has to
 * happen before the page loads any script that captures the reference, hence
 * `addInitScript` and the `goto` here rather than in the caller.
 *
 * Consequence worth knowing: the File System Access branch of `openTextFile` is exercised
 * by nothing at all, in any suite.
 */
export async function importFile(page: Page, filename: string, content: string): Promise<void> {
  await page.addInitScript(() => {
    // @ts-expect-error -- removing a capability the real browser has, on purpose
    delete window.showOpenFilePicker
  })
  await page.reload()

  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open file' }).click()
  await page.getByRole('button', { name: 'Choose a file…' }).click()
  await (
    await chooser
  ).setFiles({ name: filename, mimeType: 'text/plain', buffer: Buffer.from(content, 'utf8') })
}

/**
 * Open a second file over the diagram already on screen and take the MERGE branch.
 *
 * Deliberately does not reload, unlike `importFile`. Two reasons, and the second one is the
 * kind of thing that makes a test assert nothing while passing:
 *
 * 1. `addInitScript` is registered on the context, so the `showOpenFilePicker` deletion
 *    `importFile` installed is still in force after it.
 * 2. A reload here would race the app's IndexedDB restore. The dialog decides whether to
 *    offer a merge at all by looking at the CURRENT diagram, so an empty canvas at that
 *    instant silently takes the "open as a new document" branch — the merge button would
 *    never appear, and a test that only counted boxes afterwards would still be green.
 */
export async function mergeFile(page: Page, filename: string, content: string): Promise<void> {
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open file' }).click()
  await page.getByRole('button', { name: 'Choose a file…' }).click()
  await (
    await chooser
  ).setFiles({ name: filename, mimeType: 'text/plain', buffer: Buffer.from(content, 'utf8') })

  // Proves the preview branch was taken; without it the next click could be a no-op.
  await page.getByText('What this will do').waitFor()
  await page.getByRole('button', { name: 'Merge into this diagram' }).click()
}
