import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    // `node`, not `jsdom`, and deliberately so. jsdom costs ~1s of setup per test FILE,
    // and most suites here have nothing to render — the domain layer is Node-testable by
    // design (NFR-6.1). With jsdom as the default every file paid for it whether or not
    // it touched the DOM: 110s of environment setup inside a 48s wall-clock run, which
    // Vitest itself prints a hint about on every invocation.
    //
    // The eight files that DO mount components opt back up with a
    // `@vitest-environment jsdom` docblock on line 1. That is the right direction for the
    // default to point: a new DOM-free suite is fast without anyone remembering to make
    // it so, and a file that forgets the docblock fails loudly on `document` rather than
    // quietly taxing the suite.
    environment: 'node',
    globals: true,
    // Vitest's default is 5s, which is ample for an uninstrumented run and marginal under
    // `--coverage`: v8 instrumentation roughly triples the cost of the app suites, which
    // mount the whole editor and drive a dozen real interactions, and they then contend
    // with 27 other workers on the same cores. `tests/unit/app/authoring.test.tsx` was
    // landing at 5.3s and failing the coverage run while passing `pnpm test`.
    //
    // 15s, not "off": a test that genuinely hangs — an await that never settles, a
    // `waitFor` on a condition that will never hold — still fails rather than wedging the
    // run. If a test needs more than this, the test is doing too much.
    testTimeout: 15_000,
    setupFiles: ['./tests/setup.ts'],
    // `.spec.ts` is reserved for Playwright; Vitest takes `.test.ts` only, so the two
    // runners cannot pick up each other's files.
    include: ['tests/**/*.test.{ts,tsx}'],
    // Perf tests are slow and machine-dependent; run them with `pnpm test:perf`.
    exclude: ['tests/e2e/**', 'tests/perf/**'],
    coverage: {
      provider: 'v8',
      // NFR-6.3 targets domain and io. Store, persistence and lib are included too:
      // they now hold real logic (command wiring, autosave serialisation, LOD hysteresis)
      // and are just as testable without a browser.
      include: [
        'src/domain/**',
        'src/io/**',
        'src/store/**',
        'src/persistence/**',
        'src/lib/**',
        'src/render/**',
        'src/features/**',
      ],
      exclude: [
        // Stylesheets are not executable code; v8 reports them as 0% and drags the
        // aggregate down for no signal.
        '**/*.css',
        // Re-export barrels. Counting them rewards adding exports and punishes nothing.
        '**/index.ts',
        // Type-only; erased at runtime, so it can never register a covered line.
        'src/domain/model/types.ts',
        // Browser-only: file pickers, downloads and the File System Access API have no
        // meaningful fake. Covered by tests/e2e — see tests/e2e/README.md.
        'src/persistence/fileSystem.ts',
        // Not yet implemented. Remove these as each lands, so the gate rises with the
        // code rather than being quietly lowered to accommodate it.
        //
        // `src/domain/validation/**` came off the list when the rule set landed.
        // `validate.ts` stays: it holds no runtime code and is not going to — see the
        // note in the file for why FR-8.5 needed no middleware.
        'src/store/middleware/validate.ts',
        // Component shells whose behaviour is geometry and pointer events — meaningless
        // to assert in jsdom. Covered by tests/e2e. The pure logic they call
        // (trace.ts, lod.ts, notation) is unit-tested and stays in scope.
        'src/render/reactflow/Canvas.tsx',
        'src/render/reactflow/SurfaceObserver.tsx',
        'src/render/notation/chen/**',
        // Browser-only: constructs a real Worker, which jsdom does not provide. The
        // layout it drives is covered in tests/unit/layout against the real ELK library,
        // and the budget in tests/perf.
        //
        // This exclusion was previously worded as deferring to "a real Worker and a
        // dynamic elkjs import" — and constructing that worker was precisely what did not
        // work, for six stages, because nothing browser-side ever ran. What backs it now
        // is `tests/e2e/smoke.spec.ts`, which drives Auto-layout in Chrome and asserts the
        // boxes actually move. If you widen what lives behind this line, widen that spec
        // in the same change.
        'src/layout/worker/**',
        'src/layout/elk/ElkLayoutEngine.ts',
        'src/features/editor/useAutoLayout.ts',
        // Layout shells: markup and store wiring, exercised through the app tests rather
        // than measured line by line.
        'src/features/editor/Editor.tsx',
        'src/features/editor/Toolbar.tsx',
        'src/features/editor/EmptyState.tsx',
        'src/features/diagram-manager/DiagramMenu.tsx',
        'src/features/export/ExportDialog.tsx',
        'src/features/import/ImportDialog.tsx',
        // Rasterisation: html-to-image walks the real DOM, inlines computed styles and
        // encodes a <canvas>. jsdom has no canvas and no layout, so there is nothing here
        // a unit test could assert that would not be asserting the mock. The arithmetic
        // it depends on is factored out and IS tested — `io/formats/image/limits.ts` and
        // `features/export/bounds.ts` both stay in scope. The rest is tests/e2e.
        'src/io/formats/image/export.ts',
        'src/features/export/ExportSurface.tsx',
        // Interface-only: no runtime code to execute.
        'src/render/notation/NotationSet.ts',
        // Empty by design until V2 (SRS §8.2).
        'src/domain/model/migrations/**',
      ],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
})
