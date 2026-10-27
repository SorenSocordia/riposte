/**
 * Riposte verdicts as eval-platform scores: the shared core of the Langfuse, Braintrust and Inspect adapters.
 *
 * Eval platforms grade with judges. These adapters put Riposte's deterministic verdict inside them as a score: the
 * platform's native score object, carrying the verdict id and the replay command, so anyone looking at the score can
 * re-run the check. The verdict decides; an adapter only renders it.
 *
 * Three answers, mapped by each adapter (docs: README "Scorers"):
 *   PASS     every check that ran held
 *   FAIL     a check ran and did not hold
 *   INSUFFICIENT_DATA  can't tell: no check could decide (an input was missing or not supplied). Never rendered as a 0 or as a
 *                      fail. (Written ABSTAIN before 2026-10-06; scoreAnswer still reads that word.)
 * An output that is not a document at all (not JSON, or nothing a verdict can bind to) gets no verdict: `refused`.
 */
import { gateStatus, isDeclarativeRuleset, verify } from 'riposte-verify'
import type { DeclarativeRuleset, Json, Remedy, Verdict, VerifyOptions } from 'riposte-verify'

export type Answer = 'PASS' | 'FAIL' | 'INSUFFICIENT_DATA'
/**
 * A verdict outcome as these scorers' answer. Since 2026-10-06 can't tell is INSUFFICIENT_DATA, the verdict's own word, in every
 * score (the Langfuse category, the Braintrust and Inspect metadata, the summary); it was ABSTAIN before. An older verdict or
 * score that says ABSTAIN reads as INSUFFICIENT_DATA, like any outcome that is not PASS or FAIL.
 */
export const scoreAnswer = (o: string): Answer => (o === 'PASS' ? 'PASS' : o === 'FAIL' ? 'FAIL' : 'INSUFFICIENT_DATA')
export const BUILTIN_RULESETS = ['invoice', 'pay-app'] as const
export type RulesetChoice = (typeof BUILTIN_RULESETS)[number] | DeclarativeRuleset

export interface References {
  contract?: Json
  evidence?: Json[]
  history?: Json[]
}

/** What one check needs: the model's output (the extracted document, or its JSON text) and what it is checked against. */
export interface CheckRequest {
  output: unknown
  /** A built-in ruleset name, or a declarative ruleset object. Default `invoice`. */
  ruleset?: RulesetChoice
  references?: References
  /** The source document's text: enables the source-text checks (a declarative ruleset's quotes, values in the source). */
  source?: string
}

export interface ProofOptions {
  /** Put the replay bundle ({ verdict, inputs }) in the metadata. Default true: the score then carries its own proof. */
  inlineProof?: boolean
  /** The file name the replay command names. Default `riposte-proof-<verdict_id>.json`. */
  proofFile?: (verdictId: string) => string
}

/** One check that did not PASS, in the words a reviewer reads. */
export interface Finding {
  claim_id: string
  rule_id: string
  rule_name: string
  field: string
  answer: Exclude<Answer, 'PASS'>
  explanation: string
  /** Why it could not run (INSUFFICIENT_DATA only), e.g. FIELD_MISSING, REFERENCE_NOT_PROVIDED. */
  reason?: string
}

/** What `riposte-verify replay` takes: the verdict and the exact inputs its input_hash commits to. */
export interface ReplayBundle { verdict: Verdict; inputs: Record<string, unknown> }

/** The verdict, rendered once for every adapter. */
export interface RiposteProof {
  answer: Answer
  /** PASS-WITH-OPEN when the verdict PASSed but some checks could not run (a gate would hold it). */
  gate: Answer | 'PASS-WITH-OPEN'
  verdict_id: string
  ruleset: string
  engine_version: string
  /** The command that re-performs this check from the proof file. */
  replay: string
  proof_file: string
  summary: string
  /** `insufficient_data`: the checks that could not run (this key was `abstain` before 2026-10-06) */
  coverage: { checks: number; ran: number; pass: number; fail: number; insufficient_data: number }
  findings: Finding[]
  remedies?: Remedy[]
  proof?: ReplayBundle
}

export type CheckResult = { kind: 'verdict'; proof: RiposteProof } | { kind: 'refused'; reason: string }

const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x)

/**
 * The document in a model's output: an object as is, or JSON text (a fenced ```json block is unwrapped). Anything else
 * is refused: there is nothing a verdict could be bound to.
 */
export function extractionFromOutput(output: unknown): { extraction: Json } | { refused: string } {
  if (isObj(output) || Array.isArray(output)) return { extraction: output as Json }
  if (typeof output !== 'string') return { refused: `the output is ${output === null ? 'null' : typeof output}, not a document` }
  const text = output.trim()
  if (!text) return { refused: 'the output is empty' }
  const fenced = /^```[a-zA-Z]*\s*\n([\s\S]*?)\n?```$/.exec(text)
  try {
    const parsed: unknown = JSON.parse(fenced ? fenced[1]! : text)
    if (isObj(parsed) || Array.isArray(parsed)) return { extraction: parsed as Json }
    return { refused: 'the output is JSON but not an object' }
  } catch {
    return { refused: 'the output is not JSON' }
  }
}

