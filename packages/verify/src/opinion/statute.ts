/**
 * Precedent → statute: the customer's own rulebook (2026-09-28, a first stone).
 *
 * People rule on disputes (ruling.ts): "this FAIL stands", "set this one aside". One ruling settles one document. Many
 * rulings on the same rule are a record of how THIS customer reads it, and the miner (src/mine) can read that record: it
 * proposes the rules that best explain which documents people held. Here each signed ruling on LAW becomes one row of a
 * case table that `verify mine` consumes unchanged, and each candle the miner accepts comes back as COUNSEL (GENERATED,
 * carrying its judges, dismissible). It is never a VERDICT and it never holds an action: a person adopts, amends or
 * dismisses it, and only a person writes it into a ruleset (a new version).
 *
 *   statuteFromRulings({ snapshot, rulings, rule_id, domain, scope? })   → Statute: the case table + schema, every row a
 *                                                                           re-verified ruling, every exclusion explained
 *   statuteCounsel(statute)                                              → { report, counsel }: the miner's report, and
 *                                                                           each candle as COUNSEL
 *   statuteMineFiles(statute)                                            → the rows (JSONL) and schema (JSON) for
 *                                                                           `verify mine rows.jsonl --schema s.json --thresholds`
 *
 * EVERY ROW IS RE-VERIFIED (the self-verifying rule, carried into the loop): the ruling's Ed25519 signature (and, with
 * trusted_keys, that the key is the signer's); the book it names is a PREFIX of this book (same head at that length; the
 * chain is append-only); and the dispute opinion it answers RE-DERIVES from that prefix, byte for byte (same opinion id),
 * so the person ruled on exactly what Riposte proposed. A ruling that fails any check is excluded, with the reason. A later
 * ruling on the same claim supersedes an earlier one (the ruling book is append-only; order is its order).
 *
 * THE ROW (label, then fields). Label: 'hold' when the ruling leaves the document held (a FAIL that STANDS, a PASS SET
 * ASIDE), else 'approve'. Fields: the disputed claim's own cells (claim_asserted, claim_expected, claim_variance), plus every
 * document-scope cell the verdict cites as evidence, named by source and path (invoice:totals.subtotal → invoice_totals_subtotal),
 * each typed by its first value (number → qty, boolean → bool, string → id, list → ids). Not in the table yet, and counted
 * in `skipped`: line-scope cells (line_items[i].…), computed cells (their "path" is a formula), and a cell a verdict cites
 * with two different values. The verdict carries no extraction, so a statute sees only what the verdict cites.
 *
 * With a tenant scope every row, value and ruling is the tenant's (snapshot.ts): a ruling made under another tenant's scope
 * (or none) is excluded. Pure and deterministic: rows are sorted by case id, so the order rulings arrive in changes nothing
 * but supersession.
 */

import { recordFacts } from '../ledger/disk.js'
import { hashOf } from '../verdict/canonical.js'
import { ChannelViolation, counselFromCandle, makeCounsel, type Counsel, type JudgeResult } from '../verdict/channel.js'
import type { ClaimVerdict, Value, Verdict } from '../verdict/schema.js'
import type { TrustedKeys } from '../ledger/decisions.js'
import type { RootKeys } from '../ledger/registry.js'
import { mine } from '../mine/miner.js'
import type { CandidateSpec, CaseTable, JudgedCandidate, MineCase, MineFieldType, MineOptions, MineReport, MineSchema, Term } from '../mine/types.js'
import { openSnapshot, type LedgerSnapshot, type SnapshotView } from './snapshot.js'
import { disputeOpinionOnView } from './dispute.js'
import { short } from './common.js'
import { verifySignedRuling, type LawRuling, type SignedRuling } from './ruling.js'
import type { OpinionScope } from './types.js'

export const STATUTE_VERSION = '0.1.0'
export const STATUTE_GENERATOR = 'riposte-statute'

