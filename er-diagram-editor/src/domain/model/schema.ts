// Zod schemas; source of truth from which types.ts is inferred (SRS §3).
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT THIS FILE IS RESPONSIBLE FOR — AND WHAT IT IS NOT
// ─────────────────────────────────────────────────────────────────────────────
//
// These schemas validate STRUCTURAL correctness: is this a well-formed diagram
// document? They run on every `.erd.json` load, where the input is untrusted
// (NFR-7.2), and they are the contract the format is versioned against (NFR-5.6).
//
// They deliberately do NOT enforce MODELLING quality. An entity with no primary
// key, a duplicate entity name, an orphan entity, an empty element name — all of
// these parse successfully here and are reported by `src/domain/validation/`
// instead (FR-8.2, FR-8.3).
//
// The split matters because the editor must be able to hold a half-finished model.
// FR-1.1 puts a new entity straight into inline name-edit, so an empty name is a
// legitimate intermediate state. If the schema rejected it, the store could not
// represent what the user is looking at. Structural violations, by contrast — a
// relationship pointing at an entity that does not exist — are never a legitimate
// intermediate state and are rejected here.
//
// ─────────────────────────────────────────────────────────────────────────────
// `.default()` VS `.prefault()` — THE RULE, AND WHY EACH FIELD PICKS ONE
// ─────────────────────────────────────────────────────────────────────────────
//
// Zod 4 changed `.default()`. The default value now SHORT-CIRCUITS parsing and is
// returned as-is; it is never validated and nested defaults inside it never run.
// `.prefault()` restores the Zod 3 behaviour: the value is fed through the parser.
//
// Verified against zod 4.5.4:
//
//     z.string().min(3).default('xx')   → parses {} successfully, yields 'xx'
//                                          ...even though 'xx' fails min(3).
//     z.string().min(3).prefault('xx')  → parse error, as it should be.
//
// THE RULE USED THROUGHOUT THIS FILE:
//
//   Use `.default()`  when the default is already a complete, valid output value
//                     and running it through the parser would be a strict no-op.
//                     In practice: boolean literals, empty arrays, literal consts.
//                     Cheaper, and there is nothing for validation to catch.
//
//   Use `.prefault()` when the default MUST be parsed to be correct. Two cases:
//                       (a) the default is a partial object whose nested defaults
//                           have to run, or the output type would be a lie;
//                       (b) the field carries constraints that the default itself
//                           should be held to, so a future edit to the default
//                           cannot silently smuggle in an invalid value.
//
// Every `.default()` and `.prefault()` below carries an inline note naming which
// case it falls under. If you add a field, add the note — the reasoning is the
// point, not the annotation.

import { z } from 'zod'

// ─────────────────────────────────────────────────────────────────────────────
// Format version
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bump when a change to these schemas cannot be read by the previous parser, and
 * add a migration in `src/domain/model/migrations/` in the same commit (NFR-5.6).
 */
export const FORMAT_VERSION = 1 as const

// ─────────────────────────────────────────────────────────────────────────────
// Identifiers
// ─────────────────────────────────────────────────────────────────────────────
//
// Branded so the compiler rejects passing an AttributeId where an EntityId is
// expected. `ForeignKeyRef` holds one of each, adjacent, which is exactly the
// place a transposition bug would otherwise go unnoticed.
//
// SRS §3: "Attributes carry stable IDs, not just names. Renaming an attribute must
// not break a foreign key reference."

export const DiagramIdSchema = z.string().min(1).brand<'DiagramId'>()
export const EntityIdSchema = z.string().min(1).brand<'EntityId'>()
export const AttributeIdSchema = z.string().min(1).brand<'AttributeId'>()
export const RelationshipIdSchema = z.string().min(1).brand<'RelationshipId'>()
export const GroupIdSchema = z.string().min(1).brand<'GroupId'>()

// ─────────────────────────────────────────────────────────────────────────────
// Enumerations
// ─────────────────────────────────────────────────────────────────────────────

/** Rectangle / double rectangle / associative hub (FR-5.1, FR-5.3). */
export const EntityKindSchema = z.enum(['strong', 'weak', 'associative'])

/** `nary` and `isa` are V2 constructs (FR-1.13, FR-1.14); the IR carries them from V1. */
export const RelationshipKindSchema = z.enum(['binary', 'nary', 'isa'])

/** Crow's-foot "one" vs "many" end (FR-1.5). */
export const CardinalitySchema = z.enum(['one', 'many'])

/** Optional vs mandatory participation — the `o` vs `|` inner glyph (FR-1.5). */
export const ParticipationSchema = z.enum(['partial', 'total'])

/** Compact (crow's foot / IE) is the V1 default; Chen is the secondary mode (SRS §2.2). */
export const NotationSchema = z.enum(['compact', 'chen'])

