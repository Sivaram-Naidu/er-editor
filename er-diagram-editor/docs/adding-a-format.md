# Adding an export or import format

The NFR-6.4 recipe: one new directory plus one registry line.

1. `src/io/formats/<name>/capabilities.ts` - declare which IR constructs the format can represent.
2. `src/io/formats/<name>/export.ts` - implement `ExportAdapter`.
3. `src/io/formats/<name>/import.ts` - implement `ImportAdapter`, or omit for export-only.
4. `src/io/formats/<name>/index.ts` - assemble and export the adapter.
5. Register it in `src/io/registry.ts`.

Nothing in `domain/`, `render/`, `store/` or `features/` should change. If it does,
the abstraction has leaked - fix that rather than working around it.

## The one format that does not follow this recipe

Image export (PNG/SVG) does not, and cannot. Its input is a rendered DOM subtree rather
than a `Diagram`, so it implements `ImageExportAdapter` and lives in its own registry list
(`imageExportAdapters`) instead of `exportAdapters`. It also needs a component in
`features/export/` — the off-screen surface that renders the whole diagram — which is
exactly the "no changes outside io/" rule broken.

That is a real exception, not a precedent. The reasoning is in `docs/SRS.md` §7.3. If a
format you are adding turns the model into text or bytes, this recipe applies; if it needs
to photograph the renderer, read §7.3 first.

## As built

Exporters: `native-json` (lossless), `mermaid`.
Importers: `native-json`, `mermaid`, `sql`.

`findImportAdapterForFile()` routes by extension. The SQL importer is the one exception
the UI knows about by name, because it is the only format with an option (dialect);
everything else goes through the registry untouched.

The SQL reader is a deliberate **subset** — `CREATE TABLE`, inline and table-level
constraints, and `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY`. Anything else is
counted and reported rather than failing the file: a dump that is 90% readable should
produce 90% of a diagram. If that subset proves too narrow, swapping in a real parser
(node-sql-parser, Apache-2.0) touches `src/io/formats/sql/import.ts` and nothing else.
