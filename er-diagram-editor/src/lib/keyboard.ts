// Matching and formatting a keyboard chord (FR-9.1, NFR-3.2).
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY MATCHING AND FORMATTING ARE ONE FILE
// ─────────────────────────────────────────────────────────────────────────────
//
// Because they must not be able to disagree. A shortcut reference is a second description
// of behaviour that lives somewhere else, and the failure mode is silent: the sheet says
// `Ctrl+Y` while the keymap tests for `Ctrl+U`, and nothing breaks, nothing throws, and
// nobody finds out until a user tries it.
//
// So there is one description — a `Chord` — and `matchesChord` and `formatChord` are two
// readings of it. The sheet cannot print a chord the keymap does not test for, because it
// is printing the object the keymap tests with. That is also why this is `lib` rather than
// a helper beside the dialog: the keymap, the sheet and the command palette's hints all
// read the same objects, and the leaf layer is where something three features share
// belongs.

/** Ctrl on Windows and Linux, Command on a Mac — this app treats them as one key. */
export interface Chord {
  /** `event.key`, matched case-insensitively: `'e'`, `'Delete'`, `'?'`, `'ArrowUp'`. */
  key: string
  ctrl?: boolean
  /**
   * `undefined` means "don't care", and that is the right default rather than an
   * oversight.
   *
   * For a printable key the CHARACTER already encodes Shift — `?` is Shift+/ on most
   * layouts, so requiring `shift: false` would make it unmatchable and requiring
   * `shift: true` would break the layouts where it is not. Where the distinction is real
   * it is stated: `Ctrl+Z` is `shift: false` precisely so that `Ctrl+Shift+Z` falls
   * through it to redo.
   */
  shift?: boolean
}

export function matchesChord(event: KeyboardEvent, chord: Chord): boolean {
  if (event.key.toLowerCase() !== chord.key.toLowerCase()) return false
  if (event.ctrlKey || event.metaKey ? chord.ctrl !== true : chord.ctrl === true) return false
  if (chord.shift !== undefined && event.shiftKey !== chord.shift) return false
  return true
}

/**
 * Keys whose `event.key` is not what a person would recognise on the sheet.
 *
 * Anything not listed falls through to the key itself, upper-cased — which is right for
 * every letter and digit, and for `?`.
 */
const KEY_LABELS: Record<string, string> = {
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  backspace: 'Backspace',
  delete: 'Del',
  escape: 'Esc',
  enter: 'Enter',
  ' ': 'Space',
}

export interface ChordFormat {
  /** Mac writes ⌘⇧Z with no separators; everything else writes Ctrl+Shift+Z. */
  mac: boolean
}

export function formatChord(chord: Chord, format: ChordFormat): string {
  const parts: string[] = []
  if (chord.ctrl === true) parts.push(format.mac ? '⌘' : 'Ctrl')
  if (chord.shift === true) parts.push(format.mac ? '⇧' : 'Shift')
  parts.push(KEY_LABELS[chord.key.toLowerCase()] ?? chord.key.toUpperCase())

  return parts.join(format.mac ? '' : '+')
}

/**
 * Is this a Mac, for the purpose of naming the modifier key?
 *
 * A runtime check rather than a type-level one: `navigator.userAgentData` is absent in
 * Firefox, Safari and jsdom, and `navigator.platform` is deprecated but is the only thing
 * present everywhere. Both are wrapped, because the answer only decides whether the sheet
 * says `Ctrl` or `⌘` — the keymap already accepts either key — so an unknowable platform
 * is not an error, it is `false`.
 */
export function isMacPlatform(): boolean {
  const agent = navigator as Navigator & { userAgentData?: { platform?: string } }
  const platform = agent.userAgentData?.platform ?? navigator.platform
  return /mac/i.test(platform)
}
