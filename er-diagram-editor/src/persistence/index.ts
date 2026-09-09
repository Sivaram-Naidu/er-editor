// Public surface of the persistence layer.

export { Autosaver, type AutosaveOptions, type AutosaveState, type SaveStatus } from './autosave'
export {
  DexieDiagramRepository,
  InMemoryDiagramRepository,
  LAST_OPENED_KEY,
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
  saveTextFile,
  type OpenedFile,
  type SaveFileOptions,
} from './fileSystem'
export {
  parseDiagramDocument,
  recoverLastSession,
  rememberLastOpened,
  type RecoveryResult,
} from './recovery'
