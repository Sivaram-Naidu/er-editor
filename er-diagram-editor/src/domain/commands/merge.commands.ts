// Installing a computed merge as ONE undo step.

import type { MergeResult } from '../merge'
import type { Entity, Relationship } from '../model/types'

import { defineCommand, type Command } from './Command'

/**
 * Apply a merge worked out by `mergeDiagrams`.
 *
 * All the thinking happens in that pure function; this only installs the answer, which is
 * what lets the UI render a preview from exactly the result it is about to commit rather
 * than from a second, separately-derived description of it.
 *
 * ONE COMMAND, so a re-import that turns out to be the wrong file is one Ctrl+Z — which is
 * also the reason the merge defaults to not deleting anything. Assigning the arrays wholesale
 * gives Immer a coarse patch, and that is correct here: the inverse it derives carries the
 * previous arrays, so undo restores the document exactly, including the positions of any
 * entity the merge removed.
 */
export function applyMerge(result: MergeResult): Command {
  return defineCommand({
    type: 'diagram.merge',
    label: 'Import into diagram',
    mutate(draft) {
      draft.entities = result.entities as Entity[]
      draft.relationships = result.relationships as Relationship[]
      draft.layout.positions = { ...result.positions }
      draft.layout.pinned = [...result.pinned]
    },
  })
}
