// Bundle `riposte-loop-run` (T3, 2026-10-03) into bin/riposte-loop-run.mjs: the closed-loop driver and its deterministic
// stand-in agents. Unlike the hook bins it is not shipped inside the plugin and does not run per tool call, so `verify` and
// `receipts` stay external: they resolve at run time to the installed packages (this package's dependencies), which is also
// the engine `riposte-loop replay` re-performs rounds with.
//   node scripts/build-loop.mjs        (also run by `npm run build`)
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
await build({
  entryPoints: { 'riposte-loop-run': join(root, 'src', 'loop', 'cli.ts') },
  outdir: join(root, 'bin'),
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: ['verify', 'receipts', 'riposte-verify', 'riposte-ai'], // in-repo names, and the published ones
  legalComments: 'none',
  logLevel: 'info',
})
