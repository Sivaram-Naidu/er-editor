# End-to-end tests

Run with `pnpm test:e2e`. Requires browsers: `pnpm exec playwright install chromium`.

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
