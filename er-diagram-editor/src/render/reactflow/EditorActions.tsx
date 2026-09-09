// Editing callbacks, supplied to nodes through context rather than through node data.
//
// React Flow rebuilds `node.data` whenever the diagram changes. Putting callbacks there
// would give every node a new `data` object on every keystroke, defeating the `memo` on
// EntityNode and re-rendering all 120 boxes to change one name. Context keeps the
// callback identities stable across renders, so only the node whose data actually
// changed re-renders.

import { createContext, useContext } from 'react'

import type { AttributeId, EntityId } from '../../domain'

export interface EditorActions {
  renameEntity: (entityId: EntityId, name: string) => void
  addAttribute: (entityId: EntityId) => void
  renameAttribute: (entityId: EntityId, attributeId: AttributeId, name: string) => void
  selectAttribute: (entityId: EntityId, attributeId: AttributeId) => void
}

const noop = (): void => {
  // A canvas rendered outside a provider is read-only rather than broken. Used by tests
  // that mount a single node, and by any future print/export view.
}

const EditorActionsContext = createContext<EditorActions>({
  renameEntity: noop,
  addAttribute: noop,
  renameAttribute: noop,
  selectAttribute: noop,
})

export const EditorActionsProvider = EditorActionsContext.Provider

export function useEditorActions(): EditorActions {
  return useContext(EditorActionsContext)
}
