// Bundle the Claude Code plugin's executables into plugins/riposte/bin — one self-contained file per entry point, because a
// plugin installed from a marketplace is copied on its own, with nothing else from this repository and no npm install.
// Then check that every file hooks.json and .mcp.json point at was built (scripts/check-plugin.mjs); a miss fails the build.
//   npm run build:plugin                                   (node scripts/build-plugin.mjs [--out <plugin dir>])
//
// Two layouts (2026-10-05): the repository as published (packages/verify, packages/receipts, packages/adapters beside this
// scripts/ folder; the sources import riposte-verify and riposte-ai) and the workshop it is assembled from (verify, receipts
// and adapters beside this package; the sources import verify and receipts). The bins come out the same either way, and the
// published tree ships them already built: hooks.json and .mcp.json point at bin/riposte-claims.mjs,
// bin/riposte-action-hook.mjs (with its engine, bin/riposte-action.mjs) and bin/riposte-mcp.mjs, so they must be in the
// plugin folder itself. bin/BUILD.json records each built file's sha256 and the engine and checker versions it was built
// from; check-plugin refuses a bin that no longer matches it, and a build older than the sources' versions.
//
// REPRODUCIBLE (2026-10-05). Anyone can rebuild the bins from the published tree and get the same bytes, and
// `node scripts/check-plugin.mjs --reproduce` does exactly that and compares. What makes the output depend on the sources alone:
//   - esbuild is pinned to one version (ESBUILD_VERSION, also exact in package.json); a different version is reported, and
//     --reproduce refuses to compare under it;
//   - the TypeScript settings that change emitted code are given here (TSCONFIG_RAW: target ES2022, define-semantics class
//     fields), so no tsconfig.json on disk, near or far, can change what is emitted;
//   - the module path comments esbuild writes between modules are rewritten to the published layout (packages/<pkg>/…,
//     node_modules/<dep>/…), so neither the workshop's ../<pkg>/ paths nor where node_modules sits leaks into a bin;
//   - every written file gets one fixed modification time (FIXED_MTIME), so an archive of the folder is stable too;
//   - BUILD.json carries no time and no machine path. It records the esbuild version and a source digest: the sha256 of
//     bin/BUILD-SOURCES.txt, which lists every source file the bundles were built from with its sha256, as
//     `sha256sum` prints them, each path in the published layout and each file's bytes as published (the workshop's sources
//     import `verify` and `receipts`; the published ones `riposte-verify` and `riposte-ai`; the digest hashes the latter).
import { build, version as esbuildVersion } from 'esbuild'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, utimesSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/** The esbuild the bins are built with. package.json pins the same version exactly. */
export const ESBUILD_VERSION = '0.27.2'
/** The TypeScript settings that change emitted code, given to esbuild directly: no tsconfig.json on disk is read. */
export const TSCONFIG_RAW = { compilerOptions: { target: 'ES2022', useDefineForClassFields: true } }
/** Every file the build writes gets this modification time. */
export const FIXED_MTIME = new Date('2026-01-01T00:00:00Z')
/** The source list next to the stamp; BUILD.json's source digest is its sha256. */
export const SOURCES_FILE = 'BUILD-SOURCES.txt'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const sha = (b) => createHash('sha256').update(b).digest('hex')
const slash = (p) => p.split(sep).join('/')

/** The repository layout at `root`: where each package's sources are, and the names the sources import them by. */
export function layoutOf(root) {
  const published = existsSync(join(root, 'packages', 'receipts', 'src'))
  const pkg = (name) => (published ? join(root, 'packages', name) : join(root, '..', name))
  return { published, pkg, names: published ? { verify: 'riposte-verify', receipts: 'riposte-ai' } : { verify: 'verify', receipts: 'receipts' } }
}

/**
 * A path as esbuild wrote it (relative to `root`, forward slashes) or as the metafile lists it, in the published layout:
 * packages/<pkg>/… for the three packages, node_modules/<dep>/… for a dependency wherever it was installed, and the
 * narrow-engine views under their published import names.
 */
export function publishedPath(p, root) {
  const s = slash(p)
  const nm = s.lastIndexOf('node_modules/')
  if (nm >= 0) return s.slice(nm)
  if (s === 'narrow-engine:verify') return 'narrow-engine:riposte-verify'
  if (s === 'narrow-engine:receipts') return 'narrow-engine:riposte-ai'
  if (s.startsWith('narrow-engine:')) return s
  const abs = resolve(root, s)
  for (const name of ['verify', 'receipts', 'adapters']) {
    for (const base of [join(root, 'packages', name), join(root, '..', name)]) {
      const r = relative(base, abs)
      if (!r.startsWith('..') && !isAbsolute(r)) return `packages/${name}/${slash(r)}`
    }
  }
  const r = slash(relative(root, abs))
  return r.startsWith('..') ? s : r
}

