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

export function optionsFor(algorithm: LayoutAlgorithm): Record<string, string> {
  if (algorithm === 'force') return FORCE
  if (algorithm === 'tree') return TREE
  return LAYERED
}
