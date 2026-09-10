// layered / force / tree presets (FR-3.6).

import type { LayoutAlgorithm } from '../LayoutEngine'

/**
 * `layered` is the Sugiyama pipeline — cycle breaking, layering, crossing minimisation,
 * Brandes-Köpf coordinate assignment. It is the default because a relational schema is
 * mostly a hierarchy of dependencies, and reading one left-to-right by dependency depth
 * is how people actually think about it.
 *
 * `ORTHOGONAL` edge routing is the whole reason ADR-0002 chose ELK over dagre: right
 * angles with computed bend points are far easier to trace at density than curves that
 * cross each other, and tracing is the point of FR-4.1.
 */
const LAYERED: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.edgeRouting': 'ORTHOGONAL',
  // Generous spacing: entity boxes carry text, so cramming them saves pixels and costs
  // legibility, which is the opposite of the trade this tool exists to make.
  'elk.layered.spacing.nodeNodeBetweenLayers': '96',
  'elk.spacing.nodeNode': '56',
  'elk.spacing.edgeNode': '24',
  'elk.layered.spacing.edgeNodeBetweenLayers': '24',
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
  // Disconnected subgraphs are packed rather than left in a diagonal smear — common in a
  // real schema, where lookup tables often relate to nothing.
  'elk.separateConnectedComponents': 'true',
  'elk.spacing.componentComponent': '80',
}

/** For schemas that are more web than hierarchy — many-to-many heavy models. */
const FORCE: Record<string, string> = {
  'elk.algorithm': 'force',
  'elk.force.iterations': '300',
  'elk.spacing.nodeNode': '80',
  'elk.separateConnectedComponents': 'true',
}

/** For strict hierarchies: an ISA tree, or a schema with a single root. */
const TREE: Record<string, string> = {
  'elk.algorithm': 'mrtree',
  'elk.direction': 'DOWN',
  'elk.spacing.nodeNode': '56',
  'elk.separateConnectedComponents': 'true',
}

/**
 * The extra options a split-layer graph needs, merged on top of `LAYERED`.
 *
 * `SIMPLE` node placement is the half that is easy to leave out and does most of the work:
 * `BRANDES_KOEPF` aligns nodes with their edges to straighten them, which spreads a hub's
 * dependents back out over the full height of its edge fan and leaves partitioning worth
 * almost nothing (21134px down to 19125px, measured). `SIMPLE` stacks them instead.
 *
 * It is applied ONLY when a layer actually got split, because straight edges are worth
 * having on every schema that does not have this problem — see `wideLayers.ts`.
 */
const SPLIT_LAYERS: Record<string, string> = {
  'elk.partitioning.activate': 'true',
  'elk.layered.nodePlacement.strategy': 'SIMPLE',
}

export function optionsFor(
  algorithm: LayoutAlgorithm,
  hasSplitLayers = false,
): Record<string, string> {
  if (algorithm === 'force') return FORCE
  if (algorithm === 'tree') return TREE
  // Partitioning is a `layered` feature; the other two ignore it.
  return hasSplitLayers ? { ...LAYERED, ...SPLIT_LAYERS } : LAYERED
}
