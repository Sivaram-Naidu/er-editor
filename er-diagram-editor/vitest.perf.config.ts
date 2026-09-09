import { defineConfig } from 'vitest/config'

/**
 * Performance budgets, run separately from the unit suite.
 *
 * Kept out of `pnpm test` because they take minutes and their timings depend on the
 * machine — folding them into the default run would make the inner loop slow and make
 * CI flaky on a noisy runner. Run them deliberately with `pnpm test:perf` when touching
 * layout, measurement or rendering.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/perf/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
})
