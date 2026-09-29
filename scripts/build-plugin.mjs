// Bundle the Claude Code plugin's executables into plugins/riposte/bin — one self-contained file per entry point, because a
// plugin installed from a marketplace is copied on its own, with nothing else from this repository and no npm install.
// Then check that every file hooks.json and .mcp.json point at was built (scripts/check-plugin.mjs); a miss fails the build.
//   npm run build:plugin
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { writeOffGate } from '../packages/adapters/scripts/off-gate.mjs'
import { assertNarrow, narrowEngine } from '../packages/adapters/scripts/narrow-engine.mjs'
import { checkPlugin } from './check-plugin.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = (f) => join(root, 'packages', 'receipts', 'src', f)
const plugin = join(root, 'plugins', 'riposte')
const barrels = {
  'riposte-verify': join(root, 'packages', 'verify', 'src', 'index.ts'),
  'riposte-ai': src('index.ts'), // the adapters import receipts by its package name
}
const common = {
  outdir: join(plugin, 'bin'),
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // CommonJS dependencies inside an ESM bundle may call require(); give them one
  banner: { js: "import { createRequire as __riposteRequire } from 'node:module'; const require = __riposteRequire(import.meta.url);" },
  legalComments: 'none',
  logLevel: 'info',
}

await build({
  ...common,
  entryPoints: {
    'riposte-mcp': src('stdio.ts'),
    'riposte-claims': src('claims-cli.ts'),
    'riposte-attest': src('attest-cli.ts'),
    'riposte-ledger': src('ledger-cli.ts'),
  },
  // bundle the engine from source, so the plugin never depends on a built workspace
  alias: barrels,
})

// The PreToolUse action hook's engine (hooks.json runs it through the off-gate written below). It starts in a fresh process
// on every gated tool call, so it is bundled against the narrow view of the engine, not the barrels (narrow-engine.mjs).
const action = await build({
  ...common,
  entryPoints: { 'riposte-action': join(root, 'packages', 'adapters', 'src', 'action-cli.ts') },
  plugins: [narrowEngine(barrels)],
  metafile: true,
})
assertNarrow(action.metafile, barrels)

// The hook entry hooks.json registers: it returns before the engine loads unless RIPOSTE_ACTION_HOOK is record-only or on.
writeOffGate(join(plugin, 'bin'), { by: 'scripts/build-plugin.mjs', see: 'packages/adapters/src/claude-code.ts' })

const check = checkPlugin(plugin)
console.log(check.lines.join('\n'))
if (check.problems.length) {
  console.error(`build:plugin FAILED: hooks.json / .mcp.json point at ${check.problems.length} file(s) the build did not produce\n${check.problems.join('\n')}`)
  process.exit(1)
}
