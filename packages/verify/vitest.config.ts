import { defineConfig } from 'vitest/config'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Tests are self-contained: nothing outside this package is referenced, read or written.
//
// Scratch stays inside the package too (2026-10-05): every worker's TMPDIR, TMP and TEMP point at <package>/tmp/vitest/run-<pid>,
// so os.tmpdir() resolves there, for the tests and for any child process a test starts. A reader confined to this one folder can
// run the suite. Each run has its own folder (two runs at once never share one), created by the global setup and removed when the
// run ends. tmp/ is gitignored in the public tree.
const PACKAGE = dirname(fileURLToPath(import.meta.url))
const SCRATCH = join(PACKAGE, 'tmp', 'vitest', `run-${process.pid}`)

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    env: { TMPDIR: SCRATCH, TMP: SCRATCH, TEMP: SCRATCH },
    globalSetup: ['./test/helpers/global-setup.ts'],
    // Determinism tests replay thousands of verdicts; give them room.
    testTimeout: 60_000,
    // Verdicts must never depend on wall-clock or randomness. Fail loudly if a test relies on either.
    fakeTimers: { toFake: [] },
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // The kernel is the product. Coverage below this is a production-bar failure, not a warning.
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
    },
  },
})
