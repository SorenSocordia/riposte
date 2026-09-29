/**
 * grant_cosign (MCP) over a chain export: the second signature of dual authorization (D-DUAL), offline.
 *
 * The co-signer signs with their own key, where it lives (makeCosign + signDecision, or `verify grant --cosign`): no private
 * key ever passes through here. Two calls:
 *   - without `cosign`: the unsigned GRANT_COSIGN for `grant` and `signer_id`, to be signed;
 *   - with `cosign` (a signed GRANT_COSIGN): it is put through the ledger's own door on the book as given, under the anchors
 *     given, and the chain line to append is returned. The door refuses a co-signature that would not count (the grant's own
 *     signer or key, a repeat, an unanchored or revoked co-signer, a superseded grant): a refusal is an error, and there is
 *     no line to append.
 * The grant's signatures, whether it is in force, and its pending notice are read under `policy` when given (./dual.ts).
 * The managed tier appends to its own book instead: POST /v1/grant/cosign.
 */

import { MemoryLedger } from '../ledger/memory.js'
import {
  makeCosign, grantInForce, DecisionRefused,
  type BookDecision, type DecisionEntry, type GrantCosignDecision, type GrantDecision, type GrantSignatures, type NoEffect, type SignedDecision,
} from '../ledger/decisions.js'
import { bookRefusal } from '../ledger/report.js'
import type { PromotionPolicy } from '../verdict/voice.js'
import { snapshotFromJson, anchorsFromJson, policyFromJson, SurfaceInputError } from './surfaces.js'
import { governedRead, governedSignatures, governing } from './dual.js'

export interface CosignSurface {
  surface_version: 'grant-cosign-v0'
  /** The grant named, as the book stands after the co-signature (or now, when only the unsigned body is asked for). */
  grant: { decision_id: string; workflow_id: string; level: string; signatures: GrantSignatures; in_force: boolean }
  /** Without `cosign`: the GRANT_COSIGN to sign with the co-signer's own key. */
  unsigned?: GrantCosignDecision
  /** With `cosign`: the entry the door accepted, and the chain line to append to the book (one JSON line, its payload inside). */
  appended?: DecisionEntry<BookDecision>
  line?: string
  chain: { length: number; head: string }
  /** What on the book has no effect for this workflow (the grant while still pending, an uncounted co-signature), with notices. */
  no_effect: NoEffect[]
}

const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x)

export function cosignFromJson(a: Record<string, unknown>, opts: { now?: () => Date } = {}): CosignSurface {
  const snap = snapshotFromJson(a.ledger)
  if (!snap.events) throw new SurfaceInputError('"ledger" is required: the book of record as the chain export (ledger.chainJSONL()) string, or { events, payloads }')
  const seed = { events: snap.events, payloads: snap.payloads ?? [] }
  const anchors = anchorsFromJson(a)
  const policy: PromotionPolicy | undefined = a.policy !== undefined ? policyFromJson(a.policy) : undefined
  const signed = a.cosign
  if (signed !== undefined && (!isObj(signed) || !isObj(signed.decision) || signed.decision.kind !== 'GRANT_COSIGN')) {
    throw new SurfaceInputError('"cosign" must be a signed GRANT_COSIGN: { decision: { kind: "GRANT_COSIGN", workflow_id, grant, level, signer_id, signed_at }, alg, public_key, signature, decision_id }')
  }
  const ref = signed !== undefined ? (signed as { decision: { grant?: unknown } }).decision.grant : a.grant
  if (typeof ref !== 'string' || !/^[0-9a-f]{12,}$/.test(ref)) {
    throw new SurfaceInputError('"grant" must be the grant\'s decision id (hex), or a unique prefix of at least 12 characters')
  }
  let led: MemoryLedger
  try {
    led = new MemoryLedger({ seed, ...anchors, ...(opts.now ? { now: opts.now } : {}) })
  } catch (e) {
    throw new SurfaceInputError(`the book could not be read: ${(e as Error).message}`)
  }
  const db = led.decisionBook()
  if (!db.ok) throw new SurfaceInputError(bookRefusal(db))
  const hits = db.decisions.filter(e => e.signed.decision.kind === 'GRANT' && (signed !== undefined ? e.decision_id === ref : e.decision_id.startsWith(ref)))
  if (hits.length !== 1) {
    throw new SurfaceInputError(hits.length ? `"grant" ${ref} names ${hits.length} grants on the book: give more of the decision id` : `no GRANT ${ref} on the book: a co-signature names a grant already on it`)
  }
  const named = hits[0] as DecisionEntry<GrantDecision>
  let unsigned: GrantCosignDecision | undefined
  let appended: DecisionEntry<BookDecision> | undefined
  let line: string | undefined
  if (signed === undefined) {
    if (typeof a.signer_id !== 'string' || !a.signer_id) throw new SurfaceInputError('"signer_id" is required: the co-signer (without "cosign", the unsigned GRANT_COSIGN is returned to sign)')
    if (a.signed_at !== undefined && typeof a.signed_at !== 'string') throw new SurfaceInputError('"signed_at" must be an ISO-8601 instant')
    const signed_at = (a.signed_at as string | undefined) ?? (opts.now ?? (() => new Date()))().toISOString()
    unsigned = makeCosign(named, { signer_id: a.signer_id, signed_at, ...(typeof a.note === 'string' ? { note: a.note } : {}) })
  } else {
    try {
      appended = led.decide(signed as unknown as SignedDecision<BookDecision>)
    } catch (e) {
      if (e instanceof DecisionRefused) throw new SurfaceInputError(`the co-signature is refused: ${e.message}`)
      throw new SurfaceInputError(`the co-signature could not be read: ${(e as Error).message}`)
    }
    const now = led.snapshot()
    const i = now.events.length - 1
    line = JSON.stringify({ ...now.events[i]!, payload: now.payloads[i] })
  }
  const after = led.decisionBook()
  const gov = governedRead(after, policy)
  const g = (after.decisions.find(e => e.decision_id === named.decision_id) ?? named) as DecisionEntry<GrantDecision>
  const gd = g.signed.decision
  return {
    surface_version: 'grant-cosign-v0',
    grant: {
      decision_id: g.decision_id, workflow_id: gd.workflow_id, level: gd.level,
      signatures: governedSignatures(g, after, policy),
      in_force: grantInForce(after.decisions, gd.workflow_id, governing(policy))?.decision_id === g.decision_id,
    },
    ...(unsigned ? { unsigned } : {}),
    ...(appended ? { appended, line: line! } : {}),
    chain: { length: after.check.length, head: after.check.head },
    no_effect: gov.no_effect({ workflow_id: gd.workflow_id }),
  }
}
