// The Ctrl+K surface: one box that searches the diagram and runs commands (FR-2.6, FR-9.2).
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY ONE LIST WITH TWO GROUPS, RATHER THAN A MODE
// ─────────────────────────────────────────────────────────────────────────────
//
// FR-9.2 asks for a palette that exposes every command AND doubles as the search entry
// point (FR-2.6). The usual way to fit both behind one input is a mode prefix — `>` for
// commands, bare text for search — which is a thing to learn before the feature works.
// Here the two corpora do not collide: commands are a hand-listed dozen with verb labels
// ("Auto-layout", "Undo"), and the diagram is table and field names. Matching both and
// showing them under two headings needs no prefix and no explanation, and the arrow keys
// walk one list across both.
//
// An empty query shows the commands. That is the honest answer to "what can I do here",
// and it is also why `fuzzyMatch` returns nothing for an empty query rather than matching
// everything — see the note there.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE ARIA PATTERN, AND THE THREE SCARS IT AVOIDS
// ─────────────────────────────────────────────────────────────────────────────
//
// This is a combobox controlling a listbox, which is the one pattern this project has
// already got wrong in three different ways (CLAUDE.md "Things that have gone wrong"):
//
//   * NOT `role="menu"`. A menu may not contain a textbox, and the one that did also made
//     its own buttons invisible to `getByRole('button')` — which is what a screen reader
//     experiences.
//   * The input's accessible name comes from `aria-label` alone. Hint text inside a
//     `<label>` joins the accessible name, which produced "RoleDistinguishes the two
//     ends…" the last time; for a combobox that string is the one thing read on focus.
//   * No `aria-modal`. `ui/Dialog` marks the rest of the page `aria-hidden` instead, which
//     is the mechanism that actually confines a screen reader; announcing a boundary
//     without a focus trap is worse than announcing nothing.
//
// Focus is moved with `aria-activedescendant` rather than by moving DOM focus, so the
// caret stays in the input while the arrow keys walk the options.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { Diagram } from '../../domain'
import { fuzzyMatch, type FuzzyMatch } from '../../lib/fuzzy'
import { Dialog } from '../../ui'
import { useGoToIssue } from '../validation-panel'

import { buildSearchRecords, searchRecords, type SearchHit, type SearchRecord } from './searchIndex'

/**
 * One command, as the palette needs it.
 *
 * `run` rather than a command id, because the Editor already owns every handler and
 * already knows what disables each one — a registry here would be a second list to keep in
 * step with the toolbar. `hint` and `disabled` are required rather than optional:
 * `exactOptionalPropertyTypes` is on, so an optional field would need a conditional spread
 * at all eleven construction sites.
 */
export interface PaletteCommand {
  id: string
  label: string
  /** The keyboard shortcut, shown right-aligned. `undefined` where there is not one. */
  hint: string | undefined
  disabled: boolean
  run: () => void
}

export interface CommandPaletteProps {
  diagram: Diagram
  commands: readonly PaletteCommand[]
  onClose: () => void
}

type PaletteItem =
  | { key: string; kind: 'command'; command: PaletteCommand }
  | { key: string; kind: 'record'; hit: SearchHit }

const RESULT_LIMIT = 20

