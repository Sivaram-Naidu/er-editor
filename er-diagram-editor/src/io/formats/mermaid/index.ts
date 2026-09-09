// Mermaid adapter registration.

import type { ExportAdapter, ImportAdapter } from '../../types'

import { mermaidCapabilities } from './capabilities'
import { exportMermaid } from './export'

export const mermaidAdapter: ExportAdapter = {
  id: 'mermaid',
  label: 'Mermaid (.mmd)',
  extension: '.mmd',
  mimeType: 'text/vnd.mermaid',
  capabilities: mermaidCapabilities,
  export: exportMermaid,
}

import { importMermaid } from './import'

export const mermaidImporter: ImportAdapter = {
  id: 'mermaid',
  label: 'Mermaid ER diagram (.mmd)',
  extension: '.mmd',
  import: importMermaid,
}

export { exportMermaid } from './export'
export { importMermaid } from './import'
export { mermaidCapabilities, mermaidExplanations } from './capabilities'
