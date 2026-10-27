/**
 * The AP decision gate — "the model decides, the checker recomputes, only agreement executes."
 *
 *   const g = apGate('approve', { invoice, purchase_order, goods_receipt })
 *   g.action === 'EXECUTE'  → act on the model's decision automatically (pay, or file the hold)
 *   g.action === 'REVIEW'   → a person looks: the checker disagrees, or could not read the documents
 *
 * Measured (../verify/docs/BENCHMARK-AP.md, Result 2): on Distil Labs' public AP benchmark, gating seven
 * published AI configurations this way caught 111/111 wrong decisions (57 wrong approvals) with zero wrong auto-executions,
 * while 63–82% of invoices executed without a human. Synthetic invoices — expect more REVIEW on real ones.
 *
 * REMEDIES AND RULINGS (2026-10-02). A REVIEW carries the verdict's typed remedies (what would lawfully clear it). One of them
 * may be a person's AUTHORITY over a rule (the buyer over a price variance). A signed ruling by that person (./ruling.ts) is
 * consumed here only when it names THIS verdict, is signed by a key pinned for its role, stays within that role's mandate,
 * and was not consumed before:
 *   deny   → EXECUTE the hold, on the person's decision
 *   allow  → when the model proposed to pay and the allowing rulings together cover EVERY open rule of the verdict, EXECUTE
 *            the payment, on the person's decision. Anything less stays REVIEW, naming what is not covered.
 * The verdict is unchanged either way (the FAIL stays on the record); a ruling for another verdict is ignored here.
 *
 * STRUCTURED INPUT (2026-10-03). The documents may be the three texts (ruleset ap-threeway) or structured input, a bill,
 * its PO and its item receipts as JSON (verify's ApStructuredInput, ruleset ap-structured). Same checks, same decision. The
 * model may also say a bare "hold": it agrees with any hold the checker finds (the effect, HOLD, is the same).
 *
 * OPEN (2026-10-04). The gate reads verify's gateStatusOpen: a verdict with a struck load-bearing field
 * (engine 0.3.0, `would_unlock`) is OPEN, which is neither PASS nor FAIL. OPEN never executes, whatever the model and the
 * checker say: it goes to a person, naming the struck fields, and resolves by evidence. Today's AP engine strikes no field, so
 * an AP verdict reads OPEN only when it carries `would_unlock`; every other reading is unchanged.
 */
import { verifyInvoiceMatch, verifyBillMatch, isApStructured, gateStatusOpen, hasStruckLoadBearing, openClaims, type GateStatusOpen, type ApDecision, type ApDocuments, type ApPolicy, type ApResult, type ApStructuredInput, type ApStructuredDocuments, type Remedy } from 'riposte-verify'
import { checkRuling, openRules, type Authorities, type RulingCheck } from './ruling.js'

export type ApAction = 'EXECUTE' | 'REVIEW'

export interface ApGateResult {
  action: ApAction
  /** the model's decision, as given */
  model_decision: string
  /** the deterministic checker's decision */
  checker_decision: ApDecision
  /**
   * the verdict as a gate reads it (verify's gateStatusOpen): PASS-WITH-OPEN never executes a payment (2026-10-03), and
   * OPEN (a struck load-bearing field, 2026-10-04) never executes anything
   */
  status: GateStatusOpen
  /** what the system will do: pay (EXECUTE approve), hold (EXECUTE hold_*), or route to a person */
  effect: 'PAY' | 'HOLD' | 'HUMAN_REVIEW'
  reason: string
  /** the checker's full result: grounding (what's wrong and where) + the replayable, signable verdict */
  check: ApResult
  /** the verdict's typed remedies (what would lawfully clear it), when it has any */
  remedies?: Remedy[]
  /** present when rulings naming this verdict were offered: which were consumed, and why the others were refused */
  ruling?: { consumed: string[]; refused: { ruling_id?: string; reason: string }[] }
  /**
   * present when the gate held because the checker said approve but the verdict did not read PASS (2026-10-04): the
   * status it read, so the receipt names it. Absent on every other result, so no other receipt moves.
   */
  refusal?: { code: 'status.unexpected'; status: string; detail: string }
}

