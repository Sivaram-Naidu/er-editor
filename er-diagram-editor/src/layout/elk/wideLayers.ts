// Splitting an overfull dependency layer, so a hub does not become a ribbon.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE SHAPE THAT BEATS A HIERARCHICAL LAYOUT
// ─────────────────────────────────────────────────────────────────────────────
//
// `layered` puts every node at its dependency depth, and stacks the nodes that share a
// depth along one axis. That is the right reading for a schema — left to right by what
// depends on what — until one table is referenced by forty others. Those forty all sit at
// the same depth, so they stack into a single column: measured at 838 x 21134 px on a
// 41-table schema, a ribbon that is unreadable at every zoom, at every detail level (708 x
// 3864 even at L0, where boxes are only 42px tall).
//
// This is not an exotic shape. It is every warehouse fact table, and every schema where
// half the tables carry a `user_id`.
//
// None of ELK's own knobs help, and it is worth writing down which, because they all sound
// like they should. Measured, all four produce byte-identical output to the baseline:
//
//   - `elk.aspectRatio` — only consulted by phases that are not running here.
//   - `elk.layered.wrapping.strategy` — wraps a long chain of LAYERS into several rows. Our
//     problem is one layer with too many nodes IN it, which is the other axis entirely.
//   - `elk.layered.highDegreeNodes.treatment` — no effect on this graph.
//   - `elk.layered.nodePlacement.strategy: NETWORK_SIMPLEX` / `SIMPLE` on their own.
//
// (A sanity check with `elk.spacing.nodeNode` DID change the output, so the options were
// reaching ELK — those four genuinely do nothing here.)
//
// What works is to do the layering ourselves and hand ELK the answer: compute each node's
// dependency depth, split any depth that is too crowded into several consecutive
// partitions, and let `elk.partitioning` place them. Measured on the same 41-table schema:
// 838 x 21134 becomes 4036 x 3542 — six times shorter, aspect 0.04 to 1.14, and a higher
// fill than before rather than a sparser diagram.
//
// TWO THINGS THAT LOOK LIKE DETAILS AND ARE NOT
//
// 1. `nodePlacement.strategy` must become `SIMPLE`. With the default `BRANDES_KOEPF`,
//    partitioning buys almost nothing (21134 -> 19125 px): that strategy aligns each node
//    with its edges to straighten them, so it spreads the forty sources back out across
//    the full height of the hub's edge fan. `SIMPLE` just stacks them, which is what makes
//    the partitions actually compact. This is why `options.ts` switches strategy only when
//    a split happens — `SIMPLE` is a real quality loss on schemas that do not need it.
//
// 2. Depth must be DEPENDENCY depth, not breadth-first distance from the hub. A
//    breadth-first walk outward from the hub numbers a dependency chain backwards, so the
//    chain lays out right-to-left while everything else reads left-to-right. Caught by
//    asserting a chain's x-coordinates stay ordered — see `wideLayers.test.ts`.

/** Just the edge shape this needs; `ElkEdge` satisfies it. */
export interface LayerEdge {
  sources: readonly string[]
  targets: readonly string[]
}

/**
 * ELK partition index per node id.
 *
 * **Empty when nothing needed splitting**, and that is load-bearing: an empty map means
 * `toElkGraph` attaches no partition options and `options.ts` leaves the strategy alone, so
 * a schema without a hub gets exactly the layout it got before this existed.
 */
export type LayerPartitions = ReadonlyMap<string, number>

/**
 * Nodes at one depth beyond which the column is worth breaking up.
 *
 * Six because a box is ~500px tall at L2, so seven of them already exceed any screen, and
 * because 6 measured best across the chunk sizes tried (4 through 20).
 */
const MAX_PER_LAYER = 6

/**
 * Dependency depth for every node: the longest path to it from any node with no
 * predecessors.
 *
 * Iterated to a fixed point rather than walked topologically, because a schema may well
 * contain a reference cycle (A references B references A is legal, and the validator only
 * warns). The pass cap makes a cycle terminate at an arbitrary but finite depth instead of
 * spinning.
 */
