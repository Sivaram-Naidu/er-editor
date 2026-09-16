// Public surface of the persistence layer.

export { Autosaver, type AutosaveOptions, type AutosaveState, type SaveStatus } from './autosave'
export {
  DexieDiagramRepository,
  InMemoryDiagramRepository,
  LAST_OPENED_KEY,
  SNAP_TO_GRID_KEY,
  THEME_KEY,
  createRepository,
  hasIndexedDb,
  resetSharedRepository,
  sharedRepository,
  type DiagramRecord,
  type DiagramRepository,
  type DiagramSummary,
} from './db'
export {
  hasFileSystemAccess,
  openTextFile,
  saveBlobFile,
  saveTextFile,
  type OpenedFile,
  type SaveBlobOptions,
  type SaveFileOptions,
} from './fileSystem'
export {
  parseDiagramDocument,
  recoverLastSession,
  rememberLastOpened,
  type RecoveryResult,
} from './recovery'
