// Issue list by severity, click to select and reveal (FR-8.1).
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS SITS UNDER THE CANVAS RATHER THAN BESIDE IT
// ─────────────────────────────────────────────────────────────────────────────
//
// Issues are sentences. The inspector's 288px column is the right shape for labelled
// controls and the wrong shape for prose — every message would wrap to three lines and
// the list would need scrolling after four entries. A strip under the canvas gives each
// issue one line at a readable measure, and leaves the inspector free so the user can
// click an issue and edit the thing it names without either panel closing.
//
// It is collapsed by default (`uiStore.validationPanelOpen` starts false). A permanently
// open problems list on a half-finished diagram is a wall of warnings about work in
// progress; the badge on the toggle is the part that should always be visible.

import { SEVERITY_RANK, type Issue, type Severity, type ValidationReport } from '../../domain'

import { useGoToIssue, useValidationReport } from './useValidation'

/** Heading, and the word used in the empty state. Ordered worst-first by SEVERITY_RANK. */
const TIER: Readonly<Record<Severity, { heading: string; noun: string }>> = {
  error: { heading: 'Errors', noun: 'error' },
  warning: { heading: 'Warnings', noun: 'warning' },
  info: { heading: 'Observations', noun: 'observation' },
}

const TIERS: readonly Severity[] = (['error', 'warning', 'info'] as const)
  .slice()
  .sort((a, b) => SEVERITY_RANK[a] - SEVERITY_RANK[b])

export interface ValidationPanelProps {
  onClose: () => void
}

function IssueRow({
  issue,
  onGo,
}: {
  issue: Issue
  onGo: (issue: Issue) => void
}): React.ReactElement {
  return (
    <li className="erd-issues__item">
      {/* A button, not a row with a click handler: this is an action, it must be
          reachable by Tab and fire on Enter and Space, and a screen reader needs to be
          told it does something (NFR-3.2, NFR-4.6). */}
      <button
        type="button"
        className="erd-issues__go"
        data-severity={issue.severity}
        onClick={() => {
          onGo(issue)
        }}
      >
        <span className="erd-issues__badge" aria-hidden="true">
          {issue.severity === 'error' ? '!' : issue.severity === 'warning' ? '?' : 'i'}
        </span>
        <span className="erd-issues__message">{issue.message}</span>
        <span className="erd-visually-hidden">
          {` (${TIER[issue.severity].noun}. Activate to select and show it.)`}
        </span>
      </button>
    </li>
  )
}

function Tier({
  severity,
  issues,
  onGo,
}: {
  severity: Severity
  issues: readonly Issue[]
  onGo: (issue: Issue) => void
}): React.ReactElement | null {
  if (issues.length === 0) return null

  return (
    <section className="erd-issues__tier" data-severity={severity}>
      <h3 className="erd-issues__heading">
        {TIER[severity].heading} <span className="erd-issues__count">{issues.length}</span>
      </h3>
      <ul className="erd-issues__list">
        {issues.map((issue) => (
          <IssueRow key={issue.id} issue={issue} onGo={onGo} />
        ))}
      </ul>
    </section>
  )
}

function Summary({ report }: { report: ValidationReport }): React.ReactElement {
  if (report.issues.length === 0) {
    return (
      <p className="erd-issues__empty">
        Nothing to report. No duplicate or missing names, every entity has a key and a relationship,
        and each foreign key agrees with the key it points at.
      </p>
    )
  }

  return (
    <p className="erd-issues__empty erd-issues__empty--counts">
      {TIERS.filter((severity) => report.counts[severity] > 0)
        .map((severity) => `${String(report.counts[severity])} ${TIER[severity].noun}`)
        .join(' · ')}
    </p>
  )
}

export function ValidationPanel({ onClose }: ValidationPanelProps): React.ReactElement {
  const report = useValidationReport()
  const goToIssue = useGoToIssue()

  const handleGo = (issue: Issue): void => {
    goToIssue(issue.target)
  }

  return (
    <section className="erd-issues" aria-label="Validation issues">
      <header className="erd-issues__head">
        <h2 className="erd-issues__title">Issues</h2>
        <Summary report={report} />
        <button type="button" className="erd-btn erd-issues__close" onClick={onClose}>
          Hide
        </button>
      </header>

      <div className="erd-issues__body">
        {TIERS.map((severity) => (
          <Tier
            key={severity}
            severity={severity}
            issues={report.issues.filter((issue) => issue.severity === severity)}
            onGo={handleGo}
          />
        ))}
      </div>
    </section>
  )
}
