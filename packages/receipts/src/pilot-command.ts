/**
 * `riposte-pilot`: a shadow run of one closed month of a buyer's bills (2026-10-03). Offline: no network, no model, no
 * payment call. See ./pilot/ and docs in README ("Shadow pilot").
 *
 *   riposte-pilot prereg init <PREREG.md> [--buyer <name>] [--month YYYY-MM] [--source <id>]
 *   riposte-pilot prereg freeze <PREREG.md>
 *   riposte-pilot map --export <dir> [--source <id>] [--month YYYY-MM] [--mapping <m.json>] [--ignore-columns a,b | --ignore-file <f>]
 *   riposte-pilot shadow --export <dir> --month YYYY-MM --prereg <PREREG.md> (--key <private.pem> | --key-dir <dir> | --key-here)
 *                        [--out <dir>] [--source <id>] [--mapping <m.json>] [--ignore-columns a,b | --ignore-file <f>]
 *                        [--store-documents] [--hashes-only] [--now <iso>]
 *     Signing (2026-10-05): the run refuses to start without a key choice (2026-10-05: the safe setting is a decision, not a
 *     default). --key signs with the operator's key (no private key is written); --key-dir makes a key for the run and writes
 *     its private half there; --key-here writes it beside the receipts. The output names who holds it.
 *     --hashes-only: pilot-run.json, the report and the audit sheet without document wording (default: in words).
 *   riposte-pilot report --out <dir> --prereg <PREREG.md> [--audit <AUDIT-SHEET.csv>]
 *   riposte-pilot purge --out <dir>
 *   riposte-pilot synth --out <dir> --month YYYY-MM [--bills 300] [--seed 7] [--pay-apps <contracts>] [--format ramp|generic-csv]
 *   riposte-pilot score --out <run dir> --truth <synthetic-truth.json>     a synthetic run, per planted class (2026-10-05)
 *   riposte-pilot mappings [--erp <id> --out <mapping.json>]               construction ERP mappings: status, and the drafts
 *
 * Exit: 0 done · 1 refused (the reason on stderr: unmapped columns, a prereg not frozen, a report that does not recount) ·
 * 3 a usage error or an unreadable input.
 */
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseTaxPolicy, readPopulationCSV, taxPolicyText } from 'riposte-verify'
import { fileStore } from './file-store.js'
import { openLedger, verifyChain } from './ledger.js'
import { parseLedgerTolerant } from './ledger-command.js'
import { detectSource, readExport, ExportRefused, MAPPER_SCHEMAS, SOURCE_IDS, type SourceId } from './pilot/mappers.js'
import { ERP_MAPPINGS, erpMappingFile } from './pilot/erp-mappings.js'
import { freezePrereg, preregTemplate, preregWarnings, PreregRefused } from './pilot/prereg.js'
import { readAuditLabels, ReportRefused, type PilotManifest } from './pilot/report.js'
import { rerenderReport, runShadow, ShadowRefused } from './pilot/shadow.js'
import { writeSynthMonth, type SynthTruth } from './pilot/synth.js'
import { scoreSynth, scoreTable, ScoreRefused } from './pilot/score.js'