export function CommandPalette(props: CommandPaletteProps): React.ReactElement {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const goTo = useGoToIssue()

  /*
   * Keyed on the two ARRAYS, not on `diagram`.
   *
   * Immer's structural sharing means a position-only command — a drag frame, a layout —
   * hands back a new `diagram` object holding the SAME `entities` array. Depending on
   * `diagram` would rebuild every record on every frame of a drag; depending on the arrays
   * rebuilds only when a name could actually have changed. Canvas memoises
   * `foreignKeyTargets` on `diagram.entities` for the same measured reason.
   */
  const records = useMemo(
    () => buildSearchRecords(props.diagram.entities, props.diagram.relationships),
    [props.diagram.entities, props.diagram.relationships],
  )

  const items = useMemo<PaletteItem[]>(() => {
    // An empty query lists every command — that is the honest answer to "what can I do
    // here". A non-empty one matches on the label with the same matcher the diagram uses,
    // so `al` finds "Auto-layout" the same way `col` finds `customer_order_line`.
    const commands = props.commands
      .filter((command) => query.trim() === '' || fuzzyMatch(query, command.label) !== undefined)
      .map<PaletteItem>((command) => ({ key: `command:${command.id}`, kind: 'command', command }))

    if (query.trim() === '') return commands

    // Diagram FIRST once there is a query. Someone typing into a schema search box is
    // usually looking for a table, and there are hundreds of those against a dozen
    // commands — leading with the commands would push the likely answer below the fold.
    const hits = searchRecords(records, query, RESULT_LIMIT).map<PaletteItem>((hit) => ({
      key: `record:${recordKey(hit.record)}`,
      kind: 'record',
      hit,
    }))
    return [...hits, ...commands]
  }, [props.commands, records, query])

  const enabled = useMemo(
    () => items.filter((item) => item.kind === 'record' || !item.command.disabled),
    [items],
  )

  // A new query means a new list, so the cursor goes back to the top rather than pointing
  // at whatever now happens to sit at the old index. Derived during render rather than
  // set from an effect — `setState` in an effect is two recorded races in this codebase.
  const activeIndex = Math.min(active, Math.max(0, enabled.length - 1))
  const activeItem = enabled[activeIndex]

  const activate = useCallback(
    (item: PaletteItem | undefined) => {
      if (item === undefined) return
      if (item.kind === 'command') {
        if (item.command.disabled) return
        item.command.run()
      } else {
        goTo(item.hit.record.target)
      }
      props.onClose()
    },
    [goTo, props],
  )

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActive((index) => Math.min(index + 1, Math.max(0, enabled.length - 1)))
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActive((index) => Math.max(index - 1, 0))
        return
      }
      if (event.key === 'Home') {
        event.preventDefault()
        setActive(0)
        return
      }
      if (event.key === 'End') {
        event.preventDefault()
        setActive(Math.max(0, enabled.length - 1))
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        activate(activeItem)
      }
    },
    [enabled.length, activate, activeItem],
  )

  // Keep the active option in view. The listbox is its own scroll container rather than
  // letting `.erd-modal__panel` scroll, because the panel scrolling would take the dialog
  // title and its Close button off screen with it.
  useEffect(() => {
    if (activeItem === undefined) return
    const option = listRef.current?.querySelector(`[data-key="${CSS.escape(activeItem.key)}"]`)
    // Feature-detected, not assumed. `scrollIntoView` is layout, and jsdom performs none —
    // it does not implement the method at all, so calling it unguarded throws during the
    // passive effect and takes the whole palette down with it. A DOM this thin only turns
    // up in tests today, but "the environment has no layout" is exactly the condition this
    // effect has nothing useful to do in anyway.
    if (typeof option?.scrollIntoView === 'function') option.scrollIntoView({ block: 'nearest' })
  }, [activeItem])

  const listboxId = 'erd-palette-listbox'

  return (
    <Dialog title="Search and commands" onClose={props.onClose} narrow initialFocus={inputRef}>
      <div className="erd-palette">
        <input
          ref={inputRef}
          className="erd-palette__input"
          type="text"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)
          }}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-label="Search tables, fields and relationships, or run a command"
          {...(activeItem === undefined ? {} : { 'aria-activedescendant': optionId(activeItem) })}
          placeholder="Search tables and fields, or run a command…"
        />

        {items.length === 0 ? (
          <p className="erd-palette__empty">No tables, fields or commands match that.</p>
        ) : (
          /* Divs with explicit roles rather than ul/li: a listbox may contain options and
             groups, and nothing else. The first version put the group headings in
             `aria-hidden` <li>s, which is the same shape of mistake as the `role="menu"`
             that once wrapped a textbox — markup whose implicit semantics fight the roles
             written on top of them. */
          <div className="erd-palette__list" id={listboxId} role="listbox" ref={listRef}>
            {groupsOf(items).map((group) => (
              <div className="erd-palette__group" key={group.label} role="group" aria-label={group.label}>
                <div className="erd-palette__heading" aria-hidden="true">
                  {group.label}
                </div>
                {group.items.map((item) => (
                  <Option
                    key={item.key}
                    item={item}
                    isActive={activeItem?.key === item.key}
                    onActivate={activate}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  )
}

/** Partition the flat row list into its two labelled groups, preserving order. */
function groupsOf(items: readonly PaletteItem[]): { label: string; items: PaletteItem[] }[] {
  const groups: { label: string; items: PaletteItem[] }[] = []
  for (const item of items) {
    const label = item.kind === 'command' ? 'Commands' : 'Diagram'
    const last = groups.at(-1)
    if (last?.label === label) last.items.push(item)
    else groups.push({ label, items: [item] })
  }
  return groups
}

function optionId(item: PaletteItem): string {
  return `erd-palette-option-${item.key.replace(/[^\w-]/g, '_')}`
}

function recordKey(record: SearchRecord): string {
  switch (record.target.kind) {
    case 'entity':
      return `entity:${record.target.entityId}`
    case 'attribute':
      return `attribute:${record.target.entityId}/${record.target.attributeId}`
    case 'relationship':
      return `relationship:${record.target.relationshipId}`
  }
}

interface OptionProps {
  item: PaletteItem
  isActive: boolean
  onActivate: (item: PaletteItem) => void
}

function Option({ item, isActive, onActivate }: OptionProps): React.ReactElement {
  const disabled = item.kind === 'command' && item.command.disabled

  return (
    <div
        id={optionId(item)}
        data-key={item.key}
        className="erd-palette__option"
        role="option"
        aria-selected={isActive}
        aria-disabled={disabled}
        data-active={isActive || undefined}
        data-disabled={disabled || undefined}
        onClick={() => {
          onActivate(item)
        }}
      >
        {item.kind === 'command' ? (
          <>
            <span className="erd-palette__label">{item.command.label}</span>
            {item.command.hint === undefined ? null : (
              <kbd className="erd-palette__hint">{item.command.hint}</kbd>
            )}
          </>
        ) : (
          <>
            <span className="erd-palette__label">
              <Highlighted text={item.hit.record.name} match={item.hit.match} />
            </span>
            <span className="erd-palette__meta">{secondaryOf(item.hit.record)}</span>
          </>
        )}
    </div>
  )
}

/** FR-2.6: an attribute result says which entity it belongs to. */
function secondaryOf(record: SearchRecord): string {
  switch (record.kind) {
    case 'entity':
      return 'Table'
    case 'attribute':
      return record.entityName
    case 'relationship':
      return record.between
  }
}

/** The matched characters, marked. Positions come from the matcher, ascending. */
function Highlighted({ text, match }: { text: string; match: FuzzyMatch }): React.ReactElement {
  /*
   * Split into RUNS rather than per character.
   *
   * One element per character would be ~20 DOM nodes per row and 400 for a full list, for
   * a highlight. It also spreads the string, which splits surrogate pairs — a name with an
   * emoji or a non-BMP character would come apart. Slicing by run keeps whole code points
   * together and emits at most a handful of nodes.
   */
  const marked = new Set(match.positions)
  const runs: { text: string; hit: boolean }[] = []
  for (let index = 0; index < text.length; index++) {
    const hit = marked.has(index)
    const last = runs.at(-1)
    if (last !== undefined && last.hit === hit) last.text += text.charAt(index)
    else runs.push({ text: text.charAt(index), hit })
  }

  return (
    <>
      {runs.map((run, index) =>
        run.hit ? (
          <mark key={`${String(index)}:${run.text}`}>{run.text}</mark>
        ) : (
          <span key={`${String(index)}:${run.text}`}>{run.text}</span>
        ),
      )}
    </>
  )
}
