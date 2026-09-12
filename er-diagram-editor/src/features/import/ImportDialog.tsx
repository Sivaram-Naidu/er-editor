// Open a .erd.json, .mmd or .sql file (FR-6.8), and merge it into the diagram on screen.

import { useMemo, useState } from 'react'

import { mergeDiagrams, type Diagram, type MergeResult, type MergeSummary } from '../../domain'
import type { SqlDialect } from '../../io'
import { openTextFile } from '../../persistence'
import { Dialog } from '../../ui'

import { importFile, needsLayout } from './importFile'

export interface ImportDialogProps {
  /** The diagram on screen, so a file can be previewed against it before anything changes. */
  current: Diagram
  /** Open the file as a NEW document — the original behaviour, and the only one on an empty canvas. */
  onImported: (diagram: Diagram, arrange: boolean) => void
  /** Merge the file into the current document, as one undo step. */
  onMerged: (result: MergeResult) => void
  onClose: () => void
}

/** At most this many names before the list turns into a count. A 71-table dump is normal. */
const NAMES_SHOWN = 8

function NameList(props: { label: string; names: readonly string[] }): React.ReactElement | null {
  if (props.names.length === 0) return null

  const shown = props.names.slice(0, NAMES_SHOWN)
  const rest = props.names.length - shown.length

  return (
    <li>
      <strong>
        {props.names.length} {props.label}
      </strong>
      {': '}
      {shown.join(', ')}
      {rest > 0 ? ` and ${String(rest)} more` : ''}
    </li>
  )
}

function Summary(props: { summary: MergeSummary }): React.ReactElement {
  const { summary } = props
  const nothing =
    summary.added.length === 0 && summary.changed.length === 0 && summary.removed === 0

  return (
    <div className="erd-import__warnings">
      <h3>What this will do</h3>
      <ul>
        <NameList label="new" names={summary.added} />
        <NameList label="updated" names={summary.changed} />
        {summary.removed === 0 ? null : (
          <li>
            <strong>{summary.removed} removed</strong>
            {': '}
            {summary.missing.slice(0, NAMES_SHOWN).join(', ')}
          </li>
        )}
        {summary.unchanged === 0 ? null : <li>{summary.unchanged} unchanged</li>}
        {summary.relationshipsAdded === 0 ? null : (
          <li>{summary.relationshipsAdded} new relationships</li>
        )}
        {summary.relationshipsRemoved === 0 ? null : (
          <li>{summary.relationshipsRemoved} relationships removed</li>
        )}
        {/*
          Called out rather than folded into "updated": it is information leaving the
          document, and it usually means this dump is not the one the diagram was built
          from.
        */}
        {summary.foreignKeysCleared === 0 ? null : (
          <li>
            <strong>{summary.foreignKeysCleared} foreign keys cleared</strong> — the columns
            they referenced are not in this file
          </li>
        )}
        {nothing ? <li>Nothing — this file matches what is already on the canvas.</li> : null}
      </ul>
    </div>
  )
}

export function ImportDialog(props: ImportDialogProps): React.ReactElement {
  const { current } = props
  const [dialect, setDialect] = useState<SqlDialect | 'auto'>('auto')
  const [error, setError] = useState<string | undefined>(undefined)
  const [warnings, setWarnings] = useState<string[]>([])
  const [picked, setPicked] = useState<Diagram | undefined>(undefined)
  const [removeMissing, setRemoveMissing] = useState(false)

  // Escape, the focus trap, focus restore and the labelling all live in `ui/Dialog`.

  // The preview and the thing that gets applied are the SAME value, recomputed from the
  // same pure function. A second description of the merge, derived separately for display,
  // is how a preview starts lying about what the button does.
  const preview = useMemo(
    () =>
      picked === undefined
        ? undefined
        : mergeDiagrams(current, picked, { removeMissing }),
    [picked, current, removeMissing],
  )

  const choose = async (): Promise<void> => {
    setError(undefined)
    setWarnings([])

    const file = await openTextFile('.erd.json,.json,.mmd,.sql')
    if (file === undefined) return

    try {
      const outcome = importFile({ filename: file.name, content: file.text, dialect })
      setWarnings(outcome.warnings)

      // Nothing to merge into, so there is no decision to put to anyone.
      if (current.entities.length === 0) {
        props.onImported(outcome.diagram, needsLayout(outcome.diagram))
        return
      }
      setPicked(outcome.diagram)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That file could not be read.')
    }
  }

  return (
    <Dialog title="Open a file" onClose={props.onClose} narrow>
      {preview === undefined || picked === undefined ? (
        <>
          <p className="erd-inspector__empty">
            Reads <code>.erd.json</code>, Mermaid <code>.mmd</code>, and SQL <code>.sql</code>{' '}
            schemas. If you already have a diagram open, you can merge the file into it and keep
            your layout.
          </p>

          <label className="erd-inspector__field">
            <span className="erd-inspector__label">SQL dialect</span>
            <select
              className="erd-select erd-select--block"
              value={dialect}
              onChange={(event) => {
                setDialect(event.target.value as SqlDialect | 'auto')
              }}
            >
              <option value="auto">Detect automatically</option>
              <option value="postgres">PostgreSQL</option>
              <option value="mysql">MySQL</option>
            </select>
          </label>
          <span className="erd-inspector__hint">
            Only used for <code>.sql</code> files. Detection looks for backticks and{' '}
            <code>ENGINE=</code> (MySQL) against <code>SERIAL</code> and casts (PostgreSQL).
          </span>
        </>
      ) : (
        <>
          <p className="erd-inspector__empty">
            Merging keeps the position of every table that is still in the file, and places only
            the new ones. It is a single undo step.
          </p>

          <Summary summary={preview.summary} />

          {preview.summary.missing.length === 0 ? null : (
            <div className="erd-toggle">
              <label className="erd-toggle__control">
                <input
                  type="checkbox"
                  checked={removeMissing}
                  onChange={(event) => {
                    setRemoveMissing(event.target.checked)
                  }}
                />
                <span className="erd-toggle__text">
                  Also delete {preview.summary.missing.length} table
                  {preview.summary.missing.length === 1 ? '' : 's'} that are not in this file
                </span>
              </label>
              <span className="erd-inspector__hint">
                Off by default: tables you drew by hand were never in the file either.
              </span>
            </div>
          )}
        </>
      )}

      {error === undefined ? null : (
        <p className="erd-import__error" role="alert">
          {error}
        </p>
      )}

      {warnings.length === 0 ? null : (
        <div className="erd-import__warnings">
          <h3>Notes</h3>
          <ul>
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      <footer className="erd-modal__foot">
        {preview === undefined || picked === undefined ? (
          <button
            type="button"
            className="erd-btn erd-btn--primary"
            onClick={() => {
              void choose()
            }}
          >
            Choose a file…
          </button>
        ) : (
          <>
            <button
              type="button"
              className="erd-btn"
              onClick={() => {
                props.onImported(picked, needsLayout(picked))
              }}
            >
              Open as a new diagram
            </button>
            <button
              type="button"
              className="erd-btn erd-btn--primary"
              onClick={() => {
                props.onMerged(preview)
              }}
            >
              Merge into this diagram
            </button>
          </>
        )}
      </footer>
    </Dialog>
  )
}
