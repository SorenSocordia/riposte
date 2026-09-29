import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// In-repo, `riposte-verify` and `riposte-ai` resolve to the sibling packages' SOURCE (their built dist can lag); the runnable bin is
// bundled from source the same way (scripts/build-bin.mjs), which is also how the Claude Code plugin ships its executables.
export default defineConfig({
  resolve: {
    alias: {
      'riposte-verify': fileURLToPath(new URL('../verify/src/index.ts', import.meta.url)),
      'riposte-ai': fileURLToPath(new URL('../receipts/src/index.ts', import.meta.url)),
    },
  },
  test: { include: ['test/**/*.test.ts'], environment: 'node', testTimeout: 60_000 },
})
