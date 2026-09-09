// ExportAdapter, ImportAdapter, LossItem, CapabilitySet (SRS §7.1).

import type { Diagram } from '../domain'

/**
 * IR constructs a format may or may not be able to express.
 *
 * Declared per adapter rather than discovered by trying, so the export dialog can warn
 * the user BEFORE they commit (FR-6.3). The list is the union of everything the IR can
 * hold; adding a construct to the model means adding it here, which is deliberate —
 * it forces every adapter to state a position on it.
 */
export type Construct =
  | 'entity'
  | 'weakEntity'
  | 'attribute'
  | 'dataType'
  | 'primaryKey'
  | 'unique'
  | 'nullable'
  | 'comment'
  | 'foreignKey'
  | 'multivaluedAttribute'
  | 'derivedAttribute'
  | 'compositeAttribute'
  | 'binaryRelationship'
  | 'naryRelationship'
  | 'relationshipAttribute'
  | 'identifyingRelationship'
  | 'cardinality'
  | 'participation'
  | 'recursiveRelationship'
  | 'isaHierarchy'
  | 'group'
  | 'position'

/** How faithfully an adapter handles a construct. */
export type Fidelity =
  /** Represented exactly; round-trips. */
  | 'exact'
  /** Kept, but in a weaker form — a comment, a flattened name. */
  | 'approximated'
  /** Restructured into something the format can hold, preserving meaning. */
  | 'decomposed'
  /** Not representable. Discarded. */
  | 'dropped'

export type CapabilitySet = Record<Construct, Fidelity>

export interface LossItem {
  elementId: string
  elementKind: 'entity' | 'attribute' | 'relationship' | 'diagram'
  /** Human-readable name of the element, for the report. */
  elementLabel: string
  construct: Construct
  treatment: Exclude<Fidelity, 'exact'>
  /** What actually happened to it, in plain words. */
  detail: string
}

export interface ExportResult {
  content: string
  /** Populated for FR-6.3. Empty means the export was lossless. */
  lossReport: LossItem[]
}

export interface ExportAdapter {
  id: string
  label: string
  extension: string
  mimeType: string
  capabilities: CapabilitySet
  export(diagram: Diagram): ExportResult
}

export interface ImportResult {
  diagram: Diagram
  warnings: string[]
}

export interface ImportAdapter {
  id: string
  label: string
  extension: string
  import(content: string): ImportResult
}
