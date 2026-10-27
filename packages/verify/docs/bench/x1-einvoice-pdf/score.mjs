// X1 scoring. Definitions are the prereg's (PREREG.md §3); this file is hashed into it.
import { readFileSync, writeFileSync } from 'node:fs'
import { compareExtraction } from './lib/compare.mjs'

const LABEL = process.argv[2] ?? 'run1'
const O = `out/${LABEL}`
const M = JSON.parse(readFileSync('corpus/manifest.json', 'utf8'))
const J = (p) => JSON.parse(readFileSync(p, 'utf8'))

// Wilson 95% interval
function wilson(k, n) {
  if (!n) return [null, null]
  const z = 1.959964, p = k / n, d = 1 + z * z / n
  const c = (p + z * z / (2 * n)) / d, h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d
  return [Math.max(0, c - h), Math.min(1, c + h)]
}
const pct = (x) => (x === null ? 'n/a' : (100 * x).toFixed(1) + '%')
const rate = (k, n) => { const [lo, hi] = wilson(k, n); return { k, n, rate: n ? k / n : null, ci95: [lo, hi], text: `${k}/${n} = ${n ? pct(k / n) : 'n/a'} [${pct(lo)}, ${pct(hi)}]` } }

// fields the SHIPPED ruleset reads; the supplement adds the identifiers, currency, and VAT breakdown tax amounts
const SHIPPED_DOC = new Set(['line_extension_amount', 'allowance_total_amount', 'charge_total_amount', 'tax_exclusive_amount', 'tax_amount', 'tax_inclusive_amount', 'prepaid_amount', 'payable_rounding_amount', 'payable_amount'])
const SHIPPED_LINE = /^lines\[\d+\]\.(invoiced_quantity|price_amount|base_quantity|line_extension_amount|line_allowance_amount|line_charge_amount)$/
const SUPP_EXTRA = (f) => ['invoice_number', 'issue_date', 'currency', 'amount_currency'].includes(f) || /^vat_breakdown\[\d+\]\.tax_amount$/.test(f)
const DEFAULTED = (f) => ['allowance_total_amount', 'charge_total_amount', 'prepaid_amount', 'payable_rounding_amount'].includes(f) || /\.base_quantity$/.test(f)
const relevant = (f, set) => SHIPPED_DOC.has(f) || SHIPPED_LINE.test(f) || (set === 'combined' && SUPP_EXTRA(f))
// a field is WRONG for the wrong-PASS test if its value differs, or it was invented, or it is missing where the ruleset
// would silently substitute a default that differs from the truth
const isWrong = (r) => r.status === 'wrong' || r.status === 'extra' || (r.status === 'missing' && DEFAULTED(r.field) && Number(r.truth) !== (/base_quantity/.test(r.field) ? 1 : 0))
const combine = (a, b) => (a === 'ERROR' || b === 'ERROR' ? 'ERROR' : a === 'FAIL' || b === 'FAIL' ? 'FAIL' : a === 'ABSTAIN' || b === 'ABSTAIN' ? 'ABSTAIN' : 'PASS')
const getPath = (o, p) => p.split(/\.|\[|\]/).filter(Boolean).reduce((x, k) => (x === undefined || x === null ? undefined : x[k]), o)

