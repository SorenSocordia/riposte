/**
 * The shadow pilot's report (2026-10-03): PILOT-REPORT.md, the audit sheet, and the recount from the receipt ledger.
 *
 * Every count in the report is recounted from the signed ledger before the report is written (`recountFromLedger`), and the
 * report refuses to render when the two differ, when the chain does not verify, or without the frozen pre-registration.
 * Dollar figures come from the export's bill totals as the run read them (they are never on a receipt).
 *
 * IN WORDS BY DEFAULT (2026-10-05). A controller could not act on "recompute-with line[4].amount → AP_LINE_MATH".
 * So, unless the run was made with --hashes-only, the run's own record (pilot-run.json), this report and the audit sheet say
 * each problem in words: the vendor, the amount, what is wrong ("line 2 amount: 34 × 150.46 = 5115.64, but the line says
 * 5155.21") and what would clear it, starting with who may ("An AP supervisor may clear it, for this one only"). Those files
 * are the buyer's own working files and stay on the buyer's machine; the signed receipts hold hashes either way. With
 * --hashes-only they hold what they held before: rule ids, typed remedies, record ids, invoice numbers and totals.
 * The labour cost is said first: how many of the bills you paid the gate would have stopped, before any precision figure.
 * Pay applications (G702/G703) are counted and reported beside the bills, outside the pre-registered numbers.
 */
import { clopperPearsonInterval } from 'riposte-verify'
import type { LedgerEntry } from '../ledger.js'
import type { BuyerDecision, SourceId } from './mappers.js'
import type { CoPrimaryMetric, FrozenPrereg, PrimaryMetric } from './prereg.js'
import type { KeyCustody } from './shadow.js'

export type Disposition = 'pay' | 'hold' | 'person'

/** One bill of the month, as the run recorded it (pilot-run.json; the buyer's own working file). */
export interface PilotBill {
  seq: number
  ref: string
  invoice_number: string | null
  issued_at: string | null
  amount: number | null
  currency: string | null
  buyer: { decision: BuyerDecision; from: string }
  gated: boolean
  /** why it was not gated */
  problem?: string
  checker_decision?: string
  status?: string
  disposition: Disposition
  /** the rules that failed, and the ones that could not run */
  failed: string[]
  open: string[]
  /** typed remedies, without their text (kind, the role that may rule, the rules it clears, the operand's pointer) */
  remedies: { kind: string; authority?: string; clears: string[]; operand?: string }[]
  /** the first reason the checker gave (abstentions only: why it could not decide) */
  why?: string
  /** in words (absent with --hashes-only, and in runs written before 2026-10-05): the vendor as the export names it */
  vendor?: string | null
  /** in words: what is wrong, or why it could not decide, with the line it is on */
  discrepancy?: string
  /** in words: what would clear it, who may first */
  clear?: string[]
}

/** One pay application of the month, as the run recorded it (2026-10-05). */
export interface PilotPayApp {
  seq: number
  /** the file name in pay_applications/ */
  ref: string
  application_number: number | null
  period_to: string | null
  /** line 8, the current payment due, from the document */
  amount: number | null
  currency: string | null
  buyer: { decision: BuyerDecision; from: string }
  checked: boolean
  problem?: string
  /** the previous application's file name, or null when it is not in the export (the continuity checks could not run) */
  previous: string | null
  outcome?: string
  status?: string
  disposition: Disposition
  failed: string[]
  open: string[]
  remedies: { kind: string; authority?: string; clears: string[]; operand?: string }[]
  why?: string
  /** in words (absent with --hashes-only) */
  project?: string | null
  contractor?: string | null
  discrepancy?: string
  clear?: string[]
}

export interface PilotManifest {
  pilot_version: 'riposte.pilot-run/0.1.0'
  mode: 'shadow'
  executed: false
  started_at: string
  finished_at: string
  month: string
  source: SourceId
  prereg: { file: string; sha256: string; frozen_at: string }
  export: { files: { name: string; sha256: string; bytes: number; records: number }[]; ignored: string[]; notes: string[]; bills_in_export: number; bills_outside_month: number }
  engine: { verify: string; ruleset: string }
  ledger: { file: string; entries: number; head: string; key_fingerprint: string }
  /** who holds the private key that signed the receipts, and why (2026-10-05; absent in runs written before) */
  key?: KeyCustody
  store_documents: boolean
  /** the frozen price tolerance and freight rule every bill was checked under (2026-10-05; absent in runs written before) */
  price_tolerance?: number
  freight?: 'allow' | 'person'
  /** the frozen tax rule, as the --tax flag writes it ("person", "allow", "rate:8.25%"; 2026-10-06; absent in runs written before) */
  tax?: string
  /** `pay`: the would-pay sample for the co-primary miss rate (2026-10-05), present only when the prereg registers it */
  audit: { seed: string; sample_size: number; population: number; sample: string[]; pay?: { seed: string; sample_size: number; population: number; sample: string[] } }
  bills: PilotBill[]
  /** 'words' (the default from 2026-10-05) or 'hashes-only' (--hashes-only; and every run written before, which has no field) */
  wording?: 'words' | 'hashes-only'
  /** the month's pay applications (2026-10-05; absent in runs written before, and when the export holds none) */
  pay_apps?: PilotPayApp[]
}

export interface PayAppRecount {
  applications: number
  checked: number
  dispositions: Record<Disposition, number>
  failed_by_rule: Record<string, number>
}

