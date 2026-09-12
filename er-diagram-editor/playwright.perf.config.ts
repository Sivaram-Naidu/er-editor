import { defineConfig, devices } from '@playwright/test'

/**
 * The browser performance suite — `pnpm test:perf:browser`.
 *
 * A second config rather than a second project inside `playwright.config.ts`, for one
 * reason: `webServer` is a top-level option and cannot vary per project, and this suite
 * must be served by `vite preview` where the rest of the suite is served by `pnpm dev`.
 *
 * That difference is the whole point. NFR-1.4's main-thread figure sat in the SRS for a day
 * as 323 / 142 / 473 ms, measured against the dev server; the same clicks against the
 * production build gave 51 / 62 / 96 ms. React's development build — `jsxDEV`, prop
 * validation, StrictMode's double render — was most of what had been measured. Every
 * number this suite produces is meaningless off the built bundle, so `perf.spec.ts` also
 * asserts that it is looking at one.
 *
 * Not part of `pnpm verify`. Wall-clock assertions belong in a command someone runs, not
 * in a gate that can fail because the machine was busy — the same convention `pnpm
 * test:perf` follows.
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/perf.spec.ts',
  // Sequential on purpose: two suites contending for the same cores would measure the
  // contention. This is the one place in the project where that is not acceptable.
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  // A layout of 120 entities plus three runs per detail level is not a fast test.
  timeout: 300_000,
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chrome-preview',
      use: {
        ...devices['Desktop Chrome'],
        // The system Chrome, for the same reason `playwright.config.ts` uses it: the
        // bundled browsers are not installed here, and a real Chrome is the browser these
        // numbers were originally taken in.
        channel: 'chrome',
        viewport: { width: 1400, height: 900 },
      },
    },
  ],
  webServer: {
    // Builds first. Measuring a stale `dist/` is the other way to get a wrong number.
    command: 'pnpm build && pnpm preview --port 5174 --strictPort',
    url: 'http://localhost:5174',
    reuseExistingServer: !process.env['CI'],
    timeout: 240_000,
  },
})
