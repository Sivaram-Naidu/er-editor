// Small labelled controls shared by the inspector sections.
//
// Every control is a real <label>/<fieldset> pairing rather than a styled div, so the
// panel is keyboard-navigable and screen-reader-legible without extra ARIA (NFR-4.6).
//
// The hint deliberately sits OUTSIDE the <label> and is attached with
// `aria-describedby`. Nesting it inside would fold it into the control's accessible
// name — "RoleDistinguishes the two ends, e.g. manager / report" instead of "Role" —
// which is both wrong for a screen reader and wrong for any test querying by label.

import { useId } from 'react'

export interface FieldProps {
  label: string
  hint?: string
  children: React.ReactNode
}

export function Field(props: FieldProps): React.ReactElement {
  const hintId = useId()

  return (
    <div className="erd-inspector__field">
      <label className="erd-inspector__labelled">
        <span className="erd-inspector__label">{props.label}</span>
        {/* The control is the label's only other child, so the association is implicit
            and needs no htmlFor/id pairing. */}
        {props.children}
      </label>
      {props.hint === undefined ? null : (
        <span className="erd-inspector__hint" id={hintId}>
          {props.hint}
        </span>
      )}
    </div>
  )
}

export interface ToggleProps {
  label: string
  checked: boolean
  disabled?: boolean
  hint?: string
  onChange: (checked: boolean) => void
}

export function Toggle(props: ToggleProps): React.ReactElement {
  const hintId = useId()

  return (
    <div className="erd-toggle" data-disabled={props.disabled || undefined}>
      <label className="erd-toggle__control">
        <input
          type="checkbox"
          checked={props.checked}
          disabled={props.disabled ?? false}
          {...(props.hint === undefined ? {} : { 'aria-describedby': hintId })}
          onChange={(event) => {
            props.onChange(event.target.checked)
          }}
        />
        <span className="erd-toggle__text">{props.label}</span>
      </label>
      {props.hint === undefined ? null : (
        <span className="erd-inspector__hint" id={hintId}>
          {props.hint}
        </span>
      )}
    </div>
  )
}
