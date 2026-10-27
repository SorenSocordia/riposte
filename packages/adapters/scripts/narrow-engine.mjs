// The action bin runs in a fresh node process on every gated tool call, and its cold start is module loading, not the check.
// So it is bundled against a narrow view of the engine: each engine package name resolves to a generated module that
// re-exports only what the action path uses, from the module that defines it, never the package's barrel (src/index.ts).
// One generator, two callers: this package's bin/ (scripts/build-bin.mjs) and the Claude Code plugin's bin/ (build-plugin.mjs).
// A name that moves or disappears fails the build ("No matching export"); a barrel that slips back in fails assertNarrow.
import { readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

/** What the action path takes from each engine package, keyed by the package's folder name, then by module under src/. */
export const NARROW = {
  verify: {
    'action/index.ts': ['verifyAction'],
    'verdict/notices.ts': ['actionNotice'],
    'verdict/canonical.ts': ['canonicalize', 'hashOf', 'sha256'],
    // 2026-10-19 (R-L1): receipts' ledger.ts reads every line with the engine's strict reader; the Linux lane caught the bundle
    // missing these three the same day the lab's --check passed (it does not rebuild the bins).
    'protocol/hash-input.ts': ['parseJsonStrict', 'duplicateKeyPath', 'HashInputRefused'],
  },
  receipts: {
    'nunchi.ts': ['AUDIENCES', 'DEFAULT_TIERS', 'MOMENTS', 'deliver', 'factsFromNotice'],
    'ledger.ts': ['openLedger'],
    'file-store.ts': ['fileStore'],
  },
}

/**
 * Constants whose defining module would pull a barrel back in (verify: verdict/voice.ts → verdict/channel.ts →
 * protocol/replay.ts → ../index.js). Each value is lifted from its source at build time, and must be an array of string
 * literals, or the build fails.
 */
export const LIFTED = {
  verify: { 'verdict/voice.ts': ['VOICE_LADDER'] },
}

/**
 * What the host ports of the claims check take (src/hosts/*: Codex, Cursor, OpenCode): the Claude Code Stop hook's decision
 * and receipt, and the ledger. They start a fresh process per hook call too (Cursor: per tool call), so they get their own
 * narrow view rather than the barrels.
 */
export const HOSTS_NARROW = {
  verify: {
    'verdict/canonical.ts': ['canonicalize', 'hashOf', 'sha256'],
    'protocol/hash-input.ts': ['parseJsonStrict', 'duplicateKeyPath', 'HashInputRefused'], // 2026-10-19: the hosts open ledgers too
  },
  receipts: {
    'claims-command.ts': ['STOP_SEND_BACK', 'hookOptionsFromEnv', 'stopDecision', 'stopReceipt'],
    'version.ts': ['stamped'],
    'ledger.ts': ['openLedger'],
    'file-store.ts': ['fileStore'],
  },
}

const NS = 'narrow-engine'

function lift(file, name) {
  const m = new RegExp(`^export const ${name}(?::[^=]+)? = \\[([^\\]]*)\\]\\s*$`, 'm').exec(readFileSync(file, 'utf8'))
  const items = m?.[1].split(',').map((s) => s.trim()).filter(Boolean)
  if (!items || !items.every((s) => /^'[^'\\]*'$/.test(s))) throw new Error(`cannot lift ${name} from ${file}: not an array of string literals`)
  return `export const ${name} = ${JSON.stringify(items.map((s) => s.slice(1, -1)))}`
}

/**
 * esbuild plugin. `barrels` maps each import name the sources use (`verify`, or `riposte-verify` in the public layout) to
 * that package's barrel, `<package>/src/index.ts`; the package's folder name picks its entry in the view (NARROW and
 * LIFTED by default; HOSTS_NARROW for the host ports).
 */
export function narrowEngine(barrels, view = { narrow: NARROW, lifted: LIFTED }) {
  const NARROW_VIEW = view.narrow ?? NARROW
  const LIFTED_VIEW = view.lifted ?? {}
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return {
    name: NS,
    setup(build) {
      build.onResolve({ filter: new RegExp(`^(${Object.keys(barrels).map(escape).join('|')})$`) }, (a) => ({ path: a.path, namespace: NS }))
      build.onLoad({ filter: /.*/, namespace: NS }, (a) => {
        const src = dirname(barrels[a.path])
        const pkg = basename(dirname(src))
        if (!NARROW_VIEW[pkg]) return { errors: [{ text: `no narrow view for "${a.path}" (${src})` }] }
        const contents = [
          ...Object.entries(NARROW_VIEW[pkg]).map(([file, names]) => `export { ${names.join(', ')} } from ${JSON.stringify(join(src, file))}`),
          ...Object.entries(LIFTED_VIEW[pkg] ?? {}).flatMap(([file, names]) => names.map((n) => lift(join(src, file), n))),
        ].join('\n')
        return { contents, loader: 'js', resolveDir: src }
      })
    },
  }
}

/** Throw if the build's metafile includes any package barrel: the narrow view was bypassed somewhere. */
export function assertNarrow(metafile, barrels) {
  const bad = new Set(Object.values(barrels).map((p) => resolve(p).toLowerCase()))
  const hits = Object.keys(metafile.inputs).filter((i) => bad.has(resolve(i).toLowerCase()))
  if (hits.length) throw new Error(`the action bundle loads a package barrel (${hits.join(', ')}); import the defining module instead`)
}
