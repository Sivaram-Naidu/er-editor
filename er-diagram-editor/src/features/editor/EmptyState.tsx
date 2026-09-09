// An empty canvas is an invitation to act, not a shrug.

export interface EmptyStateProps {
  onAddEntity: () => void
  onLoadSample: () => void
}

export function EmptyState(props: EmptyStateProps): React.ReactElement {
  return (
    <div className="erd-empty">
      <p className="erd-empty__lead">Start with a table.</p>
      <p className="erd-empty__body">
        Add an entity, give it a name and some fields, then select two entities to connect them.
      </p>
      <div className="erd-empty__actions">
        {/* Deliberately not "Add entity", which is what the toolbar button says. On an
            empty canvas this is the first thing anyone does, so it names the step rather
            than repeating the generic action. */}
        <button type="button" className="erd-btn erd-btn--primary" onClick={props.onAddEntity}>
          Add your first entity
        </button>
        <button type="button" className="erd-btn" onClick={props.onLoadSample}>
          Open the sample schema
        </button>
      </div>
    </div>
  )
}
