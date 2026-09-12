// Double-click to rename, in place.
//
// Names are the field people edit most, so editing happens on the canvas rather than in
// the side panel — the eyes stay on the diagram. Types and constraints, which are edited
// far less often, live in the inspector where they get labelled controls.

import { useEffect, useRef, useState } from 'react'

export interface InlineNameProps {
  value: string
  placeholder: string
  ariaLabel: string
  className?: string
  onCommit: (next: string) => void
  /** Extra attributes for the display element, e.g. the PK underline flag. */
  displayProps?: Record<string, unknown>
}

export function InlineName(props: InlineNameProps): React.ReactElement {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(props.value)
  const [lastSeenValue, setLastSeenValue] = useState(props.value)
  const inputRef = useRef<HTMLInputElement>(null)

  // Re-sync when the value changes underneath us — an undo, or a rename from the
  // inspector while this row is on screen.
  //
  // Adjusting state DURING render rather than in an effect: React re-runs this component
  // before committing, so the user never sees the stale draft. An effect would paint the
  // old value first and then correct it, which is the cascading render the
  // react-hooks/set-state-in-effect rule exists to prevent.
  if (props.value !== lastSeenValue) {
    setLastSeenValue(props.value)
    // A rename arriving mid-edit must not yank the text out from under the typist, so
    // the draft is only replaced when the field is idle.
    if (!editing) setDraft(props.value)
  }

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const commit = (): void => {
    setEditing(false)
    if (draft !== props.value) props.onCommit(draft)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="erd-inline-input"
        value={draft}
        aria-label={props.ariaLabel}
        onChange={(event) => {
          setDraft(event.target.value)
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          // Stop the canvas keymap seeing these: `e` would add an entity mid-word, and
          // Delete would remove the node being renamed.
          event.stopPropagation()
          if (event.key === 'Enter') commit()
          if (event.key === 'Escape') {
            setDraft(props.value)
            setEditing(false)
          }
        }}
        /* React Flow drags a node when its content is dragged; an input needs to own its
           own text selection. */
        onPointerDown={(event) => {
          event.stopPropagation()
        }}
      />
    )
  }

  return (
    <span
      className={props.className}
      role="button"
      tabIndex={0}
      /* The name itself, because `.erd-attr__name` now clips to one line and a long
         column name is not fully readable on the canvas. The rename hint rides along
         rather than replacing it — the tooltip is the only place the whole name exists. */
      title={
        props.value === '' ? 'Double-click to rename' : `${props.value}\nDouble-click to rename`
      }
      onDoubleClick={() => {
        setEditing(true)
      }}
      onKeyDown={(event) => {
        // NFR-3.2: reachable by keyboard, not only by double-click.
        if (event.key === 'Enter' || event.key === 'F2') {
          event.preventDefault()
          setEditing(true)
        }
      }}
      {...props.displayProps}
    >
      {props.value === '' ? (
        <em className="erd-attr__unnamed">{props.placeholder}</em>
      ) : (
        props.value
      )}
    </span>
  )
}