export const PILOT_USAGE = `riposte-pilot prereg init <PREREG.md> [--buyer <name>] [--month YYYY-MM] [--source <id>] [--price-tolerance <fraction>] [--freight allow|person]
                           [--tax person|allow|rate:<pct>]
riposte-pilot prereg freeze <PREREG.md>
riposte-pilot map --export <dir> [--source <id>] [--month YYYY-MM] [--mapping <m.json>] [--ignore-columns a,b | --ignore-file <f>]
riposte-pilot shadow --export <dir> --month YYYY-MM --prereg <PREREG.md> (--key <private.pem> | --key-dir <dir> | --key-here)
                     [--out <dir>] [--source <id>] [--mapping <m.json>] [--ignore-columns a,b | --ignore-file <f>]
                     [--store-documents] [--hashes-only] [--price-tolerance <fraction>] [--freight allow|person]
                     [--tax person|allow|rate:<pct>]
riposte-pilot report --out <dir> --prereg <PREREG.md> [--audit <AUDIT-SHEET.csv>]
riposte-pilot purge --out <dir>
riposte-pilot synth --out <dir> --month YYYY-MM [--bills 300] [--seed 7] [--pay-apps <contracts>] [--format ramp|generic-csv]
riposte-pilot score --out <run dir> --truth <synthetic-truth.json>
riposte-pilot mappings [--erp <id> --out <mapping.json>]
sources: ${SOURCE_IDS.join(', ')}
signing key, one of: --key (your organisation's key) · --key-dir <dir> (a run key, kept outside the output) · --key-here (a run key beside the receipts)
price tolerance: how far a unit price may run over the PO's before a hold (default 0.02, that is 2%; "5%" reads 0.05). prereg init writes
  it into the pre-registration, frozen with the rest; shadow checks every bill under the frozen one and refuses a --price-tolerance that differs
freight: what happens to freight on a purchase order that does not say whether freight is allowed: person (default) sends the bill to a
  person; allow adds it to the total. Registered and frozen like the price tolerance; shadow refuses a --freight that differs
tax: what happens to tax on a purchase order that states no tax terms: person (default) sends the bill to a person; allow accepts it as
  billed; rate:8.25% checks it against that rate. Registered and frozen like the freight rule; shadow refuses a --tax that differs
prereg freeze warns, in words, when a registered audit sample cannot clear its bar even at its best`

export interface CliResult { code: number; out: string; err: string }

const VALUE_FLAGS = new Set(['--export', '--source', '--month', '--mapping', '--ignore-columns', '--ignore-file', '--prereg', '--out', '--key', '--key-dir', '--now', '--audit', '--buyer', '--bills', '--seed', '--truth', '--pay-apps', '--erp', '--price-tolerance', '--freight', '--tax', '--format'])

/** `--price-tolerance 0.05` or `5%` (2026-10-05): a fraction from 0 to 1, or a message saying what it must be. */
export function readPriceTolerance(raw: string): number | string {
  const m = /^\s*(\d+(?:\.\d+)?|\.\d+)\s*(%?)\s*$/.exec(raw)
  const v = m ? Number(m[1]) / (m[2] ? 100 : 1) : Number.NaN
  return Number.isFinite(v) && v >= 0 && v <= 1 ? Math.round(v * 1e9) / 1e9 : `--price-tolerance ${JSON.stringify(raw)} is not a fraction from 0 to 1 (0.05) or a percent from 0% to 100% (5%)`
}
/** `--freight allow` or `person` (2026-10-05): the rule, undefined when not given, or a message saying what it must be. */
export function readFreight(raw: string | undefined): 'allow' | 'person' | string | undefined {
  if (raw === undefined) return undefined
  return raw === 'allow' || raw === 'person' ? raw : `--freight ${JSON.stringify(raw)} is allow (freight on a purchase order that does not say is added to the total) or person (a person decides, the default)`
}
/** `--tax person|allow|rate:<pct>` (2026-10-06): the rule as the flag writes it, undefined when not given, or why not. */
export function readTax(raw: string | undefined): { text: string } | { error: string } | undefined {
  if (raw === undefined) return undefined
  const p = parseTaxPolicy(raw)
  return 'error' in p ? { error: p.error } : { text: taxPolicyText(p.value) }
}
const BOOL_FLAGS = new Set(['--store-documents', '--key-here', '--hashes-only'])

function parse(argv: string[]): { pos: string[]; f: Record<string, string>; b: Set<string> } | string {
  const pos: string[] = [], f: Record<string, string> = {}, b = new Set<string>()
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (BOOL_FLAGS.has(a)) { b.add(a); continue }
    if (VALUE_FLAGS.has(a)) { const v = argv[++i]; if (v === undefined || v.startsWith('--')) return `${a} needs a value`; if (f[a] !== undefined) return `${a} given twice`; f[a] = v; continue }
    if (a.startsWith('--')) return `unknown option ${a}`
    pos.push(a)
  }
  return { pos, f, b }
}

