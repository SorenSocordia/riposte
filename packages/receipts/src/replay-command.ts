/**
 * The `riposte-replay` command, as a pure function (the bin in ./replay-cli.ts only does I/O). 2026-10-02.
 *
 *   riposte-replay <bundle.json | cases.jsonl | folder>          replay proof bundles ({ verdict, inputs, options? })
 *   riposte-replay --ledger <ledger.jsonl> --entry <seq | hash>  replay the proof a receipt on the ledger carries
 *   riposte-replay --ledger <ledger.jsonl> [--entry <seq | hash>] --proof <proof.json | proofs.jsonl>
 *                                                                 (2026-10-03) replay the proof the CUSTOMER kept, against
 *                                                                 the receipt it belongs to
 *
 * Re-performs each verdict with the deterministic engine (no model, no network) and byte-compares it with the presented one,
 * remedies included (verify's protocol/replay-case.ts). Prints the summary JSON on stdout and, per case, MATCH / DIVERGED /
 * NOT_REPERFORMED / REFUSED with the answer on stderr: for an AP proof, the gate's decision first (`A PERSON DECIDES (gate: a
 * check could not decide) · verdict PASS with 1 of 6 checks unable to run`), never a bare PASS for an invoice sent to a person.
 *
 * --proof: a hashes-only receipt (the default) holds no documents, so the customer's proof is replayed instead, but only once
 * it BINDS to the receipt (./ap-receipt.ts bindProof): the verdict hashes to the receipt's verdict_sha256, and the verdict id,
 * input hash and each document's sha256 and length are the receipt's. A proof that does not bind is DIVERGED, at the field
 * that differs (`verdict_sha256`, `documents.invoice.sha256`…), naming the entry; it is not re-performed.
 *
 * --ledger also reads the head record beside the ledger file (./head-record.ts; 2026-10-05) unless
 * --no-sidecar: a ledger shorter than its record, or whose entry at the record's head is another one, is not intact (a
 * warning, and the exit is at least 1), as `riposte-ledger verify` reports it.
 *
 * Exit: 0 every case matches · 1 a case diverged or did not bind (the field is named) · 2 none diverged, some not
 * re-performed · 3 a case refused, or a usage / unreadable input.
 */
import { bundlesFromText, renderCaseReplay, replayBundle, replayBundles, type CaseReplay, type ReplaySummary } from 'riposte-verify'
import { headRecordFor, parseLedgerTolerant } from './ledger-command.js'
import { verifyChain, type LedgerEntry } from './ledger.js'
import { bindProof, receiptForProof } from './ap-receipt.js'
import type { HeadRecordCheck } from './head-record.js'

export const REPLAY_USAGE = [
  'riposte-replay <bundle.json | cases.jsonl | folder>',
  'riposte-replay --ledger <ledger.jsonl> --entry <seq | hash> [--no-sidecar]',
  'riposte-replay --ledger <ledger.jsonl> [--entry <seq | hash>] --proof <proof.json | proofs.jsonl> [--no-sidecar]',
].join('\n')

export interface CliResult { code: number; out: string; err: string }
export interface ReplayFs {
  readFile: (path: string) => string
  /** the *.json / *.jsonl names in a folder, or undefined when `path` is not a folder */
  listDir: (path: string) => string[] | undefined
  join: (dir: string, name: string) => string
}

const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x)

function summarize(cases: CaseReplay[]): ReplaySummary {
  const n = (r: CaseReplay['result']): number => cases.filter((c) => c.result === r).length
  return { total: cases.length, matched: n('MATCH'), diverged: n('DIVERGED'), not_reperformed: n('NOT_REPERFORMED'), refused: n('REFUSED'), cases }
}

function finish(s: ReplaySummary, extra: Record<string, unknown> = {}): CliResult {
  const lines = s.cases.map((c) => renderCaseReplay(c)).join('\n')
  const tail = `riposte-replay: ${s.total} case(s): ${s.matched} match · ${s.diverged} diverged · ${s.not_reperformed} not re-performed · ${s.refused} refused`
  const code = s.diverged > 0 ? 1 : s.refused > 0 ? 3 : s.not_reperformed > 0 ? 2 : 0
  return { code, out: `${JSON.stringify({ ...s, ...extra }, null, 2)}\n`, err: `${lines}\n${tail}\n` }
}

