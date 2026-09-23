/**
 * Scoring for the Verification Index. A system's answer (PASS / FAIL / INSUFFICIENT_DATA) is scored against the case's
 * ground-truth label (CLEAN / ERROR):
 *
 *              label ERROR        label CLEAN
 *   FAIL       TP (caught it)     FP (false alarm)
 *   PASS       FN (missed it)     TN (correct clear)
 *   ABSTAIN    abstain            abstain           (honest "can't tell" — never counted as a hit or a miss)
 *
 * The three headline rates:
 *   fp_rate  = FP / (FP + TN)     — of the CLEAN documents it did rule on, how often it false-alarmed
 *   fn_rate  = FN / (FN + TP)     — of the ERROR documents it did rule on, how often it missed
 *   abstain_rate = ABSTAIN / total
 * Plus precision = TP/(TP+FP) and recall = TP/(TP+FN) on the covered (non-abstain) set. Abstention is reported, never
 * hidden inside a pass or a fail — that honesty is the product.
 */

import type { Label } from './corpus.js'

export type Judgment = 'PASS' | 'FAIL' | 'INSUFFICIENT_DATA'

export interface Confusion { tp: number; tn: number; fp: number; fn: number; abstain: number; total: number }

export interface Metrics extends Confusion {
  fp_rate: number
  fn_rate: number
  abstain_rate: number
  precision: number
  recall: number
  /** covered = ruled on (not abstained). */
  coverage: number
}

const div = (a: number, b: number): number => (b === 0 ? 0 : a / b)

export function bucket(label: Label, j: Judgment): keyof Confusion {
  if (j === 'INSUFFICIENT_DATA') return 'abstain'
  if (label === 'ERROR') return j === 'FAIL' ? 'tp' : 'fn'
  return j === 'FAIL' ? 'fp' : 'tn'
}

export function score(rows: ReadonlyArray<{ label: Label; judgment: Judgment }>): Metrics {
  const c: Confusion = { tp: 0, tn: 0, fp: 0, fn: 0, abstain: 0, total: rows.length }
  for (const r of rows) c[bucket(r.label, r.judgment)]++
  const covered = c.tp + c.tn + c.fp + c.fn
  return {
    ...c,
    fp_rate: div(c.fp, c.fp + c.tn),
    fn_rate: div(c.fn, c.fn + c.tp),
    abstain_rate: div(c.abstain, c.total),
    precision: div(c.tp, c.tp + c.fp),
    recall: div(c.tp, c.tp + c.fn),
    coverage: div(covered, c.total),
  }
}

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`

/** One row of the Index table for a system. */
export function metricsLine(name: string, m: Metrics): string {
  return `| ${name} | ${pct(m.fp_rate)} | ${pct(m.fn_rate)} | ${pct(m.abstain_rate)} | ${pct(m.precision)} | ${pct(m.recall)} | ${m.total} |`
}
