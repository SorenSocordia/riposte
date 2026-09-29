/**
 * A person's decisions on the book of record — signed ledger events (design ruling, 2026-09-28, made durable).
 *
 * The ruling: only a person moves a rung, in either direction; the settings are fixed at grant; a person's revision of the
 * weighting is recorded and versioned. A grant used to be a flag passed to assessVoice. Here it is an entry in the book:
 *
 *   GRANT            a person sets a workflow's rung: the level, the policy version (by hash) and consequence tier it is
 *                    made under, the bounds autonomy acts within, who and when. The latest GRANT for a workflow IS its rung.
 *   DECLINE          a person answers a proposal "no" (e.g. "keep it" on an urgent demotion proposal). Recorded so the
 *                    proposal is not re-raised on every assessment until the evidence changes (voice.ts: declineStanding).
 *   POLICY_REVISION  a person revises the promotion policy: who, when, why, what changed, the full new version, and the hash
 *                    of the version it supersedes (the revisePolicy() record, made durable).
 *
 * Evidence integrity (2026-09-28, wave 3), so the evidence behind a grant cannot quietly rot or be gamed:
 *
 *   KEY_REGISTER / KEY_REVOKE   the key registry on the book, anchored to a registry ROOT key (./registry.ts): who may sign,
 *                               in which roles, from when, until when. trusted_keys is then read from the book.
 *   CANARY_SEAL / CANARY_REVEAL reviewer attention: a sealed commitment to known-bad items seeded into a review queue (the
 *                               label is on the book, hidden from the reviewer), revealed after review. The catch rate on
 *                               them is measured (surveillance/evidence.ts).
 *   REVIEW (signed body)        an UPHELD / OVERTURNED review as a person's signed decision, carried inside the REVIEW event,
 *                               so an agent cannot manufacture the evidence a rung rests on. Unsigned reviews still read.
 *   SAMPLE (./sampling.ts)      not a decision: the mechanical commit of a random review queue, re-derived on every read.
 *
 * Each decision is signed with Ed25519 (node:crypto, as the verdict envelope is) over a DOMAIN-SEPARATED canonical body (a
 * decision signature can never be replayed as a verdict signature, or the reverse), appended to the hash chain like any
 * record, and re-verified by `verifyContent()`: payload hash, signature, shape, id, the event header against its hashed
 * payload, and (with a root key) the registry. A decision that fails any check is refused at the door and appends nothing.
 *
 * HONEST BOUNDARY (the envelope's, restated): a signature proves the decision is untampered and was signed by the holder of
 * that key. Binding a key to a PERSON is out of band: either `trusted_keys` (signer_id → public key, passed in), or ONE root
 * key (`root_keys`) that registers the rest on the book. Without either, the book lists every signer as unanchored, and says so.
 *
 * D-ANCHOR (security fix, 2026-09-28; red team R4): only a person moves a rung, so only an ANCHORED decision has any
 * effect. An unanchored GRANT, DECLINE, POLICY_REVISION or CANARY_* stays on the book (it verifies, it is listed, a reader
 * says so: noEffect()), but the selection functions below never return it: the rung falls back to the last anchored grant,
 * and an unanchored decline holds back no proposal. On a default book (no trusted_keys, no root key) that means no signed
 * decision moves anything until a signer is anchored. Every reader inherits this, because every reader selects through here.
 *
 * R3 (red team, 2026-09-28): the verdict door is re-applied on read to every RECORD payload (recordedVerdictProblem), so a
 * COUNSEL object or a malformed verdict spliced into a re-linked book fails verification with a named reason.
 *
 * D-DUAL (dual authorization, design ruling 2026-09-28; "Automated-approval evidence", 2026-09-28, §5.6): a GRANT may need
 * more than one person. A policy tier declares `grant_signatures` (a GRANT of autonomy there needs that many people), and a
 * GRANT states the count it was made under (`signatures`). Until the others co-sign, the grant is on the book and PENDING:
 * it has no effect, and every reader says so (noEffect), the same shape as D-ANCHOR. The co-signature is a GRANT_COSIGN, a
 * decision KIND carried in a GRANT event (the chain's event types are unchanged): a second person's signature over the
 * grant's decision_id. It counts only when its signer is anchored, is another person (signer_id) on another key
 * (fingerprint), and is not already counted. The same key signing twice, or two ids on one key, never counts.
 *
 * RULESET_SUCCESSION (D-RULESET-BUMP, 2026-09-29): a new ruleset version is a new workflow, and a grant does not carry over
 * by itself. A person carries it with a GRANT on the new workflow that names the grant in force on the old one and carries the
 * library's replay of the old workflow's verdicts under the new ruleset (`succeeds`; ./succession.ts builds the replay). It is
 * a GRANT, so every door and reader above applies to it; it has effect only while it carries (successionProblem).
 *
 * Pure and dependency-free. The ledger never imports voice.ts at runtime (types only), so the rung ladder is mirrored here
 * and a test pins the two equal.
 */

import { createPrivateKey, createPublicKey, sign as edSign, verify as edVerify } from 'node:crypto'
import { canonicalize, hashOf, sha256 } from '../verdict/canonical.js'
import { proofProblem } from '../verdict/channel.js'
import type { Aggregation, Verdict } from '../verdict/schema.js'
import { AGGREGATIONS, aggregateOutcome } from '../verdict/aggregation.js'
import type { PolicyRef, PromotionPolicy, VoiceLevel } from '../verdict/voice.js'
import { GENESIS, payloadViewOf, verifyChainAgainst, type ChainCheck, type LedgerEvent } from './chain.js'
import type { Review, ReviewDecision } from './types.js'
import { KeyRegistry, ROLE_FOR, ROLES, isRole, keyFingerprint, tenantOfWorkflow, type Authorization, type KeyEntry, type Role, type RootKeys } from './registry.js'
import { chainPeriods, deriveSample, isPeriodUnit, recordWorkflow, sampleKey, sampleSubject, type PeriodSpan, type PeriodUnit, type SampleBody, type SampleEntry } from './sampling.js'

/** The RUNG decisions: a person's GRANT, DECLINE and POLICY_REVISION (what `decisions()` and `DecisionBook.decisions` list). */
export type DecisionKind = 'GRANT' | 'DECLINE' | 'POLICY_REVISION'
export const DECISION_KINDS: readonly DecisionKind[] = ['GRANT', 'DECLINE', 'POLICY_REVISION']
export const isDecisionKind = (t: unknown): t is DecisionKind => DECISION_KINDS.includes(t as DecisionKind)
/** The key-registry decisions (./registry.ts) and the reviewer-attention decisions (canaries). */
export type KeyDecisionKind = 'KEY_REGISTER' | 'KEY_REVOKE'
export type CanaryDecisionKind = 'CANARY_SEAL' | 'CANARY_REVEAL'
/** A second person's signature on a GRANT (D-DUAL). Carried in a GRANT event: see decisionEventType. */
export type CosignDecisionKind = 'GRANT_COSIGN'
/** Every signed decision on the book (the signed REVIEW body rides inside a REVIEW event, so it is not one). */
export type BookDecisionKind = DecisionKind | KeyDecisionKind | CanaryDecisionKind | CosignDecisionKind
export const BOOK_DECISION_KINDS: readonly BookDecisionKind[] = [...DECISION_KINDS, 'KEY_REGISTER', 'KEY_REVOKE', 'CANARY_SEAL', 'CANARY_REVEAL', 'GRANT_COSIGN']
export const isBookDecisionKind = (t: unknown): t is BookDecisionKind => BOOK_DECISION_KINDS.includes(t as BookDecisionKind)
/** The chain event types a decision rides in (the chain format has no event type of its own for a co-signature). */
export type DecisionEventKind = Exclude<BookDecisionKind, CosignDecisionKind>

/**
 * The chain event type a decision is appended as. Every kind is its own event type, except GRANT_COSIGN, which rides in a
 * GRANT event (DECISION D-DUAL-EVENT: no new chain event type; the decision's own `kind` tells a co-signature from a grant).
 */
export function decisionEventType(kind: BookDecisionKind): DecisionEventKind {
  return kind === 'GRANT_COSIGN' ? 'GRANT' : kind
}

/** Mirrors VOICE_LADDER (voice.ts); kept local so the ledger never imports voice at runtime. A test pins them equal. */
export const DECISION_LEVELS: readonly VoiceLevel[] = ['record', 'advise', 'gate', 'autonomy']
const RUNG_NAMES: readonly string[] = ['advise', 'gate', 'autonomy']
const rank = (l: VoiceLevel): number => DECISION_LEVELS.indexOf(l)

/** Prefixed to the canonical decision before signing: a decision signature is never valid for anything else. */
export const DECISION_SIGNING_PREFIX = 'riposte:decision:v0\n'
/** Prefixed to a canary commitment: a commitment is never confusable with any other hash on the book. */
export const CANARY_COMMIT_PREFIX = 'riposte:canary:v0\n'

interface DecisionBase {
  decision_version: 'decision-v0'
  /** Who decided. With trusted_keys, this id must map to the signing key; with the registry, the key must be registered to it. */
  signer_id: string
  /** When the person decided (ISO-8601 with a zone). The ledger's own clock is recorded separately, at append. */
  signed_at: string
  note?: string
}

/** A person sets a workflow's rung, in either direction. The latest GRANT for a workflow is its rung. */
export interface GrantDecision extends DecisionBase {
  kind: 'GRANT'
  workflow_id: string
  level: VoiceLevel
  /** The consequence tier the grant is made at. Fixed at grant: assessing under another tier is refused. */
  consequence_tier: string
  /** The policy version the grant is made under (by hash). Fixed at grant: assessing under another policy is refused. */
  policy: PolicyRef
  /** The bounds autonomy acts within, in words. REQUIRED on a grant of autonomy: a person states them, even "all". */
  bounds?: string
  /** The proposal this grant answers (its proposal_id), when it answers one. */
  answers?: string
  /**
   * D-DUAL: how many people must sign this grant before it is in force: this signer, and `signatures − 1` others by
   * GRANT_COSIGN. Absent: one. grantUnderPolicy fills it from the tier's grant_signatures; a reader that knows the grant's
   * policy also holds a grant that under-states it to the tier's number.
   */
  signatures?: number
  /**
   * RULESET_SUCCESSION: this GRANT carries the grant in force on another version of the same ruleset to this workflow
   * (D-RULESET-BUMP: a new ruleset version is a new workflow, and nothing carries over unless a person signs this). Absent on
   * an ordinary grant. See Succession.
   */
  succeeds?: Succession
}

/**
 * RULESET_SUCCESSION (D-RULESET-BUMP's signed carry-forward). A GRANT on the new workflow (`<tenant>/<ruleset>@<B>`) that
 * names the grant in force on the old one (`<tenant>/<ruleset>@<A>`) and carries the library's replay of the old workflow's
 * recorded verdicts under the new ruleset, so the person signs knowing what the new rules would have said. DECISION
 * D-SUCC-SHAPE (fork: here): it is a GRANT with this block, not a separate kind, so it passes every door a GRANT does (anchored
 * signer, the grant_signer role, the tenant, the governing policy, D-DUAL co-signature) and every reader reads it as the grant
 * on the new workflow. It has effect only while (successionProblem): it names the grant in force on `from` at its position,
 * at a rung no higher, at the same tier, with no fewer signatures, and its replay matches the book it names.
 */
export interface Succession {
  /** The workflow whose grant is carried: the same tenant and ruleset id, another version. */
  from: string
  /** decision_id of the GRANT in force on `from` at the succession's position. */
  grant: string
  /** Why a person carries it. */
  reason: string
  /** The library's replay of `from`'s recorded verdicts under this workflow's ruleset (successionReplay), as the signer saw it. */
  replay: SuccessionReplay
  /**
   * Required when the replay shows a verdict the new ruleset would PASS that was recorded as FAIL or INSUFFICIENT_DATA (the
   * new rules loosen): why a person accepts that. Refused when nothing loosens.
   */
  loosening_reason?: string
}

/** A verdict outcome, as the replay compares them. */
export type SuccessionOutcome = 'PASS' | 'FAIL' | 'INSUFFICIENT_DATA'

/** The replay a succession carries: the old workflow's recorded verdicts, re-performed under the new ruleset. */
export interface SuccessionReplay {
  replay_version: 'succession-replay-v0'
  /** The book the replay read: events 0 … through − 1, the last of which has entry_hash `head` (GENESIS when through is 0). */
  through: number
  head: string
  /** The engine that re-performed them. */
  engine_version: string
  /** Distinct verdicts recorded under `from` in that span. */
  recorded: number
  /** Of those, re-performed under the new ruleset (inputs supplied, bound to the verdict, an engine for them in this build). */
  reperformed: number
  /** Every re-performed verdict whose outcome differs: the recorded outcome, and the new ruleset's. Sorted by verdict_id. */
  changed: SuccessionChange[]
}

export interface SuccessionChange { verdict_id: string; from: SuccessionOutcome; to: SuccessionOutcome }

/** The evidence a person saw when declining: what "the evidence changed" is measured against. */
export interface DeclineEvidence {
  calibration_hash: string
  /** Per rung in the declined proposal: reviewed items and overturned among them. */
  rungs: { rung: string; n: number; errors: number }[]
  /** A demotion's failing cases (verdict ids), sorted. Empty for a promotion. */
  failing_cases: string[]
  /** The evidence blockers at the time (mixed versions, an altered calibration), sorted. */
  blockers: string[]
}

/** A person's "no" to a proposal, e.g. "keep it" on an urgent demotion proposal. It moves nothing; it stops the re-raise. */
export interface DeclineDecision extends DecisionBase {
  kind: 'DECLINE'
  workflow_id: string
  /** The proposal declined (its deterministic proposal_id). */
  proposal_id: string
  proposal_kind: 'PROMOTION_PROPOSAL' | 'DEMOTION_PROPOSAL'
  from: VoiceLevel
  to: VoiceLevel
  consequence_tier: string
  policy: PolicyRef
  /** The decision_id of the GRANT in force when declined; absent when nothing had been granted (the rung was record). */
  under_grant?: string
  reason: string
  seen: DeclineEvidence
}

/** A person's revision of the promotion policy (revisePolicy's record, durable). The grant in force is untouched by it. */
export interface PolicyRevisionDecision extends DecisionBase {
  kind: 'POLICY_REVISION'
  /** The new version. */
  policy: PolicyRef
  /** The version it supersedes. */
  supersedes: PolicyRef
  reason: string
  changes: string[]
  /** The full new version, so a reader re-derives its hash and re-lints it. Its `revision` must agree with this decision. */
  policy_body: PromotionPolicy
}

/** A key joins the registry (./registry.ts): whose it is and the roles it may sign in. */
export interface KeyRegisterDecision extends DecisionBase {
  kind: 'KEY_REGISTER'
  /** The person the key belongs to: the signer_id they will sign as. */
  subject_id: string
  /** SPKI PEM of the Ed25519 public key. */
  public_key: string
  roles: Role[]
  /** The tenants this key may act for (F-B). Absent: deployment-wide. Sorted, unique. */
  tenants?: string[]
}

/** A key leaves the registry, prospectively (what it signed before stays valid). */
export interface KeyRevokeDecision extends DecisionBase {
  kind: 'KEY_REVOKE'
  subject_id: string
  public_key: string
  reason: string
}

