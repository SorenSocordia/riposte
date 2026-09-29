// Bundle `riposte-action` into bin/riposte-action.mjs: one self-contained file (the engine bundled from source), the same
// way the Claude Code plugin ships its executables (scripts/build-plugin.mjs at the repository root). The Python adapters call it.
// It is bundled against the narrow view of the engine (scripts/narrow-engine.mjs), not the packages' barrels: the hook
// starts a fresh process per tool call, and loading the barrels is most of that start.
//   npm run build
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { writeOffGate } from './off-gate.mjs'
import { assertNarrow, narrowEngine } from './narrow-engine.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const barrels = {
  'riposte-verify': join(root, '..', 'verify', 'src', 'index.ts'),
  'riposte-ai': join(root, '..', 'receipts', 'src', 'index.ts'),
}
const r = await build({
  entryPoints: { 'riposte-action': join(root, 'src', 'action-cli.ts') },
  outdir: join(root, 'bin'),
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  plugins: [narrowEngine(barrels)],
  metafile: true,
  banner: { js: "import { createRequire as __riposteRequire } from 'node:module'; const require = __riposteRequire(import.meta.url);" },
  legalComments: 'none',
  logLevel: 'info',
})
assertNarrow(r.metafile, barrels)

// The hook entry the plugin registers (bin/riposte-action-hook.mjs): the off-gate, from the generator the plugin build shares.
writeOffGate(join(root, 'bin'))
