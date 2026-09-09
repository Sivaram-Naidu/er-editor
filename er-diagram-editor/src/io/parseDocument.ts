// Validate an untrusted diagram document (NFR-7.2, NFR-5.6).
//
// Lives in `io` rather than `persistence` because parsing a document is what this layer
// is for, and both callers need it: `persistence` when reading a storage row that may
// have been written by an older build, and the native-json importer when reading a file
// the user chose. `persistence` may depend on `io`, so putting it here works in both
// directions; the reverse did not, and the §8.1 boundary rule said so.

import { DiagramSchema, type Diagram } from '../domain'

export type ParseDocumentResult = { ok: true; diagram: Diagram } | { ok: false; problem: string }

/**
 * Migrations run before validation once `src/domain/model/migrations/` is populated;
 * V1 has nothing to migrate, so this is a straight parse.
 */
export function parseDiagramDocument(raw: unknown): ParseDocumentResult {
  const parsed = DiagramSchema.safeParse(raw)
  if (parsed.success) return { ok: true, diagram: parsed.data }

  const first = parsed.error.issues[0]
  const where = first === undefined || first.path.length === 0 ? '' : ` at ${first.path.join('.')}`
  return { ok: false, problem: `${first?.message ?? 'Invalid diagram document'}${where}` }
}
