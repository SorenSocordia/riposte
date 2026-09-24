/**
 * Byte-identity golden for the declarative layer (added 2026-09-24 with the v0.2 financial-statement features).
 *
 * The cases below were run ONCE against the engine as it stood BEFORE rounding inference, optional terms, guards and
 * check alternatives were added; the sha256 of each result is frozen in `declarative-golden-hashes.json`. The test
 * (`test/declarative-golden.test.ts`) re-runs them on the current engine and requires every hash to match, so an
 * existing ruleset that does not opt into the new features must produce byte-identical verdicts, lint results and
 * expression values.
 *
 * Inputs: real 2026q1 10-K values for the v0.1 financial-statement ruleset, seeded synthetic documents for every other
 * single-document example ruleset, a kitchen-sink ruleset (bool / identifier / default / line scope / computed / sum /
 * abs / every op / per-check tol), the four-way reconcile ruleset (it shares the expression parser), lint results and
 * raw expression values. Everything is deterministic (mulberry32 seed).
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const HERE = dirname(fileURLToPath(import.meta.url))
const EX = join(HERE, '..', '..', 'docs', 'examples')
const load = (f: string): Record<string, unknown> => JSON.parse(readFileSync(join(EX, f), 'utf8'))

export interface GoldenApi {
  verify: (x: Record<string, unknown>, o: Record<string, unknown>) => unknown
  verifyDeclarative: (x: Record<string, unknown>, rs: never, o: Record<string, unknown>) => unknown
  reconcile: (docs: Record<string, Record<string, unknown>>, rs: never, o: Record<string, unknown>) => unknown
  lintRuleset: (rs: unknown) => unknown
  evalExpr: (expr: string, env: { vars: Record<string, number | undefined>; sum: (r: string) => number | undefined }) => number | undefined
}

export interface GoldenCase { id: string; run: (api: GoldenApi) => unknown }

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

const NOW = () => new Date('2026-09-22T00:00:00Z')

type FieldSpec = { paths: string[]; kind?: string; line?: boolean; default?: number }
type RS = { fields: Record<string, FieldSpec>; lineArrayKeys?: string[] }

function setPath(obj: Record<string, unknown>, path: string, v: unknown): void {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)
  let cur: Record<string, unknown> = obj
  for (let i = 0; i < parts.length - 1; i++) { const p = parts[i]!; if (typeof cur[p] !== 'object' || cur[p] === null) cur[p] = {}; cur = cur[p] as Record<string, unknown> }
  cur[parts[parts.length - 1]!] = v
}

function randValue(rnd: () => number, kind: string | undefined): unknown {
  const r = rnd()
  if (kind === 'string') return r < 0.9 ? `S${Math.floor(rnd() * 100)}` : ''
  if (kind === 'bool') return [true, false, 'yes', 'no', 1, 0, 'maybe'][Math.floor(r * 7)]
  if (kind === 'identifier') return r < 0.5 ? `PO-${Math.floor(rnd() * 3)}` : r < 0.9 ? [`po ${Math.floor(rnd() * 3)}`, 'PO-1'] : { bad: 1 }
  if (r < 0.06) return 'n/a'                       // unparseable
  if (r < 0.14) return `${(rnd() * 5000).toFixed(2)}` // numeric string
  if (r < 0.18) return `1.234,${Math.floor(rnd() * 90 + 10)}` // european format
  if (kind === 'rate') return Math.round(rnd() * 30) / 100
  if (kind === 'quantity') return Math.floor(rnd() * 20)
  return Math.round(rnd() * 100000) / 100
}

function synthDocs(rs: RS, seed: number, n: number): Record<string, unknown>[] {
  const rnd = mulberry32(seed)
  const out: Record<string, unknown>[] = []
  const lineKey = (rs.lineArrayKeys ?? ['line_items'])[0]!
  const docFields = Object.entries(rs.fields).filter(([, f]) => !f.line)
  const lineFields = Object.entries(rs.fields).filter(([, f]) => f.line)
  for (let i = 0; i < n; i++) {
    const doc: Record<string, unknown> = {}
    for (const [, f] of docFields) if (rnd() < 0.85) setPath(doc, f.paths[Math.floor(rnd() * f.paths.length)]!, randValue(rnd, f.kind))
    if (lineFields.length) {
      const nl = Math.floor(rnd() * 4)
      const lines: Record<string, unknown>[] = []
      for (let j = 0; j < nl; j++) { const l: Record<string, unknown> = {}; for (const [, f] of lineFields) if (rnd() < 0.9) setPath(l, f.paths[Math.floor(rnd() * f.paths.length)]!, randValue(rnd, f.kind)); lines.push(l) }
      if (nl > 0 || rnd() < 0.5) doc[lineKey] = lines
    }
    out.push(doc)
  }
  return out
}

/** A ruleset exercising every pre-v0.2 declarative feature. */
export const KITCHEN_SINK = {
  id: 'kitchen-sink', version: '0.0.1', domain: 'test', lineArrayKeys: ['items'],
  tolerance: { rel: 0.0005, absCap: 1 },
  fields: {
    QTY: { paths: ['qty'], kind: 'quantity', line: true },
    PRICE: { paths: ['price'], line: true },
    AMT: { paths: ['amount', 'amt'], line: true },
    LINE_PO: { paths: ['po'], kind: 'identifier', line: true },
    LINE_PO_REF: { paths: ['po_ref'], kind: 'identifier', line: true },
    SUB: { paths: ['subtotal', 'totals.subtotal'] },
    TAX: { paths: ['tax'] },
    RATE: { paths: ['tax_rate'], kind: 'rate' },
    FREIGHT: { paths: ['freight'], default: 0 },
    ALLOWED: { paths: ['freight_allowed'], kind: 'bool' },
    TOTAL: { paths: ['total'] },
    PO_NO: { paths: ['po_number'], kind: 'identifier' },
    CITED: { paths: ['cited_pos'], kind: 'identifier' },
    NOTE: { paths: ['note'], kind: 'string' },
  },
  computed: { LSUM: 'sum(AMT)', EXP: 'SUB + TAX + FREIGHT * ALLOWED', DIFF: 'abs(TOTAL - EXP)' },
  checks: [
    { code: 'SUM', left: 'LSUM', op: '=', right: 'SUB' },
    { code: 'TOT', left: 'TOTAL', op: '=', right: 'EXP', tol: 0.05 },
    { code: 'TAXR', left: 'TAX', op: '<=', right: 'SUB * RATE', field: 'tax' },
    { code: 'POS', left: 'TOTAL', op: '>=', right: '0' },
    { code: 'NEQ', left: 'DIFF', op: '!=', right: '1000' },
    { code: 'DIV', left: 'TOTAL / SUB', op: '>=', right: '1' },
    { code: 'MATH', scope: 'line', left: 'AMT', op: '=', right: 'QTY * PRICE' },
    { code: 'LPO', scope: 'line', compare: 'identifier', left: 'LINE_PO', op: '=', right: 'LINE_PO_REF' },
    { code: 'CITE', compare: 'identifier', left: 'CITED', op: '=', right: 'PO_NO' },
    { code: 'BADOP', compare: 'identifier', left: 'CITED', op: '<=', right: 'PO_NO' },
  ],
}

