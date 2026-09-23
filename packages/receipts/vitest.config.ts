import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// In-repo, `verify` resolves to the sibling package's source; published, it is the `riposte-verify` npm dependency.
export default defineConfig({
  resolve: { alias: { 'riposte-verify': fileURLToPath(new URL('../verify/src/index.ts', import.meta.url)) } },
  test: { include: ['test/**/*.test.ts'], environment: 'node', testTimeout: 60_000 },
})
