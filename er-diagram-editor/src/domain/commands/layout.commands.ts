// Auto-layout and bulk-move as single undoable steps (FR-3.4).

import type { EntityId, Point } from '../model/types'

import { defineCommand, type Command } from './Command'

/**
 * Move one or more entities.
 *
 * Coalesces on the SET of entities being moved, so a continuous drag collapses to one
 * undo step (FR-7.1) while dragging A then B stays two. The key is sorted so the same
 * selection always produces the same key regardless of iteration order.
 *
 * A drag emits one of these per pointer-move event — potentially hundreds. Coalescing is
 * what keeps that from filling the 100-step history with a single gesture, and is the
 * concrete reason ADR-0003 rejected a generic snapshot-based undo library.
 */
export function moveEntities(positions: Readonly<Record<EntityId, Point>>): Command {
  const ids = Object.keys(positions).sort()

  return defineCommand({
    type: 'layout.move',
    label: ids.length > 1 ? 'Move entities' : 'Move entity',
    coalesceKey: `layout.move:${ids.join(',')}`,
    mutate(draft) {
      for (const [entityId, point] of Object.entries(positions)) {
        draft.layout.positions[entityId as EntityId] = point
      }
    },
  })
}

/**
 * Replace every position at once — the result of an auto-layout run (FR-3.1).
 *
 * Deliberately NOT coalescing: two consecutive auto-layouts are two decisions the user
 * made, and should undo separately.
 *
 * Positions for entities absent from the result are left untouched rather than deleted,
 * so laying out a selection (FR-3.7) does not disturb the rest of the diagram.
 */
export function applyLayout(positions: Readonly<Record<EntityId, Point>>): Command {
  return defineCommand({
    type: 'layout.apply',
    label: 'Auto-layout',
    mutate(draft) {
      for (const [entityId, point] of Object.entries(positions)) {
        draft.layout.positions[entityId as EntityId] = point
      }
    },
  })
}

/** Pin an entity to full detail regardless of zoom (FR-2.7). */
export function setPinned(entityId: EntityId, pinned: boolean): Command {
  return defineCommand({
    type: 'layout.setPinned',
    label: pinned ? 'Pin entity' : 'Unpin entity',
    mutate(draft) {
      const isPinned = draft.layout.pinned.includes(entityId)

      if (pinned && !isPinned) draft.layout.pinned.push(entityId)
      else if (!pinned && isPinned) {
        draft.layout.pinned = draft.layout.pinned.filter((candidate) => candidate !== entityId)
      }
    },
  })
}
