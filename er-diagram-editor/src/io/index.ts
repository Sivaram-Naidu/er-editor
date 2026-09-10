// Public surface of the io layer.

export { computeLoss, usedConstructs, type LossExplanations } from './capabilities'
export { parseDiagramDocument, type ParseDocumentResult } from './parseDocument'
export {
  exportAdapters,
  findExportAdapter,
  findImageExportAdapter,
  findImportAdapterForFile,
  imageExportAdapters,
  importAdapters,
} from './registry'
export type {
  CapabilitySet,
  Construct,
  ExportAdapter,
  ExportAdapterInfo,
  ExportResult,
  Fidelity,
  ImageExportAdapter,
  ImportAdapter,
  ImportResult,
  LossItem,
} from './types'
export { mermaidAdapter, mermaidImporter, exportMermaid, importMermaid } from './formats/mermaid'
export { sqlImporter, importSql, detectDialect, type SqlDialect } from './formats/sql'
export { nativeJsonAdapter, nativeJsonImporter } from './formats/native-json'
export {
  MAX_IMAGE_SIDE,
  fitToLimit,
  imageCapabilities,
  imageExplanations,
  pngAdapter,
  renderImage,
  svgAdapter,
  type ImageFit,
  type ImageFormat,
  type ImageRenderRequest,
} from './formats/image'