/** verify()'s options and the inputs object its verdict's input_hash commits to (what `riposte-verify replay` re-performs). */
export function verifyCall(extraction: Json, req: Omit<CheckRequest, 'output'>): { options: VerifyOptions; inputs: Record<string, unknown> } {
  const ruleset = req.ruleset ?? 'invoice'
  const source = typeof req.source === 'string' && req.source.length > 0 ? { text: req.source } : undefined
  if (isDeclarativeRuleset(ruleset)) {
    return { options: { ruleset, ...(source ? { source } : {}) }, inputs: { extraction, ruleset, ...(source ? { source } : {}) } }
  }
  if (!(BUILTIN_RULESETS as readonly string[]).includes(ruleset as string)) {
    throw new Error(`unknown ruleset ${JSON.stringify(ruleset)}: use ${BUILTIN_RULESETS.join(' or ')}, or a declarative ruleset object`)
  }
  const refs = req.references ?? {}
  const references = { contract: refs.contract ?? null, evidence: refs.evidence ?? [], history: refs.history ?? [] }
  const given = {
    ...(refs.contract !== undefined ? { contract: refs.contract } : {}),
    ...(refs.evidence !== undefined ? { evidence: refs.evidence } : {}),
    ...(refs.history !== undefined ? { history: refs.history } : {}),
  }
  return {
    options: { ruleset: ruleset as 'invoice' | 'pay-app', ...(Object.keys(given).length ? { references: given } : {}), ...(source ? { source } : {}) },
    inputs: { extraction, references, source: source ?? null },
  }
}

/** Run the check on a model's output. Never throws for a bad output (that is `refused`); throws for a bad ruleset name. */
export function checkOutput(req: CheckRequest, opts: ProofOptions = {}): CheckResult {
  const got = extractionFromOutput(req.output)
  if ('refused' in got) return { kind: 'refused', reason: got.refused }
  const { options, inputs } = verifyCall(got.extraction, req)
  let verdict: Verdict
  try {
    verdict = verify(got.extraction, options)
  } catch (e) {
    if ((e as Error)?.name === 'InputRefused') return { kind: 'refused', reason: (e as Error).message }
    throw e
  }
  return { kind: 'verdict', proof: proofOf(verdict, inputs, opts) }
}

export const defaultProofFile = (verdictId: string): string => `riposte-proof-${verdictId}.json`
/** The public CLI's replay of a proof bundle file. */
export const replayCommand = (proofFile: string): string => `riposte-verify replay ${proofFile}`

/** Render a verdict (and the inputs it was made from) for the adapters. */
export function proofOf(verdict: Verdict, inputs: Record<string, unknown>, opts: ProofOptions = {}): RiposteProof {
  const answer = scoreAnswer(verdict.outcome)
  const findings: Finding[] = verdict.claims
    .filter((c) => c.outcome !== 'PASS')
    .map((c) => ({
      claim_id: c.claim_id, rule_id: c.rule_id, rule_name: c.rule_name, field: c.field,
      answer: scoreAnswer(c.outcome) as Exclude<Answer, 'PASS'>,
      explanation: c.explanation,
      ...(c.insufficiency ? { reason: c.insufficiency.reason } : {}),
    }))
  const cov = verdict.coverage
  const coverage = { checks: cov.claims_total, ran: cov.claims_checked, pass: cov.claims_pass, fail: cov.claims_fail, insufficient_data: cov.claims_insufficient }
  const proofFile = (opts.proofFile ?? defaultProofFile)(verdict.verdict_id)
  const g = gateStatus(verdict)
  return {
    answer,
    gate: g === 'PASS-WITH-OPEN' ? g : scoreAnswer(g),
    verdict_id: verdict.verdict_id,
    ruleset: `${verdict.ruleset.id}@${verdict.ruleset.version}`,
    engine_version: verdict.engine_version,
    replay: replayCommand(proofFile),
    proof_file: proofFile,
    summary: summaryOf(answer, coverage, findings),
    coverage,
    findings,
    ...(verdict.remedies?.length ? { remedies: verdict.remedies } : {}),
    ...(opts.inlineProof === false ? {} : { proof: { verdict, inputs } }),
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** One plain sentence: what the verdict says, and what a person does about the open checks. */
export function summaryOf(answer: Answer, c: RiposteProof['coverage'], findings: Finding[]): string {
  const failed = findings.filter((f) => f.answer === 'FAIL')
  if (answer === 'FAIL') {
    const named = failed.slice(0, 3).map((f) => `${f.rule_id} (${f.field})`).join(', ')
    return `FAIL: ${plural(failed.length, 'check')} did not hold: ${named}${failed.length > 3 ? ', …' : ''}.`
  }
  if (answer === 'INSUFFICIENT_DATA') return `INSUFFICIENT_DATA: can't tell, no check could run (${plural(c.insufficient_data, 'check')} lacked an input). A person decides; this is not a failure.`
  return c.insufficient_data > 0
    ? `PASS: ${plural(c.pass, 'check')} held; ${plural(c.insufficient_data, 'check')} could not run, and a person decides ${c.insufficient_data === 1 ? 'that one' : 'those'}.`
    : `PASS: all ${plural(c.pass, 'check')} held.`
}

/** The metadata every adapter attaches, under one `riposte` key. */
export function riposteMetadata(p: RiposteProof): { riposte: RiposteProof } {
  return { riposte: p }
}

/** The short metadata for a second score of the same verdict (no proof, no findings). */
export function riposteRef(p: RiposteProof): { riposte: Pick<RiposteProof, 'answer' | 'verdict_id' | 'ruleset' | 'replay' | 'proof_file'> } {
  return { riposte: { answer: p.answer, verdict_id: p.verdict_id, ruleset: p.ruleset, replay: p.replay, proof_file: p.proof_file } }
}
