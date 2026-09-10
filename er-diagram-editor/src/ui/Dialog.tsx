// Modal shell: focus trap, focus restore, Escape, labelling.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS IS RADIX AND NOT TWENTY LINES OF OUR OWN
// ─────────────────────────────────────────────────────────────────────────────
//
// The export and import dialogs each hand-rolled this shell, and each got the same three
// things wrong:
//
//   1. `useEffect(..., [props])` for the Escape listener. `props` is a fresh object on
//      every render, so the listener was torn down and re-added on every keystroke
//      anywhere in the tree — work proportional to typing, for a listener that never
//      changes.
//   2. The panel took focus on mount but nothing kept it. Tab walked straight out of the
//      dialog and into the toolbar and canvas behind it, which for a keyboard user means
//      the modal is not modal — and it set `aria-modal="true"` while that was true, so it
//      announced a boundary that did not exist.
//   3. Nothing restored focus on close. Focus fell back to <body>, so the next Tab
//      restarted from the top of the page rather than returning to the button that opened
//      the dialog.
//
// A correct focus trap is not twenty lines. It has to find the tabbable elements (a list
// that changes as this dialog's own content changes), wrap at both ends, survive an
// element being removed while focused, cope with focus arriving from the browser chrome,
// and restore to a trigger that may itself have unmounted. `radix-ui` was already a
// dependency and its Dialog does all of that, so this file is the adapter, not the
// implementation.
//
// It costs about 30 kB of the main bundle, measured (with html-to-image, the two together
// are 665 kB -> 716 kB raw, 207 kB -> 224 kB gzipped). Importing from the package root
// tree-shakes exactly as well as `radix-ui/dialog` — also measured, byte-identical — so
// this takes the documented form.
//
// The markup and class names are unchanged from the hand-rolled version — `Content` is
// nested inside `Overlay` on purpose, because `.erd-modal` centres its child with
// `place-items: center` and Radix's default sibling layout would leave the panel
// top-left. `role="dialog"`, `tabindex="-1"` and `aria-labelledby` now come from Radix
// rather than being written out by hand.
//
// One deliberate difference: there is no `aria-modal`. Radix marks the REST of the page
// `aria-hidden` while the dialog is open, which is what actually confines a screen reader
// to the dialog; `aria-modal` is advisory and unevenly implemented, and setting it as well
// buys nothing. `tests/unit/features/dialog.test.tsx` asserts the mechanism that is real.

import { Dialog as RadixDialog } from 'radix-ui'
import { useRef, useState } from 'react'

export interface DialogProps {
  /** Becomes both the visible heading and the dialog's accessible name. */
  title: string
  /**
   * Called for every route out: the Close button, Escape, and a click on the backdrop.
   *
   * Backdrop-dismiss is new — the hand-rolled overlay swallowed the click. It is safe for
   * both current dialogs because neither holds unsaved input; a dialog that does should
   * take a guard here rather than removing it for everyone.
   */
  onClose: () => void
  /** Narrower panel, for dialogs whose content does not need 720px. */
  narrow?: boolean
  children: React.ReactNode
}

export function Dialog(props: DialogProps): React.ReactElement {
  const contentRef = useRef<HTMLDivElement>(null)
  /**
   * What had focus when this dialog appeared, so it can be given back.
   *
   * Captured in a lazy `useState` initialiser rather than an effect because it has to run
   * BEFORE Radix moves focus into the panel, and render precedes effects. It is captured
   * once and never updated: the point is the element the user left, not whatever has
   * focus now.
   */
  const [openedFrom] = useState<Element | null>(() => document.activeElement)

  return (
    <RadixDialog.Root
      open
      onOpenChange={(open) => {
        // Mounting this component IS opening the dialog — the caller renders it
        // conditionally — so the only transition to report is the close.
        if (!open) props.onClose()
      }}
    >
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="erd-modal">
          <RadixDialog.Content
            ref={contentRef}
            /* Focus the panel itself, not its first button.
             *
             * Radix's default is the first tabbable element, which here is "Close" — so
             * the dialog opens with the dismiss button focused and Enter shuts it again.
             * Focusing the panel (it carries `tabindex="-1"`) means a screen reader reads
             * the dialog's title first and the first Tab lands on the first real control,
             * which is what the hand-rolled version did deliberately. */
            onOpenAutoFocus={(event) => {
              event.preventDefault()
              contentRef.current?.focus()
            }}
            /* Give focus back to whatever opened the dialog.
             *
             * Radix's modal Content does this for you — by focusing `<Dialog.Trigger>`.
             * There is no Trigger here: the dialog is mounted conditionally by the caller
             * and the button that opened it lives in the toolbar, several components away.
             * So Radix's internal handler focuses a null ref, having first called
             * `preventDefault()` on the focus scope's own restore, and focus lands on
             * <body> — the exact bug this component exists to fix. Preventing the default
             * ourselves takes both handlers out of the way (Radix composes ours first and
             * skips its own once the event is defaulted-prevented) and does the restore
             * the Trigger would have done. */
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              if (openedFrom instanceof HTMLElement) openedFrom.focus()
            }}
            className={
              props.narrow === true
                ? 'erd-modal__panel erd-modal__panel--narrow'
                : 'erd-modal__panel'
            }
            /* Radix points `aria-describedby` at a <Dialog.Description> and warns in the
               console when there is none. Neither dialog has one line of prose that
               serves as a description of the whole thing, so this says "no description"
               explicitly instead of leaving a dangling id. */
            aria-describedby={undefined}
          >
            <header className="erd-modal__head">
              <RadixDialog.Title asChild>
                <h2>{props.title}</h2>
              </RadixDialog.Title>
              <RadixDialog.Close asChild>
                <button type="button" className="erd-btn">
                  Close
                </button>
              </RadixDialog.Close>
            </header>

            {props.children}
          </RadixDialog.Content>
        </RadixDialog.Overlay>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}