/** A sealed commitment to known-bad items seeded into a workflow's review queue. The items stay hidden until the reveal. */
export interface CanarySealDecision extends DecisionBase {
  kind: 'CANARY_SEAL'
  workflow_id: string
  /** canaryCommitment(workflow_id, verdict_ids, salt): sha256 over the domain prefix and the canonical set. */
  commitment: string
}

/** The seal opened: which recorded verdicts were canaries (each one a person who looks would overturn). */
export interface CanaryRevealDecision extends DecisionBase {
  kind: 'CANARY_REVEAL'
  workflow_id: string
  /** decision_id of the CANARY_SEAL it opens. */
  seal: string
  /** Sorted, unique. Every one must be recorded on the book before the reveal. */
  verdict_ids: string[]
  /** At least 128 bits of hex: without it, anyone could test which recorded items the commitment covers. */
  salt: string
}

/**
 * D-DUAL: a second person signs a GRANT already on the book. It restates the workflow and level so what the co-signer signs
 * says what it authorizes; `grant` (the grant's decision_id) binds the rest of the grant's body.
 */
export interface GrantCosignDecision extends DecisionBase {
  kind: 'GRANT_COSIGN'
  workflow_id: string
  /** decision_id of the GRANT co-signed. */
  grant: string
  /** The grant's level. Must equal it. */
  level: VoiceLevel
}

/** A rung decision (unchanged since wave 2: every consumer that reads `decisions` sees exactly these). */
export type Decision = GrantDecision | DeclineDecision | PolicyRevisionDecision
export type KeyDecision = KeyRegisterDecision | KeyRevokeDecision
export type CanaryDecision = CanarySealDecision | CanaryRevealDecision
/** Every signed decision event on the book. */
export type BookDecision = Decision | KeyDecision | CanaryDecision | GrantCosignDecision

/** A person's review (UPHELD / OVERTURNED) as a signed body, carried inside the REVIEW event (ledger.reviewSigned). */
export interface ReviewDecisionBody extends DecisionBase {
  kind: 'REVIEW'
  verdict_id: string
  /** The tenant whose record is reviewed (the same verdict id may be recorded by two tenants). Absent: the latest owner's. */
  tenant_id?: string
  decision: ReviewDecision
  /** What the review did (AS 2201 .50: re-performance is the strongest test; inspection is weaker). */
  procedure?: 're-performed' | 'inspected'
}

/** Everything a person signs on the book. */
export type Signable = BookDecision | ReviewDecisionBody

export interface SignedDecision<D extends Signable = Decision> {
  decision: D
  alg: 'ed25519'
  /** SPKI PEM of the signer's public key. Anchor it to a person with trusted_keys or the registry. */
  public_key: string
  /** base64 Ed25519 signature over DECISION_SIGNING_PREFIX + canonicalize(decision). */
  signature: string
  /** First 32 hex of sha256 over canonicalize(decision). Deterministic: the same decision, the same id. */
  decision_id: string
}

/** signer_id → the SPKI PEM public key(s) anchored to that person. */
export type TrustedKeys = Readonly<Record<string, string | readonly string[]>>

/** How a reader anchors signers: a static map, or the registry on the book under a root key (or both: see registry.ts). */
export interface AnchorOptions { trusted_keys?: TrustedKeys; root_keys?: RootKeys }

/** Thrown at the door when a decision is malformed, unsigned, mis-signed, unanchored, or contradicts the book. */
export class DecisionRefused extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DecisionRefused'
  }
}

/** One decision as it sits on the chain. */
export interface DecisionEntry<D extends BookDecision = Decision> {
  seq: number
  entry_hash: string
  /** The ledger clock when the decision was appended. */
  recorded_at: string
  decision_id: string
  signed: SignedDecision<D>
  /**
   * How the signer was anchored at this position, as readDecisionBook read it (rung and canary decisions). Absent on an entry
   * not read through readDecisionBook (the ledger door's own list): its anchoring is unknown, and it has no effect on a rung
   * reader (D-ANCHOR: isAnchored).
   */
  via?: Authorization['via']
  /**
   * D-DUAL: on a GRANT read through readDecisionBook, the co-signatures that count toward it, in chain order. Present only when
   * any: absent, it has only its own signer's.
   */
  cosigned?: Cosign[]
  /**
   * RULESET_SUCCESSION: on a GRANT that carries a succession, read through readDecisionBook, whether its replay matches the book
   * it names (its span and head, the verdicts recorded under `from` there, and each changed verdict's recorded outcome).
   */
  replay?: { matches: boolean; reason?: string }
}

/** A co-signature that counts toward a GRANT (D-DUAL): an anchored second person, on a key no other signer of it used. */
export interface Cosign {
  decision_id: string
  seq: number
  signer_id: string
  /** sha256 of the co-signer's SPKI (registry.ts keyFingerprint). */
  fingerprint: string
}

/** The payload a decision event carries (hashed by the chain). */
export interface DecisionPayload {
  /** The event type (decisionEventType): a GRANT_COSIGN's payload says GRANT, its signed decision says GRANT_COSIGN. */
  type: BookDecisionKind
  recorded_at: string
  signed: SignedDecision<BookDecision>
}

/** One signed REVIEW on the chain, verified. */
export interface SignedReviewEntry {
  seq: number
  entry_hash: string
  verdict_id: string
  /** The tenant whose record was reviewed. */
  tenant_id?: string
  decision_id: string
  signer_id: string
  /** sha256 of the signing key's SPKI (registry.ts keyFingerprint). */
  fingerprint: string
  decision: ReviewDecision
  procedure?: 're-performed' | 'inspected'
  /** How the reviewer was anchored at that position. */
  via: Authorization['via']
}

// ── shape ────────────────────────────────────────────────────────────────────────────────────────────────────────────

const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x)
const nonEmpty = (x: unknown): x is string => typeof x === 'string' && x.trim().length > 0
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/
const isIso = (x: unknown): x is string => typeof x === 'string' && ISO.test(x) && Number.isFinite(Date.parse(x))
const HEX64 = /^[0-9a-f]{64}$/
const HEX32 = /^[0-9a-f]{32}$/
const SALT = /^[0-9a-f]{32,}$/
const isLevel = (x: unknown): x is VoiceLevel => DECISION_LEVELS.includes(x as VoiceLevel)
const isNat = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 0
/** The most signatures a GRANT or a tier may require (D-DUAL). More would be a quorum design, not dual authorization. */
export const MAX_SIGNATURES = 5
const isStrArr = (x: unknown): x is string[] => Array.isArray(x) && x.every(s => typeof s === 'string')
const sortedUnique = (a: readonly string[]): boolean => a.every((s, i) => i === 0 || a[i - 1]! < s)

function extraKeys(o: Record<string, unknown>, allowed: readonly string[]): string[] {
  return Object.keys(o).filter(k => !allowed.includes(k) && o[k] !== undefined)
}

function refProblem(r: unknown, at: string): string | undefined {
  if (!isObj(r)) return `${at} must be a policy reference { policy_id, version, hash }`
  if (!nonEmpty(r.policy_id) || !nonEmpty(r.version)) return `${at} needs policy_id and version`
  if (typeof r.hash !== 'string' || !HEX64.test(r.hash)) return `${at}.hash must be a sha256 hex digest`
  const extra = extraKeys(r, ['policy_id', 'version', 'hash'])
  if (extra.length) return `${at} carries unknown field(s) ${extra.join(', ')}`
  return undefined
}

const BASE_KEYS = ['decision_version', 'kind', 'signer_id', 'signed_at', 'note']
const ALLOWED_KEYS: Readonly<Record<BookDecisionKind | 'REVIEW', readonly string[]>> = {
  GRANT: [...BASE_KEYS, 'workflow_id', 'level', 'consequence_tier', 'policy', 'bounds', 'answers', 'signatures', 'succeeds'],
  GRANT_COSIGN: [...BASE_KEYS, 'workflow_id', 'grant', 'level'],
  DECLINE: [...BASE_KEYS, 'workflow_id', 'proposal_id', 'proposal_kind', 'from', 'to', 'consequence_tier', 'policy', 'under_grant', 'reason', 'seen'],
  POLICY_REVISION: [...BASE_KEYS, 'policy', 'supersedes', 'reason', 'changes', 'policy_body'],
  KEY_REGISTER: [...BASE_KEYS, 'subject_id', 'public_key', 'roles', 'tenants'],
  KEY_REVOKE: [...BASE_KEYS, 'subject_id', 'public_key', 'reason'],
  CANARY_SEAL: [...BASE_KEYS, 'workflow_id', 'commitment'],
  CANARY_REVEAL: [...BASE_KEYS, 'workflow_id', 'seal', 'verdict_ids', 'salt'],
  REVIEW: [...BASE_KEYS, 'verdict_id', 'tenant_id', 'decision', 'procedure'],
}

/**
 * The first reason a decision (or a signed review body) is not well-formed, or undefined. Unknown fields are refused, so
 * what a person signs is exactly the schema. Checks that need the rest of the book (the grant in force, a recorded policy
 * version, the registry, a canary seal) run at the door, in the ledger, and again on read.
 */
export function decisionProblem(d: unknown): string | undefined {
  if (!isObj(d)) return 'a decision must be an object'
  if (d.decision_version !== 'decision-v0') return `decision_version must be 'decision-v0'`
  if (!isBookDecisionKind(d.kind) && d.kind !== 'REVIEW') return `kind must be one of ${[...BOOK_DECISION_KINDS, 'REVIEW'].join(', ')}`
  if (!nonEmpty(d.signer_id)) return 'a decision is a person\'s: it needs signer_id'
  if (!isIso(d.signed_at)) return 'signed_at must be an ISO-8601 timestamp with a zone'
  if (d.note !== undefined && typeof d.note !== 'string') return 'note must be a string'
  const extra = extraKeys(d, ALLOWED_KEYS[d.kind as BookDecisionKind | 'REVIEW'])
  if (extra.length) return `a ${String(d.kind)} carries unknown field(s) ${extra.join(', ')}`

  if (d.kind === 'GRANT') {
    if (!nonEmpty(d.workflow_id)) return 'a GRANT names its workflow_id'
    if (!isLevel(d.level)) return `level must be one of ${DECISION_LEVELS.join(', ')}`
    if (!nonEmpty(d.consequence_tier)) return 'a GRANT is made at a consequence_tier'
    const rp = refProblem(d.policy, 'policy'); if (rp) return rp
    if (d.bounds !== undefined && !nonEmpty(d.bounds)) return 'bounds, when given, must be words'
    if (d.level === 'autonomy' && !nonEmpty(d.bounds)) return 'a GRANT of autonomy must state the bounds it acts within (a person writes them, even "all")'
    if (d.answers !== undefined && !nonEmpty(d.answers)) return 'answers, when given, is a proposal_id'
    if (d.signatures !== undefined && !(Number.isInteger(d.signatures) && (d.signatures as number) >= 2 && (d.signatures as number) <= MAX_SIGNATURES)) {
      return `signatures, when given, is an integer from 2 to ${MAX_SIGNATURES} (absent means one: this signer alone)`
    }
    if (d.succeeds !== undefined) return successionShapeProblem(d.workflow_id, d.succeeds, d.answers !== undefined)
    return undefined
  }

  if (d.kind === 'GRANT_COSIGN') {
    if (!nonEmpty(d.workflow_id)) return 'a GRANT_COSIGN names its workflow_id'
    if (typeof d.grant !== 'string' || !HEX32.test(d.grant)) return 'grant must be the decision_id of the GRANT co-signed'
    if (!isLevel(d.level)) return `level must be one of ${DECISION_LEVELS.join(', ')} (the grant's level, restated)`
    return undefined
  }

  if (d.kind === 'DECLINE') {
    if (!nonEmpty(d.workflow_id)) return 'a DECLINE names its workflow_id'
    if (!nonEmpty(d.proposal_id)) return 'a DECLINE names the proposal it answers (proposal_id)'
    if (d.proposal_kind !== 'PROMOTION_PROPOSAL' && d.proposal_kind !== 'DEMOTION_PROPOSAL') return `proposal_kind must be PROMOTION_PROPOSAL or DEMOTION_PROPOSAL`
    if (!isLevel(d.from) || !isLevel(d.to)) return `from and to must be rungs (${DECISION_LEVELS.join(', ')})`
    const step = rank(d.to) - rank(d.from)
    if (d.proposal_kind === 'PROMOTION_PROPOSAL' && step !== 1) return 'a promotion proposal is one rung up (from → to)'
    if (d.proposal_kind === 'DEMOTION_PROPOSAL' && step !== -1) return 'a demotion proposal is one rung down (from → to)'
    if (!nonEmpty(d.consequence_tier)) return 'a DECLINE names the consequence_tier of the proposal'
    const rp = refProblem(d.policy, 'policy'); if (rp) return rp
    if (d.under_grant !== undefined && !nonEmpty(d.under_grant)) return 'under_grant, when given, is the decision_id of the grant in force'
    if (!nonEmpty(d.reason)) return 'a DECLINE is a person\'s recorded decision: it needs a reason'
    const s = d.seen
    if (!isObj(s)) return 'a DECLINE records the evidence the person saw (seen)'
    const sx = extraKeys(s, ['calibration_hash', 'rungs', 'failing_cases', 'blockers'])
    if (sx.length) return `seen carries unknown field(s) ${sx.join(', ')}`
    if (typeof s.calibration_hash !== 'string' || !HEX64.test(s.calibration_hash)) return 'seen.calibration_hash must be a sha256 hex digest'
    if (!Array.isArray(s.rungs)) return 'seen.rungs must be an array'
    for (const r of s.rungs) {
      if (!isObj(r) || !RUNG_NAMES.includes(r.rung as string) || !isNat(r.n) || !isNat(r.errors) || (r.errors as number) > (r.n as number)) return 'each seen rung is { rung, n, errors } with 0 ≤ errors ≤ n'
      if (extraKeys(r, ['rung', 'n', 'errors']).length) return 'a seen rung carries only rung, n, errors'
    }
    if (!isStrArr(s.failing_cases) || !isStrArr(s.blockers)) return 'seen.failing_cases and seen.blockers must be string arrays'
    if (d.proposal_kind === 'PROMOTION_PROPOSAL' && s.failing_cases.length) return 'a promotion proposal lists no failing cases'
    return undefined
  }

  if (d.kind === 'KEY_REGISTER' || d.kind === 'KEY_REVOKE') {
    if (!nonEmpty(d.subject_id)) return `a ${d.kind} names the person the key belongs to (subject_id)`
    if (typeof d.public_key !== 'string' || !keyFingerprint(d.public_key)) return 'public_key must be an Ed25519 public key (SPKI PEM)'
    if (d.kind === 'KEY_REGISTER') {
      if (!Array.isArray(d.roles) || d.roles.length === 0 || !d.roles.every(isRole)) return `roles must be a non-empty list drawn from ${ROLES.join(', ')}`
      if (new Set(d.roles).size !== d.roles.length) return 'roles must not repeat'
      if (d.tenants !== undefined && (!isStrArr(d.tenants) || d.tenants.length === 0 || !d.tenants.every(nonEmpty) || !sortedUnique(d.tenants))) return 'tenants, when given, is a sorted, unique, non-empty list of tenant ids'
      return undefined
    }
    if (!nonEmpty(d.reason)) return 'a KEY_REVOKE records why (reason)'
    return undefined
  }

  if (d.kind === 'CANARY_SEAL') {
    if (!nonEmpty(d.workflow_id)) return 'a CANARY_SEAL names its workflow_id'
    if (typeof d.commitment !== 'string' || !HEX64.test(d.commitment)) return 'commitment must be a sha256 hex digest (canaryCommitment)'
    return undefined
  }

  if (d.kind === 'CANARY_REVEAL') {
    if (!nonEmpty(d.workflow_id)) return 'a CANARY_REVEAL names its workflow_id'
    if (typeof d.seal !== 'string' || !HEX32.test(d.seal)) return 'seal must be the decision_id of the CANARY_SEAL it opens'
    if (!isStrArr(d.verdict_ids) || d.verdict_ids.length === 0 || !d.verdict_ids.every(nonEmpty)) return 'verdict_ids must name at least one verdict'
    if (!sortedUnique(d.verdict_ids)) return 'verdict_ids must be sorted and unique (the commitment is over the canonical set)'
    if (typeof d.salt !== 'string' || !SALT.test(d.salt)) return 'salt must be at least 32 hex characters (128 bits): without it, the sealed set could be guessed'
    return undefined
  }

  if (d.kind === 'REVIEW') {
    if (!nonEmpty(d.verdict_id)) return 'a REVIEW names the verdict it reviews (verdict_id)'
    if (d.tenant_id !== undefined && !nonEmpty(d.tenant_id)) return 'tenant_id, when given, names the tenant whose record is reviewed'
    if (d.decision !== 'UPHELD' && d.decision !== 'OVERTURNED') return 'a REVIEW decides UPHELD or OVERTURNED'
    if (d.procedure !== undefined && d.procedure !== 're-performed' && d.procedure !== 'inspected') return `procedure, when given, is 're-performed' or 'inspected'`
    return undefined
  }

  // POLICY_REVISION
  const rp = refProblem(d.policy, 'policy'); if (rp) return rp
  const sp = refProblem(d.supersedes, 'supersedes'); if (sp) return sp
  const pol = d.policy as unknown as PolicyRef, sup = d.supersedes as unknown as PolicyRef
  if (sup.policy_id !== pol.policy_id) return 'a revision supersedes a version of the same policy_id'
  if (sup.version === pol.version) return 'a revision must carry a new version'
  if (sup.hash === pol.hash) return 'a revision must change the policy (its hash equals the one it supersedes)'
  if (!nonEmpty(d.reason)) return 'a POLICY_REVISION records why (reason)'
  if (!isStrArr(d.changes) || d.changes.length === 0) return 'a POLICY_REVISION records what changed (changes)'
  const body = d.policy_body
  if (!isObj(body) || body.policy_version !== 'promotion-policy-v0') return 'policy_body must be the full revised promotion policy'
  if (body.policy_id !== pol.policy_id || body.version !== pol.version) return 'policy_body must be the version named by policy'
  if (hashOf(body) !== pol.hash) return 'policy.hash does not match policy_body (the hash of the full revised policy)'
  const expected = { supersedes: sup, revised_by: d.signer_id, revised_at: d.signed_at, reason: d.reason, changes: d.changes }
  if (!isObj(body.revision) || hashOf(body.revision) !== hashOf(expected)) {
    return 'policy_body.revision must record exactly this decision: supersedes, revised_by = signer_id, revised_at = signed_at, reason and changes'
  }
  return undefined
}

