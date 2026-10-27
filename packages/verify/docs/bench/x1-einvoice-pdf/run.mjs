// X1 run: for every corpus PDF -> extract -> verify CLI (shipped Peppol ruleset; X1 supplement) with --source/--quotes
// and --gate -> oracle verdicts on the printed truth -> the e-invoice twin on the extracted claims vs the base XML.
// Sequential, one child process at a time, windowsHide on every spawn. Writes out/<label>/... ; never edits products/.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { extractPdf, EXTRACTOR_VERSION } from './lib/extract.mjs'

const LABEL = process.argv.includes('--label') ? process.argv[process.argv.indexOf('--label') + 1] : 'run1'
const ROOT = '../../..'
const CLI = `${ROOT}/products/verify/dist/cli.js`
const SHIPPED = `${ROOT}/products/verify/docs/examples/peppol-en16931.ruleset.json`
const SUPP = 'rulesets/x1-supplement.ruleset.json'
const REAL = '../../einvoice-real/'
const O = `out/${LABEL}`
if (existsSync(`${O}/run-receipt.json`) && !process.argv.includes('--force')) { console.error(`${O} already ran; refusing to overwrite (use a new --label)`); process.exit(1) }
for (const d of ['extract', 'verdicts', 'oracle', 'twin']) mkdirSync(`${O}/${d}`, { recursive: true })
const sha = (b) => createHash('sha256').update(b).digest('hex')
const PINS = ['products/verify/dist/cli.js', 'products/verify/dist/verify.js', 'products/verify/dist/declarative/evaluate.js', 'products/verify/dist/declarative/expr.js',
  'products/verify/dist/declarative/lint.js', 'products/verify/dist/twin-einvoice/judge.js', 'products/verify/dist/twin-einvoice/map.js', 'products/verify/dist/twin-einvoice/bind.js',
  'products/verify/dist/twin-einvoice/consistency.js', 'products/verify/dist/twin-einvoice/rulesets.js', 'products/verify/dist/version.js',
  'products/verify/docs/examples/peppol-en16931.ruleset.json']
const pins = () => Object.fromEntries(PINS.map(p => [p, existsSync(`${ROOT}/${p}`) ? sha(readFileSync(`${ROOT}/${p}`)) : null]).concat([[SUPP, sha(readFileSync(SUPP))], ['corpus/manifest.json', sha(readFileSync('corpus/manifest.json'))]]))
const pinsStart = pins()