export interface Recount {
  bills: number
  gated: number
  dispositions: Record<Disposition, number>
  agreement: { pay_pay: number; pay_hold: number; pay_person: number; hold_pay: number; hold_hold: number; hold_person: number; open: number }
  failed_by_rule: Record<string, number>
  /** the pay applications (2026-10-05): all zeros for a run without any */
  pay_apps: PayAppRecount
}

const emptyPayRecount = (): PayAppRecount => ({ applications: 0, checked: 0, dispositions: { pay: 0, hold: 0, person: 0 }, failed_by_rule: {} })
const sortedCounts = (o: Record<string, number>): Record<string, number> => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))

const isObj = (x: unknown): x is Record<string, any> => x !== null && typeof x === 'object' && !Array.isArray(x)

/** Count the month from the receipts alone: every pilot receipt carries its disposition and the buyer's decision. */
const EFFECT_OF: Record<Disposition, string> = { pay: 'WOULD_PAY', hold: 'WOULD_HOLD', person: 'WOULD_REVIEW' }

/**
 * The seqs of pilot receipts whose top level disagrees with the disposition the report counts (2026-10-05):
 * a top-level `disposition` that is not `shadow.disposition`, or an `effect` that is not its WOULD_ word. Receipts written
 * before carry no top-level disposition (their top level was the live gate's reading of the buyer's decision) and are
 * recounted from `shadow.disposition` alone, as before.
 */
export function receiptsThatDisagree(entries: readonly LedgerEntry[]): number[] {
  const out: number[] = []
  for (const e of entries) {
    const b = e.body as Record<string, any>
    const s = isObj(b) && isObj(b.shadow) ? b.shadow : undefined
    if (!s || s.pilot !== true || !('disposition' in b)) continue
    if (b.disposition !== s.disposition || b.effect !== EFFECT_OF[s.disposition as Disposition]) out.push(e.seq)
  }
  return out
}

export function recountFromLedger(entries: readonly LedgerEntry[]): Recount {
  const r: Recount = { bills: 0, gated: 0, dispositions: { pay: 0, hold: 0, person: 0 }, agreement: { pay_pay: 0, pay_hold: 0, pay_person: 0, hold_pay: 0, hold_hold: 0, hold_person: 0, open: 0 }, failed_by_rule: {}, pay_apps: emptyPayRecount() }
  for (const e of entries) {
    const b = e.body as Record<string, any>
    const s = isObj(b) && isObj(b.shadow) ? b.shadow : undefined
    if (!s || s.pilot !== true) continue
    if (s.document === 'pay_application') {
      const p = r.pay_apps
      p.applications++
      if (e.kind === 'pay_app_check') p.checked++
      p.dispositions[s.disposition as Disposition]++
      if (e.kind === 'pay_app_check' && Array.isArray(b.claims)) for (const rule of new Set<string>(b.claims.filter((c: any) => c.outcome === 'FAIL').map((c: any) => c.rule_id))) p.failed_by_rule[rule] = (p.failed_by_rule[rule] ?? 0) + 1
      continue
    }
    r.bills++
    if (e.kind === 'ap_gate') r.gated++
    const d = s.disposition as Disposition
    r.dispositions[d]++
    const buyer = s.buyer_decision as BuyerDecision
    if (buyer === 'open') r.agreement.open++
    else (r.agreement as Record<string, number>)[`${buyer}_${d}`]!++
    if (e.kind === 'ap_gate' && Array.isArray(b.claims)) {
      const failed = new Set<string>(b.claims.filter((c: any) => c.outcome === 'FAIL').map((c: any) => c.rule_id))
      for (const rule of failed) r.failed_by_rule[rule] = (r.failed_by_rule[rule] ?? 0) + 1
    }
  }
  r.failed_by_rule = sortedCounts(r.failed_by_rule)
  r.pay_apps.failed_by_rule = sortedCounts(r.pay_apps.failed_by_rule)
  return r
}

/** The same counts from the run's own record of the bills. */
export function recountFromManifest(m: PilotManifest): Recount {
  const r: Recount = { bills: 0, gated: 0, dispositions: { pay: 0, hold: 0, person: 0 }, agreement: { pay_pay: 0, pay_hold: 0, pay_person: 0, hold_pay: 0, hold_hold: 0, hold_person: 0, open: 0 }, failed_by_rule: {}, pay_apps: emptyPayRecount() }
  for (const b of m.bills) {
    r.bills++
    if (b.gated) r.gated++
    r.dispositions[b.disposition]++
    if (b.buyer.decision === 'open') r.agreement.open++
    else (r.agreement as Record<string, number>)[`${b.buyer.decision}_${b.disposition}`]!++
    for (const rule of new Set(b.failed)) r.failed_by_rule[rule] = (r.failed_by_rule[rule] ?? 0) + 1
  }
  for (const a of m.pay_apps ?? []) {
    const p = r.pay_apps
    p.applications++
    if (a.checked) p.checked++
    p.dispositions[a.disposition]++
    for (const rule of new Set(a.failed)) p.failed_by_rule[rule] = (p.failed_by_rule[rule] ?? 0) + 1
  }
  r.failed_by_rule = sortedCounts(r.failed_by_rule)
  r.pay_apps.failed_by_rule = sortedCounts(r.pay_apps.failed_by_rule)
  return r
}

// ── words ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A role named on a typed remedy, in words. */
export function roleWords(role: string): string {
  const known: Record<string, string> = { 'ap-clerk': 'an AP clerk', 'ap-supervisor': 'an AP supervisor', 'ap-controller': 'the controller', buyer: 'the buyer', certifier: 'the certifier (the architect, on AIA G702)' }
  return known[role] ?? `a person with the role "${role}"`
}

