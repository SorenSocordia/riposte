/**
 * Pay applications in the shadow pilot (2026-10-05). A subcontractor's money moves on AIA G702/G703 pay
 * applications as much as on suppliers' bills, so the pilot reads a month's pay applications beside its bills and checks
 * each one with verify's pay-app ruleset against the previous application of the same contract: the G703 line math, the
 * G702 summary, retainage, and continuity with last month (each line's "previous" is last month's "completed to date", and
 * last month's certificates are this month's line 7).
 *
 * The export: a folder `pay_applications/` inside the export folder, one JSON file per application, in the shape of
 * packages/verify docs/examples/payapp-g702-g703.json. Nothing is guessed:
 *   - a key that shape does not have is UNMAPPED, and the run refuses until it is acknowledged (--ignore-columns
 *     `pay_applications[].<key>` or `pay_applications[].schedule_of_values[].<key>`), the way the bill mappers do;
 *   - an application whose `period_to` falls in the month is checked; the others are read only as the previous application;
 *   - the previous application is the one with the same project and contractor and the application number one lower. When
 *     it is not in the folder, the continuity checks cannot run, the verdict is PASS-WITH-OPEN, and the application goes to a
 *     person, saying so.
 *   - your decision on each application, when you give one, comes from `pay_applications/decisions.csv` (this package's own
 *     format: columns `file,decision`, decision paid | held | open). Without it every application counts as open.
 *
 * Disposition, fail-closed like the AP gate: exactly PASS (with no struck field) would pay; FAIL would hold, with the
 * verdict's typed remedies; anything else (PASS-WITH-OPEN, INSUFFICIENT_DATA, OPEN) would go to a person.
 */
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { readPopulationCSV } from 'riposte-verify'
import { decodeExportBytes, EXPORT_LIMITS, ExportRefused, type BuyerDecision } from './mappers.js'

/** The folder inside an export that holds pay applications, and the decisions file inside it. */
export const PAY_APP_DIR = 'pay_applications'
export const PAY_APP_DECISIONS = 'decisions.csv'

/** The keys of the pay-application shape the pilot reads (packages/verify docs/examples/payapp-g702-g703.json). */
export const PAY_APP_FIELDS = {
  application: ['project', 'contractor', 'owner', 'architect', 'application_number', 'period_to', 'currency', 'original_contract_sum',
    'net_change_orders', 'contract_sum_to_date', 'schedule_of_values', 'total_completed_and_stored', 'retainage_rate', 'total_retainage',
    'total_earned_less_retainage', 'less_previous_certificates', 'current_payment_due', 'balance_to_finish_including_retainage'],
  line: ['item_no', 'description', 'scheduled_value', 'previous', 'this_period', 'materials_stored', 'completed_to_date', 'percent_complete',
    'balance_to_finish', 'retainage'],
} as const

/** One pay application as read from the export. */
export interface MappedPayApp {
  /** the file name inside pay_applications/ (how the buyer finds it) */
  ref: string
  project: string | null
  contractor: string | null
  application_number: number | null
  period_to: string | null
  currency: string | null
  /** line 8, the current payment due, in major units (from the document; never put on a receipt) */
  amount: number | null
  buyer: { decision: BuyerDecision; from: string }
  /** the application as read (what the check runs on) */
  doc: Record<string, unknown>
  /** the previous application of the same contract, when it is in the folder */
  previous?: { ref: string; doc: Record<string, unknown> }
  /** why it cannot be checked */
  problem?: string
}

export interface PayAppReading {
  files: { name: string; sha256: string; bytes: number; records: number }[]
  unmapped: string[]
  ignored: string[]
  /** every application in the folder, all months */
  apps: MappedPayApp[]
  notes: string[]
}

const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x)
const str = (x: unknown): string | null => (typeof x === 'string' && x.trim() ? x.trim() : null)
const numOf = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null)