/** `<tenant>/<ruleset>@<version>`, split; undefined when a workflow id is not of that form. */
export function rulesetWorkflow(workflow_id: string): { tenant: string; ruleset: string; version: string } | undefined {
  const m = /^([^/]+)\/(.+)@([^@/]+)$/.exec(workflow_id)
  return m ? { tenant: m[1]!, ruleset: m[2]!, version: m[3]! } : undefined
}

const OUTCOME_SET: readonly string[] = ['PASS', 'FAIL', 'INSUFFICIENT_DATA']

/** A verdict the new ruleset would PASS that was recorded otherwise: the direction that lets more through. */
export const loosens = (c: SuccessionChange): boolean => c.to === 'PASS' && c.from !== 'PASS'

/** The first reason a GRANT's succession block is not well-formed, or undefined. (Book-dependent checks: the door and read.) */
function successionShapeProblem(to: string, s: unknown, answers: boolean): string | undefined {
  if (!isObj(s)) return 'succeeds, when given, is a succession { from, grant, reason, replay }'
  const extra = extraKeys(s, ['from', 'grant', 'reason', 'replay', 'loosening_reason'])
  if (extra.length) return `succeeds carries unknown field(s) ${extra.join(', ')}`
  if (answers) return 'a succession answers no proposal: it carries a grant a person made, it is not a yes to a proposal'
  if (!nonEmpty(s.from)) return 'a succession names the workflow it carries the grant from (succeeds.from)'
  const a = rulesetWorkflow(s.from), b = rulesetWorkflow(to)
  if (!a || !b) return `a succession is between versions of one ruleset: both workflows are <tenant>/<ruleset>@<version> (${s.from} → ${to})`
  if (a.tenant !== b.tenant) return `a succession stays within a tenant: ${s.from} is ${a.tenant}'s, ${to} is ${b.tenant}'s`
  if (a.ruleset !== b.ruleset) return `a succession carries a grant to another version of the same ruleset: ${a.ruleset} is not ${b.ruleset}`
  if (a.version === b.version) return `a succession is to another version: ${s.from} is this workflow`
  if (typeof s.grant !== 'string' || !HEX32.test(s.grant)) return 'succeeds.grant must be the decision_id of the GRANT in force on the old workflow'
  if (!nonEmpty(s.reason)) return 'a succession is a person\'s recorded decision: it needs a reason (succeeds.reason)'
  const r = s.replay
  if (r === undefined) return 'a succession carries the replay of the old workflow\'s verdicts under the new ruleset (succeeds.replay): the signer signs knowing what the new rules would have said'
  if (!isObj(r) || r.replay_version !== 'succession-replay-v0') return 'succeeds.replay must be a succession replay (replay_version succession-replay-v0; build it with successionReplay)'
  const rx = extraKeys(r, ['replay_version', 'through', 'head', 'engine_version', 'recorded', 'reperformed', 'changed'])
  if (rx.length) return `succeeds.replay carries unknown field(s) ${rx.join(', ')}`
  if (!isNat(r.through) || typeof r.head !== 'string' || !HEX64.test(r.head)) return 'succeeds.replay names the book it read: through (a count of events) and head (the entry_hash of the last)'
  if (!nonEmpty(r.engine_version)) return 'succeeds.replay names the engine that re-performed the verdicts (engine_version)'
  if (!isNat(r.recorded) || !isNat(r.reperformed) || (r.reperformed as number) > (r.recorded as number)) return 'succeeds.replay counts recorded ≥ reperformed ≥ 0'
  if (!Array.isArray(r.changed)) return 'succeeds.replay.changed must be an array'
  const ids: string[] = []
  for (const c of r.changed) {
    if (!isObj(c) || !nonEmpty(c.verdict_id) || !OUTCOME_SET.includes(c.from as string) || !OUTCOME_SET.includes(c.to as string) || extraKeys(c, ['verdict_id', 'from', 'to']).length) {
      return 'each replay change is { verdict_id, from, to } with outcomes PASS, FAIL or INSUFFICIENT_DATA'
    }
    if (c.from === c.to) return `replay change ${c.verdict_id} is not a change (${String(c.from)} both ways)`
    ids.push(c.verdict_id)
  }
  if (!sortedUnique(ids)) return 'succeeds.replay.changed must be sorted by verdict_id, each once'
  if (ids.length > (r.reperformed as number)) return 'succeeds.replay lists more changes than verdicts re-performed'
  const loose = (r.changed as SuccessionChange[]).filter(loosens).length
  if (s.loosening_reason !== undefined && !nonEmpty(s.loosening_reason)) return 'loosening_reason, when given, must be words'
  if (loose > 0 && s.loosening_reason === undefined) {
    return `the replay shows ${loose} verdict(s) the new ruleset would PASS that were recorded as FAIL or INSUFFICIENT_DATA (it loosens): a person states why that is accepted (succeeds.loosening_reason)`
  }
  if (loose === 0 && s.loosening_reason !== undefined) return 'loosening_reason is for a replay that loosens; this one does not'
  return undefined
}

export function decisionId(d: Signable): string {
  return hashOf(d).slice(0, 32)
}

/** The event header's subject for a decision (LedgerEvent.verdict_id). Never a verdict id, so it never collides with one. */
export function decisionSubject(d: BookDecision): string {
  switch (d.kind) {
    case 'POLICY_REVISION': return `policy:${d.policy.policy_id}@${d.policy.version}`
    case 'KEY_REGISTER':
    case 'KEY_REVOKE': return `key:${d.subject_id}`
    case 'CANARY_SEAL':
    case 'CANARY_REVEAL': return `canary:${d.workflow_id}`
    default: return `workflow:${d.workflow_id}`
  }
}

/** The commitment a CANARY_SEAL carries: the reveal must reproduce it exactly. */
export function canaryCommitment(workflow_id: string, verdict_ids: readonly string[], salt: string): string {
  return sha256(CANARY_COMMIT_PREFIX + canonicalize({ workflow_id, verdict_ids: [...new Set(verdict_ids)].sort(), salt }))
}

// ── signing ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const message = (d: Signable): Buffer => Buffer.from(DECISION_SIGNING_PREFIX + canonicalize(d), 'utf8')

/** Sign a person's decision (or review) with their Ed25519 private key (PKCS8 PEM). Refuses a malformed one. */
export function signDecision<D extends Signable>(decision: D, privateKeyPem: string): SignedDecision<D> {
  const problem = decisionProblem(decision)
  if (problem) throw new DecisionRefused(problem)
  const key = createPrivateKey(privateKeyPem)
  if (key.asymmetricKeyType !== 'ed25519') throw new DecisionRefused(`a decision is signed with an Ed25519 key, not ${key.asymmetricKeyType}`)
  const clean = JSON.parse(canonicalize(decision)) as D
  return {
    decision: clean,
    alg: 'ed25519',
    public_key: createPublicKey(key).export({ type: 'spki', format: 'pem' }).toString(),
    signature: edSign(null, message(clean), key).toString('base64'),
    decision_id: decisionId(clean),
  }
}

function spkiOf(pem: string): string | undefined {
  try { return createPublicKey(pem).export({ type: 'spki', format: 'der' }).toString('base64') } catch { return undefined }
}

export interface DecisionCheck {
  ok: boolean
  /** True when trusted_keys were supplied and the signing key is the one anchored to signer_id. */
  anchored: boolean
  reason?: string
}

/** The signature alone: well-formed, the id derives from the content, the Ed25519 signature verifies. No anchoring. */
export function verifySignature(s: unknown): { ok: boolean; reason?: string } {
  const no = (reason: string): { ok: false; reason: string } => ({ ok: false, reason })
  if (!isObj(s)) return no('not a signed decision')
  if (s.alg !== 'ed25519') return no(`unsupported alg: ${String(s.alg)}`)
  if (typeof s.public_key !== 'string' || typeof s.signature !== 'string') return no('a signed decision carries public_key and signature')
  const extra = extraKeys(s, ['decision', 'alg', 'public_key', 'signature', 'decision_id'])
  if (extra.length) return no(`a signed decision carries unknown field(s) ${extra.join(', ')}`)
  const problem = decisionProblem(s.decision)
  if (problem) return no(problem)
  const d = s.decision as unknown as Signable
  if (s.decision_id !== decisionId(d)) return no('decision_id does not derive from the decision (altered after signing)')
  let sigOk = false
  try {
    sigOk = edVerify(null, message(d), createPublicKey(s.public_key), Buffer.from(s.signature, 'base64'))
  } catch (e) {
    return no(`signature verification errored: ${(e as Error).message}`)
  }
  if (!sigOk) return no('signature does not verify: the decision was altered, or the key does not match')
  return { ok: true }
}

/** Is `pem` the key anchored to `signer_id` in a static trusted_keys map? */
function trustedCheck(trusted_keys: TrustedKeys, signer_id: string, pem: string): { ok: boolean; reason?: string } {
  const anchoredKeys = trusted_keys[signer_id]
  if (anchoredKeys === undefined) return { ok: false, reason: `signer '${signer_id}' has no anchored key: only a person whose key is anchored can decide` }
  const mine = spkiOf(pem)
  const listed = (typeof anchoredKeys === 'string' ? [anchoredKeys] : anchoredKeys).map(spkiOf)
  if (!mine || !listed.includes(mine)) return { ok: false, reason: `the signing key is not the one anchored to signer '${signer_id}'` }
  return { ok: true }
}

/**
 * Verify a signed decision on its own: well-formed, the id derives from the content, the Ed25519 signature verifies over
 * the domain-separated canonical body, and (with trusted_keys) the key is the one anchored to the signer. (Registry anchoring
 * needs the book: see authorizeSigner / readDecisionBook.)
 */
export function verifySignedDecision(s: unknown, opts: { trusted_keys?: TrustedKeys } = {}): DecisionCheck {
  const sig = verifySignature(s)
  if (!sig.ok) return { ok: false, anchored: false, reason: sig.reason! }
  if (!opts.trusted_keys) return { ok: true, anchored: false }
  const d = (s as { decision: Signable }).decision
  const t = trustedCheck(opts.trusted_keys, d.signer_id, (s as { public_key: string }).public_key)
  return t.ok ? { ok: true, anchored: true } : { ok: false, anchored: false, reason: t.reason! }
}

/**
 * Who may sign this, here? Once the registry is in force at `seq` (a root key, and a KEY_REGISTER earlier on the chain), the
 * key must be registered to the signer, unrevoked at `seq`, and hold the role the kind requires. Before that (the legacy
 * prefix), trusted_keys anchors if given; otherwise the signer is unanchored (signed, not identified).
 */
export function authorizeSigner(registry: KeyRegistry, seq: number, kind: BookDecisionKind | 'REVIEW', signer_id: string, pem: string, trusted_keys?: TrustedKeys, tenant?: string): Authorization {
  if (registry.inForceAt(seq)) {
    const h = registry.holds(seq, signer_id, pem, ROLE_FOR[kind], tenant)
    return h.ok ? { ok: true, via: 'registry' } : { ok: false, via: 'registry', reason: h.reason! }
  }
  if (trusted_keys) {
    const t = trustedCheck(trusted_keys, signer_id, pem)
    return t.ok ? { ok: true, via: 'trusted_keys' } : { ok: false, via: 'trusted_keys', reason: t.reason! }
  }
  return { ok: true, via: 'unanchored' }
}

/** The tenant a decision concerns (F-B): a workflow's, for GRANT / GRANT_COSIGN / DECLINE / CANARY_*; none (deployment-wide) otherwise. */
export function decisionTenant(d: BookDecision): string | undefined {
  return d.kind === 'GRANT' || d.kind === 'GRANT_COSIGN' || d.kind === 'DECLINE' || d.kind === 'CANARY_SEAL' || d.kind === 'CANARY_REVEAL' ? tenantOfWorkflow(d.workflow_id) : undefined
}

