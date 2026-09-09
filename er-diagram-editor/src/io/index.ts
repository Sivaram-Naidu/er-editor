// Public surface of the io layer.

export { computeLoss, usedConstructs, type LossExplanations } from './capabilities'
export { parseDiagramDocument, type ParseDocumentResult } from './parseDocument'
export {
  exportAdapters,
  findExportAdapter,
  findImportAdapterForFile,
  importAdapters,
} from './registry'
export type {
  CapabilitySet,
  Construct,
  ExportAdapter,
  ExportResult,
  Fidelity,
  ImportAdapter,
  ImportResult,
  LossItem,
} from './types'
export { mermaidAdapter, mermaidImporter, exportMermaid, importMermaid } from './formats/mermaid'
export { sqlImporter, importSql, detectDialect, type SqlDialect } from './formats/sql'
export { nativeJsonAdapter, nativeJsonImporter } from './formats/native-json'