/** A source file's bytes as published: the workshop's import names rewritten to the published package names. */
export function publishedSource(text, workshop) {
  if (!workshop) return text
  return text.replace(/from 'verify'/g, "from 'riposte-verify'").replace(/from 'receipts'/g, "from 'riposte-ai'")
}

/** Rewrite the module path comments esbuild puts between modules (`// <path>` on a line of its own) to the published layout. */
export function normalizeBundle(text, root, inputs) {
  const known = new Set(inputs.map(slash))
  return text.replace(/^\/\/ (\S+)$/gm, (line, p) => (known.has(p) ? `// ${publishedPath(p, root)}` : line))
}

/**
 * Build every bin of the plugin into `plugin` (default: plugins/riposte under `root`) and write bin/BUILD.json and
 * bin/BUILD-SOURCES.txt. Returns the stamp. Nothing outside `plugin` is written. `versions` (the engine and checker versions
 * of the sources) and `stampFile` come from check-plugin.mjs, its sourceVersions(root) and BUILD_STAMP. They are passed in,
 * not imported, because check-plugin --reproduce imports this module, and a static import back would be a module cycle that
 * never settles under top-level await.
 */
export async function buildPlugin({ root = ROOT, plugin = join(root, 'plugins', 'riposte'), logLevel = 'info', versions, stampFile = 'BUILD.json' } = {}) {
  if (!versions) throw new Error('buildPlugin: pass versions (check-plugin.mjs sourceVersions(root))')
  const L = layoutOf(root)
  const { writeOffGate } = await import(pathToFileURL(join(L.pkg('adapters'), 'scripts', 'off-gate.mjs')).href)
  const { HOSTS_NARROW, assertNarrow, narrowEngine } = await import(pathToFileURL(join(L.pkg('adapters'), 'scripts', 'narrow-engine.mjs')).href)
  const src = (f) => join(L.pkg('receipts'), 'src', f)
  const barrels = {
    [L.names.verify]: join(L.pkg('verify'), 'src', 'index.ts'),
    [L.names.receipts]: src('index.ts'), // the adapters import receipts by its package name
  }
  const binDir = join(plugin, 'bin')
  const hostsDir = join(plugin, 'hosts')
  const common = {
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    absWorkingDir: root,
    tsconfigRaw: TSCONFIG_RAW,
    // CommonJS dependencies inside an ESM bundle may call require(); give them one
    banner: { js: "import { createRequire as __riposteRequire } from 'node:module'; const require = __riposteRequire(import.meta.url);" },
    legalComments: 'none',
    logLevel,
    write: false,
    metafile: true,
  }
  const inputs = new Set()
  const written = []
  const emit = (result) => {
    const ins = Object.keys(result.metafile.inputs)
    for (const i of ins) inputs.add(i)
    for (const f of result.outputFiles) {
      mkdirSync(dirname(f.path), { recursive: true })
      writeFileSync(f.path, normalizeBundle(f.text, root, ins))
      written.push(f.path)
    }
    return result
  }

  emit(await build({
    ...common,
    outdir: binDir,
    outExtension: { '.js': '.mjs' },
    entryPoints: {
      'riposte-mcp': src('stdio.ts'),
      'riposte-claims': src('claims-cli.ts'),
      'riposte-attest': src('attest-cli.ts'),
      'riposte-ledger': src('ledger-cli.ts'),
      'riposte-replay': src('replay-cli.ts'), // re-perform a proof bundle, a folder of them, or a ledger receipt's proof
    },
    // bundle the engine from source, so the plugin never depends on a built workspace
    alias: barrels,
  }))

  // The PreToolUse action hook's engine (hooks.json runs it through the off-gate written below). It starts in a fresh process
  // on every gated tool call, so it is bundled against the narrow view of the engine, not the barrels (narrow-engine.mjs).
  const action = emit(await build({
    ...common,
    outdir: binDir,
    outExtension: { '.js': '.mjs' },
    entryPoints: { 'riposte-action': join(L.pkg('adapters'), 'src', 'action-cli.ts') },
    plugins: [narrowEngine(barrels)],
  }))
  assertNarrow(action.metafile, barrels)

  // The hook entry hooks.json registers: it returns before the engine loads unless RIPOSTE_ACTION_HOOK is set (or governance).
  mkdirSync(binDir, { recursive: true })
  writeOffGate(binDir, { by: 'scripts/build-plugin.mjs', see: 'packages/adapters/src/claude-code.ts' })
  written.push(join(binDir, 'riposte-action-hook.mjs'))

  // The claims check on other hosts (packages/adapters/src/hosts), beside the plugin in hosts/: the Codex Stop hook, the
  // Cursor hooks, and an OpenCode plugin file. Each is one self-contained file next to its installer snippet
  // (hosts/<host>/hooks.json, hosts/README.md). OpenCode runs every export of a plugin file as a plugin, so its file is `.js`
  // with exactly one export.
  const hostSrc = (f) => join(L.pkg('adapters'), 'src', 'hosts', f)
  const hostView = { ...common, outdir: hostsDir, plugins: [narrowEngine(barrels, { narrow: HOSTS_NARROW })] }
  const hostBins = emit(await build({ ...hostView, outExtension: { '.js': '.mjs' }, entryPoints: { 'codex/riposte-codex': hostSrc('codex-cli.ts'), 'cursor/riposte-cursor': hostSrc('cursor-cli.ts') } }))
  assertNarrow(hostBins.metafile, barrels)
  const openCode = emit(await build({ ...hostView, outExtension: { '.js': '.js' }, entryPoints: { 'opencode/riposte': hostSrc('opencode-plugin.ts') } }))
  assertNarrow(openCode.metafile, barrels)

  // The source list: every file the bundles were built from (not the generated narrow views, which are functions of the
  // view tables in narrow-engine.mjs, listed instead), its sha256 as published, sorted by path.
  const lines = []
  for (const i of inputs) {
    if (i.startsWith('narrow-engine:')) continue
    const abs = resolve(root, i)
    const pub = publishedPath(i, root)
    const workshopSource = !L.published && pub.startsWith('packages/') && /\.ts$/.test(pub)
    lines.push([pub, sha(publishedSource(readFileSync(abs, 'utf8'), workshopSource))])
  }
  for (const f of ['narrow-engine.mjs', 'off-gate.mjs']) lines.push([`packages/adapters/scripts/${f}`, sha(readFileSync(join(L.pkg('adapters'), 'scripts', f)))])
  lines.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  const sourcesText = lines.map(([p, h]) => `${h}  ${p}`).join('\n') + '\n'
  writeFileSync(join(binDir, SOURCES_FILE), sourcesText)
  written.push(join(binDir, SOURCES_FILE))

  // The build stamp: what was built, from which versions and sources, with which esbuild. No time, no machine path.
  const built = Object.fromEntries(readdirSync(binDir).filter((f) => /\.m?js$/.test(f)).sort().map((f) => [`bin/${f}`, sha(readFileSync(join(binDir, f)))]))
  for (const f of ['codex/riposte-codex.mjs', 'cursor/riposte-cursor.mjs', 'opencode/riposte.js']) built[`hosts/${f}`] = sha(readFileSync(join(hostsDir, f)))
  const stamp = {
    built_by: 'scripts/build-plugin.mjs',
    ...versions,
    esbuild: esbuildVersion,
    sources: { file: `bin/${SOURCES_FILE}`, files: lines.length, sha256: sha(sourcesText) },
    files: built,
  }
  writeFileSync(join(binDir, stampFile), `${JSON.stringify(stamp, null, 2)}\n`)
  written.push(join(binDir, stampFile))
  for (const f of written) utimesSync(f, FIXED_MTIME, FIXED_MTIME)
  return stamp
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2)
  const at = args.indexOf('--out')
  if (at >= 0 && (!args[at + 1] || args[at + 1].startsWith('--'))) { console.error('build:plugin: --out needs a plugin folder'); process.exit(2) }
  const plugin = at >= 0 ? resolve(args[at + 1]) : join(ROOT, 'plugins', 'riposte')
  if (esbuildVersion !== ESBUILD_VERSION) console.error(`build:plugin: WARNING esbuild ${esbuildVersion} is not the pinned ${ESBUILD_VERSION}: the bins will not match a build with the pinned version (npm install esbuild@${ESBUILD_VERSION})`)
  const { checkHosts, checkPlugin, sourceVersions, BUILD_STAMP } = await import('./check-plugin.mjs')
  const stamp = await buildPlugin({ plugin, versions: sourceVersions(ROOT), stampFile: BUILD_STAMP })
  console.log(`build:plugin: ${Object.keys(stamp.files).length} files, esbuild ${stamp.esbuild}, sources ${stamp.sources.files} files sha256 ${stamp.sources.sha256}`)
  if (at < 0) {
    const check = checkPlugin(plugin)
    const hosts = checkHosts(plugin)
    console.log([...check.lines, ...hosts.lines].join('\n'))
    if (check.problems.length || hosts.problems.length) {
      console.error(`build:plugin FAILED: the plugin's hooks, MCP servers or host snippets point at ${check.problems.length + hosts.problems.length} file(s) the build did not produce\n${[...check.problems, ...hosts.problems].join('\n')}`)
      process.exit(1)
    }
  }
}
