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

/**
 * The contract is an INEQUALITY, and deliberately so.
 *
 * `measure.ts` cannot be exact and should not pretend to be: `.erd-node`'s border is 2px
 * normally and 4px when the entity is selected or carries a validation marker, and
 * `measureEntity` is told neither. Sub-pixel line heights round differently per row too.
 *
 * What matters is the DIRECTION of the error. Over-estimating spaces boxes slightly
 * further apart than needed; under-estimating makes ELK lay them on top of each other.
 * So: never smaller than the real box, and not wastefully larger.
 */
const MAX_OVER_ESTIMATE_PX = 8

test('measure.ts never tells ELK a box is smaller than the browser draws', async ({ page }) => {
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

    // The one that matters: an under-estimate is what overlaps boxes.
    expect(
      estimate!.height,
      `${box.name}: measure.ts says ${String(estimate!.height)}px tall but the browser draws ${String(box.height)}px — ELK will stack this box on its neighbour`,
    ).toBeGreaterThanOrEqual(box.height)
    expect(
      estimate!.width,
      `${box.name}: measure.ts says ${String(estimate!.width)}px wide but the browser draws ${String(box.width)}px`,
    ).toBeGreaterThanOrEqual(box.width)

    // And not so far over that the diagram fills with whitespace.
    expect(
      estimate!.height - box.height,
      `${box.name}: measure.ts over-estimates height by ${String(estimate!.height - box.height)}px`,
    ).toBeLessThanOrEqual(MAX_OVER_ESTIMATE_PX)
    expect(
      estimate!.width - box.width,
      `${box.name}: measure.ts over-estimates width by ${String(estimate!.width - box.width)}px`,
    ).toBeLessThanOrEqual(MAX_OVER_ESTIMATE_PX)
  }
})
