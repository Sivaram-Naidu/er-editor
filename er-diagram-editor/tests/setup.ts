import '@testing-library/jest-dom/vitest'

// jsdom ships no IndexedDB, so Dexie cannot run under test without this. Registering it
// globally rather than per-file keeps `hasIndexedDb()` truthful everywhere — a test that
// half-installed it would exercise the in-memory fallback while claiming to test Dexie.
//
// This is the only reason `fake-indexeddb` is a dependency. It is dev-only and never
// reaches the bundle.
import 'fake-indexeddb/auto'

// React Flow measures its container with ResizeObserver, which jsdom does not implement.
// A no-op stub is enough: the tests here assert on rendered markup and the pure
// trace/LOD logic, not on measured geometry — that belongs in the Playwright suite.
if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
}

if (!('DOMMatrixReadOnly' in globalThis)) {
  globalThis.DOMMatrixReadOnly = class {
    m22 = 1
  } as unknown as typeof DOMMatrixReadOnly
}
