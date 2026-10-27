/**
 * `riposte-ledger case …` (2026-10-04): arbitration case rows on a receipt ledger, under a witnessed head
 * (./arbitration.ts).
 *
 *   riposte-ledger case ingest <ledger.jsonl> --case <case dir | case ledger.jsonl> [--ledger-key <private.pem>]
 *   riposte-ledger case witness <ledger.jsonl> --charter <charter.json> --ledger-key <private.pem>
 *                  --witness-key <private.pem> --witness-key <private.pem> --head-out <head.json>
 *                  [--prior-head <head.json>]... [--custody <riposte-custody package dir>]
 *   riposte-ledger case check <ledger.jsonl> --charter <charter.json> --key <public.pem> --head <head.json>
 *                  [--case <case dir | case ledger.jsonl>]... [--custody <riposte-custody package dir>]
 *
 * `ingest` appends one signed note per case row (source "arbitration"), only the rows the ledger does not hold yet, under the
 * ledger's single-writer lock, and refuses a case ledger whose chain does not verify or whose rows changed since they were
 * ingested. `witness` has two enrolled witness keys countersign the ledger's head with riposte-custody's own `Witness` (each
 * reads the ledger file for itself and verifies the chain against the recorder's key, which must be the charter's recorder
 * and the --ledger-key), writes the countersignatures as a note, and writes the witnessed-head file in custody's format
 * (never over an existing file). `--prior-head` gives the witnesses the head they signed before, so they refuse a rewritten
 * history. `check` verifies the chain pinned to --key with every row signed and the head anchored, the witnessed head with
 * custody's checkWitnessedHead, and the case rows (each hashes to its note, each case's rows chain, and they rebuild each
 * --case directory's ledger exactly).
 *
 * receipts does not depend on riposte-custody; `witness` and `check` load it at run time (--custody, else the installed
 * package). Exit: 0 ok · 1 refused, or a check that does not hold · 3 usage, or an input that cannot be read.
 */
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { openLedger, verifyChain, type LedgerEntry, type LedgerStore } from './ledger.js'
import { parseLedgerTolerant, publicOf } from './ledger-command.js'
import { checkCaseRows, ingestCaseLedger, parseCaseLedger, witnessHead, ARBITRATION_SOURCE, HEAD_WITNESSED, type CaseLedgerRow, type HeadCosigner } from './arbitration.js'

export const CASE_USAGE = [
  'riposte-ledger case ingest <ledger.jsonl> --case <case dir | case ledger.jsonl> [--ledger-key <private.pem>]',
  'riposte-ledger case witness <ledger.jsonl> --charter <charter.json> --ledger-key <private.pem> --witness-key <private.pem> --witness-key <private.pem>',
  '               --head-out <head.json> [--prior-head <head.json>]... [--custody <riposte-custody package dir>]',
  'riposte-ledger case check <ledger.jsonl> --charter <charter.json> --key <public.pem> --head <head.json> [--case <case dir | case ledger.jsonl>]...',
  '               [--custody <riposte-custody package dir>]',
].join('\n')

/** The part of riposte-custody's API these verbs call (its governance exports). */
export interface CustodyApi {
  Witness: new (hand: unknown, opts: { ledgerPath: string; recorderPublicPem: string; ctx: { fleet: string } }) => HeadCosigner & { last: { count: number; head: string } | null }
  Hand: { fromFile(file: string, label?: string): { fingerprint: string } }
  HEAD_FORMAT: string
  charterHash(c: unknown): string
  charterProblems(c: unknown): string[]
  checkWitnessedHead(entries: LedgerEntry[], charter: unknown, h: unknown): { ok: boolean; code: string; detail: string }
}

export interface CaseCliIO {
  readFile: (path: string) => string
  /** write a new file; throws if it exists (a witnessed-head file is never overwritten) */
  writeNewFile: (path: string, text: string) => void
  isDir: (path: string) => boolean
  join: (dir: string, name: string) => string
  /** the ledger as a store under its single-writer lock (the bin: the receipts file store) */
  openStore: (path: string) => LedgerStore
  /** riposte-custody's API, from --custody when given */
  loadCustody?: (spec: string | undefined) => Promise<CustodyApi>
}

