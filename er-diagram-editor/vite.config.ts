import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  worker: { format: 'es' },
  test: {
    environment: 'jsdom',
    globals: true,
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
        'src/domain/validation/**',
        'src/store/middleware/validate.ts',
        // Component shells whose behaviour is geometry and pointer events — meaningless
        // to assert in jsdom. Covered by tests/e2e. The pure logic they call
        // (trace.ts, lod.ts, notation) is unit-tested and stays in scope.
        'src/render/reactflow/Canvas.tsx',
        'src/render/notation/chen/**',
        // Browser-only: constructs a real Worker and dynamically imports elkjs, neither
        // of which jsdom provides. The layout it drives is covered in tests/unit/layout
        // against the real ELK library, and the budget in tests/perf.
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
        // Interface-only: no runtime code to execute.
        'src/render/notation/NotationSet.ts',
        // Empty by design until V2 (SRS §8.2).
        'src/domain/model/migrations/**',
      ],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
})
