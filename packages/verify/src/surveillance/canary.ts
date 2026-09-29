/**
 * Canaries — measuring reviewer attention without telling the reviewer (2026-09-28, evidence-integrity lane).
 *
 * A canary is a verdict recorded on the book that a person who actually looks would OVERTURN (a known-bad item: e.g. a PASS
 * over an input seeded with an error the check cannot see). The operator (a `policy_author`: the control function, never a
 * reviewer) records the canaries like any other work, then SEALS them: the book carries only a salted commitment, so a
 * reviewer who reads the whole book still cannot tell which items they are. After review, the operator REVEALS the set and
 * the salt; the book checks the reveal reproduces the seal. Revealed canaries are never evidence about the workflow; the
 * reviewers' catch rate on them is (surveillance/evidence.ts), and a tier may require it before any overturn rate counts.
 *
 * Every FAIL can be disputed, and so can a canary: a reviewer who upheld one may dispute its label with the sealer (the
 * reveal names them). The label is a person's signed claim, not a verdict.
 */

import { randomBytes } from 'node:crypto'
import {
  canaryCommitment, decisionProblem, DecisionRefused,
  type CanaryRevealDecision, type CanarySealDecision, type DecisionEntry,
} from '../ledger/decisions.js'

/** 128 bits of fresh salt (hex). Not deterministic by design: a guessable salt would unseal the set. */
export function newSalt(): string {
  return randomBytes(16).toString('hex')
}

/** Build a CANARY_SEAL over recorded verdict ids (sign it with signDecision; append with ledger.decide). Keep the salt secret. */
export function sealCanaries(input: { workflow_id: string; verdict_ids: readonly string[]; salt: string; signer_id: string; signed_at: string; note?: string }): CanarySealDecision {
  const d: CanarySealDecision = {
    decision_version: 'decision-v0', kind: 'CANARY_SEAL', workflow_id: input.workflow_id,
    commitment: canaryCommitment(input.workflow_id, input.verdict_ids, input.salt),
    signer_id: input.signer_id, signed_at: input.signed_at, ...(input.note !== undefined ? { note: input.note } : {}),
  }
  if (!/^[0-9a-f]{32,}$/.test(input.salt)) throw new DecisionRefused('salt must be at least 32 hex characters (128 bits): use newSalt()')
  if (input.verdict_ids.length === 0) throw new DecisionRefused('a seal covers at least one canary')
  const problem = decisionProblem(d)
  if (problem) throw new DecisionRefused(problem)
  return d
}

/** Build the CANARY_REVEAL that opens a seal (by its sealer, after the canaries were reviewed). */
export function revealCanaries(seal: Pick<DecisionEntry<CanarySealDecision>, 'decision_id' | 'signed'>, input: { verdict_ids: readonly string[]; salt: string; signed_at: string; note?: string }): CanaryRevealDecision {
  const sd = seal.signed.decision
  const d: CanaryRevealDecision = {
    decision_version: 'decision-v0', kind: 'CANARY_REVEAL', workflow_id: sd.workflow_id, seal: seal.decision_id,
    verdict_ids: [...new Set(input.verdict_ids)].sort(), salt: input.salt,
    signer_id: sd.signer_id, signed_at: input.signed_at, ...(input.note !== undefined ? { note: input.note } : {}),
  }
  const problem = decisionProblem(d)
  if (problem) throw new DecisionRefused(problem)
  if (canaryCommitment(d.workflow_id, d.verdict_ids, d.salt) !== sd.commitment) throw new DecisionRefused('these ids and salt do not reproduce the seal\'s commitment')
  return d
}