/** Replay the KEY events of a book into a registry (for the door: the read side re-verifies everything). */
export function registryOf(decisions: readonly DecisionEntry<BookDecision>[], root_keys: RootKeys | undefined): KeyRegistry {
  const reg = new KeyRegistry(root_keys)
  if (!reg.rooted) return reg
  for (const e of decisions) {
    const d = e.signed.decision
    if (d.kind !== 'KEY_REGISTER' && d.kind !== 'KEY_REVOKE') continue
    if (!reg.keyEventProblem(e.seq, d, e.signed.public_key)) reg.apply(e.seq, e.decision_id, d)
  }
  return reg
}

/** Build a well-formed GRANT (refuses a malformed one). Sign it with signDecision and append it with ledger.decide. */
export function makeGrant(input: Omit<GrantDecision, 'decision_version' | 'kind'>): GrantDecision {
  const d: GrantDecision = { decision_version: 'decision-v0', kind: 'GRANT', ...input, policy: { ...input.policy } }
  const problem = decisionProblem(d)
  if (problem) throw new DecisionRefused(problem)
  return d
}

/**
 * D-DUAL: a second person's co-signature on a GRANT already on the book (its entry, or its signed decision). Sign it with
 * signDecision and append it with ledger.decide; the door refuses the grant's own signer or key, a repeat co-signer, and a
 * grant a later one has superseded.
 */
export function makeCosign(grant: { decision_id: string; signed: { decision: GrantDecision } } | SignedDecision<GrantDecision>, by: { signer_id: string; signed_at: string; note?: string }): GrantCosignDecision {
  const g = 'signed' in grant ? grant.signed.decision : grant.decision
  if (g?.kind !== 'GRANT') throw new DecisionRefused('a co-signature names a GRANT')
  const d: GrantCosignDecision = {
    decision_version: 'decision-v0', kind: 'GRANT_COSIGN', workflow_id: g.workflow_id, grant: grant.decision_id, level: g.level,
    signer_id: by.signer_id, signed_at: by.signed_at, ...(by.note !== undefined ? { note: by.note } : {}),
  }
  const problem = decisionProblem(d)
  if (problem) throw new DecisionRefused(problem)
  return d
}

/** Build a well-formed signed-review body. Sign it with signDecision and append it with ledger.reviewSigned. */
export function makeReview(input: Omit<ReviewDecisionBody, 'decision_version' | 'kind'>): ReviewDecisionBody {
  const d: ReviewDecisionBody = { decision_version: 'decision-v0', kind: 'REVIEW', ...input }
  const problem = decisionProblem(d)
  if (problem) throw new DecisionRefused(problem)
  return d
}

/** Build a KEY_REGISTER (roles and tenants sorted). Signed by the registry root, or a registered key_admin. */
export function makeKeyRegister(input: Omit<KeyRegisterDecision, 'decision_version' | 'kind'>): KeyRegisterDecision {
  const d: KeyRegisterDecision = {
    decision_version: 'decision-v0', kind: 'KEY_REGISTER', ...input, roles: [...input.roles].sort(),
    ...(input.tenants ? { tenants: [...new Set(input.tenants)].sort() } : {}),
  }
  const problem = decisionProblem(d)
  if (problem) throw new DecisionRefused(problem)
  return d
}

/** Build a KEY_REVOKE. Signed by the registry root, a registered key_admin, or the key itself. */
export function makeKeyRevoke(input: Omit<KeyRevokeDecision, 'decision_version' | 'kind'>): KeyRevokeDecision {
  const d: KeyRevokeDecision = { decision_version: 'decision-v0', kind: 'KEY_REVOKE', ...input }
  const problem = decisionProblem(d)
  if (problem) throw new DecisionRefused(problem)
  return d
}

// ── the book ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const OUTCOMES: ReadonlySet<unknown> = new Set(['PASS', 'FAIL', 'INSUFFICIENT_DATA'])
const NAMED_AGGREGATIONS: ReadonlySet<unknown> = new Set(AGGREGATIONS)
/** The e-invoice twin's versions from before its 0.3.0 outcome rule, and the aggregation it names since (verdict/aggregation.ts). */
const EINVOICE_PRE_CORRECTION: ReadonlySet<unknown> = new Set(['0.1.0', '0.2.0'])
const EINVOICE_AGGREGATION: Aggregation = 'ANY_FAIL_FAILS_CONSISTENCY_ALONE_NEVER_PASSES'

/**
 * R3 (red team, 2026-09-28): the verdict door, re-applied on read to a RECORD payload. The first reason `x` does not belong
 * on the book of record as a VERDICT, or undefined. The same checks as the HTTP door (http/service.ts verdictDoorProblem; a
 * test pins the two in agreement): never generated (a COUNSEL tag, a GENERATED provenance, the marks of counsel or an
 * opinion); the VERDICT-channel contract (verdict/channel.ts proofProblem: verdict-shaped, replayable, bound to its inputs,
 * every PASS/FAIL claim evidenced); well-formed under schema v0 (three outcomes, a named aggregation, an outcome consistent
 * with its claims under the rule it names, coverage that recounts).
 *
 * TWO TOLERANCES, so every book valid today stays valid:
 *   - a judgement-tier (REASONED) finding still reads (DECISION R3-LEGACY). Such a verdict was recordable before the ledger's
 *     door existed (wave 2), and the read side already excludes it from evidence (voice.ts notVerdictEvidence).
 *   - the PASS / INSUFFICIENT_DATA edge is not recomputed (DECISION R3-OUTCOME): a held action with a PASS claim and an
 *     ungrounded one is INSUFFICIENT_DATA (verifyAction, F1), which the HTTP door's exact recompute wrongly refuses.
 * Everything else is enforced. A verdict naming ANY_FAIL_FAILS_CONSISTENCY_ALONE_NEVER_PASSES (the e-invoice twin since 0.3.0)
 * is recomputed EXACTLY under that rule: it has no tolerated edge.
 *
 * HONEST BOUNDARY: this catches a COUNSEL object or a malformed or inconsistent verdict spliced into a re-linked book. It
 * cannot catch a SELF-CONSISTENT forged outcome (claims, outcome and coverage all rewritten together): verdict_id binds the
 * inputs, not the result (red team R1), so only re-executing the engine, a signed envelope, or an externally anchored head
 * shows that.
 */
export function recordedVerdictProblem(x: unknown): string | undefined {
  if (!isObj(x)) return 'not a verdict: not a JSON object'
  if (x.channel === 'COUNSEL') return 'COUNSEL (channel COUNSEL) is generated advice: it is never a recorded VERDICT'
  if (isObj(x.provenance) && x.provenance.type === 'GENERATED') return 'generated material (provenance GENERATED) is never a recorded VERDICT'
  if ('counsel_version' in x || 'opinion_version' in x || 'dismissible' in x || 'holds_action' in x) {
    return 'carries the marks of COUNSEL (a counsel/opinion version, dismissible, holds_action): generated advice is never a recorded VERDICT'
  }
  const problem = proofProblem(x, { allowReasoned: true })
  if (problem) return problem
  const v = x as unknown as Verdict
  if (v.schema_version !== 'v0') return `verdict ${v.verdict_id}: schema_version ${JSON.stringify(v.schema_version)} is not v0`
  if (typeof v.issued_at !== 'string') return `verdict ${v.verdict_id}: issued_at is missing`
  if (!OUTCOMES.has(v.outcome)) return `verdict ${v.verdict_id}: outcome ${JSON.stringify(v.outcome)} is not PASS, FAIL or INSUFFICIENT_DATA (three outcomes, never a fourth)`
  if (!NAMED_AGGREGATIONS.has(v.aggregation)) return `verdict ${v.verdict_id}: aggregation must be one of ${AGGREGATIONS.join(', ')} (a named rule)`
  let pass = 0, fail = 0, ins = 0
  for (const c of v.claims as unknown[]) {
    if (!isObj(c) || typeof c.claim_id !== 'string' || typeof c.rule_id !== 'string') return `verdict ${v.verdict_id}: every claim needs a claim_id and a rule_id`
    if (!OUTCOMES.has(c.outcome)) return `verdict ${v.verdict_id}: claim ${c.claim_id} has outcome ${JSON.stringify(c.outcome)}`
    if (c.outcome === 'INSUFFICIENT_DATA') {
      ins++
      if (!isObj(c.insufficiency) || typeof c.insufficiency.reason !== 'string') return `verdict ${v.verdict_id}: claim ${c.claim_id} abstains without an explained insufficiency`
    } else {
      if (c.insufficiency !== undefined) return `verdict ${v.verdict_id}: claim ${c.claim_id} is ${String(c.outcome)} yet carries an insufficiency`
      if (c.outcome === 'PASS') pass++
      else fail++
    }
  }
  // The outcome must be CONSISTENT with its claims: FAIL exactly when a claim FAILs, and PASS only on a PASS claim. The
  // engines differ, legitimately, on the PASS / can't-tell edge (verify() passes a document with abstentions; verifyAction,
  // since F1, holds a partially grounded action as INSUFFICIENT_DATA), so the book does not recompute that edge
  // (DECISION R3-OUTCOME; fork: here).
  if ((fail > 0) !== (v.outcome === 'FAIL')) return `verdict ${v.verdict_id}: outcome ${v.outcome} does not follow from its claims under ${v.aggregation} (${fail} FAIL claim(s))`
  if (v.outcome === 'PASS' && pass === 0) return `verdict ${v.verdict_id}: outcome PASS with no PASS claim does not follow from its claims`
  // verifyAction's own rule, unchanged since the action module shipped (09-23): execute only when EVERY value is grounded, so
  // an action verdict with any can't-tell claim is INSUFFICIENT_DATA, never PASS. Holding it here refuses the forged PASS twin
  // of a held action (security fix FS1/FS2, 2026-09-28; FS2's "unbumped change" premise was checked and does not hold).
  if (isObj(v.ruleset) && v.ruleset.id === 'action' && v.outcome === 'PASS' && ins > 0) {
    return `verdict ${v.verdict_id}: an action verdict is PASS only when every value is grounded; ${ins} claim(s) could not be grounded, so its outcome is INSUFFICIENT_DATA`
  }
  // A rule with no tolerated edge is recomputed exactly: the outcome must be the one its claims give under the rule it names.
  if (v.aggregation !== 'ANY_FAIL_FAILS') {
    const expected = aggregateOutcome(v.aggregation, v.claims)
    if (v.outcome !== expected) return `verdict ${v.verdict_id}: outcome ${v.outcome} does not follow from its claims under ${v.aggregation} (they give ${expected}${expected === 'INSUFFICIENT_DATA' && v.outcome === 'PASS' ? ': only CONSISTENCY claims PASSed, and a document agreeing with itself never PASSes the values checked against it' : ''})`
  }
  // The e-invoice twin's rule since 0.3.0 (PRODUCT-FIX-1, 2026-09-29): PASS needs at least one verified extracted value, and its
  // verdicts name that rule, so the recompute above holds it. A 0.3.0+ twin verdict naming ANY_FAIL_FAILS is refused, which also
  // refuses the footing-only PASS relabelled to dodge the recompute. The twin's versions before 0.3.0 issued exactly that PASS
  // under ANY_FAIL_FAILS (the published miss, docs/EINVOICE-TWIN-CORRECTION-2026-09-29.md), and a book that recorded one stays
  // valid (DECISION EINVOICE-DOOR; fork: hold every version, which would break any such book on read).
  if (isObj(v.ruleset) && typeof v.ruleset.id === 'string' && v.ruleset.id.startsWith('twin-einvoice') && !EINVOICE_PRE_CORRECTION.has(v.ruleset.version)
    && v.aggregation !== EINVOICE_AGGREGATION) {
    return `verdict ${v.verdict_id}: an e-invoice twin verdict from 0.3.0 names aggregation ${EINVOICE_AGGREGATION} (its footing alone never makes it PASS), not ${v.aggregation}`
  }
  const cov = v.coverage as unknown
  if (!isObj(cov) || cov.claims_total !== v.claims.length || cov.claims_pass !== pass || cov.claims_fail !== fail || cov.claims_insufficient !== ins || cov.claims_checked !== pass + fail) {
    return `verdict ${v.verdict_id}: coverage does not recount from its claims (${pass} PASS · ${fail} FAIL · ${ins} can't-tell of ${v.claims.length})`
  }
  return undefined
}

export interface DecisionBook {
  /** The whole book verifies: content hashes, event headers, every decision's shape, id, signature (and anchoring), every signed review, every committed sample. */
  ok: boolean
  /** The chain check (brokenAt / reason name the first failure). */
  check: ChainCheck
  /** Every rung decision (GRANT, DECLINE, POLICY_REVISION), in chain order. Empty when the book does not verify. */
  decisions: DecisionEntry[]
  /** Every key-registry decision (KEY_REGISTER, KEY_REVOKE), in chain order. */
  keys: DecisionEntry<KeyDecision>[]
  /** Every reviewer-attention decision (CANARY_SEAL, CANARY_REVEAL), in chain order. */
  canaries: DecisionEntry<CanaryDecision>[]
  /**
   * Every co-signature (GRANT_COSIGN, D-DUAL), in chain order, whether it counts or not. The ones that count are also stamped
   * on their grant (`DecisionEntry.cosigned`); noEffect() says why any other does not.
   */
  cosigns: DecisionEntry<GrantCosignDecision>[]
  /**
   * Signers whose key is not anchored (no trusted_keys, and the registry not in force), sorted. Signed, not tied to a person:
   * their rung and canary decisions are listed (with `via: 'unanchored'`) and have no effect (D-ANCHOR; noEffect()).
   */
  unanchored: string[]
  /** Every committed random-review SAMPLE, re-derived from the chain and matched (./sampling.ts), in chain order. */
  samples: SampleEntry[]
  /** Every signed REVIEW, verified, in chain order. */
  signed_reviews: SignedReviewEntry[]
  /** The key registry at the head. Present when the book was read with root_keys. */
  registry?: { started?: number; keys: KeyEntry[] }
}

/**
 * Verify a book in full and read its decisions. Beyond the payload hashes (verifyChainAgainst), the event HEADER is checked
 * against its hashed payload (type, subject and time are not in entry_hash, so this is what stops a relabelled event), and
 * every decision event re-verifies on its own (signature; anchoring by trusted_keys or the registry). Signed reviews are held
 * to their bodies, committed samples are re-derived from the chain, canary reveals are held to their seals, and key events
 * to the registry's authority. The first failure makes the whole book not ok.
 *
 * Read WITHOUT anchors, an events array a ledger exported in-process (carryOwnRead: snapshotOfLedger) reads as that ledger's
 * own read of it: the same bytes (same length and head, re-verified here), the ledger's own trusted keys or root key. Anchors
 * passed here always win.
 */
export function readDecisionBook(events: readonly LedgerEvent[], payloads: readonly unknown[], opts: AnchorOptions = {}): DecisionBook {
  const read = readBookAs(events, payloads, opts)
  const explicit = opts.trusted_keys !== undefined || (opts.root_keys !== undefined && opts.root_keys.length > 0)
  const own = explicit ? undefined : OWN_READ.get(events)
  if (!own || !read.ok || own.check.length !== read.check.length || own.check.head !== read.check.head) return read
  return structuredClone(own)
}

