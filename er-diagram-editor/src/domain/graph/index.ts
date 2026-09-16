// Public surface of the graph module.

export {
  incidentRelationships,
  isRecursive,
  neighbours,
  orphanEntities,
  relationshipBetween,
  relationshipEndpoints,
} from './adjacency'
export { findAttribute, findEntity, findRelationship, indexOf } from './indexes'
export type { AttributeLocation, DiagramIndex } from './indexes'
export { connectedComponents, isolate, nHopNeighbourhood } from './traversal'
export type { Isolation, Neighbourhood } from './traversal'
