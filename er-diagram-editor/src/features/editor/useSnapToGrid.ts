// Setting snap-to-grid, in one place (FR-3.5).
//
// The same shape as `useApplyTheme`, and for the same two reasons. Flipping the toggle is
// two steps — the store for this session, the preferences table for the next one — and a
// second call site doing only the first would look right and silently forget the choice on
// reload. And a component file that also exports a hook loses React Fast Refresh, so the
// hook lives apart from the button.
//
// The toolbar is not the only caller: the Ctrl+K palette offers the same toggle (FR-9.2).
//
// Deliberately not routed through the command stack. Snapping is a preference about how
// the pointer behaves, not part of the document, and Ctrl+Z must not change it — the moves
// it produced are each already their own undo step.

import { useCallback } from 'react'

import { SNAP_TO_GRID_KEY, sharedRepository } from '../../persistence'
import { useUiStore } from '../../store'

export function useSnapToGrid(): { snapToGrid: boolean; setSnapToGrid: (next: boolean) => void } {
  const snapToGrid = useUiStore((state) => state.snapToGrid)
  const set = useUiStore((state) => state.setSnapToGrid)

  const setSnapToGrid = useCallback(
    (next: boolean) => {
      set(next)
      // Fire-and-forget: a preference that fails to persist costs one re-pick after a
      // reload, which is not worth blocking the paint for.
      void sharedRepository().setPreference(SNAP_TO_GRID_KEY, next)
    },
    [set],
  )

  return { snapToGrid, setSnapToGrid }
}
