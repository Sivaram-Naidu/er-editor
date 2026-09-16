// The keyboard shortcut reference (FR-9.1).
//
// Every row is rendered from `EDITOR_SHORTCUTS` — the same objects the window keymap
// dispatches from — so this file contains no knowledge of what any key does. That is the
// whole design; see the header of `shortcuts.ts` for why a hand-written list was not an
// option.
//
// `<kbd>` rather than a styled span, because the element means "keyboard input" and is
// what a screen reader and a reader-mode both expect to find here (NFR-4.4).

import { formatChord, isMacPlatform } from '../../lib'
import { Dialog } from '../../ui'

import { EDITOR_SHORTCUTS, SHORTCUT_GROUPS, type Shortcut } from './shortcuts'

export interface ShortcutsDialogProps {
  onClose: () => void
}

/**
 * Aliases are joined with "or", not listed as separate rows.
 *
 * Delete and Backspace are one command, and two rows saying "Delete the selection" reads
 * as two features rather than as one with two keys.
 */
function chordsOf(shortcut: Shortcut, mac: boolean): string[] {
  return shortcut.chords.map((chord) => formatChord(chord, { mac }))
}

export function ShortcutsDialog(props: ShortcutsDialogProps): React.ReactElement {
  const mac = isMacPlatform()

  return (
    <Dialog title="Keyboard shortcuts" onClose={props.onClose}>
      <div className="erd-shortcuts">
        {SHORTCUT_GROUPS.map((group) => {
          const rows = EDITOR_SHORTCUTS.filter((shortcut) => shortcut.group === group)
          if (rows.length === 0) return null

          return (
            <section key={group} className="erd-shortcuts__group">
              <h3 className="erd-shortcuts__heading">{group}</h3>
              <dl className="erd-shortcuts__list">
                {rows.map((shortcut) => (
                  <div key={shortcut.label} className="erd-shortcuts__row">
                    <dt className="erd-shortcuts__keys">
                      {chordsOf(shortcut, mac).map((chord, index) => (
                        <span key={chord}>
                          {index === 0 ? null : <span className="erd-shortcuts__or"> or </span>}
                          <kbd>{chord}</kbd>
                        </span>
                      ))}
                    </dt>
                    <dd className="erd-shortcuts__label">{shortcut.label}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )
        })}
      </div>

      {/* Said once, at the bottom, rather than on the four rows it applies to. A "(not
          while typing)" note beside every bare key would be most of the sheet.

          The exception names itself: `whileTyping` is the property that makes it true, so
          the sentence cannot go on claiming Ctrl+K after someone moves that flag. */}
      <p className="erd-shortcuts__note">
        Single-key shortcuts are off while you are typing in a field.{' '}
        {EDITOR_SHORTCUTS.filter((shortcut) => shortcut.whileTyping === true)
          .flatMap((shortcut) => chordsOf(shortcut, mac))
          .join(' and ')}{' '}
        always works.
      </p>
    </Dialog>
  )
}
