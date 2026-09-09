# Applying a new stage archive

```powershell
cd <parent folder>
tar -xzf er-diagram-editor-<stage>.tar.gz
cd er-diagram-editor
pnpm install          # only when the stage says a dependency changed
pnpm typecheck ; pnpm lint ; pnpm test ; pnpm build
```

## Stale files

`tar` only writes. It never deletes. So when a file is **renamed** between stages, the
old copy survives next to the new one, and the symptoms are confusing:

- `pnpm lint` reports `... was not found by the project service` — TypeScript cannot
  include two files with the same basename in one directory, so it silently drops one.
- `pnpm test` reports **more** tests than the stage notes claim, because a duplicated
  suite runs twice.

`tests/unit/architecture/no-stale-files.test.ts` fails with the exact paths when this
happens. Delete the older copy of each pair it names.

Known renames so far:

| Stage | Delete                                                    |
| ----- | --------------------------------------------------------- |
| 6b    | `tests/unit/render/notation.test.ts` (replaced by `.tsx`) |

## Clean reinstall

If the tree gets into a state you do not trust, delete the folder and extract fresh.
`pnpm install` is fast the second time — packages are hard-linked from the global store
at `%LOCALAPPDATA%\pnpm\store`, so nothing is re-downloaded.

## Scripts

| Command              | What it does                                                               |
| -------------------- | -------------------------------------------------------------------------- |
| `pnpm verify`        | typecheck, lint, unit tests, build — the one to run after applying a stage |
| `pnpm dev`           | dev server                                                                 |
| `pnpm test`          | unit tests only                                                            |
| `pnpm test:coverage` | unit tests with the 80% gate                                               |
| `pnpm test:perf`     | layout performance budgets (slow, machine-dependent, run deliberately)     |
| `pnpm test:e2e`      | Playwright — needs `pnpm exec playwright install chromium` first           |