function dependencyDepths(
  nodeIds: readonly string[],
  edges: readonly LayerEdge[],
): Map<string, number> {
  const predecessors = new Map<string, string[]>(nodeIds.map((id) => [id, []]))

  for (const edge of edges) {
    for (const source of edge.sources) {
      for (const target of edge.targets) {
        if (source === target) continue
        predecessors.get(target)?.push(source)
      }
    }
  }

  const depths = new Map<string, number>(nodeIds.map((id) => [id, 0]))

  for (let pass = 0; pass < nodeIds.length; pass += 1) {
    let changed = false

    for (const id of nodeIds) {
      let deepest = 0
      for (const predecessor of predecessors.get(id) ?? []) {
        deepest = Math.max(deepest, (depths.get(predecessor) ?? 0) + 1)
      }
      // The cap is what stops a cycle: two nodes referencing each other would otherwise
      // push each other one deeper on every pass, for ever.
      if (deepest > (depths.get(id) ?? 0) && deepest < nodeIds.length) {
        depths.set(id, deepest)
        changed = true
      }
    }

    if (!changed) break
  }

  return depths
}

/**
 * Split any dependency layer holding more than `maxPerLayer` nodes into consecutive
 * partitions, so ELK lays a crowded layer out as a block rather than as one column.
 *
 * Returns an empty map when every layer is already comfortable — see `LayerPartitions`.
 */
export function splitWideLayers(
  nodeIds: readonly string[],
  edges: readonly LayerEdge[],
  maxPerLayer: number = MAX_PER_LAYER,
): LayerPartitions {
  if (nodeIds.length === 0) return new Map()

  /*
   * Tables with no relationships at all are excluded, and that keeps the trigger honest.
   * They all land at depth 0, so a schema with a dozen lookup tables would otherwise look
   * like it had a crowded layer and get the whole treatment — including the `SIMPLE` node
   * placement, which costs edge straightness everywhere. They are not laid out by the
   * layering in any case: `elk.separateConnectedComponents` packs each disconnected
   * component separately, which is already the right answer for them.
   *
   * Measured on Pagila (71 tables, 36 foreign keys, most tables unrelated): with them
   * counted, the layout was split and L2 came out 3787x3207; excluded, Pagila is not split
   * at all and keeps exactly the arrangement it had before this existed.
   */
  const connected = new Set<string>()
  for (const edge of edges) {
    for (const source of edge.sources) connected.add(source)
    for (const target of edge.targets) connected.add(target)
  }

  const relevant = nodeIds.filter((id) => connected.has(id))
  if (relevant.length === 0) return new Map()

  const depths = dependencyDepths(relevant, edges)

  // Grouped in `nodeIds` order, so the result is stable for a given diagram rather than
  // dependent on Map iteration or on which entity happened to be added first.
  const byDepth = new Map<number, string[]>()
  for (const id of relevant) {
    const depth = depths.get(id) ?? 0
    const group = byDepth.get(depth)
    if (group === undefined) byDepth.set(depth, [id])
    else group.push(id)
  }

  const widest = Math.max(...[...byDepth.values()].map((group) => group.length))
  if (widest <= maxPerLayer) return new Map()

  const partitions = new Map<string, number>()
  let next = 0

  for (const depth of [...byDepth.keys()].sort((a, b) => a - b)) {
    const group = byDepth.get(depth) ?? []
    /*
     * A near-square block: splitting n nodes into columns of `chunk` gives ceil(n / chunk)
     * columns, so `chunk = sqrt(n)` balances the two. Only crowded layers are split — a
     * layer of three keeps its own partition and its own place in the reading order.
     */
    const chunk = group.length <= maxPerLayer ? group.length : Math.ceil(Math.sqrt(group.length))

    for (let start = 0; start < group.length; start += chunk) {
      for (const id of group.slice(start, start + chunk)) partitions.set(id, next)
      next += 1
    }
  }

  return partitions
}
