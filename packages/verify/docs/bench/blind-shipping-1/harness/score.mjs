// blind-shipping-1 (PREREG.md sections 5, 7, 9): the one scoring script. It reads the engine outputs and the labels and
// prints every count of section 5 and every verdict of section 7, and nothing else.
//
//   node harness/score.mjs [--results results] [--json] [--restart einvoice,legal]
//
// Inputs, each optional (an arm whose files are absent reads DID NOT RUN):
//   einvoice/engine/engine-einvoice.json, einvoice/labels.json, einvoice/planted/planted-manifest.json
//   legal/engine/engine-legal.json, legal/labels/*.json, legal/planted/planted.json
//   ap/ap-scoring.json   { bills: [{ id, decision: "pay"|"hold"|"person" }],
//                          audit: { hold: [{ id, label: "confirmed"|"not confirmed"|"undecided" }],
//                                   pay:  [{ id, label: "bad"|"good"|"undecided" }] },
//                          seeded: [{ id, operator, in_claim: true|false, decision: "pay"|"hold"|"person" }] }
//                        written from the pilot tool's run and the labeller's audit sheet by the AP part of the harness,
//                        which waits for a partner's header row (AP-ARM.md).
// An answer is PASS, FAIL or CANT_TELL (PASS-WITH-OPEN, INSUFFICIENT_DATA, a person decides, or an exit 3 refusal, which is
// listed). A label left undecided joins no denominator (section 10).
import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { args, barVerdict, readJson, RUN_DIR } from './lib.mjs'

export const BARS = [
  { id: 'P1', arm: 'AP', measure: 'miss_rate', kind: 'low', bar: 0.05, size: 150, primary: true },
  { id: 'P2', arm: 'AP', measure: 'seeded approvals (in claim)', kind: 'low', bar: 0.10, size: 40, primary: true },
  { id: 'P3', arm: 'e-invoice', measure: 'miss on invalid files, 0.3.0', kind: 'low', bar: 0.10, size: 40, primary: true },
  { id: 'P4', arm: 'legal', measure: 'miss on planted and not-faithful quotations', kind: 'low', bar: 0.10, size: 40, primary: true },
  { id: 'S1', arm: 'AP', measure: 'hold_precision', kind: 'high', bar: 0.80, size: 60 },
  { id: 'S2', arm: 'AP', measure: 'person share', kind: 'low', bar: 0.50, size: 200 },
  { id: 'S3', arm: 'e-invoice', measure: 'false FAIL on valid files, 0.3.0', kind: 'low', bar: 0.10, size: 40 },
  { id: 'S4', arm: 'e-invoice', measure: "can't tell on valid files, 0.3.0", kind: 'low', bar: 0.50, size: 40 },
  { id: 'S5', arm: 'legal', measure: 'false FAIL on genuine quotations', kind: 'low', bar: 0.05, size: 200 },
  { id: 'S6', arm: 'legal', measure: "can't tell on genuine quotations", kind: 'low', bar: 0.50, size: 200 },
]
const DESCRIPTIVE_020 = [
  { id: 'P3 (0.2.0)', measure: 'miss on invalid files, 0.2.0', kind: 'low', bar: 0.10, size: 40 },
  { id: 'S3 (0.2.0)', measure: 'false FAIL on valid files, 0.2.0', kind: 'low', bar: 0.10, size: 40 },
  { id: 'S4 (0.2.0)', measure: "can't tell on valid files, 0.2.0", kind: 'low', bar: 0.50, size: 40 },
]
const count = (xs, f) => xs.filter(f).length

