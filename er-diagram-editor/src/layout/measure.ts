// Node dimension estimation per LOD. ELK cannot measure text.
//
// ELK positions boxes; it has no idea how big a box is until told. Measuring the real
// DOM would be exact but costs a synchronous reflow across every node — at 120 entities
// that blows NFR-1.3's 100 ms interaction budget on its own, and the nodes outside the
// viewport are not even mounted (NFR-2.4), so there is nothing to measure.
//
// So sizes are computed from the model instead.
//
// THE CONTRACT IS "NEVER SMALLER THAN THE REAL BOX", NOT "EXACTLY THE REAL BOX"
//
// The numbers below were read off the rendered DOM in Chrome, not derived from canvas.css
// by eye — the previous set claimed to "mirror the padding and type scale" and was wrong
// about the header, the add-field row, the "N more" row, the border, and both width
// clamps. Every one of them is now biased so the estimate comes out slightly LARGE:
//
//   - `.erd-node`'s border is 2px, but 4px when the entity is selected or carries a
//     validation marker (`--erd-stroke-strong`). `measureEntity` is given neither of those
//     facts, so it always assumes the thick border.
//   - Row height is 26px for the first row and 27px for the rest (`.erd-attr + .erd-attr`
//     adds a 1px rule), and the container rounds up by another 1-2px. Every row is billed
//     at the higher figure plus a 2px allowance for the container.
//   - The header is 38px, or 37px at L0 where it has no bottom rule. It is always billed
//     at 38px.
//
// The result over-estimates by at most ~4px per box and never under-estimates. That
// direction is the whole point: too large spaces boxes slightly further apart than needed,
// while too small makes ELK stack them on top of each other — 26 overlapping pairs on a
// 41-table schema, before this.
//
// This is only trustworthy because a row is now guaranteed to be ONE LINE. See the note on
// `.erd-attr__name` in canvas.css: while names could wrap, no fixed per-character width
// could predict the height, because where a name breaks depends on its glyphs (measured:
// 6.2 to 10.2 px per character across real column names) rather than on its length.
// If you ever let a row wrap again, this file cannot be repaired — it has to measure.
//
// `tests/e2e/measurement.spec.ts` asserts the contract against the real DOM. It is the only
// test that can: jsdom performs no layout, so a unit test has no rendered height to
// disagree with.

import type { Diagram, Entity, EntityId } from '../domain'
import type { LodLevel } from '../lib/lod'

/**
 * Must track `canvas.css`. Changing padding or the type scale there without re-measuring
 * these makes layout drift — and drift downwards overlaps boxes.
 *
 * Re-measure by loading `tests/fixtures/wide-names.sql` and reading `offsetHeight` off
 * `.erd-node` and its children; `tests/e2e/measurement.spec.ts` will tell you if you are
 * under.
 */
const METRICS = {
  /** 38px measured; 37px at L0, where the header has no bottom rule. */
  headerHeight: 38,
  /*
   * 27.4px, and the fraction is the point.
   *
   * A row is 20.3px of line-height plus 6px of padding, and every row after the first adds
   * a 1px rule (`.erd-attr + .erd-attr`), so the true rate is ~27.37px and it only shows up
   * once you have enough rows for the fraction to accumulate. Measured `.erd-node__attrs`
   * heights: 136px at 5 rows, 163 at 6, 437 at 16, 656 at 24, 1642 at 60 — i.e. 27.2 to
   * 27.37 px per row, creeping up with the row count.
   *
   * A flat 27 looks right on a five-row table and under-measures a 60-column one by 22px,
   * which is exactly the kind of error that overlaps boxes only on the schemas that matter.
   * 27.4 stays fractionally above the real rate at every size: over-estimating by ~2px at
   * 60 rows and never under.
   */
  rowHeight: 27.4,
  /** The "N more" row at L1. Measured 30px — it is not the same as the add-field row. */
  moreRowHeight: 30,
  /** The "+ Add field" row at L2. Measured 27px. */
  addRowHeight: 27,
  /** 2px each side, doubled when selected or carrying a validation marker. Assume thick. */
  border: 4,
  paddingX: 26,
  /*
   * Character widths for the WIDTH estimate only — height no longer depends on them now
   * that a row cannot wrap. Real column names measured 6.2-10.2 px per character, so this
   * average is wrong for any individual name; it only has to be close enough that the
   * `minWidth`/`maxWidth` clamps do the rest, and both clamps are exact.
   */
  charWidth: 7.8,
  typeCharWidth: 6.9,
  badgeWidth: 24,
  /** `.erd-node` min-width, and 120px at L0 — exact, from canvas.css. */
  minWidth: 160,
  minWidthL0: 120,
  /** `.erd-node` max-width — exact, from canvas.css. Was 320, which never matched. */
  maxWidth: 300,
} as const

function rowWidth(name: string, dataType: string | undefined, badges: number): number {
  return (
    name.length * METRICS.charWidth +
    (dataType?.length ?? 0) * METRICS.typeCharWidth +
    badges * METRICS.badgeWidth +
    METRICS.paddingX
  )
}

function badgeCount(entity: Entity, index: number): number {
  const attribute = entity.attributes[index]
  if (attribute === undefined) return 0

  let count = 0
  if (attribute.isPrimaryKey || attribute.isUnique) count += 1
  if (attribute.foreignKey !== undefined) count += 1
  if (attribute.isMultivalued) count += 1
  if (attribute.isDerived) count += 1
  if (attribute.children !== undefined) count += 1
  return count
}

/** Attributes drawn at this level of detail — must match EntityNode's own rule. */
function visibleAttributes(entity: Entity, lod: LodLevel): number {
  if (lod === 0) return 0
  if (lod === 1) {
    return entity.attributes.filter(
      (attribute) => attribute.isPrimaryKey || attribute.foreignKey !== undefined,
    ).length
  }
  return entity.attributes.length
}

export function measureEntity(
  entity: Entity,
  lod: LodLevel,
  editable = true,
): { width: number; height: number } {
  const rows = visibleAttributes(entity, lod)

  let width = rowWidth(entity.name || 'unnamed', undefined, 0)
  if (lod > 0) {
    entity.attributes.forEach((attribute, index) => {
      width = Math.max(
        width,
        rowWidth(attribute.name || 'unnamed', attribute.dataType, badgeCount(entity, index)),
      )
    })
  }

  const hasMoreRow = lod === 1 && rows < entity.attributes.length
  const hasAddRow = editable && lod === 2
  const floor = lod === 0 ? METRICS.minWidthL0 : METRICS.minWidth

  return {
    width: Math.min(METRICS.maxWidth, Math.max(floor, Math.ceil(width))),
    height:
      METRICS.border +
      METRICS.headerHeight +
      (rows === 0 ? 0 : Math.ceil(rows * METRICS.rowHeight)) +
      (hasMoreRow ? METRICS.moreRowHeight : 0) +
      (hasAddRow ? METRICS.addRowHeight : 0),
  }
}

/**
 * Measure every entity.
 *
 * Deliberately measured at the level the user is CURRENTLY seeing. Laying out for L2
 * while viewing L0 leaves oceans of white space; laying out for L0 while viewing L2
 * overlaps boxes. Neither is recoverable without re-running layout, so the current view
 * is the only defensible choice.
 */
export function measureAll(
  diagram: Diagram,
  lod: LodLevel,
  editable = true,
): Record<EntityId, { width: number; height: number }> {
  const sizes: Record<EntityId, { width: number; height: number }> = {}
  for (const entity of diagram.entities) {
    sizes[entity.id] = measureEntity(entity, lod, editable)
  }
  return sizes
}
