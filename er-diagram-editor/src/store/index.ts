// Public surface of the store layer.

export {
  createDiagramStore,
  useDiagramStore,
  type DiagramStore,
  type DiagramStoreOptions,
  type DiagramStoreState,
} from './diagramStore'
export {
  createSelectionStore,
  useSelectionStore,
  type SelectionState,
  type SelectionStore,
} from './selectionStore'
export {
  ZOOM_MAX,
  ZOOM_MIN,
  createViewportStore,
  useViewportStore,
  viewportCenter,
  type ViewportState,
  type ViewportStore,
} from './viewportStore'
export {
  createUiStore,
  useUiStore,
  type DialogId,
  type Theme,
  type UiState,
  type UiStore,
} from './uiStore'
export {
  attachAutosave,
  type AttachAutosaveOptions,
  type AutosaveHandle,
} from './middleware/autosave'
