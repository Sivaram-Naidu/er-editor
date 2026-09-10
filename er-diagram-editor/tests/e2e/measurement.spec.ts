import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { importSql } from '../../src/io'
import { measureAll } from '../../src/layout'

import { importFile, nodeTransforms } from './helpers'

/**
 * `measure.ts` against the DOM it is meant to describe.
 *
 * ELK cannot measure text, so `measure.ts` estimates every box's size from the model and
 * ELK positions boxes on the strength of those numbers. That makes the estimate a
 * load-bearing contract with `canvas.css`, and the only way to check a contract between a
 * TypeScript module and a stylesheet is to render it in a browser and look.
 *
 * Nothing did. `tests/unit/layout` has a spec called "produces no overlapping boxes" whose
 * comment says "If the measurements in measure.ts drift away from what canvas.css draws,
 * this is what catches it" — but it feeds `measureAll` output to ELK and then checks for
 * overlap using *that same output*. It asserts ELK honoured the sizes it was given, which
 * it always does. It cannot see that the sizes are wrong, and no arrangement of unit tests
 * can: jsdom performs no layout, so there is no rendered height to disagree with.
 */

const WIDE_NAMES = readFileSync(join('tests', 'fixtures', 'wide-names.sql'), 'utf8')

test('the size measure.ts reports is the size the browser draws', async ({ page }) => {
  /*
   * EXPECTED TO FAIL — the defect is real and is not fixed. See NEXT.md.
   *
   * Long column names wrap, because `.erd-attr__name` sets `overflow-wrap: anywhere` and
   * `.erd-node` caps at `max-width: 300px`. A wrapped row is two or three lines tall;
   * `measure.ts` bills every row at a flat `rowHeight: 26`. So ELK is told these boxes are
   * far shorter than they are and stacks them on top of each other — 26 overlapping pairs
   * on a 41-table schema of this shape, the worst box under-measured by 586px.
   *
   * Left failing on purpose rather than skipped: Playwright turns the suite red the moment
   * it starts passing, which is the reminder to drop this marker.
   */
  test.fail()

  // The same two pure functions the layout path uses, on the same input.
  const { diagram } = importSql(WIDE_NAMES, { dialect: 'postgres', diagramName: 'wide-names' })
  const predicted = measureAll(diagram, 2)
  const byName = new Map(
    diagram.entities.map((entity) => [entity.name, predicted[entity.id]] as const),
  )

  // `importFile` reloads to install its init script, so the page must be on the app first.
  await page.goto('/')
  await importFile(page, 'wide-names.sql', WIDE_NAMES)
  await expect(page.locator('.react-flow__node')).toHaveCount(diagram.entities.length)

  // Pin the detail level, or the box heights depend on the zoom the layout happened at.
  await page.getByLabel('Detail').selectOption({ label: 'All fields' })
  await expect.poll(async () => nodeTransforms(page)).not.toEqual([])
  await page.waitForTimeout(500)

  /*
   * `offsetWidth`/`offsetHeight` and not `getBoundingClientRect`: the nodes live inside
   * React Flow's scaled viewport, so the client rect is in screen pixels while offset* is
   * the pre-transform layout size — which is the same unit ELK works in.
   */
  const drawn = await page.locator('.react-flow__node').evaluateAll((nodes) =>
    nodes.map((node) => {
      const element = node as HTMLElement
      return {
        name: element.querySelector('.erd-node__name')?.textContent ?? '?',
        width: element.offsetWidth,
        height: element.offsetHeight,
      }
    }),
  )
  expect(drawn.length).toBeGreaterThan(0)

  for (const box of drawn) {
    const estimate = byName.get(box.name)
    expect(estimate, `no estimate for ${box.name}`).toBeDefined()

    // A pixel or two of rounding is fine. The failure this catches is hundreds.
    expect(
      Math.abs(estimate!.height - box.height),
      `${box.name}: measure.ts says ${String(estimate!.height)}px tall, the browser draws ${String(box.height)}px`,
    ).toBeLessThanOrEqual(2)
    expect(
      Math.abs(estimate!.width - box.width),
      `${box.name}: measure.ts says ${String(estimate!.width)}px wide, the browser draws ${String(box.width)}px`,
    ).toBeLessThanOrEqual(2)
  }
})
