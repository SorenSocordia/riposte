/**
 * `verify` CLI — the boring, shippable surface.
 *
 *   verify invoice.json                                   # built-in invoice ruleset
 *   verify payapp.json --ruleset pay-app --history prev.json
 *   verify invoice.json --ruleset peppol.json            # a DECLARATIVE ruleset from a JSON file
 *   verify invoice.json --contract contract.json --evidence receipt.json --source invoice.txt
 *   cat invoice.json | verify -                           # read the extraction from stdin
 *   verify lint --ruleset peppol.json                     # validate a declarative ruleset
 *   verify measure --ruleset peppol.json --labels set.json   # mint a measured DeclaredAccuracy
 *   verify mine cases.jsonl --schema schema.json          # mine candidate rules from labelled approve/hold cases
 *   verify mine invoice_cases.jsonl --ap --ruleset-out mined.json   # Distil-style AP cases → report + enforceable ruleset
 *
 * Prints JSON to stdout. Exit code: 0 = PASS/ok, 1 = FAIL/not-ok, 2 = INSUFFICIENT_DATA, 3 = usage/error.
 * Deterministic (no clock in the output beyond issued_at). No network.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import {
  verify, lintRuleset, measureRuleset, renderMeasurement, verifyReplay,
  type VerifyOptions, type Json, type DeclarativeRuleset, type LabeledCase, type Verdict,
} from './index.js'
import { verifyInvoiceMatch, splitApLayout, type ApDocuments } from './ap/index.js'
import {
  mine, compileRuleset, apCasesToTable, AP_MINE_SCHEMA, parseJsonl, caseTableFromRows,
  type MineSchema, type MineReport, type CompiledRuleset, type DistilApCase,
} from './mine/index.js'

export interface CliIO { out: (s: string) => void; err: (s: string) => void }
const PROCESS_IO: CliIO = { out: s => { process.stdout.write(s) }, err: s => { process.stderr.write(s) } }

const BUILTIN = new Set(['invoice', 'pay-app'])

interface Args { file?: string; ruleset?: string; labels?: string; inputs?: string; invoice?: string; po?: string; receipt?: string; contract?: string; evidence: string[]; history: string[]; source?: string; help: boolean }

function parse(argv: string[]): Args {
  const a: Args = { evidence: [], history: [], help: false }
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i] as string
    switch (t) {
      case '-h': case '--help': a.help = true; break
      case '--ruleset': a.ruleset = argv[++i]; break
      case '--labels': a.labels = argv[++i]; break
      case '--inputs': a.inputs = argv[++i]; break
      case '--invoice': a.invoice = argv[++i]; break
      case '--po': a.po = argv[++i]; break
      case '--receipt': a.receipt = argv[++i]; break
      case '--contract': a.contract = argv[++i]; break
      case '--evidence': a.evidence.push(argv[++i] as string); break
      case '--history': a.history.push(argv[++i] as string); break
      case '--source': a.source = argv[++i]; break
      default: if (!t.startsWith('-') || t === '-') a.file = t
    }
  }
  return a
}

const USAGE = `riposte-verify <extraction.json | -> [options]        verify a document
  --ruleset invoice|pay-app|<file.json>   built-in name OR a declarative ruleset file (default: invoice)
  --contract <file.json>        contract / PO reference
  --evidence <file.json>        receipt / delivery evidence (repeatable)
  --history <file.json>         prior document of the same kind (repeatable)
  --source <file.txt>           source document text (values checked against it)

riposte-verify lint --ruleset <file.json>              validate a declarative ruleset
riposte-verify measure --ruleset <file.json> --labels <set.json>   measured accuracy on a labeled set
riposte-verify replay <verdict.json> [--inputs <inputs.json>]      independently check a verdict's binding (no engine)
riposte-verify ap <layout.txt> | --invoice <f> --po <f> --receipt <f>   AP three-way match (exit 0 approve · 1 hold · 2 abstain)
verify mine <cases.jsonl> --schema <schema.json>   mine candidate rules from labelled approve/hold cases (JSON report)
  --ap                                  cases are Distil-style AP layouts {id,input,decision}; built-in AP schema unless --schema
  --max-approved-violation-rate <r>     tolerate approved exceptions (default 0 = none)
  --ruleset-out <file>                  also write the compiled ruleset (enforce: verify <doc> --ruleset <file>)
  --ruleset-id <id>                     id of the compiled ruleset (default "mined")

Exit: 0 PASS/ok · 1 FAIL/not-ok · 2 INSUFFICIENT_DATA · 3 error`

function readJson(path: string): Json {
  return JSON.parse(readFileSync(path === '-' ? 0 : path, 'utf8')) as Json
}

/** A labels file is either an array of {extraction,label} or an object { cases: [...] }. */
function readLabels(path: string): LabeledCase[] {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown
  const arr = Array.isArray(raw) ? raw : (raw as { cases?: unknown }).cases
  if (!Array.isArray(arr)) throw new Error('labels file must be an array of {extraction,label} or { "cases": [...] }')
  return arr as LabeledCase[]
}

