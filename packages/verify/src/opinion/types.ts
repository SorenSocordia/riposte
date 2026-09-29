/**
 * The courtroom opinion — the shape (the 2026-09-24 format, productized).
 *
 *   the question · the candidate readings with cited cells · the authorities quoted · precedent · the footing consequences
 *   of each reading · the ruling and its scope · the steelmanned dissent · what would overturn it
 *
 * plus the PREMISES: every factual statement the opinion rests on, each with the replayable ids it cites (verdict ids,
 * ledger event hashes, the chain head, the policy hash) and the Riposte check that verified it. That is what makes the
 * opinion self-verifying: if any premise fails its check, the opinion proposes nothing (disposition WITHHELD).
 *
 * An opinion speaks on the COUNSEL channel: it is generated (by deterministic code, never a model), it carries its
 * premise checks as judge results, and a person may dismiss or overrule it. The verdicts it cites are FACT; the opinion
 * is advice about what follows from them. It can never be serialized as a VERDICT (see verdict/channel.ts).
 */

import type { Outcome, Value } from '../verdict/schema.js'
import type { GeneratedProvenance, JudgeResult } from '../verdict/channel.js'
import type { VoiceLevel } from '../verdict/voice.js'
import type { ReviewDecision } from '../ledger/types.js'

export const OPINION_VERSION = 'opinion-v0' as const
export const OPINION_GENERATOR = 'riposte-opinion'
export const OPINION_GENERATOR_VERSION = '0.1.0'

/** A replayable reference: something a third party can re-derive or look up on the ledger without trusting us. */
export type OpinionRef =
  | { kind: 'verdict'; verdict_id: string; record_event?: { seq: number; entry_hash: string }; review_event?: { seq: number; entry_hash: string } }
  | { kind: 'evidence_set'; label: string; count: number; hash: string; verdict_ids: string[] }
  | { kind: 'ledger_head'; head: string; length: number }
  | { kind: 'policy'; policy_id: string; version: string; hash: string }
  | { kind: 'calibration'; workflow_id: string; hash: string }
  /** A person's signed decision on the book of record (ledger/decisions.ts): its id re-derives, its signature re-verifies. */
  | { kind: 'decision'; decision_kind: 'GRANT' | 'DECLINE' | 'POLICY_REVISION'; decision_id: string; seq: number; entry_hash: string }

/** A signed decision as an opinion cites it: where it sits on the chain. */
export interface DecisionCite { decision_id: string; seq: number; entry_hash: string }

/**
 * Read the book for one tenant only (a hosted, multi-tenant book). The chain is still verified WHOLE (its hashes cover every
 * tenant), but the opinion's records, precedent, evidence and decisions are the tenant's own: another tenant's reviews,
 * reviewer ids, notes and decisions are never read into it.
 */
export interface OpinionScope {
  tenant_id: string
  /** Does a workflow belong to this tenant? Default: its id starts with `<tenant_id>/` (the default keyer, tenant/ruleset@version). */
  owns_workflow?: (workflow_id: string) => boolean
}

export interface Premise {
  /** 'P1', 'P2', … */
  id: string
  statement: string
  /** The Riposte check that verified it (a function in this package). */
  check: string
  refs: OpinionRef[]
  verified: boolean
  detail: string
}

/** A value the reading relies on, and the premise that verifies it. */
export interface CitedCell {
  cell: string
  value: Value
  premise: string
}

export interface Reading {
  id: 'A' | 'B'
  label: string
  statement: string
  cells: CitedCell[]
  /** What follows if this reading is adopted (the footing consequence). */
  consequence: string
}

export interface Authority {
  source: string
  cite: string
  quote: string
}

export interface PrecedentEntry {
  verdict_id: string
  outcome: Outcome
  decision: ReviewDecision
  reviewer_id?: string
  decided_at?: string
  note?: string
  ref: OpinionRef
  /** The dispute path for this single case. */
  dispute: string
}

export interface Precedent {
  summary: string
  entries: PrecedentEntry[]
}

/**
 * DECLINED: a person already answered the proposal the evidence raises ("keep it" on a demotion, "not yet" on a promotion),
 * and their signed decline still stands. Shown as declined, never as a fresh ask, until the evidence it saw changes.
 */
export type Disposition = 'PROPOSE_PROMOTION' | 'NOT_YET' | 'PROPOSE_DEMOTION' | 'RETAIN' | 'DECLINED' | 'UPHOLD' | 'REFER' | 'WITHHELD'

