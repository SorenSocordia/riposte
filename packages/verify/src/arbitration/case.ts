/**
 * A case: an open verdict and the moves made on it until it resolves (engine 0.3.0, 2026-10-03; docs/EVIDENCE.md). The
 * thin cut of the arbitration protocol, local and file-based:
 *
 *   <case dir>/
 *     case.json                 the case record: id, opened_at, why it opened, the filing's hashes, the clock and its deadline
 *     parties.json              who may move, by which key; which sources are E0 (./parties.ts)
 *     filing/inputs.json        the verdict's inputs ({ extraction, ruleset, source? }): the filing as checked
 *     filing/verdict.json       the verdict that opened the case (it must re-perform before a case opens)
 *     evidence/<sha256>.<ext>   every document an accepted move filed, by the sha256 of its bytes
 *     moves/<move_id>.json      every accepted move, as signed
 *     verdicts/<verdict_id>.json  every re-verdict as a replay bundle { verdict, inputs } (inputs carry the evidence overlay)
 *     ledger.jsonl              the record: hash-chained rows (case.open, move.accepted, move.refused, verdict, case.resolve, case.reopen)
 *
 * The rules (the product ruling: "not an automatic fail, a flag, and a report with evidence … the vendor and filer can figure it out
 * at the bridge with the system as a mediator"):
 *  - A case opens when a verdict reads OPEN (a struck load-bearing field), or when a party disputes a FAIL claim.
 *  - Moves: CORRECT (new evidence the engine reads itself), STRIKE (a field or a document, with a reason), CORROBORATE (an
 *    independent source). Each accepted move re-evaluates the filing with the accumulated evidence overlay and records a linked
 *    re-verdict, before and after, both replayable. A refused move is recorded by the sha256 of its bytes.
 *  - Resolution: after a STRIKE that leaves a load-bearing field withdrawn, UNSUPPORTED; otherwise the re-verdict's reading:
 *    OPEN stays open, anything else resolves the case to it. On the clock: UNSUPPORTED while a load-bearing field is struck, or
 *    FAIL for a disputed FAIL that still fails; never PASS. A resolved case takes only a CORROBORATE at a strictly higher tier
 *    than the one it closed on (UNSUPPORTED closes on E4), which reopens it.
 * The record is this directory's own JSONL ledger: verify does not import receipts (receipts depends on verify, and nothing crosses the package boundary), so a receipts-side
 * ingestion of these rows is a stated want, not done here.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { canonicalize, sha256 } from '../verdict/canonical.js'
import type { EvidenceTier, Verdict } from '../verdict/schema.js'
import { gateStatusOpen, hasStruckLoadBearing, type GateStatusOpen } from '../verdict/aggregation.js'
import { verifyDeclarative } from '../declarative/evaluate.js'
import { isDeclarativeRuleset, type DeclarativeRuleset } from '../declarative/types.js'
import { tierRank, type EvidenceItem, type EvidenceOverlay } from '../declarative/evidence.js'
import { verifyInputs } from '../protocol/inputs.js'
import { verifyReplay } from '../protocol/replay.js'
import { engineAtLeast, isRetainedEngine } from '../version.js'
import { clockOf, partyByFingerprint, readParties, type Party, type PartiesFile } from './parties.js'
import { moveId, moveShapeRefusal, moveSignatureValid, type Move, type MoveRefusal, type MoveRefusalCode } from './moves.js'
import { readEvidence, sha256Bytes, sniff } from './read.js'

export const CASE_FORMAT = 'verify-case/1'
export const LEDGER_FORMAT = 'verify-case-ledger/1'
const GENESIS = '0'.repeat(64)

export type Resolution = 'PASS' | 'PASS-WITH-OPEN' | 'FAIL' | 'INSUFFICIENT_DATA' | 'UNSUPPORTED'

export interface CaseRecord {
  format: typeof CASE_FORMAT
  case_id: string
  opened_at: string
  why: 'struck' | 'dispute'
  dispute?: string
  prior_verdict_id: string
  engine_version: string
  filing: { inputs_sha256: string; verdict_sha256: string; document_sha256?: string }
  parties_sha256: string
  clock: { kind: 'ordinary' | 'suspect'; working_days: number; deadline: string }
}

export interface LedgerRow { format: typeof LEDGER_FORMAT; seq: number; prev: string; at: string; kind: string; data: Record<string, unknown> }

/** A verdict's state as the record keeps it, before and after a move. */
export interface VerdictState { verdict_id: string; gate: GateStatusOpen; evidence_floor: string; counts?: unknown }
const stateOf = (v: Verdict): VerdictState => ({ verdict_id: v.verdict_id, gate: gateStatusOpen(v), evidence_floor: v.evidence_floor ?? 'unstated', ...(v.counts ? { counts: v.counts } : {}) })