const FS_CLEAN = {
  assets: 1000, liabilities: 600, equity: 400, liabilities_and_equity: 1000, current_assets: 300, noncurrent_assets: 700,
  current_liabilities: 250, noncurrent_liabilities: 350, cash: 120, revenue: 900, cost_of_goods_sold: 500, gross_profit: 400,
  operating_expenses: 250, operating_income: 150, pretax_income: 150, income_tax_expense: 30, net_income: 120,
  other_comprehensive_income: 10, comprehensive_income: 130, cash_from_operations: 200, cash_from_investing: -80,
  cash_from_financing: -40, net_change_in_cash: 80, beginning_cash: 40, ending_cash: 120,
}

const EXPRS = ['A + B * 2', '(A + B) * 2', 'A - B - 1', 'abs(B - A)', 'sum(L) + A', 'A + C', 'sum(X)', 'A / 0', '-A + +B', 'A / B * 3', '((A))', '1.5 * A', 'A * B - C']

export const hashOf = (x: unknown): string => createHash('sha256').update(JSON.stringify(x)).digest('hex')

export function buildGoldenCases(): GoldenCase[] {
  const cases: GoldenCase[] = []
  const fs01 = load('financial-statement.ruleset.json')
  const sec = JSON.parse(readFileSync(join(HERE, 'sec-2026q1-v01-sample.json'), 'utf8')) as { rows: { adsh: string; fields: Record<string, number> }[] }
  for (const r of sec.rows) cases.push({ id: `fs-v01/sec/${r.adsh}`, run: api => api.verifyDeclarative(r.fields, fs01 as never, { now: NOW }) })
  const fsVariants: Record<string, Record<string, unknown>> = {
    clean: FS_CLEAN, broken: { ...FS_CLEAN, assets: 1050 }, rounding: { ...FS_CLEAN, assets: 1000.2, cash: 120.01 },
    strings: { ...FS_CLEAN, assets: '1,000', equity: 'four hundred' }, bsOnly: { assets: 1000, liabilities: 600, equity: 400 },
  }
  for (const [k, x] of Object.entries(fsVariants)) {
    cases.push({ id: `fs-v01/synthetic/${k}`, run: api => api.verifyDeclarative(x, fs01 as never, { now: NOW }) })
    cases.push({ id: `fs-v01/synthetic/${k}/verify-override`, run: api => api.verify(x, { ruleset: fs01, now: NOW, producer: 'golden', tolerance: { rel: 0.01, absCap: 0 } }) })
  }
  const single: [string, number][] = [['ksef-fa3.ruleset.json', 11], ['peppol-en16931.ruleset.json', 12], ['purchase-order.ruleset.json', 13], ['zatca-ksa.ruleset.json', 14]]
  for (const [f, seed] of single) {
    const rs = load(f)
    synthDocs(rs as unknown as RS, seed, 40).forEach((doc, i) => cases.push({ id: `${f}/synthetic/${i}`, run: api => api.verifyDeclarative(doc, rs as never, { now: NOW }) }))
  }
  const po = load('purchase-order.ruleset.json')
  const cleanPO = { items: [{ qty: 2, unit_price: 50, amount: 100 }, { qty: 1, unit_price: 250, amount: 250 }], subtotal: 350, tax: 35, total: 385 }
  for (const [k, x] of Object.entries({ clean: cleanPO, cents: { ...cleanPO, total: 385.02 }, off: { ...cleanPO, total: 399 }, noLines: { subtotal: 1, tax: 0, total: 1 } })) {
    cases.push({ id: `purchase-order/fixed/${k}`, run: api => api.verifyDeclarative(x, po as never, { now: NOW }) })
  }
  synthDocs(KITCHEN_SINK as unknown as RS, 99, 80).forEach((doc, i) => cases.push({ id: `kitchen-sink/${i}`, run: api => api.verifyDeclarative(doc, KITCHEN_SINK as never, { now: NOW }) }))
  const recon = load('four-way-match.ruleset.json')
  const rnd = mulberry32(7)
  for (let i = 0; i < 30; i++) {
    const v = () => (rnd() < 0.1 ? 'x' : Math.round(rnd() * 3) * 500)
    const docs: Record<string, Record<string, unknown>> = {}
    if (rnd() < 0.9) docs.po = { approved_amount: v() }
    if (rnd() < 0.9) docs.invoice = { payable_amount: v() }
    if (rnd() < 0.9) docs.receipt = { received_amount: v() }
    if (rnd() < 0.9) docs.payment = { amount: v() }
    cases.push({ id: `four-way/${i}`, run: api => api.reconcile(docs, recon as never, { now: NOW }) })
  }
  for (const f of ['financial-statement.ruleset.json', 'ksef-fa3.ruleset.json', 'peppol-en16931.ruleset.json', 'purchase-order.ruleset.json', 'zatca-ksa.ruleset.json']) {
    const rs = load(f)
    cases.push({ id: `lint/${f}`, run: api => api.lintRuleset(rs) })
  }
  cases.push({ id: 'lint/kitchen-sink', run: api => api.lintRuleset(KITCHEN_SINK) })
  cases.push({ id: 'lint/bad', run: api => api.lintRuleset({ id: 'x', version: '1', fields: { A: { paths: [] }, B: { paths: ['b'], kind: 'weird' } }, computed: { C: 'A + )' }, checks: [{ code: 'Q', left: 'A + )', op: '~', right: 'GHOST' }] }) })
  const env = { vars: { A: 10, B: 4, C: undefined as number | undefined }, sum: (r: string) => (r === 'L' ? 30 : undefined) }
  for (const e of EXPRS) cases.push({ id: `expr/${e}`, run: api => { try { return { v: api.evalExpr(e, env) ?? 'undefined' } } catch (err) { return { error: (err as Error).message } } } })
  // A '?' that does not directly follow a role name stays an invalid character (the new optional-term syntax is `ROLE?`,
  // which used to be a parse error and is therefore deliberately NOT in this byte-identity set).
  for (const e of ['A; drop', 'A ?', '?A', 'A ?? B']) cases.push({ id: `expr-throws/${e}`, run: api => { try { return { v: api.evalExpr(e, env) ?? 'undefined' } } catch (err) { return { error: (err as Error).message } } } })
  return cases
}
