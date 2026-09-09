// Toolbar. Actions the user reaches for constantly, and nothing else.

import type { LodLevel } from '../../lib/lod'

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
  isDirty: boolean
  onAddEntity: () => void
  onAddRelationship: () => void
  onDeleteSelection: () => void
  onUndo: () => void
  onRedo: () => void
  onSetLodOverride: (level: LodLevel | undefined) => void
  onAutoLayout: () => void
  onExport: () => void
  onImport: () => void
  /** Rendered by the editor, which owns the diagram library. */
  diagramMenu: React.ReactNode
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

      <div className="erd-toolbar__group erd-toolbar__group--end">
        <span className="erd-status">
          {props.entityCount} {props.entityCount === 1 ? 'entity' : 'entities'} · showing{' '}
          {LOD_LABEL[shown].toLowerCase()}
        </span>
        {props.layoutError === undefined ? null : (
          <span className="erd-status erd-status--error" role="alert">
            {props.layoutError}
          </span>
        )}
        <span className="erd-status" data-dirty={props.isDirty || undefined}>
          {props.isDirty ? 'Saving…' : 'Saved'}
        </span>
      </div>
    </header>
  )
}
