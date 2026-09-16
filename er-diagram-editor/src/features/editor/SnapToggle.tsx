// The toolbar control for snap-to-grid (FR-3.5).
//
// A pressed-state button rather than a checkbox, because it has two states and both of
// them are legitimate — unlike Detail and Theme, which have three and needed a select.
// `aria-pressed` is what carries the state to a screen reader; the visual cue is styling
// keyed off the same attribute, so the two cannot disagree (NFR-4.4).
//
// Rendered by the editor and handed to `Toolbar` as a node, the same way `DiagramMenu` and
// `ValidationToggle` are — the toolbar's job is to find somewhere to put it, not to know
// what a preference is.

import { useSnapToGrid } from './useSnapToGrid'

export function SnapToggle(): React.ReactElement {
  const { snapToGrid, setSnapToGrid } = useSnapToGrid()

  const label = snapToGrid
    ? 'Snap to grid: on. Dragged tables round to the 16px grid.'
    : 'Snap to grid: off. Dragged tables line up with their neighbours.'

  return (
    <button
      type="button"
      className="erd-btn"
      aria-pressed={snapToGrid}
      onClick={() => {
        setSnapToGrid(!snapToGrid)
      }}
      /* Says what the OTHER state would do as well as this one, because "Snap" alone
         leaves a user guessing whether the button is a state or an action. */
      title={label}
      aria-label={label}
    >
      Snap
    </button>
  )
}
