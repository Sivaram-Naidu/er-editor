// createEntity(), createRelationship(), createAttribute() with SRS-specified defaults.
//
// These are the ONLY sanctioned way to mint a new model element. Two reasons:
//
//   1. IDs are generated here and nowhere else, so nothing can accidentally key an
//      element by its name (SRS §3).
//   2. "Default" means two different things and this file is where they are kept apart.
//      `schema.ts` defaults describe what an ABSENT FIELD in a stored document means,
//      and must stay neutral. These factories describe what a NEWLY CREATED element
//      looks like, and are free to be opinionated. FR-1.5's `1 : 0..N` is the clearest
//      case: it is the right default for a relationship the user just drew, and the
//      wrong default for a hand-written file that omitted both cardinalities.
//
// ─────────────────────────────────────────────────────────────────────────────
// A NOTE ON `exactOptionalPropertyTypes`
// ─────────────────────────────────────────────────────────────────────────────
//
// The tsconfig sets `exactOptionalPropertyTypes: true`, so `{ comment: undefined }` is
// NOT assignable to `{ comment?: string }`. An optional field must be genuinely absent,
// not present-and-undefined.
//
// That distinction is worth keeping rather than switching the flag off. These objects
// are serialised straight to `.erd.json`, and a codebase that freely assigns `undefined`
// tends to grow stray keys on the way through a round-trip. Enforcing absence at the
// type level keeps the persisted format tidy.
//
// The cost is that optional fields cannot be spread in unconditionally. The `optional()`
// helper below does the conditional spread in one place so call sites stay readable.

import { ID_PREFIX, newId } from '../../lib/id'

import { FORMAT_VERSION } from './schema'
import type {
  Attribute,
  AttributeId,
  Cardinality,
  Diagram,
  DiagramId,
  Entity,
  EntityId,
  EntityKind,
  Group,
  GroupId,
  Participant,
  Participation,
  Relationship,
  RelationshipId,
} from './types'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Spread an optional field only when it has a value.
 *
 * `...optional('comment', input.comment)` yields `{ comment: 'x' }` or `{}`, never
 * `{ comment: undefined }`. This is the single concession `exactOptionalPropertyTypes`
 * requires, and keeping it in one helper stops it spreading through every factory.
 */
function optional<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>)
}

export const newDiagramId = (): DiagramId => newId(ID_PREFIX.diagram) as DiagramId
export const newEntityId = (): EntityId => newId(ID_PREFIX.entity) as EntityId
export const newAttributeId = (): AttributeId => newId(ID_PREFIX.attribute) as AttributeId
export const newRelationshipId = (): RelationshipId =>
  newId(ID_PREFIX.relationship) as RelationshipId
export const newGroupId = (): GroupId => newId(ID_PREFIX.group) as GroupId

// ─────────────────────────────────────────────────────────────────────────────
// Attribute
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateAttributeOptions {
  name?: string
  dataType?: string
  comment?: string
  defaultValue?: string
  isPrimaryKey?: boolean
  isUnique?: boolean
  isNullable?: boolean
  isDerived?: boolean
  isMultivalued?: boolean
  children?: Attribute[]
}

/**
 * Mint a new attribute.
 *
 * Default name is empty, matching FR-1.2: a newly added attribute enters inline edit
 * immediately, so the user types into an empty field rather than deleting a placeholder.
 *
 * A primary key is created unique and non-nullable unless the caller says otherwise.
 * Neither is enforced by the schema — a stored document may hold a nullable PK, and the
 * validation rules flag it — but creating one that way by default would be perverse.
 */
