/**
 * @vitest-environment node
 *
 * Chord matching and chord formatting (FR-9.1, NFR-3.2). No DOM — `matchesChord` reads
 * four fields off an event object, so the suite default is enough and a plain literal
 * stands in for the event.
 */
import { describe, expect, it } from 'vitest'

import { formatChord, matchesChord, type Chord } from '../../../src/lib'

/** Just the four fields `matchesChord` reads. */
function press(key: string, modifiers: { ctrl?: boolean; meta?: boolean; shift?: boolean } = {}) {
  return {
    key,
    ctrlKey: modifiers.ctrl ?? false,
    metaKey: modifiers.meta ?? false,
    shiftKey: modifiers.shift ?? false,
  } as KeyboardEvent
}

describe('matchesChord', () => {
  it('matches a bare key', () => {
    expect(matchesChord(press('e'), { key: 'e' })).toBe(true)
  })

  it('treats Command as Ctrl, because the app does', () => {
    // A Mac user presses ⌘Z and means undo. If the two were distinguished here the keymap
    // would work on one platform and be silently dead on the other.
    const undo: Chord = { key: 'z', ctrl: true, shift: false }

    expect(matchesChord(press('z', { ctrl: true }), undo)).toBe(true)
    expect(matchesChord(press('z', { meta: true }), undo)).toBe(true)
  })

  it('will not let a bare key be satisfied by a chord', () => {
    // Ctrl+E must not add an entity — it is the browser's, and on some builds it focuses
    // the address bar.
    expect(matchesChord(press('e', { ctrl: true }), { key: 'e' })).toBe(false)
  })

  it('will not let a chord be satisfied by the bare key', () => {
    expect(matchesChord(press('c'), { key: 'c', ctrl: true })).toBe(false)
  })

  it('separates Ctrl+Z from Ctrl+Shift+Z, which is the whole reason shift is matchable', () => {
    const undo: Chord = { key: 'z', ctrl: true, shift: false }
    const redo: Chord = { key: 'z', ctrl: true, shift: true }

    expect(matchesChord(press('z', { ctrl: true }), undo)).toBe(true)
    expect(matchesChord(press('z', { ctrl: true }), redo)).toBe(false)
    expect(matchesChord(press('z', { ctrl: true, shift: true }), undo)).toBe(false)
    expect(matchesChord(press('z', { ctrl: true, shift: true }), redo)).toBe(true)
  })

  it('ignores shift when the chord does not mention it', () => {
    // `?` IS Shift+/ on most layouts and is not on others, so `event.key` is the whole
    // answer and constraining shift either way would break one of them.
    expect(matchesChord(press('?', { shift: true }), { key: '?' })).toBe(true)
    expect(matchesChord(press('?'), { key: '?' })).toBe(true)
  })

  it('matches named keys case-insensitively', () => {
    expect(matchesChord(press('Delete'), { key: 'delete' })).toBe(true)
    expect(matchesChord(press('E'), { key: 'e' })).toBe(true)
  })
})

describe('formatChord', () => {
  it('writes the platform modifier', () => {
    const undo: Chord = { key: 'z', ctrl: true, shift: false }

    expect(formatChord(undo, { mac: false })).toBe('Ctrl+Z')
    expect(formatChord(undo, { mac: true })).toBe('⌘Z')
  })

  it('writes Shift only when the chord requires it', () => {
    // `shift: false` means "must not be held", not "show Shift" — printing it would teach
    // a key combination that does the opposite of what is wanted.
    expect(formatChord({ key: 'z', ctrl: true, shift: true }, { mac: false })).toBe('Ctrl+Shift+Z')
    expect(formatChord({ key: 'z', ctrl: true, shift: false }, { mac: false })).toBe('Ctrl+Z')
  })

  it('names the keys whose event.key nobody would recognise', () => {
    expect(formatChord({ key: 'Delete' }, { mac: false })).toBe('Del')
    expect(formatChord({ key: 'Escape' }, { mac: false })).toBe('Esc')
    expect(formatChord({ key: 'ArrowUp' }, { mac: false })).toBe('↑')
  })

  it('leaves a printable key as itself', () => {
    expect(formatChord({ key: '?' }, { mac: false })).toBe('?')
    expect(formatChord({ key: 'e' }, { mac: false })).toBe('E')
  })
})
