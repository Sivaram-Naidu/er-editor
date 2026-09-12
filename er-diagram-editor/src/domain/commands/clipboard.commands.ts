// Installing a planned paste as ONE undo step (FR-7.1, FR-7.4).

import type { PasteResult } from '../clipboard'
import type { Entity, EntityId, Point, Relationship } from '../model/types'

import { defineCommand, type Command } from './Command'

/**
 * Append what `planPaste` worked out.
 *
 * The label is a parameter because the same plan backs two gestures that a user thinks of
 * as different things: Ctrl+V is "Paste" and Ctrl+D is "Duplicate", and the undo button
 * reads that label back to them. Sharing the plan and splitting only the word is what keeps
 * duplicate from quietly growing its own paste implementation.
 */
export function pasteEntities(result: PasteResult, label = 'Paste'): Command {
  return defineCommand({
    type: 'clipboard.paste',
    label,
    mutate(draft) {
      draft.entities.push(...(result.entities as Entity[]))
      draft.relationships.push(...(result.relationships as Relationship[]))
      for (const [id, point] of Object.entries(result.positions) as [EntityId, Point][]) {
        draft.layout.positions[id] = point
      }
    },
  })
}
