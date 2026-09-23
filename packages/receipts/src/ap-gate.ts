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
 */
import { verifyInvoiceMatch, type ApDecision, type ApDocuments, type ApPolicy, type ApResult } from 'riposte-verify'

export type ApAction = 'EXECUTE' | 'REVIEW'

export interface ApGateResult {
  action: ApAction
  /** the model's decision, as given */
  model_decision: string
  /** the deterministic checker's decision */
  checker_decision: ApDecision
  /** what the system will do: pay (EXECUTE approve), hold (EXECUTE hold_*), or route to a person */
  effect: 'PAY' | 'HOLD' | 'HUMAN_REVIEW'
  reason: string
  /** the checker's full result: grounding (what's wrong and where) + the replayable, signable verdict */
  check: ApResult
}

export function apGate(modelDecision: string, docs: ApDocuments, opts: { policy?: ApPolicy; now?: () => Date } = {}): ApGateResult {
  const check = verifyInvoiceMatch(docs, { ...(opts.policy ? { policy: opts.policy } : {}), ...(opts.now ? { now: opts.now } : {}) })
  const c = check.decision
  if (c === 'abstain') {
    return { action: 'REVIEW', model_decision: modelDecision, checker_decision: c, effect: 'HUMAN_REVIEW', check,
      reason: `the checker could not verify these documents (${check.reasons[0] ?? 'undecided'}) — not executing the model's "${modelDecision}"` }
  }
  if (c !== modelDecision) {
    return { action: 'REVIEW', model_decision: modelDecision, checker_decision: c, effect: 'HUMAN_REVIEW', check,
      reason: `the model says "${modelDecision}" but the checker says "${c}"${c !== 'approve' ? ` — ${check.reasons[0] ?? ''}` : ''}` }
  }
  return { action: 'EXECUTE', model_decision: modelDecision, checker_decision: c, effect: c === 'approve' ? 'PAY' : 'HOLD', check,
    reason: c === 'approve' ? 'model and checker agree: all four checks pass' : `model and checker agree: ${c} — ${check.reasons[0] ?? ''}` }
}
