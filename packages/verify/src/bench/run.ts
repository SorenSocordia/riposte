/**
 * The Index runner. Runs the deterministic verifier and each baseline over the labeled corpus, scores them, and renders
 * the Verification Index as Markdown. Deterministic given deterministic baselines (the verifier is always deterministic).
 */

import { verify } from '../index.js'
import { ENGINE_VERSION } from '../version.js'
import { CORPUS, type Label, type LabeledCase } from './corpus.js'
import { score, metricsLine, type Judgment, type Metrics } from './score.js'
import type { Baseline } from './baselines.js'
import type { LedgerStats } from '../ledger/types.js'

export interface SystemResult { name: string; metrics: Metrics; rows: { name: string; label: Label; judgment: Judgment }[] }
export interface IndexReport { engine_version: string; total: number; generated_from: 'synthetic-v0' | 'held-out'; systems: SystemResult[] }

/** The deterministic verifier's judgment on a case is simply its verdict outcome. */
export function verifierJudgment(c: LabeledCase): Judgment {
  return verify(c.extraction, c.options ?? {}).outcome
}

export function runVerifier(corpus: LabeledCase[] = CORPUS): SystemResult {
  const rows = corpus.map(c => ({ name: c.name, label: c.label, judgment: verifierJudgment(c) }))
  return { name: `verify (deterministic) v${ENGINE_VERSION}`, metrics: score(rows), rows }
}

export async function runBaseline(baseline: Baseline, corpus: LabeledCase[] = CORPUS): Promise<SystemResult> {
  const rows: { name: string; label: Label; judgment: Judgment }[] = []
  for (const c of corpus) rows.push({ name: c.name, label: c.label, judgment: await baseline.judge(c) })
  return { name: baseline.name, metrics: score(rows), rows }
}

export async function buildReport(baselines: Baseline[] = [], corpus: LabeledCase[] = CORPUS, generated_from: IndexReport['generated_from'] = 'synthetic-v0'): Promise<IndexReport> {
  const systems: SystemResult[] = [runVerifier(corpus)]
  for (const b of baselines) systems.push(await runBaseline(b, corpus))
  return { engine_version: ENGINE_VERSION, total: corpus.length, generated_from, systems }
}

export function renderMarkdown(report: IndexReport): string {
  const lines: string[] = []
  lines.push('# Verification Index')
  lines.push('')
  lines.push('> We publish how often we are wrong. This is measured, not asserted. A system that never abstains but false-alarms is worse than one that abstains honestly — so all three rates are shown, and abstention is never hidden inside a pass or a fail.')
  lines.push('')
  lines.push(report.generated_from === 'synthetic-v0'
    ? `**Corpus: synthetic v0 (${report.total} hand-labeled cases).** This proves the machine and the scoring; the credible number needs real held-out documents (roadmap 1.4). Every label is justified in \`src/bench/corpus.ts\`.`
    : `**Corpus: held-out (${report.total} cases).**`)
  lines.push('')
  lines.push(`Engine ${report.engine_version}. Regenerate: \`npm run index\`.`)
  lines.push('')
  lines.push('| system | false-alarm | missed-error | abstain | precision | recall | n |')
  lines.push('|---|---|---|---|---|---|---|')
  for (const s of report.systems) lines.push(metricsLine(s.name, s.metrics))
  lines.push('')
  lines.push('- **false-alarm (FP rate)** — of the *clean* documents it ruled on, how often it wrongly flagged one.')
  lines.push('- **missed-error (FN rate)** — of the *erroneous* documents it ruled on, how often it let one through.')
  lines.push('- **abstain** — how often it honestly returned "can\'t tell" instead of guessing.')
  lines.push('')
  const v = report.systems[0]
  if (v) lines.push(`On this corpus the deterministic verifier ruled on ${(v.metrics.coverage * 100).toFixed(0)}% of cases with a ${(v.metrics.fp_rate * 100).toFixed(1)}% false-alarm rate and a ${(v.metrics.fn_rate * 100).toFixed(1)}% missed-error rate; it abstained on the rest rather than guess.`)
  lines.push('')
  return lines.join('\n')
}

/**
 * The REAL-WORLD half of the Index, from the Verdict Ledger: how often a human who reviewed a verdict overturned it.
 * This is the number that matters most — synthetic FP/FN prove the machine; the overturn rate proves the field. Rendered
 * from live `Ledger.stats()`; empty until verdicts are recorded and reviewed in production.
 */
export function renderRealWorld(stats: LedgerStats): string {
  const pct = (x: number): string => `${(x * 100).toFixed(1)}%`
  return [
    '## Real-world accuracy (from the Verdict Ledger)',
    '',
    '> Measured on verdicts a human actually reviewed — not synthetic. Synthetic rates prove the machine; this proves the field.',
    '',
    `- Verdicts recorded: **${stats.total}** · reviewed by a human: **${stats.reviewed}**.`,
    stats.reviewed > 0
      ? `- **Human-overturn rate: ${pct(stats.overturn_rate)}** — ${stats.overturned} overturned of ${stats.reviewed} reviewed (${stats.upheld} upheld).`
      : '- **Human-overturn rate: —** (no reviewed verdicts yet).',
    `- Outcomes on record: ${stats.by_outcome.PASS} PASS · ${stats.by_outcome.FAIL} FAIL · ${stats.by_outcome.INSUFFICIENT_DATA} can't-tell.`,
    '',
  ].join('\n')
}
