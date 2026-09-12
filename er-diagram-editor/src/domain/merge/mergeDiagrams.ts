// Merging an imported schema INTO the diagram already on screen, rather than replacing it.
//
// Import used to open a new document, which threw away every position the user had
// arranged — the thing that makes a 120-table diagram worth anything. This computes what a
// re-import would do, so the caller can show it before committing to it, and hands back the
// finished entity and relationship lists for a single command to install.
//
// THE JOIN KEY IS THE NAME, AT BOTH LEVELS, AND IT HAS TO BE. Every importer mints fresh
// ids — `.sql` and `.mmd` carry none at all — so an incoming id has no relationship to
// anything on screen. Matching on it would make every re-import a complete replacement,
// which is the bug.
//
// PRESERVING THE CURRENT ID FOR EVERYTHING MATCHED IS THE WHOLE MECHANISM. `layout.positions`
// is keyed by entity id, so keeping the id keeps the box where the user put it; the same
// holds for `layout.pinned`, for the selection, and — the one that turns a cosmetic problem
// into a corrupt document — for any foreign key that an entity NOT in the incoming file
// aims at a column in one that is. Referential integrity is the single thing the schema
// enforces (see `schema.ts`), so a dangling `foreignKey.attributeId` does not render oddly,
// it makes the document refuse to load.
//
// This is also why "attributes are keyed by stable id, never by name" is not violated here.
// The rule exists so a rename cannot break a reference; matching by name at the IMPORT
// boundary is what lets the ids stay stable across a re-import instead of being reissued.

import type {
  Attribute,
  AttributeId,
  Diagram,
  Entity,
  EntityId,
  Point,
  Relationship,
} from '../model'

export interface MergeOptions {
  /**
   * Delete entities the incoming file does not mention, and the relationships touching them.
   *
   * OFF by default, and surfaced as a checkbox rather than assumed. A diagram routinely
   * holds tables that were drawn by hand and were never in the dump, and a re-import that
   * silently deleted them would be destructive in a way the summary alone does not make
   * obvious enough. It is one undo step either way; the default is the non-destructive one.
   */
  readonly removeMissing: boolean
}

export interface MergeSummary {
  /** Names of entities in the file that were not on the canvas. */
  readonly added: readonly string[]
  /** Names of entities that were on the canvas and whose content the file changed. */
  readonly changed: readonly string[]
  /** Names of entities on the canvas that the file does not mention. */
  readonly missing: readonly string[]
  /** How many of `missing` were actually deleted — 0 unless `removeMissing`. */
  readonly removed: number
  /** Matched entities the file left byte-identical. */
  readonly unchanged: number
  readonly relationshipsAdded: number
  readonly relationshipsRemoved: number
  /**
   * Foreign keys that had to be cleared because the column they pointed at is no longer in
   * the schema. Reported rather than silent: it is real information loss, and the number
   * being non-zero is usually a sign the dump is not the one the diagram was built from.
   */
  readonly foreignKeysCleared: number
}

export interface MergeResult {
  readonly entities: readonly Entity[]
  readonly relationships: readonly Relationship[]
  readonly positions: Readonly<Record<EntityId, Point>>
  readonly pinned: readonly EntityId[]
  readonly summary: MergeSummary
}

/**
 * The join key for a name.
 *
 * Case-insensitive and trimmed, because SQL dialects disagree about identifier case and a
 * dump written as `CUSTOMER` must not produce a second box beside one imported earlier as
 * `customer`. The INCOMING spelling wins on a match, so re-importing a file whose case
 * changed relabels the box instead of duplicating it.
 */
const joinKey = (name: string): string => name.trim().toLowerCase()

/**
 * Names are not unique — the schema deliberately permits duplicates and blanks, because the
 * editor has to be able to hold a half-finished model. So matching pops from a queue per
 * key: the first unmatched candidate wins, and any surplus on either side falls through to
 * added/missing rather than silently pairing off at random.
 */
