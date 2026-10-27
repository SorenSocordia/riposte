/**
 * The book's door for action verdicts: each version held to its own rules (action@0.2.0, 2026-09-29). Called by
 * recordedVerdictProblem (ledger/decisions.ts), which the HTTP door delegates to, so both doors agree.
 *
 *   0.2.0   every PASS/FAIL claim carries its computation, whose result agrees with its outcome, and names the same
 *           consequential arguments (`required`); every required argument has exactly one claim, in order. Every PASS grounded
 *           in an approved value (an allow-list entry or a record) names the comparison it used (`type`) and the approved value
 *           as written (`approved`), and they recompute as the same value as the asserted one. Record claims never mix PASS
 *           with FAIL or can't-tell (a record is grounded as a whole), and every record PASS cites the same record.
 *           So a FAIL flipped to PASS, all FAILs flipped, a FAIL claim deleted, or a comparison swapped for one that does not
 *           recompute is refused, with the outcome and coverage rewritten to match.
 *   0.1.0,  a PASS grounded in an approved value cites a value equal to the asserted one as written (the rule before 0.2.0),
 *   0.0.1   so a 0.2.0 PASS in another written form relabelled to an earlier version to dodge the recompute is refused. Every
 *           verdict those versions issued reads as before.
 * Other versions are not held here.
 *
 * HONEST BOUNDARY: a claim whose operands are rewritten together with its outcome (a forged `approved` value), a FAIL
 * rewritten as can't-tell, or a verdict relabelled to a version this build does not know cannot be told from a genuine one
 * without the inputs. Replay with the inputs refuses them, and so does a signed envelope.
 */

import { compareValues, comparisonFromCode } from './equivalence.js'

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const isScalar = (x: unknown): x is string | number | boolean => typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean'
/** A PASS grounded in an approved value: an allow-list entry (GROUNDED, cross-reference) or a record (GROUNDED_RECORD). */
const groundedInApproved = (c: Record<string, unknown>): boolean =>
  c.kind === 'CROSS_REFERENCE' && (c.rule_id === 'GROUNDED' || c.rule_id === 'GROUNDED_RECORD')

/** The first reason an action verdict breaks its own version's rules, or undefined. Non-action verdicts are not held here. */
export function actionVersionProblem(v: unknown): string | undefined {
  if (!isObj(v) || !isObj(v.ruleset) || v.ruleset.id !== 'action' || !Array.isArray(v.claims)) return undefined
  const version = v.ruleset.version
  const id = String(v.verdict_id)
  const claims = v.claims.filter(isObj)

  if (version === '0.0.1' || version === '0.1.0') {
    for (const c of claims) {
      if (c.outcome !== 'PASS' || !groundedInApproved(c)) continue
      const ev = Array.isArray(c.evidence) && isObj(c.evidence[0]) ? c.evidence[0] : undefined
      if (!ev || !isScalar(c.asserted) || !isScalar(ev.value) || String(ev.value) !== String(c.asserted)) {
        return `verdict ${id}: claim ${String(c.claim_id)} is an action@${version} PASS, which cites a value equal to the asserted one as written; it cites ${JSON.stringify(ev?.value ?? null)} for ${JSON.stringify(c.asserted)} (a match in another written form is action@0.2.0's, and is recomputed there)`
      }
    }
    return undefined
  }
  if (version !== '0.2.0') return undefined

  let required: unknown[] | undefined
  let record: number | undefined
  const recordOutcomes = new Set<unknown>()
  for (const c of claims) {
    if (c.rule_id === 'GROUNDED_RECORD') recordOutcomes.add(c.outcome)
    if (c.outcome !== 'PASS' && c.outcome !== 'FAIL') continue
    const where = `verdict ${id}: claim ${String(c.claim_id)}`
    const comp = isObj(c.computation) ? c.computation : undefined
    const ops = comp && isObj(comp.operands) ? comp.operands : undefined
    if (!comp || !ops) return `${where} is an action@0.2.0 ${String(c.outcome)} and carries no computation to recompute`
    if (comp.result !== (c.outcome === 'PASS')) return `${where} is ${String(c.outcome)}, but its computation's result is ${JSON.stringify(comp.result)}`
    if (!Array.isArray(ops.required) || !ops.required.every(x => typeof x === 'string')) return `${where} does not name the consequential arguments (operands.required)`
    if (required === undefined) required = ops.required
    else if (JSON.stringify(ops.required) !== JSON.stringify(required)) return `${where} names consequential arguments ${JSON.stringify(ops.required)}, but another claim names ${JSON.stringify(required)}`
    if (!groundedInApproved(c) || c.outcome !== 'PASS') continue

    const cmp = comparisonFromCode(ops.type)
    if (!cmp) return `${where} names no known comparison (operands.type ${JSON.stringify(ops.type ?? null)})`
    const approved = ops.approved
    if ((typeof approved !== 'string' && typeof approved !== 'number') || !isScalar(c.asserted)) return `${where} does not carry the approved value as written (operands.approved) and a scalar asserted value`
    if (compareValues(approved, c.asserted, cmp).kind === 'different') {
      return `${where} is PASS, but its approved value ${JSON.stringify(approved)} and the asserted ${JSON.stringify(c.asserted)} are not the same value under ${String(ops.type)}`
    }
    const ev = Array.isArray(c.evidence) && isObj(c.evidence[0]) ? c.evidence[0] : undefined
    const cited = ev ? (ev.original !== undefined ? ev.original : ev.value) : undefined
    if (!ev || (ev.original !== undefined ? JSON.stringify(cited) !== JSON.stringify(approved) : String(cited) !== String(approved))) {
      return `${where}: its evidence cites ${JSON.stringify(cited ?? null)}, not the approved value ${JSON.stringify(approved)} it recomputes from`
    }
    if (c.rule_id === 'GROUNDED_RECORD') {
      const i = ops.record
      const path = isObj(ev.locator) ? ev.locator.path : undefined
      if (typeof i !== 'number' || path !== `records[${i}].${String(c.field)}`) return `${where} does not cite its record consistently (operands.record ${JSON.stringify(i ?? null)}, evidence ${JSON.stringify(path ?? null)})`
      if (record !== undefined && i !== record) return `${where} cites records[${i}], but another record-named argument is grounded in records[${record}]: a record is grounded as a whole`
      record = i
    }
  }
  if (recordOutcomes.has('PASS') && (recordOutcomes.has('FAIL') || recordOutcomes.has('INSUFFICIENT_DATA'))) {
    return `verdict ${id}: its record claims mix PASS with ${recordOutcomes.has('FAIL') ? 'FAIL' : 'can\'t-tell'}, but a record is grounded only as a whole`
  }
  if (required !== undefined) {
    const expected = required.map(k => `arg.${String(k)}`)
    const actual = claims.map(c => c.claim_id)
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      return `verdict ${id}: an action@0.2.0 verdict has exactly one claim per consequential argument (${expected.join(', ')}), in order; it has ${actual.map(String).join(', ')}`
    }
  }
  return undefined
}
