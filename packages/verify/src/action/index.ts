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
 * RECORD-BOUND GROUNDING (`sources.records`, additive, 2026-09-29). An allow-list grounds each value on its own, so the
 * amount approved for invoice A combined with the payee account of invoice B passes: mix-and-match. Approved RECORDS close
 * that. Each record is a set of argument values approved TOGETHER; the arguments the records name (the union of their
 * fields) are consequential, and they are grounded only as a whole:
 *   PASS               one record equals the action on every record-named argument (the evidence cites that record)
 *   FAIL               no record agrees with the action on the record-named arguments it supplies: each of those FAILs, and
 *                      the explanation names the closest record and where it differs (the mix-and-match refusal; also a
 *                      value no record carries, and an empty record list: nothing is approved)
 *   INSUFFICIENT_DATA  a partial tuple: a record-named argument is missing or not a scalar. It abstains, and so does every
 *                      other record-named argument even when a record agrees with the values given: a record is never
 *                      grounded piecewise
 * Values compare as allow-list values do (String(a) === String(b)). An `allowed` list on a record-named argument must also
 * admit the value (else it FAILs as before); source text never grounds a record-named argument.
 * Identity: a verdict names rule action@0.1.0 exactly when records were declared. Without them nothing changes: the same
 * claims, the same bytes, the same verdict_id under action@0.0.1.
 *
 * Deterministic: no I/O, no randomness, no clock except issued_at.
 */

import { hashOf, sha256 } from '../verdict/canonical.js'
import { prepareSource, matchQuote, type PreparedSource } from '../textmatch/index.js'
import type { ClaimVerdict, Coverage, Evidence, Outcome, Value, Verdict } from '../verdict/schema.js'
import { ENGINE_VERSION, SCHEMA_VERSION } from '../version.js'

const ACTION_RULESET = { id: 'action', version: '0.0.1', domain: 'action' } as const
/** The rule with record-bound grounding (above). Named only by verdicts whose sources declare `records`. */
const ACTION_RECORDS_RULESET = { id: 'action', version: '0.1.0', domain: 'action' } as const

/** One approved record: argument name → the value approved for it, together with the record's other values. */
export type ApprovedRecord = Readonly<Record<string, string | number>>

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
  /**
   * Approved records: each names argument values approved TOGETHER (one invoice's amount, payee account and reference). The
   * arguments they name must all equal ONE record (record-bound grounding, above). Name the tool's arguments: a record field
   * the action never supplies leaves every record-named argument abstaining.
   */
  records?: ReadonlyArray<ApprovedRecord>
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

const hasField = (r: ApprovedRecord, k: string): boolean => Object.prototype.hasOwnProperty.call(r, k)

/** The arguments the records name: the union of their fields, in first-seen order. */
function recordNamed(records: ReadonlyArray<ApprovedRecord>): string[] {
  const out: string[] = []
  for (const r of records) for (const k of Object.keys(r)) if (!out.includes(k)) out.push(k)
  return out
}

/**
 * Record-bound grounding (above): one claim per record-named argument, keyed by argument. `required` is the action's
 * consequential arguments; with an empty record list it is what FAILs (nothing is approved).
 */
