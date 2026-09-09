/**
 * @vitest-environment node
 *
 * No DOM here. Spinning up jsdom per file costs about a second each and this suite has
 * nothing to render — the domain layer is deliberately Node-testable (NFR-6.1).
 */
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Guards against stale files left behind by extracting an archive over a working tree.
 *
 * `tar` only writes; it never deletes. So when a file is renamed between releases — most
 * often `.ts` to `.tsx` — the old copy survives alongside the new one. Two files sharing
 * a basename in one directory cannot both be included by TypeScript's project service,
 * which drops one and makes ESLint report it as "not found by the project service". The
 * duplicated tests also run twice, quietly inflating the count.
 *
 * The failure is confusing enough, and far enough from its cause, to be worth a test
 * that names the offending file directly.
 */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'coverage') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

describe('working tree hygiene', () => {
  it('has no two source files sharing a basename in the same directory', () => {
    const files = [...walk('src'), ...walk('tests')].filter((file) =>
      /\.(ts|tsx|js|jsx)$/.test(file),
    )

    const seen = new Map<string, string[]>()
    for (const file of files) {
      const key = file.replace(/\.(ts|tsx|js|jsx)$/, '')
      seen.set(key, [...(seen.get(key) ?? []), file])
    }

    const clashes = [...seen.values()].filter((group) => group.length > 1)

    expect(
      clashes,
      clashes.length === 0
        ? ''
        : `Delete the stale copy of each of these — they are leftovers from a rename:\n${clashes
            .map((group) => `  ${group.join('  vs  ')}`)
            .join('\n')}`,
    ).toEqual([])
  })
})