/** A field as the check names it, in words: `line[2].unit_price` → "line 2 unit price", `current_payment_due` → "current payment due". */
export function fieldWords(field: string): string {
  const m = /^line\[(\d+)\]\.?(.*)$/.exec(field)
  const words = (s: string) => s.replace(/[_.]+/g, ' ').trim()
  return m ? `line ${m[1]}${m[2] ? ` ${words(m[2])}` : ''}` : words(field)
}

/** The parts of a claim the total's wording reads (verify's AP_TOTAL_SUM claim carries them, on both the text and structured paths). */
interface TotalClaim {
  rule_id: string
  outcome: string
  asserted?: unknown
  computation?: { operands?: Record<string, unknown>; result?: unknown }
  evidence?: readonly { role?: string; value?: unknown }[]
}

/**
 * A failed total in words (2026-10-05): what the lines add to, what the bill says, and by how much it is over
 * or under, read from the claim's own numbers, e.g. "lines add to 20,961.36; the bill says 21,078.97; over by 117.61".
 * Freight the PO allows and tax are added in words; freight it does not allow is said to be left out. Undefined for any
 * other claim, or one whose numbers are not there (the caller keeps the engine's explanation).
 */
export function totalWords(c: TotalClaim): string | undefined {
  if (c.rule_id !== 'AP_TOTAL_SUM' || c.outcome !== 'FAIL') return undefined
  const ops = c.computation?.operands ?? {}
  const num = (x: unknown): number | undefined => (typeof x === 'number' && Number.isFinite(x) ? x : undefined)
  const stated = num(c.asserted), sum = num(c.computation?.result), lines = num(ops.lines)
  if (stated === undefined || sum === undefined || lines === undefined) return undefined
  const freight = num(ops.freight) ?? 0
  const tax = num(ops.tax) ?? 0
  const excluded = ops.freight_allowed === false ? num((c.evidence ?? []).find((e) => e.role === 'CONTEXT')?.value) : undefined
  const added = [freight ? `freight ${money(freight)} (the PO allows it)` : '', tax ? `tax ${money(tax)}` : ''].filter(Boolean)
  const diff = Math.round((stated - sum) * 100) / 100
  if (diff === 0) return undefined
  return [
    `lines add to ${money(lines)}${added.length ? `, and with ${added.join(' and ')} to ${money(sum)}` : ''}${excluded ? ` (freight ${money(excluded)} is left out: the PO does not allow freight)` : ''}`,
    `the bill says ${money(stated)}`,
    diff > 0 ? `over by ${money(diff)}` : `under by ${money(-diff)}`,
  ].join('; ')
}

/** What would clear a finding, in words, the role that may rule first: the remedies' own sentences. */
export function clearWords(remedies: readonly { kind: string; authority?: string; detail: string }[]): string[] {
  const auth = remedies.filter((r) => r.kind === 'authority' && r.authority)
  const rest = remedies.filter((r) => !(r.kind === 'authority' && r.authority) && r.detail.trim())
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
  return [
    ...auth.map((r) => `${cap(roleWords(r.authority!))} may clear it, for this one only. ${r.detail.trim()}`),
    ...rest.map((r) => r.detail.trim()),
  ]
}

