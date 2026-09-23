/**
 * Baselines the deterministic verifier is measured against. The point of the Index is not "we score well" — it is "here
 * is what the alternatives score on the same set." The honest alternatives a developer actually reaches for:
 *
 *   always-pass / always-fail  — the trivial floors. always-pass misses every error (fn_rate 100%); always-fail
 *                                false-alarms on everything (fp_rate 100%). They frame the axis.
 *   llm-judge                  — "just ask an LLM if the document is consistent." REAL, but injected as an async
 *                                `ask(prompt)` so the harness stays deterministic and $0 in tests; the runner wires a
 *                                `claude -p` (or API) ask when it wants the real comparison. This is the baseline that
 *                                matters — it is what people use instead of us.
 *   bedrock-ar                 — a slot for AWS Bedrock Automated Reasoning. Whether a variable-length line-item sum is
 *                                expressible there is part of what the comparison will measure. Stubbed until it is run.
 */

import type { LabeledCase } from './corpus.js'
import type { Judgment } from './score.js'

export interface Baseline {
  name: string
  judge(c: LabeledCase): Judgment | Promise<Judgment>
}

export const ALWAYS_PASS: Baseline = { name: 'always-pass', judge: () => 'PASS' }
export const ALWAYS_FAIL: Baseline = { name: 'always-fail', judge: () => 'FAIL' }

export const BEDROCK_AR_STUB: Baseline = {
  name: 'bedrock-ar',
  judge() { throw new Error('bedrock-ar baseline not configured: needs AWS credentials and a policy built for the corpus. Not yet run — no result is claimed.') },
}

/** Parse an LLM's free-text answer into a Judgment. Conservative: anything not clearly a verdict is an abstention. */
export function parseJudgment(text: string): Judgment {
  const t = text.trim().toUpperCase()
  if (/\bFAIL\b|\bINCORRECT\b|\bERROR\b|\bWRONG\b|\bDOES NOT\b/.test(t)) return 'FAIL'
  if (/\bPASS\b|\bCORRECT\b|\bCONSISTENT\b|\bVALID\b/.test(t)) return 'PASS'
  return 'INSUFFICIENT_DATA'
}

const JUDGE_PROMPT = (c: LabeledCase): string =>
  `You are checking a financial document for internal consistency (do the numbers add up, does the total match, is anything double-billed or over a contract rate). Answer with exactly one word — PASS (consistent), FAIL (an error), or UNSURE — then a one-line reason.\n\nDocument:\n${JSON.stringify(c.extraction, null, 2)}${c.options?.references ? `\n\nReferences:\n${JSON.stringify(c.options.references, null, 2)}` : ''}`

/** Build the real llm-judge baseline from an injected async `ask`. Not exercised in unit tests (keeps them $0/deterministic). */
export function llmJudge(ask: (prompt: string) => Promise<string>, name = 'llm-judge'): Baseline {
  return { name, async judge(c) { return parseJudgment(await ask(JUDGE_PROMPT(c))) } }
}