export interface StatuteInput {
  /** The book of record (a chain export). Rulings name earlier books; each must be a prefix of this one. */
  snapshot: LedgerSnapshot
  /** The ruling book, in order (later rulings on the same claim supersede earlier ones). Rulings on other rules are ignored. */
  rulings: readonly SignedRuling[]
  /** The rule the statute is about, and its domain. */
  rule_id: string
  domain: string
  /** Which disputed finding: FAIL (does the rule's FAIL bind?) or PASS (did it miss something?). Default FAIL. */
  outcome?: 'FAIL' | 'PASS'
  /** One tenant's rulings and records only (a shared book). */
  scope?: OpinionScope
  /** Anchor ruling (and decision) signers to people. Without it every signer is named unanchored. */
  trusted_keys?: TrustedKeys
  /** The registry's root key(s): anchors the book's decision signers through the registry. Rulings are not on the registry yet: they anchor by trusted_keys only. */
  root_keys?: RootKeys
  /** The original inputs of input-bound opinions, by verdict id (needed to re-derive them). */
  inputs?: Readonly<Record<string, unknown>>
}

/** Where a case-table field was read from. */
export type StatuteCell = { source: string; path: string } | { claim: 'asserted' | 'expected' | 'variance' }

export interface StatuteRow {
  case_id: string
  label: 'hold' | 'approve'
  ruling: LawRuling
  ruling_id: string
  opinion_id: string
  verdict_id: string
  claim_id: string
  proposed: 'UPHOLD' | 'REFER'
  signer_id: string
  signed_at: string
  /** The signer's key is anchored to a person (trusted_keys). */
  anchored: boolean
}

export interface Statute {
  statute_version: 'statute-v0'
  rule_id: string
  domain: string
  outcome: 'FAIL' | 'PASS'
  tenant_id?: string
  /** The book the statute was read from. */
  book: { head: string; length: number }
  /** Exactly what `verify mine` reads: the rows. */
  table: CaseTable
  /** ...and the schema (approve label 'approve'). */
  schema: MineSchema
  /** Case-table field → the cell it was read from. */
  fields: Record<string, StatuteCell>
  /** One per case, in case order: the signed ruling behind it. */
  rows: StatuteRow[]
  /** Rulings on this rule that did not make a row, and why. */
  excluded: { ruling_id: string; why: string }[]
  /** Rulings replaced by a later ruling on the same claim. */
  superseded: { ruling_id: string; by: string }[]
  /**
   * What the table leaves out, counted: rulings on other rules or outcomes; rulings made under another tenant's scope (never
   * named); and, a first stone, line-scope cells, computed cells, a cell cited with two values, a value of another type.
   */
  skipped: { other_rulings: number; other_tenant_rulings: number; line_cells: number; computed_cells: number; conflicting_cells: number; other_type_values: number }
  /** hashOf(everything above): the anchor COUNSEL generated from it cites. */
  statute_hash: string
}

const CLAIM_FIELDS = { asserted: 'claim_asserted', expected: 'claim_expected', variance: 'claim_variance' } as const
const RESERVED = new Set(['sum', 'abs', 'line_items'])

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
/** -0 → 0, so a row survives a JSON round trip byte for byte (the `verify mine` path). */
const norm0 = (x: number): number => (x === 0 ? 0 : x)

function typeOf(v: Value): MineFieldType | undefined {
  if (finite(v)) return 'qty'
  if (typeof v === 'boolean') return 'bool'
  if (typeof v === 'string') return v.length ? 'id' : undefined
  if (Array.isArray(v) && v.length && v.every(x => typeof x === 'string' || finite(x))) return 'ids'
  return undefined
}

