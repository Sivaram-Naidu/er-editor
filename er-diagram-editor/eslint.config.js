import js from '@eslint/js'
import importX from 'eslint-plugin-import-x'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import prettier from 'eslint-config-prettier'
import tseslint from 'typescript-eslint'
import { globalIgnores } from 'eslint/config'

/**
 * Architectural dependency rule (SRS §8.1).
 *
 *   ui  ←  features  ←  store  ←  domain
 *                    ↑           ↑
 *                render  ←──── io, layout
 *
 * - `domain` imports nothing from the app (NFR-6.1) — it must stay unit-testable under Node.
 * - `io` and `layout` import `domain` only.
 * - `render` imports `domain` and `layout`.
 * - `persistence` imports `domain` and `io`.
 * - `store` imports `domain` and `persistence`.
 * - `features` may import anything below it.
 * - Nothing imports `features`.
 *
 * `lib` and `ui` are leaves: importable from anywhere, and permitted to import nothing
 * but each other. That is not stated explicitly in §8.1 but follows from "ui:
 * presentational primitives only. No domain imports."
 *
 * Encoded as explicit deny pairs rather than a layer index so that each forbidden edge
 * is greppable and its reason is visible at the point of denial.
 */
const LAYERS = ['domain', 'io', 'layout', 'render', 'persistence', 'store', 'features', 'ui', 'lib']

/** layer -> the set of `src/*` layers it is ALLOWED to import (excluding itself). */
const ALLOWED = {
  domain: ['lib'],
  io: ['domain', 'lib'],
  layout: ['domain', 'lib'],
  render: ['domain', 'layout', 'ui', 'lib'],
  persistence: ['domain', 'io', 'lib'],
  store: ['domain', 'persistence', 'lib'],
  features: ['domain', 'io', 'layout', 'render', 'persistence', 'store', 'ui', 'lib'],
  ui: ['lib'],
  lib: [],
}

const WHY = {
  domain: 'domain must import nothing from the app — it stays pure and Node-testable (NFR-6.1)',
  io: 'io may import domain only',
  layout: 'layout may import domain only',
  render: 'render may import domain and layout only',
  persistence: 'persistence may import domain and io only',
  store: 'store may import domain and persistence only',
  ui: 'ui holds presentational primitives only — no domain, no features',
  lib: 'lib is a leaf — it may not import any other layer',
  features: 'features may import anything below it',
}

const zones = LAYERS.flatMap((target) =>
  LAYERS.filter((from) => from !== target && !ALLOWED[target].includes(from)).map((from) => ({
    target: `./src/${target}`,
    from: `./src/${from}`,
    message: `Boundary violation (SRS §8.1): ${WHY[target]}. Remove this import from src/${from}.`,
  })),
)

export default tseslint.config([
  globalIgnores(['dist', 'coverage', 'node_modules', 'public/elk-worker.js']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.strictTypeChecked, prettier],
    languageOptions: {
      ecmaVersion: 2023,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'import-x': importX,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    settings: {
      'import-x/resolver': {
        node: { extensions: ['.ts', '.tsx', '.js', '.jsx'] },
      },
    },
    rules: {
      ...reactHooks.configs['recommended-latest'].rules,
      // `allowExportNames` covers modules that export a context provider alongside its
      // hook. Fast Refresh handles hooks correctly; the rule simply cannot distinguish
      // them from plain constants, and splitting a two-line hook into its own file to
      // satisfy a false positive would make the code worse, not better.
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true, allowExportNames: ['useEditorActions'] },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      // Allow `const { [k]: _discard, ...rest } = obj` — the idiomatic immutable key
      // removal. The binding is required by the syntax and is never read.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      // Catches the RELATIVE form: `import '../render/lod'`
      'import-x/no-restricted-paths': ['error', { zones }],
    },
  },

  // Catches the ALIAS form: `import '@/render/lod'`.
  //
  // Two rules are needed because they work at different levels. `no-restricted-paths`
  // resolves the import to a real file, which the node resolver cannot do for `@/`
  // (that would need eslint-import-resolver-typescript, which drags eslint-plugin-import
  // back in as a peer and breaks on ESLint 10 — see docs/adr/0005). `no-restricted-imports`
  // matches the raw specifier string instead, so it needs no resolution at all.
  //
  // Keep ALLOWED as the single source of truth; both rules are generated from it.
  ...LAYERS.map((target) => ({
    files: [`src/${target}/**/*.{ts,tsx}`],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: LAYERS.filter((from) => from !== target && !ALLOWED[target].includes(from)).map(
            (from) => ({
              group: [`@/${from}`, `@/${from}/*`, `@/${from}/**`],
              message: `Boundary violation (SRS §8.1): ${WHY[target]}. Remove this import from src/${from}.`,
            }),
          ),
        },
      ],
    },
  })),

  {
    // Config files and tests sit outside the layer graph.
    files: ['*.config.{ts,js}', 'tests/**/*.{ts,tsx}'],
    rules: {
      'import-x/no-restricted-paths': 'off',
      '@typescript-eslint/no-restricted-imports': 'off',
    },
  },

  {
    // Tests may assert on fixtures they just built. `strictTypeChecked` forbids non-null
    // assertions because in application code they are usually a hidden crash; in a test
    // an assertion IS the check — if `entities[0]` is undefined the test should fail
    // loudly at that line, which is exactly what `!` produces. Narrowing every fixture
    // access with an `if` would bury the assertion being made.
    //
    // Deliberately scoped to tests only. src/ keeps the rule.
    files: ['tests/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
    },
  },
])