function queueByName<T extends { name: string }>(items: readonly T[]): Map<string, T[]> {
  const queues = new Map<string, T[]>()
  for (const item of items) {
    const key = joinKey(item.name)
    const queue = queues.get(key)
    if (queue === undefined) queues.set(key, [item])
    else queue.push(item)
  }
  return queues
}

function takeMatch<T>(queues: Map<string, T[]>, key: string): T | undefined {
  const queue = queues.get(key)
  if (queue === undefined || queue.length === 0) return undefined
  return queue.shift()
}

/** Re-key one incoming attribute onto the id its name already has on the canvas, if any. */
function mergeAttribute(incoming: Attribute, existing: Attribute | undefined): Attribute {
  return existing === undefined ? incoming : { ...incoming, id: existing.id }
}

/**
 * Where to put entities the canvas has never seen.
 *
 * NOT auto-layout: re-running it would rearrange every box, which is the exact work this
 * feature exists to preserve. New tables go in a block clear of everything already placed,
 * so nothing overlaps and nothing moves; the user can run auto-layout afterwards if they
 * want the whole thing rearranged, and that is their call rather than a side effect of
 * opening a file.
 */
const NEW_BLOCK_COLUMNS = 4
const NEW_BLOCK_X = 320
const NEW_BLOCK_Y = 220
const NEW_BLOCK_GAP = 400

function placeNewEntities(
  newIds: readonly EntityId[],
  placed: Readonly<Record<EntityId, Point>>,
): Record<EntityId, Point> {
  let right = 0
  let top = 0
  let seen = false
  for (const point of Object.values(placed)) {
    right = seen ? Math.max(right, point.x) : point.x
    top = seen ? Math.min(top, point.y) : point.y
    seen = true
  }

  const originX = seen ? right + NEW_BLOCK_GAP : 0
  const originY = seen ? top : 0

  const positions: Record<EntityId, Point> = {}
  newIds.forEach((id, index) => {
    positions[id] = {
      x: originX + (index % NEW_BLOCK_COLUMNS) * NEW_BLOCK_X,
      y: originY + Math.floor(index / NEW_BLOCK_COLUMNS) * NEW_BLOCK_Y,
    }
  })
  return positions
}

/** Ordered participant ids plus the name — enough to recognise the same relationship again. */
function relationshipKey(relationship: Relationship): string {
  return `${relationship.participants.map((participant) => participant.entityId).join('>')}|${joinKey(relationship.name)}`
}

function sameAttribute(a: Attribute, b: Attribute): boolean {
  // Compared on content rather than identity, and with the ids excluded, because the whole
  // point is to tell "the file says something different" apart from "the file was re-read".
  const { id: _ignoredA, ...restA } = a
  const { id: _ignoredB, ...restB } = b
  return JSON.stringify(restA) === JSON.stringify(restB)
}

/**
 * Work out what importing `incoming` over `current` would do.
 *
 * Pure: it touches neither document and mints no ids, so the caller can run it to render a
 * preview and then run it again to apply, and get the same answer both times.
 */
