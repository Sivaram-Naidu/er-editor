// Open a .erd.json, .mmd or .sql file (FR-6.8).

import { useState } from 'react'

import type { Diagram } from '../../domain'
import type { SqlDialect } from '../../io'
import { openTextFile } from '../../persistence'
import { Dialog } from '../../ui'

import { importFile, needsLayout } from './importFile'

export interface ImportDialogProps {
  /** Called with the imported document. The caller decides what to do with it. */
  onImported: (diagram: Diagram, arrange: boolean) => void
  onClose: () => void
}

export function ImportDialog(props: ImportDialogProps): React.ReactElement {
  const [dialect, setDialect] = useState<SqlDialect | 'auto'>('auto')
  const [error, setError] = useState<string | undefined>(undefined)
  const [warnings, setWarnings] = useState<string[]>([])

  // Escape, the focus trap, focus restore and the labelling all live in `ui/Dialog`.

  const choose = async (): Promise<void> => {
    setError(undefined)
    setWarnings([])

    const picked = await openTextFile('.erd.json,.json,.mmd,.sql')
    if (picked === undefined) return

    try {
      const outcome = importFile({
        filename: picked.name,
        content: picked.text,
        dialect,
      })
      setWarnings(outcome.warnings)
      props.onImported(outcome.diagram, needsLayout(outcome.diagram))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That file could not be read.')
    }
  }

  return (
    <Dialog title="Open a file" onClose={props.onClose} narrow>
      <p className="erd-inspector__empty">
        Reads <code>.erd.json</code>, Mermaid <code>.mmd</code>, and SQL <code>.sql</code> schemas.
        The file opens as a new diagram, so your current work is kept.
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
        <button
          type="button"
          className="erd-btn erd-btn--primary"
          onClick={() => {
            void choose()
          }}
        >
          Choose a file…
        </button>
      </footer>
    </Dialog>
  )
}