// ── the audit sheet ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** A cell a spreadsheet would read as a formula (= + - @, tab, CR) is prefixed with ' so it is shown, never run. */
export const csvCell = (x: unknown): string => {
  let s = x === null || x === undefined ? '' : String(x)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * `drawn_from` (2026-10-05): would-hold (the hold_precision sample) or would-pay (the miss-rate sample). `vendor`, `amount`,
 * `currency` and `discrepancy` (2026-10-05) let the person labelling the sheet judge most rows without opening
 * each bill: the vendor and total from the export, and what the check found, in words. Blank under --hashes-only.
 */
export const AUDIT_COLUMNS = ['sample_no', 'drawn_from', 'bill_ref', 'invoice_number', 'vendor', 'amount', 'currency', 'discrepancy', 'rules', 'label', 'labelled_by', 'note'] as const

export function auditSheet(m: PilotManifest): string {
  const by = new Map(m.bills.map((b) => [b.ref, b]))
  const words = m.wording === 'words'
  const facts = (b: PilotBill, found: string): (string | number)[] => words
    ? [b.vendor ?? '', b.amount ?? '', b.currency ?? '', found]
    : ['', '', '', '']
  const holds = m.audit.sample.map((ref, i) => { const b = by.get(ref)!; return [i + 1, 'would-hold', ref, b.invoice_number ?? '', ...facts(b, b.discrepancy ?? ''), b.failed.join(' '), '', '', ''] })
  const pays = (m.audit.pay?.sample ?? []).map((ref, i) => { const b = by.get(ref)!; return [holds.length + i + 1, 'would-pay', ref, b.invoice_number ?? '', ...facts(b, 'every check passed: is this a bad bill the gate would have paid?'), '', '', '', ''] })
  return `${[AUDIT_COLUMNS as readonly string[], ...holds, ...pays].map((r) => r.map(csvCell).join(',')).join('\n')}\n`
}

export interface AuditLabels { labels: Map<string, 'issue' | 'no_issue'>; labelled_by: string[]; problems: string[] }

/** Read a filled audit sheet: label is "issue" or "no_issue" (blank = not yet audited); only refs in the drawn sample count. */
export function readAuditLabels(rows: { values: Record<string, unknown> }[], m: PilotManifest): AuditLabels {
  const inSample = new Set([...m.audit.sample, ...(m.audit.pay?.sample ?? [])])
  const labels = new Map<string, 'issue' | 'no_issue'>()
  const by = new Set<string>()
  const problems: string[] = []
  for (const { values: v } of rows) {
    const ref = String(v.bill_ref ?? '').replace(/^'/, '')
    const label = String(v.label ?? '').trim().toLowerCase()
    if (!label) continue
    if (!inSample.has(ref)) { problems.push(`bill ${ref} is not in the drawn sample: its label is not counted`); continue }
    if (label !== 'issue' && label !== 'no_issue') { problems.push(`bill ${ref}: label "${label}" is neither issue nor no_issue: not counted`); continue }
    labels.set(ref, label)
    if (v.labelled_by) by.add(String(v.labelled_by))
  }
  return { labels, labelled_by: [...by].sort(), problems }
}

// ── numbers ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A two-sided exact interval at `confidence`: each side is verify's one-sided Clopper-Pearson bound at (1 + confidence) / 2. */
export function exactInterval(k: number, n: number, confidence: number): { lower: number; upper: number } {
  if (n === 0) return { lower: 0, upper: 1 }
  const i = clopperPearsonInterval(k, n, (1 + confidence) / 2)
  return { lower: i.lower, upper: i.upper }
}

export interface PrimaryResult { metric: PrimaryMetric; k: number; n: number; planned?: number; value?: number; interval?: { lower: number; upper: number }; verdict: 'pass' | 'fail' | 'inconclusive' | 'not measured'; note: string }

export function primaryResult(m: PilotManifest, prereg: FrozenPrereg, audit?: AuditLabels): PrimaryResult {
  const p = prereg.params.primary
  const rc = recountFromManifest(m)
  let k: number, n: number, note: string
  if (p.metric === 'hold_precision') {
    // only the would-hold sample's labels count here (the would-pay sample's are the miss rate's)
    if (audit) { const holds = new Set(m.audit.sample); audit = { ...audit, labels: new Map([...audit.labels].filter(([ref]) => holds.has(ref))) } }
    if (!audit || audit.labels.size === 0) return { metric: p.metric, k: 0, n: 0, planned: m.audit.sample.length, verdict: 'not measured', note: `not measured yet: ${m.audit.sample.length} would-holds are drawn for the audit (AUDIT-SHEET.csv). A person labels each one issue or no_issue, then \`riposte-pilot report --audit AUDIT-SHEET.csv\` renders the number.` }
    k = [...audit.labels.values()].filter((l) => l === 'issue').length
    n = audit.labels.size
    note = `${k} of ${n} audited would-holds confirmed as real problems${n < m.audit.sample.length ? ` (${m.audit.sample.length - n} of the ${m.audit.sample.length} drawn are not labelled yet)` : ''}; labelled by: ${audit.labelled_by.join(', ') || 'not stated'}`
  } else if (p.metric === 'agreement') {
    const a = rc.agreement
    k = a.pay_pay + a.hold_hold; n = a.pay_pay + a.pay_hold + a.pay_person + a.hold_pay + a.hold_hold + a.hold_person
    note = `${k} of ${n} bills the buyer decided, where the check's class matches (a check that could not decide counts as not matching)`
  } else {
    k = rc.gated; n = rc.bills
    note = `${k} of ${n} bills in the month could be checked`
  }
  const interval = exactInterval(k, n, p.confidence)
  const verdict = n === 0 ? 'not measured' : interval.lower >= p.bar ? 'pass' : interval.upper < p.bar ? 'fail' : 'inconclusive'
  return { metric: p.metric, k, n, ...(p.metric === 'hold_precision' ? { planned: m.audit.sample.length } : {}), ...(n ? { value: k / n } : {}), interval, verdict, note }
}

export interface CoPrimaryResult { metric: CoPrimaryMetric; k: number; n: number; planned: number; value?: number; interval?: { lower: number; upper: number }; verdict: 'pass' | 'fail' | 'inconclusive' | 'not measured'; note: string }

/** The co-primary miss rate (2026-10-05): bad bills among the audited would-pays. Lower is better. Undefined when not registered. */
export function coPrimaryResult(m: PilotManifest, prereg: FrozenPrereg, audit?: AuditLabels): CoPrimaryResult | undefined {
  const co = prereg.params.co_primary
  if (!co) return undefined
  const sample = m.audit.pay?.sample ?? []
  const inPay = new Set(sample)
  const labels = audit ? [...audit.labels].filter(([ref]) => inPay.has(ref)).map(([, l]) => l) : []
  if (!labels.length) return { metric: co.metric, k: 0, n: 0, planned: sample.length, verdict: 'not measured', note: `not measured yet: ${sample.length} would-pays are drawn for the audit (the rows marked would-pay in AUDIT-SHEET.csv). A person labels each one issue (a bad bill the gate would have paid) or no_issue, then \`riposte-pilot report --audit AUDIT-SHEET.csv\` renders the number.` }
  const k = labels.filter((l) => l === 'issue').length
  const n = labels.length
  const interval = exactInterval(k, n, co.confidence)
  const verdict = interval.upper <= co.bar ? 'pass' : interval.lower > co.bar ? 'fail' : 'inconclusive'
  return { metric: co.metric, k, n, planned: sample.length, value: k / n, interval, verdict, note: `${k} of ${n} audited would-pays confirmed as bad bills the gate would have paid${n < sample.length ? ` (${sample.length - n} of the ${sample.length} drawn are not labelled yet)` : ''}` }
}

/** Both primaries (the pilot passes only when both pass, fails when either fails). */
export function overallVerdict(a: PrimaryResult['verdict'], b?: CoPrimaryResult['verdict']): PrimaryResult['verdict'] {
  if (b === undefined) return a
  if (a === 'fail' || b === 'fail') return 'fail'
  if (a === 'pass' && b === 'pass') return 'pass'
  if (a === 'not measured' || b === 'not measured') return 'not measured'
  return 'inconclusive'
}

// ── the report ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`
const money = (n: number): string => { const [i, f] = Math.abs(n).toFixed(2).split('.') as [string, string]; return `${n < 0 ? '-' : ''}${i.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${f}` }
const md = (s: unknown): string => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')

export class ReportRefused extends Error {
  constructor(message: string) { super(message); this.name = 'ReportRefused' }
}

export interface ReportInput { manifest: PilotManifest; prereg: FrozenPrereg; ledger: { entries: readonly LedgerEntry[]; chainOk: boolean; chainReason?: string }; audit?: AuditLabels }

/** PILOT-REPORT.md. Refuses without the run's own pre-registration, on a broken chain, or when the ledger does not recount the run. */
export function renderPilotReport(x: ReportInput): string {
  const { manifest: m, prereg } = x
  if (prereg.sha256 !== m.prereg.sha256) throw new ReportRefused(`the prereg given (${prereg.sha256.slice(0, 16)}…) is not the one this run was registered under (${m.prereg.sha256.slice(0, 16)}…)`)
  if (Date.parse(prereg.frozen_at) > Date.parse(m.started_at)) throw new ReportRefused(`the prereg was frozen at ${prereg.frozen_at}, after the run started (${m.started_at})`)
  if (!x.ledger.chainOk) throw new ReportRefused(`the receipt ledger does not verify (${x.ledger.chainReason ?? 'broken chain'}): no report is rendered over it`)
  const fromLedger = recountFromLedger(x.ledger.entries)
  const fromRun = recountFromManifest(m)
  if (JSON.stringify(fromLedger) !== JSON.stringify(fromRun)) throw new ReportRefused(`the ledger does not recount the run: ledger ${JSON.stringify(fromLedger)} vs run ${JSON.stringify(fromRun)}`)
  const split = receiptsThatDisagree(x.ledger.entries)
  if (split.length) throw new ReportRefused(`${split.length} receipt(s) say one disposition in their first field and another in their shadow block (entries ${split.slice(0, 10).join(', ')}${split.length > 10 ? ', …' : ''}): the report counts one thing, so it is not rendered over receipts that say two`)
  const rc = fromRun
  const P = prereg.params
  const words = m.wording === 'words'
  const primary = primaryResult(m, prereg, x.audit)
  const co = coPrimaryResult(m, prereg, x.audit)
  const dollarsOf = <T extends { amount: number | null; currency: string | null }>(xs: readonly T[]): string => {
    const byCur = new Map<string, number>()
    for (const b of xs) if (b.amount !== null) byCur.set(b.currency ?? '?', (byCur.get(b.currency ?? '?') ?? 0) + b.amount)
    return [...byCur].map(([c, v]) => `${c} ${money(v)}`).join(' + ') || '0'
  }
  const dollars = (f: (b: PilotBill) => boolean): string => dollarsOf(m.bills.filter(f))
  const a = rc.agreement
  const holds = m.bills.filter((b) => b.disposition === 'hold')
  const persons = m.bills.filter((b) => b.disposition === 'person')
  const apps = m.pay_apps ?? []
  const L: string[] = []
  L.push(`# Shadow pilot report: ${md(P.buyer)}, ${m.month}`, '')
  L.push(`Shadow mode: nothing was executed. No payment, hold or message was sent anywhere. Every bill of the month got a signed receipt that holds hashes, not documents; the ${rc.gated} the export let the check run on were checked, and the other ${rc.bills - rc.gated} are listed with the reason.`, '')

  // the labour cost, first, in words (2026-10-05)
  const paid = a.pay_pay + a.pay_hold + a.pay_person
  const stoppedPaid = a.pay_hold + a.pay_person
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
  L.push('## What it would have cost your team', '')
  L.push(paid
    ? `Of the ${plural(paid, 'bill')} your team paid this month, the gate would have stopped ${stoppedPaid} (${pct(stoppedPaid / paid)}): ${a.pay_person} sent to a person and ${a.pay_hold} held with a reason. Each of the ${stoppedPaid} is one of two things: a problem your team paid by mistake, or a good bill the gate would have held up. The export cannot say which, so ${stoppedPaid === 1 ? 'it is' : 'each is'} listed below for a person to decide.`
    : 'Your team paid none of the month\'s bills in this export, so the cost in good bills stopped cannot be stated.')
  L.push('', `Over the whole month, ${rc.dispositions.person} of the ${plural(rc.bills, 'bill')} would have gone to a person and ${rc.dispositions.hold} would have been held, so ${rc.dispositions.person + rc.dispositions.hold} would have needed a person's attention before payment.${apps.length ? ` Of the ${plural(apps.length, 'pay application')}, ${rc.pay_apps.dispositions.person} would have gone to a person and ${rc.pay_apps.dispositions.hold} would have been held.` : ''}`, '')

  L.push('| | |', '|---|---|')
  L.push(`| pre-registration | ${md(m.prereg.file)}, sha256 \`${m.prereg.sha256}\`, frozen ${m.prereg.frozen_at} |`)
  L.push(`| run | ${m.started_at} to ${m.finished_at} |`)
  L.push(`| source | ${m.source}: ${m.export.files.map((f) => `${md(f.name)} (${f.records} records, sha256 \`${f.sha256.slice(0, 16)}…\`)`).join('; ')} |`)
  L.push(`| check | verify ${m.engine.verify}, ruleset ${m.engine.ruleset} |`)
  L.push(`| receipts | ${md(m.ledger.file)}: ${m.ledger.entries} entries, head \`${m.ledger.head.slice(0, 16)}…\`, signed by key ${m.ledger.key_fingerprint} |`)
  L.push(`| signing key held by | ${md(m.key?.holder ?? 'not recorded (a run written before 2026-10-05): if run-key.pem is in this folder, whoever can read the folder')} |`)
  L.push(`| this report | ${words ? 'in words: vendors, amounts and what is wrong are written out (the buyer\'s working file; the receipts hold hashes)' : 'hashes only (--hashes-only, or a run written before 2026-10-05): rule ids and typed remedies, no document wording'} |`)
  L.push('')
  L.push('## The pre-registered number', '')
  L.push(`**${primary.metric}**, bar ${P.primary.bar}, confidence ${P.primary.confidence}.`, '')
  if (primary.verdict === 'not measured') L.push(primary.note, '')
  else {
    L.push(`| value | ${P.primary.confidence * 100}% exact interval | bar | result |`, '|---|---|---|---|')
    L.push(`| ${primary.value !== undefined ? pct(primary.value) : '—'} (${primary.k} / ${primary.n}) | ${pct(primary.interval!.lower)} to ${pct(primary.interval!.upper)} | ${P.primary.bar} | **${primary.verdict}** |`, '')
    L.push(`${primary.note}. Decision rule (fixed in the pre-registration): the lower bound at or above the bar passes, the upper bound below it fails, anything else is inconclusive.`, '')
  }
  if (co) {
    const C = P.co_primary!
    L.push(`**${co.metric}** (co-primary: bad bills the gate would have paid), bar ${C.bar}, confidence ${C.confidence}. Lower is better.`, '')
    if (co.verdict === 'not measured') L.push(co.note, '')
    else {
      L.push(`| value | ${C.confidence * 100}% exact interval | bar | result |`, '|---|---|---|---|')
      L.push(`| ${pct(co.value!)} (${co.k} / ${co.n}) | ${pct(co.interval!.lower)} to ${pct(co.interval!.upper)} | ${C.bar} | **${co.verdict}** |`, '')
      L.push(`${co.note}. Decision rule (fixed in the pre-registration): the upper bound at or below the bar passes, the lower bound above it fails, anything else is inconclusive.`, '')
    }
    L.push(`Both numbers are primary. Overall: **${overallVerdict(primary.verdict, co.verdict)}** (the pilot passes only when both pass, and fails when either fails).`, '')
  }
  L.push('## Coverage', '')
  L.push(`| bills in the export | in ${m.month} | checked | not checked |`, '|---|---|---|---|')
  L.push(`| ${m.export.bills_in_export} | ${rc.bills} | ${rc.gated} (${rc.bills ? pct(rc.gated / rc.bills) : '—'}) | ${rc.bills - rc.gated} |`, '')
  const notGated = m.bills.filter((b) => !b.gated)
  if (notGated.length) {
    const why = new Map<string, number>()
    for (const b of notGated) { const k = (b.problem ?? '?').replace(/ [A-Z0-9][\w-]*-\d[\w-]* /, ' … ').replace(/purchase order \S+ is not/, 'purchase order … is not'); why.set(k, (why.get(k) ?? 0) + 1) }
    L.push('Not checked, by reason:', '', ...[...why].map(([k, n]) => `- ${n} × ${md(k)}`), '')
  }
  if (m.export.notes.length) L.push('Notes from reading the export:', '', ...m.export.notes.map((n) => `- ${md(n)}`), '')
  if (m.export.ignored.length) L.push(`Columns acknowledged as not read (--ignore-columns): ${m.export.ignored.map((c) => `\`${md(c)}\``).join(', ')}`, '')
  L.push('## What the gate would have done', '')
  L.push('| | bills | share of the month | dollars (export totals) |', '|---|---|---|---|')
  for (const [d, label] of [['pay', 'would pay automatically (every check passed)'], ['hold', 'would hold automatically, with a typed remedy'], ['person', 'would send to a person (could not decide, or could not be checked)']] as const) {
    L.push(`| ${label} | ${rc.dispositions[d]} | ${rc.bills ? pct(rc.dispositions[d] / rc.bills) : '—'} | ${dollars((b) => b.disposition === d)} |`)
  }
  L.push('')
  if (Object.keys(rc.failed_by_rule).length) L.push(`Checks that failed, by rule: ${Object.entries(rc.failed_by_rule).sort((p, q) => q[1] - p[1]).map(([r, n]) => `${r} ${n}`).join(' · ')}`, '')
  L.push('## Agreement with your own decisions', '')
  L.push('| your decision → / the gate ↓ | paid | held |', '|---|---|---|')
  L.push(`| would pay | ${a.pay_pay} | ${a.hold_pay} |`, `| would hold | ${a.pay_hold} | ${a.hold_hold} |`, `| to a person | ${a.pay_person} | ${a.hold_person} |`, '')
  const decided = a.pay_pay + a.pay_hold + a.pay_person + a.hold_pay + a.hold_hold + a.hold_person
  L.push(`${decided} bills had a decision of yours on record (${a.open} were still open and are not compared). The gate's class matched yours on ${a.pay_pay + a.hold_hold}. **${a.pay_hold}** bills you paid, the gate would have held: each is in the list below, with what would clear it. **${a.hold_pay}** bills you held, the gate would have paid: the check found nothing wrong with the documents on record; the reason you held them is not in the export.`, '')
  const typed = (rs: PilotBill['remedies']): string => rs.map((r) => `${r.kind}${r.authority ? ` (${r.authority})` : ''}${r.operand ? ` \`${md(r.operand)}\`` : ''} → ${r.clears.join(', ')}`).join('; ')
  L.push('## Every hold, and what would clear it', '')
  if (!holds.length) L.push('None.', '')
  else if (words) {
    L.push('| bill | vendor | invoice | amount | your decision | what is wrong | what would clear it |', '|---|---|---|---|---|---|---|')
    for (const b of holds) L.push(`| ${md(b.ref)} | ${md(b.vendor)} | ${md(b.invoice_number)} | ${b.amount !== null ? `${b.currency ?? ''} ${money(b.amount)}`.trim() : ''} | ${b.buyer.decision} | ${md(b.discrepancy ?? b.failed.join(', '))} | ${md((b.clear ?? []).join(' Or: ') || typed(b.remedies))} |`)
    L.push('', `Total held: ${dollars((b) => b.disposition === 'hold')}.`, '')
  } else {
    L.push('| bill | invoice | your decision | failed | what would clear it (typed) |', '|---|---|---|---|---|')
    for (const b of holds) L.push(`| ${md(b.ref)} | ${md(b.invoice_number)} | ${b.buyer.decision} | ${b.failed.join(', ')} | ${typed(b.remedies)} |`)
    L.push('', `Total held: ${dollars((b) => b.disposition === 'hold')}. This run was made with --hashes-only, so the remedies are typed (kind, the role that may rule, the field) and their wording, which quotes document values, is not kept. Without --hashes-only this list says each one in words.`, '')
  }
  L.push('## Sent to a person', '')
  if (!persons.length) L.push('None.', '')
  else if (words) {
    L.push('| bill | vendor | invoice | amount | why a person decides |', '|---|---|---|---|---|')
    for (const b of persons) L.push(`| ${md(b.ref)} | ${md(b.vendor)} | ${md(b.invoice_number)} | ${b.amount !== null ? `${b.currency ?? ''} ${money(b.amount)}`.trim() : ''} | ${md(b.gated ? b.discrepancy ?? b.why ?? 'undecided' : `not checked: ${b.problem}`)} |`)
    L.push('')
  } else {
    L.push('| bill | invoice | why |', '|---|---|---|')
    for (const b of persons) L.push(`| ${md(b.ref)} | ${md(b.invoice_number)} | ${md(b.gated ? `${b.open.join(', ') || 'undecided'}: ${b.why ?? ''}` : `not checked: ${b.problem}`)} |`)
    L.push('')
  }
  if (apps.length) {
    const p = rc.pay_apps
    L.push('## Pay applications (G702/G703)', '')
    L.push(`${plural(apps.length, 'pay application')} for ${m.month}, each checked against the previous application of the same contract where the export holds it: ${p.dispositions.pay} would pay, ${p.dispositions.hold} would hold, ${p.dispositions.person} would go to a person. Their total payment due is ${dollarsOf(apps)}. Pay applications are reported here and are not part of the pre-registered numbers, which count bills.`, '')
    if (words) {
      L.push('| application | project | no. | period to | payment due | your decision | gate | what is wrong, or why a person decides | what would clear it |', '|---|---|---|---|---|---|---|---|---|')
      for (const x2 of apps) L.push(`| ${md(x2.ref)} | ${md(x2.project)} | ${x2.application_number ?? ''} | ${x2.period_to ?? ''} | ${x2.amount !== null ? `${x2.currency ?? ''} ${money(x2.amount)}`.trim() : ''} | ${x2.buyer.decision} | ${x2.disposition === 'pay' ? 'would pay' : x2.disposition === 'hold' ? 'would hold' : 'to a person'} | ${md(x2.checked ? x2.discrepancy ?? '' : `not checked: ${x2.problem}`)} | ${md((x2.clear ?? []).join(' Or: '))} |`)
    } else {
      L.push('| application | no. | period to | gate | failed | could not run | what would clear it (typed) |', '|---|---|---|---|---|---|---|')
      for (const x2 of apps) L.push(`| ${md(x2.ref)} | ${x2.application_number ?? ''} | ${x2.period_to ?? ''} | ${x2.disposition === 'pay' ? 'would pay' : x2.disposition === 'hold' ? 'would hold' : 'to a person'} | ${x2.failed.join(', ')} | ${x2.checked ? x2.open.join(', ') : `not checked: ${md(x2.problem)}`} | ${typed(x2.remedies)} |`)
    }
    L.push('')
    const noPrev = apps.filter((x2) => x2.checked && x2.previous === null).length
    if (noPrev) L.push(`${plural(noPrev, 'application')} had no previous application in the export, so the continuity checks (this month's "previous" against last month's "completed to date", and line 7 against last month's line 6) could not run, and each went to a person.`, '')
  }
  L.push('## The audit sample', '')
  L.push(`Drawn after the run from ${m.audit.population} would-holds: ${m.audit.sample.length} bills, ranked by sha256(seed : bill), seed \`${m.audit.seed}\` = sha256 of the pre-registration's hash and the ledger head before the draw. Nobody chose it, and anyone can redraw it from the ledger. The sheet is AUDIT-SHEET.csv${words ? ': each row names the vendor, the amount and what the check found, in words' : ''}.`, '')
  if (m.audit.pay) L.push(`The miss rate's sample, drawn the same way from ${m.audit.pay.population} would-pays: ${m.audit.pay.sample.length} bills, seed \`${m.audit.pay.seed}\` (its own seed, from the same hash and head). They are the rows marked would-pay on the same sheet.`, '')
  if (x.audit?.problems.length) L.push('Audit sheet problems (not counted):', '', ...x.audit.problems.map((p) => `- ${md(p)}`), '')
  L.push('## What this did not check', '')
  for (const s of [
    'Whether the vendor, the bank details or the payee are who they claim to be (no vendor master, no bank-account check). The bill\'s vendor is compared with the vendor its purchase order names, and a different one goes to a person; a vendor the two documents agree on is taken as given.',
    'Fraud that the documents agree with: a PO and a receipt entered to match a false bill pass every check here.',
    // 2026-10-06: the frozen tax rule decides tax on an order that states no tax terms
    `Contract terms beyond the PO price (rebates, tiered pricing, payment terms, early-payment discounts), tax rules beyond the purchase order's stated rate, and approvals policy. No export mapping reads a purchase order's tax terms, so a bill that carries tax is decided by the frozen tax rule (this run: ${m.tax === 'allow' ? '"allow", tax accepted as billed, not checked against a rate' : m.tax && m.tax.startsWith('rate:') ? `"${m.tax}", tax checked against that rate` : '"person", a person decides'}); on a Ramp export, which has no tax field, only one expense line whose whole memo names a tax is read as the bill's tax, and any other such line matches no PO line and goes to a person for that reason.`,
    'Bills without a purchase order, or whose PO is not in the export: they are listed, not checked.',
    'Timing: item receipts are counted if received by the end of the month, whenever the bill was paid.',
    'Duplicates outside this export: only bills of this export paid earlier are compared.',
    'Quantities billed against one PO line across several bills, unless the export carries invoiced_quantity per PO line: the payment history carries amounts, not lines, so earlier bills are netted against the order\'s total, not against each line, and tax or freight inside an earlier bill\'s amount counts against the order too.',
    'Why you held or paid a bill: the export records the decision, not the reason.',
    ...(apps.length ? ['Pay applications: whether the work was done, or the percent complete is true; lien waivers; whether the owner approved a change order (a new line net change orders account for, or a change order the application states, is taken as given); whether a lower retainage is allowed by the contract (retainage withheld under the stated rate goes to a person unless the application says where: a line\'s own rate, a reduced rate it states, or a complete line beside lines still at the rate; a stated reduction is taken as given). The check recomputes the application\'s own arithmetic and its continuity with last month.'] : []),
    ...(m.source !== 'ramp' ? ['The export\'s field or column names for this source are partly unverified (see the notes above).'] : []),
  ]) L.push(`- ${s}`)
  L.push('')
  L.push('## Data posture', '')
  L.push(`- The run was offline: no network call, no model. Documents never left this machine.`)
  L.push(`- receipts.jsonl holds hashes (each document's sha256 and length, the verdict's hash), rule ids, outcomes, JSON Pointers and typed remedies: no document values${m.store_documents ? ', except where --store-documents put the proof on the receipt' : ''}.`)
  L.push(words
    ? '- pilot-run.json, this report and AUDIT-SHEET.csv hold the export\'s record ids, invoice numbers, vendors, bill totals, your decisions, and what each check found in words, which can quote line descriptions and amounts. They are your working files. Run with --hashes-only to keep them to record ids, invoice numbers, totals and rule ids.'
    : '- pilot-run.json and this report hold the export\'s record ids, invoice numbers, bill totals and your decisions, nothing else from the documents (--hashes-only).')
  L.push(m.store_documents ? '- --store-documents was given: documents/ holds each bill\'s structured input and proofs/ its proof, for your own retention; each proof replays bound to its receipt (`riposte-replay --ledger receipts.jsonl --proof <proof>`). `riposte-pilot purge` deletes them and leaves the hashes.' : '- No document and no proof is stored (the default), so a receipt alone cannot be re-performed. To keep replayable proofs, run with --store-documents.')
  L.push('')
  L.push('## Who holds the signing key', '')
  if (m.key) {
    L.push(`- Key ${m.key.fingerprint}: ${m.key.source === 'supplied' ? 'supplied by the operator' : 'made for this run'}.`)
    L.push(`- Held by ${md(m.key.holder)}.`)
    L.push(`- Why: ${md(m.key.why)}`, '')
  } else L.push('Not recorded: this run was written before the report named the key holder. If run-key.pem is in this folder, whoever can read the folder holds it.', '')
  L.push('## How to check this report', '')
  L.push('- `riposte-ledger verify receipts.jsonl` walks the hash chain and every signature, and reads `receipts.jsonl.head.json` beside it, which catches receipts cut from the end while that record was left behind.')
  if (m.key?.public_key) L.push(`- \`riposte-ledger verify receipts.jsonl --key ${m.key.public_key}\` also refuses any receipt not signed by this run's key. A key does not catch receipts cut from the end: the ones left are still signed.`)
  L.push(`- Record this run's head, \`${m.ledger.head}\`, somewhere you control (another system, or write-once storage). \`riposte-ledger verify receipts.jsonl --head <that head>\` then catches a receipt removed from the end, or a rewritten file, even by whoever holds the key.`)
  L.push('- `riposte-pilot report --out <this folder> --prereg <the prereg>` recounts every number above from the receipts and refuses if one differs.')
  L.push('')
  return `${L.join('\n')}\n`
}