function runLint(argv: string[], io: CliIO): number {
  const a = parse(argv)
  if (a.help || !a.ruleset) { io.err(`${USAGE}\n`); return a.help ? 0 : 3 }
  let ruleset: DeclarativeRuleset
  try { ruleset = readJson(a.ruleset) as unknown as DeclarativeRuleset } catch (e) { io.err(`error reading ruleset: ${(e as Error).message}\n`); return 3 }
  const result = lintRuleset(ruleset)
  io.out(`${JSON.stringify(result, null, 2)}\n`)
  return result.ok ? 0 : 1
}

function runMeasure(argv: string[], io: CliIO): number {
  const a = parse(argv)
  if (a.help || !a.ruleset || !a.labels) { io.err(`${USAGE}\n`); return a.help ? 0 : 3 }
  let ruleset: DeclarativeRuleset, cases: LabeledCase[]
  try {
    ruleset = readJson(a.ruleset) as unknown as DeclarativeRuleset
    cases = readLabels(a.labels)
  } catch (e) { io.err(`error reading input: ${(e as Error).message}\n`); return 3 }
  const m = measureRuleset(ruleset, cases)
  io.out(`${renderMeasurement(m)}\n${JSON.stringify(m.accuracy, null, 2)}\n`)
  return 0
}

function runVerify(argv: string[], io: CliIO): number {
  const a = parse(argv)
  if (a.help || !a.file) { io.err(`${USAGE}\n`); return a.help ? 0 : 3 }
  let extraction: Json
  try { extraction = readJson(a.file) } catch (e) { io.err(`error reading extraction: ${(e as Error).message}\n`); return 3 }

  const opts: VerifyOptions = {}
  try {
    if (a.ruleset) {
      opts.ruleset = BUILTIN.has(a.ruleset) ? (a.ruleset as 'invoice' | 'pay-app') : (readJson(a.ruleset) as unknown as DeclarativeRuleset)
    }
    const references: NonNullable<VerifyOptions['references']> = {}
    if (a.contract) references.contract = readJson(a.contract)
    if (a.evidence.length) references.evidence = a.evidence.map(readJson)
    if (a.history.length) references.history = a.history.map(readJson)
    if (Object.keys(references).length) opts.references = references
    if (a.source) opts.source = { text: readFileSync(a.source, 'utf8') }
  } catch (e) { io.err(`error reading reference: ${(e as Error).message}\n`); return 3 }

  const verdict = verify(extraction, opts)
  io.out(`${JSON.stringify(verdict, null, 2)}\n`)
  return verdict.outcome === 'PASS' ? 0 : verdict.outcome === 'FAIL' ? 1 : 2
}

function runReplay(argv: string[], io: CliIO): number {
  const a = parse(argv)
  if (a.help || !a.file) { io.err(`${USAGE}\n`); return a.help ? 0 : 3 }
  let verdict: Verdict, inputs: Json | undefined
  try {
    verdict = readJson(a.file) as unknown as Verdict
    inputs = a.inputs ? readJson(a.inputs) : undefined
  } catch (e) { io.err(`error reading input: ${(e as Error).message}\n`); return 3 }
  const result = verifyReplay(verdict, inputs)
  io.out(`${JSON.stringify(result, null, 2)}\n`)
  return result.ok ? 0 : 1
}

function runAp(argv: string[], io: CliIO): number {
  const a = parse(argv)
  if (a.help || (!a.file && !(a.invoice && a.po && a.receipt))) { io.err(`${USAGE}\n`); return a.help ? 0 : 3 }
  let docs: ApDocuments | null
  try {
    docs = a.file ? splitApLayout(readFileSync(a.file, 'utf8'))
      : { invoice: readFileSync(a.invoice as string, 'utf8'), purchase_order: readFileSync(a.po as string, 'utf8'), goods_receipt: readFileSync(a.receipt as string, 'utf8') }
  } catch (e) { io.err(`error reading documents: ${(e as Error).message}\n`); return 3 }
  if (!docs) { io.err('layout file must contain the "PURCHASE ORDER (ERP)" and "GOODS RECEIPT (ERP)" section markers\n'); return 3 }
  const r = verifyInvoiceMatch(docs)
  io.out(`${JSON.stringify(r, null, 2)}\n`)
  return r.decision === 'approve' ? 0 : r.decision === 'abstain' ? 2 : 1
}

