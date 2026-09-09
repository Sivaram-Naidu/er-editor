// Export dialog, Mermaid preview, loss report (FR-6.1 to FR-6.3).

import { useEffect, useMemo, useRef, useState } from 'react'

import type { Diagram } from '../../domain'
import { exportAdapters, type ExportResult, type LossItem } from '../../io'
import { saveTextFile } from '../../persistence'

export interface ExportDialogProps {
  diagram: Diagram
  onClose: () => void
}

const TREATMENT_LABEL: Record<LossItem['treatment'], string> = {
  approximated: 'Approximated',
  decomposed: 'Restructured',
  dropped: 'Not exported',
}

function LossReport({ items }: { items: readonly LossItem[] }): React.ReactElement {
  if (items.length === 0) {
    return (
      <p className="erd-export__lossless">Nothing is lost — this format holds the whole diagram.</p>
    )
  }

  // Grouped by construct rather than listed per element: "3 weak entities" is more
  // useful than three near-identical lines, and the element names are still there.
  const grouped = new Map<
    string,
    { treatment: LossItem['treatment']; detail: string; names: string[] }
  >()
  for (const item of items) {
    const existing = grouped.get(item.construct)
    if (existing === undefined) {
      grouped.set(item.construct, {
        treatment: item.treatment,
        detail: item.detail,
        names: [item.elementLabel],
      })
    } else {
      existing.names.push(item.elementLabel)
    }
  }

  return (
    <div className="erd-export__loss">
      <h3>What changes in this format</h3>
      <ul>
        {[...grouped.entries()].map(([construct, group]) => (
          <li key={construct} data-treatment={group.treatment}>
            <span className="erd-export__treatment">{TREATMENT_LABEL[group.treatment]}</span>
            <span>{group.detail}</span>
            <span className="erd-export__affected">
              {group.names.slice(0, 4).join(', ')}
              {group.names.length > 4 ? ` and ${String(group.names.length - 4)} more` : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function ExportDialog(props: ExportDialogProps): React.ReactElement {
  const [adapterId, setAdapterId] = useState(exportAdapters[0]?.id ?? 'native-json')
  const [copied, setCopied] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)

  const adapter =
    exportAdapters.find((candidate) => candidate.id === adapterId) ?? exportAdapters[0]

  // Recomputed only when the document or the format changes. Exporting the reference
  // schema is cheap, but not cheap enough to redo on every keystroke elsewhere.
  const result: ExportResult = useMemo(
    () => adapter?.export(props.diagram) ?? { content: '', lossReport: [] },
    [adapter, props.diagram],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') props.onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [props])

  useEffect(() => {
    dialogRef.current?.focus()
  }, [])

  if (adapter === undefined) return <></>

  const filename = `${props.diagram.name.replace(/[^\w-]+/g, '_') || 'diagram'}${adapter.extension}`

  return (
    <div className="erd-modal" role="presentation">
      <div
        className="erd-modal__panel"
        role="dialog"
        aria-modal="true"
        aria-label="Export diagram"
        tabIndex={-1}
        ref={dialogRef}
      >
        <header className="erd-modal__head">
          <h2>Export</h2>
          <button type="button" className="erd-btn" onClick={props.onClose}>
            Close
          </button>
        </header>

        <label className="erd-inspector__field">
          <span className="erd-inspector__label">Format</span>
          <select
            className="erd-select erd-select--block"
            value={adapterId}
            onChange={(event) => {
              setAdapterId(event.target.value)
              setCopied(false)
            }}
          >
            {exportAdapters.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.label}
              </option>
            ))}
          </select>
        </label>

        {/* The report comes BEFORE the preview and the buttons on purpose. FR-6.3 is
            about telling the user what changes before they commit, and a warning below
            the fold is a warning nobody reads. */}
        <LossReport items={result.lossReport} />

        <label className="erd-inspector__field">
          <span className="erd-inspector__label">Preview</span>
          <textarea className="erd-export__preview" readOnly value={result.content} rows={14} />
        </label>

        <footer className="erd-modal__foot">
          <button
            type="button"
            className="erd-btn"
            onClick={() => {
              // `navigator.clipboard` is typed as always present but is genuinely absent
              // over plain HTTP and in some embedded webviews, so the guard is a runtime
              // check rather than a type one.
              const clipboard = (navigator as { clipboard?: Clipboard }).clipboard
              if (clipboard === undefined) return
              void clipboard.writeText(result.content).then(
                () => {
                  setCopied(true)
                },
                () => {
                  // Clipboard access can be refused outright; the textarea above is
                  // still selectable, so this is a convenience, not the only route.
                  setCopied(false)
                },
              )
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            type="button"
            className="erd-btn erd-btn--primary"
            onClick={() => {
              void saveTextFile({
                suggestedName: filename,
                contents: result.content,
                mimeType: adapter.mimeType,
                extensions: { [adapter.extension]: adapter.label },
              })
            }}
          >
            Download {adapter.extension}
          </button>
        </footer>
      </div>
    </div>
  )
}
