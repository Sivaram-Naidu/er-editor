// Public surface of the render layer.

export { Canvas, type CanvasProps } from './reactflow/Canvas'
export {
  EditorActionsProvider,
  useEditorActions,
  type EditorActions,
} from './reactflow/EditorActions'
export {
  applySelectionChanges,
  fallbackPosition,
  inFlightPositions,
  measuredDimensions,
  overlayNodes,
  reuseUnchanged,
  settledPositions,
  sizesUnchanged,
  traceSets,
  type Size,
  type TraceSets,
} from './reactflow/trace'
export {
  alignDrag,
  alignmentGuides,
  sameGuides,
  type Alignment,
  type DragAlignment,
  type DragAlignmentRequest,
  type Guide,
  type Rect,
} from './reactflow/overlays/alignment'
export { AlignmentGuides, type AlignmentGuidesProps } from './reactflow/overlays/AlignmentGuides'
export type { PaneSize } from './reactflow/SurfaceObserver'
export { EntityNode, type EntityNodeData } from './reactflow/nodes/EntityNode'
export { AttributeRow } from './reactflow/nodes/AttributeRow'
export { RelationshipEdge, type RelationshipEdgeData } from './reactflow/edges/RelationshipEdge'
export { readRelationship } from './reactflow/edges/readRelationship'
export { CrowsFootMarkers, tracedMarkerId } from './reactflow/edges/endpoints'
export { effectiveLod, entityLod, lodForZoom, type LodLevel } from './lod'
export { compactNotation, compactBadges, describeEnd, markerFor } from './notation/compact'
export type { AttributeBadge, NotationSet } from './notation/NotationSet'
