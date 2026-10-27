// Bundle `riposte-action` into bin/riposte-action.mjs: one self-contained file (the engine bundled from source), the same
// way the Claude Code plugin ships its executables (scripts/build-plugin.mjs at the repository root). The Python adapters call it.
// It is bundled against the narrow view of the engine (scripts/narrow-engine.mjs), not the packages' barrels: the hook
// starts a fresh process per tool call, and loading the barrels is most of that start.
//   npm run build
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { writeOffGate } from './off-gate.mjs'
import { HOSTS_NARROW, assertNarrow, narrowEngine } from './narrow-engine.mjs'

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

// The host ports of the claims check (src/hosts): bin/riposte-codex.mjs (Codex Stop hook), bin/riposte-cursor.mjs (Cursor
// hooks) and bin/riposte-opencode.js (an OpenCode plugin file: `.js`, one export). Narrow view: HOSTS_NARROW.
const hostOpts = {
  outdir: join(root, 'bin'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  plugins: [narrowEngine(barrels, { narrow: HOSTS_NARROW })],
  metafile: true,
  banner: { js: "import { createRequire as __riposteRequire } from 'node:module'; const require = __riposteRequire(import.meta.url);" },
  legalComments: 'none',
  logLevel: 'info',
}
const hostBins = await build({
  ...hostOpts,
  outExtension: { '.js': '.mjs' },
  entryPoints: { 'riposte-codex': join(root, 'src', 'hosts', 'codex-cli.ts'), 'riposte-cursor': join(root, 'src', 'hosts', 'cursor-cli.ts') },
})
assertNarrow(hostBins.metafile, barrels)
const openCode = await build({ ...hostOpts, entryPoints: { 'riposte-opencode': join(root, 'src', 'hosts', 'opencode-plugin.ts') } })
assertNarrow(openCode.metafile, barrels)

// The batch bins: bin/riposte-score.mjs (one check for a scorer in another language: the Python Inspect scorer) and
// bin/riposte-sarif.mjs (files to SARIF: the GitHub Action). They run once per sample or per CI job, not per tool call, so
// they bundle the engine packages' barrels whole rather than a narrow view.
const barrelFilter = new RegExp('^(' + Object.keys(barrels).join('|') + ')$') // plain package names (verify, receipts, or their public names)
const wholeBarrels = { name: 'whole-barrels', setup(b) { b.onResolve({ filter: barrelFilter }, (a) => ({ path: barrels[a.path] })) } }
await build({
  ...hostOpts,
  plugins: [wholeBarrels],
  outExtension: { '.js': '.mjs' },
  entryPoints: { 'riposte-score': join(root, 'src', 'scorers', 'score-cli.ts'), 'riposte-sarif': join(root, 'src', 'sarif-cli.ts') },
})
