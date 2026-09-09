/**
 * @vitest-environment node
 *
 * No DOM here. Spinning up jsdom per file costs about a second each and this suite has
 * nothing to render — the domain layer is deliberately Node-testable (NFR-6.1).
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ESLint } from 'eslint'
import { afterAll, describe, expect, it } from 'vitest'

/**
 * Guards the SRS §8.1 dependency rule.
 *
 * Two ESLint rules enforce it — `import-x/no-restricted-paths` for relative imports and
 * `@typescript-eslint/no-restricted-imports` for `@/` alias imports. This test proves both
 * halves are live. Without it, a config refactor could silently disable enforcement and
 * nothing would fail, because a correctly-layered codebase produces no errors either way.
 *
 * Probes are written as real files inside the layer under test, because typescript-eslint's
 * project service will not parse a path that does not exist on disk — and an unparsed file
 * reports no rule violations, which would make every "rejects" case pass vacuously.
 */

const LINT_TIMEOUT_MS = 60_000

// One ESLint instance for the file, and one probe FILE reused for every case.
//
// The first lint pays typescript-eslint's project-service cold start — around 15s on a
// cold cache. Creating a fresh temp directory per case made that cost recur, because a
// path the service has never seen forces it to re-resolve the project. Rewriting one
// known path keeps the service warm and takes the file from ~30s to a couple of seconds.
const eslint = new ESLint({ cwd: process.cwd() })
const scratch = new Set<string>()

const probeDirs = new Map<string, string>()

function probeDir(layer: string): string {
  const existing = probeDirs.get(layer)
  if (existing !== undefined) return existing

  const dir = mkdtempSync(join(process.cwd(), 'src', layer, '__probe-'))
  probeDirs.set(layer, dir)
  scratch.add(dir)
  return dir
}

async function boundaryErrors(layer: string, specifier: string): Promise<string[]> {
  const file = join(probeDir(layer), 'probe.ts')
  writeFileSync(file, `import type {} from '${specifier}'\nexport const x = 1\n`)
  const results = await eslint.lintFiles([file])
  const messages = results.flatMap((r) => r.messages)

  const fatal = messages.filter((m) => m.fatal)
  if (fatal.length > 0) {
    throw new Error(`Probe failed to parse — test is invalid: ${fatal[0]?.message ?? ''}`)
  }

  return messages
    .filter(
      (m) =>
        m.ruleId === 'import-x/no-restricted-paths' ||
        m.ruleId === '@typescript-eslint/no-restricted-imports',
    )
    .map((m) => m.message)
}

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true })
})

/** [layer, path relative to src] */
const FORBIDDEN: ReadonlyArray<[string, string]> = [
  ['domain', 'render/lod'],
  ['domain', 'store/uiStore'],
  ['domain', 'io/registry'],
  ['domain', 'features/editor'],
  ['io', 'render/lod'],
  ['layout', 'store/uiStore'],
  ['render', 'store/uiStore'],
  ['render', 'io/registry'],
  ['render', 'features/editor'],
  ['store', 'render/lod'],
  ['store', 'features/editor'],
  ['ui', 'domain/model/types'],
  ['lib', 'domain/model/types'],
]

const ALLOWED: ReadonlyArray<[string, string]> = [
  ['io', 'domain/model/types'],
  ['layout', 'domain/model/types'],
  ['render', 'domain/model/types'],
  ['render', 'layout/measure'],
  ['persistence', 'io/registry'],
  ['persistence', 'domain/model/types'],
  ['store', 'domain/model/types'],
  ['features', 'domain/model/types'],
  ['features', 'render/lod'],
  ['features', 'store/uiStore'],
  ['domain', 'lib/id'],
]

// Probe files live one directory deeper than the layer root, so '../..' reaches src.
const relative = (target: string) => `../../${target}`
const aliased = (target: string) => `@/${target}`

describe.each([
  ['relative', relative],
  ['@/ alias', aliased],
])('SRS §8.1 dependency rule — %s imports', (_form, toSpecifier) => {
  it.each(FORBIDDEN)(
    'rejects %s importing %s',
    async (layer, target) => {
      expect(await boundaryErrors(layer, toSpecifier(target))).not.toHaveLength(0)
    },
    // Generous: the first probe pays ESLint's project-service cold start.
    LINT_TIMEOUT_MS,
  )

  it.each(ALLOWED)(
    'permits %s importing %s',
    async (layer, target) => {
      expect(await boundaryErrors(layer, toSpecifier(target))).toEqual([])
    },
    LINT_TIMEOUT_MS,
  )
})
