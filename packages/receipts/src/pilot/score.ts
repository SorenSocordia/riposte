/**
 * `riposte-pilot score` (2026-10-05): a SYNTHETIC run scored against its truth file. A cold reader in the
 * controller's role (cold review round 2) scored the synthetic month by hand against synthetic-truth.json ("67 planted problems, 0 auto-paid, 0 clean bills
 * stopped"); this does the same count, per planted class, so a new class (the vendor-name-variant duplicate) is scored the
 * moment it exists, whatever the check does with it today.
 *
 * Per class: how many were planted, what a correct check says (the truth file's \`expected\`), and what the gate would have
 * done (pay, hold, person). A planted bill the gate would PAY is the failure that costs money (\`wrong_pay\`). Clean bills the
 * gate would stop (hold or person) are the delay on good bills, and the table says that first, in words (2026-10-05).
 * Only a truth file that says \`synthetic: true\` is scored.
 *
 * THE RUNG (2026-10-05). A class whose truth names \`clear_by\` (the near-match duplicate: the controller) is
 * also scored on who may clear it: for each of its bills, the lowest role a typed remedy lets rule on it (\`authorities\`),
 * and how many sit exactly at the named rung (\`at_clear_by\`). \`as_expected\` counts the bills whose checker decision is
 * one the truth accepts. Pay applications, when the truth has them, are scored the same way per planted error.
 */
import type { PilotManifest, Disposition } from './report.js'
import type { SynthTruth } from './synth.js'

/** The AP roles, lowest first: the rung a remedy's authority sits on. */
export const RUNGS = ['ap-clerk', 'ap-supervisor', 'buyer', 'ap-controller'] as const

export interface ClassScore {
  planted: number; expected: string; pay: number; hold: number; person: number; wrong_pay: number
  /** bills whose checker decision is one the truth accepts (expected, or a listed alternative) */
  as_expected: number
  /** the rung the truth names (absent for most classes), the lowest rung that may clear each bill, and how many are at it */
  clear_by?: string; authorities?: Record<string, number>; at_clear_by?: number
  /** the near-match class, counted apart by kind (typo, abbreviation, dba), with or without its own PO and total */
  kinds?: Record<string, { planted: number; pay: number; hold: number; person: number }>
  /** a gap the check states it has, from the truth file (2026-10-05): a bill the gate would pay here is that gap, disclosed */
  gap?: string
  bills: { ref: string; disposition: Disposition; checker_decision?: string; why?: string; lowest_authority?: string }[]
}
export interface PayAppClassScore { planted: number; expected: 'pay' | 'hold' | 'person'; pay: number; hold: number; person: number; wrong_pay: number; apps: { ref: string; disposition: Disposition; failed: string[] }[] }
export interface SynthScore {
  synthetic: true
  month: string
  seed: number
  bills: number
  classes: Record<string, ClassScore>
  clean: { bills: number; pay: number; hold: number; person: number }
  planted: number
  /** planted bills the gate would have paid automatically */
  wrong_pay: number
  /** clean bills the gate would have stopped (held or sent to a person) */
  clean_stopped: number
  /**
   * The report's first figure, sorted by the truth file (2026-10-05): the bills the synthetic team paid, how many
   * of them the gate would have stopped, and of those how many are planted problems the team paid by mistake (caught) and how
   * many are clean bills (labour); plus the planted problems the team paid that the gate would have paid too.
   */
  paid_by_team: { bills: number; stopped: number; stopped_planted: number; stopped_clean: number; planted_paid_by_both: number }
  /** bills in the truth file the run does not hold, or the reverse (a mismatch means the truth is for another run) */
  unmatched: string[]
  /** pay applications, by planted error ('clean' for none), when the truth has them (2026-10-05) */
  /**
   * `clean_stopped`: good applications (clean, and the legitimate classes, whose right answer is to pay) held or sent to a
   * person; `good`: how many good applications there are (2026-10-06)
   */
  pay_apps?: { classes: Record<string, PayAppClassScore>; wrong_pay: number; clean_stopped: number; good: number; unmatched: string[] }
}

