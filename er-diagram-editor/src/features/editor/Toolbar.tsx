// Toolbar. Actions the user reaches for constantly, and nothing else.

import type { LodLevel } from '../../lib/lod'

import { ISOLATE_DEPTHS, isolateLabel } from './isolateOptions'
import { ThemeToggle } from './ThemeToggle'

export interface ToolbarProps {
  canUndo: boolean
  canRedo: boolean
  undoLabel: string | undefined
  redoLabel: string | undefined
  entityCount: number
  selectedCount: number
  /** Only entities can be connected, so the relationship button watches this. */
  selectedEntityCount: number
  lod: LodLevel
  lodOverride: LodLevel | undefined
  /** Hop radius for isolate mode; `undefined` is off (FR-2.8). */
  isolateDepth: number | undefined
  /**
   * How many entities the canvas is actually drawing, when that is fewer than all of
   * them. `undefined` means all of them, which is the ordinary case.
   */
  isolatedCount: number | undefined
  isDirty: boolean
  /** Set when the last autosave failed; replaces the save indicator with the reason. */
  saveError: string | undefined
  onAddEntity: () => void
  onAddRelationship: () => void
  onDeleteSelection: () => void
  onUndo: () => void
  onRedo: () => void
  onSetLodOverride: (level: LodLevel | undefined) => void
  onSetIsolateDepth: (depth: number | undefined) => void
  onAutoLayout: () => void
  onExport: () => void
  onImport: () => void
  /** Rendered by the editor, which owns the diagram library. */
  diagramMenu: React.ReactNode
  /**
   * The issues button and its badge (FR-8.4).
   *
   * A node rather than a count plus a handler, for the same reason as `diagramMenu`: the
   * toolbar's job is to find somewhere to put this, not to know what a validation report
   * is.
   */
  validationToggle: React.ReactNode
  /**
   * The snap-to-grid toggle (FR-3.5). A node for the same reason as the two above: it
   * owns a preference, and the toolbar has no business knowing that preferences persist.
   */
  snapToggle: React.ReactNode
  /**
   * Opens the shortcut reference (FR-9.1).
   *
   * A visible button as well as the `?` key, because a reference that can only be reached
   * by a shortcut is only useful to someone who already knows the shortcuts.
   */
  onShowShortcuts: () => void
  isLayingOut: boolean
  layoutError: string | undefined
}

const LOD_LABEL: Record<LodLevel, string> = {
  0: 'Names',
  1: 'Keys',
  2: 'All fields',
}