export class CaseRefused extends Error {
  constructor(public readonly code: string, message: string) { super(message) }
}

const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x)
const readJsonFile = (p: string): unknown => JSON.parse(readFileSync(p, 'utf8'))
const writeNew = (p: string, s: string | Uint8Array): void => { if (!existsSync(p)) writeFileSync(p, s, { flag: 'wx' }) }

// ── the clock ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** `iso` plus `days` working days (Monday to Friday, UTC), at the same time of day. */
export function addWorkingDays(iso: string, days: number): string {
  const d = new Date(iso)
  let left = days
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1)
    const wd = d.getUTCDay()
    if (wd !== 0 && wd !== 6) left--
  }
  return d.toISOString().replace(/\.000Z$/, 'Z')
}

// ── the ledger ───────────────────────────────────────────────────────────────────────────────────────────────────────────

const rowHash = (r: LedgerRow): string => sha256(canonicalize(r))

export function readLedger(dir: string): LedgerRow[] {
  const p = join(dir, 'ledger.jsonl')
  if (!existsSync(p)) return []
  return readFileSync(p, 'utf8').split('\n').filter(l => l.trim() !== '').map(l => JSON.parse(l) as LedgerRow)
}

/** The ledger's chain checked: each row's `prev` is the previous row's hash, seq counts from 1. Empty list = intact. */
export function ledgerProblems(rows: readonly LedgerRow[]): string[] {
  const out: string[] = []
  let prev = GENESIS
  rows.forEach((r, i) => {
    if (r.format !== LEDGER_FORMAT) out.push(`row ${i + 1}: format`)
    if (r.seq !== i + 1) out.push(`row ${i + 1}: seq ${r.seq}`)
    if (r.prev !== prev) out.push(`row ${i + 1}: prev does not chain to row ${i}`)
    prev = rowHash(r)
  })
  return out
}

function appendRow(dir: string, at: string, kind: string, data: Record<string, unknown>): LedgerRow {
  const rows = readLedger(dir)
  const bad = ledgerProblems(rows)
  if (bad.length) throw new CaseRefused('ledger-broken', `the case ledger does not chain (${bad[0]}): nothing is appended`)
  const row: LedgerRow = { format: LEDGER_FORMAT, seq: rows.length + 1, prev: rows.length ? rowHash(rows[rows.length - 1]!) : GENESIS, at, kind, data }
  appendFileSync(join(dir, 'ledger.jsonl'), `${canonicalize(row)}\n`)
  return row
}

// ── the case as the record says ──────────────────────────────────────────────────────────────────────────────────────────

export interface CaseState {
  record: CaseRecord
  parties: PartiesFile
  inputs: { extraction: Record<string, unknown>; ruleset: DeclarativeRuleset; source?: { text: string }; tolerance?: unknown }
  status: 'open' | 'resolved'
  resolution?: Resolution
  closed_on?: EvidenceTier | 'unstated'
  deadline: string
  latest: Verdict
  overlay: EvidenceOverlay
  nonces: Set<string>
  rows: LedgerRow[]
}

