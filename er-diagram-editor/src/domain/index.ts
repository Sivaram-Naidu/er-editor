// Public surface of the domain layer.
//
// This layer imports nothing from the app (NFR-6.1) — no React, no DOM, no rendering
// library — so it stays unit-testable under plain Node. The boundary is enforced by
// eslint.config.js and covered by tests/unit/architecture/boundaries.test.ts.

export * from './model'
export * from './clipboard'
export * from './commands'
export * from './graph'
export * from './merge'
export * from './validation'
