/**
 * Arbitration case rows on the receipt ledger, under a witnessed head (2026-10-04).
 *
 * verify's arbitration (engine 0.3.0, `verify case open | move | status | replay`) keeps each case's record in the case
 * directory's own hash-chained JSONL (`verify-case-ledger/1`: case.open, move.accepted, move.refused, verdict, case.resolve,
 * case.reopen), because verify does not import receipts. This puts those rows on a receipt ledger:
 *
 *   ingestCaseLedger(ledger, rows)      one signed `note` per case row: { source: "arbitration", event: <the row's kind>,
 *                                       case_id, case_seq, case_row_sha256, row }. The case chain must verify first (verify's
 *                                       ledgerProblems). Run again as the case grows, it appends only the new rows; a row it
 *                                       already holds that has changed since is refused (the case record was rewritten).
 *   witnessHead(ledger, cosigners)      asks witnesses to countersign the ledger's head (its row count and the hash of its last
 *                                       row). With two distinct countersignatures it appends a `note` { source: "arbitration",
 *                                       event: "head.witnessed", count, head, by, envelopes }; with fewer it appends nothing.
 *   caseRowsFrom(entries, case_id)      the case rows the ledger holds, in case order (they rebuild the case ledger byte for byte)
 *
 * A cosigner is anything with `cosign(count, head)` answering { ok, code, detail, by, envelope? }. riposte-custody's `Witness`
 * is one: an enrolled key, not the recorder, that reads the ledger file for itself, verifies the chain against the recorder's
 * key, and refuses a head that does not extend the last one it signed. receipts does not import custody (custody depends on
 * receipts), so the witnesses are handed in; `riposte-ledger case witness` loads custody at run time to make them, and
 * `riposte-ledger case check` checks the result with custody's checkWitnessedHead.
 *
 * WHAT THIS DOES NOT PROVE. The ledger key signs every row, so whoever holds it can rewrite the whole ledger: a witnessed head
 * is what catches that, and only while two witnesses are honest and do not collude with the key holder. Rows after the last
 * witnessed head are protected by the chain alone until the next one. The rows are what verify recorded; that the moves in them
 * were lawful is `verify case replay`'s to say.
 */
import { canonicalize, sha256, ledgerProblems, LEDGER_FORMAT as CASE_LEDGER_FORMAT, type LedgerRow as CaseLedgerRow } from 'riposte-verify'
import type { Ledger, LedgerEntry } from './ledger.js'

export { CASE_LEDGER_FORMAT, type CaseLedgerRow }
export const ARBITRATION_SOURCE = 'arbitration'
export const HEAD_WITNESSED = 'head.witnessed'
/** countersignatures a head needs before it is written as witnessed */
export const WITNESSES_NEEDED = 2

/** The body of one case row's note. */
export interface CaseRowNote { source: typeof ARBITRATION_SOURCE; event: string; case_id: string; case_seq: number; case_row_sha256: string; row: CaseLedgerRow }

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
/** A case row's hash, as verify chains them: sha256 of its canonical JSON. */
export const caseRowSha256 = (r: CaseLedgerRow): string => sha256(canonicalize(r))

/** A case ledger's text (JSONL) as rows. Throws naming the line that is not JSON. */
export function parseCaseLedger(text: string): CaseLedgerRow[] {
  return text.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.trim() !== '').map((l, i) => {
    try { return JSON.parse(l) as CaseLedgerRow } catch { throw new Error(`line ${i + 1} of the case ledger is not JSON`) }
  })
}

const isCaseNote = (e: LedgerEntry): boolean => e.kind === 'note' && isObj(e.body) && e.body.source === ARBITRATION_SOURCE && typeof e.body.case_id === 'string' && typeof e.body.case_seq === 'number'

/** The case-row notes a ledger holds (one case, or every case), with their ledger seq, in ledger order. */
export function caseRowNotes(entries: readonly LedgerEntry[], caseId?: string): { seq: number; note: CaseRowNote }[] {
  return entries.filter(isCaseNote).map((e) => ({ seq: e.seq, note: e.body as CaseRowNote })).filter((x) => caseId === undefined || x.note.case_id === caseId)
}

/** The case rows a ledger holds for one case, in case order: what rebuilds the case ledger. */
export function caseRowsFrom(entries: readonly LedgerEntry[], caseId: string): CaseLedgerRow[] {
  return caseRowNotes(entries, caseId).map((x) => x.note).sort((a, b) => a.case_seq - b.case_seq).map((n) => n.row)
}

