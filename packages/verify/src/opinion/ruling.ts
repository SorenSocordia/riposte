/**
 * A person's signed ruling on LAW: the precedent half of precedent → statute (2026-09-28, a first stone).
 *
 * A dispute opinion (dispute.ts) separates FACT (the recomputation: it replays, and is never re-ruled) from LAW (whether
 * the rule binds this document: a person's call). It PROPOSES UPHOLD or REFER; a person rules. This module makes that
 * ruling durable and checkable:
 *
 *   STANDS     the rule binds this document as written: its finding stands (a FAIL holds the document; a PASS clears it).
 *   SET_ASIDE  the rule does not bind this document as written: its finding is set aside (a FAIL is released; a PASS is
 *              overturned and the document held).
 *
 * The ruling names the opinion it answers (its content-derived id) and the book that opinion was read from (head and
 * length). Because the chain is append-only, anyone holding a later book can cut it back to that length, re-derive the
 * opinion, and check that the person ruled on exactly what Riposte proposed (statute.ts does). Only a VERIFIED dispute
 * opinion on a DETERMINISTIC PASS/FAIL finding can be ruled on: a withheld opinion has no FACT under it, a judgement-tier
 * finding is an advisory (not a rule's LAW), and an abstention cannot be ruled into data.
 *
 * Signed with Ed25519 (node:crypto, as decisions and verdict envelopes are) over a DOMAIN-SEPARATED canonical body
 * (`riposte:ruling:v0\n`): a ruling signature is never valid as a decision or a verdict signature, or the reverse.
 * HONEST BOUNDARY: a signature proves the key holder ruled; `trusted_keys` binds keys to people. Rulings are not yet events
 * on the book of record (the ledger lane's to add as a decision kind); today they are kept as a signed ruling book (JSONL).
 */

import { createPrivateKey, createPublicKey, sign as edSign, verify as edVerify } from 'node:crypto'
import { canonicalize, hashOf } from '../verdict/canonical.js'
import type { TrustedKeys } from '../ledger/decisions.js'
import { opinionIntact } from './common.js'
import type { Opinion } from './types.js'

export const RULING_SIGNING_PREFIX = 'riposte:ruling:v0\n'

export type LawRuling = 'STANDS' | 'SET_ASIDE'
export const LAW_RULINGS: readonly LawRuling[] = ['STANDS', 'SET_ASIDE']

/** The dispute opinion's resolved arguments, so it re-derives from the book alone. */
export interface OpinionParams {
  min_reviewed: number
  flag_threshold: number
  confidence: number
  method: 'wilson' | 'clopper-pearson'
  consequence?: { tier: string; description?: string }
  /** The opinion was also bound to the original inputs: re-deriving it needs them. */
  input_bound?: true
}

export interface DisputeRuling {
  ruling_version: 'ruling-v0'
  kind: 'DISPUTE_RULING'
  /** The dispute opinion ruled on (its content-derived id). */
  opinion_id: string
  /** The book that opinion was read from: its head and length (a prefix of every later book). */
  book: { head: string; length: number }
  /** The tenant the opinion was scoped to (a shared book). A scoped statute reads only its tenant's rulings. */
  tenant_id?: string
  verdict_id: string
  claim_id: string
  rule_id: string
  ruleset: { id: string; version: string; domain: string }
  /** The disputed finding. */
  outcome: 'PASS' | 'FAIL'
  /** What Riposte proposed. */
  proposed: 'UPHOLD' | 'REFER'
  opinion_params: OpinionParams
  /** The person's ruling on LAW. */
  ruling: LawRuling
  reason: string
  signer_id: string
  /** ISO-8601 with a zone: when the person ruled (their claim; the ruling book has no clock of its own). */
  signed_at: string
  note?: string
}

export interface SignedRuling {
  ruling: DisputeRuling
  alg: 'ed25519'
  /** SPKI PEM of the signer's public key. Anchor it to a person with trusted_keys. */
  public_key: string
  /** base64 Ed25519 signature over RULING_SIGNING_PREFIX + canonicalize(ruling). */
  signature: string
  /** First 32 hex of sha256 over canonicalize(ruling). */
  ruling_id: string
}

export interface RulingCheck { ok: boolean; anchored: boolean; reason?: string }

const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x)
const nonEmpty = (x: unknown): x is string => typeof x === 'string' && x.trim().length > 0
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/
const HEX32 = /^[0-9a-f]{32}$/
const HEX64 = /^[0-9a-f]{64}$/
const extraKeys = (o: Record<string, unknown>, allowed: readonly string[]): string[] => Object.keys(o).filter(k => !allowed.includes(k) && o[k] !== undefined)

const RULING_KEYS = ['ruling_version', 'kind', 'opinion_id', 'book', 'tenant_id', 'verdict_id', 'claim_id', 'rule_id', 'ruleset', 'outcome', 'proposed', 'opinion_params', 'ruling', 'reason', 'signer_id', 'signed_at', 'note']