// ─────────────────────────────────────────────────────────────────────────────
// Attribute
// ─────────────────────────────────────────────────────────────────────────────

/** Points an attribute at the key it references (FR-1.11). */
export const ForeignKeyRefSchema = z.object({
  entityId: EntityIdSchema,
  attributeId: AttributeIdSchema,
})

/**
 * An attribute of an entity or of a relationship.
 *
 * `children` models composite attributes (FR-1.10) and is defined with a getter, which
 * is how Zod 4 expresses recursion. Zod 3 would have needed `z.lazy()` plus a
 * hand-written interface and a `z.ZodType<Attribute>` annotation, because inference
 * could not close the cycle.
 *
 * The schema is recursive to arbitrary depth, but V1 permits only ONE level of nesting
 * per SRS §3 ("composite attributes, one level of nesting"). That limit is enforced by
 * `EntitySchema` rather than here, because attaching a refinement to this object would
 * change its type and break the self-reference in the getter. Keeping the shape
 * recursive means lifting the limit in V2 is a one-line change, not a format change.
 */
export const AttributeSchema = z.object({
  id: AttributeIdSchema,

  /**
   * Not `.min(1)`: a freshly-added attribute is empty until the user types (FR-1.2).
   * Empty names are reported by the validation rules instead (FR-8.2).
   */
  name: z.string(),

  comment: z.string().optional(),

  /** Free text with autocomplete, not dialect-validated (FR-1.3, SRS §11 open item 2). */
  dataType: z.string().optional(),

  defaultValue: z.string().optional(),

  // `.default()` — a boolean literal is already a complete, valid output value, and
  // there are no constraints on these fields for a parse to enforce.
  isPrimaryKey: z.boolean().default(false),
  isUnique: z.boolean().default(false),
  /** Nullable unless stated otherwise; PK/nullable conflicts are a validation warning. */
  isNullable: z.boolean().default(true),
  /** Dashed oval in Chen mode; dashed-underline badge in compact mode (FR-1.10). */
  isDerived: z.boolean().default(false),
  /** Double oval in Chen mode; `⊞` badge in compact mode (FR-1.10). */
  isMultivalued: z.boolean().default(false),

  foreignKey: ForeignKeyRefSchema.optional(),

  get children() {
    // `.default([])` is deliberately NOT used here. An absent `children` and an empty
    // `children: []` mean different things to the Chen renderer — "scalar attribute"
    // versus "composite attribute with no parts yet" — and collapsing them would lose
    // that distinction on every round-trip through the parser.
    return z.array(AttributeSchema).optional()
  },
})

// ─────────────────────────────────────────────────────────────────────────────
// Entity
// ─────────────────────────────────────────────────────────────────────────────

/** Disjoint/overlapping and total/partial constraints on an ISA hierarchy (FR-1.14, V2). */
export const SpecializationSchema = z.object({
  disjoint: z.boolean(),
  total: z.boolean(),
})

const EntityObjectSchema = z.object({
  id: EntityIdSchema,

  /** Not `.min(1)` — see the note on `AttributeSchema.name`. */
  name: z.string(),

  comment: z.string().optional(),

  // `.default()` — a literal from a closed enum; parsing it is a no-op.
  kind: EntityKindSchema.default('strong'),

  // `.default()` — an empty array is already the complete output value.
  attributes: z.array(AttributeSchema).default([]),

  /** Subject area membership (FR-1.15, V2). */
  groupId: GroupIdSchema.optional(),

  /** ISA supertype (FR-1.14, V2). */
  parentId: EntityIdSchema.optional(),

  specialization: SpecializationSchema.optional(),
})

/** Maximum nesting depth for composite attributes in V1. See `AttributeSchema.children`. */
export const MAX_COMPOSITE_DEPTH = 1

/** Depth of a composite attribute tree. A scalar attribute has depth 0. */
export function attributeDepth(attribute: z.infer<typeof AttributeSchema>): number {
  const children = attribute.children
  if (children === undefined || children.length === 0) return 0
  return 1 + Math.max(...children.map(attributeDepth))
}