export function loadCase(dir: string): CaseState {
  const record = readJsonFile(join(dir, 'case.json')) as CaseRecord
  const parties = readParties(readJsonFile(join(dir, 'parties.json')))
  const inputs = readJsonFile(join(dir, 'filing', 'inputs.json')) as CaseState['inputs']
  const filingVerdict = readJsonFile(join(dir, 'filing', 'verdict.json')) as Verdict
  const rows = readLedger(dir)
  const bad = ledgerProblems(rows)
  if (bad.length) throw new CaseRefused('ledger-broken', `the case ledger does not chain: ${bad.join('; ')}`)
  let status: CaseState['status'] = 'open'
  let resolution: Resolution | undefined
  let closed_on: CaseState['closed_on']
  let deadline = record.clock.deadline
  let latest = filingVerdict
  let overlay: EvidenceOverlay = {}
  const nonces = new Set<string>()
  for (const r of rows) {
    if (r.kind === 'move.accepted' && typeof r.data.nonce === 'string') nonces.add(r.data.nonce)
    if (r.kind === 'move.refused' && typeof r.data.nonce === 'string') nonces.add(r.data.nonce)
    if (r.kind === 'verdict' && typeof r.data.verdict_id === 'string') {
      const b = readJsonFile(join(dir, 'verdicts', `${r.data.verdict_id}.json`)) as { verdict: Verdict; inputs: { evidence?: EvidenceOverlay } }
      latest = b.verdict
      overlay = b.inputs.evidence ?? {}
    }
    if (r.kind === 'case.resolve') { status = 'resolved'; resolution = r.data.resolution as Resolution; closed_on = r.data.closed_on as CaseState['closed_on'] }
    if (r.kind === 'case.reopen') { status = 'open'; resolution = undefined; closed_on = undefined; if (typeof r.data.deadline === 'string') deadline = r.data.deadline }
  }
  return { record, parties, inputs, status, ...(resolution ? { resolution } : {}), ...(closed_on ? { closed_on } : {}), deadline, latest, overlay, nonces, rows }
}

// ── opening a case ───────────────────────────────────────────────────────────────────────────────────────────────────────

export interface OpenOptions {
  dir: string
  verdict: Verdict
  inputs: unknown
  parties: unknown
  /** the filed document itself (its sha256 is recorded, so a corroboration can never be that same artifact) */
  document?: Uint8Array
  /** a FAIL claim a party disputes (a case also opens on any verdict that reads OPEN) */
  dispute?: string
  now: string
}

/** Open a case. Refused (CaseRefused) unless the verdict re-performs on its inputs, and it reads OPEN or a FAIL is disputed. */
export function openCase(o: OpenOptions): CaseState {
  const parties = readParties(o.parties)
  const v = o.verdict
  if (!isObj(o.inputs) || !isDeclarativeRuleset((o.inputs as { ruleset?: unknown }).ruleset) || !isObj((o.inputs as { extraction?: unknown }).extraction)) {
    throw new CaseRefused('inputs', 'a case is opened on a declarative verdict and its inputs { extraction, ruleset, source? }')
  }
  if (!isRetainedEngine(v.engine_version) || !engineAtLeast(v.engine_version, '0.3.0')) {
    throw new CaseRefused('engine', `a case is opened on a verdict of engine 0.3.0 or later (this one names ${String(v.engine_version)}): earlier engines do not state what is struck`)
  }
  if (isObj(o.inputs) && (o.inputs as { evidence?: unknown }).evidence !== undefined) throw new CaseRefused('inputs', 'a case opens on a filing, not on a re-verdict (its inputs carry no evidence overlay)')
  const r = verifyReplay(v, o.inputs)
  if (r.status !== 'REPERFORMED') throw new CaseRefused('replay', `the verdict does not re-perform on these inputs (${r.status}: ${r.reason ?? r.not_reperformed ?? ''}): a case opens only on a verdict anyone can re-derive`)
  let why: CaseRecord['why']
  if (o.dispute !== undefined) {
    const c = v.claims.find(x => x.claim_id === o.dispute)
    if (!c || c.outcome !== 'FAIL') throw new CaseRefused('dispute', `${o.dispute} is not a FAIL claim of this verdict: only a FAIL is disputed`)
    why = 'dispute'
  } else if (gateStatusOpen(v) === 'OPEN') why = 'struck'
  else throw new CaseRefused('not-open', `the verdict reads ${gateStatusOpen(v)}: nothing is struck and no FAIL is disputed, so there is nothing to arbitrate`)
  if (existsSync(join(o.dir, 'case.json'))) throw new CaseRefused('exists', `a case already lives in ${o.dir}`)
  const clock = clockOf(parties)
  const suspect = (v.struck ?? []).some(s => s.reason === 'suspect')
  const days = suspect ? clock.suspect_days : clock.ordinary_days
  const inputsText = `${canonicalize(o.inputs)}\n`, verdictText = `${JSON.stringify(v, null, 1)}\n`, partiesText = `${JSON.stringify(parties, null, 1)}\n`
  const record: CaseRecord = {
    format: CASE_FORMAT, case_id: '', opened_at: o.now, why, ...(o.dispute !== undefined ? { dispute: o.dispute } : {}),
    prior_verdict_id: v.verdict_id, engine_version: v.engine_version,
    filing: { inputs_sha256: sha256(inputsText), verdict_sha256: sha256(verdictText), ...(o.document ? { document_sha256: sha256Bytes(o.document) } : {}) },
    parties_sha256: sha256(partiesText),
    clock: { kind: suspect ? 'suspect' : 'ordinary', working_days: days, deadline: addWorkingDays(o.now, days) },
  }
  { const { case_id: _c, ...rest } = record; record.case_id = `case-${sha256(canonicalize(rest)).slice(0, 24)}` }
  for (const d of ['', 'filing', 'evidence', 'moves', 'verdicts']) mkdirSync(join(o.dir, d), { recursive: true })
  writeNew(join(o.dir, 'parties.json'), partiesText)
  writeNew(join(o.dir, 'filing', 'inputs.json'), inputsText)
  writeNew(join(o.dir, 'filing', 'verdict.json'), verdictText)
  if (o.document) writeNew(join(o.dir, 'filing', `document.${sniff(o.document) === 'unknown' ? 'bin' : sniff(o.document)}`), o.document)
  writeNew(join(o.dir, 'case.json'), `${JSON.stringify(record, null, 1)}\n`)
  appendRow(o.dir, o.now, 'case.open', {
    case_id: record.case_id, why, ...(o.dispute !== undefined ? { dispute: o.dispute } : {}), verdict: stateOf(v),
    struck: (v.struck ?? []).map(s => ({ field: s.field, reason: s.reason })), deadline: record.clock.deadline,
  })
  return loadCase(o.dir)
}

