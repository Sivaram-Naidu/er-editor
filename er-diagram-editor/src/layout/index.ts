// Public surface of the layout layer.
//
// `createLayoutEngine` is async on purpose: the ELK implementation is behind a dynamic
// import so elkjs stays out of the initial bundle (NFR-1.8). Nothing outside this module
// may import from `./elk` directly, or that guarantee is lost.

import type { LayoutEngine } from './LayoutEngine'

export type {
  EdgeRoute,
  LayoutAlgorithm,
  LayoutEngine,
  LayoutRequest,
  LayoutResult,
} from './LayoutEngine'
export { measureAll, measureEntity } from './measure'

export async function createLayoutEngine(): Promise<LayoutEngine> {
  const { ElkLayoutEngine } = await import('./elk/ElkLayoutEngine')
  return new ElkLayoutEngine()
}
