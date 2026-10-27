/**
 * `riposte-loop replay <bundle.json | folder>` (2026-10-03, T3): re-check closed-loop bundles with no trust in whoever produced
 * them.
 *
 *   riposte-loop replay <bundle.json | folder of *.json bundles> [--verify-cli <path to verify's dist/cli.js>] [--in-process]
 *                       [--public-key <pem file>] [--require-signed]
 *
 * For every bundle it verifies the loop's chain (order, links, hashes, signatures; with --public-key, whose key), every row
 * against the bundle's proposals, verify bundles and instructions by sha256, every returned instruction against its verdict's
 * remedies byte for byte, the gate reading, the edit discipline, the close and the top hash (./loop.ts verifyLoopBundle). Then
 * it re-performs every round's verify bundle with verify's own CLI (the default: the `verify` package this one depends on):
 * one `node <verify>/dist/cli.js replay <rounds.jsonl>` call for all rounds of all bundles given, each round a line. Or
 * in-process with verify's library (--in-process). Every problem is named by bundle and round.
 *
 * Exit: 0 every check passes and every round MATCHes · 1 a problem (named) · 3 usage, or a file that cannot be read.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { replayBundle } from 'riposte-verify'
import { verifyLoopBundle, type LoopCheck, type RoundReplay, type VerifyBundle } from './loop.js'

export const LOOP_USAGE = 'riposte-loop replay <bundle.json | folder> [--verify-cli <verify dist/cli.js>] [--in-process] [--public-key <pem file>] [--require-signed]'

export interface LoopCliIo {
  readFile: (path: string) => string
  /** the *.json names in a folder, or undefined when `path` is not a folder */
  listDir?: (path: string) => string[] | undefined
  join?: (dir: string, name: string) => string
  /** re-perform one round's verify bundle (default: verify's CLI as a child process, all rounds in one call) */
  replayRound?: (bundle: VerifyBundle, round: number) => RoundReplay
}

/** The verify CLI this package depends on: `verify/dist/cli.js` (in-repo) or `riposte-verify/dist/cli.js` (published). */
export function defaultVerifyCli(): string {
  const req = createRequire(import.meta.url)
  for (const name of ['verify', 'riposte-verify']) {
    try { return join(dirname(req.resolve(`${name}/package.json`)), 'dist', 'cli.js') } catch { /* try the next name */ }
  }
  throw new Error('cannot find the verify package (verify or riposte-verify): give --verify-cli <path to its dist/cli.js>')
}

function spawnVerifyReplay(cli: string, file: string): { code: number; out: string; err: string } {
  const env: NodeJS.ProcessEnv = { ...process.env }
  delete env.RIPOSTE_LEDGER
  delete env.RIPOSTE_HOOK_MODE
  try {
    const out = execFileSync(process.execPath, [cli, 'replay', file], { windowsHide: true, encoding: 'utf8', env, maxBuffer: 512 << 20, stdio: ['ignore', 'pipe', 'pipe'] })
    return { code: 0, out, err: '' }
  } catch (e) {
    const x = e as { status?: number; stdout?: string; stderr?: string }
    return { code: x.status ?? 3, out: String(x.stdout ?? ''), err: String(x.stderr ?? '') }
  }
}

/**
 * Re-perform one round's verify bundle with verify's own CLI: `node <cli> replay <file>`, in a child process with no window,
 * no inherited RIPOSTE_LEDGER / RIPOSTE_HOOK_MODE, and the bundle in a temporary folder that is removed afterwards. MATCH is
 * exit 0 with the verdict re-performed identically; exit 1 is DIVERGED (verify names the field), 2 NOT_REPERFORMED, 3 REFUSED.
 */
