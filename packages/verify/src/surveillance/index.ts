/**
 * Evidence integrity — so the evidence behind a grant cannot quietly rot or be gamed (2026-09-28, wave 3).
 *
 *   evidence.ts  the audit: which reviews a rung may rest on (random selection, signed reviews, segregation of duties,
 *                canaries), and the surveillance findings that make a demotion PROPOSAL fire under autonomy.
 *   plan.ts      the scheduled step (commit each closed period's draw) and a reviewer's queue.
 *   canary.ts    seal and reveal known-bad items, measured without telling the reviewer.
 * The ledger primitives live in ledger/sampling.ts (the draw), ledger/registry.ts (keys and roles) and ledger/decisions.ts.
 */

export {
  auditEvidence, auditApplies, samplingRates, chainOf, reviewsBy,
  type EvidenceAdjustment, type EvidenceCitation, type EvidenceAuditInput, type PeriodDraw, type SetAside,
} from './evidence.js'
export { dueSamples, commitDueSamples, reviewQueue, type PlanOptions, type QueueItem } from './plan.js'
export { newSalt, sealCanaries, revealCanaries } from './canary.js'
