// The choices the isolate control offers (FR-2.8).
//
// Its own file for the same reason `useApplyTheme` has one: a component module that also
// exports constants loses React Fast Refresh, and the toolbar select is not the only
// caller — the Ctrl+K palette offers the same four choices (FR-9.2). Keeping the list and
// its labels here is what stops the two drifting, which is how `LOD_COMMANDS` in
// `Editor.tsx` already has to carry a comment asking the reader to check Toolbar.tsx.

/** FR-2.8 puts the range at 1-3 hops. Off is the fourth state, and the default. */
export const ISOLATE_DEPTHS = [1, 2, 3] as const

/** `undefined` is off. Singular at one hop, because "1 hops" reads as a bug. */
export function isolateLabel(depth: number | undefined): string {
  return depth === undefined ? 'Off' : `${String(depth)} hop${depth === 1 ? '' : 's'}`
}