export interface CliResult { code: number; out: string; err: string }

/** Load riposte-custody: a package directory (its package.json main), a module file, or the installed package. */
export async function loadCustodyDefault(spec: string | undefined, io: Pick<CaseCliIO, 'readFile' | 'isDir' | 'join'>): Promise<CustodyApi> {
  let file: string
  if (spec) {
    if (io.isDir(spec)) {
      const main = (JSON.parse(io.readFile(io.join(spec, 'package.json'))) as { main?: string }).main ?? 'dist/index.js'
      file = io.join(spec, main)
    } else file = spec
  } else {
    const req = createRequire(import.meta.url)
    let found: string | undefined
    for (const name of ['riposte-custody', 'custody']) { try { found = req.resolve(name); break } catch { /* next */ } }
    if (!found) throw new Error('riposte-custody is not installed here: give --custody <its package directory>')
    file = found
  }
  const m = await import(pathToFileURL(file).href) as Partial<CustodyApi>
  for (const k of ['Witness', 'Hand', 'HEAD_FORMAT', 'charterHash', 'charterProblems', 'checkWitnessedHead'] as const) {
    if (m[k] === undefined) throw new Error(`${file} is not riposte-custody (it exports no ${k})`)
  }
  return m as CustodyApi
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)

export async function caseCli(argv: string[], io: CaseCliIO): Promise<CliResult> {
  const usage = (msg?: string): CliResult => ({ code: msg ? 3 : 0, out: '', err: `${msg ? `${msg}\n` : ''}${CASE_USAGE}\n` })
  const [verb, file, ...rest] = argv
  if (!verb || verb === '--help' || verb === '-h') return usage()
  if (!['ingest', 'witness', 'check'].includes(verb)) return usage(`unknown case command ${verb}`)
  if (!file || file.startsWith('--')) return usage(`case ${verb} needs the receipt ledger file`)
  const multi = new Set(['--witness-key', '--case', '--prior-head'])
  const single = new Set(['--ledger-key', '--charter', '--head-out', '--head', '--key', '--custody'])
  const f: Record<string, string> = {}
  const m: Record<string, string[]> = {}
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!
    if (!multi.has(a) && !single.has(a)) return usage(`unknown option ${a}`)
    const v = rest[++i]
    if (v === undefined || v.startsWith('--')) return usage(`${a} needs a value`)
    if (multi.has(a)) (m[a.slice(2)] ??= []).push(v)
    else f[a.slice(2)] = v
  }
  const read = (p: string, what: string): string => { try { return io.readFile(p) } catch (e) { throw new UsageError(`cannot read ${what} ${p}: ${(e as Error).message}`) } }
  const json = (p: string, what: string): unknown => { const t = read(p, what); try { return JSON.parse(t) } catch { throw new UsageError(`${what} ${p} is not JSON`) } }
  const caseRows = (p: string): CaseLedgerRow[] => { const path = io.isDir(p) ? io.join(p, 'ledger.jsonl') : p; try { return parseCaseLedger(read(path, 'the case ledger')) } catch (e) { throw new UsageError((e as Error).message) } }
  const custody = (): Promise<CustodyApi> => (io.loadCustody ?? ((s) => loadCustodyDefault(s, io)))(f.custody)

  try {
    if (verb === 'ingest') {
      if (!m.case || m.case.length !== 1) return usage('case ingest needs exactly one --case (a case directory or its ledger.jsonl)')
      const rows = caseRows(m.case[0]!)
      const key = f['ledger-key'] ? read(f['ledger-key'], 'the ledger key') : undefined
      const store = io.openStore(file)
      const run = (): CliResult => {
        const c = verifyChain(store.load())
        if (!c.ok) return { code: 1, out: '', err: `refusing to append: the ledger's chain does not verify (entry ${c.broken_at ?? '-'}: ${c.reason})\n` }
        const r = ingestCaseLedger(openLedger(store, key ? { signingKey: key } : {}), rows)
        if (!r.ok) return { code: 1, out: `${JSON.stringify(r, null, 2)}\n`, err: `refused: ${r.code}: ${r.detail}\n` }
        return { code: 0, out: `${JSON.stringify(r, null, 2)}\n`, err: `case ${r.case_id}: ${r.appended.length} row(s) appended, ${r.already} already on the ledger; head ${r.head.head.slice(0, 16)}… at ${r.head.count} rows${key ? '' : ' (unsigned: no --ledger-key; a witness refuses an unsigned ledger)'}\n` }
      }
      return store.exclusive ? store.exclusive(run) : run()
    }

    if (!f.charter) return usage(`case ${verb} needs --charter`)
    const charter = json(f.charter, 'the charter')
    const C = await custody()
    const problems = C.charterProblems(charter)
    if (problems.length) return { code: 3, out: '', err: `the charter does not check: ${problems.join('; ')}\n` }
    const ch = charter as { fleet: string; recorder?: string }
    if (!ch.recorder) return { code: 3, out: '', err: 'the charter names no recorder: a witnessed head needs one (no witness may be the recorder)\n' }

    if (verb === 'witness') {
      if (!f['ledger-key']) return usage('case witness needs --ledger-key: the countersignatures are written as a row the recorder signs')
      if (!m['witness-key'] || m['witness-key'].length < 2) return usage('case witness needs two --witness-key (enrolled keys permitted to witness, neither the recorder)')
      if (!f['head-out']) return usage('case witness needs --head-out (the witnessed-head file to write)')
      const ledgerKey = read(f['ledger-key'], 'the ledger key')
      const recorder = publicOf(ledgerKey)
      // a charter names its recorder by the 16-hex short fingerprint; publicOf gives the full one (2026-10-05)
      if (recorder.fingerprint.slice(0, 16) !== ch.recorder) return { code: 1, out: '', err: `refused: the ledger key is ${recorder.fingerprint} (short ${recorder.fingerprint.slice(0, 16)}); the charter's recorder is ${ch.recorder}\n` }
      const witnesses = m['witness-key'].map((p) => {
        const w = new C.Witness(C.Hand.fromFile(p, p.replace(/^.*[\\/]/, '').replace(/\.pem$/i, '')), { ledgerPath: file, recorderPublicPem: recorder.public_key, ctx: { fleet: ch.fleet } })
        return w
      })
      for (const p of m['prior-head'] ?? []) {
        const prior = json(p, 'the prior head') as { count?: unknown; head?: unknown }
        if (typeof prior.count !== 'number' || typeof prior.head !== 'string') throw new UsageError(`${p} is not a witnessed-head file`)
        for (const w of witnesses) w.last = { count: prior.count, head: prior.head }
      }
      const store = io.openStore(file)
      const run = (): CliResult => {
        const c = verifyChain(store.load(), { publicKey: recorder.public_key, requireSigned: true })
        if (!c.ok) return { code: 1, out: '', err: `refused: the ledger does not verify against the recorder key with every row signed (entry ${c.broken_at ?? '-'}: ${c.reason})\n` }
        const ledger = openLedger(store, { signingKey: ledgerKey })
        const w = witnessHead(ledger, witnesses)
        if (!w.ok) return { code: 1, out: `${JSON.stringify(w, null, 2)}\n`, err: `refused: ${w.detail}\n` }
        const head = { format: C.HEAD_FORMAT, fleet: ch.fleet, charter_hash: C.charterHash(charter), count: w.count, head: w.head, witness_row: w.witness_row!, envelopes: w.envelopes }
        try { io.writeNewFile(f['head-out']!, `${JSON.stringify(head, null, 2)}\n`) } catch (e) { return { code: 1, out: `${JSON.stringify(w, null, 2)}\n`, err: `the countersignatures are on row ${w.witness_row}, but the head file was not written: ${(e as Error).message}\n` } }
        const check = C.checkWitnessedHead(store.load(), charter, head)
        const out = { ...w, head_file: f['head-out'], check }
        return { code: check.ok ? 0 : 1, out: `${JSON.stringify(out, null, 2)}\n`, err: `${w.detail}; head file ${f['head-out']}; custody check: ${check.ok ? 'OK' : `${check.code}: ${check.detail}`}\n` }
      }
      return store.exclusive ? store.exclusive(run) : run()
    }

    // check
    if (!f.key || !f.head) return usage('case check needs --key (the recorder\'s public key) and --head (the witnessed-head file)')
    const pub = publicOf(read(f.key, 'the key'))
    if (pub.fingerprint.slice(0, 16) !== ch.recorder) return { code: 1, out: '', err: `the key is ${pub.fingerprint} (short ${pub.fingerprint.slice(0, 16)}); the charter's recorder is ${ch.recorder}\n` }
    const head = json(f.head, 'the witnessed-head file') as { head?: string; count?: number; witness_row?: number }
    let entries: LedgerEntry[]
    let torn: { bytes: number } | undefined
    try { ({ entries, torn } = parseLedgerTolerant(read(file, 'the ledger'))) } catch (e) { throw new UsageError(`${file}: ${(e as Error).message}`) }
    const chain = verifyChain(entries, { publicKey: pub.public_key, requireSigned: true, ...(typeof head.head === 'string' ? { head: head.head } : {}) })
    const witness = C.checkWitnessedHead(entries, charter, head)
    const wrow = typeof head.witness_row === 'number' ? entries[head.witness_row] : undefined
    const wb = wrow && isObj(wrow.body) ? wrow.body : undefined
    const witnessRow = Boolean(wrow && wrow.kind === 'note' && wb && wb.source === ARBITRATION_SOURCE && wb.event === HEAD_WITNESSED && wb.count === head.count && wb.head === head.head)
    const dirs: Record<string, CaseLedgerRow[]> = {}
    for (const p of m.case ?? []) {
      const rows = caseRows(p)
      const id = rows[0] && isObj(rows[0].data) ? rows[0].data.case_id : undefined
      if (typeof id !== 'string') throw new UsageError(`${p}: its first row names no case_id`)
      dirs[id] = rows
    }
    const cases = checkCaseRows(entries, dirs)
    const ok = chain.ok && !torn && witness.ok && witnessRow && cases.ok
    const out = { ok, chain, witness, witness_row_present: witnessRow, case_rows: cases, ...(torn ? { torn_tail: torn } : {}) }
    const lines = [
      chain.ok ? `chain: OK, ${chain.length} rows, every row signed by ${pub.fingerprint}, the witnessed head ${String(head.head).slice(0, 16)}… is in it` : `chain: BROKEN at entry ${chain.broken_at ?? '-'}: ${chain.reason}`,
      `witnessed head: ${witness.ok ? 'OK' : witness.code}: ${witness.detail}`,
      `witness row: ${witnessRow ? `row ${head.witness_row} carries the countersignatures` : 'MISSING: no head.witnessed note at the row the head file names'}`,
      ...cases.cases.map((c) => `case ${c.case_id}: ${c.rows} row(s)${c.matches_case_dir === undefined ? '' : c.matches_case_dir ? ', rebuilds its case ledger exactly' : ', does NOT rebuild its case ledger'}${c.problems.length ? ` · ${c.problems.join('; ')}` : ''}`),
      ...cases.problems.filter((p) => !p.startsWith('case ') || !cases.cases.some((c) => p.startsWith(`case ${c.case_id}:`))),
      ...(torn ? [`TORN TAIL: ${torn.bytes} bytes after the last whole entry`] : []),
      `riposte-ledger case check: ${ok ? 'OK' : 'PROBLEMS'}`,
    ]
    return { code: ok ? 0 : 1, out: `${JSON.stringify(out, null, 2)}\n`, err: `${lines.join('\n')}\n` }
  } catch (e) {
    if (e instanceof UsageError) return { code: 3, out: '', err: `${e.message}\n` }
    return { code: 3, out: '', err: `case ${verb}: ${(e as Error).message}\n` }
  }
}

class UsageError extends Error {}
