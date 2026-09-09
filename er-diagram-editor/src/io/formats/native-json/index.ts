// Native JSON adapter registration.

import type { ExportAdapter, ImportAdapter } from '../../types'

import { exportNativeJson } from './export'
import { importNativeJson } from './import'

/** Everything is exact: this format IS the IR. */
const lossless = {
  entity: 'exact',
  weakEntity: 'exact',
  attribute: 'exact',
  dataType: 'exact',
  primaryKey: 'exact',
  unique: 'exact',
  nullable: 'exact',
  comment: 'exact',
  foreignKey: 'exact',
  multivaluedAttribute: 'exact',
  derivedAttribute: 'exact',
  compositeAttribute: 'exact',
  binaryRelationship: 'exact',
  naryRelationship: 'exact',
  relationshipAttribute: 'exact',
  identifyingRelationship: 'exact',
  cardinality: 'exact',
  participation: 'exact',
  recursiveRelationship: 'exact',
  isaHierarchy: 'exact',
  group: 'exact',
  position: 'exact',
} as const

export const nativeJsonAdapter: ExportAdapter = {
  id: 'native-json',
  label: 'Diagram file (.erd.json)',
  extension: '.erd.json',
  mimeType: 'application/json',
  capabilities: lossless,
  export: exportNativeJson,
}

export const nativeJsonImporter: ImportAdapter = {
  id: 'native-json',
  label: 'Diagram file (.erd.json)',
  extension: '.erd.json',
  import: importNativeJson,
}

export { exportNativeJson } from './export'
export { importNativeJson } from './import'