/**
 * The anchored read a ledger gave its own exported chain, keyed by the exported events ARRAY (identity), off the object: a
 * chain parsed from JSON or a request body never has an entry, so nothing outside the process can claim a ledger's anchors.
 */
const OWN_READ = new WeakMap<readonly LedgerEvent[], DecisionBook>()

/**
 * Bind a ledger's own read of its chain (`ledger.decisionBook()`, under its own trusted keys or root key) to the events array
 * it exported, so a reader handed that export without anchors reads it as the ledger does (D-ANCHOR: the grants the ledger
 * honors, and no others). A broken own read is carried too: a book that does not verify under its own anchors grants nothing.
 */
export function carryOwnRead(events: readonly LedgerEvent[], book: DecisionBook): void {
  if (book.check.length !== events.length) return
  OWN_READ.set(events, structuredClone(book))
}

/**
 * P-G (ledger-disk, 2026-09-28): the state the book walk carries from one event to the next, lifted out of the loop so it can
 * be kept and fed only what was appended. The checks for event i read only events and payloads ≤ i (and the period spans of
 * periods closed before i, which later events never change), so a reader fed 0 … n−1 in one call or in several reads the same
 * book. A failure is never resumed from: the reader is dropped and the next read walks the whole book.
 */
class BookReader {
  /** Events 0 … through−1 have been read. */
  through = 0
  readonly reg: KeyRegistry
  decisions: DecisionEntry[] = []
  keys: DecisionEntry<KeyDecision>[] = []
  canaries: DecisionEntry<CanaryDecision>[] = []
  cosigns: DecisionEntry<GrantCosignDecision>[] = []
  unanchored = new Set<string>()
  samples: SampleEntry[] = []
  signed_reviews: SignedReviewEntry[] = []
  recorded = new Set<string>()
  /** verdict id → every tenant that recorded it (one tenant, the common case, as the string itself). */
  owners = new Map<string, string | Set<string>>()
  latestOwner = new Map<string, string>()
  sampleKeys = new Set<string>()
  /** RULESET_SUCCESSION: workflow → the positions of its verdicts' first records, ascending (a replay is checked against them). */
  wfFirst = new Map<string, number[]>()

  /** Throws when a root key is not an Ed25519 public key (the book then reads as not ok, after its hashes). */
  constructor(readonly opts: AnchorOptions) {
    this.reg = new KeyRegistry(opts.root_keys)
  }

  #owned(id: string, tenant: string): boolean {
    const o = this.owners.get(id)
    return o === tenant || (o instanceof Set && o.has(tenant))
  }

  #own(id: string, tenant: string): void {
    const o = this.owners.get(id)
    if (o === undefined) this.owners.set(id, tenant)
    else if (typeof o === 'string') { if (o !== tenant) this.owners.set(id, new Set([o, tenant])) }
    else o.add(tenant)
  }

  /** Read event i (its payload `p` already hash-verified): undefined, or why the book breaks there. Advances `through` when it reads. */
  step(events: readonly LedgerEvent[], payloads: readonly unknown[], i: number, p: unknown, spansOf: (u: unknown) => PeriodSpan[] | undefined): string | undefined {
    const why = this.#read(events, payloads, i, p, spansOf)
    if (why === undefined) this.through = i + 1
    return why
  }

  #read(events: readonly LedgerEvent[], payloads: readonly unknown[], i: number, p: unknown, spansOf: (u: unknown) => PeriodSpan[] | undefined): string | undefined {
    const { reg, opts, decisions, keys, canaries, cosigns, unanchored, samples, signed_reviews, recorded, latestOwner, sampleKeys } = this
    const ev = events[i]!
    const ptype = isObj(p) ? p.type : undefined
    if (ptype !== ev.type) return `event ${i} is labelled ${ev.type} but its hashed payload is ${String(ptype)}`
    const q = p as Record<string, unknown>
    if (ev.type === 'RECORD') {
      const v = q.verdict as { verdict_id?: unknown } | undefined
      if (!isObj(v) || v.verdict_id !== ev.verdict_id || q.recorded_at !== ev.ts) return `event ${i}'s header (verdict_id, ts) does not match its hashed RECORD payload`
      const door = recordedVerdictProblem(v)
      if (door) return `event ${i} records something that does not pass the verdict door (${door}): only a well-formed VERDICT sits on the book of record`
      recorded.add(ev.verdict_id)
      if (typeof q.tenant_id === 'string') {
        const wf = this.#owned(ev.verdict_id, q.tenant_id) ? undefined : recordWorkflow(p)
        if (wf !== undefined) {
          const at = this.wfFirst.get(wf)
          if (at) at.push(i)
          else this.wfFirst.set(wf, [i])
        }
        this.#own(ev.verdict_id, q.tenant_id)
        latestOwner.set(ev.verdict_id, q.tenant_id)
      }
      return undefined
    }
    if (ev.type === 'REVIEW') {
      const r = q.review as Review | undefined
      if (q.verdict_id !== ev.verdict_id || !isObj(r) || r.decided_at !== ev.ts) return `event ${i}'s header (verdict_id, ts) does not match its hashed REVIEW payload`
      if (q.tenant_id !== undefined && !(typeof q.tenant_id === 'string' && this.#owned(ev.verdict_id, q.tenant_id))) {
        return `event ${i} reviews tenant ${String(q.tenant_id)}'s record of ${ev.verdict_id}, but that tenant never recorded it before`
      }
      const reviewedTenant = typeof q.tenant_id === 'string' ? q.tenant_id : latestOwner.get(ev.verdict_id)
      if (q.signed === undefined) return undefined // an unsigned review: legacy, and still read (the policy decides whether it counts)
      const sig = verifySignature(q.signed)
      if (!sig.ok) return `signed review at ${i}: ${sig.reason}`
      const s = q.signed as unknown as SignedDecision<ReviewDecisionBody>
      const d = s.decision
      if (d.kind !== 'REVIEW') return `event ${i} is a REVIEW but its signed body is a ${d.kind}`
      if (d.verdict_id !== ev.verdict_id || r.reviewer_id !== d.signer_id || r.decision !== d.decision || (r.note ?? null) !== (d.note ?? null)
        || (d.tenant_id !== undefined && d.tenant_id !== reviewedTenant)) {
        return `event ${i}'s review (verdict, tenant, reviewer, decision, note) does not match the body its reviewer signed`
      }
      if (!recorded.has(ev.verdict_id)) return `event ${i} signs a review of a verdict not recorded before it`
      const a = authorizeSigner(reg, i, 'REVIEW', d.signer_id, s.public_key, opts.trusted_keys, reviewedTenant)
      if (!a.ok) return `signed review at ${i}: ${a.reason}`
      if (a.via === 'unanchored') unanchored.add(d.signer_id)
      signed_reviews.push({
        seq: ev.seq, entry_hash: ev.entry_hash, verdict_id: ev.verdict_id, ...(reviewedTenant !== undefined ? { tenant_id: reviewedTenant } : {}), decision_id: s.decision_id, signer_id: d.signer_id,
        fingerprint: keyFingerprint(s.public_key)!, decision: d.decision, ...(d.procedure ? { procedure: d.procedure } : {}), via: a.via,
      })
      return undefined
    }
    if (ev.type === 'SAMPLE') {
      const body = q.sample as SampleBody | undefined
      if (!isObj(body) || !isObj(body.period) || q.recorded_at !== ev.ts || ev.verdict_id !== sampleSubject(body)) return `event ${i}'s header (subject, ts) does not match its hashed SAMPLE payload`
      const re = deriveSample(events, payloads, { workflow_id: body.workflow_id, unit: body.period.unit, start: body.period.start, rates: body.rates }, spansOf(body.period.unit))
      if ('problem' in re) return `sample at ${i}: ${re.problem}`
      if (hashOf(re) !== hashOf(body)) return `sample at ${i} does not re-derive from the chain (an altered frame, seed or selection): anyone re-drawing gets a different queue`
      if (re.closed_by >= i) return `sample at ${i} was drawn before its period closed (its epoch was not fixed)`
      const key = sampleKey(re)
      if (sampleKeys.has(key)) return `sample at ${i} commits the same draw twice`
      sampleKeys.add(key)
      samples.push({ seq: ev.seq, entry_hash: ev.entry_hash, recorded_at: ev.ts, sample: structuredClone(re) })
      return undefined
    }
    if (!isBookDecisionKind(ev.type)) return `event ${i} has an unknown type ${String(ev.type)}`
    const sig = verifySignature(q.signed)
    if (!sig.ok) return `decision at ${i}: ${sig.reason}`
    const signed = q.signed as unknown as SignedDecision<BookDecision>
    const d = signed.decision
    if (decisionEventType(d.kind) !== ev.type) return `event ${i} is labelled ${ev.type} but the signed decision is a ${d.kind}`
    if (ev.verdict_id !== decisionSubject(d) || q.recorded_at !== ev.ts) return `event ${i}'s header (subject, ts) does not match its signed decision`
    let via: Authorization['via'] | undefined
    if (d.kind === 'KEY_REGISTER' || d.kind === 'KEY_REVOKE') {
      if (reg.rooted) {
        const kp = reg.keyEventProblem(i, d, signed.public_key)
        if (kp) return `decision at ${i}: ${kp}`
        reg.apply(i, signed.decision_id, d)
      } else {
        unanchored.add(d.signer_id) // without a root key the registry is inert: the event is a signature, nothing more
      }
    } else {
      const a = authorizeSigner(reg, i, d.kind, d.signer_id, signed.public_key, opts.trusted_keys, decisionTenant(d))
      if (!a.ok) return `decision at ${i}: ${a.reason}`
      if (a.via === 'unanchored') unanchored.add(d.signer_id)
      via = a.via
    }
    const entry = {
      seq: ev.seq, entry_hash: ev.entry_hash, recorded_at: ev.ts, decision_id: signed.decision_id, signed: structuredClone(signed), ...(via !== undefined ? { via } : {}),
      // RULESET_SUCCESSION: whether the replay matches the book is read here, where the chain is; a mismatch gives the grant
      // no effect (successionProblem), it does not break the book (the door cannot see the chain, so it could not refuse it).
      ...(d.kind === 'GRANT' && d.succeeds ? { replay: this.#replayCheck(events, payloads, i, d.succeeds) } : {}),
    }
    if (d.kind === 'CANARY_SEAL' || d.kind === 'CANARY_REVEAL') {
      const c = canaryConflict(d, canaries, recorded)
      if (c) return `decision at ${i}: ${c}`
      canaries.push(entry as DecisionEntry<CanaryDecision>)
    } else if (d.kind === 'GRANT_COSIGN') {
      // A co-signature must name a GRANT earlier on the book, of the same workflow and level (else the book is broken). Whether
      // it COUNTS (anchored, another person, another key) is read here and stamped on the grant; one that does not is listed.
      const g = decisions.find(e => e.decision_id === d.grant && e.signed.decision.kind === 'GRANT') as DecisionEntry<GrantDecision> | undefined
      if (!g) return `decision at ${i}: a GRANT_COSIGN names grant ${d.grant}, which is not a GRANT earlier on the book`
      if (g.signed.decision.workflow_id !== d.workflow_id || g.signed.decision.level !== d.level) {
        return `decision at ${i}: grant ${d.grant} sets ${g.signed.decision.workflow_id} at ${g.signed.decision.level}; the co-signature says ${d.workflow_id} at ${d.level}`
      }
      const c = entry as DecisionEntry<GrantCosignDecision>
      if (!cosignProblem(c, g, g.cosigned ?? [], true)) (g.cosigned ??= []).push(cosignOf(c))
      cosigns.push(c)
    } else if (d.kind === 'KEY_REGISTER' || d.kind === 'KEY_REVOKE') {
      keys.push(entry as DecisionEntry<KeyDecision>)
    } else {
      decisions.push(entry as DecisionEntry)
    }
    return undefined
  }

  /**
   * A succession's replay against the book: the span it names ends before the succession and at the head it names; it counts
   * exactly the verdicts recorded under `from` in that span; each changed verdict is one of them, recorded with the outcome
   * the replay says. (What the new ruleset says of each needs the documents: checkSuccessionReplay re-performs it.)
   */
  #replayCheck(events: readonly LedgerEvent[], payloads: readonly unknown[], i: number, s: Succession): { matches: boolean; reason?: string } {
    const no = (reason: string): { matches: false; reason: string } => ({ matches: false, reason })
    const r = s.replay
    if (r.through > i) return no(`it covers events 0 to ${r.through - 1}, past its own position (seq ${i})`)
    const head = r.through === 0 ? GENESIS : events[r.through - 1]!.entry_hash
    if (head !== r.head) return no(`its head ${r.head.slice(0, 12)}… is not the book's at event ${r.through - 1} (${head.slice(0, 12)}…)`)
    const at = (this.wfFirst.get(s.from) ?? []).filter(p => p < r.through)
    if (at.length !== r.recorded) return no(`it counts ${r.recorded} verdict(s) recorded under ${s.from} before event ${r.through}; the book records ${at.length}`)
    const want = new Map(r.changed.map(c => [c.verdict_id, c]))
    for (const p of at) {
      const c = want.get(events[p]!.verdict_id)
      if (!c) continue
      want.delete(c.verdict_id)
      const outcome = (payloads[p] as { verdict?: { outcome?: unknown } } | undefined)?.verdict?.outcome
      if (outcome !== c.from) return no(`it says ${c.verdict_id} was recorded ${c.from}; the book records ${String(outcome)}`)
    }
    const stray = want.keys().next()
    if (!stray.done) return no(`it names ${stray.value}, which is not recorded under ${s.from} before event ${r.through}`)
    return { matches: true }
  }

  /** A copy to feed further, leaving this one as it is (a snapshot's reader resuming from its ledger's). */
  fork(): BookReader {
    const r = new BookReader(this.opts)
    // The registry is replayed from the key events it applied (every listed one, when rooted), in order: the same state.
    if (this.reg.rooted) for (const e of this.keys) r.reg.apply(e.seq, e.decision_id, e.signed.decision)
    r.through = this.through
    const lists = structuredClone({ decisions: this.decisions, keys: this.keys, canaries: this.canaries, cosigns: this.cosigns, samples: this.samples, signed_reviews: this.signed_reviews })
    r.decisions = lists.decisions
    r.keys = lists.keys
    r.canaries = lists.canaries
    r.cosigns = lists.cosigns
    r.samples = lists.samples
    r.signed_reviews = lists.signed_reviews
    r.unanchored = new Set(this.unanchored)
    r.recorded = new Set(this.recorded)
    r.owners = new Map(Array.from(this.owners, ([id, o]) => [id, typeof o === 'string' ? o : new Set(o)] as [string, string | Set<string>]))
    r.latestOwner = new Map(this.latestOwner)
    r.sampleKeys = new Set(this.sampleKeys)
    r.wfFirst = new Map(Array.from(this.wfFirst, ([wf, at]) => [wf, [...at]] as [string, number[]]))
    return r
  }

  /** The book as read through `through`, as fresh objects (the reader's own lists keep changing as it is fed). */
  result(base: ChainCheck): DecisionBook {
    const lists = structuredClone({ decisions: this.decisions, keys: this.keys, canaries: this.canaries, cosigns: this.cosigns, samples: this.samples, signed_reviews: this.signed_reviews })
    const reg = this.reg
    return {
      ok: true, check: base, decisions: lists.decisions, keys: lists.keys, canaries: lists.canaries, cosigns: lists.cosigns, unanchored: [...this.unanchored].sort(),
      samples: lists.samples, signed_reviews: lists.signed_reviews,
      ...(reg.rooted ? { registry: { ...(reg.started !== undefined ? { started: reg.started } : {}), keys: reg.snapshot() } } : {}),
    }
  }
}

