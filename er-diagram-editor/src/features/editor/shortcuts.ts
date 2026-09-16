// Every keyboard shortcut the editor binds, as data (FR-9.1, NFR-3.2).
//
// ─────────────────────────────────────────────────────────────────────────────
// THIS IS THE KEYMAP, NOT A DESCRIPTION OF IT
// ─────────────────────────────────────────────────────────────────────────────
//
// The obvious way to build a shortcut sheet is to write the list out in the dialog. It is
// also the way this project has already been bitten twice — see the note on
// `paletteCommands` in `Editor.tsx`, and the SRS status table in CLAUDE.md. A second list
// drifts, and the drift is silent: the sheet promises `Ctrl+Y` for redo long after the
// keymap stopped testing for it, and nothing fails.
//
// So the window keydown handler DISPATCHES from this table, the sheet RENDERS it, and the
// command palette takes its hints from it. There is no second list to keep in step.
//
// Two things make that hold at compile time rather than by vigilance:
//
//   1. `ShortcutId` is a union, and `Editor.tsx` builds a `Record<ShortcutId, () => void>`.
//      Adding an id here without a handler is a type error; a handler with no entry here
//      is a type error too.
//   2. `findShortcut` is the only route from a key event to a command. A chord that is not
//      in this table cannot be handled, and a chord that is in it cannot be printed
//      differently from the way it is matched — both come off the same `Chord` object.
//
// What is left to a test is the one thing types cannot see: two entries claiming the SAME
// chord, where the second is dead code. `tests/unit/features/shortcuts.test.ts` asserts
// there are none.

import { matchesChord, type Chord } from '../../lib'

export type ShortcutId =
  | 'add-entity'
  | 'add-relationship'
  | 'delete'
  | 'copy'
  | 'cut'
  | 'paste'
  | 'duplicate'
  | 'undo'
  | 'redo'
  | 'palette'
  | 'shortcuts'
  | 'clear-selection'

/** The headings the sheet groups by, in the order it shows them. */
export const SHORTCUT_GROUPS = [
  'Create and edit',
  'Clipboard',
  'History',
  'Getting around',
] as const

export type ShortcutGroup = (typeof SHORTCUT_GROUPS)[number]

export interface Shortcut {
  /**
   * `undefined` for a shortcut this app DOCUMENTS but does not bind.
   *
   * There is exactly one, and leaving it out of the sheet would be the wrong kind of
   * honest: arrow keys really do move a table, a user really will find them, and a
   * reference that omits what the tool does is worth less than one that says who does it.
   * `findShortcut` still matches it, so the handler falls through without calling
   * `preventDefault` and React Flow gets the key it is waiting for.
   *
   * The label says "selected" rather than "focused" because that is what was measured:
   * clicking a box and pressing Right moved it 5px, with no Tab involved. React Flow
   * focuses the node it selects, so the two coincide in practice and "focused" would send
   * a reader looking for a distinction that is not there.
   */
  id: ShortcutId | undefined
  /** More than one where a command has genuine aliases — Delete and Backspace. */
  chords: Chord[]
  label: string
  group: ShortcutGroup
  /**
   * Fires even while the caret is in a text field.
   *
   * Only `Ctrl+K`, and the reasoning is in `Editor.tsx`: the bare keys are characters
   * someone might be typing and `Ctrl+Z` in a field is the browser's undo, but a chord
   * with no native meaning cannot be typed by accident — and the palette has to be
   * reachable from the inspector and the diagram-name field, which are two of the places
   * someone is most likely to be when they want to jump somewhere else.
   */
  whileTyping?: boolean
  /**
   * Whether to swallow the key. Default true.
   *
   * `Escape` opts out so that anything else listening for it — a native select, a
   * browser affordance — still sees it; clearing the selection is not a claim on the key.
   */
  preventDefault?: boolean
}

export const EDITOR_SHORTCUTS: readonly Shortcut[] = [
  {
    id: 'add-entity',
    chords: [{ key: 'e' }],
    label: 'Add an entity where you are looking',
    group: 'Create and edit',
  },
  {
    id: 'add-relationship',
    chords: [{ key: 'r' }],
    label: 'Connect the two selected entities',
    group: 'Create and edit',
  },
  {
    id: 'delete',
    chords: [{ key: 'Delete' }, { key: 'Backspace' }],
    label: 'Delete the selection',
    group: 'Create and edit',
  },
  { id: 'copy', chords: [{ key: 'c', ctrl: true }], label: 'Copy', group: 'Clipboard' },
  { id: 'cut', chords: [{ key: 'x', ctrl: true }], label: 'Cut', group: 'Clipboard' },
  { id: 'paste', chords: [{ key: 'v', ctrl: true }], label: 'Paste', group: 'Clipboard' },
  {
    id: 'duplicate',
    chords: [{ key: 'd', ctrl: true }],
    label: 'Duplicate in place',
    group: 'Clipboard',
  },
  {
    id: 'undo',
    // `shift: false` is load-bearing: without it Ctrl+Shift+Z matches here first and redo
    // below becomes unreachable.
    chords: [{ key: 'z', ctrl: true, shift: false }],
    label: 'Undo',
    group: 'History',
  },
  {
    id: 'redo',
    chords: [
      { key: 'z', ctrl: true, shift: true },
      { key: 'y', ctrl: true },
    ],
    label: 'Redo',
    group: 'History',
  },
  {
    id: 'palette',
    chords: [{ key: 'k', ctrl: true }],
    label: 'Search and run any command',
    group: 'Getting around',
    whileTyping: true,
  },
  {
    id: 'shortcuts',
    chords: [{ key: '?' }],
    label: 'This list',
    group: 'Getting around',
  },
  {
    id: 'clear-selection',
    chords: [{ key: 'Escape' }],
    label: 'Clear the selection',
    group: 'Getting around',
    preventDefault: false,
  },
  {
    id: undefined,
    chords: [{ key: 'ArrowUp' }, { key: 'ArrowDown' }, { key: 'ArrowLeft' }, { key: 'ArrowRight' }],
    label: 'Nudge the selected table',
    group: 'Getting around',
  },
]

/**
 * The shortcut this event asks for, or `undefined`.
 *
 * The typing guard is applied HERE rather than at the call site, so that "is this key for
 * the document?" is answered in one place. Deciding it twice is how `InlineName` and the
 * window keymap once disagreed about `Ctrl+K` — see CLAUDE.md.
 */
export function findShortcut(event: KeyboardEvent, isTyping: boolean): Shortcut | undefined {
  for (const shortcut of EDITOR_SHORTCUTS) {
    if (!shortcut.chords.some((chord) => matchesChord(event, chord))) continue
    if (isTyping && shortcut.whileTyping !== true) return undefined
    return shortcut
  }
  return undefined
}

/** Is the event aimed at something the user is typing into? */
export function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  )
}