/** Section 5's e-invoice counts for one ruleset version. */
export function einvoiceCounts({ engine, labels, planted }, version) {
  const rows = engine.rows.filter(r => r.ruleset === `peppol-en16931@${version}`)
  for (const r of rows) if (r.ruleset_named && r.ruleset_named !== r.ruleset) throw new Error(`${r.key}: the verdict names ${r.ruleset_named}, the row ${r.ruleset}`)
  const lab = new Map(labels.files.map(f => [f.key, f]))
  const pl = new Map(planted.kept.map(p => [p.key, p]))
  const valid = [], invalid = [], undecided = []
  for (const r of rows) {
    const l = r.kind === 'planted' ? pl.get(r.key)?.labels : lab.get(r.key)
    if (!l) throw new Error(`${r.key}: no label`)
    if (!l.decided) { undecided.push(r.key); continue }
    ;(l.valid[version] ? valid : invalid).push({ r, l })
  }
  const wrong = invalid.filter(({ r, l }) => r.answer === 'FAIL' && (r.fail_codes.length > r.fail_rules.length || r.fail_rules.some(id => l.fires[id] !== true)))
    .map(({ r, l }) => ({ key: r.key, id: r.id, named: r.fail_rules, fired: Object.keys(l.fires).filter(k => l.fires[k]), names_no_rule: r.fail_codes.length > r.fail_rules.length }))
  return {
    valid: { n: valid.length, false_fail: count(valid, x => x.r.answer === 'FAIL'), cant_tell: count(valid, x => x.r.answer === 'CANT_TELL'), pass: count(valid, x => x.r.answer === 'PASS') },
    invalid: { n: invalid.length, natural: count(invalid, x => x.r.kind === 'natural'), planted: count(invalid, x => x.r.kind === 'planted'), miss: count(invalid, x => x.r.answer === 'PASS'), fail: count(invalid, x => x.r.answer === 'FAIL'), cant_tell: count(invalid, x => x.r.answer === 'CANT_TELL') },
    wrong_reason: wrong,
    refused: rows.filter(r => r.refused).map(r => r.key),
    unlabelled: undecided,
  }
}

/** Section 5's legal counts. */
export function legalCounts({ engine, labels, planted }) {
  const lab = new Map(labels.map(l => [String(l.id), l.label]))
  const plantedKeys = new Set(planted.map(p => String(p.key)))
  const genuine = [], bad = [], undecided = [], notFaithful = []
  for (const r of engine.rows) {
    if (r.kind === 'planted') { if (!plantedKeys.has(r.id)) throw new Error(`${r.id}: not in the planted set`); bad.push(r); continue }
    const l = lab.get(r.id)
    if (l === 'genuine') genuine.push(r)
    else if (l === 'not faithful') { bad.push(r); notFaithful.push(r.id) }
    else if (l === 'undecided') undecided.push(r.id)
    else throw new Error(`${r.id}: no label`)
  }
  return {
    genuine: { n: genuine.length, false_fail: count(genuine, r => r.answer === 'FAIL'), cant_tell: count(genuine, r => r.answer === 'CANT_TELL'), pass: count(genuine, r => r.answer === 'PASS') },
    planted_and_not_faithful: { n: bad.length, planted: count(bad, r => r.kind === 'planted'), not_faithful: notFaithful.length, miss: count(bad, r => r.answer === 'PASS'), fail: count(bad, r => r.answer === 'FAIL'), cant_tell: count(bad, r => r.answer === 'CANT_TELL') },
    not_faithful_natural: notFaithful,
    refused: engine.rows.filter(r => r.refused).map(r => r.id),
    unlabelled: undecided,
  }
}

/** Section 5's AP counts. */
export function apCounts(ap) {
  const hold = ap.audit.hold.filter(x => x.label !== 'undecided'), pay = ap.audit.pay.filter(x => x.label !== 'undecided')
  const inClaim = ap.seeded.filter(s => s.in_claim === true)
  return {
    hold_precision: { k: count(hold, x => x.label === 'confirmed'), n: hold.length },
    miss_rate: { k: count(pay, x => x.label === 'bad'), n: pay.length },
    person_share: { k: count(ap.bills, b => b.decision === 'person'), n: ap.bills.length },
    seeded_approvals: { k: count(inClaim, s => s.decision === 'pay'), n: inClaim.length },
    unlabelled: [...ap.audit.hold, ...ap.audit.pay].filter(x => x.label === 'undecided').map(x => x.id),
  }
}

