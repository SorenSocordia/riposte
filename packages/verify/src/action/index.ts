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
 * THE RIGHT VALUE WRITTEN DIFFERENTLY (action@0.2.0, 2026-09-29). 0.1.0 compared a value with an approved one as text, so an
 * approved amount written 980.5 and a proposed "980.50" did not match, and a clean call was held. 0.2.0 compares each
 * argument under its type (`sources.fields`, equivalence.ts): undeclared, a JSON number equals the same number written as a
 * plain numeral; declared amounts, identifiers, dates and rates admit their stated equivalent forms. Leading zeros, scale,
 * sign, another record's value, ambiguous numeric dates, an undeclared currency and percent-vs-fraction without a unit are
 * never the same value. Only the comparison changes: the record rule, the allow-list rule and the text rule are 0.1.0's, and a
 * match as written wins over an equivalent one.
 * Identity: a verdict names action@0.2.0 exactly when the typed comparison decides differently from 0.1.0's on that input
 * (0.1.0's claims, recomputed with the typed comparison, differ). Otherwise it is 0.1.0's verdict, byte for byte (0.0.1 or
 * 0.1.0 as above). A 0.2.0 verdict's PASS and FAIL claims carry the comparison used (`type`) and the consequential arguments
 * (`required`), and its PASS claims the approved value as written (`approved`), so the book's door recomputes them
 * (door.ts). `ruleset: 'action@0.1.0'` (or 0.0.1) selects the earlier rule, exactly.
 *
 * Deterministic: no I/O, no randomness, no clock except issued_at.
 */

import { hashOf, sha256 } from '../verdict/canonical.js'
import { attachRemedies, type RemedyTable } from '../verdict/remedy.js'
import { attachScope } from '../verdict/scope.js'
import { prepareSource, matchQuote, type PreparedSource } from '../textmatch/index.js'
import type { ClaimVerdict, Coverage, Evidence, Outcome, Value, Verdict } from '../verdict/schema.js'
import { SCHEMA_VERSION, engineFor } from '../version.js'
import { verdictIdentity } from '../protocol/verdict-id.js'
import { compareValues, comparisonCode, comparisonFor, sameAsWritten, type FieldType, type Match } from './equivalence.js'

const ACTION_RULESET = { id: 'action', version: '0.0.1', domain: 'action' } as const
/** The rule with record-bound grounding (above). Named only by verdicts whose sources declare `records`. */
const ACTION_RECORDS_RULESET = { id: 'action', version: '0.1.0', domain: 'action' } as const
/** The rule with typed comparison (above). Named only by verdicts it decides differently from 0.1.0. */
const ACTION_REPR_RULESET = { id: 'action', version: '0.2.0', domain: 'action' } as const
export type ActionRuleset = typeof ACTION_RULESET | typeof ACTION_RECORDS_RULESET | typeof ACTION_REPR_RULESET
/** Every action rule this build can issue or re-perform, newest first. 0.1.0 and 0.0.1 select the same earlier rule. */
export const ACTION_RULESET_VERSIONS: readonly ActionRuleset[] = [ACTION_REPR_RULESET, ACTION_RECORDS_RULESET, ACTION_RULESET]

/**
 * Resolve 'action' (the current rule, 0.2.0), 'action@<version>' or a ruleset ref. Unknown ids or versions throw: a verdict
 * is never issued under a rule that does not exist. 0.1.0 and 0.0.1 both run the rule before 0.2.0, which names 0.0.1 without
 * records and 0.1.0 with them.
 */
export function resolveActionRuleset(r?: string | { id: string; version: string }): ActionRuleset {
  if (r === undefined) return ACTION_REPR_RULESET
  const [id, version] = typeof r === 'string' ? r.split('@') as [string, string | undefined] : [r.id, r.version]
  const hit = id === ACTION_REPR_RULESET.id && (version === undefined ? ACTION_REPR_RULESET : ACTION_RULESET_VERSIONS.find(v => v.version === version))
  if (!hit) throw new Error(`unknown action ruleset "${typeof r === 'string' ? r : `${r.id}@${r.version}`}"; known: ${ACTION_RULESET_VERSIONS.map(v => `${v.id}@${v.version}`).join(', ')}`)
  return hit
}

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
  /**
   * How each argument's value compares with its approved values (action@0.2.0): `{ amount: { type: 'amount', currency: 'USD' },
   * reference: { type: 'identifier', case_insensitive: true } }`. An argument not named here compares as written, except that
   * a JSON number equals the same number written as a plain numeral. An invalid declaration compares as written (text).
   */
  fields?: Record<string, FieldType>
}