export class ScoreRefused extends Error {
  constructor(message: string) { super(message); this.name = 'ScoreRefused' }
}

const lowestRung = (remedies: { kind: string; authority?: string }[]): string => {
  const roles = remedies.filter((r) => r.kind === 'authority' && r.authority).map((r) => r.authority!)
  if (!roles.length) return 'none'
  const ranked = roles.map((r) => ({ r, i: (RUNGS as readonly string[]).indexOf(r) })).sort((a, b) => (a.i < 0 ? 99 : a.i) - (b.i < 0 ? 99 : b.i))
  return ranked[0]!.r
}

export function scoreSynth(m: PilotManifest, truth: SynthTruth): SynthScore {
  // the run's frozen freight rule (2026-10-05): a freight plant's right answer depends on it; a run that records none read "person"
  const rule: 'person' | 'allow' = m.freight === 'allow' ? 'allow' : 'person'
  // the run's frozen tax rule (2026-10-06), as the flag writes it: a tax plant may carry `by_tax_rule` ({ "person":
  // ..., "allow": ..., "rate:8.25%": ... }), its right answer under each rule; a rule it does not list keeps `expected`
  const taxRule = m.tax ?? 'person'
  type TaxRuled = { by_tax_rule?: Record<string, string> }
  const underTax = <T extends { expected: string }>(t: T): T => { const r = (t as TaxRuled).by_tax_rule?.[taxRule]; return r !== undefined ? { ...t, expected: r } : t }
  if (truth?.synthetic !== true) throw new ScoreRefused('only a synthetic truth file (synthetic: true) is scored: a real month has no truth file')
  if (truth.month !== m.month) throw new ScoreRefused(`the truth file is for ${truth.month}; the run is ${m.month}`)
  const byRef = new Map(m.bills.map((b) => [b.ref, b]))
  const unmatched = [...Object.keys(truth.buyer).filter((ref) => !byRef.has(ref)), ...m.bills.filter((b) => !(b.ref in truth.buyer)).map((b) => b.ref)]
  const classes: Record<string, ClassScore> = {}
  const clean = { bills: 0, pay: 0, hold: 0, person: 0 }
  for (const b of m.bills) {
    const t0 = truth.planted[b.ref]
    if (!t0) { clean.bills++; clean[b.disposition]++; continue }
    const p = underTax(t0.by_freight_rule ? { ...t0, expected: t0.by_freight_rule[rule] } : t0)
    const c = (classes[p.plant] ??= { planted: 0, expected: p.expected, pay: 0, hold: 0, person: 0, wrong_pay: 0, as_expected: 0, ...(p.clear_by ? { clear_by: p.clear_by, authorities: {}, at_clear_by: 0 } : {}), ...(p.gap ? { gap: p.gap } : {}), bills: [] })
    c.planted++
    c[b.disposition]++
    if (b.disposition === 'pay' && p.expected !== 'approve') c.wrong_pay++
    const accepts = p.accepts ?? [p.expected]
    if ((b.checker_decision !== undefined && accepts.includes(b.checker_decision)) || (!b.gated && accepts.includes('not checked'))) c.as_expected++
    if (p.near) {
      const k = `${p.near.kind}${p.near.other_po ? ', other PO and total' : ''}`
      const s = ((c.kinds ??= {})[k] ??= { planted: 0, pay: 0, hold: 0, person: 0 })
      s.planted++
      s[b.disposition]++
    }
    const lowest = p.clear_by ? lowestRung(b.remedies) : undefined
    if (lowest !== undefined) { c.authorities![lowest] = (c.authorities![lowest] ?? 0) + 1; if (lowest === p.clear_by) c.at_clear_by!++ }
    c.bills.push({ ref: b.ref, disposition: b.disposition, ...(b.checker_decision ? { checker_decision: b.checker_decision } : {}), ...(b.why ? { why: b.why } : {}), ...(lowest !== undefined ? { lowest_authority: lowest } : {}) })
  }
  const planted = Object.values(classes).reduce((s, c) => s + c.planted, 0)
  const paidBills = m.bills.filter((b) => b.buyer.decision === 'pay')
  const paidStopped = paidBills.filter((b) => b.disposition !== 'pay')
  // a problem is a planted bill whose right answer is not to pay it (a freight plant under the "allow" rule is a good bill)
  const problem = (ref: string): boolean => { const t = truth.planted[ref]; return Boolean(t) && underTax(t!.by_freight_rule ? { ...t!, expected: t!.by_freight_rule[rule] } : t!).expected !== 'approve' }
  const paid_by_team = {
    bills: paidBills.length, stopped: paidStopped.length,
    stopped_planted: paidStopped.filter((b) => problem(b.ref)).length,
    stopped_clean: paidStopped.filter((b) => !problem(b.ref)).length,
    planted_paid_by_both: paidBills.filter((b) => b.disposition === 'pay' && problem(b.ref)).length,
  }
  let pay_apps: SynthScore['pay_apps']
  if (truth.pay_apps) {
    const apps = new Map((m.pay_apps ?? []).map((a) => [a.ref, a]))
    const pc: Record<string, PayAppClassScore> = {}
    for (const [ref, t] of Object.entries(truth.pay_apps)) {
      const a = apps.get(ref)
      if (!a) continue
      const k = t.plant ?? 'clean'
      const c = (pc[k] ??= { planted: 0, expected: t.expected, pay: 0, hold: 0, person: 0, wrong_pay: 0, apps: [] })
      c.planted++
      c[a.disposition]++
      // 2026-10-06: a legitimate class (a new change-order line, stored materials written as the form says) is expected to pay,
      // so paying it is right; only a class whose right answer is not to pay counts a pay as wrong
      if (t.plant && t.expected !== 'pay' && a.disposition === 'pay') c.wrong_pay++
      c.apps.push({ ref, disposition: a.disposition, failed: a.failed })
    }
    const unmatchedApps = [...Object.keys(truth.pay_apps).filter((r) => !apps.has(r)), ...[...apps.keys()].filter((r) => !(r in truth.pay_apps!))]
    // good applications: the clean ones and the legitimate classes; the labour is any of them held or sent to a person
    const good = Object.values(pc).filter((c) => c.expected === 'pay')
    pay_apps = {
      classes: pc, wrong_pay: Object.values(pc).reduce((s, c) => s + c.wrong_pay, 0),
      clean_stopped: good.reduce((s, c) => s + c.hold + c.person, 0), good: good.reduce((s, c) => s + c.planted, 0), unmatched: unmatchedApps,
    }
  }
  return {
    synthetic: true, month: m.month, seed: truth.seed, bills: m.bills.length, classes, clean, planted,
    wrong_pay: Object.values(classes).reduce((s, c) => s + c.wrong_pay, 0), clean_stopped: clean.hold + clean.person, paid_by_team, unmatched,
    ...(pay_apps ? { pay_apps } : {}),
  }
}