/** Every count and verdict, from loaded inputs (an arm is null when it did not run). */
export function score({ einvoice = null, legal = null, ap = null }) {
  const e3 = einvoice ? einvoiceCounts(einvoice, '0.3.0') : null
  const e2 = einvoice ? einvoiceCounts(einvoice, '0.2.0') : null
  const lg = legal ? legalCounts(legal) : null
  const a = ap ? apCounts(ap) : null
  const kn = {
    P1: a ? [a.miss_rate.k, a.miss_rate.n] : null,
    P2: a ? [a.seeded_approvals.k, a.seeded_approvals.n] : null,
    P3: e3 ? [e3.invalid.miss, e3.invalid.n] : null,
    P4: lg ? [lg.planted_and_not_faithful.miss, lg.planted_and_not_faithful.n] : null,
    S1: a ? [a.hold_precision.k, a.hold_precision.n] : null,
    S2: a ? [a.person_share.k, a.person_share.n] : null,
    S3: e3 ? [e3.valid.false_fail, e3.valid.n] : null,
    S4: e3 ? [e3.valid.cant_tell, e3.valid.n] : null,
    S5: lg ? [lg.genuine.false_fail, lg.genuine.n] : null,
    S6: lg ? [lg.genuine.cant_tell, lg.genuine.n] : null,
    'P3 (0.2.0)': e2 ? [e2.invalid.miss, e2.invalid.n] : null,
    'S3 (0.2.0)': e2 ? [e2.valid.false_fail, e2.valid.n] : null,
    'S4 (0.2.0)': e2 ? [e2.valid.cant_tell, e2.valid.n] : null,
  }
  const verdict = (b) => ({ ...b, ...barVerdict({ k: kn[b.id]?.[0] ?? null, n: kn[b.id]?.[1] ?? null, bar: b.bar, kind: b.kind, size: b.size }) })
  const bars = BARS.map(verdict)
  const descriptive = DESCRIPTIVE_020.map(verdict)
  const primary = bars.filter(b => b.primary)
  const run = primary.every(b => b.verdict === 'PASS') ? 'PASS' : 'NOT PASSED'
  return { counts: { ap: a, einvoice: einvoice ? { '0.3.0': e3, '0.2.0': e2 } : null, legal: lg }, bars, descriptive, run, run_because: primary.filter(b => b.verdict !== 'PASS').map(b => `${b.id} ${b.verdict}`) }
}

