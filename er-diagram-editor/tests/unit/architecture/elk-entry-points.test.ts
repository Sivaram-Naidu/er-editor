/**
 * @vitest-environment node
 *
 * No DOM here. Spinning up jsdom per file costs about a second each and this suite has
 * nothing to render — the domain layer is deliberately Node-testable (NFR-6.1).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Guards which elkjs entry point the app is allowed to load, because picking the wrong one
 * fails in a way nothing else here can see.
 *
 * elkjs ships three, and they are not interchangeable:
 *
 * - `elk-worker.min.js` — the layout engine itself. Designed to BE a worker body: it
 *   assigns `self.onmessage` when it finds itself in one. This is the script to run in a
 *   Worker, and `client.ts` loads it as an asset URL.
 * - `elk-api.js` — the main-thread driver. Marshals requests to a worker you give it via
 *   `workerUrl` or `workerFactory`, and contains no layout code.
 * - `elk.bundled.js` — the two glued together for callers who want neither choice. **This
 *   one must never reach `src/`.** It is a main-thread build whose job is to start a worker
 *   of its own, so:
 *     - inside a Worker it throws `_Worker is not a constructor` at module top level. Its
 *       fallback is `require('./elk-worker.min.js').Worker`, and `elk-worker.min.js`
 *       exports nothing when it is already in a worker — it has installed itself as the
 *       body instead. Auto-layout was broken this way in every browser, dev and production,
 *       for six stages.
 *     - on the main thread it "works", by running layout in an in-process fake worker. That
 *       is worse than throwing: it blocks the main thread, which is the one thing NFR-1.4
 *       exists to prevent, and it would pass every test in this repository.
 *
 * So neither placement of `elk.bundled.js` is acceptable, and one of them is silent. A test
 * that names the import is the cheapest way to say so.
 *
 * `tests/` is deliberately not scanned. `tests/unit/layout` and `tests/perf` both load
 * `elk.bundled.js` on purpose, and that is correct there: Node is not a worker, so the
 * in-process path is exactly what you want when measuring the algorithm rather than the
 * transport.
 */
const FORBIDDEN_IN_SRC = 'elk.bundled'

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

/** Import and re-export specifiers only — a mention in a comment is not a load. */
function importedSpecifiers(source: string): string[] {
  const specifiers: string[] = []
  const pattern =
    /(?:import|export)[\s\S]{0,200}?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]/g

  let match = pattern.exec(source)
  while (match !== null) {
    specifiers.push(match[1] ?? match[2] ?? '')
    match = pattern.exec(source)
  }

  return specifiers
}

describe('elkjs entry points', () => {
  it('never imports elk.bundled.js from src', () => {
    const offenders = sourceFiles('src')
      .map((file) => ({ file, specifiers: importedSpecifiers(readFileSync(file, 'utf8')) }))
      .filter(({ specifiers }) =>
        specifiers.some((specifier) => specifier.includes(FORBIDDEN_IN_SRC)),
      )
      .map(({ file }) => file)

    expect(
      offenders,
      offenders.length === 0
        ? ''
        : `These load elkjs's main-thread bundle, which either throws (in a worker) or ` +
            `blocks the main thread (outside one). Use elk-api.js plus the ` +
            `elk-worker.min.js asset URL, as src/layout/worker/client.ts does:\n` +
            offenders.map((file) => `  ${file}`).join('\n'),
    ).toEqual([])
  })

  it('drives ELK through elk-api.js and the worker asset, from one place only', () => {
    // Not decoration: it is what makes the rule above enforceable. If a second module grew
    // its own ELK, the next person would have two examples to copy and only one of them
    // would be the reviewed one.
    const drivers = sourceFiles('src')
    const apiImporters = drivers.filter((file) =>
      importedSpecifiers(readFileSync(file, 'utf8')).some((specifier) =>
        specifier.includes('elk-api'),
      ),
    )
    const workerImporters = drivers.filter((file) =>
      importedSpecifiers(readFileSync(file, 'utf8')).some((specifier) =>
        specifier.includes('elk-worker'),
      ),
    )

    expect(apiImporters).toEqual([join('src', 'layout', 'worker', 'client.ts')])
    expect(workerImporters).toEqual([join('src', 'layout', 'worker', 'client.ts')])
  })

  it('recognises an import but ignores a mention in prose', () => {
    // The rule scans specifiers rather than raw text because `client.ts` explains the trap
    // at length in its own header comment, naming `elk.bundled.js` several times. A
    // substring search over file contents would fail on the very file that documents it.
    const source = [
      '// elk.bundled.js cannot run inside a worker — see the note.',
      "import ELK from 'elkjs/lib/elk-api.js'",
      "const later = await import('elkjs/lib/elk.bundled.js')",
    ].join('\n')

    expect(importedSpecifiers(source)).toEqual(['elkjs/lib/elk-api.js', 'elkjs/lib/elk.bundled.js'])
  })
})