export const EntitySchema = EntityObjectSchema.superRefine((entity, ctx) => {
  entity.attributes.forEach((attribute, index) => {
    if (attributeDepth(attribute) > MAX_COMPOSITE_DEPTH) {
      ctx.addIssue({
        code: 'custom',
        path: ['attributes', index, 'children'],
        message:
          `Composite attributes may nest ${String(MAX_COMPOSITE_DEPTH)} level deep in V1 ` +
          `(SRS §3). Raise MAX_COMPOSITE_DEPTH when V2 lifts the limit.`,
      })
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Relationship
// ─────────────────────────────────────────────────────────────────────────────

export const ParticipantSchema = z.object({
  entityId: EntityIdSchema,

  // `.default()` — enum literals, no-op to parse.
  //
  // Both sides default to the "many, optional" end. The asymmetric `1 : 0..N` default
  // that FR-1.5 specifies is a property of a newly CREATED relationship, not of the
  // format, so it is applied by `createRelationship()` in factory.ts. Encoding it here
  // would mean a hand-written `.erd.json` omitting both cardinalities silently became
  // 1:N rather than the neutral N:N it actually said.
  cardinality: CardinalitySchema.default('many'),
  participation: ParticipationSchema.default('partial'),

  /** Distinguishes the ends of a recursive relationship, e.g. manager / report (FR-1.12). */
  role: z.string().optional(),
})

const RelationshipObjectSchema = z.object({
  id: RelationshipIdSchema,

  // `.default('')` — an unnamed relationship is legal and is surfaced as a warning by
  // FR-8.3, not rejected here. Empty string is a complete valid value.
  name: z.string().default(''),

  comment: z.string().optional(),

  // `.default()` — enum literal.
  kind: RelationshipKindSchema.default('binary'),

  /** Double diamond in Chen mode; solid `--` rather than dotted `..` in Mermaid (FR-1.9). */
  isIdentifying: z.boolean().default(false),

  // No default: a relationship with no participants is meaningless, so its absence is
  // an error rather than something to paper over with an empty array.
  participants: z.array(ParticipantSchema),

  /** Attributes on the diamond (SRS §3); relocated to an associative entity on export. */
  attributes: z.array(AttributeSchema).default([]),
})

/** Participant-count arity per relationship kind. */
const ARITY = {
  binary: { min: 2, max: 2, label: 'exactly 2' },
  nary: { min: 3, max: Number.POSITIVE_INFINITY, label: 'at least 3' },
  isa: { min: 2, max: Number.POSITIVE_INFINITY, label: 'at least 2' },
} as const

export const RelationshipSchema = RelationshipObjectSchema.superRefine((relationship, ctx) => {
  const arity = ARITY[relationship.kind]
  const count = relationship.participants.length

  if (count < arity.min || count > arity.max) {
    ctx.addIssue({
      code: 'custom',
      path: ['participants'],
      message:
        `A '${relationship.kind}' relationship needs ${arity.label} participants, ` +
        `got ${String(count)}.`,
    })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// Grouping and layout
// ─────────────────────────────────────────────────────────────────────────────

/** Subject area (FR-1.15, V2). Colour is a token name, not a raw hex — see NFR-4.4. */
export const GroupSchema = z.object({
  id: GroupIdSchema,
  name: z.string(),
  colorToken: z.string().optional(),
})

export const PointSchema = z.object({
  // No `.finite()`: deprecated in Zod 4, where `z.number()` already rejects Infinity
  // and NaN. Kept explicit here because rejecting them matters — a non-finite
  // coordinate would silently break layout and SVG rendering.
  x: z.number(),
  y: z.number(),
})

/** Zoom bounds mirror FR-2.1: 10% to 300%. */
export const ViewportSchema = z.object({
  x: z.number(),
  y: z.number(),
  zoom: z.number().min(0.1).max(3),
})

/**
 * Positions live here, apart from the semantic model (SRS §3).
 *
 * That separation is what lets auto-layout re-run without mutating the schema, and lets
 * an exporter with no concept of position — Mermaid — ignore this whole branch.
 */
export const LayoutStateSchema = z.object({
  // `.default()` — empty object/array literals are complete output values.
  positions: z.record(EntityIdSchema, PointSchema).default({}),
  /** Entities pinned to full detail regardless of zoom (FR-2.7). */
  pinned: z.array(EntityIdSchema).default([]),
  viewport: ViewportSchema.optional(),
})

export const DiagramMetaSchema = z.object({
  // `.default()` — enum literal.
  notation: NotationSchema.default('compact'),
})

// ─────────────────────────────────────────────────────────────────────────────
// Diagram
// ─────────────────────────────────────────────────────────────────────────────

const DiagramObjectSchema = z.object({
  // `.default()` — a literal constant. Parsing it against `z.literal` is a no-op.
  formatVersion: z.literal(FORMAT_VERSION).default(FORMAT_VERSION),

  id: DiagramIdSchema,

  // `.prefault()` — case (b). Unlike element names, the diagram name is file metadata
  // and IS constrained to `.min(1)`. With `.default('Untitled diagram')` the constraint
  // would not be applied to the default, so a later edit shortening it to '' would
  // silently produce an unnamed diagram that `.min(1)` was supposed to prevent.
  name: z.string().min(1).prefault('Untitled diagram'),

  // `.prefault()` — case (b). The generated timestamp is checked against the ISO-8601
  // format the field requires, so a bad clock or a refactor to a different time source
  // fails loudly at the boundary rather than writing a malformed file.
  createdAt: z.iso.datetime().prefault(() => new Date().toISOString()),
  updatedAt: z.iso.datetime().prefault(() => new Date().toISOString()),

  // `.default()` — empty array literals.
  entities: z.array(EntitySchema).default([]),
  relationships: z.array(RelationshipSchema).default([]),
  groups: z.array(GroupSchema).default([]),

  // `.prefault()` — case (a), and the clearest illustration of why the distinction
  // matters. `LayoutStateSchema` has its own nested defaults for `positions` and
  // `pinned`. With `.default({})` Zod 4 would hand back the bare `{}` unparsed, those
  // nested defaults would never run, and the inferred type would claim `positions` and
  // `pinned` exist when at runtime they do not — a type-level lie that would surface as
  // an undefined-property crash in the layout engine.
  layout: LayoutStateSchema.prefault({}),

  // `.prefault()` — case (a), same reasoning: `notation` must be filled in by the
  // nested default.
  meta: DiagramMetaSchema.prefault({}),
})

/**
 * Referential integrity.
 *
 * Checked here rather than in `src/domain/validation/` because a dangling reference
 * makes a document structurally unusable, not merely questionable. The validation rules
 * answer "is this a good model?"; this answers "can this document be loaded at all?".
 *
 * Runs on untrusted input (NFR-7.2) and on every file open (NFR-1.2), so it uses
 * pre-built lookup sets rather than nested scans — the reference schema is 120 entities
 * and 960 attributes.
 */
export const DiagramSchema = DiagramObjectSchema.superRefine((diagram, ctx) => {
  const entityIds = new Set<string>()
  const attributeOwners = new Map<string, string>()

  for (const entity of diagram.entities) {
    if (entityIds.has(entity.id)) {
      ctx.addIssue({
        code: 'custom',
        path: ['entities'],
        message: `Duplicate entity id '${entity.id}'.`,
      })
    }
    entityIds.add(entity.id)
    for (const attribute of entity.attributes) {
      attributeOwners.set(attribute.id, entity.id)
    }
  }

  const requireEntity = (id: string, path: (string | number)[], what: string): void => {
    if (!entityIds.has(id)) {
      ctx.addIssue({ code: 'custom', path, message: `${what} references unknown entity '${id}'.` })
    }
  }

  diagram.entities.forEach((entity, entityIndex) => {
    if (entity.parentId !== undefined) {
      requireEntity(entity.parentId, ['entities', entityIndex, 'parentId'], 'Supertype')
    }

    entity.attributes.forEach((attribute, attributeIndex) => {
      const fk = attribute.foreignKey
      if (fk === undefined) return

      const path = ['entities', entityIndex, 'attributes', attributeIndex, 'foreignKey']
      requireEntity(fk.entityId, [...path, 'entityId'], 'Foreign key')

      const owner = attributeOwners.get(fk.attributeId)
      if (owner === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [...path, 'attributeId'],
          message: `Foreign key references unknown attribute '${fk.attributeId}'.`,
        })
      } else if (owner !== fk.entityId) {
        ctx.addIssue({
          code: 'custom',
          path: [...path, 'attributeId'],
          message:
            `Foreign key names attribute '${fk.attributeId}', which belongs to entity ` +
            `'${owner}', not the referenced entity '${fk.entityId}'.`,
        })
      }
    })
  })

  const groupIds = new Set<string>(diagram.groups.map((group) => group.id))
  diagram.entities.forEach((entity, entityIndex) => {
    if (entity.groupId !== undefined && !groupIds.has(entity.groupId)) {
      ctx.addIssue({
        code: 'custom',
        path: ['entities', entityIndex, 'groupId'],
        message: `Entity references unknown group '${entity.groupId}'.`,
      })
    }
  })

  const relationshipIds = new Set<string>()
  diagram.relationships.forEach((relationship, relationshipIndex) => {
    if (relationshipIds.has(relationship.id)) {
      ctx.addIssue({
        code: 'custom',
        path: ['relationships', relationshipIndex, 'id'],
        message: `Duplicate relationship id '${relationship.id}'.`,
      })
    }
    relationshipIds.add(relationship.id)

    relationship.participants.forEach((participant, participantIndex) => {
      requireEntity(
        participant.entityId,
        ['relationships', relationshipIndex, 'participants', participantIndex, 'entityId'],
        'Participant',
      )
    })
  })

  // Stale layout entries are tolerated rather than rejected: deleting an entity and
  // undoing the delete (FR-7.1) should restore its position, so the layout map is
  // allowed to outlive the entity it describes.
})
