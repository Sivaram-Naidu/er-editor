// Selection + hover. Separated so 60Hz hover never re-renders the model tree.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS IS NOT PART OF diagramStore
// ─────────────────────────────────────────────────────────────────────────────
//
// Hover changes on every pointer move across a connector — tens of updates per second.
// If hover lived alongside `diagram`, every component subscribed to the model would be
// re-evaluated at pointer rate. At 120 entities that is the difference between meeting
// NFR-1.1 (55 FPS sustained) and not.
//
// Splitting the store means a component can subscribe to hover WITHOUT subscribing to
// the model, and vice versa. It is the cheapest structural decision available for the
// hover-highlight requirement (FR-4.1, FR-4.2), and it has to be made before the
// renderer exists rather than retrofitted after it is slow.

import { create, type StoreApi, type UseBoundStore } from 'zustand'

import type { AttributeId, EntityId, RelationshipId } from '../domain'

export interface SelectionState {
  selectedEntityIds: ReadonlySet<EntityId>
  selectedRelationshipIds: ReadonlySet<RelationshipId>
  /** The field being edited in the inspector. Scoped to the selected entity. */
  selectedAttributeId: AttributeId | undefined
  hoveredEntityId: EntityId | undefined
  hoveredRelationshipId: RelationshipId | undefined
  /** Sticky highlight: survives pointer-out so the user can pan while tracing (FR-4.4). */
  pinnedHighlightRelationshipId: RelationshipId | undefined

  selectEntities: (ids: readonly EntityId[], additive?: boolean) => void
  selectRelationships: (ids: readonly RelationshipId[], additive?: boolean) => void
  toggleEntity: (id: EntityId) => void
  selectAttribute: (id: AttributeId | undefined) => void
  clearSelection: () => void

  setHoveredEntity: (id: EntityId | undefined) => void
  setHoveredRelationship: (id: RelationshipId | undefined) => void
  setPinnedHighlight: (id: RelationshipId | undefined) => void

  /** Drop references to elements that no longer exist, after a delete or an undo. */
  reconcile: (
    entityIds: ReadonlySet<EntityId>,
    relationshipIds: ReadonlySet<RelationshipId>,
  ) => void
}

const EMPTY_ENTITIES: ReadonlySet<EntityId> = new Set()
const EMPTY_RELATIONSHIPS: ReadonlySet<RelationshipId> = new Set()

function union<T>(existing: ReadonlySet<T>, incoming: readonly T[]): Set<T> {
  const next = new Set(existing)
  for (const id of incoming) next.add(id)
  return next
}

export type SelectionStore = UseBoundStore<StoreApi<SelectionState>>

export function createSelectionStore(): SelectionStore {
  return create<SelectionState>()((set, get) => ({
    selectedEntityIds: EMPTY_ENTITIES,
    selectedRelationshipIds: EMPTY_RELATIONSHIPS,
    selectedAttributeId: undefined,
    hoveredEntityId: undefined,
    hoveredRelationshipId: undefined,
    pinnedHighlightRelationshipId: undefined,

    selectEntities: (ids, additive = false) => {
      const current = get()
      const next = additive ? union(current.selectedEntityIds, ids) : new Set(ids)

      set({
        selectedEntityIds: next,
        // Selecting an entity clears a relationship selection: the inspector shows one
        // kind of thing at a time, and a mixed selection has no coherent property set.
        ...(additive ? {} : { selectedRelationshipIds: EMPTY_RELATIONSHIPS }),
        // The field selection belongs to the entity that owns it. Moving to a different
        // entity must drop it, or the inspector would show a field from the box the
        // user just left.
        ...(next.size === 1 && ids[0] !== undefined && current.selectedEntityIds.has(ids[0])
          ? {}
          : { selectedAttributeId: undefined }),
      })
    },

    selectAttribute: (id) => {
      if (get().selectedAttributeId !== id) set({ selectedAttributeId: id })
    },

    selectRelationships: (ids, additive = false) => {
      set({
        selectedRelationshipIds: additive
          ? union(get().selectedRelationshipIds, ids)
          : new Set(ids),
        ...(additive ? {} : { selectedEntityIds: EMPTY_ENTITIES, selectedAttributeId: undefined }),
      })
    },

    toggleEntity: (id) => {
      const next = new Set(get().selectedEntityIds)
      if (!next.delete(id)) next.add(id)
      set({ selectedEntityIds: next })
    },

    clearSelection: () => {
      set({
        selectedEntityIds: EMPTY_ENTITIES,
        selectedRelationshipIds: EMPTY_RELATIONSHIPS,
        selectedAttributeId: undefined,
      })
    },

    setHoveredEntity: (id) => {
      // Guarded so a pointer-move that stays on the same element writes nothing. Zustand
      // notifies on every `set`, identical value or not, so without this the hot path
      // would still wake every subscriber.
      if (get().hoveredEntityId !== id) set({ hoveredEntityId: id })
    },

    setHoveredRelationship: (id) => {
      if (get().hoveredRelationshipId !== id) set({ hoveredRelationshipId: id })
    },

    setPinnedHighlight: (id) => {
      set({ pinnedHighlightRelationshipId: id })
    },

    reconcile: (entityIds, relationshipIds) => {
      const state = get()
      const entities = [...state.selectedEntityIds].filter((id) => entityIds.has(id))
      const relationships = [...state.selectedRelationshipIds].filter((id) =>
        relationshipIds.has(id),
      )

      const patch: Partial<SelectionState> = {}
      if (entities.length !== state.selectedEntityIds.size) {
        patch.selectedEntityIds = new Set(entities)
      }
      if (relationships.length !== state.selectedRelationshipIds.size) {
        patch.selectedRelationshipIds = new Set(relationships)
      }
      if (state.hoveredEntityId !== undefined && !entityIds.has(state.hoveredEntityId)) {
        patch.hoveredEntityId = undefined
      }
      if (
        state.hoveredRelationshipId !== undefined &&
        !relationshipIds.has(state.hoveredRelationshipId)
      ) {
        patch.hoveredRelationshipId = undefined
      }
      if (
        state.pinnedHighlightRelationshipId !== undefined &&
        !relationshipIds.has(state.pinnedHighlightRelationshipId)
      ) {
        patch.pinnedHighlightRelationshipId = undefined
      }

      if (Object.keys(patch).length > 0) set(patch)
    },
  }))
}

export const useSelectionStore = createSelectionStore()