function cli(args) {
  try {
    const out = execFileSync(process.execPath, ['--max-old-space-size=1024', CLI, ...args], { windowsHide: true, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'] })
    return { exit: 0, out: JSON.parse(out), stderr: '' }
  } catch (e) {
    let out = null
    try { out = JSON.parse(e.stdout) } catch { /* not JSON */ }
    return { exit: e.status ?? -1, out, stderr: String(e.stderr ?? '').trim() }
  }
}
const GATE = { 0: 'PASS', 1: 'FAIL', 2: 'ABSTAIN' }
const slim = (r) => ({ exit: r.exit, decision: GATE[r.exit] ?? 'ERROR', outcome: r.out?.outcome ?? null, verdict_id: r.out?.verdict_id ?? null, input_hash: r.out?.input_hash ?? null,
  claims: (r.out?.claims ?? []).map(c => ({ id: c.claim_id, outcome: c.outcome, reason: c.insufficiency?.reason ?? null, asserted: c.asserted ?? null, expected: c.expected ?? null, variance: c.variance ?? null })), stderr: r.stderr })

// extraction -> twin claims (twin field names from verify's EINVOICE map; party names excluded: the renderer sanitizes them)
const DOCMAP = { invoice_number: 'invoice_number', issue_date: 'issue_date', currency: 'currency', line_extension_amount: 'sum_of_line_net_amount',
  allowance_total_amount: 'allowance_total_amount', charge_total_amount: 'charge_total_amount', tax_exclusive_amount: 'tax_exclusive_amount', tax_amount: 'tax_amount',
  tax_inclusive_amount: 'tax_inclusive_amount', prepaid_amount: 'prepaid_amount', payable_rounding_amount: 'rounding_amount', payable_amount: 'payable_amount' }
const LINEMAP = { id: 'id', invoiced_quantity: 'quantity', price_amount: 'price', base_quantity: 'base_quantity', line_extension_amount: 'net_amount' }
const VBDMAP = { category: 'category', rate: 'rate', taxable_amount: 'taxable_amount', tax_amount: 'tax_amount' }
const AMOUNT = new Set(['line_extension_amount', 'allowance_total_amount', 'charge_total_amount', 'tax_exclusive_amount', 'tax_amount', 'tax_inclusive_amount', 'prepaid_amount', 'payable_rounding_amount', 'payable_amount'])
export function twinClaims(x) {
  const c = []
  for (const [k, f] of Object.entries(DOCMAP)) if (x[k] !== undefined && x[k] !== null) c.push({ id: k, field: f, value: x[k], ...(AMOUNT.has(k) && x.amount_currency ? { currency: x.amount_currency } : {}) })
  ;(x.lines ?? []).forEach((l, i) => { for (const [k, f] of Object.entries(LINEMAP)) if (l[k] !== undefined && l[k] !== null) c.push({ id: `lines[${i}].${k}`, field: `lines[${i}].${f}`, value: l[k] }) })
  ;(x.vat_breakdown ?? []).forEach((v, i) => { for (const [k, f] of Object.entries(VBDMAP)) if (v[k] !== undefined && v[k] !== null) c.push({ id: `vat_breakdown[${i}].${k}`, field: `vat_breakdown[${i}].${f}`, value: v[k] }) })
  return c
}

const M = JSON.parse(readFileSync('corpus/manifest.json', 'utf8'))
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null
const rows = []
for (const d of M.docs) {
  if (only && d.id !== only) continue
  const t0 = Date.now()
  const pdf = readFileSync(`corpus/pdf/${d.id}.pdf`)
  const ex = await extractPdf(pdf, { workDir: 'tmp' })
  const base = `${O}/extract/${d.id}`
  writeFileSync(`${base}.json`, JSON.stringify({ id: d.id, pdf_sha256: sha(pdf), extractor: EXTRACTOR_VERSION, route: ex.route, rotate: ex.rotate, osd: ex.osd, decimal: ex.decimal, words: ex.words, notes: ex.notes, raw: ex.raw, extraction: ex.extraction }, null, 1))
  writeFileSync(`${base}.extraction.json`, JSON.stringify(ex.extraction, null, 1))
  writeFileSync(`${base}.txt`, ex.text)
  const quotes = Object.entries(ex.raw).map(([k, v]) => ({ id: k, quote: v }))
  writeFileSync(`${base}.quotes.json`, JSON.stringify(quotes))
  const src = ex.text.trim() ? ['--source', `${base}.txt`, ...(quotes.length ? ['--quotes', `${base}.quotes.json`] : [])] : []
  const vS = slim(cli([`${base}.extraction.json`, '--ruleset', SHIPPED, ...src, '--gate']))
  const vX = slim(cli([`${base}.extraction.json`, '--ruleset', SUPP, ...src, '--gate']))
  writeFileSync(`${O}/verdicts/${d.id}.json`, JSON.stringify({ shipped: vS, supplement: vX }, null, 1))
  const op = `${O}/oracle/${d.id}.truth.json`
  writeFileSync(op, JSON.stringify(d.truth_extraction, null, 1))
  const oS = slim(cli([op, '--ruleset', SHIPPED, '--gate']))
  const oX = slim(cli([op, '--ruleset', SUPP, '--gate']))
  writeFileSync(`${O}/oracle/${d.id}.json`, JSON.stringify({ shipped: oS, supplement: oX }, null, 1))
  const claims = twinClaims(ex.extraction)
  writeFileSync(`${O}/twin/${d.id}.claims.json`, JSON.stringify(claims, null, 1))
  const tw = cli(['twin-einvoice', REAL + d.base.file, '--claims', `${O}/twin/${d.id}.claims.json`])
  writeFileSync(`${O}/twin/${d.id}.json`, JSON.stringify({ exit: tw.exit, outcomes: tw.out?.outcomes ?? null, judgments: (tw.out?.judgments ?? []).map(j => ({ id: j.claim_id, field: j.field, value: j.value, outcome: j.outcome, reason: j.reason ?? null })), stderr: tw.stderr }, null, 1))
  rows.push({ id: d.id, route: ex.route, shipped: vS.decision, supplement: vX.decision, oracle_shipped: oS.decision, oracle_supplement: oX.decision, twin: tw.out?.outcomes?.extraction ?? `exit${tw.exit}`, ms: Date.now() - t0 })
  console.log(d.id, ex.route.padEnd(10), 'shipped', vS.decision.padEnd(7), 'supp', vX.decision.padEnd(7), 'oracle', oS.decision.padEnd(7), oX.decision.padEnd(7), 'twin', rows.at(-1).twin, `${rows.at(-1).ms}ms`)
}
const pinsEnd = pins()
const drift = Object.keys(pinsStart).filter(k => pinsStart[k] !== pinsEnd[k])
writeFileSync(`${O}/run-receipt.json`, JSON.stringify({ label: LABEL, finished_at: new Date().toISOString(), node: process.version, pins_start: pinsStart, pins_drift_during_run: drift, rows }, null, 1))
console.log('done', rows.length, 'docs; pin drift during run:', drift.length ? drift : 'none')