function fieldName(source: string, path: string, taken: Set<string>): string {
  let base = `${source}_${path}`.replace(/[^A-Za-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')
  if (!base || /^[0-9]/.test(base) || RESERVED.has(base)) base = `f_${base}`
  let name = base
  for (let i = 2; taken.has(name); i++) name = `${base}_${i}`
  taken.add(name)
  return name
}

/** The document-scope cells a verdict cites (source:path → value), and what was skipped. */
function citedCells(v: Verdict): { cells: Map<string, { source: string; path: string; value: Value }>; line: number; computed: number; conflicting: number } {
  const seen = new Map<string, { source: string; path: string; values: Value[] }>()
  let line = 0, computed = 0
  for (const c of v.claims) {
    for (const e of c.evidence) {
      if (e.locator.kind !== 'field') continue
      if (e.locator.source === 'computed') { computed++; continue }
      if (e.locator.path.includes('[')) { line++; continue }
      const k = `${e.locator.source}\u0000${e.locator.path}`
      const s = seen.get(k) ?? { source: e.locator.source, path: e.locator.path, values: [] }
      s.values.push(e.value)
      seen.set(k, s)
    }
  }
  const cells = new Map<string, { source: string; path: string; value: Value }>()
  let conflicting = 0
  for (const [k, s] of seen) {
    const first = hashOf(s.values[0])
    if (s.values.every(x => hashOf(x) === first)) cells.set(k, { source: s.source, path: s.path, value: s.values[0] as Value })
    else conflicting++
  }
  return { cells, line, computed, conflicting }
}

interface Accepted { signed: SignedRuling; anchored: boolean; rec: { verdict: Verdict }; claim: ClaimVerdict }

/** Build the statute: every ruling on (rule, domain, outcome) re-verified against the book, each surviving one a case row. */
export function statuteFromRulings(input: StatuteInput): Statute {
  const outcome = input.outcome ?? 'FAIL'
  const { events, payloads } = input.snapshot
  const readOpts = { ...(input.trusted_keys ? { trusted_keys: input.trusted_keys } : {}) }
  const bookOpts = { ...readOpts, ...(input.root_keys?.length ? { root_keys: input.root_keys } : {}) }
  const view = openSnapshot(input.snapshot, { ...(input.scope ? { scope: input.scope } : {}), ...bookOpts })
  if (!view.content_verified || view.source !== 'chain' || !events || !payloads || !view.chain) {
    const why = view.source !== 'chain' ? 'no chain was supplied' : `the book of record does not verify${view.chain?.brokenAt !== undefined ? ` at event ${view.chain.brokenAt}` : ''} (${view.chain?.reason ?? 'unknown'})`
    throw new Error(`${why}: no statute is read from a book that cannot be shown to be the ledger's`)
  }
  const tenant = view.scope?.tenant_id
  const excluded: Statute['excluded'] = []
  const superseded: Statute['superseded'] = []
  let other = 0, otherTenant = 0
  const prefixViews = new Map<string, SnapshotView>()
  const prefixView = (length: number, t: string | undefined): SnapshotView => {
    const k = `${length}\u0000${t ?? ''}`
    let pv = prefixViews.get(k)
    if (!pv) {
      pv = openSnapshot({ events: events.slice(0, length), payloads: payloads.slice(0, length) }, {
        ...(t !== undefined ? { scope: { tenant_id: t, ...(input.scope?.owns_workflow ? { owns_workflow: input.scope.owns_workflow } : {}) } } : {}),
        ...bookOpts,
      })
      prefixViews.set(k, pv)
    }
    return pv
  }

  const byCase = new Map<string, Accepted>()
  for (const signed of input.rulings) {
    const r = (signed as { ruling?: Partial<SignedRuling['ruling']> })?.ruling
    const rid = typeof signed?.ruling_id === 'string' ? signed.ruling_id : '(no id)'
    if (!r || typeof r !== 'object' || r.rule_id !== input.rule_id || r.ruleset?.domain !== input.domain || r.outcome !== outcome) { other++; continue }
    // Another tenant's ruling is not this tenant's to read: counted, never named (no id, no tenant).
    if (tenant !== undefined && r.tenant_id !== undefined && r.tenant_id !== tenant) { otherTenant++; continue }
    const ex = (why: string): void => { excluded.push({ ruling_id: rid, why }) }
    const check = verifySignedRuling(signed, readOpts)
    if (!check.ok) { ex(check.reason ?? 'the signed ruling does not verify'); continue }
    const ruling = signed.ruling
    if (tenant !== undefined && ruling.tenant_id === undefined) {
      ex(`made without a tenant scope; a statute scoped to tenant ${tenant} reads only rulings made under that tenant's scope`)
      continue
    }
    const len = ruling.book.length
    if (len > events.length || events[len - 1]!.entry_hash !== ruling.book.head) {
      ex(`the book it names (head \`${short(ruling.book.head)}\`, ${len} events) is not a prefix of this book of record`)
      continue
    }
    const pv = prefixView(len, ruling.tenant_id)
    if (!pv.content_verified) { ex('the book it names does not verify'); continue }
    const params = ruling.opinion_params
    if (params.input_bound && !(input.inputs && Object.prototype.hasOwnProperty.call(input.inputs, ruling.verdict_id))) {
      ex('the opinion it answers was bound to the original inputs, which were not supplied: it cannot be re-derived from the book alone')
      continue
    }
    let opinionId: string, disposition: string
    try {
      const op = disputeOpinionOnView(pv, {
        verdict_id: ruling.verdict_id, claim_id: ruling.claim_id,
        precedent: { min_reviewed: params.min_reviewed, flag_threshold: params.flag_threshold },
        confidence: params.confidence, method: params.method,
        ...(params.consequence ? { consequence: params.consequence } : {}),
        ...(params.input_bound ? { inputs: input.inputs![ruling.verdict_id] } : {}),
      })
      opinionId = op.opinion_id
      disposition = op.ruling.disposition
    } catch (e) {
      ex(`the opinion it answers cannot be re-derived: ${(e as Error).message}`)
      continue
    }
    if (opinionId !== ruling.opinion_id) { ex(`the opinion it answers does not re-derive from the book it names (the book gives \`${short(opinionId)}\`, the ruling names \`${short(ruling.opinion_id)}\`)`); continue }
    if (disposition !== ruling.proposed) { ex(`the ruling says Riposte proposed ${ruling.proposed}; the opinion proposes ${disposition}`); continue }
    const rec = view.records.find(x => (recordFacts(x) ?? x.verdict).verdict_id === ruling.verdict_id) // P-J: no parse per record
    const claim = rec?.verdict.claims.find(c => c.claim_id === ruling.claim_id)
    if (!rec || !claim) { ex(`verdict ${short(ruling.verdict_id)} is not on ${tenant !== undefined ? `tenant ${tenant}'s` : 'this'} book of record`); continue }
    const key = `${ruling.verdict_id}/${ruling.claim_id}`
    const prior = byCase.get(key)
    if (prior) superseded.push({ ruling_id: prior.signed.ruling_id, by: signed.ruling_id })
    byCase.set(key, { signed, anchored: check.anchored, rec, claim })
  }

  // ── the case table ──────────────────────────────────────────────────────────────────────────────────────────────
  const accepted = [...byCase.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const skipped = { other_rulings: other, other_tenant_rulings: otherTenant, line_cells: 0, computed_cells: 0, conflicting_cells: 0, other_type_values: 0 }
  const perCase = accepted.map(([key, acc]) => {
    const c = citedCells(acc.rec.verdict)
    skipped.line_cells += c.line; skipped.computed_cells += c.computed; skipped.conflicting_cells += c.conflicting
    return { key, acc, cells: c.cells }
  })
  const taken = new Set<string>(Object.values(CLAIM_FIELDS))
  const nameOf = new Map<string, string>()
  const fields: Record<string, StatuteCell> = {}
  for (const k of [...new Set(perCase.flatMap(p => [...p.cells.keys()]))].sort()) {
    const [source, path] = k.split('\u0000') as [string, string]
    const name = fieldName(source, path, taken)
    nameOf.set(k, name)
    fields[name] = { source, path }
  }
  const types = new Map<string, MineFieldType>()
  const put = (row: Record<string, unknown>, name: string, v: Value | undefined): void => {
    if (v === undefined || v === null) return
    const t = typeOf(v)
    if (!t) { skipped.other_type_values++; return }
    const want = types.get(name) ?? t
    if (want !== t) { skipped.other_type_values++; return }
    types.set(name, want)
    row[name] = finite(v) ? norm0(v) : Array.isArray(v) ? [...v] : v
  }
  const cases: MineCase[] = []
  const rows: StatuteRow[] = []
  for (const { key, acc, cells } of perCase) {
    const r = acc.signed.ruling
    const row: Record<string, unknown> = {}
    put(row, CLAIM_FIELDS.asserted, finite(acc.claim.asserted) ? acc.claim.asserted : undefined)
    put(row, CLAIM_FIELDS.expected, finite(acc.claim.computation?.result) ? acc.claim.computation!.result : undefined)
    put(row, CLAIM_FIELDS.variance, finite(acc.claim.variance) ? acc.claim.variance : undefined)
    for (const [k, cell] of [...cells.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) put(row, nameOf.get(k)!, cell.value)
    const held = (outcome === 'FAIL') === (r.ruling === 'STANDS')
    const label = held ? 'hold' : 'approve'
    cases.push({ id: key, label, fields: row })
    rows.push({
      case_id: key, label, ruling: r.ruling, ruling_id: acc.signed.ruling_id, opinion_id: r.opinion_id, verdict_id: r.verdict_id,
      claim_id: r.claim_id, proposed: r.proposed, signer_id: r.signer_id, signed_at: r.signed_at, anchored: acc.anchored,
    })
  }
  for (const [name, t] of Object.entries(CLAIM_FIELDS)) if (types.has(t)) fields[t] = { claim: name as 'asserted' | 'expected' | 'variance' }
  const used = Object.keys(fields).filter(n => types.has(n)).sort()
  const schema: MineSchema = { approve: 'approve', fields: Object.fromEntries(used.map(n => [n, { type: types.get(n)! }])) }
  const body: Omit<Statute, 'statute_hash'> = {
    statute_version: 'statute-v0',
    rule_id: input.rule_id,
    domain: input.domain,
    outcome,
    ...(tenant !== undefined ? { tenant_id: tenant } : {}),
    book: { head: view.chain.head, length: view.chain.length },
    table: { cases },
    schema,
    fields: Object.fromEntries(used.map(n => [n, fields[n]!])),
    rows,
    excluded,
    superseded,
    skipped,
  }
  return { ...body, statute_hash: hashOf(body) }
}

/** Does a statute still match its own hash? (Altered after it was built → nothing is surfaced from it.) */
export function statuteIntact(s: Statute): boolean {
  const { statute_hash, ...body } = s
  return hashOf(body) === statute_hash
}

/** The rows (JSONL) and schema (JSON) for `verify mine <rows.jsonl> --schema <schema.json> --thresholds`. */
export function statuteMineFiles(s: Statute): { cases: string; schema: string } {
  return { cases: s.table.cases.map(c => JSON.stringify(c)).join('\n'), schema: JSON.stringify(s.schema, null, 2) }
}

/** The field names a candidate's spec reads. */
function specFields(spec: CandidateSpec): string[] {
  const out = new Set<string>()
  const term = (t: Term): void => {
    if ('field' in t) out.add(t.field)
    else if ('sum' in t) out.add(t.sum)
    else if ('sumProduct' in t) { out.add(t.sumProduct[0]); out.add(t.sumProduct[1]) }
    else if ('plus' in t) { term(t.plus[0]); term(t.plus[1]) }
    else if ('gated' in t) { out.add(t.gated); out.add(t.by) }
  }
  switch (spec.form) {
    case 'rel': term(spec.left); term(spec.right); break
    case 'ids_one': out.add(spec.list); out.add(spec.id); break
    case 'id_eq': out.add(spec.x); out.add(spec.y); break
    case 'product': out.add(spec.a); out.add(spec.q); out.add(spec.p); break
    default: out.add(spec.x); out.add(spec.y)
  }
  return [...out].sort()
}

function cellText(s: Statute, name: string): string {
  const c = s.fields[name]
  if (!c) return `\`${name}\``
  if ('claim' in c) return c.claim === 'variance' ? 'the disputed claim\'s variance (asserted − expected)' : `the disputed claim's ${c.claim} value`
  return `\`${c.source}:${c.path}\``
}

function candleCounsel(s: Statute, report: MineReport, candle: JudgedCandidate): Counsel {
  const mined = counselFromCandle(report, candle) // re-checks the miner's three judges against the report's own gates
  const n = s.rows.length
  const anchored = s.rows.filter(r => r.anchored).length
  const precedentJudge: JudgeResult = {
    judge: 'PRECEDENT',
    passed: statuteIntact(s) && n > 0,
    detail: `${n} signed ruling(s) on LAW behind this table, each re-verified: its Ed25519 signature (${anchored === n ? 'every signer anchored to a person' : `${n - anchored} signer(s) not anchored: no trusted keys`}), the book it names is a prefix of this one, and the dispute opinion it answers re-derives from that book byte for byte; ${s.excluded.length} excluded, ${s.superseded.length} superseded`,
    stats: { rulings: n, anchored, excluded: s.excluded.length, superseded: s.superseded.length },
  }
  const heldWord = s.outcome === 'FAIL' ? 'held (the FAIL stood)' : 'held (the PASS was set aside)'
  const releasedWord = s.outcome === 'FAIL' ? 'released (the FAIL set aside)' : 'released (the PASS stood)'
  const heldPhrase = s.outcome === 'FAIL' ? 'people let the FAIL stand and held the document' : 'people set the PASS aside and held the document'
  const whose = s.tenant_id !== undefined ? ` (tenant \`${s.tenant_id}\`)` : ''
  const byRow = new Map(s.rows.map(r => [r.case_id, r]))
  const spec = candle.spec
  let reading: string
  let title: string
  if (candle.family === 'C' && candle.c !== undefined && spec.form === 'rel') {
    const high = 'field' in spec.left
    const name = high ? (spec.left as { field: string }).field : (spec.right as { field: string }).field
    const side = high ? 'above' : 'below'
    const iv = candle.interval
    title = `Consider a statute for \`${s.rule_id}\` in '${s.domain}': its ${s.outcome} ${s.outcome === 'FAIL' ? 'binds' : 'misses'} when ${cellText(s, name)} is ${side} ${candle.c}`
    reading = `On every document whose ${cellText(s, name)} is ${side} ${candle.c}${iv && iv.lo !== null && iv.hi !== null ? ` (the rulings put the cut between ${iv.lo} and ${iv.hi})` : ''}, ${heldPhrase}: ${candle.holds} such ruling(s)${candle.approved ? `, and ${candle.approved} released document(s) lie on that side too` : '; no released document lies on that side'}.`
  } else {
    title = `Consider a statute for \`${s.rule_id}\` in '${s.domain}': \`${candle.id}\``
    reading = `The documents that violate \`${candle.id}\` were ${candle.holds} ${heldWord} and ${candle.approved} ${releasedWord}, of ${candle.decidable} decidable.`
  }
  return makeCounsel({
    kind: 'CANDLE',
    title,
    body: `From ${n} signed ruling(s) on \`${s.rule_id}\`'s ${s.outcome}s in '${s.domain}'${whose}: ${reading} Read as a statute, this is how your people have been reading \`${s.rule_id}\`. It is a candle for a person to adopt, amend or dismiss: nothing changes until a person writes it into the ruleset, as a new version.`,
    subject: {
      statute_hash: s.statute_hash,
      rule_id: s.rule_id,
      domain: s.domain,
      outcome: s.outcome,
      ...(s.tenant_id !== undefined ? { tenant_id: s.tenant_id } : {}),
      candle_id: candle.id,
      family: candle.family,
      spec: candle.spec,
      ...(candle.t !== undefined ? { t: candle.t } : {}),
      ...(candle.c !== undefined ? { c: candle.c } : {}),
      ...(candle.interval ? { interval: candle.interval } : {}),
      strict: candle.strict,
      cells: Object.fromEntries(specFields(candle.spec).map(f => [f, s.fields[f] ?? null])),
      violators: candle.violators,
      rulings: candle.violators.map(id => byRow.get(id)?.ruling_id).filter((x): x is string => !!x),
      mine_version: report.mine_version,
      table_hash: report.data.table_hash,
    },
    provenance: { type: 'GENERATED', generator: STATUTE_GENERATOR, generator_version: STATUTE_VERSION, source_hash: s.statute_hash },
    judges: [...mined.judges, precedentJudge],
  })
}

/**
 * Mine the statute's case table and return each accepted candle as COUNSEL. The C family (learned constants) is on by
 * default: a statute is most often a scope condition ("the FAIL binds above c"). Refuses a statute altered after it was
 * built (ChannelViolation): counsel is only surfaced from a table whose every row re-verified.
 */
export function statuteCounsel(s: Statute, options: MineOptions = {}): { report: MineReport; counsel: Counsel[] } {
  if (!statuteIntact(s)) throw new ChannelViolation('the statute does not match its own hash (altered after it was built): nothing is surfaced from it')
  const report = mine(s.table, s.schema, { thresholds: true, ...options })
  return { report, counsel: report.candles.map(c => candleCounsel(s, report, c)) }
}