const entryOf = (entries: readonly LedgerEntry[], want: string): LedgerEntry | undefined =>
  /^\d+$/.test(want) ? entries[Number(want)] : want.length >= 8 ? entries.find((x) => typeof x?.hash === 'string' && x.hash.startsWith(want)) : undefined

/** What a ledger replay found (CLI, HTTP and MCP answer from this; 2026-10-03). */
export interface LedgerReplay {
  summary: ReplaySummary
  /** per proof: the receipt it bound to, or the field at which it did not */
  bindings?: { proof: string; entry: number | null; bound: boolean; field?: string; reason?: string }[]
  /** the chain verifies, has no torn tail, and its head record (when one was read) shows no cut or rewrite */
  intact: boolean
  warnings: string[]
  /** a request that names nothing replayable (no such entry; a hashes-only entry without a proof): the reason, no summary */
  refused?: string
}

/**
 * Replay against a ledger's entries: the proof an entry carries (`entry` alone), or the caller's own proofs, each only once it
 * BINDS to its receipt (`entry` names the receipt, else the receipt carrying the proof's verdict id). Never throws on a proof.
 */
export function replayAgainstLedger(entries: readonly LedgerEntry[], req: { entry?: string; proofs?: { name: string; bundle: unknown }[]; torn?: { bytes: number; after_line: number }; headRecord?: HeadRecordCheck }, ledger = 'ledger'): LedgerReplay {
  const chain = verifyChain([...entries])
  const warnings = [
    ...(chain.ok ? [] : [`the ledger's chain does not verify (entry ${chain.broken_at ?? '-'}: ${chain.reason}); the proof replays on its own, but its place on the record is not intact`]),
    ...(req.torn ? [`the ledger ends in a torn line (${req.torn.bytes} bytes after entry ${req.torn.after_line - 1}); the receipts file store quarantines it on its next open`] : []),
    ...(req.headRecord && !req.headRecord.ok ? [`${req.headRecord.words}; the proof replays on its own, but its place on the record is not intact`] : []),
  ]
  const intact = chain.ok && !req.torn && (req.headRecord?.ok ?? true)
  const empty: ReplaySummary = { total: 0, matched: 0, diverged: 0, not_reperformed: 0, refused: 0, cases: [] }
  const named = req.entry !== undefined ? entryOf(entries, req.entry) : undefined
  if (req.entry !== undefined && !named) return { summary: empty, intact, warnings, refused: `no entry ${req.entry} on ${ledger} (${entries.length} entries; give a seq, or 8+ hex of its hash)` }
  if (req.proofs === undefined) {
    if (!named) return { summary: empty, intact, warnings, refused: 'name an entry, or bring the proof to replay against its receipt' }
    const proof = isObj(named.body) ? named.body.proof : undefined
    if (!isObj(proof)) {
      const hashesOnly = isObj(named.body) && named.body.stored === 'hashes'
      return { summary: empty, intact, warnings, refused: hashesOnly
        ? `entry ${named.seq} stores hashes only (no documents): replay the proof the caller kept, against this receipt`
        : `entry ${named.seq} (${named.kind}) carries no proof object: only ap_gate receipts written since 2026-10-02 do` }
    }
    return { summary: replayBundles([{ name: `${ledger}#${named.seq}`, bundle: proof }]), intact, warnings }
  }
  const bindings: NonNullable<LedgerReplay['bindings']> = []
  const cases: CaseReplay[] = req.proofs.map(({ name, bundle }) => {
    const vid = isObj(bundle) && isObj(bundle.verdict) ? bundle.verdict.verdict_id : undefined
    const e = named ?? receiptForProof([...entries], bundle)
    if (!e) {
      bindings.push({ proof: name, entry: null, bound: false, field: 'entry', reason: `no ap_gate receipt on the ledger carries verdict ${String(vid)}` })
      return { name, result: 'DIVERGED', first_difference: 'entry', reason: `NOT BOUND: no ap_gate receipt on ${ledger} carries verdict ${String(vid)}` }
    }
    const b = bindProof(e.body, bundle)
    const label = `${ledger}#${e.seq} ← ${name}`
    if (!b.ok) {
      bindings.push({ proof: name, entry: e.seq, bound: false, field: b.field, reason: b.reason })
      return { name: label, result: 'DIVERGED', first_difference: b.field, reason: `NOT BOUND to entry ${e.seq}: ${b.reason}`, ...(typeof vid === 'string' ? { verdict_id: vid } : {}) }
    }
    bindings.push({ proof: name, entry: e.seq, bound: true })
    return replayBundle(bundle, `${label} (bound)`)
  })
  return { summary: summarize(cases), bindings, intact, warnings }
}

