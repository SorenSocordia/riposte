/**
 * Braintrust: a Riposte verdict as a Braintrust scorer result.
 *
 * Shape from Braintrust's autoevals `Score` (MIT; "Keep this in sync with @braintrust/core"):
 *   { name: string; score: number | null; metadata?: Record<string, unknown> }
 * and its Python twin: "If the score is None, the evaluation is considered to be skipped." A custom scorer receives
 * `{ input, output, expected, metadata }` (Braintrust docs, "Custom code evaluators").
 *
 *   PASS               score 1
 *   FAIL               score 0
 *   INSUFFICIENT_DATA  score null (can't tell): skipped, never averaged in as a 0 (metadata.riposte.answer said ABSTAIN
 *                      before 2026-10-06)
 *   refused            score null (the output was not a document; metadata says why, and there is no verdict id)
 * The verdict id, the replay command and the proof travel in `metadata.riposte`.
 */
import { checkOutput, riposteMetadata, type CheckResult, type ProofOptions, type References, type RiposteProof, type RulesetChoice } from './core.js'

export interface BraintrustScore { name: string; score: number | null; metadata: Record<string, unknown> }

export interface BraintrustScorerArgs {
  input?: unknown
  output: unknown
  expected?: unknown
  metadata?: Record<string, unknown>
}

export interface BraintrustScorerOptions extends ProofOptions {
  /** Default `riposte`. */
  name?: string
  /** Default `invoice`. */
  ruleset?: RulesetChoice
  /** Where the references come from. Default: the row's `metadata.riposte_references` ({ contract, evidence, history }). */
  references?: (args: BraintrustScorerArgs) => References | undefined
  /** The source text for the source-text checks: `'input'` uses the row's input when it is a string. Default: none. */
  source?: 'input' | ((args: BraintrustScorerArgs) => string | undefined)
}

/** One check result as a Braintrust score. */
export function braintrustScore(result: CheckResult | RiposteProof, name = 'riposte'): BraintrustScore {
  const r: CheckResult = 'kind' in result ? result : { kind: 'verdict', proof: result }
  if (r.kind === 'refused') return { name, score: null, metadata: { riposte: { answer: null, refused: r.reason } } }
  const p = r.proof
  return { name, score: p.answer === 'PASS' ? 1 : p.answer === 'FAIL' ? 0 : null, metadata: riposteMetadata(p) }
}

const defaultReferences = (args: BraintrustScorerArgs): References | undefined => {
  const r = args.metadata?.riposte_references
  return r !== null && typeof r === 'object' && !Array.isArray(r) ? (r as References) : undefined
}

/** A scorer for `Eval(..., { scores: [riposteBraintrustScorer()] })`. */
export function riposteBraintrustScorer(opts: BraintrustScorerOptions = {}): (args: BraintrustScorerArgs) => BraintrustScore {
  const name = opts.name ?? 'riposte'
  const refsOf = opts.references ?? defaultReferences
  return (args) => {
    const source = opts.source === 'input' ? (typeof args.input === 'string' ? args.input : undefined) : opts.source?.(args)
    const references = refsOf(args)
    const result = checkOutput({
      output: args.output,
      ...(opts.ruleset !== undefined ? { ruleset: opts.ruleset } : {}),
      ...(references ? { references } : {}),
      ...(source ? { source } : {}),
    }, opts)
    return braintrustScore(result, name)
  }
}