const ok = (out: string, err = ''): CliResult => ({ code: 0, out, err })
const refuse = (err: string): CliResult => ({ code: 1, out: '', err: `${err}\n` })
const usage = (msg?: string): CliResult => ({ code: msg ? 3 : 0, out: '', err: `${msg ? `riposte-pilot: ${msg}\n` : ''}${PILOT_USAGE}\n` })

function ignoreList(f: Record<string, string>): string[] {
  const out: string[] = []
  if (f['--ignore-columns']) out.push(...f['--ignore-columns'].split(',').map((s) => s.trim()).filter(Boolean))
  if (f['--ignore-file']) out.push(...readFileSync(f['--ignore-file'], 'utf8').split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#')))
  return out
}
const sourceOf = (f: Record<string, string>): SourceId | string => {
  const s = f['--source']
  if (s !== undefined && !(SOURCE_IDS as readonly string[]).includes(s)) return `--source is one of ${SOURCE_IDS.join(', ')}`
  return (s as SourceId | undefined) ?? (f['--export'] ? detectSource(f['--export']) : undefined) ?? 'cannot tell the source from the file names: give --source'
}

export function pilotCli(argv: string[], env: { now?: () => Date } = {}): CliResult {
  if (!argv.length || argv[0] === '--help' || argv[0] === '-h') return usage()
  const cmd = argv[0]!
  const p = parse(argv.slice(1))
  if (typeof p === 'string') return usage(p)
  const { pos, f, b } = p
  const now = f['--now'] ? (() => new Date(f['--now']!)) : (env.now ?? (() => new Date()))
  try {
    if (cmd === 'prereg') {
      const [sub, file] = pos
      if (!file || (sub !== 'init' && sub !== 'freeze')) return usage('prereg init <file> | prereg freeze <file>')
      if (sub === 'init') {
        if (existsSync(file)) return refuse(`${file} exists: a prereg is never written over`)
        const tol = f['--price-tolerance'] !== undefined ? readPriceTolerance(f['--price-tolerance']) : undefined
        if (typeof tol === 'string') return usage(tol)
        const fr = readFreight(f['--freight'])
        if (fr !== undefined && fr !== 'allow' && fr !== 'person') return usage(fr)
        const tx = readTax(f['--tax'])
        if (tx !== undefined && 'error' in tx) return usage(tx.error)
        writeFileSync(file, preregTemplate({ ...(f['--buyer'] ? { buyer: f['--buyer'] } : {}), ...(f['--month'] ? { month: f['--month'] } : {}), ...(f['--source'] ? { source: f['--source'] } : {}), ...(tol !== undefined ? { priceTolerance: tol } : {}), ...(fr !== undefined ? { freight: fr as 'allow' | 'person' } : {}), ...(tx !== undefined ? { tax: tx.text } : {}) }), { flag: 'wx' })
        return ok(`wrote ${file}: fill every <fill: …>, then riposte-pilot prereg freeze ${file}, BEFORE the month is run\n`)
      }
      const lock = freezePrereg(file, now)
      // 2026-10-06: a registered sample that cannot clear its bar is said, in words; the prereg is frozen as written
      const warn = preregWarnings(lock.params).map((w) => `warning: ${w}. Frozen as written: a larger sample needs a new pre-registration\n`).join('')
      return ok(`${JSON.stringify(lock, null, 2)}\n`, `frozen: ${file} sha256 ${lock.sha256} at ${lock.frozen_at}\n${warn}`)
    }
    if (cmd === 'map') {
      if (!f['--export']) return usage('map needs --export <dir>')
      const source = sourceOf(f)
      if (!(SOURCE_IDS as readonly string[]).includes(source)) return usage(source)
      const r = readExport(f['--export'], source as SourceId, { ...(f['--month'] ? { month: f['--month'] } : {}), ignore: ignoreList(f), ...(f['--mapping'] ? { mapping: JSON.parse(readFileSync(f['--mapping'], 'utf8')) } : {}) })
      const month = f['--month']
      const sel = month ? r.bills.filter((x) => x.issued_at?.startsWith(month)) : r.bills
      const problems = new Map<string, number>()
      for (const x of sel) if (x.problem) { const k = x.problem.replace(/purchase order \S+ is not/, 'purchase order … is not'); problems.set(k, (problems.get(k) ?? 0) + 1) }
      const summary = { source, schema: MAPPER_SCHEMAS[source as SourceId], files: r.files, missing: r.missing, unmapped: r.unmapped, ignored: r.ignored, notes: r.notes, bills: r.bills.length, ...(month ? { in_month: sel.length } : {}), mappable: sel.filter((x) => x.input).length, not_mappable: Object.fromEntries(problems), buyer: { pay: sel.filter((x) => x.buyer.decision === 'pay').length, hold: sel.filter((x) => x.buyer.decision === 'hold').length, open: sel.filter((x) => x.buyer.decision === 'open').length } }
      const blocked = r.missing.length > 0 || r.unmapped.length > 0
      const err = blocked ? `map: refused, nothing guessed.${r.missing.length ? `\n  missing:\n    ${r.missing.join('\n    ')}` : ''}${r.unmapped.length ? `\n  unmapped (check each; acknowledge with --ignore-columns or --ignore-file):\n    ${r.unmapped.join('\n    ')}` : ''}\n` : `map: ${summary.mappable} of ${sel.length} bills can be checked${r.notes.length ? `\n  ${r.notes.join('\n  ')}` : ''}\n`
      return { code: blocked ? 1 : 0, out: `${JSON.stringify(summary, null, 2)}\n`, err }
    }
    if (cmd === 'shadow') {
      for (const need of ['--export', '--month', '--prereg']) if (!f[need]) return usage(`shadow needs ${need}`)
      const source = f['--source'] as SourceId | undefined
      if (source !== undefined && !(SOURCE_IDS as readonly string[]).includes(source)) return usage(`--source is one of ${SOURCE_IDS.join(', ')}`)
      const out = f['--out'] ?? `pilot-${f['--month']}`
      const tol = f['--price-tolerance'] !== undefined ? readPriceTolerance(f['--price-tolerance']) : undefined
      if (typeof tol === 'string') return usage(tol)
      const fr = readFreight(f['--freight'])
      if (fr !== undefined && fr !== 'allow' && fr !== 'person') return usage(fr)
      const tx = readTax(f['--tax'])
      if (tx !== undefined && 'error' in tx) return usage(tx.error)
      const r = runShadow({
        ...(tx !== undefined ? { tax: tx.text } : {}),
        ...(tol !== undefined ? { priceTolerance: tol } : {}),
        ...(fr !== undefined ? { freight: fr as 'allow' | 'person' } : {}),
        exportDir: f['--export']!, month: f['--month']!, preregPath: f['--prereg']!, out, ...(source ? { source } : {}), ignore: ignoreList(f),
        ...(f['--mapping'] ? { mapping: JSON.parse(readFileSync(f['--mapping'], 'utf8')) } : {}), storeDocuments: b.has('--store-documents'),
        ...(f['--key'] ? { signingKeyPem: readFileSync(f['--key'], 'utf8'), signingKeyLabel: f['--key'] } : {}),
        ...(f['--key-dir'] !== undefined ? { keyDir: f['--key-dir'] } : {}), keyHere: b.has('--key-here'), hashesOnly: b.has('--hashes-only'), now,
      })
      const d = { pay: 0, hold: 0, person: 0 }
      for (const x of r.manifest.bills) d[x.disposition]++
      const key = r.manifest.key!
      // the labour cost first, in words (2026-10-05): of the bills you paid, how many the gate would have stopped
      const paid = r.manifest.bills.filter((x) => x.buyer.decision === 'pay')
      const paidPerson = paid.filter((x) => x.disposition === 'person').length, paidHold = paid.filter((x) => x.disposition === 'hold').length
      const apps = r.manifest.pay_apps ?? []
      const appsLine = apps.length ? ` ${apps.length} pay application(s): ${apps.filter((x) => x.disposition === 'pay').length} would pay, ${apps.filter((x) => x.disposition === 'hold').length} would hold, ${apps.filter((x) => x.disposition === 'person').length} to a person.` : ''
      return ok(`${JSON.stringify({ out, bills: r.manifest.bills.length, gated: r.manifest.bills.filter((x) => x.gated).length, would: d, ...(apps.length ? { pay_applications: apps.length } : {}), audit_sample: r.manifest.audit.sample.length, ...(r.manifest.audit.pay ? { audit_sample_would_pay: r.manifest.audit.pay.sample.length } : {}), ledger: r.manifest.ledger, key }, null, 2)}\n`,
        `labour: of the ${paid.length} bills your team paid, the gate would have stopped ${paidPerson + paidHold} (${paidPerson} to a person, ${paidHold} held); each is a problem paid by mistake or a good bill held up, and the report lists them for a person to decide. Over the month, ${d.person} of ${r.manifest.bills.length} bills would have gone to a person and ${d.hold} would have been held.${appsLine}\n` +
        `shadow: ${r.manifest.bills.length} bills of ${r.manifest.month}, nothing executed; ${join(out, 'PILOT-REPORT.md')} written${r.manifest.wording === 'hashes-only' ? ' (hashes only)' : ' (in words)'}, receipts in ${join(out, 'receipts.jsonl')}\n` +
        `signing key ${key.fingerprint}: held by ${key.holder}. ${key.why}\n`)
    }
    if (cmd === 'report') {
      for (const need of ['--out', '--prereg']) if (!f[need]) return usage(`report needs ${need}`)
      const dir = f['--out']!
      const manifest = JSON.parse(readFileSync(join(dir, 'pilot-run.json'), 'utf8')) as PilotManifest
      // the chain first, from the file's own text (2026-10-05): an altered entry is named, the way riposte-ledger verify names
      // it, before the file store's own checks (which see only that the file is no longer the length its head records)
      const ledgerFile = join(dir, 'receipts.jsonl')
      const { entries: raw, torn } = parseLedgerTolerant(readFileSync(ledgerFile, 'utf8'))
      const chain = verifyChain(raw)
      if (!chain.ok) return refuse(`riposte-pilot report: the receipt ledger does not verify: BROKEN at entry ${chain.broken_at ?? '-'}: ${chain.reason}. No report is rendered over it (riposte-ledger verify ${ledgerFile} says the same).`)
      if (torn) return refuse(`riposte-pilot report: the receipt ledger ends in an unfinished line (${torn.bytes} bytes after entry ${torn.after_line - 1}). No report is rendered over it (riposte-ledger verify ${ledgerFile} says more).`)
      const store = fileStore(ledgerFile)
      const entries = openLedger(store).entries()
      const audit = f['--audit'] ? readAuditLabels(readPopulationCSV(readFileSync(f['--audit'])).rows, manifest) : undefined
      const report = rerenderReport({ out: dir, preregPath: f['--prereg']!, manifest, entries, ...(audit ? { audit } : {}) })
      writeFileSync(join(dir, 'PILOT-REPORT.md'), report)
      return ok(report, `report: ${join(dir, 'PILOT-REPORT.md')} re-rendered; every count recounted from the receipts${audit ? `; ${audit.labels.size} audit label(s) read` : ''}\n`)
    }
    if (cmd === 'purge') {
      if (!f['--out']) return usage('purge needs --out <dir>')
      const removed: string[] = []
      for (const d of ['documents', 'proofs']) { const p = join(f['--out'], d); if (existsSync(p)) { removed.push(`${d}/ (${readdirSync(p).length} files)`); rmSync(p, { recursive: true, force: true }) } }
      return ok(`${JSON.stringify({ removed }, null, 2)}\n`, removed.length ? `purge: removed ${removed.join(', ')}; the receipts keep their hashes${'\n'}` : 'purge: nothing stored to remove (hashes-only run)\n')
    }
    if (cmd === 'synth') {
      if (!f['--out'] || !f['--month']) return usage('synth needs --out <dir> and --month YYYY-MM')
      // 2026-10-06: --format generic-csv writes the same month in this package's own CSV columns (shadow it with --source generic-csv)
      if (f['--format'] !== undefined && f['--format'] !== 'ramp' && f['--format'] !== 'generic-csv') return usage('--format is ramp (the default) or generic-csv')
      const csv = f['--format'] === 'generic-csv'
      const t = writeSynthMonth(join(f['--out'], 'export'), join(f['--out'], 'synthetic-truth.json'), { month: f['--month'], ...(f['--bills'] ? { bills: Number(f['--bills']) } : {}), ...(f['--seed'] ? { seed: Number(f['--seed']) } : {}), ...(f['--pay-apps'] ? { payApps: Number(f['--pay-apps']) } : {}), ...(csv ? { format: 'generic-csv' as const } : {}) })
      return ok(`${JSON.stringify({ export: join(f['--out'], 'export'), truth: join(f['--out'], 'synthetic-truth.json'), bills: t.bills, planted: Object.keys(t.planted).length, ...(t.pay_apps ? { pay_applications: Object.keys(t.pay_apps).length } : {}) }, null, 2)}\n`, `synth: a SYNTHETIC month in ${csv ? 'generic CSV columns (shadow it with --source generic-csv)' : "Ramp's export shapes"}${t.pay_apps ? ', with G702/G703 pay applications in export/pay_applications/' : ''} (nothing in it is real)\n`)
    }
    if (cmd === 'mappings') {
      if (f['--erp'] === undefined) {
        const rows = ERP_MAPPINGS.map((e) => `${e.id.padEnd(15)} ${e.name}\n${''.padEnd(16)}${e.status}`)
        return ok(`${JSON.stringify(ERP_MAPPINGS.map(({ mapping: _m, ...e }) => e), null, 2)}\n`, `construction ERP mappings (none verified on a real export):\n${rows.join('\n')}\nwrite a drafted one: riposte-pilot mappings --erp <id> --out mapping.json, then edit it against your own export (HOW-TO-MAP.md)\n`)
      }
      const e = ERP_MAPPINGS.find((x) => x.id === f['--erp'])
      if (!e) return usage(`--erp is one of ${ERP_MAPPINGS.map((x) => x.id).join(', ')}`)
      if (!e.mapping) return refuse(`riposte-pilot mappings: no mapping is drafted for ${e.name}: ${e.status}`)
      if (!f['--out']) return usage('mappings --erp <id> needs --out <mapping.json>')
      if (existsSync(f['--out'])) return refuse(`${f['--out']} exists: a mapping file is never written over`)
      writeFileSync(f['--out'], erpMappingFile(e), { flag: 'wx' })
      // 2026-10-06: the draft's notes print as it is written, and the file carries them under "notes"
      return ok(`wrote ${f['--out']}\n`, `a DRAFT mapping for ${e.name}: ${e.status}. Check every column name against your own export before a run (HOW-TO-MAP.md); riposte-pilot map --mapping ${f['--out']} lists what it reads and what it cannot.\nnotes (also in the file, under "notes"):\n${e.notes.map((n) => `  - ${n}`).join('\n')}\n`)
    }
    if (cmd === 'score') {
      if (!f['--out'] || !f['--truth']) return usage('score needs --out <run dir> and --truth <synthetic-truth.json>')
      const manifest = JSON.parse(readFileSync(join(f['--out'], 'pilot-run.json'), 'utf8')) as PilotManifest
      const s = scoreSynth(manifest, JSON.parse(readFileSync(f['--truth'], 'utf8')) as SynthTruth)
      return ok(`${JSON.stringify(s, null, 2)}\n`, scoreTable(s))
    }
    return usage(`unknown command ${cmd}`)
  } catch (e) {
    if (e instanceof ExportRefused || e instanceof PreregRefused || e instanceof ShadowRefused || e instanceof ReportRefused || e instanceof ScoreRefused) return refuse(`riposte-pilot ${cmd}: ${e.message}`)
    return { code: 3, out: '', err: `riposte-pilot ${cmd}: ${(e as Error).message}\n` }
  }
}