export function createAttribute(options: CreateAttributeOptions = {}): Attribute {
  const isPrimaryKey = options.isPrimaryKey ?? false

  return {
    id: newAttributeId(),
    name: options.name ?? '',
    isPrimaryKey,
    isUnique: options.isUnique ?? isPrimaryKey,
    isNullable: options.isNullable ?? !isPrimaryKey,
    isDerived: options.isDerived ?? false,
    isMultivalued: options.isMultivalued ?? false,
    ...optional('dataType', options.dataType),
    ...optional('comment', options.comment),
    ...optional('defaultValue', options.defaultValue),
    ...optional('children', options.children),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Entity
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateEntityOptions {
  name?: string
  kind?: EntityKind
  comment?: string
  attributes?: Attribute[]
  groupId?: GroupId
  parentId?: EntityId
}

/**
 * Mint a new entity.
 *
 * Default name is empty, per FR-1.1 ("enters inline name-edit immediately").
 * No implicit `id` attribute is added: inventing a primary key the user did not ask for
 * is a modelling decision, and FR-8.3 already surfaces a missing PK as a warning.
 */
export function createEntity(options: CreateEntityOptions = {}): Entity {
  return {
    id: newEntityId(),
    name: options.name ?? '',
    kind: options.kind ?? 'strong',
    attributes: options.attributes ?? [],
    ...optional('comment', options.comment),
    ...optional('groupId', options.groupId),
    ...optional('parentId', options.parentId),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Relationship
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateParticipantOptions {
  entityId: EntityId
  cardinality?: Cardinality
  participation?: Participation
  role?: string
}

export function createParticipant(options: CreateParticipantOptions): Participant {
  return {
    entityId: options.entityId,
    cardinality: options.cardinality ?? 'many',
    participation: options.participation ?? 'partial',
    ...optional('role', options.role),
  }
}

export interface CreateRelationshipOptions {
  from: EntityId
  to: EntityId
  name?: string
  isIdentifying?: boolean
  comment?: string
  /** Overrides for the source end. */
  fromEnd?: Omit<CreateParticipantOptions, 'entityId'>
  /** Overrides for the target end. */
  toEnd?: Omit<CreateParticipantOptions, 'entityId'>
}

/**
 * Mint a new binary relationship between two entities.
 *
 * FR-1.5: "Defaults to `1 : 0..N`." That means the SOURCE end is exactly one and
 * mandatory, and the TARGET end is zero-or-more and optional — the shape of an ordinary
 * parent/child foreign key, and by far the most common thing a user draws.
 *
 * `createParticipant` alone cannot express this, because the asymmetry is a property of
 * the pair rather than of either end. Hence the explicit `fromEnd` / `toEnd` overrides.
 *
 * Self-referencing relationships are permitted (FR-1.12); role names distinguish the
 * ends and are the caller's responsibility.
 */
export function createRelationship(options: CreateRelationshipOptions): Relationship {
  return {
    id: newRelationshipId(),
    name: options.name ?? '',
    kind: 'binary',
    isIdentifying: options.isIdentifying ?? false,
    attributes: [],
    participants: [
      createParticipant({
        entityId: options.from,
        cardinality: options.fromEnd?.cardinality ?? 'one',
        participation: options.fromEnd?.participation ?? 'total',
        ...optional('role', options.fromEnd?.role),
      }),
      createParticipant({
        entityId: options.to,
        cardinality: options.toEnd?.cardinality ?? 'many',
        participation: options.toEnd?.participation ?? 'partial',
        ...optional('role', options.toEnd?.role),
      }),
    ],
    ...optional('comment', options.comment),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Group
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateGroupOptions {
  name?: string
  colorToken?: string
}

export function createGroup(options: CreateGroupOptions = {}): Group {
  return {
    id: newGroupId(),
    name: options.name ?? '',
    ...optional('colorToken', options.colorToken),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Diagram
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateDiagramOptions {
  name?: string
  entities?: Entity[]
  relationships?: Relationship[]
  groups?: Group[]
  /** Injectable for deterministic tests; defaults to the wall clock. */
  now?: () => Date
}

/**
 * Mint an empty diagram.
 *
 * Unlike element names, the diagram name is never empty — `DiagramSchema` constrains it
 * to `.min(1)` — so the placeholder here matches the schema's `prefault` value rather
 * than the empty string used elsewhere.
 */
export function createDiagram(options: CreateDiagramOptions = {}): Diagram {
  const timestamp = (options.now ?? (() => new Date()))().toISOString()

  return {
    formatVersion: FORMAT_VERSION,
    id: newDiagramId(),
    name: options.name ?? 'Untitled diagram',
    createdAt: timestamp,
    updatedAt: timestamp,
    entities: options.entities ?? [],
    relationships: options.relationships ?? [],
    groups: options.groups ?? [],
    layout: { positions: {}, pinned: [] },
    meta: { notation: 'compact' },
  }
}
