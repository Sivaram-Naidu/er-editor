# ADR 0003 - Command pattern for undo/redo

**Status:** accepted (SRS S6.2)

**Decision:** a hand-rolled command stack in `src/domain/commands/` rather than a
generic state-snapshot undo library.

**Rationale:** snapshotting a 120-entity model 100 times is expensive and produces bad
granularity - a single drag yields hundreds of intermediate states. Commands give
semantic steps, cheap storage, drag coalescing, and compound transactions (FR-7.1).

**Secondary benefit:** if the V1 no-collaboration decision is ever reversed, commands
are the natural transport unit.
