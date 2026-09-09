// Node dimension estimation per LOD. ELK cannot measure text.
//
// ELK positions boxes; it has no idea how big a box is until told. Measuring the real
// DOM would be exact but costs a synchronous reflow across every node — at 120 entities
// that blows NFR-1.3's 100 ms interaction budget on its own, and the nodes outside the
// viewport are not even mounted (NFR-2.4), so there is nothing to measure.
//
// So sizes are computed from the model instead. The numbers below mirror the padding and
// type scale in canvas.css; they are estimates, and an estimate that is slightly wrong
// produces slightly generous spacing rather than overlap, which is the safe direction to
// be wrong in.

import type { Diagram, Entity, EntityId } from '../domain'
import type { LodLevel } from '../lib/lod'

/** Must track `canvas.css`. Changing padding there without changing these makes layout drift. */
const METRICS = {
  headerHeight: 36,
  rowHeight: 26,
  addRowHeight: 24,
  paddingX: 26,
  // Tracks the raised --erd-text-* scale. Under-measuring here makes ELK overlap boxes,
  // so these err generous.
  charWidth: 7.8,
  typeCharWidth: 6.9,
  badgeWidth: 24,
  minWidth: 168,
  maxWidth: 320,
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

  return {
    width: Math.min(METRICS.maxWidth, Math.max(METRICS.minWidth, Math.ceil(width))),
    height:
      METRICS.headerHeight +
      rows * METRICS.rowHeight +
      (hasMoreRow ? METRICS.addRowHeight : 0) +
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