export function Toolbar(props: ToolbarProps): React.ReactElement {
  const shown = props.lodOverride ?? props.lod

  return (
    <header className="erd-toolbar">
      <div className="erd-toolbar__group">
        {/* The product name is a visually-hidden h1: the page needs a heading, but the
            document's own title is the more useful thing to give that space to. */}
        <h1 className="erd-visually-hidden">ER Diagram Editor</h1>
        {props.diagramMenu}
      </div>

      <div className="erd-toolbar__group">
        <button type="button" className="erd-btn" onClick={props.onAddEntity}>
          Add entity
        </button>
        <button
          type="button"
          className="erd-btn"
          onClick={props.onAddRelationship}
          disabled={props.selectedEntityCount !== 2}
          /* Enabled only with exactly two selected, because a relationship needs two
             ends. The title says so rather than leaving a dead button unexplained. */
          title={
            props.selectedEntityCount === 2
              ? 'Connect the two selected entities'
              : 'Select two entities, or drag from the dot on one table to another'
          }
        >
          Add relationship
        </button>
        <button
          type="button"
          className="erd-btn"
          onClick={props.onDeleteSelection}
          disabled={props.selectedCount === 0}
        >
          Delete
        </button>
      </div>

      <div className="erd-toolbar__group">
        <button type="button" className="erd-btn" onClick={props.onImport}>
          Open file
        </button>
        <button type="button" className="erd-btn" onClick={props.onExport}>
          Export
        </button>
      </div>

      <div className="erd-toolbar__group">
        <button
          type="button"
          className="erd-btn"
          onClick={props.onAutoLayout}
          disabled={props.isLayingOut || props.entityCount < 2}
          title={
            props.entityCount < 2
              ? 'Add a second entity to arrange them'
              : 'Arrange every entity, minimising crossings'
          }
        >
          {props.isLayingOut ? 'Arranging…' : 'Auto-layout'}
        </button>
      </div>

      <div className="erd-toolbar__group">
        <button
          type="button"
          className="erd-btn"
          onClick={props.onUndo}
          disabled={!props.canUndo}
          title={props.undoLabel === undefined ? 'Nothing to undo' : `Undo ${props.undoLabel}`}
        >
          Undo
        </button>
        <button
          type="button"
          className="erd-btn"
          onClick={props.onRedo}
          disabled={!props.canRedo}
          title={props.redoLabel === undefined ? 'Nothing to redo' : `Redo ${props.redoLabel}`}
        >
          Redo
        </button>
      </div>

      <div className="erd-toolbar__group">
        <label className="erd-field">
          Detail
          <select
            className="erd-select"
            value={props.lodOverride === undefined ? 'auto' : String(props.lodOverride)}
            onChange={(event) => {
              const { value } = event.target
              props.onSetLodOverride(value === 'auto' ? undefined : (Number(value) as LodLevel))
            }}
          >
            <option value="auto">Follow zoom ({LOD_LABEL[props.lod]})</option>
            <option value="0">{LOD_LABEL[0]}</option>
            <option value="1">{LOD_LABEL[1]}</option>
            <option value="2">{LOD_LABEL[2]}</option>
          </select>
        </label>
      </div>

      <div className="erd-toolbar__group">
        <label className="erd-field">
          Isolate
          <select
            className="erd-select"
            value={props.isolateDepth === undefined ? 'off' : String(props.isolateDepth)}
            onChange={(event) => {
              const { value } = event.target
              props.onSetIsolateDepth(value === 'off' ? undefined : Number(value))
            }}
            /* Stays enabled with nothing selected, so the mode can always be turned back
               off. What it does in that state — nothing, until a table is picked — is said
               by the status line rather than by greying out the escape route. */
            title={
              props.selectedEntityCount === 0
                ? 'Select a table, then isolate around it'
                : 'Show only what is within this many hops of the selection'
            }
          >
            <option value="off">Off</option>
            {ISOLATE_DEPTHS.map((depth) => (
              <option key={depth} value={String(depth)}>
                {isolateLabel(depth)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="erd-toolbar__group">
        {props.snapToggle}
        <ThemeToggle />
      </div>

      <div className="erd-toolbar__group">
        {props.validationToggle}
        <button
          type="button"
          className="erd-btn"
          onClick={props.onShowShortcuts}
          /* The glyph is the label a user recognises; the accessible name is the sentence
             a screen reader needs, because "?" read aloud is nothing (NFR-4.4). */
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts (?)"
        >
          ?
        </button>
      </div>

      <div className="erd-toolbar__group erd-toolbar__group--end">
        <span className="erd-status">
          {/* "3 of 120 entities" while isolating. The denominator is the point: a focus
              mode that narrows the canvas without saying how much it removed is
              indistinguishable from a schema that is smaller than you thought. */}
          {props.isolatedCount === undefined
            ? `${String(props.entityCount)} ${props.entityCount === 1 ? 'entity' : 'entities'}`
            : `${String(props.isolatedCount)} of ${String(props.entityCount)} entities`}{' '}
          · showing {LOD_LABEL[shown].toLowerCase()}
          {props.isolateDepth !== undefined && props.selectedEntityCount === 0
            ? ' · select a table to isolate'
            : ''}
        </span>
        {props.layoutError === undefined ? null : (
          <span className="erd-status erd-status--error" role="alert">
            {props.layoutError}
          </span>
        )}
        {/* The failure replaces the indicator rather than sitting beside it. "Saving…"
            next to "could not save" reads as a transient hiccup, which is the one
            impression that must not be given here. */}
        {props.saveError === undefined ? (
          <span className="erd-status" data-dirty={props.isDirty || undefined}>
            {props.isDirty ? 'Saving…' : 'Saved'}
          </span>
        ) : (
          <span className="erd-status erd-status--error" role="alert" title={props.saveError}>
            Not saved — {props.saveError}
          </span>
        )}
      </div>
    </header>
  )
}