export interface VerifyActionOptions {
  producer?: string
  now?: () => Date
  /** 'action' (current, 0.2.0) or 'action@0.1.0' (retained, to re-perform its verdicts). See resolveActionRuleset. */
  ruleset?: string | { id: string; version: string }
  /** The engine version to re-perform under (2026-10-03, version.ts engineFor): this build's when absent, or an earlier one it retains. For replay. */
  engine?: string
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

/**
 * How one run compares and renders. 0.1.0: equal as written, 0.1.0's claims. 0.2.0: the typed comparison, and claims that
 * carry what the door recomputes (`type`, `required`, `approved`). The label choice runs the typed comparison with 0.1.0's
 * rendering too, to see whether it decides anything differently.
 */
interface Mode {
  compare: (approved: Scalar, proposed: Scalar, path: string) => Match
  v2: boolean
  /** The comparison's code for an argument (0.2.0 claims). */
  typeOf: (path: string) => string
  required: string[]
}

/** The approved value that matches: one equal as written first, else the first equivalent one (a match as written wins). */
function firstMatch(approved: ReadonlyArray<Scalar>, value: Scalar, path: string, mode: Mode): { index: number; match: Match } | undefined {
  for (const kind of ['identical', 'equivalent'] as const) {
    for (let i = 0; i < approved.length; i++) {
      const match = mode.compare(approved[i]!, value, path)
      if (match.kind === kind) return { index: i, match }
    }
  }
  return undefined
}

/** Evidence for a match in another written form: the canonical value, the approved value as written, the readings used. */
function equivalentEvidence(path: string, approved: Scalar, m: Extract<Match, { kind: 'equivalent' }>): Evidence {
  return { locator: { kind: 'field', source: 'contract', path }, value: m.canonical, original: approved, normalizations: m.steps, confidence: 100, role: 'REFERENCE' }
}

/** Ground one argument against the allow-list (if any) then the source text (if any). */
function groundArgument(
  path: string, value: Scalar, sources: ActionSources, prepared: PreparedSource | undefined, sourceHash: string | undefined, mode: Mode,
): ClaimVerdict {
  const base = { claim_id: `arg.${path}`, tier: 'DETERMINISTIC' as const, field: path, asserted: value as Value }

  const allowed = sources.allowed?.[path]
  if (allowed !== undefined) {
    const hit = firstMatch(allowed, value, path, mode)
    const eq = mode.v2 && hit?.match.kind === 'equivalent' ? hit.match : undefined
    const typed: Record<string, Value> = mode.v2 ? { type: mode.typeOf(path), required: mode.required } : {}
    return hit
      ? { ...base, kind: 'CROSS_REFERENCE', outcome: 'PASS', rule_id: 'GROUNDED', rule_name: 'Value grounded in an approved set',
          computation: { formula: mode.v2 ? 'value ≡ allowed' : 'value ∈ allowed', operands: mode.v2 ? { value: value as Value, approved: allowed[hit.index]!, ...typed } : { value: value as Value }, result: true },
          evidence: [eq ? equivalentEvidence(`allowed.${path}[${hit.index}]`, allowed[hit.index]!, eq) : allowlistEvidence(path, value as Value)], locked: true,
          explanation: eq
            ? `"${value}" is one of the ${allowed.length} approved values for ${path}: approved as ${JSON.stringify(allowed[hit.index])}, the same value written another way (${eq.steps.join(', ')}).`
            : `"${value}" is one of the ${allowed.length} approved values for ${path}.` }
      : { ...base, kind: 'CROSS_REFERENCE', outcome: 'FAIL', rule_id: 'GROUNDED', rule_name: 'Value grounded in an approved set',
          computation: { formula: mode.v2 ? 'value ≡ allowed' : 'value ∈ allowed', operands: mode.v2 ? { value: value as Value, allowed: allowed.length, ...typed } : { value: value as Value, approved: allowed.length }, result: false },
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
        computation: { formula: 'value ∈ source', operands: mode.v2 ? { value: value as Value, required: mode.required } : { value: value as Value }, result: true },
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
function groundRecords(args: Record<string, unknown>, records: ReadonlyArray<ApprovedRecord>, required: string[], mode: Mode): Map<string, ClaimVerdict> {
  const rule = { kind: 'CROSS_REFERENCE' as const, tier: 'DETERMINISTIC' as const, rule_id: 'GROUNDED_RECORD', rule_name: 'Values grounded together in one approved record' }
  const formula = mode.v2 ? 'values ≡ one approved record' : 'values ∈ one approved record'
  const typed = (k: string): Record<string, Value> => (mode.v2 ? { type: mode.typeOf(k), required: mode.required } : {})
  const out = new Map<string, ClaimVerdict>()
  const recordRef = (i: number, k: string, value: Value): Evidence =>
    ({ locator: { kind: 'field', source: 'contract', path: `records[${i}].${k}` }, value, confidence: 100, role: 'REFERENCE' })

  if (records.length === 0) {
    for (const k of required) {
      const v = (isScalar(args[k]) ? args[k] : null) as Value
      out.set(k, { ...rule, claim_id: `arg.${k}`, field: k, asserted: v, outcome: 'FAIL',
        computation: { formula, operands: { value: v, records: 0, ...typed(k) }, result: false },
        evidence: [{ locator: { kind: 'field', source: 'contract', path: 'records' }, value: v, confidence: 100, role: 'REFERENCE' }], locked: true,
        explanation: `The approved records are empty, so nothing is approved: ${k} = ${JSON.stringify(args[k] ?? null)} has no approved record. Do not execute.` })
    }
    return out
  }

  const named = recordNamed(records)
  const present = named.filter(k => isScalar(args[k]))
  const missing = named.filter(k => !isScalar(args[k]))
  const matchOf = (r: ApprovedRecord, k: string): Match => (hasField(r, k) ? mode.compare(r[k]!, args[k] as Scalar, k) : { kind: 'different' })
  const agrees = (r: ApprovedRecord, k: string): boolean => matchOf(r, k).kind !== 'different'
  const asWritten = (i: number): boolean => present.every(k => matchOf(records[i]!, k).kind === 'identical')
  // A record that agrees as written comes first, so the record cited is 0.1.0's whenever 0.1.0 had one.
  const consistent = records.map((_, i) => i).filter(i => present.every(k => agrees(records[i]!, k)))
    .sort((a, b) => Number(asWritten(b)) - Number(asWritten(a)) || a - b)
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
        computation: { formula, operands: { value: v, records: records.length, ...typed(k) }, result: false },
        evidence: [recordRef(best, k, hasField(r, k) ? r[k]! : null)], locked: true,
        explanation: `No approved record carries ${given} together. ${closest} A value approved for one record combined with another record's value is not grounded. Do not execute.` })
    }
  } else if (missing.length === 0) {
    const i = consistent[0]!
    for (const k of present) {
      const v = args[k] as Value
      const approved = records[i]![k]!
      const m = matchOf(records[i]!, k)
      const eq = mode.v2 && m.kind === 'equivalent' ? m : undefined
      out.set(k, { ...rule, claim_id: `arg.${k}`, field: k, asserted: v, outcome: 'PASS',
        computation: { formula, operands: mode.v2 ? { value: v, record: i, approved, ...typed(k) } : { value: v, record: i }, result: true },
        evidence: [eq ? equivalentEvidence(`records[${i}].${k}`, approved, eq) : recordRef(i, k, approved)], locked: true,
        explanation: `${k} = ${JSON.stringify(v)} is grounded together with the action's other record-named values (${given}) in approved records[${i}]${eq ? `, which writes it ${JSON.stringify(approved)}: the same value written another way (${eq.steps.join(', ')})` : ''}.` })
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
  const selected = resolveActionRuleset(options.ruleset)
  const args = action.arguments ?? {}
  const declared = sources.require ?? Object.keys(args).filter(k => isScalar(args[k]))
  // With records, the arguments they name are consequential too (record-bound grounding, above); without, nothing changes.
  const records = sources.records
  const required = records ? [...declared, ...recordNamed(records).filter(k => !declared.includes(k))] : declared
  const prepared = typeof sources.text === 'string' && sources.text.length > 0 ? prepareSource(sources.text) : undefined
  const sourceHash = prepared ? sha256(sources.text as string) : undefined

  const claimsUnder = (mode: Mode): ClaimVerdict[] => {
    const byRecord = records ? groundRecords(args, records, required, mode) : undefined
    return required.map(path => {
      const v = args[path]
      const rec = byRecord?.get(path)
      if (rec) {
        // An allow-list on a record-named argument must also admit the value.
        if (rec.outcome !== 'INSUFFICIENT_DATA' && sources.allowed?.[path] !== undefined && isScalar(v)) {
          const listed = groundArgument(path, v, { allowed: sources.allowed }, undefined, undefined, mode)
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
      return groundArgument(path, v, sources, prepared, sourceHash, mode)
    })
  }

  // 0.1.0's claims, exactly. Under 0.2.0 (the default), the typed comparison replaces them only where it decides differently.
  const typeOf = (path: string): string => comparisonCode(comparisonFor(sources.fields, path))
  let claims = claimsUnder({ compare: sameAsWritten, v2: false, typeOf, required })
  let ruleset: ActionRuleset = records ? ACTION_RECORDS_RULESET : ACTION_RULESET
  if (selected === ACTION_REPR_RULESET) {
    const compare = (approved: Scalar, proposed: Scalar, path: string): Match => compareValues(approved, proposed, comparisonFor(sources.fields, path))
    if (JSON.stringify(claimsUnder({ compare, v2: false, typeOf, required })) !== JSON.stringify(claims)) {
      claims = claimsUnder({ compare, v2: true, typeOf, required })
      ruleset = ACTION_REPR_RULESET
    }
  }

  const coverage = coverageOf(claims)
  const outcome: Outcome = coverage.claims_fail > 0 ? 'FAIL' : coverage.claims_insufficient > 0 || coverage.claims_checked === 0 ? 'INSUFFICIENT_DATA' : 'PASS'

  const input_hash = hashOf({ action, sources })
  const engine_version = engineFor(options.engine)
  // Engine 0.2.0: the id also binds the remedy table (protocol/verdict-id.ts verdictIdentity).
  const { verdict_id, remedy_table_hash } = verdictIdentity(input_hash, ruleset, engine_version, ACTION_REMEDIES)
  const issued_at = (options.now ?? (() => new Date()))().toISOString()

  const verdict: Verdict = {
    schema_version: SCHEMA_VERSION, verdict_id, issued_at, engine_version,
    ruleset: { ...ruleset }, input_hash, ...(remedy_table_hash !== undefined ? { remedy_table_hash } : {}), replayable: true,
    document: { extraction_hash: hashOf(action), ...(options.producer !== undefined ? { producer: options.producer } : {}), line_items: 0 },
    references: { contract: sources.allowed !== undefined || records !== undefined, evidence: 0, history: 0, source: prepared !== undefined },
    outcome, aggregation: 'ANY_FAIL_FAILS', claims, coverage,
  }
  // Typed remedies for every non-PASS claim, outside the hashed core (verdict/remedy.ts): the verdict_id above is unchanged.
  return attachScope(attachRemedies(verdict, { declared: (rule) => ACTION_REMEDIES[rule], document: 'action', sourceOfRole: () => 'sources' }))
}

/**
 * Remedies for a proposed action (2026-10-02; docs/REMEDIES.md): an ungrounded value is answered by re-proposing the call
 * with a value from its declared source (a new check), or by a person approving this one call as it stands. That approval is
 * call-scoped: it covers this call only and grounds nothing for the next one.
 */
const ACTION_REMEDIES: RemedyTable = {
  GROUNDED: {
    fail: [
      { kind: 'recompute-with', operand: { source: 'action', path: '{field}' },
        detail: 'The value at {field} is not in its declared source. The agent re-proposes the call with a value from the source; the new call is checked again.' },
      { kind: 'authority', authority: 'operator',
        detail: 'A person approves this one call as it stands; the approval covers this call only.' },
    ],
  },
  GROUNDED_RECORD: {
    fail: [
      { kind: 'recompute-with', operand: { source: 'action', path: '{field}' },
        detail: 'The values at {field} do not come together from one approved record. The agent re-proposes the call with the values of one record; the new call is checked again.' },
      { kind: 'authority', authority: 'operator',
        detail: 'A person approves this one call as it stands; the approval covers this call only.' },
    ],
  },
}