export interface MineArgs {
  file?: string
  schema?: string
  ap: boolean
  /** the raw --max-approved-violation-rate text (validated in runMine) */
  rate?: string
  rulesetOut?: string
  rulesetId?: string
  help: boolean
  /** flags `verify mine` does not know. A typo must not silently mine with defaults. */
  unknown: string[]
}

export function parseMineArgs(argv: string[]): MineArgs {
  const a: MineArgs = { ap: false, help: false, unknown: [] }
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i] as string
    switch (t) {
      case '-h': case '--help': a.help = true; break
      case '--schema': a.schema = argv[++i]; break
      case '--ap': a.ap = true; break
      case '--max-approved-violation-rate': a.rate = argv[++i]; break
      case '--ruleset-out': a.rulesetOut = argv[++i]; break
      case '--ruleset-id': a.rulesetId = argv[++i]; break
      default: if (t.startsWith('-') && t !== '-') a.unknown.push(t); else a.file = t
    }
  }
  return a
}

/**
 * The pure core of `verify mine`: JSONL text (+ schema) → { report, compiled }. No I/O.
 * With `ap`, each line is a Distil-style AP case, turned into the case table by the AP adapter (schema defaults to the
 * AP schema). Otherwise each line is a case-table row `{ id, label, fields, lines? }` and a schema is required.
 */
export function mineFromJsonl(text: string, opts: { schema?: MineSchema; ap?: boolean; maxApprovedViolationRate?: number; rulesetId?: string }): { report: MineReport; compiled: CompiledRuleset } {
  const rows = parseJsonl(text)
  const table = opts.ap ? apCasesToTable(rows as DistilApCase[]) : caseTableFromRows(rows)
  const schema = opts.schema ?? (opts.ap ? AP_MINE_SCHEMA : undefined)
  if (!schema) throw new Error('a schema is required (or use the AP adapter)')
  const report = mine(table, schema, opts.maxApprovedViolationRate !== undefined ? { maxApprovedViolationRate: opts.maxApprovedViolationRate } : {})
  return { report, compiled: compileRuleset(report, opts.rulesetId !== undefined ? { id: opts.rulesetId } : {}) }
}

function runMine(argv: string[], io: CliIO): number {
  const a = parseMineArgs(argv)
  if (a.help) { io.err(`${USAGE}\n`); return 0 }
  if (a.unknown.length) { io.err(`verify mine: unknown option(s) ${a.unknown.join(', ')}\n${USAGE}\n`); return 3 }
  if (!a.file || (!a.schema && !a.ap)) { io.err(`verify mine needs <cases.jsonl> and --schema <schema.json> (or --ap)\n${USAGE}\n`); return 3 }
  let rate: number | undefined
  if (a.rate !== undefined) {
    rate = Number(a.rate)
    if (a.rate.trim() === '' || !Number.isFinite(rate) || rate < 0 || rate >= 1) { io.err(`--max-approved-violation-rate must be a number in [0, 1) (got "${a.rate}")\n`); return 3 }
  }
  let text: string, schema: MineSchema | undefined
  try {
    text = readFileSync(a.file === '-' ? 0 : a.file, 'utf8')
    schema = a.schema ? (readJson(a.schema) as unknown as MineSchema) : undefined
  } catch (e) { io.err(`error reading input: ${(e as Error).message}\n`); return 3 }
  let out: { report: MineReport; compiled: CompiledRuleset }
  try {
    out = mineFromJsonl(text, { ap: a.ap, ...(schema ? { schema } : {}), ...(rate !== undefined ? { maxApprovedViolationRate: rate } : {}), ...(a.rulesetId !== undefined ? { rulesetId: a.rulesetId } : {}) })
  } catch (e) { io.err(`verify mine: ${(e as Error).message}\n`); return 3 }
  if (a.rulesetOut) {
    try { writeFileSync(a.rulesetOut, `${JSON.stringify(out.compiled.ruleset, null, 2)}\n`) } catch (e) { io.err(`error writing ruleset: ${(e as Error).message}\n`); return 3 }
  }
  io.out(`${JSON.stringify(out, null, 2)}\n`)
  return 0
}

export function run(argv: string[], io: CliIO = PROCESS_IO): number {
  const [first, ...rest] = argv
  if (first === 'lint') return runLint(rest, io)
  if (first === 'measure') return runMeasure(rest, io)
  if (first === 'replay') return runReplay(rest, io)
  if (first === 'ap') return runAp(rest, io)
  if (first === 'mine') return runMine(rest, io)
  return runVerify(argv, io)
}

// Run when invoked directly.
if (process.argv[1] && (process.argv[1].endsWith('cli.js') || process.argv[1].endsWith('cli.ts'))) {
  process.exit(run(process.argv.slice(2)))
}