/** Read `<export>/pay_applications/`. No folder: an empty reading (a month with bills only). */
export function readPayApps(exportDir: string, opts: { ignore?: readonly string[] } = {}): PayAppReading {
  const dir = join(exportDir, PAY_APP_DIR)
  const out: PayAppReading = { files: [], unmapped: [], ignored: [], apps: [], notes: [] }
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return out
  const ignore = new Set(opts.ignore ?? [])
  const unk = new Set<string>()
  const known = new Set<string>(PAY_APP_FIELDS.application)
  const knownLine = new Set<string>(PAY_APP_FIELDS.line)
  // decisions.csv (optional)
  const decisions = new Map<string, { decision: BuyerDecision; from: string }>()
  const decPath = join(dir, PAY_APP_DECISIONS)
  if (existsSync(decPath)) {
    const buf = readFileSync(decPath)
    const pop = readPopulationCSV(decodeExportBytes(`${PAY_APP_DIR}/${PAY_APP_DECISIONS}`, buf))
    out.files.push({ name: `${PAY_APP_DIR}/${PAY_APP_DECISIONS}`, sha256: createHash('sha256').update(buf).digest('hex'), bytes: buf.length, records: pop.rows.length })
    for (const c of pop.columns ?? []) if (c !== 'file' && c !== 'decision') unk.add(`${PAY_APP_DIR}/${PAY_APP_DECISIONS}: column "${c}"`)
    for (const { values } of pop.rows) {
      const file = str(values.file), d = (str(values.decision) ?? '').toLowerCase()
      if (!file) continue
      decisions.set(file, d === 'paid' ? { decision: 'pay', from: `${PAY_APP_DECISIONS} "paid"` } : d === 'held' ? { decision: 'hold', from: `${PAY_APP_DECISIONS} "held"` } : { decision: 'open', from: `${PAY_APP_DECISIONS} "${d}"` })
    }
  } else out.notes.push(`no ${PAY_APP_DIR}/${PAY_APP_DECISIONS}: your decision on each pay application is unknown, so every one counts as open and none is compared`)
  const names = readdirSync(dir).filter((f) => /\.json$/i.test(f)).sort()
  for (const name of names) {
    const path = join(dir, name)
    const size = statSync(path).size
    if (size > EXPORT_LIMITS.maxFileBytes) throw new ExportRefused(`${PAY_APP_DIR}/${name} is ${size} bytes, over the ${EXPORT_LIMITS.maxFileBytes}-byte cap per file`)
    const buf = readFileSync(path)
    let doc: unknown
    try { doc = JSON.parse(decodeExportBytes(`${PAY_APP_DIR}/${name}`, buf)) } catch (e) {
      if (e instanceof ExportRefused) throw e
      throw new ExportRefused(`${PAY_APP_DIR}/${name} is not JSON: ${(e as Error).message}`)
    }
    out.files.push({ name: `${PAY_APP_DIR}/${name}`, sha256: createHash('sha256').update(buf).digest('hex'), bytes: buf.length, records: 1 })
    const base = { ref: name, buyer: decisions.get(name) ?? { decision: 'open' as BuyerDecision, from: existsSync(decPath) ? `not in ${PAY_APP_DECISIONS}` : `no ${PAY_APP_DECISIONS}` } }
    if (!isObj(doc)) { out.apps.push({ ...base, project: null, contractor: null, application_number: null, period_to: null, currency: null, amount: null, doc: {}, problem: 'the file is not one pay application (a JSON object)' }); continue }
    for (const k of Object.keys(doc)) if (!known.has(k)) unk.add(`pay_applications[].${k}`)
    for (const l of Array.isArray(doc.schedule_of_values) ? doc.schedule_of_values : []) if (isObj(l)) for (const k of Object.keys(l)) if (!knownLine.has(k)) unk.add(`pay_applications[].schedule_of_values[].${k}`)
    const period = str(doc.period_to)
    out.apps.push({
      ...base, doc, project: str(doc.project), contractor: str(doc.contractor), application_number: numOf(doc.application_number),
      period_to: period && /^\d{4}-\d{2}-\d{2}/.test(period) ? period.slice(0, 10) : null, currency: str(doc.currency), amount: numOf(doc.current_payment_due),
      ...(!Array.isArray(doc.schedule_of_values) || !doc.schedule_of_values.length ? { problem: 'the application has no schedule of values (G703 lines)' } : {}),
    })
  }
  // the previous application: same project and contractor, application number one lower
  for (const a of out.apps) {
    if (a.problem || a.application_number === null) continue
    const prev = out.apps.filter((p) => p !== a && !p.problem && p.project === a.project && p.contractor === a.contractor && p.application_number === a.application_number! - 1)
    if (prev.length === 1) a.previous = { ref: prev[0]!.ref, doc: prev[0]!.doc }
    else if (prev.length > 1) a.problem = `${prev.length} files claim to be application ${a.application_number! - 1} of this contract (${prev.map((p) => p.ref).join(', ')}): which one was last month's is not guessed`
  }
  const all = [...unk].sort()
  out.unmapped = all.filter((u) => !ignore.has(u))
  out.ignored = all.filter((u) => ignore.has(u))
  return out
}
