import { defineConfig } from 'vitest/config'

// Tests are self-contained: nothing outside this package is referenced.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
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