const docs = []
for (const d of M.docs) {
  const ex = J(`${O}/extract/${d.id}.json`), v = J(`${O}/verdicts/${d.id}.json`), o = J(`${O}/oracle/${d.id}.json`), tw = J(`${O}/twin/${d.id}.json`)
  const cmp = compareExtraction(d.truth_extraction, ex.extraction)
  const dec = { shipped: v.shipped.decision, combined: combine(v.shipped.decision, v.supplement.decision) }
  const raw = { shipped: v.shipped.outcome, combined: v.shipped.outcome === 'FAIL' || v.supplement.outcome === 'FAIL' ? 'FAIL' : (v.shipped.outcome === 'PASS' && v.supplement.outcome === 'PASS') ? 'PASS' : 'INSUFFICIENT_DATA' }
  const odec = { shipped: o.shipped.decision, combined: combine(o.shipped.decision, o.supplement.decision) }
  const row = { id: d.id, arm: d.arm, kind: d.arm === 'noise' ? d.noise_kind : d.arm === 'defect' ? d.defect.type : 'clean', route: ex.route, fmt: d.fmt, base: d.base.file.split('/').pop(), decision: dec, raw, oracle: odec, fields: cmp.counts, notes: ex.notes }
  for (const set of ['shipped', 'combined']) {
    const wrongRel = cmp.rows.filter(r => relevant(r.field, set) && isWrong(r))
    row[`wrong_fields_${set}`] = wrongRel.map(r => `${r.field}: ${JSON.stringify(r.truth)} -> ${JSON.stringify(r.got)} (${r.status})`)
    const D = dec[set], OD = odec[set]
    let cls
    if (d.arm === 'defect') cls = D === 'FAIL' ? 'caught' : D === 'ABSTAIN' ? 'abstain' : D === 'PASS' ? 'WRONG_PASS' : 'error'
    else cls = D === 'PASS' ? (wrongRel.length || OD !== 'PASS' ? 'WRONG_PASS' : 'correct_pass') : D === 'FAIL' ? (OD === 'PASS' ? 'false_fail' : 'fail_oracle_agrees') : D === 'ABSTAIN' ? 'abstain' : 'error'
    row[`class_${set}`] = cls
    if (d.arm === 'defect' && cls === 'WRONG_PASS') row[`wrong_pass_cause_${set}`] = OD === 'PASS' ? 'ruleset gap (perfect extraction also PASSes)' : 'extraction error (perfect extraction would not PASS)'
    // the raw (non-gate) reading: PASS-WITH-OPEN read as PASS
    const R = raw[set]
    row[`raw_wrong_pass_${set}`] = d.arm === 'defect' ? R === 'PASS' : (R === 'PASS' && (wrongRel.length > 0 || OD !== 'PASS'))
  }
  row.failing_claims = { shipped: v.shipped.claims.filter(c => c.outcome === 'FAIL').map(c => c.id), supplement: v.supplement.claims.filter(c => c.outcome === 'FAIL').map(c => c.id) }
  row.open_claims = { shipped: v.shipped.claims.filter(c => c.outcome === 'INSUFFICIENT_DATA').map(c => `${c.id}(${c.reason})`), supplement: v.supplement.claims.filter(c => c.outcome === 'INSUFFICIENT_DATA').map(c => `${c.id}(${c.reason})`) }
  // twin: per-claim correctness vs the printed truth
  const tclaims = []
  for (const j of tw.judgments) {
    const t = getPath(d.truth_extraction, j.id)
    const correct = t !== undefined && t !== null && (typeof t === 'number' ? Math.abs(t - j.value) < 1e-9 : String(t) === String(j.value))
    tclaims.push({ id: j.id, value: j.value, truth: t ?? null, correct, outcome: j.outcome, reason: j.reason })
  }
  row.twin = { exit: tw.exit, outcomes: tw.outcomes, claims: tclaims }
  if (d.arm === 'defect') {
    const f = d.defect.field
    const tj = tclaims.find(c => c.id === f)
    row.defect = { ...d.defect, extracted: getPath(ex.extraction, f) ?? null, twin_on_defect_field: tj ? tj.outcome : 'no claim (field absent from the extraction)' }
  }
  docs.push(row)
}