/**
 * P-G: the readers an in-process ledger keeps for its own chain, one per anchor set, keyed (like the verified prefix and
 * OWN_READ) by the events ARRAY, off the object: nothing parsed from JSON or a request body carries one.
 */
interface ReaderHome {
  /** The ledger's own append-only events and payloads (its positions below any reader's `through` never change). */
  events: readonly LedgerEvent[]
  payloads: readonly unknown[]
  readers: Map<string, BookReader>
}
const HOMES = new WeakMap<readonly LedgerEvent[], ReaderHome>()

/** An in-process ledger's own chain: its reads keep a book reader and feed it only what was appended. Not exported from the package. */
export function keepBookReaders(events: readonly LedgerEvent[], payloads: readonly unknown[]): void {
  HOMES.set(events, { events, payloads, readers: new Map() })
}

/** A snapshot of that chain (`to`, a copy of the array): a reader of it resumes from the ledger's reader when the copy is untouched. */
export function shareBookReaders(from: readonly LedgerEvent[], to: readonly LedgerEvent[]): void {
  const home = HOMES.get(from)
  if (home) HOMES.set(to, home)
}

/** Forget the kept readers: the next read walks the whole book (a full re-check). */
export function dropBookReaders(events: readonly LedgerEvent[]): void {
  HOMES.get(events)?.readers.clear()
}

const anchorKey = (opts: AnchorOptions): string => JSON.stringify([opts.trusted_keys ?? null, opts.root_keys ?? null])

/** Events and payloads from..upto−1 of a snapshot are, by identity, its ledger's own (a disk-backed one: a view of the same store, untouched). */
function sameAsHome(home: ReaderHome, events: readonly LedgerEvent[], payloads: readonly unknown[], from: number, upto: number): boolean {
  if (upto > home.events.length || upto > events.length) return false
  for (let i = from; i < upto; i++) if (events[i] !== home.events[i]) return false
  const own = payloadViewOf(home.payloads)
  if (own) {
    const v = payloadViewOf(payloads)
    return v !== undefined && v.store === own.store && v.pristine >= upto
  }
  for (let i = from; i < upto; i++) if (payloads[i] !== home.payloads[i]) return false
  return true
}

function readBookAs(events: readonly LedgerEvent[], payloads: readonly unknown[], opts: AnchorOptions): DecisionBook {
  const fail = (check: ChainCheck): DecisionBook => ({ ok: false, check, decisions: [], keys: [], canaries: [], cosigns: [], unanchored: [], samples: [], signed_reviews: [] })
  if (payloads.length !== events.length) {
    return fail({ ok: false, length: events.length, head: events.length ? events[events.length - 1]!.entry_hash : GENESIS, reason: `the book has ${events.length} events but ${payloads.length} payloads` })
  }
  // P-G: resume from the reader kept for this chain and these anchors, when the chain is the ledger's own (fed in place) or a
  // snapshot of it whose read prefix is untouched (fed as a copy, or read as is when it is already at the snapshot's end).
  const home = HOMES.get(events)
  const key = anchorKey(opts)
  const inPlace = home !== undefined && home.events === events && home.payloads === payloads
  const kept = home?.readers.get(key)
  const usable = kept !== undefined && kept.through <= events.length && (inPlace || sameAsHome(home!, events, payloads, 0, kept.through))
  let r: BookReader | undefined
  let rootProblem: string | undefined
  if (usable) r = inPlace || kept!.through === events.length ? kept! : kept!.fork()
  else {
    try { r = new BookReader(opts) } catch (e) { rootProblem = (e as Error).message }
  }
  const drop = (): void => { if (inPlace && r === kept) home!.readers.delete(key) }
  const spansByUnit = new Map<PeriodUnit, PeriodSpan[]>() // over THIS call's events (a sample fed here sees the spans a full walk sees)
  const spansOf = (u: unknown): PeriodSpan[] | undefined => {
    if (!isPeriodUnit(u)) return undefined
    if (!spansByUnit.has(u)) spansByUnit.set(u, chainPeriods(events, u))
    return spansByUnit.get(u)
  }
  // The walk is fused with the hash layer: each payload is read once, hashed, then read by the book reader. The result is the
  // monolithic walk's: the first structural break, else the first altered payload, else the first event the reader refuses.
  let first: { i: number; reason: string } | undefined
  const step = (i: number, p: unknown): void => {
    if (first || !r || i < r.through) return
    const why = r.step(events, payloads, i, p, spansOf)
    if (why !== undefined) first = { i, reason: why }
  }
  let base: ChainCheck
  try {
    base = verifyChainAgainst(events, ev => payloads[ev.seq], {
      payloads,
      // Events between the reader and the verified prefix were verified before but not yet read: read them first, in order.
      onPrefix: from => { for (let i = r?.through ?? from; i < from && !first; i++) step(i, payloads[i]) },
      onVerified: step,
    })
  } catch (e) {
    drop()
    throw e
  }
  if (!base.ok) { drop(); return fail(base) }
  if (rootProblem !== undefined || !r) return fail({ ok: false, length: events.length, head: base.head, reason: rootProblem ?? 'no reader' })
  if (first) { drop(); return fail({ ok: false, length: events.length, head: base.head, brokenAt: first.i, reason: first.reason }) }
  if (home && r !== kept && (!kept || kept.through < r.through) && sameAsHome(home, events, payloads, usable ? kept!.through : 0, r.through)) home.readers.set(key, r)
  return r.result(base)
}

// ── selection (pure; used by every reader, and by the ledger's door) ─────────────────────────────────────────────────

/**
 * D-ANCHOR: does this decision take effect? Only when readDecisionBook anchored its signer to a person: by trusted_keys, or by
 * the registry under a root key. An unanchored decision (signed, not identified) and an entry whose anchoring is unknown
 * (not read through readDecisionBook) have no effect on any rung, proposal or evidence set. They stay on the book, listed.
 */
export function isAnchored(e: { via?: Authorization['via'] }): boolean {
  return e.via !== undefined && e.via !== 'unanchored'
}

/** How a reader selects the grant in force (D-DUAL). */
export interface GrantReadOptions {
  /**
   * Promotion policies the reader knows. When one is a grant's own policy (by hash), its tier's grant_signatures applies to a
   * GRANT of autonomy even if the grant under-states `signatures`. The bodies of POLICY_REVISIONs on the book are known too.
   */
  policies?: readonly PromotionPolicy[]
  /**
   * D-GOVERNING-POLICY: the deployment's declared policy. It governs every GRANT the reader reads, whatever policy the grant
   * names (a named policy is informational): the grant's tier must be declared in it, its rung within the tier's max_rung,
   * and a GRANT of autonomy needs the tier's grant_signatures. A grant that falls short has no effect (governingProblem says
   * why). Without it, the count the grant states (and its own policy, when the reader holds the body) governs.
   */
  governing_policy?: PromotionPolicy
}

/**
 * The GRANT in force for a workflow: the latest one on the book that is ANCHORED (D-ANCHOR) and fully signed (D-DUAL), or
 * undefined (nothing granted: the rung is record). An unanchored or pending GRANT is skipped, so the rung falls back to the
 * last grant in force before it. With `governing_policy`, a grant the governing policy does not admit is skipped too.
 */
export function grantInForce(decisions: readonly DecisionEntry[], workflow_id: string, opts: GrantReadOptions = {}): DecisionEntry<GrantDecision> | undefined {
  return latestInForce(decisions, workflow_id, Number.POSITIVE_INFINITY, opts.policies, true, opts.governing_policy)
}

/**
 * D-GOVERNING-POLICY: why the governing policy gives an anchored GRANT no effect, or undefined (it admits it). `book` is the
 * rest of the book (for co-signatures not stamped on the entry). The grant must be at a tier the policy declares, at a rung
 * within that tier's max_rung, and a GRANT of autonomy needs the tier's grant_signatures (or the count it states, if more):
 * the grant's signer plus counted co-signers (GRANT_COSIGN: anchored, another person, another key), those before `before`
 * when given (a read at a chain position).
 */
export function governingProblem(g: DecisionEntry<GrantDecision>, book: readonly DecisionEntry<BookDecision>[], governing: PromotionPolicy, before = Number.POSITIVE_INFINITY): string | undefined {
  const gd = g.signed.decision
  const under = `the governing policy ${governing.policy_id}@${governing.version}`
  const tier = Array.isArray(governing.tiers) ? governing.tiers.find(t => t?.tier === gd.consequence_tier) : undefined
  if (!tier) return `tier '${gd.consequence_tier}' is not declared in ${under}`
  const cap = tier.max_rung ?? 'autonomy'
  if (DECISION_LEVELS.indexOf(gd.level) > DECISION_LEVELS.indexOf(cap)) return `${under} caps tier '${tier.tier}' at ${cap}`
  if (gd.level !== 'autonomy') return undefined
  const stated = gd.signatures ?? 1
  const n = tier.grant_signatures
  const required = Number.isInteger(n) && (n as number) > stated ? n as number : stated
  if (required <= 1) return undefined
  const have = 1 + cosignsFrom(g, book, true).filter(c => c.seq < before).length
  return have >= required ? undefined : `autonomy at tier '${tier.tier}' needs ${required} signatures under ${under} (dual authorization) and has ${have}`
}

/**
 * The GRANT in force for a workflow at chain position `seq` (the latest anchored, fully signed GRANT before it). With
 * `governing_policy` (P-S4-C), a grant the governing policy does not admit at that position is skipped, as grantInForce does.
 */
export function grantAt(decisions: readonly DecisionEntry[], workflow_id: string, seq: number, opts: GrantReadOptions = {}): DecisionEntry<GrantDecision> | undefined {
  return latestInForce(decisions.filter(e => e.seq < seq), workflow_id, seq, opts.policies, true, opts.governing_policy)
}

/**
 * RULESET_SUCCESSION: why a GRANT that carries a succession has no effect, or undefined (it carries). It must:
 *   - (a reader) have its replay checked against the book and matching (readDecisionBook stamps `replay`);
 *   - name the grant in force on `from` at its own position (read the same way: anchored, fully signed, and admitted by the
 *     governing policy when one is given), so a superseded grant, or one a step down has replaced, is never carried;
 *   - carry it at a rung no higher, at the same consequence tier, and, carrying autonomy, with no fewer signatures (D-DUAL
 *     carries over; a lower rung needs one person, as any step down does).
 * The governing policy then judges the succession itself like any GRANT (governingProblem).
 */
export function successionProblem(g: DecisionEntry<GrantDecision>, book: readonly DecisionEntry<BookDecision>[], opts: GrantReadOptions = {}): string | undefined {
  return carriedProblem(g.signed.decision, g, book, opts.policies, true, opts.governing_policy)
}

function carriedProblem(gd: GrantDecision, e: { seq: number; replay?: DecisionEntry['replay'] }, book: readonly DecisionEntry<BookDecision>[], policies: readonly PromotionPolicy[] | undefined, strict: boolean, gov: PromotionPolicy | undefined): string | undefined {
  const s = gd.succeeds
  if (!s) return undefined
  if (strict && e.replay?.matches !== true) {
    return e.replay ? `its replay does not match the book: ${e.replay.reason}` : 'its replay was not checked against the book (read it through readDecisionBook)'
  }
  const from = latestInForce(book.filter(x => x.seq < e.seq), s.from, e.seq, policies, strict, gov)
  if (!from) return `nothing is granted on ${s.from} at its position: there is no grant to carry`
  if (from.decision_id !== s.grant) {
    return `it carries GRANT \`${s.grant.slice(0, 12)}\`, but the grant in force on ${s.from} at its position is GRANT \`${from.decision_id.slice(0, 12)}\` (seq ${from.seq}): only the grant in force is carried`
  }
  const fd = from.signed.decision
  if (rank(gd.level) > rank(fd.level)) return `it carries ${gd.level}, above the grant in force on ${s.from} (${fd.level}): a succession carries a rung, it never raises one`
  if (gd.consequence_tier !== fd.consequence_tier) return `it is at tier '${gd.consequence_tier}'; the grant it carries is at tier '${fd.consequence_tier}'`
  if (gd.level === 'autonomy' && (gd.signatures ?? 1) < (fd.signatures ?? 1)) return `it states ${gd.signatures ?? 1} signature(s); the grant it carries was made under ${fd.signatures} (dual authorization carries over)`
  return undefined
}

/** The succession a grant carries, in words: what it carries, and what the replay under the new ruleset said. */
export function successionNotice(g: DecisionEntry<GrantDecision>): string | undefined {
  const s = g.signed.decision.succeeds
  if (!s) return undefined
  const r = s.replay
  const dirs = new Map<string, number>()
  for (const c of r.changed) dirs.set(`${c.from}→${c.to}`, (dirs.get(`${c.from}→${c.to}`) ?? 0) + 1)
  const by = [...dirs].sort(([a], [b]) => a.localeCompare(b)).map(([k, n]) => `${k} ${n}`).join(', ')
  const loose = r.changed.filter(loosens).length
  return `GRANT \`${g.decision_id.slice(0, 12)}\` carries ${s.from}'s grant (GRANT \`${s.grant.slice(0, 12)}\`) to ${g.signed.decision.workflow_id} at ${g.signed.decision.level}: `
    + `the ${r.recorded} verdict(s) recorded under ${s.from} were replayed under the new ruleset, ${r.reperformed} re-performed, `
    + `${r.changed.length} changed${by ? ` (${by})` : ''}`
    + (r.reperformed < r.recorded ? `; ${r.recorded - r.reperformed} not re-performed (what the new ruleset says of them is unknown)` : '')
    + (loose ? `; it loosens ${loose}, accepted by ${g.signed.decision.signer_id}: ${s.loosening_reason}` : '')
}

/**
 * The signatures a GRANT needs (D-DUAL): the count it states (absent: one), raised to its tier's grant_signatures when `policy`
 * is the grant's own policy (by hash) and the grant is of autonomy. DECISION D-DUAL-SCOPE (fork: here): a tier's
 * grant_signatures binds a GRANT of AUTONOMY only. A step down, or a grant of advise or gate, keeps a person in the loop on
 * every held item, and a demotion that waited on a second person would leave autonomy in force while it waited.
 */
export function signaturesRequired(g: GrantDecision, policy?: PromotionPolicy): number {
  return requiredUnder(g, policy && hashOf(policy) === g.policy.hash ? policy : undefined)
}

function requiredUnder(g: GrantDecision, body: PromotionPolicy | undefined): number {
  const stated = g.signatures ?? 1
  if (g.level !== 'autonomy' || !body || !Array.isArray(body.tiers)) return stated
  const n = body.tiers.find(t => t?.tier === g.consequence_tier)?.grant_signatures
  return Number.isInteger(n) && (n as number) > stated ? n as number : stated
}

