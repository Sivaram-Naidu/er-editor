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

/** Common to every adapter the export dialog can offer, text or image. */
export interface ExportAdapterInfo {
  id: string
  label: string
  extension: string
  mimeType: string
  capabilities: CapabilitySet
  /**
   * A caveat about the FORMAT rather than about any element in the diagram.
   *
   * The loss report is derived per element by comparing usage against `capabilities`, so
   * it can only say things of the form "this entity loses that". A format-level fact —
   * "an image cannot be read back in" — has no element to hang off, and putting it on an
   * arbitrary one would be worse than not saying it. Optional; most formats have nothing
   * to add.
   */
  note?: string
}

export interface ExportAdapter extends ExportAdapterInfo {
  export(diagram: Diagram): ExportResult
}

/**
 * An adapter that writes a picture of the canvas rather than a description of the model.
 *
 * Deliberately NOT an `ExportAdapter`. Its input is a rendered DOM subtree, not a
 * `Diagram` — see the header of `formats/image/export.ts` for why that difference is real
 * and not worth papering over with a union type. The two live in separate registry lists
 * so that `exportAdapters` stays a list of things you can call `export(diagram)` on.
 */
export interface ImageExportAdapter extends ExportAdapterInfo {
  /** Which renderer path to take; the rest of the adapter is metadata. */
  format: 'png' | 'svg'
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
