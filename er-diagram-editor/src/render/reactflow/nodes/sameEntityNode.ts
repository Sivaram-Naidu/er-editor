// When a moved box has to be redrawn, and when it does not.
//
// Extracted from EntityNode so it can be asserted directly. The bug this exists to
// prevent is invisible from inside the component: it renders correctly either way, and
// only the COST differs — which is exactly the shape of defect this project keeps
// shipping under a green unit suite.

import type { NodeProps } from '@xyflow/react'

import type { EntityNodeData } from './EntityNode'

/**
 * Are these two `data` objects equivalent?
 *
 * Field by field rather than by identity, because Canvas builds a fresh `data` object
 * for every node on every render — it has to, since the object is where the node's
 * whole draw state lives. What matters is that nothing inside it changed.
 *
 * `tracedAttributeIds` and `foreignKeyTargets` are compared by reference on purpose:
 * Canvas memoises each of them on the inputs it actually derives them from, so a stable
 * reference here IS the statement that their contents are unchanged. Comparing their
 * contents instead would walk every attribute of every entity on every render, which is
 * the cost this comparison exists to avoid.
 *
 * That makes the reference discipline in Canvas load-bearing, and it was broken for
 * `tracedAttributeIds` until 11 Sep 2026: it was ONE Set for the whole diagram, so every
 * hover minted a new one, this comparison returned false for all 120 boxes, and each of
 * them redrew every row. It is now one set per entity, absent for entities with nothing
 * traced, so the shared empty Set keeps its identity and the comparison holds. If a field
 * is added here, memoise it on what it is actually derived from or this comparison is
 * decoration.
 */
function sameEntityNodeData(previous: EntityNodeData, next: EntityNodeData): boolean {
  return (
    previous.entity === next.entity &&
    previous.lod === next.lod &&
    previous.isTraced === next.isTraced &&
    previous.tracedAttributeIds === next.tracedAttributeIds &&
    previous.selectedAttributeId === next.selectedAttributeId &&
    previous.foreignKeyTargets === next.foreignKeyTargets &&
    previous.editable === next.editable &&
    previous.issueSeverity === next.issueSeverity &&
    previous.hiddenNeighbours === next.hiddenNeighbours
  )
}

/**
 * Re-render this box for any prop change EXCEPT the one that says where it is.
 *
 * React Flow hands every node component `positionAbsoluteX` / `positionAbsoluteY`. This
 * component never draws with them — `NodeWrapper` owns the CSS transform — but the
 * default `memo` comparison cannot know that, so a box that moves re-renders its header,
 * every attribute row, every badge and every per-row handle for a change that is purely
 * a transform on the wrapper.
 *
 * That is free while one box is dragged and ruinous when a layout lands, because a
 * layout moves all of them at once: ~10,000 elements re-created at 120 entities, for
 * nothing (NFR-1.4). Measured at 69 ms of blocked main thread at 120 entities and 157 ms
 * at the 300-entity ceiling of NFR-2.2, against a 50 ms budget.
 *
 * Every OTHER prop is still compared, including ones this component does not read today,
 * so reaching for one later cannot silently stop working. Only position is declined, and
 * it is declined because the wrapper above already handles it.
 */
export function sameEntityNode(previous: NodeProps, next: NodeProps): boolean {
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)])

  for (const key of keys) {
    if (key === 'positionAbsoluteX' || key === 'positionAbsoluteY' || key === 'data') continue

    const before = (previous as unknown as Record<string, unknown>)[key]
    const after = (next as unknown as Record<string, unknown>)[key]
    if (!Object.is(before, after)) return false
  }

  return sameEntityNodeData(
    previous.data as unknown as EntityNodeData,
    next.data as unknown as EntityNodeData,
  )
}