// ── the clock, applied ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Apply the clock at `now`: an open case past its deadline resolves (UNSUPPORTED, or FAIL for a disputed FAIL that still fails). */
export function applyClock(dir: string, now: string): CaseState {
  const st = loadCase(dir)
  if (st.status !== 'open' || Date.parse(now) < Date.parse(st.deadline)) return st
  const stillStruck = hasStruckLoadBearing(st.latest)
  const disputedStillFails = st.record.why === 'dispute' && st.latest.claims.some(c => c.claim_id === st.record.dispute && c.outcome === 'FAIL')
  const resolution: Resolution = stillStruck || !disputedStillFails ? 'UNSUPPORTED' : 'FAIL'
  appendRow(dir, now, 'case.resolve', {
    case_id: st.record.case_id, resolution, closed_on: resolution === 'UNSUPPORTED' ? 'E4' : st.latest.evidence_floor ?? 'unstated',
    why: `the clock ran out at ${st.deadline} (${st.record.clock.working_days} working days, ${st.record.clock.kind})${stillStruck ? ' with a load-bearing field still struck' : disputedStillFails ? ' and the disputed FAIL still fails' : ''}: never a PASS`,
    verdict_id: st.latest.verdict_id,
  })
  return loadCase(dir)
}

// ── filing a move ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface MoveOptions {
  dir: string
  /** the move as filed: its raw bytes (a refusal is recorded by their sha256) */
  move: Uint8Array
  /** the evidence document's bytes, when the move files one (its sha256 must equal the move's evidence.sha256) */
  evidence?: Uint8Array
  now: string
}

export interface MoveResult {
  accepted: boolean
  move_id?: string
  refusal?: MoveRefusal
  before?: VerdictState
  after?: VerdictState
  verdict?: Verdict
  resolution?: Resolution
  status: 'open' | 'resolved'
}

const CAN: Record<string, readonly Party['role'][]> = { correct: ['counterparty', 'filer'], strike: ['filer', 'operator'], corroborate: ['filer', 'counterparty', 'operator'] }

