// Plain-English reading of a relationship, for the hover tooltip (FR-4.3).
//
// Split from the component so RelationshipEdge.tsx exports components only, which is
// what React Fast Refresh needs to preserve state across edits.

import { describeEnd } from '../../notation/compact'

import type { RelationshipEdgeData } from './RelationshipEdge'

/** "Each CUSTOMER places zero or more ORDER" — the FR-4.3 tooltip, in prose. */
export function readRelationship(data: RelationshipEdgeData): string {
  const { relationship, sourceName, targetName } = data
  const [from, to] = relationship.participants
  if (from === undefined || to === undefined) return relationship.name

  const verb = relationship.name === '' ? 'relates to' : relationship.name
  return `Each ${sourceName || 'entity'} ${verb} ${describeEnd(to.cardinality, to.participation)} ${targetName || 'entity'}`
}
