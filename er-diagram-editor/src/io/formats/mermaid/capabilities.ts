// Declared CapabilitySet for Mermaid erDiagram (SRS §7.2 mapping table).
//
// This declaration IS the loss report. Nothing in export.ts logs its own compromises;
// the dialog derives the warnings by comparing what the diagram uses against what is
// stated here, so the two cannot drift apart.

import type { LossExplanations } from '../../capabilities'
import type { CapabilitySet } from '../../types'

export const mermaidCapabilities: CapabilitySet = {
  entity: 'exact',
  attribute: 'exact',
  dataType: 'exact',
  primaryKey: 'exact',
  unique: 'exact',
  nullable: 'exact',
  comment: 'exact',
  foreignKey: 'exact',
  binaryRelationship: 'exact',
  cardinality: 'exact',
  participation: 'exact',
  identifyingRelationship: 'exact',
  recursiveRelationship: 'exact',

  // Mermaid has no notion of a weak entity. The entity survives; the fact that it is
  // weak becomes a comment.
  weakEntity: 'approximated',
  multivaluedAttribute: 'approximated',
  derivedAttribute: 'approximated',
  compositeAttribute: 'approximated',
  isaHierarchy: 'approximated',

  // An n-ary relationship becomes an associative entity plus N binary relationships,
  // which is the standard relational resolution — the meaning survives, the shape does not.
  naryRelationship: 'decomposed',
  relationshipAttribute: 'decomposed',

  // Mermaid lays out the diagram itself; there is nowhere to put coordinates.
  position: 'dropped',
  group: 'dropped',
}

export const mermaidExplanations: LossExplanations = {
  weakEntity: 'Mermaid has no weak-entity notation. Exported as an ordinary entity with a note.',
  multivaluedAttribute: 'Kept as a field, with "multivalued" appended to its comment.',
  derivedAttribute: 'Kept as a field, with "derived" appended to its comment.',
  compositeAttribute: 'Flattened to parent_child fields; the grouping is lost.',
  isaHierarchy: 'Exported as a plain relationship to the supertype; the ISA semantics are lost.',
  naryRelationship:
    'Split into an associative entity plus one relationship per participant, which is how it would be built relationally.',
  relationshipAttribute: 'Moved onto the generated associative entity.',
  position: 'Mermaid computes its own layout, so node positions are not exported.',
  group: 'Mermaid has no subject areas; grouping is not exported.',
}
