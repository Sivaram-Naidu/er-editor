/**
 * @vitest-environment jsdom
 *
 * The shortcut table, and the sheet that renders it (FR-9.1, NFR-3.2).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS WORTH TESTING HERE, AND WHAT IS NOT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Most of the drift this feature could suffer is already impossible by construction, and
 * it is worth saying which, so nobody adds a test that can only ever pass:
 *
 *   - The sheet cannot print a key the keymap does not test for: both read the same
 *     `Chord` object, through `formatChord` and `matchesChord`.
 *   - A shortcut cannot exist with no handler, or a handler with no shortcut: `Editor.tsx`
 *     builds a `Record<ShortcutId, () => void>` and TypeScript checks it exhaustively.
 *
 * What is left, and what these tests are for, is the part types cannot see: two entries
 * claiming the same chord (the second is unreachable, and it fails as a missing feature
 * rather than as an error), the typing guard, and whether the sheet actually renders every
 * row rather than dropping a group.
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import {
  EDITOR_SHORTCUTS,
  SHORTCUT_GROUPS,
  ShortcutsDialog,
  findShortcut,
  isTypingTarget,
} from '../../../src/features/editor'
import { formatChord, matchesChord } from '../../../src/lib'

function press(key: string, modifiers: { ctrl?: boolean; shift?: boolean } = {}) {
  return {
    key,
    ctrlKey: modifiers.ctrl ?? false,
    metaKey: false,
    shiftKey: modifiers.shift ?? false,
  } as KeyboardEvent
}

describe('the shortcut table (FR-9.1)', () => {
  it('has no two entries claiming the same chord', () => {
    /*
     * THE ONE FAILURE TYPES CANNOT CATCH.
     *
     * `findShortcut` returns the first entry that matches, so a duplicate chord makes the
     * later one dead — and it fails as "that shortcut does nothing", weeks later, rather
     * than as an error. It is an easy mistake to make from this file alone: `Ctrl+Z` and
     * `Ctrl+Shift+Z` differ only by a field that is optional and defaults to "don't care".
     */
    const seen = new Map<string, string[]>()
    for (const shortcut of EDITOR_SHORTCUTS) {
      for (const chord of shortcut.chords) {
        const key = `${chord.key.toLowerCase()}|${String(chord.ctrl ?? false)}|${String(chord.shift)}`
        seen.set(key, [...(seen.get(key) ?? []), shortcut.label])
      }
    }

    const clashes = [...seen.entries()].filter(([, labels]) => labels.length > 1)
    expect(
      clashes,
      `these share a chord, and only the first of each works: ${JSON.stringify(clashes)}`,
    ).toEqual([])
  })

  it('never lets a modified key shadow the bare one', () => {
    // Ctrl+E is the browser's; only `E` is ours. A chord that left `ctrl` unconstrained
    // would quietly claim both.
    for (const shortcut of EDITOR_SHORTCUTS) {
      for (const chord of shortcut.chords) {
        expect(matchesChord(press(chord.key, { ctrl: !(chord.ctrl ?? false) }), chord)).toBe(false)
      }
    }
  })

  it('puts every entry in a group the sheet renders', () => {
    // A typo'd group is not a type error — `ShortcutGroup` is a union of the same
    // constant — but it IS a row that silently never appears.
    for (const shortcut of EDITOR_SHORTCUTS) {
      expect(SHORTCUT_GROUPS, `"${shortcut.label}" is in a group nothing renders`).toContain(
        shortcut.group,
      )
    }
  })

  it('separates undo from redo, in the order it actually dispatches', () => {
    expect(findShortcut(press('z', { ctrl: true }), false)?.id).toBe('undo')
    expect(findShortcut(press('z', { ctrl: true, shift: true }), false)?.id).toBe('redo')
    expect(findShortcut(press('y', { ctrl: true }), false)?.id).toBe('redo')
  })

  it('stands every bare key down while the user is typing', () => {
    expect(findShortcut(press('e'), true)).toBeUndefined()
    expect(findShortcut(press('?'), true)).toBeUndefined()
    expect(findShortcut(press('Delete'), true)).toBeUndefined()
    expect(findShortcut(press('c', { ctrl: true }), true)).toBeUndefined()
  })

  it('keeps Ctrl+K alive while typing, and it is the only one', () => {
    // The palette has to be reachable from the inspector and the diagram-name field.
    expect(findShortcut(press('k', { ctrl: true }), true)?.id).toBe('palette')

    const alwaysOn = EDITOR_SHORTCUTS.filter((shortcut) => shortcut.whileTyping === true)
    expect(alwaysOn.map((shortcut) => shortcut.id)).toEqual(['palette'])
  })

  it('reports the arrow keys without claiming them', () => {
    // Documented, not bound: React Flow moves a focused node and this app must let the
    // key through. The marker is the absent id, which is what stops `Editor.tsx` calling
    // `preventDefault`.
    const arrows = findShortcut(press('ArrowUp'), false)

    expect(arrows).toBeDefined()
    expect(arrows?.id).toBeUndefined()
  })

  it('lets Escape through to anything else listening for it', () => {
    expect(findShortcut(press('Escape'), false)?.preventDefault).toBe(false)
  })
})

describe('isTypingTarget', () => {
  it('is true for the three elements someone types into', () => {
    for (const tag of ['input', 'textarea', 'select']) {
      expect(isTypingTarget(document.createElement(tag))).toBe(true)
    }
  })

  it('is true for a contenteditable, which the inline rename uses', () => {
    const element = document.createElement('div')
    element.contentEditable = 'true'
    // jsdom does not derive `isContentEditable` from the attribute.
    Object.defineProperty(element, 'isContentEditable', { value: true })

    expect(isTypingTarget(element)).toBe(true)
  })

  it('is false for the canvas and for nothing at all', () => {
    expect(isTypingTarget(document.createElement('div'))).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
  })
})

describe('ShortcutsDialog (FR-9.1)', () => {
  afterEach(() => {
    cleanup()
  })

  /**
   * THE PAIR TEST.
   *
   * Not "the dialog renders some rows" — that passes on a sheet missing half the keymap.
   * Every chord in the table has to appear in the DOM, formatted the way `formatChord`
   * formats it, which is the same call the palette's hints make and one reading of the
   * same object the keymap matches with. Drop a group from the render, misspell a group
   * name, or add a shortcut without a home and this fails by name.
   */
  it('shows every chord in the table, and nothing else', () => {
    render(<ShortcutsDialog onClose={() => undefined} />)

    const expected = EDITOR_SHORTCUTS.flatMap((shortcut) =>
      shortcut.chords.map((chord) => formatChord(chord, { mac: false })),
    ).sort()

    const shown = screen
      .getAllByText((_, element) => element?.tagName === 'KBD')
      .map((element) => element.textContent ?? '')
      .sort()

    expect(shown).toEqual(expected)
  })

  it('files each shortcut under its own heading', () => {
    render(<ShortcutsDialog onClose={() => undefined} />)

    for (const group of SHORTCUT_GROUPS) {
      const section = screen.getByRole('heading', { name: group }).closest('section')
      expect(section, `no section for "${group}"`).not.toBeNull()

      for (const shortcut of EDITOR_SHORTCUTS.filter((entry) => entry.group === group)) {
        expect(within(section!).getByText(shortcut.label)).toBeInTheDocument()
      }
    }
  })

  it('is a real dialog, so the focus trap and Escape come with it', () => {
    render(<ShortcutsDialog onClose={() => undefined} />)

    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument()
  })
})
