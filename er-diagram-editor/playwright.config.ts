import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  /*
   * `perf.spec.ts` belongs to `playwright.perf.config.ts`, and running it here would be
   * actively misleading rather than merely slow: `webServer` below serves `pnpm dev`, and
   * NFR-1.4's main-thread numbers are several times larger against React's development
   * build than against the shipped one. That mistake is already on the record — 473 ms in
   * the SRS for a day, 96 ms in reality. Wall-clock assertions also do not belong in
   * `pnpm verify`; see `pnpm test:perf:browser`.
   */
  testIgnore: '**/perf.spec.ts',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  /*
   * `channel: 'chrome'` runs the Chrome already installed on the machine rather than
   * Playwright's own bundled build. It is the reason this suite can run at all here: the
   * bundled browsers were never downloaded, `pnpm exec playwright install chromium` is a
   * ~150 MB fetch, and the suite sat unexecuted for long enough that five interaction bugs
   * shipped underneath it. A real Chrome is also the browser the bugs were found in.
   *
   * If you would rather use the pinned build — reproducibility in CI is a fair reason —
   * drop this line and run the install step first. Do not leave the suite unrunnable.
   */
  projects: [
    {
      name: 'chrome',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        /*
         * Wider than the 1280x720 that `devices['Desktop Chrome']` brings, and
         * deliberately so. At 720 tall the minimap's bottom-right corner sits on top of
         * the sample schema's PRODUCT box and swallows its connection handle, so the
         * drag-to-connect spec could not reach it — the first thing found when this suite
         * was finally executed. 1400x900 is also a fairer approximation of the screen
         * someone reads a hundred-table diagram on.
         *
         * The occlusion itself is real and is recorded in NEXT.md; a bigger window is the
         * test's way round it, not a fix. It must be set HERE rather than in the top-level
         * `use`, because a project's `use` wins over the global one — set it there and the
         * device's 1280x720 silently takes over.
         */
        viewport: { width: 1400, height: 900 },
      },
    },
  ],
  webServer: {
    command: 'pnpm dev --port 5173',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env['CI'],
  },
})
