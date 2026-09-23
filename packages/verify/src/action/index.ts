/**
 * verify_action — the provenance gate for an AI agent's proposed action.
 *
 * The failure this closes, in the words of the engineers hitting it (complaints-agent-actions, 2026-09-22):
 *   "transfer(amount: 500.00, to_account: 110-234-5678 <- the model filled this in). Every argument is present and
 *    correctly typed, so the schema check passes. Nobody ever declared where that account number had to come from."
 *
 * A schema/type check proves an argument is well-FORMED. This proves each consequential argument is GROUNDED — that its
 * value traces to an approved source (an allow-list of permitted values, or the source document the agent read). The
 * agent proposes; the gate returns a replayable PASS / FAIL / can't-tell proof; the caller executes only on all-PASS.
 *
 * IN SCOPE: wrong or ungrounded VALUES (amounts, codes, account numbers, ids) in a consequential action.
 * OUT OF SCOPE, and we say so: whether the action is a good idea (planning), whether the agent is allowed to take it
 * (permissions), and destructive-action safety (sandboxing). This gate does not judge those.
 *
 * Deterministic: no I/O, no randomness, no clock except issued_at.
 */

import { hashOf, sha256 } from '../verdict/canonical.js'
import { prepareSource, matchQuote, type PreparedSource } from '../textmatch/index.js'
import type { ClaimVerdict, Coverage, Evidence, Outcome, Value, Verdict } from '../verdict/schema.js'
import { ENGINE_VERSION, SCHEMA_VERSION } from '../version.js'

const ACTION_RULESET = { id: 'action', version: '0.0.1', domain: 'action' } as const

export interface ProposedAction {
  /** The tool/function the agent proposes to call (recorded on the verdict, never trusted). */
  tool: string
  /** The proposed arguments. Top-level scalar arguments are the consequential values checked for grounding. */
  arguments: Record<string, unknown>
}

export interface ActionSources {
  /** Source document text the agent read; a value is grounded if it appears there (digital-born text). */
  text?: string
  /** Per-argument allow-lists: the value MUST be one of these approved values (e.g. permitted accounts, valid codes). */
  allowed?: Record<string, ReadonlyArray<string | number>>
  /** Which argument paths are consequential and must be grounded. Default: every top-level scalar argument. */
  require?: string[]
}

export interface VerifyActionOptions {
  producer?: string
  now?: () => Date
}

type Scalar = string | number | boolean
const isScalar = (x: unknown): x is Scalar => typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean'
const looksNumeric = (v: Scalar): boolean => typeof v === 'number' || (typeof v === 'string' && /^-?[\d.,\s$]+$/.test(v) && /\d/.test(v))

function allowlistEvidence(path: string, value: Value): Evidence {
  return { locator: { kind: 'field', source: 'contract', path: `allowed.${path}` }, value, confidence: 100, role: 'REFERENCE' }
}
function spanEvidence(sourceHash: string, span: { start: number; end: number }, text: string): Evidence {
  return { locator: { kind: 'span', source_hash: sourceHash, start: span.start, end: span.end }, value: text, confidence: 100, role: 'QUOTE' }
}