/** The score as a short table for the terminal: the labour cost first, in words. */
export function scoreTable(s: SynthScore): string {
  const L = [`labour: ${s.clean_stopped} of ${s.clean.bills} clean bills would have gone to a person or been held (${s.clean.person} to a person, ${s.clean.hold} held)`]
  // the report's first figure, sorted by the truth file (2026-10-05): one reading of "would have stopped N of the bills your team paid"
  const t = s.paid_by_team
  if (t) {
    const are = (n: number, one: string, many: string): string => `${n} ${n === 1 ? `is ${one}` : `are ${many}`}`
    L.push(`the report's "would have stopped ${t.stopped} of the ${t.bills} bills your team paid", sorted by the truth file: ${are(t.stopped_planted, 'a planted problem', 'planted problems')} the synthetic team paid by mistake (caught), ${are(t.stopped_clean, 'a good bill', 'good bills')} held up (labour)${t.planted_paid_by_both ? `; ${t.planted_paid_by_both} planted problem(s) the team paid would have been paid by the gate too` : ''}`)
  }
  L.push(`synthetic ${s.month}, seed ${s.seed}: ${s.bills} bills, ${s.planted} planted problems; ${s.wrong_pay} planted bill(s) the gate would PAY`)
  // the first column is as wide as the longest name it holds (a class, a near-match kind, a pay-application class), at least 27
  const W = Math.max(27, ...Object.keys(s.classes).map((k) => k.length + 2), ...Object.values(s.classes).flatMap((c) => Object.keys(c.kinds ?? {}).map((k) => k.length + 4)), ...Object.keys(s.pay_apps?.classes ?? {}).map((k) => k.length + 4))
  L.push(`${'class'.padEnd(W)}planted  expected        would pay  hold  person  as expected  may clear it (lowest rung)`)
  for (const [k, c] of Object.entries(s.classes).sort(([a], [b]) => (a < b ? -1 : 1))) {
    const rung = c.clear_by ? `${Object.entries(c.authorities ?? {}).map(([r, n]) => `${r} ${n}`).join(', ')} (want ${c.clear_by}: ${c.at_clear_by})` : ''
    L.push(`${k.padEnd(W)}${String(c.planted).padStart(7)}  ${c.expected.padEnd(15)}${String(c.pay).padStart(9)}${String(c.hold).padStart(6)}${String(c.person).padStart(8)}${String(c.as_expected).padStart(13)}  ${rung}${c.wrong_pay ? (c.gap ? '   <- PAID (a gap the check states, below)' : '   <- PAID') : ''}`)
    for (const [kind, s] of Object.entries(c.kinds ?? {}).sort(([a], [b]) => (a < b ? -1 : 1))) {
      L.push(`  ${kind.padEnd(W - 2)}${String(s.planted).padStart(7)}  ${''.padEnd(15)}${String(s.pay).padStart(9)}${String(s.hold).padStart(6)}${String(s.person).padStart(8)}${s.pay ? '   <- PAID' : ''}`)
    }
  }
  L.push(`${'clean'.padEnd(W)}${String(s.clean.bills).padStart(7)}  ${'approve'.padEnd(15)}${String(s.clean.pay).padStart(9)}${String(s.clean.hold).padStart(6)}${String(s.clean.person).padStart(8)}`)
  for (const [k, c] of Object.entries(s.classes).sort(([a], [b]) => (a < b ? -1 : 1))) if (c.gap) L.push(`a gap the check states, ${k}: ${c.gap}`)
  if (s.unmatched.length) L.push(`unmatched bills (the truth file and the run disagree on ${s.unmatched.length}): ${s.unmatched.slice(0, 5).join(', ')}${s.unmatched.length > 5 ? ', …' : ''}`)
  if (s.pay_apps) {
    const p = s.pay_apps
    const legit = Object.entries(p.classes).filter(([k, c]) => k !== 'clean' && c.expected === 'pay').reduce((n, [, c]) => n + c.planted, 0)
    const goodCount = p.good ?? (p.classes.clean?.planted ?? 0)
    L.push(`pay applications: ${p.clean_stopped} of ${goodCount} good applications${legit ? ` (${p.classes.clean?.planted ?? 0} clean, ${legit} of the legitimate classes)` : ' (clean)'} would have gone to a person or been held; ${p.wrong_pay} planted application(s) the gate would PAY`)
    for (const [k, c] of Object.entries(p.classes).sort(([a], [b]) => (a < b ? -1 : 1))) L.push(`  ${k.padEnd(W - 2)}${String(c.planted).padStart(7)}  ${c.expected.padEnd(15)}${String(c.pay).padStart(9)}${String(c.hold).padStart(6)}${String(c.person).padStart(8)}${c.wrong_pay ? '   <- PAID' : ''}`)
    if (p.unmatched.length) L.push(`  unmatched applications: ${p.unmatched.join(', ')}`)
  }
  return `${L.join('\n')}\n`
}