export function mergeDiagrams(
  current: Diagram,
  incoming: Diagram,
  options: MergeOptions,
): MergeResult {
  const currentQueues = queueByName(current.entities)
  const matchedCurrentIds = new Set<EntityId>()

  // Pass 1 — pair incoming entities with what is already on the canvas, and record how every
  // incoming id and attribute id should be rewritten.
  const entityIdMap = new Map<EntityId, EntityId>()
  const attributeIdMap = new Map<AttributeId, AttributeId>()
  const pairings: { incoming: Entity; existing: Entity | undefined }[] = []

  for (const entity of incoming.entities) {
    const existing = takeMatch(currentQueues, joinKey(entity.name))
    pairings.push({ incoming: entity, existing })
    if (existing === undefined) continue

    matchedCurrentIds.add(existing.id)
    entityIdMap.set(entity.id, existing.id)

    const existingAttributes = queueByName(existing.attributes)
    for (const attribute of entity.attributes) {
      const match = takeMatch(existingAttributes, joinKey(attribute.name))
      if (match !== undefined) attributeIdMap.set(attribute.id, match.id)
    }
  }

  const mapEntityId = (id: EntityId): EntityId => entityIdMap.get(id) ?? id
  const mapAttributeId = (id: AttributeId): AttributeId => attributeIdMap.get(id) ?? id

  // Pass 2 — build the merged entities. Current order first so nothing jumps around in the
  // inspector or the search index, then anything genuinely new.
  const fromIncoming = new Map<EntityId, Entity>()
  const added: string[] = []

  for (const { incoming: entity, existing } of pairings) {
    const attributeMatches = existing === undefined ? undefined : queueByName(existing.attributes)
    const attributes = entity.attributes.map((attribute) => {
      const match =
        attributeMatches === undefined
          ? undefined
          : takeMatch(attributeMatches, joinKey(attribute.name))
      return mergeAttribute(attribute, match)
    })

    const merged: Entity = {
      ...entity,
      id: mapEntityId(entity.id),
      attributes,
      // A grouping is arrangement, like a position, so a matched entity keeps the one it
      // has. An incoming-only entity drops its own: groups are not merged, so the id would
      // point at nothing.
      ...(existing?.groupId === undefined ? {} : { groupId: existing.groupId }),
      ...(entity.parentId === undefined ? {} : { parentId: mapEntityId(entity.parentId) }),
    }
    if (existing?.groupId === undefined) delete (merged as { groupId?: unknown }).groupId

    fromIncoming.set(merged.id, merged)
    if (existing === undefined) added.push(entity.name)
  }

  const entities: Entity[] = []
  const missing: string[] = []

  for (const entity of current.entities) {
    const merged = fromIncoming.get(entity.id)
    if (merged === undefined) {
      // On the canvas, absent from the file.
      missing.push(entity.name)
      if (!options.removeMissing) entities.push(entity)
      continue
    }
    entities.push(merged)
  }

  for (const { incoming: entity } of pairings) {
    if (entityIdMap.has(entity.id)) continue
    const merged = fromIncoming.get(entity.id)
    if (merged !== undefined) entities.push(merged)
  }

  // Pass 3 — rewrite every foreign key onto the merged ids, and clear the ones whose target
  // no longer exists. An incoming FK is always resolvable through the maps; the ones at risk
  // belong to entities the file does not mention, pointing at a column it deleted.
  const liveEntityIds = new Set(entities.map((entity) => entity.id));
  const liveAttributeIds = new Set<AttributeId>()
  for (const entity of entities) {
    for (const attribute of entity.attributes) liveAttributeIds.add(attribute.id)
  }

  let foreignKeysCleared = 0
  const resolved = entities.map((entity) => {
    const attributes = entity.attributes.map((attribute) => {
      const fk = attribute.foreignKey
      if (fk === undefined) return attribute

      const target = {
        entityId: mapEntityId(fk.entityId),
        attributeId: mapAttributeId(fk.attributeId),
      }
      if (liveEntityIds.has(target.entityId) && liveAttributeIds.has(target.attributeId)) {
        const moved = target.entityId !== fk.entityId || target.attributeId !== fk.attributeId
        return moved ? { ...attribute, foreignKey: target } : attribute
      }

      foreignKeysCleared += 1
      const { foreignKey: _dropped, ...rest } = attribute
      return rest
    })

    // Reference equality rather than a mutated flag: the map above returns the SAME object
    // when it changed nothing, so this says exactly "did any attribute get rebuilt" — and
    // a `let touched = true` set inside a callback is something TypeScript cannot narrow,
    // so the lint rule rightly calls the resulting ternary always-falsy.
    const untouched = attributes.every((attribute, index) => attribute === entity.attributes[index])
    return untouched ? entity : { ...entity, attributes }
  })

  // Only NOW is it fair to ask what the file changed.
  //
  // Doing this in pass 2 was wrong and the test caught it: an incoming foreign key still
  // carries the importer's own ids until pass 3 rewrites it, so every table with one
  // compared unequal and a re-import of an unchanged dump reported every such table as
  // changed. Compare the RESOLVED entity against the one it replaced.
  const before = new Map(current.entities.map((entity) => [entity.id, entity]))
  const changed: string[] = []
  let unchanged = 0

  for (const entity of resolved) {
    // Only entities the file actually carried. One that is merely being kept because the
    // file does not mention it is `missing`, not `unchanged`, and counting it as the latter
    // would report a dump as covering tables it has never heard of.
    if (!fromIncoming.has(entity.id)) continue
    const previous = before.get(entity.id)
    if (previous === undefined) continue

    const sameShape =
      previous.attributes.length === entity.attributes.length &&
      previous.attributes.every((attribute, index) => {
        const against = entity.attributes[index]
        return against !== undefined && sameAttribute(attribute, against)
      })
    if (previous.name === entity.name && previous.kind === entity.kind && sameShape) unchanged += 1
    else changed.push(entity.name)
  }

  // Pass 4 — relationships. Incoming ones are remapped onto merged entity ids first, so a
  // re-import of the same file recognises its own edges instead of drawing a second copy of
  // every one of them.
  const currentByKey = new Map<string, Relationship>()
  for (const relationship of current.relationships) {
    currentByKey.set(relationshipKey(relationship), relationship)
  }

  const relationships: Relationship[] = []
  const keptCurrentRelationshipIds = new Set<string>()
  let relationshipsAdded = 0

  for (const relationship of incoming.relationships) {
    const remapped: Relationship = {
      ...relationship,
      participants: relationship.participants.map((participant) => ({
        ...participant,
        entityId: mapEntityId(participant.entityId),
      })),
    }
    if (!remapped.participants.every((participant) => liveEntityIds.has(participant.entityId))) {
      continue
    }

    const existing = currentByKey.get(relationshipKey(remapped))
    if (existing === undefined) {
      relationships.push(remapped)
      relationshipsAdded += 1
    } else {
      relationships.push({ ...remapped, id: existing.id })
      keptCurrentRelationshipIds.add(existing.id)
    }
  }

  let relationshipsRemoved = 0
  for (const relationship of current.relationships) {
    if (keptCurrentRelationshipIds.has(relationship.id)) continue
    const survives =
      !options.removeMissing &&
      relationship.participants.every((participant) => liveEntityIds.has(participant.entityId))
    if (survives) relationships.push(relationship)
    else relationshipsRemoved += 1
  }

  // Pass 5 — layout. Matched boxes keep their id, so their position needs no work at all;
  // that is the feature. Only entities the canvas has never seen get placed.
  const positions: Record<EntityId, Point> = {}
  for (const [id, point] of Object.entries(current.layout.positions) as [EntityId, Point][]) {
    if (liveEntityIds.has(id)) positions[id] = point
  }
  const unplaced = resolved
    .map((entity) => entity.id)
    .filter((id) => positions[id] === undefined)
  Object.assign(positions, placeNewEntities(unplaced, positions))

  return {
    entities: resolved,
    relationships,
    positions,
    pinned: current.layout.pinned.filter((id) => liveEntityIds.has(id)),
    summary: {
      added,
      changed,
      missing,
      removed: options.removeMissing ? missing.length : 0,
      unchanged,
      relationshipsAdded,
      relationshipsRemoved,
      foreignKeysCleared,
    },
  }
}

/** True when the merge would change nothing at all, so the UI can say so instead of a blank list. */
export function isNoOpMerge(summary: MergeSummary): boolean {
  return (
    summary.added.length === 0 &&
    summary.changed.length === 0 &&
    summary.removed === 0 &&
    summary.relationshipsAdded === 0 &&
    summary.relationshipsRemoved === 0 &&
    summary.foreignKeysCleared === 0
  )
}