const R = { label: LABEL, n: docs.length, by_set: {} }
for (const set of ['shipped', 'combined']) {
  const S = {}
  const arm = (a) => docs.filter(r => r.arm === a)
  const count = (rs, c) => rs.filter(r => r[`class_${set}`] === c).length
  const D = arm('defect'), C = arm('clean'), N = arm('noise')
  S.defect = { caught: rate(count(D, 'caught'), D.length), abstain: rate(count(D, 'abstain'), D.length), wrong_pass: rate(count(D, 'WRONG_PASS'), D.length),
    by_type: Object.fromEntries(['line_math', 'vat_subtotal', 'payable', 'currency', 'missing'].map(t => [t, Object.fromEntries(['caught', 'abstain', 'WRONG_PASS'].map(c => [c, D.filter(r => r.kind === t && r[`class_${set}`] === c).length]))])),
    wrong_passes: D.filter(r => r[`class_${set}`] === 'WRONG_PASS').map(r => ({ id: r.id, type: r.kind, field: r.defect.field, cause: r[`wrong_pass_cause_${set}`] })) }
  for (const [name, rs] of [['clean', C], ['noise', N]]) {
    S[name] = { correct_pass: rate(count(rs, 'correct_pass'), rs.length), wrong_pass: rate(count(rs, 'WRONG_PASS'), rs.length), false_fail: rate(count(rs, 'false_fail'), rs.length),
      abstain: rate(count(rs, 'abstain'), rs.length), coverage: rate(rs.filter(r => ['PASS', 'FAIL'].includes(r.decision[set])).length, rs.length),
      wrong_passes: rs.filter(r => r[`class_${set}`] === 'WRONG_PASS').map(r => ({ id: r.id, kind: r.kind, wrong: r[`wrong_fields_${set}`] })) }
  }
  S.noise_by_kind = Object.fromEntries(['two_column', 'stamp', 'lowres', 'rotated'].map(k => { const rs = N.filter(r => r.kind === k); return [k, Object.fromEntries(['correct_pass', 'WRONG_PASS', 'false_fail', 'abstain'].map(c => [c, count(rs, c)]))] }))
  const fails = docs.filter(r => r.decision[set] === 'FAIL')
  S.fail_precision = rate(fails.filter(r => r.arm === 'defect').length, fails.length)
  S.coverage_all = rate(docs.filter(r => ['PASS', 'FAIL'].includes(r.decision[set])).length, docs.length)
  S.raw_reading_wrong_pass = { defect: D.filter(r => r[`raw_wrong_pass_${set}`]).length, clean: C.filter(r => r[`raw_wrong_pass_${set}`]).length, noise: N.filter(r => r[`raw_wrong_pass_${set}`]).length }
  S.oracle = { defect_not_pass: D.filter(r => r.oracle[set] !== 'PASS').length, clean_pass: C.filter(r => r.oracle[set] === 'PASS').length, noise_pass: N.filter(r => r.oracle[set] === 'PASS').length }
  R.by_set[set] = S
}
// field-level extraction accuracy
R.fields = {}
for (const a of ['clean', 'defect', 'noise']) {
  const rs = docs.filter(r => r.arm === a)
  R.fields[a] = rs.reduce((t, r) => { for (const k in r.fields) t[k] = (t[k] ?? 0) + r.fields[k]; return t }, {})
}
R.fields_by_noise = Object.fromEntries(['two_column', 'stamp', 'lowres', 'rotated'].map(k => [k, docs.filter(r => r.kind === k).reduce((t, r) => { for (const x in r.fields) t[x] = (t[x] ?? 0) + r.fields[x]; return t }, {})]))
// twin (clean + noise): false FAILs on correct claims, catch on wrong claims
const tw = docs.filter(r => r.arm !== 'defect').flatMap(r => r.twin.claims)
const corr = tw.filter(c => c.correct), wr = tw.filter(c => !c.correct)
R.twin = { claims: tw.length, correct_claims: corr.length, false_fail_on_correct: rate(corr.filter(c => c.outcome === 'FAIL').length, corr.length), abstain_on_correct: rate(corr.filter(c => c.outcome === 'ABSTAIN').length, corr.length),
  wrong_claims: wr.length, caught_wrong: rate(wr.filter(c => c.outcome === 'FAIL').length, wr.length), wrong_claims_passed: wr.filter(c => c.outcome === 'PASS').map(c => c.id), false_fails: docs.filter(r => r.arm !== 'defect').flatMap(r => r.twin.claims.filter(c => c.correct && c.outcome === 'FAIL').map(c => `${r.id} ${c.id} ${c.reason}`)),
  defect_field_flagged: docs.filter(r => r.arm === 'defect').map(r => ({ id: r.id, type: r.kind, field: r.defect.field, twin: r.defect.twin_on_defect_field })) }
R.docs = docs
writeFileSync(`${O}/results.json`, JSON.stringify(R, null, 1))
for (const set of ['shipped', 'combined']) {
  const S = R.by_set[set]
  console.log(`\n== ${set} ==`)
  console.log('defect  caught', S.defect.caught.text, '| abstain', S.defect.abstain.text, '| WRONG PASS', S.defect.wrong_pass.text)
  console.log('        by type', JSON.stringify(S.defect.by_type))
  for (const w of S.defect.wrong_passes) console.log('        wrong PASS', w.id, w.type, w.field, '->', w.cause)
  for (const a of ['clean', 'noise']) console.log(`${a.padEnd(7)} correct PASS ${S[a].correct_pass.text} | WRONG PASS ${S[a].wrong_pass.text} | false FAIL ${S[a].false_fail.text} | abstain ${S[a].abstain.text} | coverage ${S[a].coverage.text}`)
  console.log('        noise by kind', JSON.stringify(S.noise_by_kind))
  for (const a of ['clean', 'noise']) for (const w of S[a].wrong_passes) console.log('        wrong PASS', w.id, w.kind, w.wrong.join('; '))
  console.log('FAIL precision', S.fail_precision.text, '| coverage all', S.coverage_all.text, '| raw-reading wrong PASS', JSON.stringify(S.raw_reading_wrong_pass), '| oracle', JSON.stringify(S.oracle))
}
console.log('\nfields', JSON.stringify(R.fields), '\nby noise', JSON.stringify(R.fields_by_noise))
console.log('twin false FAIL on correct', R.twin.false_fail_on_correct.text, '| caught wrong', R.twin.caught_wrong.text, '| abstain on correct', R.twin.abstain_on_correct.text)
for (const f of R.twin.false_fails) console.log('   twin false FAIL', f)
console.log('twin on defect field', R.twin.defect_field_flagged.map(x => `${x.id}:${x.twin}`).join(' '))
