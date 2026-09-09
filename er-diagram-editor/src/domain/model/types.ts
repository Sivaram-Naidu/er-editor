// IR types: Diagram, Entity, Attribute, Relationship, Participant (SRS §3).
//
// Every type here is INFERRED from the Zod schema rather than declared by hand. That is
// deliberate: a hand-written type and a schema drift apart silently, and the drift is
// only discovered when a file that parsed fine fails to render. `schema.ts` is the
// single source of truth; this file is a typed view onto it.
//
// Two flavours exist for the composite schemas:
//
//   `Diagram`      — the OUTPUT type. Defaults applied, so `layout.positions` is
//                    guaranteed present. This is what the app works with.
//   `DiagramInput` — the INPUT type. Defaulted fields are optional. This is what a
//                    caller may hand to `DiagramSchema.parse()`, and what a
//                    hand-written or third-party `.erd.json` is allowed to contain.
//
// Use `Diagram` almost everywhere. Reach for `DiagramInput` only at a parse boundary.

import type { z } from 'zod'

import type {
  AttributeSchema,
  CardinalitySchema,
  DiagramMetaSchema,
  DiagramSchema,
  EntityKindSchema,
  EntitySchema,
  ForeignKeyRefSchema,
  GroupSchema,
  LayoutStateSchema,
  NotationSchema,
  ParticipantSchema,
  ParticipationSchema,
  PointSchema,
  RelationshipKindSchema,
  RelationshipSchema,
  SpecializationSchema,
  ViewportSchema,
} from './schema'
import type {
  AttributeIdSchema,
  DiagramIdSchema,
  EntityIdSchema,
  GroupIdSchema,
  RelationshipIdSchema,
} from './schema'

// ── Identifiers ──────────────────────────────────────────────────────────────
//
// Branded. `EntityId` and `AttributeId` are both strings at runtime but are not
// interchangeable at compile time, which is what protects `ForeignKeyRef` from a
// silent transposition.

export type DiagramId = z.infer<typeof DiagramIdSchema>
export type EntityId = z.infer<typeof EntityIdSchema>
export type AttributeId = z.infer<typeof AttributeIdSchema>
export type RelationshipId = z.infer<typeof RelationshipIdSchema>
export type GroupId = z.infer<typeof GroupIdSchema>

// ── Enumerations ─────────────────────────────────────────────────────────────

export type EntityKind = z.infer<typeof EntityKindSchema>
export type RelationshipKind = z.infer<typeof RelationshipKindSchema>
export type Cardinality = z.infer<typeof CardinalitySchema>
export type Participation = z.infer<typeof ParticipationSchema>
export type Notation = z.infer<typeof NotationSchema>

// ── Model ────────────────────────────────────────────────────────────────────

export type ForeignKeyRef = z.infer<typeof ForeignKeyRefSchema>
export type Attribute = z.infer<typeof AttributeSchema>
export type Specialization = z.infer<typeof SpecializationSchema>
export type Entity = z.infer<typeof EntitySchema>
export type Participant = z.infer<typeof ParticipantSchema>
export type Relationship = z.infer<typeof RelationshipSchema>
export type Group = z.infer<typeof GroupSchema>

// ── Layout and metadata ──────────────────────────────────────────────────────

export type Point = z.infer<typeof PointSchema>
export type Viewport = z.infer<typeof ViewportSchema>
export type LayoutState = z.infer<typeof LayoutStateSchema>
export type DiagramMeta = z.infer<typeof DiagramMetaSchema>

// ── Diagram ──────────────────────────────────────────────────────────────────

export type Diagram = z.infer<typeof DiagramSchema>

// ── Parse-boundary input types ───────────────────────────────────────────────

export type AttributeInput = z.input<typeof AttributeSchema>
export type EntityInput = z.input<typeof EntitySchema>
export type RelationshipInput = z.input<typeof RelationshipSchema>
export type DiagramInput = z.input<typeof DiagramSchema>
