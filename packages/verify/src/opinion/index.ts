/**
 * Opinions — the courtroom format, rendered by deterministic code over the book of record.
 *
 *   const snap = snapshotOfLedger(ledger)                                     // the chain, content-verified on read
 *   const op = promotionOpinion({ snapshot: snap, policy, proposal })         // or { declaration } / { workflow_id } / disputeOpinion(...)
 *   renderOpinion(op)   // Markdown under the fixed headings
 *   opinionJSON(op)     // the source of truth; every premise cites replayable ids
 *
 * An opinion is COUNSEL: generated, judged (its premises are its judges), dismissible. It proposes; a person signs.
 *
 * The book of record (2026-09-28): an opinion reads the rung from a person's signed GRANT on the book and cites it as the
 * decision it would amend; a standing DECLINE shows as DECLINED, never a fresh ask. `scope: { tenant_id }` reads one
 * tenant's records only (a shared, hosted book). Precedent → statute: a person's signed ruling on a dispute (ruling.ts)
 * becomes a case-table row for the miner, whose candles come back as COUNSEL (statute.ts): the customer's own rulebook.
 */

export { promotionOpinion, type PromotionOpinionInput } from './promotion.js'
export { disputeOpinion, type DisputeOpinionInput } from './dispute.js'
export { renderOpinion, opinionJSON } from './render.js'
export {
  openSnapshot, snapshotOfLedger, snapshotFromChainJSONL, defaultOwnsWorkflow,
  type LedgerSnapshot, type SnapshotView, type SnapshotOptions,
} from './snapshot.js'
export { opinionIntact } from './common.js'
export {
  disputeRuling, signRuling, verifySignedRuling, rulingProblem, rulingId, rulingBookJSONL, parseRulingBook,
  RULING_SIGNING_PREFIX, LAW_RULINGS,
  type DisputeRuling, type SignedRuling, type LawRuling, type RulingCheck, type OpinionParams,
} from './ruling.js'
export {
  statuteFromRulings, statuteCounsel, statuteIntact, statuteMineFiles, STATUTE_VERSION, STATUTE_GENERATOR,
  type Statute, type StatuteInput, type StatuteRow, type StatuteCell,
} from './statute.js'
export { OPINION_VERSION, OPINION_GENERATOR, OPINION_GENERATOR_VERSION } from './types.js'
export type {
  Opinion, OpinionRef, OpinionSubject, Premise, Reading, CitedCell, Authority, Precedent, PrecedentEntry, Ruling, Disposition,
  DissentPoint, DissentTopic, OverturnCondition, OpinionScope, DecisionCite, DeclinedBy,
} from './types.js'
