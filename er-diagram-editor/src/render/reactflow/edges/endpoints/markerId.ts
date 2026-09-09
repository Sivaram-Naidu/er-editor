// Traced-variant marker ids.
//
// Split from the component file so that exports components only, which React Fast
// Refresh needs to preserve state across edits.

/** Suffix appended to a marker id for its traced variant. */
export const TRACED_SUFFIX = '-traced'

export function tracedMarkerId(id: string): string {
  return `${id}${TRACED_SUFFIX}`
}