export function replayCli(argv: string[], fs: ReplayFs): CliResult {
  const usage = (msg?: string): CliResult => ({ code: msg ? 3 : 0, out: '', err: `${msg ? `${msg}\n` : ''}${REPLAY_USAGE}\n` })
  if (!argv.length || argv[0] === '--help' || argv[0] === '-h') return usage()
  if (argv[0] === '--ledger') {
    const f: Record<string, string> = {}
    let noSidecar = false
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i]!
      if (a === '--no-sidecar') { noSidecar = true; continue }
      if (!['--ledger', '--entry', '--proof'].includes(a)) return usage(`unknown argument ${a}`)
      const v = argv[++i]
      if (!v || v.startsWith('--')) return usage(`${a} needs a value`)
      if (f[a.slice(2)] !== undefined) return usage(`${a} given twice`)
      f[a.slice(2)] = v
    }
    const ledger = f.ledger!
    if (f.entry === undefined && f.proof === undefined) return usage('--ledger <ledger.jsonl> --entry <seq | hash>, or --proof <proof.json>')
    let entries: LedgerEntry[]
    let torn: { bytes: number; after_line: number } | undefined
    try { ({ entries, torn } = parseLedgerTolerant(fs.readFile(ledger))) } catch (e) { return { code: 3, out: '', err: `cannot read ${ledger}: ${(e as Error).message}\n` } }
    let proofs: { name: string; bundle: unknown }[] | undefined
    if (f.proof !== undefined) {
      try { proofs = bundlesFromText(f.proof, fs.readFile(f.proof)) } catch (e) { return { code: 3, out: '', err: `cannot read ${f.proof}: ${(e as Error).message}\n` } }
      if (!proofs.length) return usage(`${f.proof} holds no proofs`)
    }
    // 2026-10-05: a missing head record does not verify here either, unless --no-sidecar
    const headRecord = headRecordFor(ledger, entries, fs.readFile, noSidecar, true)
    if ('error' in headRecord) return { code: 3, out: '', err: `${headRecord.error}\n` }
    const r = replayAgainstLedger(entries, { ...(f.entry !== undefined ? { entry: f.entry } : {}), ...(proofs ? { proofs } : {}), ...(torn ? { torn } : {}), headRecord }, ledger)
    const warn = r.warnings.map((w) => `warning: ${w}\n`).join('')
    if (r.refused !== undefined) {
      const hashesOnly = /stores hashes only/.test(r.refused)
      return { code: 3, out: '', err: `${r.refused}${hashesOnly ? `: --ledger ${ledger} --entry ${f.entry} --proof <proof.json>` : ''}\n` }
    }
    const out = finish(r.summary, r.bindings ? { bindings: r.bindings } : {})
    return { ...out, code: r.intact ? out.code : Math.max(out.code, 1), err: out.err + warn }
  }
  if (argv.length > 1) return usage(`one bundle file, .jsonl or folder at a time (got ${argv.length} arguments)`)
  const path = argv[0]!
  const items: { name: string; bundle: unknown }[] = []
  try {
    const names = fs.listDir(path)
    if (names) for (const n of [...names].sort()) items.push(...bundlesFromText(n, fs.readFile(fs.join(path, n))))
    else items.push(...bundlesFromText(path, fs.readFile(path)))
  } catch (e) { return { code: 3, out: '', err: `cannot read ${path}: ${(e as Error).message}\n` } }
  if (!items.length) return usage(`${path} holds no bundles (*.json or *.jsonl)`)
  return finish(replayBundles(items))
}
