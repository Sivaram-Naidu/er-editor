// Command interface { apply, invert, label, coalesceWith? } - the undo unit (FR-7.1).
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY COMMANDS DESCRIBE A MUTATION RATHER THAN IMPLEMENTING BOTH DIRECTIONS
// ─────────────────────────────────────────────────────────────────────────────
//
// SRS §8 sketches `{ apply, invert }`. In practice a hand-written `invert` per command
// is the wrong shape: it duplicates knowledge of the model in two places, and the
// duplication is asymmetric — `deleteEntity` has to remember the entity, every
// relationship that referenced it, every foreign key that pointed at it, and its layout
// position, purely so it can put them all back.
//
// Immer's `produceWithPatches` derives the inverse mechanically from what the mutation
// actually touched. So a command supplies only `mutate(draft)`, and `CommandStack`
// records both the forward and inverse patch sets. The `invert` half of the SRS
// interface still exists — it is just computed rather than written, which is strictly
// more reliable, and it is what makes cascade delete undoable without a bespoke
// resurrection routine.
//
// This also honours ADR-0003's memory argument. A patch set records only the paths that
// changed, so a 100-step history over a 120-entity diagram costs a few kilobytes rather
// than 100 full snapshots.

import type { Draft } from 'immer'

import type { Diagram } from '../model/types'

/**
 * A single semantic edit.
 *
 * Commands are plain descriptors, not stateful objects: constructing one performs no
 * work and holds no reference to a diagram, so the same command can be applied to
 * different states and is safe to log, queue, or serialise.
 */
export interface Command {
  /** Stable machine-readable discriminator, e.g. `entity.rename`. Used for coalescing. */
  readonly type: string

  /**
   * Human-readable, shown in the undo/redo tooltip. Phrased as the action performed —
   * "Rename entity", not "Renamed entity" — so it reads correctly after "Undo".
   */
  readonly label: string

  /**
   * When set, consecutive commands sharing this key inside the coalescing window merge
   * into one history entry (FR-7.1: "compound operations undo as one step").
   *
   * The key must identify the SUBJECT, not just the action: dragging entity A then
   * entity B should be two undo steps, so the key includes the entity id. Continuous
   * gestures — dragging, typing into a name field — are what this is for.
   */
  readonly coalesceKey?: string

  /**
   * Mutate the draft in place. Must be deterministic and side-effect free: it may run
   * more than once, and anything non-deterministic inside it (a fresh id, a timestamp)
   * would make undo/redo asymmetric. Generate ids with the factories BEFORE building
   * the command, and pass them in.
   */
  mutate(draft: Draft<Diagram>): void
}

/** Convenience constructor so command modules stay declarative. */
export function defineCommand(command: Command): Command {
  return command
}