export interface ApGateOptions {
  policy?: ApPolicy
  now?: () => Date
  /** signed authority rulings (any verdict's: only those naming this verdict are considered) */
  rulings?: readonly unknown[]
  /** role → pinned public key(s): a ruling counts only when one of them signed it */
  authorities?: Authorities
  /** ruling ids already consumed (a ruling is spent once) */
  consumed?: ReadonlySet<string>
  /**
   * Re-perform under this engine and ruleset (2026-10-05): a replay re-derives a recorded gate reading under the engine and
   * ruleset its verdict names, never this build's default. Absent: this build's (a live gate call).
   */
  engine?: string
  ruleset?: string | { id: string; version: string }
}

const namesVerdict = (x: unknown, id: string): boolean =>
  typeof x === 'object' && x !== null && typeof (x as { ruling?: { verdict_id?: unknown } }).ruling === 'object' && (x as { ruling: { verdict_id?: unknown } }).ruling.verdict_id === id

/** The documents the gate checks: the three texts, or structured input (a bill, its PO, its item receipts). */
export type ApGateDocuments = ApDocuments | ApStructuredInput | ApStructuredDocuments

export function apGate(modelDecision: string, docs: ApGateDocuments, opts: ApGateOptions = {}): ApGateResult {
  const o = { ...(opts.policy ? { policy: opts.policy } : {}), ...(opts.now ? { now: opts.now } : {}), ...(opts.engine ? { engine: opts.engine } : {}), ...(opts.ruleset ? { ruleset: opts.ruleset } : {}) }
  const check = isApStructured(docs) ? verifyBillMatch(docs, o) : verifyInvoiceMatch(docs, o)
  return apGateOnCheck(modelDecision, check, opts)
}

/** The only reading an automatic payment executes on: exactly PASS, with no struck load-bearing field. */
const paysOn = (status: unknown, verdict: ApResult['verdict']): boolean => status === 'PASS' && !hasStruckLoadBearing(verdict)
/** The readings a person's allowing ruling may pay, when it covers every open rule. */
const RULING_PAYS_ON: ReadonlySet<string> = new Set(['FAIL', 'PASS-WITH-OPEN'])

