/**
 * The governing policy as the surfaces read it (D-DUAL, D-GOVERNING-POLICY).
 *
 * The library resolves a grant's policy by the hash it names, so without more a single signer could escape a two-signature
 * tier by hand-building a GRANT of autonomy that names another policy (or a hash nobody holds) and states no count. A
 * deployment that declares a policy governs its own book: every GRANT is judged by the declared policy's tier requirements
 * (the tier declared, the rung within max_rung, grant_signatures on autonomy), whatever policy it names
 * (ledger/decisions.ts `governing_policy`, `governingProblem`). A grant that falls short has no effect: the rung falls back to
 * the grant in force before it, as D-ANCHOR does, and the grant is said with its notice. A grant that names another policy
 * says so. Without a declared policy the count the grant states governs (the library read, unchanged).
 *
 * The notices live in the ledger (decisions.ts `governedNoEffect`, `governedNotices`, `governedSignatures`), so the report
 * says them too. This file carries that reading to the readers the surfaces call but do not own (report.ts `readRung` takes
 * the book whose decisions it selects from).
 */

import {
  governedNoEffect, governedNotices, governedSignatures, governingRead, inadmissibleGrants,
  type DecisionBook, type NoEffect,
} from '../ledger/decisions.js'
import type { PromotionPolicy } from '../verdict/voice.js'

type Book = Pick<DecisionBook, 'decisions' | 'canaries' | 'cosigns'>

/** The read options for a deployment's policy: it is known (by hash) and it governs every grant. */
export const governing = governingRead

export { governedSignatures }

/** The book as the deployment reads it, and what it holds with no effect on a rung. */
export interface GovernedRead<B extends Book> {
  /** The book with every GRANT the governing policy does not admit removed from `decisions`, so any reader skips it. */
  book: B
  /** What has no effect (noEffect's list under the policy, plus every grant the governing policy does not admit), in chain order. */
  no_effect: (filter?: { workflow_id?: string; policy_id?: string }) => NoEffect[]
  /** For the grant in force for a workflow: that it names another policy and is judged under the governing one, if so. */
  notices: (workflow_id: string) => string[]
}

/** Read a verified book under the deployment's governing policy. Without one it is the library's read, unchanged. */
export function governedRead<B extends Book>(db: B, policy: PromotionPolicy | undefined): GovernedRead<B> {
  const inert = inadmissibleGrants(db, policy)
  const book = inert.size ? { ...db, decisions: db.decisions.filter(e => !inert.has(e.decision_id)) } : db
  return {
    book,
    no_effect: (filter = {}) => governedNoEffect(db, policy, filter),
    notices: workflow_id => governedNotices(db.decisions, workflow_id, policy),
  }
}