/** A grant's policy body, when the reader knows it: one it passed (by hash), or a POLICY_REVISION's body on the book. */
function policyResolver(entries: readonly DecisionEntry<BookDecision>[], policies: readonly PromotionPolicy[] | undefined): (hash: string) => PromotionPolicy | undefined {
  let byHash: Map<string, PromotionPolicy> | undefined
  return hash => {
    if (!byHash) {
      byHash = new Map()
      for (const e of entries) {
        const d = e.signed.decision
        if (d.kind === 'POLICY_REVISION') byHash.set(d.policy.hash, d.policy_body) // decisionProblem held the body to this hash
      }
      for (const p of policies ?? []) byHash.set(hashOf(p), p)
    }
    return byHash.get(hash)
  }
}

const cosignOf = (c: DecisionEntry<BookDecision>): Cosign => ({ decision_id: c.decision_id, seq: c.seq, signer_id: c.signed.decision.signer_id, fingerprint: keyFingerprint(c.signed.public_key) ?? '' })

/**
 * Why a co-signature does not count toward grant `g`, given the co-signatures already counted, or undefined (it counts).
 * `strict` (a reader): unknown anchoring counts as not anchored (D-ANCHOR-FAILCLOSED). Otherwise (the door's own list) only
 * KNOWN-unanchored is refused.
 */
function cosignProblem(c: { via?: Authorization['via']; signed: { decision: { signer_id: string }; public_key?: string } }, g: DecisionEntry<GrantDecision>, counted: readonly Cosign[], strict: boolean): string | undefined {
  const anchored = (e: { via?: Authorization['via'] }): boolean => (strict ? isAnchored(e) : e.via !== 'unanchored')
  const gd = g.signed.decision
  if (!anchored(g)) return `grant \`${g.decision_id.slice(0, 12)}\` is not anchored: it has no effect, and a co-signature cannot give it one`
  if (!anchored(c)) return `the co-signer is not anchored: ${ANCHOR_HINT}`
  const who = c.signed.decision.signer_id
  if (who === gd.signer_id) return `${who} signed the grant itself: dual authorization needs a second person`
  const prior = counted.find(x => x.signer_id === who)
  if (prior) return `${who} already co-signed it (seq ${prior.seq}): one person counts once`
  if (c.signed.public_key === undefined) return undefined // the door without the signing key: the key checks run on read
  const fp = keyFingerprint(c.signed.public_key)
  if (fp === undefined || fp === keyFingerprint(g.signed.public_key)) return `it is signed with the key that signed the grant: two ids on one key are one signer`
  const sameKey = counted.find(x => x.fingerprint === fp)
  if (sameKey) return `its key already co-signed it (as ${sameKey.signer_id}, seq ${sameKey.seq}): two ids on one key are one signer`
  return undefined
}

/**
 * The co-signatures that count toward `g`: its readDecisionBook stamp, or (an entry not stamped, e.g. the door's own list)
 * re-derived from the GRANT_COSIGN entries in `entries` by the same rules.
 */
function cosignsFrom(g: DecisionEntry<GrantDecision>, entries: readonly DecisionEntry<BookDecision>[], strict: boolean): readonly Cosign[] {
  if (g.cosigned) return g.cosigned
  const gd = g.signed.decision
  const out: Cosign[] = []
  for (const c of entries) {
    const d = c.signed.decision
    if (d.kind !== 'GRANT_COSIGN' || d.grant !== g.decision_id || c.seq <= g.seq || d.workflow_id !== gd.workflow_id || d.level !== gd.level) continue
    if (!cosignProblem(c, g, out, strict)) out.push(cosignOf(c))
  }
  return out
}

/** A grant's signatures (D-DUAL): how many it needs, who has signed it (its signer, then the counted co-signers), in order. */
export interface GrantSignatures {
  required: number
  signers: string[]
  cosigns: Cosign[]
  /** True when every required signature is on the book (before `before`, when given). */
  complete: boolean
}

/**
 * A GRANT's signatures as the book stands (D-DUAL). `book` is the rest of the book (for the policy bodies of revisions, and
 * co-signatures not yet stamped on the entry); `before` counts only co-signatures earlier than that chain position.
 */
export function grantSignatures(g: DecisionEntry<GrantDecision>, book: readonly DecisionEntry<BookDecision>[] = [], opts: GrantReadOptions & { before?: number } = {}): GrantSignatures {
  return signaturesOf(g, book, policyResolver(book, opts.policies), opts.before ?? Number.POSITIVE_INFINITY)
}

function signaturesOf(g: DecisionEntry<GrantDecision>, book: readonly DecisionEntry<BookDecision>[], body: (hash: string) => PromotionPolicy | undefined, before: number): GrantSignatures {
  const gd = g.signed.decision
  const required = gd.level === 'autonomy' ? requiredUnder(gd, body(gd.policy.hash)) : requiredUnder(gd, undefined)
  // A single-signature grant with no stamp needs no scan of the book (the common case).
  const cosigns = (required > 1 || g.cosigned ? cosignsFrom(g, book, true) : []).filter(c => c.seq < before).map(c => ({ ...c }))
  return { required, signers: [gd.signer_id, ...cosigns.map(c => c.signer_id)], cosigns, complete: 1 + cosigns.length >= required }
}

/**
 * The latest GRANT for `workflow_id` in `entries` that is anchored and fully signed before `before`, admitted by `gov` (the
 * governing policy) when given, and, when it carries a succession, carrying it (carriedProblem).
 */
function latestInForce(entries: readonly DecisionEntry<BookDecision>[], workflow_id: string, before: number, policies: readonly PromotionPolicy[] | undefined, strict: boolean, gov?: PromotionPolicy): DecisionEntry<GrantDecision> | undefined {
  const body = policyResolver(entries, gov ? [...(policies ?? []), gov] : policies)
  let g: DecisionEntry<GrantDecision> | undefined
  for (const e of entries) {
    const d = e.signed.decision
    if (d.kind !== 'GRANT' || d.workflow_id !== workflow_id) continue
    if (strict ? !isAnchored(e) : e.via === 'unanchored') continue
    const ge = e as DecisionEntry<GrantDecision>
    const required = d.signatures === undefined && d.level !== 'autonomy' ? 1 : requiredUnder(d, body(d.policy.hash))
    if (required > 1 && 1 + cosignsFrom(ge, entries, strict).filter(c => c.seq < before).length < required) continue
    if (gov && governingProblem(ge, entries, gov, before) !== undefined) continue
    if (d.succeeds && carriedProblem(d, ge, entries, policies, strict, gov) !== undefined) continue
    g = ge
  }
  return g
}

/** Every anchored DECLINE on the book for a workflow, in chain order. An unanchored decline holds back no proposal (D-ANCHOR). */
export function declinesFor(decisions: readonly DecisionEntry[], workflow_id: string): DecisionEntry<DeclineDecision>[] {
  return decisions.filter(e => e.signed.decision.kind === 'DECLINE' && e.signed.decision.workflow_id === workflow_id && isAnchored(e)) as DecisionEntry<DeclineDecision>[]
}

/** Every anchored POLICY_REVISION on the book for a policy_id, in chain order (D-ANCHOR). */
export function revisionsOf(decisions: readonly DecisionEntry[], policy_id: string): DecisionEntry<PolicyRevisionDecision>[] {
  return decisions.filter(e => e.signed.decision.kind === 'POLICY_REVISION' && e.signed.decision.policy.policy_id === policy_id && isAnchored(e)) as DecisionEntry<PolicyRevisionDecision>[]
}

/**
 * Every anchored CANARY_SEAL on the book for a workflow, in chain order. D-ANCHOR covers canaries too: a revealed canary is set
 * aside from the evidence, so an unanchored reveal of overturned verdicts would silence a demotion (the mirror attack, by
 * another door). DECISION D-ANCHOR-CANARY; fork: here and canaryRevealsFor.
 */
export function canarySealsFor(canaries: readonly DecisionEntry<BookDecision>[], workflow_id: string): DecisionEntry<CanarySealDecision>[] {
  return canaries.filter(e => e.signed.decision.kind === 'CANARY_SEAL' && e.signed.decision.workflow_id === workflow_id && isAnchored(e)) as DecisionEntry<CanarySealDecision>[]
}

/** Every anchored CANARY_REVEAL on the book for a workflow, in chain order (see canarySealsFor). */
export function canaryRevealsFor(canaries: readonly DecisionEntry<BookDecision>[], workflow_id: string): DecisionEntry<CanaryRevealDecision>[] {
  return canaries.filter(e => e.signed.decision.kind === 'CANARY_REVEAL' && e.signed.decision.workflow_id === workflow_id && isAnchored(e)) as DecisionEntry<CanaryRevealDecision>[]
}

/** How a reader fixes an unanchored decision. */
export const ANCHOR_HINT = 'anchor the signer with --trusted-keys / --root-keys'

/** A decision on the book that has no effect: unanchored (D-ANCHOR), a PENDING grant or a co-signature that does not count (D-DUAL). */
export interface NoEffect {
  decision_id: string
  seq: number
  kind: DecisionKind | CanaryDecisionKind | CosignDecisionKind
  signer_id: string
  signed_at: string
  /** The workflow it names (GRANT, GRANT_COSIGN, DECLINE, CANARY_*); absent on a POLICY_REVISION. */
  workflow_id?: string
  /** D-DUAL: present on an anchored GRANT still waiting for signatures: how many it needs, and who has signed it. */
  pending?: { required: number; signed_by: string[] }
  /** The loud, specific sentence a reader shows. */
  notice: string
}

/** The notice for an unanchored decision, in words: who, when, that it has no effect, and how to anchor the signer. */
export function noEffectNotice(e: DecisionEntry<BookDecision>): string {
  const d = e.signed.decision
  const what = d.kind === 'GRANT' ? `${d.workflow_id} is not moved to ${d.level}`
    : d.kind === 'DECLINE' ? `it holds back no proposal on ${d.workflow_id}`
    : d.kind === 'POLICY_REVISION' ? `${d.policy.policy_id}@${d.policy.version} is not read as a version of the policy`
    : d.kind === 'CANARY_SEAL' || d.kind === 'CANARY_REVEAL' ? `no item of ${d.workflow_id} is set aside as a canary`
    : d.kind === 'GRANT_COSIGN' ? `it adds no signature to grant \`${d.grant.slice(0, 12)}\` on ${d.workflow_id}`
    : 'it anchors nothing'
  return `${at(e)} is not anchored: it has no effect (${what}); ${ANCHOR_HINT}`
}

const at = (e: DecisionEntry<BookDecision>): string => `${e.signed.decision.kind} \`${e.decision_id.slice(0, 12)}\` by ${e.signed.decision.signer_id} at ${e.signed.decision.signed_at} (seq ${e.seq})`

/** The notice for a pending GRANT (D-DUAL): what it needs, who has signed it, and what brings it into force. */
function pendingNotice(g: DecisionEntry<GrantDecision>, s: GrantSignatures, supersededBy: DecisionEntry<BookDecision> | undefined): string {
  const gd = g.signed.decision
  const missing = s.required - s.signers.length
  const head = `${at(g)} is pending: ${gd.level} at tier '${gd.consequence_tier}' needs ${s.required} signatures (dual authorization) and has ${s.signers.length} (${s.signers.join(', ')}); it has no effect (${gd.workflow_id} is not moved to ${gd.level})`
  return supersededBy
    ? `${head}, and GRANT \`${supersededBy.decision_id.slice(0, 12)}\` (seq ${supersededBy.seq}) has since superseded it, so it never takes effect`
    : `${head} until ${missing === 1 ? 'another person co-signs' : `${missing} more people co-sign`} it (GRANT_COSIGN by an anchored grant signer, on another key)`
}

/** The notice for a succession that carries nothing (RULESET_SUCCESSION): what it would carry, and why it does not. */
function successionNoEffectNotice(g: DecisionEntry<GrantDecision>, why: string): string {
  const gd = g.signed.decision
  return `${at(g)} carries ${gd.succeeds!.from}'s grant to ${gd.workflow_id} and has no effect (${gd.workflow_id} is not moved to ${gd.level}): ${why}`
}

/**
 * The rung, canary and co-signature decisions on a verified book that have NO effect, each with its notice, in chain order:
 *   - an unanchored one (D-ANCHOR);
 *   - an anchored succession that carries nothing (RULESET_SUCCESSION: successionProblem);
 *   - an anchored GRANT still PENDING signatures (D-DUAL), judged under the policies the reader passes (and the revisions on
 *     the book), so a grant that under-states its tier is pending here exactly when grantInForce skips it;
 *   - an anchored co-signature that does not count (the grant's own signer or key, a repeat), with why.
 * With `workflow_id`, those naming that workflow; with `policy_id`, also the revisions of that policy. Neither: all of them.
 */
export function noEffect(
  book: Pick<DecisionBook, 'decisions' | 'canaries'> & { cosigns?: readonly DecisionEntry<GrantCosignDecision>[] },
  filter: { workflow_id?: string; policy_id?: string } & GrantReadOptions = {},
): NoEffect[] {
  const all = [...book.decisions, ...book.canaries, ...(book.cosigns ?? [])].sort((a, b) => a.seq - b.seq) as DecisionEntry<BookDecision>[]
  const body = policyResolver(all, filter.policies)
  const out: NoEffect[] = []
  for (const e of all) {
    const d = e.signed.decision
    if (d.kind === 'KEY_REGISTER' || d.kind === 'KEY_REVOKE') continue
    const wf = d.kind === 'POLICY_REVISION' ? undefined : d.workflow_id
    const scoped = filter.workflow_id !== undefined || filter.policy_id !== undefined
    const keep = !scoped
      || (wf !== undefined && wf === filter.workflow_id)
      || (d.kind === 'POLICY_REVISION' && d.policy.policy_id === filter.policy_id)
    if (!keep) continue
    const base = { decision_id: e.decision_id, seq: e.seq, kind: d.kind, signer_id: d.signer_id, signed_at: d.signed_at, ...(wf !== undefined ? { workflow_id: wf } : {}) }
    if (!isAnchored(e)) { out.push({ ...base, notice: noEffectNotice(e) }); continue }
    if (d.kind === 'GRANT') {
      const g = e as DecisionEntry<GrantDecision>
      const carried = carriedProblem(d, g, all, filter.policies, true, undefined)
      if (carried) { out.push({ ...base, notice: successionNoEffectNotice(g, carried) }); continue }
      const s = signaturesOf(g, all, body, Number.POSITIVE_INFINITY)
      if (s.complete) continue
      const later = all.find(x => x.seq > g.seq && x.signed.decision.kind === 'GRANT' && x.signed.decision.workflow_id === d.workflow_id && isAnchored(x))
      out.push({ ...base, pending: { required: s.required, signed_by: s.signers }, notice: pendingNotice(g, s, later) })
      continue
    }
    if (d.kind === 'GRANT_COSIGN') {
      const g = all.find(x => x.decision_id === d.grant && x.signed.decision.kind === 'GRANT') as DecisionEntry<GrantDecision> | undefined
      if (!g) continue
      const counted = cosignsFrom(g, all, true)
      if (counted.some(c => c.decision_id === e.decision_id)) continue
      const why = cosignProblem(e, g, counted.filter(c => c.seq < e.seq), true) ?? 'it does not count toward the grant'
      out.push({ ...base, notice: `${at(e)} has no effect: ${why}` })
    }
  }
  return out
}