/** The gate's decision on a checker result already in hand (apGate runs the checker, then this). */
export function apGateOnCheck(modelDecision: string, check: ApResult, opts: Pick<ApGateOptions, 'rulings' | 'authorities' | 'consumed'> = {}): ApGateResult {
  const c = check.decision
  const status = gateStatusOpen(check.verdict)
  const remedies = check.verdict.remedies
  const withRemedies = remedies ? { remedies } : {}
  // An open check holds: the policy decision reads only the checks it needs, in order, so a PASS verdict that still
  // carries a claim that could not run is never paid on. A hold stays a hold (more checks never make a hold less safe).
  const stillOpen = c === 'approve' && status === 'PASS-WITH-OPEN' ? openClaims(check.verdict) : []
  let gate: ApGateResult
  if (status === 'OPEN') {
    // a struck load-bearing field: not PASS, not FAIL. Nothing executes; a person resolves it with evidence.
    const struck = (check.verdict.struck ?? []).map((s) => `${s.field} (${s.reason})`)
    const fields = struck.length ? struck : (check.verdict.would_unlock ?? []).filter((w) => w.claims.length).map((w) => w.field)
    gate = { action: 'REVIEW', model_decision: modelDecision, checker_decision: c, status, effect: 'HUMAN_REVIEW', check, ...withRemedies,
      reason: `OPEN: ${fields.join(', ') || 'a load-bearing field'} ${fields.length === 1 ? 'is' : 'are'} struck, so the verdict is neither PASS nor FAIL — not executing the model's "${modelDecision}"` }
  } else if (c === 'abstain') {
    gate = { action: 'REVIEW', model_decision: modelDecision, checker_decision: c, status, effect: 'HUMAN_REVIEW', check, ...withRemedies,
      reason: `the checker could not verify these documents (${check.reasons[0] ?? 'undecided'}) — not executing the model's "${modelDecision}"` }
  } else if (stillOpen.length) {
    gate = { action: 'REVIEW', model_decision: modelDecision, checker_decision: c, status, effect: 'HUMAN_REVIEW', check, ...withRemedies,
      reason: `PASS-WITH-OPEN: every check that ran passed, but ${stillOpen.length} could not run (${stillOpen.map((x) => x.claim_id).join(', ')}) — not executing the model's "${modelDecision}"` }
  } else if (c !== modelDecision && !(modelDecision === 'hold' && c.startsWith('hold_'))) {
    gate = { action: 'REVIEW', model_decision: modelDecision, checker_decision: c, status, effect: 'HUMAN_REVIEW', check, ...withRemedies,
      reason: `the model says "${modelDecision}" but the checker says "${c}"${c !== 'approve' ? ` — ${check.reasons[0] ?? ''}` : ''}` }
  } else if (c === 'approve' && !paysOn(status, check.verdict)) {
    // FAIL CLOSED (2026-10-04): a payment executes ONLY on exactly PASS with no struck
    // load-bearing field. A checker decision of "approve" beside any other reading (FAIL, INSUFFICIENT_DATA, a status this
    // build does not know) is held, never paid, and the receipt names the status.
    const refusal = { code: 'status.unexpected' as const, status: String(status), detail: `the checker says "approve" but the verdict reads ${String(status)}; a payment executes only on PASS` }
    gate = { action: 'REVIEW', model_decision: modelDecision, checker_decision: c, status, effect: 'HUMAN_REVIEW', check, ...withRemedies, refusal,
      reason: `${refusal.code}: ${refusal.detail} — not executing the model's "${modelDecision}"` }
  } else {
    return { action: 'EXECUTE', model_decision: modelDecision, checker_decision: c, status, effect: c === 'approve' ? 'PAY' : 'HOLD', check, ...withRemedies,
      reason: c === 'approve' ? 'model and checker agree: every check passes' : `model and checker agree: ${c} — ${check.reasons[0] ?? ''}` }
  }

  // REVIEW. A person's signed ruling on THIS verdict may resolve it; nothing else does.
  const id = check.verdict.verdict_id
  const offered = (opts.rulings ?? []).filter((x) => namesVerdict(x, id))
  if (!offered.length) return gate
  const checks: RulingCheck[] = offered.map((x) => checkRuling(x, check.verdict, { ...(opts.authorities ? { authorities: opts.authorities } : {}), ...(opts.consumed ? { consumed: opts.consumed } : {}) }))
  const refused = checks.filter((k) => !k.ok).map((k) => ({ ...(k.ruling_id ? { ruling_id: k.ruling_id } : {}), reason: k.reason ?? 'refused' }))
  const valid = checks.filter((k) => k.ok)
  const deny = valid.find((k) => k.decision === 'deny')
  if (deny) {
    return { ...gate, action: 'EXECUTE', effect: 'HOLD', ruling: { consumed: [deny.ruling_id!], refused },
      reason: `held on ${deny.by}'s ruling ${deny.ruling_id} (deny, this verdict only): the checker says "${c}"` }
  }
  const allows = valid.filter((k) => k.decision === 'allow')
  const open = openRules(check.verdict)
  const covered = new Set(allows.flatMap((k) => k.rules ?? []))
  const uncovered = open.filter((r) => !covered.has(r))
  // A person's allowing ruling pays a verdict whose open rules it covers, on exactly the readings a mandate can answer: FAIL
  // (the rule a buyer's authority overrides) or PASS-WITH-OPEN. Never OPEN (evidence resolves it), INSUFFICIENT_DATA, or a
  // status this build does not know (2026-10-04: an allow-list, not a comparison with one literal).
  if (allows.length && modelDecision === 'approve' && !uncovered.length && RULING_PAYS_ON.has(String(status))) {
    // Only the rulings that cover something open are spent.
    const used = allows.filter((k) => (k.rules ?? []).some((r) => open.includes(r)))
    return { ...gate, action: 'EXECUTE', effect: 'PAY', ruling: { consumed: used.map((k) => k.ruling_id!), refused },
      reason: `the checker says "${c}"; paid on ${used.map((k) => `${k.by}'s ruling ${k.ruling_id}`).join(' and ')} (allow, this verdict only: ${open.join(', ')}). The verdict is unchanged.` }
  }
  const why = !allows.length ? 'no ruling offered for this verdict can be honoured'
    : status === 'OPEN' ? 'the verdict is OPEN: a struck field resolves by evidence, never by an allowing ruling'
    : !RULING_PAYS_ON.has(String(status)) ? `the verdict reads ${String(status)}: an allowing ruling pays only a FAIL or PASS-WITH-OPEN verdict it covers`
    : modelDecision !== 'approve' ? `the model proposed "${modelDecision}", not a payment, so an allowing ruling has nothing to clear`
      : `the rulings do not cover ${uncovered.join(', ')}`
  return { ...gate, ruling: { consumed: [], refused }, reason: `${gate.reason} (${why})` }
}