function groundRecords(args: Record<string, unknown>, records: ReadonlyArray<ApprovedRecord>, required: string[]): Map<string, ClaimVerdict> {
  const rule = { kind: 'CROSS_REFERENCE' as const, tier: 'DETERMINISTIC' as const, rule_id: 'GROUNDED_RECORD', rule_name: 'Values grounded together in one approved record' }
  const out = new Map<string, ClaimVerdict>()
  const recordRef = (i: number, k: string, value: Value): Evidence =>
    ({ locator: { kind: 'field', source: 'contract', path: `records[${i}].${k}` }, value, confidence: 100, role: 'REFERENCE' })

  if (records.length === 0) {
    for (const k of required) {
      const v = (isScalar(args[k]) ? args[k] : null) as Value
      out.set(k, { ...rule, claim_id: `arg.${k}`, field: k, asserted: v, outcome: 'FAIL',
        computation: { formula: 'values ∈ one approved record', operands: { value: v, records: 0 }, result: false },
        evidence: [{ locator: { kind: 'field', source: 'contract', path: 'records' }, value: v, confidence: 100, role: 'REFERENCE' }], locked: true,
        explanation: `The approved records are empty, so nothing is approved: ${k} = ${JSON.stringify(args[k] ?? null)} has no approved record. Do not execute.` })
    }
    return out
  }

  const named = recordNamed(records)
  const present = named.filter(k => isScalar(args[k]))
  const missing = named.filter(k => !isScalar(args[k]))
  const agrees = (r: ApprovedRecord, k: string): boolean => hasField(r, k) && String(r[k]) === String(args[k])
  const consistent = records.map((_, i) => i).filter(i => present.every(k => agrees(records[i]!, k)))
  const given = present.map(k => `${k} = ${JSON.stringify(args[k])}`).join(', ')
  const partial = `the approved records bind ${named.join(', ')} together, and the action does not supply ${missing.join(', ')} as a value; a record is never grounded piecewise, so no record-named argument is grounded. Supply every record-named argument, or declare records that name only this tool's arguments.`
  const abstain = (k: string): ClaimVerdict => ({ ...rule, claim_id: `arg.${k}`, field: k, asserted: (isScalar(args[k]) ? args[k] : null) as Value, outcome: 'INSUFFICIENT_DATA', evidence: [],
    insufficiency: { reason: 'FIELD_MISSING', detail: `${k}: ${partial}`, missing },
    locked: false, explanation: `${k} cannot be grounded on a partial record (missing: ${missing.join(', ')}); provenance unconfirmed.` })
  for (const k of missing) out.set(k, abstain(k))

  if (consistent.length === 0) {
    // No approved record carries the values given together. Name the closest record (most agreeing fields, first on a tie).
    const score = (i: number): number => present.filter(k => agrees(records[i]!, k)).length
    let best = 0
    for (let i = 1; i < records.length; i++) if (score(i) > score(best)) best = i
    const r = records[best]!
    const differs = present.filter(k => !agrees(r, k)).map(k => `${k} = ${hasField(r, k) ? JSON.stringify(r[k]) : '(not on it)'}`).join(', ')
    const closest = `Closest approved record: records[${best}] (${score(best)} of ${present.length} agree; it has ${differs}).`
    for (const k of present) {
      const v = args[k] as Value
      out.set(k, { ...rule, claim_id: `arg.${k}`, field: k, asserted: v, outcome: 'FAIL',
        computation: { formula: 'values ∈ one approved record', operands: { value: v, records: records.length }, result: false },
        evidence: [recordRef(best, k, hasField(r, k) ? r[k]! : null)], locked: true,
        explanation: `No approved record carries ${given} together. ${closest} A value approved for one record combined with another record's value is not grounded. Do not execute.` })
    }
  } else if (missing.length === 0) {
    const i = consistent[0]!
    for (const k of present) {
      const v = args[k] as Value
      out.set(k, { ...rule, claim_id: `arg.${k}`, field: k, asserted: v, outcome: 'PASS',
        computation: { formula: 'values ∈ one approved record', operands: { value: v, record: i }, result: true },
        evidence: [recordRef(i, k, records[i]![k]!)], locked: true,
        explanation: `${k} = ${JSON.stringify(v)} is grounded together with the action's other record-named values (${given}) in approved records[${i}].` })
    }
  } else {
    // A record agrees with every value given, but the action leaves some of its record-named arguments out: a partial tuple.
    for (const k of present) out.set(k, abstain(k))
  }
  return out
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
  const declared = sources.require ?? Object.keys(args).filter(k => isScalar(args[k]))
  // With records, the arguments they name are consequential too (record-bound grounding, above); without, nothing changes.
  const records = sources.records
  const required = records ? [...declared, ...recordNamed(records).filter(k => !declared.includes(k))] : declared
  const byRecord = records ? groundRecords(args, records, required) : undefined
  const prepared = typeof sources.text === 'string' && sources.text.length > 0 ? prepareSource(sources.text) : undefined
  const sourceHash = prepared ? sha256(sources.text as string) : undefined

  const claims: ClaimVerdict[] = required.map(path => {
    const v = args[path]
    const rec = byRecord?.get(path)
    if (rec) {
      // An allow-list on a record-named argument must also admit the value.
      if (rec.outcome !== 'INSUFFICIENT_DATA' && sources.allowed?.[path] !== undefined && isScalar(v)) {
        const listed = groundArgument(path, v, { allowed: sources.allowed }, undefined, undefined)
        if (listed.outcome === 'FAIL') return listed
      }
      return rec
    }
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

  const ruleset = records ? ACTION_RECORDS_RULESET : ACTION_RULESET
  const input_hash = hashOf({ action, sources })
  const verdict_id = sha256(`${input_hash}:${ruleset.id}@${ruleset.version}:${ENGINE_VERSION}`).slice(0, 32)
  const issued_at = (options.now ?? (() => new Date()))().toISOString()

  return {
    schema_version: SCHEMA_VERSION, verdict_id, issued_at, engine_version: ENGINE_VERSION,
    ruleset: { ...ruleset }, input_hash, replayable: true,
    document: { extraction_hash: hashOf(action), ...(options.producer !== undefined ? { producer: options.producer } : {}), line_items: 0 },
    references: { contract: sources.allowed !== undefined || records !== undefined, evidence: 0, history: 0, source: prepared !== undefined },
    outcome, aggregation: 'ANY_FAIL_FAILS', claims, coverage,
  }
}