/** File one move. Never throws for a bad move: a refusal is recorded (by the move's sha256) and returned. */
export async function fileMove(o: MoveOptions): Promise<MoveResult> {
  let st = applyClock(o.dir, o.now)
  const moveSha = sha256Bytes(o.move)
  const refuse = (code: MoveRefusalCode, detail: string, extra: Record<string, unknown> = {}): MoveResult => {
    appendRow(o.dir, o.now, 'move.refused', { case_id: st.record.case_id, move_sha256: moveSha, code, detail, ...extra })
    return { accepted: false, refusal: { code, detail }, status: loadCase(o.dir).status }
  }
  let m: Move
  try { m = JSON.parse(Buffer.from(o.move).toString('utf8')) as Move } catch { return refuse('shape', 'the move is not valid JSON') }
  const shape = moveShapeRefusal(m)
  if (shape) return refuse(shape.code, shape.detail)
  const id = moveId(m)
  if (m.case !== st.record.case_id) return refuse('case-mismatch', `the move names case ${m.case}; this is ${st.record.case_id}`, { move_id: id })
  const signer = partyByFingerprint(st.parties, m.by)
  if (!signer) return refuse('unknown-signer', 'the signer\'s key is not enrolled in this case\'s parties file', { move_id: id })
  if (signer.held === true) return refuse('held', `${signer.id} is held and moves nothing`, { move_id: id, by: signer.id })
  if (!moveSignatureValid(m, m.sig, signer.public_key)) return refuse('bad-signature', `the signature does not verify against ${signer.id}'s enrolled key`, { move_id: id, by: signer.id })
  if (st.nonces.has(m.nonce)) return refuse('nonce-reused', 'this nonce was used before in this case: a move is filed once', { move_id: id, by: signer.id })
  if (Date.parse(m.at) > Date.parse(o.now) + 5 * 60_000) return refuse('not-yet-valid', `the move is dated ${m.at}, after ${o.now}`, { move_id: id, nonce: m.nonce, by: signer.id })
  if (Date.parse(o.now) > Date.parse(m.expires_at)) return refuse('expired', `the move expired at ${m.expires_at}`, { move_id: id, nonce: m.nonce, by: signer.id })
  if (!CAN[m.type]!.includes(signer.role)) return refuse('role', `a ${signer.role} may not ${m.type.toUpperCase()} (CORRECT: the counterparty, or the filer with its countersign; STRIKE: the filer or the operator; CORROBORATE: any party)`, { move_id: id, nonce: m.nonce, by: signer.id })
  if (m.type === 'correct' && signer.role === 'filer') {
    const cs = m.countersign
    const counter = cs ? partyByFingerprint(st.parties, cs.by) : undefined
    if (!cs || !counter || counter.role !== 'counterparty' || counter.held === true || !moveSignatureValid(m, cs.sig, counter.public_key)) {
      return refuse('countersign', 'a filer\'s CORRECT needs the counterparty\'s countersign over the same move', { move_id: id, nonce: m.nonce, by: signer.id })
    }
  }
  // A resolved case: only a CORROBORATE at a strictly higher tier than it closed on reopens it (checked after reading the source).
  if (st.status === 'resolved' && m.type !== 'corroborate') return refuse('case-closed', `the case is resolved (${st.resolution}); only a CORROBORATE at a higher tier than ${st.closed_on ?? 'its floor'} reopens it`, { move_id: id, nonce: m.nonce, by: signer.id })

  const rs = st.inputs.ruleset
  const pathFor = (role: string, path?: string): string | undefined => {
    if (path !== undefined) return path
    const s = (st.latest.struck ?? []).find(x => x.role === role && x.path !== undefined)
    if (s?.path) return s.path
    const f = Object.prototype.hasOwnProperty.call(rs.fields, role) ? rs.fields[role] : undefined
    return f && !f.line && !Array.isArray(f.each) ? f.paths[0] : undefined
  }
  const overlay: EvidenceOverlay = structuredClone(st.overlay)
  let reasonForResolution: string | undefined
  let filedDoc: { sha: string; bytes: Uint8Array; ext: string } | undefined
  if (m.type === 'strike') {
    const t = m.target!
    if ('document' in t) {
      const filing = t.document === 'filing' || t.document === st.record.filing.document_sha256
      if (filing) {
        overlay.struck = [...(overlay.struck ?? []), { document: true, move_id: id, reason: m.reason }]
      } else {
        const had = Object.values(overlay.fields ?? {}).some(items => items.some(it => it.document_sha256 === t.document))
        if (!had) return refuse('field-unknown', `no document ${t.document.slice(0, 12)}… is on the record of this case`, { move_id: id, nonce: m.nonce, by: signer.id })
        const fields: Record<string, EvidenceItem[]> = {}
        for (const [p, items] of Object.entries(overlay.fields ?? {})) { const keep = items.filter(it => it.document_sha256 !== t.document); if (keep.length) fields[p] = keep }
        if (Object.keys(fields).length) overlay.fields = fields; else delete overlay.fields
      }
    } else {
      const path = pathFor(t.field.role, t.field.path)
      if (path === undefined) return refuse('field-unknown', `${t.field.role} is not a document field of ${rs.id}@${rs.version}`, { move_id: id, nonce: m.nonce, by: signer.id })
      overlay.struck = [...(overlay.struck ?? []), { path, move_id: id, reason: m.reason }]
    }
  } else {
    const ev = m.evidence!
    const bytes = o.evidence ?? (existsSync(join(o.dir, 'evidence', ev.file)) ? new Uint8Array(readFileSync(join(o.dir, 'evidence', ev.file))) : undefined)
    if (!bytes) return refuse('evidence-missing', `the evidence document ${ev.file} was not filed with the move`, { move_id: id, nonce: m.nonce, by: signer.id })
    const sha = sha256Bytes(bytes)
    if (sha !== ev.sha256) return refuse('evidence-missing', `the evidence filed hashes to ${sha.slice(0, 12)}…, not the ${ev.sha256.slice(0, 12)}… the move signed`, { move_id: id, nonce: m.nonce, by: signer.id })
    const field = m.field!
    const path = pathFor(field.role, field.path)
    if (path === undefined) return refuse('field-unknown', `${field.role} is not a document field of ${rs.id}@${rs.version}`, { move_id: id, nonce: m.nonce, by: signer.id })
    if (m.type === 'corroborate' && st.record.filing.document_sha256 === sha) {
      return refuse('not-independent', 'the corroborating document is the filing itself: two readings of one artifact are one source', { move_id: id, nonce: m.nonce, by: signer.id })
    }
    const read = await readEvidence(bytes, { ruleset: rs, role: field.role, parties: st.parties, ...(ev.locator !== undefined ? { locator: ev.locator } : {}), ...(ev.source_id !== undefined ? { source_id: ev.source_id } : {}) })
    if (!read.ok) return refuse(read.code, read.detail, { move_id: id, nonce: m.nonce, by: signer.id })
    const prior = overlay.fields?.[path] ?? []
    if (m.type === 'corroborate') {
      const same = prior.find(it => it.source_id === read.item.source_id || (it.document_sha256 !== undefined && it.document_sha256 === sha))
      if (same) return refuse('not-independent', `${field.role} is already supported by ${same.source_id === read.item.source_id ? `source ${same.source_id}` : `document ${sha.slice(0, 12)}…`} (move ${same.move_id.slice(0, 12)}…): independence is by source, never two readings of one artifact`, { move_id: id, nonce: m.nonce, by: signer.id })
      if (st.status === 'resolved') {
        const closedOn = st.closed_on ?? 'E4'
        if (!(tierRank(read.item.tier) < tierRank(closedOn))) return refuse('reopen-tier', `the case closed on ${closedOn}; a CORROBORATE at ${read.item.tier} is not higher, so it does not reopen it`, { move_id: id, nonce: m.nonce, by: signer.id })
      }
    }
    overlay.fields = { ...(overlay.fields ?? {}), [path]: [...prior, { ...read.item, kind: m.type, move_id: id }] }
    filedDoc = { sha, bytes, ext: read.kind === 'unknown' ? 'bin' : read.kind }
    reasonForResolution = read.note
  }

  // Accepted: the record, then the re-verdict, then the resolution.
  if (st.status === 'resolved') {
    const clock = clockOf(st.parties)
    appendRow(o.dir, o.now, 'case.reopen', { case_id: st.record.case_id, move_id: id, why: 'a CORROBORATE at a higher tier than the case closed on', deadline: addWorkingDays(o.now, clock.ordinary_days) })
    st = loadCase(o.dir)
  }
  if (filedDoc) writeNew(join(o.dir, 'evidence', `${filedDoc.sha}.${filedDoc.ext}`), filedDoc.bytes)
  writeNew(join(o.dir, 'moves', `${id}.json`), `${JSON.stringify(m, null, 1)}\n`)
  appendRow(o.dir, o.now, 'move.accepted', {
    case_id: st.record.case_id, move_id: id, move_sha256: moveSha, type: m.type, by: signer.id, role: signer.role, nonce: m.nonce,
    ...(m.field ? { field: m.field } : {}), ...(m.target ? { target: m.target } : {}), ...(filedDoc ? { evidence_sha256: filedDoc.sha } : {}),
    ...(reasonForResolution ? { read: reasonForResolution } : {}),
  })
  const before = stateOf(st.latest)
  const opts = {
    now: () => new Date(o.now), engine: st.record.engine_version, evidence: overlay,
    ...(isObj(st.inputs.source) ? { source: st.inputs.source as { text: string } } : {}),
    ...(isObj(st.inputs.tolerance) ? { tolerance: st.inputs.tolerance as { rel: number; absCap: number } } : {}),
  }
  const v = verifyDeclarative(st.inputs.extraction, rs, opts)
  // the case link is an annotation (outside the compared body); the scope stays last
  const scope = v.scope
  delete v.scope
  v.case = { case_id: st.record.case_id, prior_verdict_id: st.latest.verdict_id, move_id: id }
  if (scope) v.scope = scope
  const inputs = verifyInputs(st.inputs.extraction, { ruleset: rs, ...(opts.source ? { source: opts.source } : {}), ...(opts.tolerance ? { tolerance: opts.tolerance } : {}), evidence: overlay })
  writeNew(join(o.dir, 'verdicts', `${v.verdict_id}.json`), `${JSON.stringify({ verdict: v, inputs }, null, 1)}\n`)
  const after = stateOf(v)
  appendRow(o.dir, o.now, 'verdict', { case_id: st.record.case_id, prior_verdict_id: st.latest.verdict_id, move_id: id, verdict_id: v.verdict_id, before, after })
  // Resolution: a STRIKE that leaves a load-bearing field withdrawn books UNSUPPORTED; otherwise OPEN stays open, and any other
  // reading resolves the case to it.
  const withdrawn = (v.struck ?? []).some(s => s.reason === 'withdrawn')
  let resolution: Resolution | undefined
  if (m.type === 'strike' && withdrawn) resolution = 'UNSUPPORTED'
  else if (after.gate !== 'OPEN') resolution = after.gate
  if (resolution) {
    appendRow(o.dir, o.now, 'case.resolve', {
      case_id: st.record.case_id, resolution, closed_on: resolution === 'UNSUPPORTED' ? 'E4' : v.evidence_floor ?? 'unstated', verdict_id: v.verdict_id,
      why: resolution === 'UNSUPPORTED' ? `a STRIKE withdrew a load-bearing field (${m.reason})` : `the re-verdict reads ${resolution}: nothing load-bearing is struck`,
    })
  }
  return { accepted: true, move_id: id, before, after, verdict: v, ...(resolution ? { resolution } : {}), status: resolution ? 'resolved' : 'open' }
}

