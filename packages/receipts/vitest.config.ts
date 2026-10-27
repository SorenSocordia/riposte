import { defineConfig } from 'vitest/config'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Test scratch stays inside this package (tmp/vitest, gitignored): os.tmpdir() reads TMPDIR (POSIX) or TEMP/TMP (Windows),
// so every mkdtemp(tmpdir()) in the tests, and every child process they start, writes here, never to the system temp folder.
const TMP = fileURLToPath(new URL('./tmp/vitest', import.meta.url))
mkdirSync(TMP, { recursive: true })

// In-repo, `verify` resolves to the sibling package's source; published, it is the `riposte-verify` npm dependency.
export default defineConfig({
  resolve: { alias: { 'riposte-verify': fileURLToPath(new URL('../verify/src/index.ts', import.meta.url)) } },
  test: { include: ['test/**/*.test.ts'], environment: 'node', testTimeout: 60_000, env: { TMPDIR: TMP, TEMP: TMP, TMP } },
})
