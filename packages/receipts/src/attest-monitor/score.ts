/**
 * Scoring a monitor result against a synthetic month's planted truth (the pre-registered test). Per run: the switches found
 * (cause and announced, in order), and the counts of replies from an undeclared model, disagreeing records and bucket
 * shortfalls, and the outcome, each compared with what was planted.
 */
import type { MonitorResult } from './monitor.js'
import type { SynthTruth, Plant } from './synth.js'
import { readCheckOutcome } from '../outcome.js'

export interface RunScore {
  run: string
  plant: Plant
  expected: string
  got: string
  /** every planted switch found, with its cause and announced flag */
  switches_ok: boolean
  /** flags beyond what was planted (on a clean run: every flag) */
  extra_flags: number
  /** the full expectation met: switches, counts and outcome */
  exact: boolean
}
export interface TruthScore {
  seed: number
  runs: RunScore[]
  planted_switches: number
  planted_switches_flagged: number
  planted_disagreements: number
  planted_disagreements_flagged: number
  clean_runs: number
  clean_false_flags: number
  planted_extra_flags: number
  exact_runs: number
}

const sw = (xs: { cause: string; announced: boolean }[]) => xs.map((s) => `${s.cause}${s.announced ? '(announced)' : ''}`).join(',') || 'none'

export function scoreAgainstTruth(result: MonitorResult, truth: SynthTruth): TruthScore {
  const runs: RunScore[] = []
  let ps = 0, psf = 0, pd = 0, pdf = 0, clean = 0, cleanFlags = 0, extra = 0, exact = 0
  for (const t of truth.runs) {
    const r = result.runs.find((x) => x.name === t.run)
    if (!r) throw new Error(`the result has no run ${t.run}`)
    const e = t.expected
    // a planted ABSTAIN (the frozen seeds' word) is the monitor's INSUFFICIENT_DATA
    const eOutcome = readCheckOutcome(e.outcome) ?? e.outcome
    const gotSw = r.switches.map((s) => ({ cause: s.cause, announced: s.announced }))
    const switchesOk = sw(gotSw) === sw(e.switches)
    const expectedFlags = e.switches.filter((s) => !s.announced).length + e.violations + e.contradictions + e.bucket_shortfalls
    const gotFlags = r.flags
    const extraFlags = Math.max(0, gotFlags - expectedFlags) + (switchesOk ? 0 : Math.max(0, gotSw.length - e.switches.length))
    const ok = switchesOk && r.violations.length === e.violations && r.contradictions.length === e.contradictions && r.bucket_shortfalls.length === e.bucket_shortfalls && r.outcome === eOutcome
    runs.push({
      run: t.run, plant: t.plant,
      expected: `${sw(e.switches)} · not-declared ${e.violations} · disagree ${e.contradictions} · shortfall ${e.bucket_shortfalls} · ${eOutcome}`,
      got: `${sw(gotSw)} · not-declared ${r.violations.length} · disagree ${r.contradictions.length} · shortfall ${r.bucket_shortfalls.length} · ${r.outcome}`,
      switches_ok: switchesOk, extra_flags: extraFlags, exact: ok,
    })
    ps += e.switches.length
    psf += e.switches.filter((s, i) => gotSw[i] && gotSw[i]!.cause === s.cause && gotSw[i]!.announced === s.announced).length
    pd += e.contradictions + e.bucket_shortfalls
    pdf += Math.min(e.contradictions, r.contradictions.length) + Math.min(e.bucket_shortfalls, r.bucket_shortfalls.length)
    if (t.plant === 'clean') { clean++; cleanFlags += gotFlags } else extra += extraFlags
    if (ok) exact++
  }
  return { seed: truth.seed, runs, planted_switches: ps, planted_switches_flagged: psf, planted_disagreements: pd, planted_disagreements_flagged: pdf, clean_runs: clean, clean_false_flags: cleanFlags, planted_extra_flags: extra, exact_runs: exact }
}
