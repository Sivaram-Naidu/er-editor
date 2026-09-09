// The diagram title, and the way back out of the one you are in.
//
// Before this existed the app had exactly one document and no way to leave it: once a
// diagram had a table in it the empty state was unreachable, and earlier diagrams sat in
// storage with nothing able to open them.

import { useEffect, useRef, useState } from 'react'

import type { DiagramId } from '../../domain'
import type { DiagramSummary } from '../../persistence'

export interface DiagramMenuProps {
  name: string
  currentId: DiagramId
  saved: readonly DiagramSummary[]
  onRename: (name: string) => void
  onNew: () => void
  onOpen: (id: DiagramId) => void
  onDelete: (id: DiagramId) => void
}

function relativeTime(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${String(minutes)}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${String(hours)}h ago`
  return `${String(Math.round(hours / 24))}d ago`
}

export function DiagramMenu(props: DiagramMenuProps): React.ReactElement {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Dismiss on an outside click or Escape. A menu that can only be closed by the button
  // that opened it is a menu people leave open by accident.
  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: PointerEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const others = props.saved.filter((summary) => summary.id !== props.currentId)

  return (
    <div className="erd-diagrammenu" ref={containerRef}>
      {/* The title doubles as the menu trigger: it is the thing that identifies the
          document, so it is where people look for document-level actions. */}
      <button
        type="button"
        className="erd-diagrammenu__trigger"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          setOpen((current) => !current)
        }}
      >
        <span className="erd-diagrammenu__name">{props.name}</span>
        <span aria-hidden="true" className="erd-diagrammenu__caret">
          ▾
        </span>
      </button>

      {!open ? null : (
        /* Not `role="menu"`. A menu may not contain a textbox, and this one holds the
           diagram-name field — the correct role for a popover with mixed content is a
           labelled group, which also lets the controls inside keep their own semantics. */
        <div className="erd-diagrammenu__panel" role="group" aria-label="Diagram">
          <label className="erd-inspector__field">
            <span className="erd-inspector__label">Diagram name</span>
            <input
              className="erd-input"
              value={props.name}
              onChange={(event) => {
                props.onRename(event.target.value)
              }}
            />
          </label>

          <button
            type="button"
            className="erd-btn"
            onClick={() => {
              props.onNew()
              setOpen(false)
            }}
          >
            New diagram
          </button>

          <div className="erd-diagrammenu__list">
            <h3>Saved diagrams</h3>
            {others.length === 0 ? (
              <p className="erd-inspector__empty">
                Nothing else saved yet. Everything is kept in this browser.
              </p>
            ) : (
              <ul className="erd-fieldlist">
                {others.map((summary) => (
                  <li key={summary.id} className="erd-diagrammenu__row">
                    <button
                      type="button"
                      className="erd-fieldlist__item"
                      onClick={() => {
                        props.onOpen(summary.id)
                        setOpen(false)
                      }}
                    >
                      <span>{summary.name}</span>
                      <span className="erd-fieldlist__type">{relativeTime(summary.updatedAt)}</span>
                    </button>
                    <button
                      type="button"
                      className="erd-btn erd-btn--small erd-btn--danger"
                      title={`Delete ${summary.name}`}
                      aria-label={`Delete ${summary.name}`}
                      onClick={() => {
                        props.onDelete(summary.id)
                      }}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
