# End-to-end tests

Run with `pnpm test:e2e`, which is part of `pnpm verify`. **No browser install is needed** —
`playwright.config.ts` sets `channel: 'chrome'` and uses the Chrome already on the machine.
It also widens the viewport to 1400x900, and says why.

Two files: `smoke.spec.ts` for boot, connect, layout and storage; `interaction.spec.ts` for
the pointer gestures. Shared locators and gestures are in `helpers.ts` — read the note on
`coldClick` before writing a click, and the one on `entity()` before writing a locator.

This suite was written early and then not executed for six stages. On its first run it found
four broken specs and one broken feature (auto-layout, see `NEXT.md`). **A suite that has
never been run is not coverage** — which is why it is in `verify` now rather than optional.

These cover what jsdom cannot:

| Area                            | Why it must be E2E                                                              |
| ------------------------------- | ------------------------------------------------------------------------------- |
| `src/persistence/fileSystem.ts` | File pickers, downloads and the File System Access API have no meaningful fake. |
| Canvas interaction              | Real pointer events, hit testing, and zoom behaviour.                           |
| Performance budgets (NFR-1.x)   | Frame timing is meaningless in jsdom.                                           |

Everything else belongs in `tests/unit`, which runs in a second rather than a minute.

`DexieDiagramRepository` is covered in unit tests via `fake-indexeddb`, but
`tests/e2e/smoke.spec.ts` also asserts IndexedDB exists in a real browser — the fake
would happily pass even if the production assumption were wrong.

Do not wait on the "Saved" indicator to mean the document is durable; it does not. Poll the
store with `waitForPersisted`.