// ── the governing policy, as every reader says it (D-GOVERNING-POLICY; moved here from http/dual.ts so the report says it) ──

type GovernedBook = Pick<DecisionBook, 'decisions' | 'canaries' | 'cosigns'>

/** The read options for a deployment's policy: it is known (by hash) and it governs every grant. */
export const governingRead = (policy: PromotionPolicy | undefined): GrantReadOptions => (policy ? { policies: [policy], governing_policy: policy } : {})

/** A GRANT's signatures under the governing policy: the library's count, raised to the declared tier's when that is higher. */
export function governedSignatures(g: DecisionEntry<GrantDecision>, book: Pick<DecisionBook, 'decisions' | 'cosigns'>, policy: PromotionPolicy | undefined): GrantSignatures {
  const s = grantSignatures(g, [...book.decisions, ...book.cosigns], governingRead(policy))
  if (!policy || g.signed.decision.level !== 'autonomy') return s
  const n = policy.tiers.find(t => t.tier === g.signed.decision.consequence_tier)?.grant_signatures
  const required = Math.max(s.required, Number.isInteger(n) ? n as number : 1)
  return { ...s, required, complete: s.signers.length >= required }
}

/**
 * Every anchored GRANT the governing policy does not admit, with why (governingProblem; and, for a succession, what it carries
 * read under the governing policy too). Keyed by decision_id, in chain order. Empty without a policy.
 */
export function inadmissibleGrants(book: Pick<DecisionBook, 'decisions' | 'cosigns'>, policy: PromotionPolicy | undefined): Map<string, { g: DecisionEntry<GrantDecision>; why: string }> {
  const out = new Map<string, { g: DecisionEntry<GrantDecision>; why: string }>()
  if (!policy) return out
  const all = [...book.decisions, ...book.cosigns] as DecisionEntry<BookDecision>[]
  for (const e of book.decisions) {
    const d = e.signed.decision
    if (d.kind !== 'GRANT' || !isAnchored(e)) continue
    const g = e as DecisionEntry<GrantDecision>
    const why = governingProblem(g, all, policy) ?? (d.succeeds ? carriedProblem(d, g, all, [policy], true, policy) : undefined)
    if (why) out.set(g.decision_id, { g, why })
  }
  return out
}

/**
 * What has no effect on a book read under the deployment's governing policy, in chain order: noEffect's list (under the policy),
 * plus every anchored GRANT the governing policy does not admit, as PENDING (with `pending`) when a co-signature can bring it
 * into force, else "has no effect under the governing policy: <why>". Either way it says so when the grant names another
 * policy ("it names policy X@v; it is judged under the governing policy Y@v"). Without a policy it is noEffect's list.
 * DECISION D-GOV-NOTPENDING (surfaces-4; fork: here): only a signature shortfall on autonomy is pending.
 */
export function governedNoEffect(book: GovernedBook, policy: PromotionPolicy | undefined, filter: { workflow_id?: string; policy_id?: string } = {}): NoEffect[] {
  const said = noEffect(book, { ...filter, ...(policy ? { policies: [policy] } : {}) })
  if (!policy) return said
  const listed = new Set(said.map(n => n.decision_id))
  const extra = [...inadmissibleGrants(book, policy).values()]
    .filter(({ g }) => !listed.has(g.decision_id) && (filter.workflow_id === undefined ? filter.policy_id === undefined : g.signed.decision.workflow_id === filter.workflow_id))
    .map(({ g, why }) => governedNotice(g, book, policy, why))
  return extra.length ? [...said, ...extra].sort((a, b) => a.seq - b.seq) : said
}

/** For the grant in force for a workflow under the governing policy: that it names another policy, if it does. */
export function governedNotices(decisions: readonly DecisionEntry[], workflow_id: string, policy: PromotionPolicy | undefined): string[] {
  const g = policy ? grantInForce(decisions, workflow_id, governingRead(policy)) : undefined
  const n = g && namesAnother(g, policy!)
  return n ? [`GRANT \`${g.decision_id.slice(0, 12)}\` by ${g.signed.decision.signer_id} at ${g.signed.decision.signed_at} (seq ${g.seq}) is in force: ${n}`] : []
}

const namesAnother = (g: DecisionEntry<GrantDecision>, policy: PromotionPolicy): string | undefined => {
  const p = g.signed.decision.policy
  return p.policy_id === policy.policy_id && p.version === policy.version ? undefined
    : `it names policy ${p.policy_id}@${p.version}; it is judged under the governing policy ${policy.policy_id}@${policy.version}`
}

/** The notice for a grant the governing policy does not admit: pending (a co-signature can bring it into force), or no effect. */
function governedNotice(g: DecisionEntry<GrantDecision>, book: GovernedBook, policy: PromotionPolicy, why: string): NoEffect {
  const gd = g.signed.decision
  const base = { decision_id: g.decision_id, seq: g.seq, kind: 'GRANT' as const, signer_id: gd.signer_id, signed_at: gd.signed_at, workflow_id: gd.workflow_id }
  const named = namesAnother(g, policy)
  const tail = named ? `: ${named}` : ''
  const moved = `${gd.workflow_id} is not moved to ${gd.level}`
  const who = `GRANT \`${g.decision_id.slice(0, 12)}\` by ${gd.signer_id} at ${gd.signed_at} (seq ${g.seq})`
  const s = governedSignatures(g, book, policy)
  if (gd.level !== 'autonomy' || s.complete) return { ...base, notice: `${who} has no effect under the governing policy (${moved}): ${why}${tail}` }
  const missing = s.required - s.signers.length
  const later = book.decisions.find(x => x.seq > g.seq && x.signed.decision.kind === 'GRANT' && x.signed.decision.workflow_id === gd.workflow_id && isAnchored(x))
  const head = `${who} is pending: autonomy at tier '${gd.consequence_tier}' needs ${s.required} signatures (dual authorization) and has ${s.signers.length} (${s.signers.join(', ')}); it has no effect (${moved})`
  const until = later
    ? `, and GRANT \`${later.decision_id.slice(0, 12)}\` (seq ${later.seq}) has since superseded it, so it never takes effect`
    : ` until ${missing === 1 ? 'another person co-signs' : `${missing} more people co-sign`} it (GRANT_COSIGN by an anchored grant signer, on another key)`
  return { ...base, pending: { required: s.required, signed_by: s.signers }, notice: `${head}${until}${tail}` }
}

/**
 * A canary event against the book so far: a commitment is sealed once; a reveal opens a seal of the same workflow, once, by
 * the person who sealed it, reproduces its commitment exactly, and names only verdicts already recorded.
 */
function canaryConflict(d: CanaryDecision, book: readonly DecisionEntry<BookDecision>[], recorded: ReadonlySet<string> | undefined): string | undefined {
  if (d.kind === 'CANARY_SEAL') {
    const dup = book.find(e => e.signed.decision.kind === 'CANARY_SEAL' && (e.signed.decision as CanarySealDecision).commitment === d.commitment)
    return dup ? `this commitment is already sealed (seq ${dup.seq})` : undefined
  }
  const seal = book.find(e => e.decision_id === d.seal && e.signed.decision.kind === 'CANARY_SEAL') as DecisionEntry<CanarySealDecision> | undefined
  if (!seal) return `no CANARY_SEAL ${d.seal} is on the book to reveal`
  const sd = seal.signed.decision
  if (sd.workflow_id !== d.workflow_id) return `seal ${d.seal} is for ${sd.workflow_id}, not ${d.workflow_id}`
  const again = book.find(e => e.signed.decision.kind === 'CANARY_REVEAL' && (e.signed.decision as CanaryRevealDecision).seal === d.seal)
  if (again) return `seal ${d.seal} was already revealed (seq ${again.seq})`
  if (sd.signer_id !== d.signer_id) return `seal ${d.seal} was made by '${sd.signer_id}'; only its sealer reveals it`
  if (canaryCommitment(d.workflow_id, d.verdict_ids, d.salt) !== sd.commitment) return `the revealed set and salt do not reproduce seal ${d.seal}'s commitment (the canaries were changed after sealing)`
  if (recorded) {
    const missing = d.verdict_ids.filter(id => !recorded.has(id))
    if (missing.length) return `a canary must be recorded on the book before it is revealed; not recorded: ${missing.join(', ')}`
  }
  return undefined
}

/**
 * Door checks that need the rest of the book. The first reason a (well-formed, verified) decision contradicts the book, or
 * undefined:
 *   GRANT            its policy version, when the book records that version, must be the same body (hash). One that carries
 *                    a succession (RULESET_SUCCESSION) must name the grant in force on the old workflow, at no higher a rung,
 *                    the same tier, no fewer signatures.
 *   DECLINE          it answers a proposal made under the grant in force: under_grant names that grant (none → none), and
 *                    its from / tier / policy are that grant's (nothing granted → from is record).
 *   POLICY_REVISION  a version names one body: it is not already on the book; the version it supersedes, when the book
 *                    records it, has the hash it claims.
 *   CANARY_SEAL      a commitment is sealed once.
 *   CANARY_REVEAL    it opens a seal of the same workflow, once, by its sealer, and reproduces the commitment. (The door also
 *                    checks the canaries are recorded: pass `recorded`.)
 * KEY_REGISTER / KEY_REVOKE need the registry (a root key): the door checks them with KeyRegistry.keyEventProblem.
 *
 *   GRANT_COSIGN     (D-DUAL) it names a GRANT on the book of the same workflow and level, not known to be unanchored and not
 *                    superseded by a later grant; and it would count: another person than the grant's signer and every
 *                    counted co-signer, on another key (the key checks need `signing_key`; without it they run on read).
 *
 * The door checks the book AS WRITTEN, not only its anchored part (D-ANCHOR): a version label names one body whoever wrote
 * it, so every POLICY_REVISION on the book counts. The grant a DECLINE must name is the latest grant not KNOWN to be
 * unanchored and not pending (D-DUAL: under the count it states, and its tier's when a revision on the book holds its
 * policy): on the door's own list (no `via`) that is the latest such grant; on readDecisionBook's entries it is the grant in
 * force, the one every reader's proposal is made under.
 */
export function decisionConflict(d: BookDecision, book: readonly DecisionEntry<BookDecision>[], recorded?: ReadonlySet<string>, signing_key?: string): string | undefined {
  const rungBook = book.filter(e => isDecisionKind(e.signed.decision.kind)) as DecisionEntry[]
  const revisionsOf = (rb: readonly DecisionEntry[], policy_id: string): DecisionEntry<PolicyRevisionDecision>[] =>
    rb.filter(e => e.signed.decision.kind === 'POLICY_REVISION' && e.signed.decision.policy.policy_id === policy_id) as DecisionEntry<PolicyRevisionDecision>[]
  const grantInForce = (workflow_id: string): DecisionEntry<GrantDecision> | undefined =>
    latestInForce(book, workflow_id, Number.POSITIVE_INFINITY, undefined, false)
  if (d.kind === 'GRANT_COSIGN') {
    const g = rungBook.find(e => e.decision_id === d.grant && e.signed.decision.kind === 'GRANT') as DecisionEntry<GrantDecision> | undefined
    if (!g) return `a GRANT_COSIGN names grant ${d.grant}, which is not on the book: co-sign a GRANT already recorded`
    const gd = g.signed.decision
    if (gd.workflow_id !== d.workflow_id || gd.level !== d.level) return `grant ${d.grant} sets ${gd.workflow_id} at ${gd.level}; this co-signature says ${d.workflow_id} at ${d.level}: a co-signer signs what the grant says`
    const later = rungBook.find(e => e.seq > g.seq && e.signed.decision.kind === 'GRANT' && e.signed.decision.workflow_id === gd.workflow_id && e.via !== 'unanchored')
    if (later) return `grant ${d.grant} was superseded by GRANT ${later.decision_id} (seq ${later.seq}): only the latest grant for a workflow can be co-signed`
    const why = cosignProblem({ signed: { decision: d, ...(signing_key !== undefined ? { public_key: signing_key } : {}) } }, g, cosignsFrom(g, book, false), false)
    return why ? `this co-signature would not count: ${why}` : undefined
  }
  if (d.kind === 'GRANT') {
    const known = revisionsOf(rungBook, d.policy.policy_id).find(e => e.signed.decision.policy.version === d.policy.version)
    if (known && known.signed.decision.policy.hash !== d.policy.hash) {
      return `the book records ${d.policy.policy_id}@${d.policy.version} as ${known.signed.decision.policy.hash.slice(0, 12)}… (seq ${known.seq}); this grant names another body under the same version`
    }
    // RULESET_SUCCESSION: the grant it carries is the one in force on `from` now (the door's own reading, as for a DECLINE), at
    // no higher a rung, the same tier, no fewer signatures. The replay is held to the chain on read (readDecisionBook).
    if (d.succeeds) {
      const why = carriedProblem(d, { seq: Number.POSITIVE_INFINITY }, book, undefined, false, undefined)
      if (why) return `this succession would carry nothing: ${why}`
    }
    return undefined
  }
  if (d.kind === 'DECLINE') {
    const g = grantInForce(d.workflow_id)
    if ((d.under_grant ?? null) !== (g?.decision_id ?? null)) {
      return g
        ? `a decline answers a proposal made under the grant in force for ${d.workflow_id} (${g.decision_id}, seq ${g.seq}); this one names ${d.under_grant ?? 'no grant'}`
        : `nothing is granted for ${d.workflow_id} on this book, but the decline names grant ${d.under_grant}`
    }
    if (g) {
      const gd = g.signed.decision
      if (d.from !== gd.level) return `the grant in force is ${gd.level}; a proposal under it runs from ${gd.level}, not ${d.from}`
      if (d.consequence_tier !== gd.consequence_tier) return `the grant in force is at tier '${gd.consequence_tier}', not '${d.consequence_tier}'`
      if (d.policy.hash !== gd.policy.hash) return `the grant in force is under policy ${gd.policy.policy_id}@${gd.policy.version}; the declined proposal names another`
    } else if (d.from !== 'record') {
      return `nothing is granted for ${d.workflow_id}: the rung is record, so a proposal runs from record, not ${d.from}`
    }
    return undefined
  }
  if (d.kind === 'CANARY_SEAL' || d.kind === 'CANARY_REVEAL') return canaryConflict(d, book, recorded)
  if (d.kind === 'KEY_REGISTER' || d.kind === 'KEY_REVOKE') return undefined
  const revs = revisionsOf(rungBook, d.policy.policy_id)
  const same = revs.find(e => e.signed.decision.policy.version === d.policy.version)
  if (same) return `${d.policy.policy_id}@${d.policy.version} is already on the book (seq ${same.seq}); a version names one body, so revise to a new version`
  const prior = revs.find(e => e.signed.decision.policy.version === d.supersedes.version)
  if (prior && prior.signed.decision.policy.hash !== d.supersedes.hash) {
    return `the book records ${d.supersedes.policy_id}@${d.supersedes.version} as ${prior.signed.decision.policy.hash.slice(0, 12)}… (seq ${prior.seq}), not the hash this revision supersedes`
  }
  return undefined
}
