// Restore last autosaved state on reload (FR-7.3).
//
// `parseDiagramDocument` lives in `io` — see the note there. Re-exported here so callers
// reading from storage do not need to know which layer owns the parser.

import type { Diagram, DiagramId } from '../domain/model'

import { LAST_OPENED_KEY, type DiagramRepository } from './db'

export interface RecoveryResult {
  diagram: Diagram | undefined
  /** Set when a document existed but could not be restored, so the UI can say why. */
  problem: string | undefined
}

/**
 * Attempt to restore the session the user last had open.
 *
 * Failure is reported, never thrown. A corrupt autosave must not prevent the app from
 * starting — FR-7.3 requires an explicit "discard and start new" path, and the user can
 * only take it if the app loads far enough to offer it.
 */
export async function recoverLastSession(repository: DiagramRepository): Promise<RecoveryResult> {
  try {
    const lastId = await repository.getPreference<DiagramId>(LAST_OPENED_KEY)
    if (lastId === undefined) return { diagram: undefined, problem: undefined }

    const diagram = await repository.get(lastId)
    if (diagram === undefined) {
      return {
        diagram: undefined,
        problem: 'The last opened diagram could not be read and may be corrupted.',
      }
    }

    return { diagram, problem: undefined }
  } catch (error) {
    return {
      diagram: undefined,
      problem: error instanceof Error ? error.message : 'Storage is unavailable.',
    }
  }
}

export async function rememberLastOpened(
  repository: DiagramRepository,
  id: DiagramId,
): Promise<void> {
  await repository.setPreference(LAST_OPENED_KEY, id)
}

export { parseDiagramDocument } from '../io'