export type CaseIngestCode = 'case.empty' | 'case.chain_broken' | 'case.no_id' | 'case.mixed' | 'case.rewritten' | 'case.notes_broken'
export type CaseIngest =
  | { ok: true; case_id: string; appended: { seq: number; hash: string; case_seq: number; event: string }[]; already: number; head: { count: number; head: string } }
  | { ok: false; code: CaseIngestCode; detail: string }

/**
 * Put a case's rows on the ledger as signed notes (see the header). Refuses, appending nothing: an empty case ledger, one whose
 * chain does not verify, rows of more than one case, or a row already on the ledger that has changed since (or a case ledger
 * shorter than what the ledger already holds: cut). Run inside the store's lock when other writers may append (the CLI does).
 */
export function ingestCaseLedger(ledger: Ledger, rows: readonly CaseLedgerRow[]): CaseIngest {
  if (!rows.length) return { ok: false, code: 'case.empty', detail: 'the case ledger has no rows' }
  const broken = ledgerProblems(rows)
  if (broken.length) return { ok: false, code: 'case.chain_broken', detail: `the case ledger does not chain (${broken.join('; ')}): nothing was appended` }
  const ids = [...new Set(rows.map((r) => (isObj(r.data) ? r.data.case_id : undefined)))]
  if (ids.some((x) => typeof x !== 'string')) return { ok: false, code: 'case.no_id', detail: 'a case row names no case_id' }
  if (ids.length !== 1) return { ok: false, code: 'case.mixed', detail: `the rows name ${ids.length} cases (${ids.join(', ')}); ingest one case at a time` }
  const caseId = ids[0] as string
  const held = caseRowNotes(ledger.entries(), caseId).map((x) => x.note).sort((a, b) => a.case_seq - b.case_seq)
  for (let k = 0; k < held.length; k++) {
    const n = held[k]!
    if (n.case_seq !== k + 1) return { ok: false, code: 'case.notes_broken', detail: `the ledger holds case ${caseId} rows out of sequence (row ${n.case_seq} where ${k + 1} belongs)` }
    const now = rows[k]
    if (!now) return { ok: false, code: 'case.rewritten', detail: `the ledger already holds ${held.length} rows of case ${caseId}; this case ledger has ${rows.length}: it was cut` }
    if (caseRowSha256(now) !== n.case_row_sha256) return { ok: false, code: 'case.rewritten', detail: `case row ${k + 1} is not the row the ledger recorded (sha256 ${n.case_row_sha256.slice(0, 16)}…): the case record was rewritten` }
  }
  const appended: { seq: number; hash: string; case_seq: number; event: string }[] = []
  for (const r of rows.slice(held.length)) {
    const note: CaseRowNote = { source: ARBITRATION_SOURCE, event: String(r.kind), case_id: caseId, case_seq: r.seq, case_row_sha256: caseRowSha256(r), row: r }
    const e = ledger.append('note', note)
    appended.push({ seq: e.seq, hash: e.hash, case_seq: r.seq, event: note.event })
  }
  return { ok: true, case_id: caseId, appended, already: held.length, head: ledger.head() }
}

/** What a witness answers when asked to countersign a head (riposte-custody's Witness.cosign answers this shape). */
export interface HeadCosign { ok: boolean; code: string; detail: string; by: string; label?: string; envelope?: unknown }
export interface HeadCosigner { cosign(count: number, head: string): HeadCosign }

export interface HeadWitnessing {
  ok: boolean
  count: number
  head: string
  /** the note that carries the countersignatures (absent when fewer than two countersigned) */
  witness_row?: number
  witness_hash?: string
  /** the countersignatures written, one per distinct witness */
  envelopes: unknown[]
  by: string[]
  /** every witness's answer, refusals included */
  answers: HeadCosign[]
  detail: string
}

/**
 * Ask every cosigner to countersign the ledger's current head; write the countersignatures as one note when at least
 * `need` (default two) distinct witnesses signed, else write nothing. A witness that throws counts as a refusal.
 */