/** The first reason a ruling is not well-formed, or undefined. Unknown fields are refused: what a person signs is exactly the schema. */
export function rulingProblem(r: unknown): string | undefined {
  if (!isObj(r)) return 'a ruling must be an object'
  if (r.ruling_version !== 'ruling-v0') return `ruling_version must be 'ruling-v0'`
  if (r.kind !== 'DISPUTE_RULING') return `kind must be 'DISPUTE_RULING'`
  const extra = extraKeys(r, RULING_KEYS)
  if (extra.length) return `a ruling carries unknown field(s) ${extra.join(', ')}`
  if (typeof r.opinion_id !== 'string' || !HEX32.test(r.opinion_id)) return 'opinion_id must be the dispute opinion\'s id (32 hex)'
  const b = r.book
  if (!isObj(b) || typeof b.head !== 'string' || !HEX64.test(b.head) || !Number.isInteger(b.length) || (b.length as number) < 1 || extraKeys(b, ['head', 'length']).length) {
    return 'book must be { head, length }: the chain head (sha256 hex) and length the opinion was read from'
  }
  if (r.tenant_id !== undefined && !nonEmpty(r.tenant_id)) return 'tenant_id, when given, must be a tenant id'
  if (!nonEmpty(r.verdict_id) || !nonEmpty(r.claim_id) || !nonEmpty(r.rule_id)) return 'a ruling names the verdict_id, claim_id and rule_id it rules on'
  const rs = r.ruleset
  if (!isObj(rs) || !nonEmpty(rs.id) || !nonEmpty(rs.version) || !nonEmpty(rs.domain) || extraKeys(rs, ['id', 'version', 'domain']).length) return 'ruleset must be { id, version, domain }'
  if (r.outcome !== 'PASS' && r.outcome !== 'FAIL') return 'outcome must be PASS or FAIL: an abstention is not a question of LAW'
  if (r.proposed !== 'UPHOLD' && r.proposed !== 'REFER') return 'proposed must be UPHOLD or REFER (what the dispute opinion proposed)'
  const p = r.opinion_params
  if (!isObj(p) || !Number.isInteger(p.min_reviewed) || typeof p.flag_threshold !== 'number' || typeof p.confidence !== 'number' || (p.method !== 'wilson' && p.method !== 'clopper-pearson')) {
    return 'opinion_params must carry the resolved min_reviewed, flag_threshold, confidence and method'
  }
  if (extraKeys(p, ['min_reviewed', 'flag_threshold', 'confidence', 'method', 'consequence', 'input_bound']).length) return 'opinion_params carries unknown field(s)'
  if (p.consequence !== undefined && (!isObj(p.consequence) || !nonEmpty(p.consequence.tier))) return 'opinion_params.consequence must be { tier, description? }'
  if (p.input_bound !== undefined && p.input_bound !== true) return 'opinion_params.input_bound, when given, is true'
  if (!LAW_RULINGS.includes(r.ruling as LawRuling)) return `ruling must be one of ${LAW_RULINGS.join(', ')}`
  if (!nonEmpty(r.reason)) return 'a ruling on LAW is a person\'s recorded decision: it needs a reason'
  if (!nonEmpty(r.signer_id)) return 'a ruling is a person\'s: it needs signer_id'
  if (typeof r.signed_at !== 'string' || !ISO.test(r.signed_at) || !Number.isFinite(Date.parse(r.signed_at))) return 'signed_at must be an ISO-8601 timestamp with a zone'
  if (r.note !== undefined && typeof r.note !== 'string') return 'note must be a string'
  return undefined
}

export function rulingId(r: DisputeRuling): string {
  return hashOf(r).slice(0, 32)
}

/**
 * A person's ruling on LAW over a dispute opinion. Refuses (throws) what cannot be ruled on: anything but a verified,
 * intact dispute opinion proposing UPHOLD or REFER on a DETERMINISTIC PASS/FAIL finding.
 */
export function disputeRuling(opinion: Opinion, by: { ruling: LawRuling; reason: string; signer_id: string; signed_at: string; note?: string }): DisputeRuling {
  if (!opinionIntact(opinion)) throw new Error('the opinion does not match its own id (edited after it was generated): a ruling answers exactly what Riposte proposed')
  const s = opinion.subject
  if (s.kind !== 'DISPUTE') throw new Error('only a dispute opinion is ruled on as LAW (a promotion is answered by a GRANT or a DECLINE on the book)')
  if (!opinion.verified || (opinion.ruling.disposition !== 'UPHOLD' && opinion.ruling.disposition !== 'REFER')) {
    throw new Error(`the opinion is ${opinion.ruling.disposition}: a ruling on LAW needs a verified opinion proposing UPHOLD or REFER (a withheld opinion has no FACT under it)`)
  }
  if (s.tier !== 'DETERMINISTIC') throw new Error('a judgement-tier finding is an advisory, not a rule\'s LAW: act on it or dismiss it; there is nothing to rule')
  if (s.outcome !== 'PASS' && s.outcome !== 'FAIL') throw new Error('an abstention is not a question of LAW: a ruling cannot manufacture data (supply it and re-run)')
  const head = opinion.premises.find(p => p.id === 'P1')?.refs.find(r => r.kind === 'ledger_head')
  if (!head || head.kind !== 'ledger_head') throw new Error('the opinion names no book of record (P1 cites no ledger head)')
  const r: DisputeRuling = {
    ruling_version: 'ruling-v0',
    kind: 'DISPUTE_RULING',
    opinion_id: opinion.opinion_id,
    book: { head: head.head, length: head.length },
    ...(s.tenant_id !== undefined ? { tenant_id: s.tenant_id } : {}),
    verdict_id: s.verdict_id,
    claim_id: s.claim_id,
    rule_id: s.rule_id,
    ruleset: { ...s.ruleset },
    outcome: s.outcome,
    proposed: opinion.ruling.disposition,
    opinion_params: {
      ...s.precedent_rule,
      ...(s.consequence ? { consequence: { ...s.consequence } } : {}),
      ...(s.input_bound ? { input_bound: true as const } : {}),
    },
    ruling: by.ruling,
    reason: by.reason,
    signer_id: by.signer_id,
    signed_at: by.signed_at,
    ...(by.note !== undefined ? { note: by.note } : {}),
  }
  const problem = rulingProblem(r)
  if (problem) throw new Error(problem)
  return r
}