// ── status ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface CaseStatus {
  case_id: string
  status: 'open' | 'resolved'
  resolution?: Resolution
  opened_at: string
  why: CaseRecord['why']
  deadline: string
  latest: VerdictState
  struck: { field: string; reason: string }[]
  moves: { accepted: number; refused: number; by_type: Record<string, number>; refused_by_code: Record<string, number> }
  /** counts per party (counts only): what each party filed and what was refused (the counterparty record, EV5-lite) */
  parties: Record<string, { correct: number; strike: number; corroborate: number; refused: number }>
  findings: number
  verdicts: number
}

/** The case at `now` (the clock applied first). */
export function caseStatus(dir: string, now: string): CaseStatus {
  const st = applyClock(dir, now)
  const by_type: Record<string, number> = {}, refused_by_code: Record<string, number> = {}
  const parties: CaseStatus['parties'] = {}
  for (const p of st.parties.parties) parties[p.id] = { correct: 0, strike: 0, corroborate: 0, refused: 0 }
  let accepted = 0, refused = 0, verdicts = 0
  for (const r of st.rows) {
    if (r.kind === 'move.accepted') {
      accepted++
      const t = String(r.data.type)
      by_type[t] = (by_type[t] ?? 0) + 1
      const who = String(r.data.by)
      if (parties[who] && (t === 'correct' || t === 'strike' || t === 'corroborate')) parties[who]![t]++
    }
    if (r.kind === 'move.refused') { refused++; const c = String(r.data.code); refused_by_code[c] = (refused_by_code[c] ?? 0) + 1 }
    if (r.kind === 'verdict') verdicts++
  }
  // a refused move names its party only when its key was enrolled (an unknown key is no party's)
  for (const r of st.rows) if (r.kind === 'move.refused' && typeof r.data.by === 'string' && parties[r.data.by]) parties[r.data.by]!.refused++
  return {
    case_id: st.record.case_id, status: st.status, ...(st.resolution ? { resolution: st.resolution } : {}), opened_at: st.record.opened_at, why: st.record.why,
    deadline: st.deadline, latest: stateOf(st.latest), struck: (st.latest.struck ?? []).map(s => ({ field: s.field, reason: s.reason })),
    moves: { accepted, refused, by_type, refused_by_code }, parties, findings: (st.latest.findings ?? []).length, verdicts,
  }
}