const f3 = (x) => (x === undefined ? '' : x.toFixed(4))
export function format(s) {
  const L = []
  const c = s.counts
  L.push('SECTION 5: COUNTS')
  if (c.ap) {
    L.push(`AP  hold_precision ${c.ap.hold_precision.k}/${c.ap.hold_precision.n} · miss_rate ${c.ap.miss_rate.k}/${c.ap.miss_rate.n} · person share ${c.ap.person_share.k}/${c.ap.person_share.n} · seeded approvals (in claim) ${c.ap.seeded_approvals.k}/${c.ap.seeded_approvals.n}`)
    if (c.ap.unlabelled.length) L.push(`AP  left undecided (in no denominator): ${c.ap.unlabelled.join(', ')}`)
  } else L.push('AP  DID NOT RUN')
  if (c.einvoice) for (const v of ['0.3.0', '0.2.0']) {
    const e = c.einvoice[v]
    L.push(`e-invoice peppol-en16931@${v}  valid files ${e.valid.n}: false FAIL ${e.valid.false_fail}, can't tell ${e.valid.cant_tell} · invalid files ${e.invalid.n} (natural ${e.invalid.natural}, planted ${e.invalid.planted}): miss ${e.invalid.miss}`)
    L.push(`e-invoice peppol-en16931@${v}  wrong reason ${e.wrong_reason.length}${e.wrong_reason.length ? ': ' + e.wrong_reason.map(w => `${w.key} names ${w.named.join('+') || 'no rule'}${w.names_no_rule ? ' (a check that cites no rule)' : ''}, validators fired ${w.fired.join('+') || 'none'}`).join('; ') : ''}`)
    if (e.refused.length) L.push(`e-invoice peppol-en16931@${v}  refused (exit 3, counted can't tell): ${e.refused.join(', ')}`)
    if (e.unlabelled.length) L.push(`e-invoice  left unlabelled (in no denominator): ${e.unlabelled.join(', ')}`)
  } else L.push('e-invoice  DID NOT RUN')
  if (c.legal) {
    const g = c.legal
    L.push(`legal  genuine ${g.genuine.n}: false FAIL ${g.genuine.false_fail}, can't tell ${g.genuine.cant_tell} · planted and not faithful ${g.planted_and_not_faithful.n} (planted ${g.planted_and_not_faithful.planted}, not faithful ${g.planted_and_not_faithful.not_faithful}): miss ${g.planted_and_not_faithful.miss}`)
    if (g.not_faithful_natural.length) L.push(`legal  natural quotations not faithful: ${g.not_faithful_natural.join(', ')}`)
    if (g.refused.length) L.push(`legal  refused (exit 3, counted can't tell): ${g.refused.join(', ')}`)
    if (g.unlabelled.length) L.push(`legal  left undecided (in no denominator): ${g.unlabelled.join(', ')}`)
  } else L.push('legal  DID NOT RUN')
  L.push('', 'SECTION 7: VERDICTS (Clopper-Pearson, 95%, two-sided)')
  for (const b of [...s.bars, ...s.descriptive]) L.push(`${b.id.padEnd(11)} ${b.verdict.padEnd(12)} ${b.measure}: ${b.k ?? '-'}/${b.n ?? '-'}  [${f3(b.lower)}, ${f3(b.upper)}]  bar ${b.kind === 'low' ? 'upper <=' : 'lower >='} ${b.bar}, size ${b.size}${b.primary ? '' : b.id.includes('0.2.0') ? ' (descriptive)' : ''}`)
  L.push('', `RUN: ${s.run}${s.run_because.length ? ` (${s.run_because.join(', ')})` : ''}`)
  return L.join('\n')
}

/** Load whatever arms exist under a results folder. */
export function load(results, { restart = [] } = {}) {
  const eng = (arm) => join(results, arm, restart.includes(arm) ? 'engine-restart' : 'engine')
  const E = join(results, 'einvoice'), G = join(results, 'legal'), A = join(results, 'ap', 'ap-scoring.json')
  const einvoice = existsSync(join(eng('einvoice'), 'engine-einvoice.json'))
    ? { engine: readJson(join(eng('einvoice'), 'engine-einvoice.json')), labels: readJson(join(E, 'labels.json')), planted: readJson(join(E, 'planted', 'planted-manifest.json')) } : null
  const legal = existsSync(join(eng('legal'), 'engine-legal.json'))
    ? { engine: readJson(join(eng('legal'), 'engine-legal.json')), labels: readdirSync(join(G, 'labels')).filter(f => f.endsWith('.json')).sort().flatMap(f => readJson(join(G, 'labels', f))), planted: readJson(join(G, 'planted', 'planted.json')) } : null
  const ap = existsSync(A) ? readJson(A) : null
  return { einvoice, legal, ap }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const a = args(process.argv.slice(2), { flags: ['json'] })
  const s = score(load(resolve(a.results ?? join(RUN_DIR, 'results')), { restart: (a.restart ?? '').split(',').filter(Boolean) }))
  console.log(a.json ? JSON.stringify(s, null, 1) : format(s))
}
