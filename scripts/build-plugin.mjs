// Bundle the Claude Code plugin's executables into plugins/riposte/bin — one self-contained file per entry point, because a
// plugin installed from a marketplace is copied on its own, with nothing else from this repository and no npm install.
//   npm run build:plugin
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = (f) => join(root, 'packages', 'receipts', 'src', f)

await build({
  entryPoints: {
    'riposte-mcp': src('stdio.ts'),
    'riposte-claims': src('claims-cli.ts'),
    'riposte-attest': src('attest-cli.ts'),
    'riposte-ledger': src('ledger-cli.ts'),
  },
  outdir: join(root, 'plugins', 'riposte', 'bin'),
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // bundle the engine from source, so the plugin never depends on a built workspace
  alias: { 'riposte-verify': join(root, 'packages', 'verify', 'src', 'index.ts') },
  // CommonJS dependencies inside an ESM bundle may call require(); give them one
  banner: { js: "import { createRequire as __riposteRequire } from 'node:module'; const require = __riposteRequire(import.meta.url);" },
  legalComments: 'none',
  logLevel: 'info',
})