// ── replay ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface CaseReplay {
  ok: boolean
  ledger: string[]
  verdicts: { verdict_id: string; status: string; reason?: string }[]
  moves: { move_id: string; signature: boolean; reread?: 'same' | 'differs' | 'skipped'; detail?: string }[]
}

/**
 * Re-check a case from its directory: the ledger chains; every accepted move's signature verifies against the parties file; the
 * filing verdict and every re-verdict re-perform byte for byte on their recorded inputs (the evidence overlay included); and,
 * with `reread`, every filed document is read again and must give the value the overlay holds (a PDF re-read needs the readers;
 * a signed statement and a UBL XML re-read the same anywhere).
 */
export async function replayCase(dir: string, o: { reread?: boolean } = {}): Promise<CaseReplay> {
  const rows = readLedger(dir)
  const ledger = ledgerProblems(rows)
  const st = loadCase(dir)
  const verdicts: CaseReplay['verdicts'] = []
  const filing = readJsonFile(join(dir, 'filing', 'verdict.json')) as Verdict
  const r0 = verifyReplay(filing, st.inputs)
  verdicts.push({ verdict_id: filing.verdict_id, status: r0.status, ...(r0.reason ? { reason: r0.reason } : {}) })
  const moves: CaseReplay['moves'] = []
  const vdir = join(dir, 'verdicts')
  for (const r of rows) {
    if (r.kind === 'verdict' && typeof r.data.verdict_id === 'string') {
      const b = readJsonFile(join(vdir, `${r.data.verdict_id}.json`)) as { verdict: Verdict; inputs: unknown }
      const rr = verifyReplay(b.verdict, b.inputs)
      verdicts.push({ verdict_id: b.verdict.verdict_id, status: rr.status, ...(rr.reason ? { reason: rr.reason } : {}) })
    }
    if (r.kind === 'move.accepted' && typeof r.data.move_id === 'string') {
      const m = readJsonFile(join(dir, 'moves', `${r.data.move_id}.json`)) as Move
      const signer = partyByFingerprint(st.parties, m.by)
      const signature = !!signer && moveSignatureValid(m, m.sig, signer.public_key) && moveId(m) === r.data.move_id
      let reread: CaseReplay['moves'][number]['reread'] = 'skipped'
      let detail: string | undefined
      if (o.reread && m.evidence && typeof r.data.evidence_sha256 === 'string') {
        const files = readdirSync(join(dir, 'evidence')).filter(f => f.startsWith(`${r.data.evidence_sha256}.`))
        const bytes = files.length ? new Uint8Array(readFileSync(join(dir, 'evidence', files[0]!))) : undefined
        if (!bytes) { reread = 'differs'; detail = 'the filed document is missing from the case' }
        else {
          const rd = await readEvidence(bytes, { ruleset: st.inputs.ruleset, role: m.field!.role, parties: st.parties, ...(m.evidence.locator !== undefined ? { locator: m.evidence.locator } : {}), ...(m.evidence.source_id !== undefined ? { source_id: m.evidence.source_id } : {}) })
          const held = Object.values(st.overlay.fields ?? {}).flat().find(it => it.move_id === r.data.move_id)
          if (!rd.ok) { reread = 'differs'; detail = `${rd.code}: ${rd.detail}` }
          else if (held && rd.item.value === held.value && rd.item.tier === held.tier) reread = 'same'
          else if (!held) { reread = 'same'; detail = 'the item was later withdrawn from the overlay by a STRIKE; the document still reads' }
          else { reread = 'differs'; detail = `read ${String(rd.item.value)} at ${rd.item.tier}; the overlay holds ${String(held.value)} at ${held.tier}` }
        }
      }
      moves.push({ move_id: r.data.move_id, signature, reread, ...(detail ? { detail } : {}) })
    }
  }
  const ok = ledger.length === 0 && verdicts.every(v => v.status === 'REPERFORMED') && moves.every(m => m.signature && m.reread !== 'differs')
  return { ok, ledger, verdicts, moves }
}