export function witnessHead(ledger: Ledger, cosigners: readonly HeadCosigner[], opts: { need?: number } = {}): HeadWitnessing {
  const need = opts.need ?? WITNESSES_NEEDED
  const h = ledger.head()
  const base = { count: h.count, head: h.head }
  if (!h.count) return { ok: false, ...base, envelopes: [], by: [], answers: [], detail: 'the ledger is empty: there is no head to witness' }
  const answers = cosigners.map((c): HeadCosign => {
    try { return c.cosign(h.count, h.head) } catch (e) { return { ok: false, code: 'witness.error', detail: (e as Error).message, by: '?' } }
  })
  const seen = new Set<string>()
  const valid = answers.filter((a) => a.ok && a.envelope !== undefined && typeof a.by === 'string' && !seen.has(a.by) && Boolean(seen.add(a.by)))
  if (valid.length < need) {
    const refused = answers.filter((a) => !a.ok).map((a) => `${a.label || a.by}: ${a.code}`)
    return { ok: false, ...base, envelopes: [], by: [], answers, detail: `${valid.length} of the ${need} countersignatures a witnessed head needs${refused.length ? ` (refused: ${refused.join('; ')})` : ''}: nothing was written` }
  }
  const e = ledger.append('note', { source: ARBITRATION_SOURCE, event: HEAD_WITNESSED, count: h.count, head: h.head, by: valid.map((a) => a.by), envelopes: valid.map((a) => a.envelope) })
  return { ok: true, ...base, witness_row: e.seq, witness_hash: e.hash, envelopes: valid.map((a) => a.envelope), by: valid.map((a) => a.by), answers, detail: `${valid.length} witnesses countersigned ${h.count} rows; the countersignatures are on row ${e.seq}` }
}

export interface CaseRowsCheck {
  ok: boolean
  cases: { case_id: string; rows: number; problems: string[]; matches_case_dir?: boolean }[]
  problems: string[]
}

/**
 * Re-check the arbitration notes on a ledger with no trust in whoever wrote them: each note's case_row_sha256 is its row's,
 * its case_seq and event are the row's, each case's rows run 1..n with no gap and chain (verify's ledgerProblems), and, when a
 * case directory's ledger is given, the notes rebuild it exactly. The ledger's own chain and signatures are verifyChain's.
 */
export function checkCaseRows(entries: readonly LedgerEntry[], caseLedgers: Record<string, readonly CaseLedgerRow[]> = {}): CaseRowsCheck {
  const problems: string[] = []
  const byCase = new Map<string, { seq: number; note: CaseRowNote }[]>()
  for (const x of caseRowNotes(entries)) {
    const list = byCase.get(x.note.case_id) ?? []
    list.push(x)
    byCase.set(x.note.case_id, list)
  }
  for (const id of Object.keys(caseLedgers)) if (!byCase.has(id)) problems.push(`case ${id}: no rows of it on the ledger`)
  const cases: CaseRowsCheck['cases'] = []
  for (const [caseId, list] of byCase) {
    const p: string[] = []
    const sorted = [...list].sort((a, b) => a.note.case_seq - b.note.case_seq)
    sorted.forEach((x, k) => {
      const r = x.note.row
      if (!isObj(r)) { p.push(`ledger row ${x.seq}: carries no case row`); return }
      if (x.note.case_seq !== k + 1) p.push(`ledger row ${x.seq}: case row ${x.note.case_seq} where ${k + 1} belongs`)
      if (r.seq !== x.note.case_seq) p.push(`ledger row ${x.seq}: the note says case row ${x.note.case_seq}, the row says ${r.seq}`)
      if (x.note.event !== r.kind) p.push(`ledger row ${x.seq}: the note says ${x.note.event}, the row is ${r.kind}`)
      if (!isObj(r.data) || r.data.case_id !== caseId) p.push(`ledger row ${x.seq}: the row belongs to another case`)
      if (caseRowSha256(r) !== x.note.case_row_sha256) p.push(`ledger row ${x.seq}: the case row does not hash to the note's case_row_sha256`)
    })
    const rows = sorted.map((x) => x.note.row)
    for (const b of ledgerProblems(rows)) p.push(`the case rows do not chain: ${b}`)
    const dir = caseLedgers[caseId]
    let matches: boolean | undefined
    if (dir) {
      matches = dir.length === rows.length && dir.every((r, k) => canonicalize(r) === canonicalize(rows[k]))
      if (!matches) p.push(`the ledger's ${rows.length} rows of case ${caseId} do not rebuild the case directory's ledger (${dir.length} rows)`)
    }
    cases.push({ case_id: caseId, rows: rows.length, problems: p, ...(matches !== undefined ? { matches_case_dir: matches } : {}) })
    problems.push(...p.map((x) => `case ${caseId}: ${x}`))
  }
  return { ok: problems.length === 0, cases, problems }
}