/** A person's signed "no" that holds the proposal back, as the ruling quotes it. */
export interface DeclinedBy extends DecisionCite {
  signer_id: string
  signed_at: string
  reason: string
  proposal_kind: 'PROMOTION_PROPOSAL' | 'DEMOTION_PROPOSAL'
  /** Why it still stands (declineStanding). */
  why: string
  /** What would re-raise the proposal. */
  re_raise_when: string
}

export interface Ruling {
  disposition: Disposition
  /** The reading the ruling adopts; null when withheld. */
  favors: 'A' | 'B' | null
  statement: string
  scope: string
  /** An opinion never grants anything: it is always a proposal. The rung changes only by a person's decision. */
  status: 'PROPOSED'
  /** A demotion proposal: the record no longer supports what a person granted. Shown first, never applied. */
  urgent?: true
  /** When (and whether) anything changes: on a person's signature, or already (authority withdrawn by evidence), or nothing. */
  takes_effect: string
  note?: string
  /** DECLINED only: the person's standing decline the ruling rests on. */
  declined?: DeclinedBy
}

export type DissentTopic =
  | 'sample_size' | 'confidence_interval' | 'counter_cases' | 'consequence_tier'
  | 'selection' | 'reviewer' | 'window' | 'tolerance' | 'normalization' | 'law' | 'coverage'

export interface DissentPoint {
  topic: DissentTopic
  argument: string
  premise?: string
}

export interface OverturnCondition {
  /** The specific evidence that would overturn the ruling. */
  evidence: string
  /** What happens then. */
  effect: string
  premise?: string
}

export type OpinionSubject =
  | {
    kind: 'PROMOTION'
    /** PROMOTE: should it climb one rung? RETAIN: does the record still support the top rung? DEMOTE: should it step down one rung? */
    question_kind: 'PROMOTE' | 'RETAIN' | 'DEMOTE'
    workflow_id: string
    granted: VoiceLevel
    earned: VoiceLevel
    focus: VoiceLevel
    /** The rung the question would move the workflow to (one step), or the granted rung for RETAIN. */
    to: VoiceLevel
    /** The proposal the evidence raises (for DECLINED: the one the person's decline holds back). */
    proposal_id?: string
    /** Where the rung was read from: a person's signed GRANT on the book, or the caller's declaration (no GRANT on the book). */
    rung_source: 'BOOK' | 'DECLARED'
    /** The GRANT in force: the decision a ruling here would amend. Absent when nothing is granted on the book. */
    amends?: DecisionCite
    /** The person's standing DECLINE of this proposal (disposition DECLINED). */
    declined?: DecisionCite
    /** The tenant the opinion was scoped to. */
    tenant_id?: string
  }
  | {
    kind: 'DISPUTE'; verdict_id: string; claim_id: string; rule_id: string; outcome: Outcome; tier: 'DETERMINISTIC' | 'REASONED'
    /** The ruleset of the disputed verdict (the precedent → statute loop groups rulings by it). */
    ruleset: { id: string; version: string; domain: string }
    /** The precedent rule the opinion applied, resolved (so the opinion re-derives from the book alone). */
    precedent_rule: { min_reviewed: number; flag_threshold: number; confidence: number; method: 'wilson' | 'clopper-pearson' }
    /** The declared consequence the dissent argued from, when one was given. */
    consequence?: { tier: string; description?: string }
    /** True when the opinion was also bound to the original inputs (they are needed to re-derive it). */
    input_bound?: true
    /** The tenant the opinion was scoped to. */
    tenant_id?: string
  }

export interface Opinion {
  opinion_version: typeof OPINION_VERSION
  channel: 'COUNSEL'
  provenance: GeneratedProvenance
  dismissible: true
  /** Deterministic: first 32 hex of sha256 over the canonical opinion body. No clock anywhere. */
  opinion_id: string
  subject: OpinionSubject
  title: string
  question: string
  readings: Reading[]
  authorities: Authority[]
  precedent: Precedent
  ruling: Ruling
  dissent: DissentPoint[]
  overturn: OverturnCondition[]
  premises: Premise[]
  /** The premises as judge results: the COUNSEL contract (the checks that justified surfacing it). */
  judges: JudgeResult[]
  /** Every premise verified. False means the ruling is WITHHELD. */
  verified: boolean
}
