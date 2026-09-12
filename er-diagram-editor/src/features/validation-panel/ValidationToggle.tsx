// The toolbar control that opens the panel, carrying the issue count (FR-8.4).
//
// Rendered by the editor and handed to `Toolbar` as a node, the same way `DiagramMenu`
// is. The alternative — three more props threaded through `ToolbarProps` — would put the
// toolbar in the business of knowing what a validation report is, when all it needs to
// do is find somewhere to put this.

import { useUiStore } from '../../store'

import { useValidationReport } from './useValidation'

export function ValidationToggle(): React.ReactElement {
  const report = useValidationReport()
  const open = useUiStore((state) => state.validationPanelOpen)
  const toggle = useUiStore((state) => state.toggleValidationPanel)

  // Errors and warnings only — `report.badgeCount` already excludes info, so a healthy
  // diagram with a legitimate many-to-many shows a clean toggle rather than a permanent
  // "1" that means nothing.
  const count = report.badgeCount
  const worst = report.counts.error > 0 ? 'error' : count > 0 ? 'warning' : undefined

  const label =
    count === 0
      ? 'Issues: none found'
      : `Issues: ${String(report.counts.error)} errors, ${String(report.counts.warning)} warnings`

  return (
    <button
      type="button"
      className="erd-btn erd-validation-toggle"
      onClick={toggle}
      aria-expanded={open}
      /* The visible text is "Issues" plus a number; the accessible name says what the
         number counts, because "Issues 3" read aloud does not (NFR-4.4, NFR-4.6). */
      aria-label={label}
      title={label}
    >
      Issues
      {count === 0 ? null : (
        <span className="erd-validation-toggle__badge" data-severity={worst} aria-hidden="true">
          {count}
        </span>
      )}
    </button>
  )
}