export function replayRoundWithCli(bundle: VerifyBundle, round: number, cli: string = defaultVerifyCli()): RoundReplay {
  const dir = mkdtempSync(join(tmpdir(), 'riposte-loop-'))
  const file = join(dir, `round-${round}.json`)
  try {
    writeFileSync(file, JSON.stringify(bundle))
    const { code, out, err } = spawnVerifyReplay(cli, file)
    let parsed: Record<string, unknown> = {}
    try { parsed = JSON.parse(out) as Record<string, unknown> } catch { /* not JSON */ }
    const reason = typeof parsed.reason === 'string' ? parsed.reason : err.trim().split('\n').pop()
    if (code === 0 && parsed.ok === true) return { result: 'MATCH', detail: `verify replay: ${String(parsed.status ?? 'ok')}` }
    if (code === 1) return { result: 'DIVERGED', ...(reason ? { detail: reason } : {}) }
    if (code === 2) return { result: 'NOT_REPERFORMED', ...(reason ? { detail: reason } : {}) }
    return { result: 'REFUSED', detail: reason || `verify replay exited ${code}` }
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

/**
 * Re-perform many rounds with ONE verify CLI call: the bundles go to a temporary `.jsonl`, one per line, and verify's summary
 * names each case `<file>#<line>`, in order. A summary that cannot be read makes every round REFUSED, naming why.
 */
export function replayRoundsWithCli(bundles: readonly VerifyBundle[], cli: string = defaultVerifyCli()): RoundReplay[] {
  if (!bundles.length) return []
  const dir = mkdtempSync(join(tmpdir(), 'riposte-loop-'))
  const file = join(dir, 'rounds.jsonl')
  try {
    writeFileSync(file, bundles.map((b) => JSON.stringify(b)).join('\n') + '\n')
    const { code, out, err } = spawnVerifyReplay(cli, file)
    let cases: { name?: string; result?: string; reason?: string; first_difference?: string }[] | undefined
    try { cases = (JSON.parse(out) as { cases?: typeof cases }).cases } catch { /* not JSON */ }
    if (!Array.isArray(cases) || cases.length !== bundles.length) {
      const why = `verify replay exited ${code} without a summary of ${bundles.length} case(s)${err.trim() ? `: ${err.trim().split('\n').pop()}` : ''}`
      return bundles.map(() => ({ result: 'REFUSED' as const, detail: why }))
    }
    return cases.map((c, i) => {
      if (c.name !== `${file}#${i + 1}`) return { result: 'REFUSED' as const, detail: `verify replay named case ${i + 1} ${String(c.name)}` }
      const result = (['MATCH', 'DIVERGED', 'NOT_REPERFORMED', 'REFUSED'] as const).find((r) => r === c.result) ?? 'REFUSED'
      const detail = c.reason ?? c.first_difference
      return { result, ...(result === 'MATCH' ? { detail: 'verify replay (batch): MATCH' } : detail ? { detail } : {}) }
    })
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

/** Re-perform one round's verify bundle in-process with verify's library (the same engine, no child process). */
export function replayRoundInProcess(bundle: VerifyBundle, round: number): RoundReplay {
  const c = replayBundle(bundle, `round ${round}`)
  return { result: c.result, ...(c.reason ? { detail: c.reason } : c.first_difference ? { detail: c.first_difference } : {}) }
}

const renderOne = (c: LoopCheck, label = ''): string => [
  ...c.rounds.map((r) => `${label}round ${r.round}: ${r.replay ? r.replay.result : 'not replayed'}${r.problems.length ? ` · ${r.problems.length} problem(s): ${r.problems.map((p) => `${p.field}: ${p.reason}`).join('; ')}` : ''}`),
  ...c.problems.filter((p) => p.round === null).map((p) => `${label}loop: ${p.field}: ${p.reason}`),
  `${label}riposte-loop replay: ${c.ok ? 'OK' : 'PROBLEMS'} · loop ${c.loop_id ?? '?'} · ${c.outcome ?? '?'} in ${c.rounds_used ?? '?'} round(s) · chain ${c.chain.ok ? 'verifies' : 'BROKEN'} (${c.chain.signed} signed, ${c.chain.unsigned} unsigned)`,
].join('\n')

export async function loopCli(argv: string[], io: LoopCliIo): Promise<{ code: number; out: string; err: string }> {
  const usage = (msg?: string): { code: number; out: string; err: string } => ({ code: msg ? 3 : 0, out: '', err: `${msg ? `${msg}\n` : ''}${LOOP_USAGE}\n` })
  if (!argv.length || argv[0] === '--help' || argv[0] === '-h') return usage()
  if (argv[0] !== 'replay') return usage(`unknown command ${argv[0]}`)
  let target: string | undefined
  let cli: string | undefined
  let inProcess = false
  let publicKey: string | undefined
  let requireSigned = false
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]!
    if (a === '--verify-cli' || a === '--public-key') {
      const v = argv[++i]
      if (!v || v.startsWith('--')) return usage(`${a} needs a value`)
      if (a === '--verify-cli') cli = v
      else { try { publicKey = io.readFile(v) } catch (e) { return { code: 3, out: '', err: `cannot read ${v}: ${(e as Error).message}\n` } } }
    } else if (a === '--in-process') inProcess = true
    else if (a === '--require-signed') requireSigned = true
    else if (a.startsWith('--')) return usage(`unknown argument ${a}`)
    else if (target === undefined) target = a
    else return usage('one bundle or folder at a time')
  }
  if (!target) return usage('name the loop bundle (or a folder of them) to replay')
  if (inProcess && cli) return usage('--in-process and --verify-cli are exclusive')
  const names = io.listDir?.(target)
  const files = names ? [...names].filter((n) => /\.json$/i.test(n)).sort().map((n) => (io.join ?? join)(target!, n)) : [target]
  if (names && !files.length) return usage(`${target} holds no *.json loop bundles`)
  const bundles: unknown[] = []
  for (const f of files) {
    try { bundles.push(JSON.parse(io.readFile(f))) } catch (e) { return { code: 3, out: '', err: `cannot read ${f}: ${(e as Error).message}\n` } }
  }
  const policy = { ...(publicKey ? { publicKey } : {}), ...(requireSigned ? { requireSigned } : {}) }
  // the rounds' re-performance: injected, in-process, or every round of every bundle in ONE verify CLI call
  let perFile: ((i: number) => (b: VerifyBundle, n: number) => RoundReplay)
  if (io.replayRound) perFile = () => io.replayRound!
  else if (inProcess) perFile = () => replayRoundInProcess
  else {
    const keyed: { file: number; round: number; bundle: VerifyBundle }[] = []
    bundles.forEach((b, i) => {
      const rounds = (b as { rounds?: { round?: unknown; verify_bundle?: VerifyBundle }[] })?.rounds
      if (Array.isArray(rounds)) rounds.forEach((r, k) => { if (r && typeof r === 'object' && r.verify_bundle) keyed.push({ file: i, round: k + 1, bundle: r.verify_bundle }) })
    })
    const results = replayRoundsWithCli(keyed.map((k) => k.bundle), cli)
    const at = new Map(keyed.map((k, j) => [`${k.file}:${k.round}`, results[j]!]))
    perFile = (i) => (_b, n) => at.get(`${i}:${n}`) ?? { result: 'REFUSED', detail: 'this round was not in the batch replayed' }
  }
  const checks: LoopCheck[] = []
  for (let i = 0; i < bundles.length; i++) checks.push(await verifyLoopBundle(bundles[i], { replayRound: perFile(i), policy }))
  if (!names) {
    const c = checks[0]!
    return { code: c.ok ? 0 : 1, out: `${JSON.stringify(c, null, 2)}\n`, err: `${renderOne(c)}\n` }
  }
  const bad = checks.map((c, i) => ({ c, f: files[i]! })).filter((x) => !x.c.ok)
  // a round the edit discipline refused was never gated: it has no verify bundle to re-perform
  const rounds = checks.reduce((n, c) => n + c.rounds.filter((r) => r.replay).length, 0)
  const refused = checks.reduce((n, c) => n + c.rounds.filter((r) => !r.replay).length, 0)
  const matched = checks.reduce((n, c) => n + c.rounds.filter((r) => r.replay?.result === 'MATCH').length, 0)
  // A verdict the loop refused because its remedies do not re-derive from the pinned ruleset (verify refuses it too)
  const remediesRefused = checks.reduce((n, c) => n + c.rounds.filter((r) => r.remedies_refused !== undefined).length, 0)
  const summary = {
    total: checks.length, ok: checks.length - bad.length, problems: bad.length, rounds, rounds_matched: matched, rounds_refused_not_gated: refused,
    ...(remediesRefused ? { rounds_remedies_refused: remediesRefused } : {}),
    loops: checks.map((c, i) => ({ file: files[i], ok: c.ok, loop_id: c.loop_id, outcome: c.outcome, rounds_used: c.rounds_used, problems: c.problems })),
  }
  const err = [...bad.map((x) => renderOne(x.c, `${x.f}: `)), `riposte-loop replay: ${checks.length} loop(s): ${checks.length - bad.length} OK · ${bad.length} with problems · ${matched}/${rounds} gated round(s) MATCH${refused ? ` · ${refused} proposal(s) refused by the edit discipline (never gated)` : ''}${remediesRefused ? ` · ${remediesRefused} verdict(s) refused because their remedies do not re-derive from the pinned ruleset (verify refuses them too)` : ''}`].join('\n')
  return { code: bad.length ? 1 : 0, out: `${JSON.stringify(summary, null, 2)}\n`, err: `${err}\n` }
}