/** Ground one argument against the allow-list (if any) then the source text (if any). */
function groundArgument(
  path: string, value: Scalar, sources: ActionSources, prepared: PreparedSource | undefined, sourceHash: string | undefined,
): ClaimVerdict {
  const base = { claim_id: `arg.${path}`, tier: 'DETERMINISTIC' as const, field: path, asserted: value as Value }

  const allowed = sources.allowed?.[path]
  if (allowed !== undefined) {
    const ok = allowed.some(a => String(a) === String(value))
    return ok
      ? { ...base, kind: 'CROSS_REFERENCE', outcome: 'PASS', rule_id: 'GROUNDED', rule_name: 'Value grounded in an approved set',
          computation: { formula: 'value ∈ allowed', operands: { value: value as Value }, result: true },
          evidence: [allowlistEvidence(path, value as Value)], locked: true,
          explanation: `"${value}" is one of the ${allowed.length} approved values for ${path}.` }
      : { ...base, kind: 'CROSS_REFERENCE', outcome: 'FAIL', rule_id: 'GROUNDED', rule_name: 'Value grounded in an approved set',
          computation: { formula: 'value ∈ allowed', operands: { value: value as Value, approved: allowed.length }, result: false },
          evidence: [allowlistEvidence(path, value as Value)], locked: true,
          explanation: `"${value}" is NOT in the approved set for ${path}. The agent proposed a value with no approved source — do not execute.` }
  }

  if (prepared && sourceHash) {
    // A BARE NUMBER appearing somewhere in free source text is NOT provenance for an action value — it grounds off a
    // year, a quantity, a part or account number, or an opposite-signed amount (red-team break, 2026-09-22). An action's
    // consequential number must be grounded by an ALLOW-LIST (or, later, a labelled field), never by "the digits appear".
    if (looksNumeric(value)) {
      return { ...base, kind: 'CROSS_REFERENCE', outcome: 'INSUFFICIENT_DATA', rule_id: 'GROUNDED', rule_name: 'Value grounded in an approved source',
        evidence: [],
        insufficiency: { reason: 'REFERENCE_NOT_PROVIDED', detail: `${path} = ${JSON.stringify(value)}: a bare number found in free source text does not establish it as this argument's value (it can match a year, quantity, part or account number, or an opposite sign). Supply an allow-list of approved values, or a labelled source field, to ground a numeric action value.` },
        locked: false, explanation: `Numeric value ${path} cannot be grounded by free-text presence alone; provenance unconfirmed.` }
    }
    // A distinctive string (a name, a reference) appearing VERBATIM is reasonable grounding.
    const sval = String(value)
    if (sval.trim().length >= 3) {
      const r = matchQuote(prepared, sval)
      if (r.found && r.span) return { ...base, kind: 'QUOTE_MATCH', outcome: 'PASS', rule_id: 'GROUNDED', rule_name: 'Value grounded in the source document',
        computation: { formula: 'value ∈ source', operands: { value: value as Value }, result: true },
        evidence: [spanEvidence(sourceHash, r.span, r.matchedText ?? '')], locked: true,
        explanation: `${path} = "${value}" appears verbatim in the source the agent read.` }
    }
    // present source, value not grounded → we cannot prove it, and we do not falsely accuse: abstain.
    return { ...base, kind: 'QUOTE_MATCH', outcome: 'INSUFFICIENT_DATA', rule_id: 'GROUNDED', rule_name: 'Value grounded in the source document',
      evidence: [],
      insufficiency: { reason: 'SPAN_NOT_FOUND', detail: `${path} = ${JSON.stringify(value)} was not found verbatim in the supplied source. Not confirmed grounded — do not execute on this alone.` },
      locked: false, explanation: `Could not ground ${path} in the source; provenance unconfirmed.` }
  }

  // No allow-list and no source for this argument: nobody declared where the value comes from — the exact Jay299792458 case.
  return { ...base, kind: 'CROSS_REFERENCE', outcome: 'INSUFFICIENT_DATA', rule_id: 'GROUNDED', rule_name: 'Value grounded in an approved source',
    evidence: [],
    insufficiency: { reason: 'REFERENCE_NOT_PROVIDED', detail: `no allow-list and no source were declared for ${path}, so its provenance cannot be checked. Supply allowed values or the source document the value must come from.` },
    locked: false, explanation: `No source declared for ${path}; provenance unverifiable.` }
}

function coverageOf(claims: ClaimVerdict[]): Coverage {
  let pass = 0, fail = 0, ins = 0
  for (const c of claims) c.outcome === 'PASS' ? pass++ : c.outcome === 'FAIL' ? fail++ : ins++
  return { claims_total: claims.length, claims_checked: pass + fail, claims_pass: pass, claims_fail: fail, claims_insufficient: ins }
}

/**
 * Verify a proposed action's consequential values are grounded. Returns the same proof object as verify() (ruleset 'action').
 * The caller's gate policy is theirs: the honest reading is "execute only when outcome === PASS" (every value grounded,
 * none merely can't-tell).
 */
export function verifyAction(action: ProposedAction, sources: ActionSources = {}, options: VerifyActionOptions = {}): Verdict {
  const args = action.arguments ?? {}
  const required = sources.require ?? Object.keys(args).filter(k => isScalar(args[k]))
  const prepared = typeof sources.text === 'string' && sources.text.length > 0 ? prepareSource(sources.text) : undefined
  const sourceHash = prepared ? sha256(sources.text as string) : undefined

  const claims: ClaimVerdict[] = required.map(path => {
    const v = args[path]
    if (!isScalar(v)) {
      return { claim_id: `arg.${path}`, kind: 'CROSS_REFERENCE', tier: 'DETERMINISTIC', outcome: 'INSUFFICIENT_DATA',
        field: path, asserted: null, rule_id: 'GROUNDED', rule_name: 'Value grounded in an approved source', evidence: [],
        insufficiency: { reason: 'UNPARSEABLE', detail: `${path} is not a scalar value; only scalar arguments (amounts, codes, ids, strings) are checked for grounding.` },
        locked: false, explanation: `${path} is not a scalar; not checked.` }
    }
    return groundArgument(path, v, sources, prepared, sourceHash)
  })

  const coverage = coverageOf(claims)
  const outcome: Outcome = coverage.claims_fail > 0 ? 'FAIL' : coverage.claims_insufficient > 0 || coverage.claims_checked === 0 ? 'INSUFFICIENT_DATA' : 'PASS'

  const input_hash = hashOf({ action, sources })
  const verdict_id = sha256(`${input_hash}:${ACTION_RULESET.id}@${ACTION_RULESET.version}:${ENGINE_VERSION}`).slice(0, 32)
  const issued_at = (options.now ?? (() => new Date()))().toISOString()

  return {
    schema_version: SCHEMA_VERSION, verdict_id, issued_at, engine_version: ENGINE_VERSION,
    ruleset: { ...ACTION_RULESET }, input_hash, replayable: true,
    document: { extraction_hash: hashOf(action), ...(options.producer !== undefined ? { producer: options.producer } : {}), line_items: 0 },
    references: { contract: sources.allowed !== undefined, evidence: 0, history: 0, source: prepared !== undefined },
    outcome, aggregation: 'ANY_FAIL_FAILS', claims, coverage,
  }
}