const message = (r: DisputeRuling): Buffer => Buffer.from(RULING_SIGNING_PREFIX + canonicalize(r), 'utf8')

/** Sign a person's ruling with their Ed25519 private key (PKCS8 PEM). Refuses a malformed ruling. */
export function signRuling(ruling: DisputeRuling, privateKeyPem: string): SignedRuling {
  const problem = rulingProblem(ruling)
  if (problem) throw new Error(problem)
  const key = createPrivateKey(privateKeyPem)
  if (key.asymmetricKeyType !== 'ed25519') throw new Error(`a ruling is signed with an Ed25519 key, not ${key.asymmetricKeyType}`)
  const clean = JSON.parse(canonicalize(ruling)) as DisputeRuling
  return {
    ruling: clean,
    alg: 'ed25519',
    public_key: createPublicKey(key).export({ type: 'spki', format: 'pem' }).toString(),
    signature: edSign(null, message(clean), key).toString('base64'),
    ruling_id: rulingId(clean),
  }
}

function spkiOf(pem: string): string | undefined {
  try { return createPublicKey(pem).export({ type: 'spki', format: 'der' }).toString('base64') } catch { return undefined }
}

/** Verify a signed ruling on its own: well-formed, id derives, signature verifies, and (with trusted_keys) the key is the signer's. */
export function verifySignedRuling(s: unknown, opts: { trusted_keys?: TrustedKeys } = {}): RulingCheck {
  const no = (reason: string): RulingCheck => ({ ok: false, anchored: false, reason })
  if (!isObj(s)) return no('not a signed ruling')
  if (s.alg !== 'ed25519') return no(`unsupported alg: ${String(s.alg)}`)
  if (typeof s.public_key !== 'string' || typeof s.signature !== 'string') return no('a signed ruling carries public_key and signature')
  if (extraKeys(s, ['ruling', 'alg', 'public_key', 'signature', 'ruling_id']).length) return no('a signed ruling carries unknown field(s)')
  const problem = rulingProblem(s.ruling)
  if (problem) return no(problem)
  const r = s.ruling as unknown as DisputeRuling
  if (s.ruling_id !== rulingId(r)) return no('ruling_id does not derive from the ruling (altered after signing)')
  let sigOk = false
  try {
    sigOk = edVerify(null, message(r), createPublicKey(s.public_key), Buffer.from(s.signature, 'base64'))
  } catch (e) {
    return no(`signature verification errored: ${(e as Error).message}`)
  }
  if (!sigOk) return no('signature does not verify: the ruling was altered, or the key does not match')
  if (!opts.trusted_keys) return { ok: true, anchored: false }
  const anchoredKeys = opts.trusted_keys[r.signer_id]
  if (anchoredKeys === undefined) return no(`signer '${r.signer_id}' has no anchored key: only a person whose key is anchored can rule`)
  const mine = spkiOf(s.public_key)
  const listed = (typeof anchoredKeys === 'string' ? [anchoredKeys] : anchoredKeys).map(spkiOf)
  if (!mine || !listed.includes(mine)) return no(`the signing key is not the one anchored to signer '${r.signer_id}'`)
  return { ok: true, anchored: true }
}

/** The ruling book as JSON Lines (one signed ruling per line, in order: later rulings on the same claim supersede earlier). */
export function rulingBookJSONL(rulings: readonly SignedRuling[]): string {
  return rulings.map(r => JSON.stringify(r)).join('\n')
}

/** Parse a ruling book (JSON Lines; blank lines skipped). Each ruling is verified where it is used (statute.ts), not here. */
export function parseRulingBook(text: string): SignedRuling[] {
  const out: SignedRuling[] = []
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return
    try { out.push(JSON.parse(line) as SignedRuling) } catch (e) { throw new Error(`ruling book line ${i + 1}: invalid JSON (${(e as Error).message})`) }
  })
  return out
}
