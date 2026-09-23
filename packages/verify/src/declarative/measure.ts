/**
 * Preregistered-accuracy harness — mint a REAL `DeclaredAccuracy` for a declarative ruleset by measuring it against a
 * caller's labeled set. This is the honesty keystone the Index promises: a ruleset's fp/fn/abstain rates are never
 * estimated or asserted — they are computed on a specific labeled set, and the set is hashed into `measured_on` so the
 * claim is bound to exactly what produced it. Attach the result to verdicts (`Verdict.declared_accuracy`) and every new
 * document type (Peppol, and each future national standard) earns its published accuracy the same disciplined way.
 *
 * "Bring your own labeled set": a buyer measures us on THEIR documents; the rates and the set-hash go on the record.
 */

import { verifyDeclarative, type Json } from './evaluate.js'
import type { DeclarativeRuleset } from './types.js'
import { score, type Judgment, type Metrics } from '../bench/score.js'
import type { Label } from '../bench/corpus.js'
import { canonicalize, sha256 } from '../verdict/canonical.js'
import type { DeclaredAccuracy } from '../verdict/schema.js'

/** One labeled example: the extracted document + the ground-truth verdict a human assigned. */
export interface LabeledCase {
  extraction: Json
  /** CLEAN = should PASS; ERROR = should FAIL. Abstentions are scored honestly against neither. */
  label: Label
}

export interface RulesetMeasurement {
  /** The preregistered accuracy object, ready to attach to verdicts. */
  accuracy: DeclaredAccuracy
  /** Full confusion metrics (precision/recall/coverage too), for a report. */
  metrics: Metrics
  /** Per-case label vs judgment, for audit / a drill-down. */
  rows: Array<{ label: Label; judgment: Judgment }>
}

/**
 * Measure a declarative ruleset against a labeled set. Deterministic: the same ruleset + same cases → the same rates
 * AND the same `measured_on` hash. No document text or clock enters the rates.
 */
export function measureRuleset(ruleset: DeclarativeRuleset, cases: readonly LabeledCase[]): RulesetMeasurement {
  const rows = cases.map(c => ({ label: c.label, judgment: verifyDeclarative(c.extraction, ruleset).outcome as Judgment }))
  const metrics = score(rows)
  // Bind the rates to EXACTLY this ruleset version and this labeled set — canonicalized so key order can't change the hash.
  const measured_on = sha256(canonicalize({ ruleset: { id: ruleset.id, version: ruleset.version }, cases }))
  const accuracy: DeclaredAccuracy = {
    domain: ruleset.domain ?? ruleset.id,
    ruleset_version: ruleset.version,
    fp_rate: metrics.fp_rate,
    fn_rate: metrics.fn_rate,
    abstain_rate: metrics.abstain_rate,
    measured_on,
  }
  return { accuracy, metrics, rows }
}

/** Compact, honest render of a measurement for the Index / a ruleset's card. */
export function renderMeasurement(m: RulesetMeasurement): string {
  const pct = (x: number): string => `${(x * 100).toFixed(1)}%`
  const a = m.accuracy
  return [
    `### Declared accuracy — ${a.domain} (ruleset ${a.ruleset_version})`,
    '',
    `> Measured on ${m.metrics.total} labeled cases. Not estimated. Set hash: \`${a.measured_on.slice(0, 16)}…\``,
    '',
    `- False-alarm rate (fp): **${pct(a.fp_rate)}** · missed-error rate (fn): **${pct(a.fn_rate)}** · abstained: **${pct(a.abstain_rate)}**.`,
    `- On the cases it ruled on: precision **${pct(m.metrics.precision)}**, recall **${pct(m.metrics.recall)}**, coverage **${pct(m.metrics.coverage)}**.`,
    '',
  ].join('\n')
}
