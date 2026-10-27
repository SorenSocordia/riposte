/**
 * The key registry on the book of record — who may sign what, read from the book itself (2026-09-28).
 *
 * Before this, `trusted_keys` (signer_id → public key) was passed in from outside on every open. Here the anchor is ONE
 * registry ROOT KEY supplied out of band (`root_keys`), and everything else is on the chain as signed events:
 *
 *   KEY_REGISTER  a key joins the registry: whose it is (subject_id), the SPKI public key, and the ROLES it may sign in.
 *                 Signed by the root key, or by a registered key holding the `key_admin` role.
 *   KEY_REVOKE    a key leaves it, prospectively: decisions it signed BEFORE the revocation stay valid (they were valid
 *                 when made); anything after is refused. Signed by the root, a `key_admin`, or the key itself (self-revocation
 *                 of a compromised key). A revoked key is never re-registered; rotation is register-new, then revoke-old.
 *
 * Roles (segregation of duties, COSO GenAI p.13: "Separate the ability to configure AI settings from the authority to
 * approve or review outputs"):
 *   key_admin      manages the registry (KEY_REGISTER / KEY_REVOKE).
 *   policy_author  writes the promotion policy (POLICY_REVISION) and runs the reviewer-attention test (CANARY_SEAL/REVEAL).
 *   reviewer       signs REVIEWs (UPHELD / OVERTURNED): the evidence a rung rests on.
 *   witness        signs CHECKPOINTS of the chain head (../anchor/checkpoint.ts), which live outside the book. Signs no
 *                  decision on it (ROLE_FOR names no witness kind), and a key that also holds 'key_admin' is not a witness.
 *   grant_signer   signs GRANTs and DECLINEs: moves (or keeps) a rung; and co-signs a GRANT (GRANT_COSIGN) where a tier
 *                  requires dual authorization (decisions.ts, D-DUAL).
 * One person may hold several roles on one key; the policy decides where that is not enough (voice.ts: `segregation`).
 *
 * When the registry is IN FORCE — a root key supplied, and at least one KEY_REGISTER earlier on the chain — every signed
 * decision and signed review at a later position must be signed by a key registered to its signer_id, not revoked at that
 * position, holding the role its kind requires. Decisions before the first KEY_REGISTER are the legacy prefix: read under
 * `trusted_keys` if given, else listed as unanchored (the past is immutable). Without a root key the registry is inert:
 * KEY events verify as signatures but anchor nothing.
 *
 * HONEST BOUNDARY: the root key is the one thing that must come from outside the book (an anchor on the book would anchor
 * nothing). Binding the root key to the person who holds it (the deployment owner) is a human act, done once, out of band.
 */

import { createHash, createPublicKey } from 'node:crypto'
import { sha256 } from '../verdict/canonical.js'

export type Role = 'key_admin' | 'policy_author' | 'reviewer' | 'grant_signer' | 'witness'
export const ROLES: readonly Role[] = ['key_admin', 'policy_author', 'reviewer', 'grant_signer', 'witness']
export const isRole = (r: unknown): r is Role => ROLES.includes(r as Role)

/** Every signed kind on the book: the decision events plus the signed REVIEW body. */
export type SignedKind = 'GRANT' | 'GRANT_COSIGN' | 'DECLINE' | 'POLICY_REVISION' | 'KEY_REGISTER' | 'KEY_REVOKE' | 'CANARY_SEAL' | 'CANARY_REVEAL' | 'REVIEW'

/** The role a signer must hold for each kind, once the registry is in force. */
export const ROLE_FOR: Readonly<Record<SignedKind, Role>> = {
  GRANT: 'grant_signer',
  GRANT_COSIGN: 'grant_signer',
  DECLINE: 'grant_signer',
  POLICY_REVISION: 'policy_author',
  CANARY_SEAL: 'policy_author',
  CANARY_REVEAL: 'policy_author',
  REVIEW: 'reviewer',
  KEY_REGISTER: 'key_admin',
  KEY_REVOKE: 'key_admin',
}

/** SPKI PEM public key(s) of the registry root. Supplied out of band; never read from the book. */
export type RootKeys = readonly string[]

/**
 * A key's fingerprint: sha256 over the bytes of its DER-encoded SubjectPublicKeyInfo, as 64 lowercase hex, or undefined when
 * `pem` is not an Ed25519 public key. Stable across PEM formatting. The one derivation (2026-10-05): replay's
 * "signing key fingerprint", `--trusted-key`, the key registry and the receipts ledger (`riposte-ledger fingerprint`) all print
 * and pin this value, in full. It equals `openssl pkey -pubin -outform DER | sha256sum`.
 */
export function keyFingerprint(pem: string): string | undefined {
  const der = ed25519Der(pem)
  return der === undefined ? undefined : createHash('sha256').update(der).digest('hex')
}

/**
 * The older fingerprint form: sha256 over the BASE64 TEXT of the key's DER (what replay printed and pinned until 2026-10-05).
 * Still accepted by `verify replay --trusted-key` for this release, with a note naming it the older fingerprint form, and still
 * read where a stored record names a key by it (an arbitration move's "by"); nothing prints it any more.
 */
export function legacyKeyFingerprint(pem: string): string | undefined {
  const der = ed25519Der(pem)
  return der === undefined ? undefined : sha256(der.toString('base64'))
}

/** The DER SubjectPublicKeyInfo bytes of an Ed25519 public key, or undefined. */
function ed25519Der(pem: string): Buffer | undefined {
  try {
    const k = createPublicKey(pem)
    if (k.asymmetricKeyType !== 'ed25519') return undefined
    return k.export({ type: 'spki', format: 'der' })
  } catch {
    return undefined
  }
}

export interface KeyEntry {
  fingerprint: string
  subject_id: string
  public_key: string
  roles: Role[]
  /** The tenants this key may act for. Absent: deployment-wide. A tenant-scoped key never signs a deployment-wide act. */
  tenants?: string[]
  registered: { seq: number; decision_id: string; by: string }
  revoked?: { seq: number; decision_id: string; by: string; reason: string }
}

/** The fields of a KEY_REGISTER / KEY_REVOKE the registry reads (decisions.ts owns the full shapes). */
export interface KeyEventLike {
  kind: 'KEY_REGISTER' | 'KEY_REVOKE'
  signer_id: string
  subject_id: string
  public_key: string
  roles?: Role[]
  tenants?: string[]
  reason?: string
}

/**
 * The tenant a workflow belongs to under the default key (`<tenant>/<ruleset>@<version>`), or
 * undefined when the id has no tenant prefix. Only tenant-SCOPED keys are constrained by it; deployment-wide keys are not.
 */
export function tenantOfWorkflow(workflow_id: string): string | undefined {
  const i = workflow_id.indexOf('/')
  return i > 0 ? workflow_id.slice(0, i) : undefined
}

export interface Authorization {
  ok: boolean
  /** How the signer was anchored: the root key, the registry, the static trusted_keys map, or not at all. */
  via: 'root' | 'registry' | 'trusted_keys' | 'unanchored'
  reason?: string
}

/**
 * The registry as a state machine over chain positions. Pure: replay the KEY events in chain order (apply), and ask what
 * held at any position (holds / inForceAt). Deterministic.
 */
export class KeyRegistry {
  private readonly roots = new Set<string>()
  private readonly keys = new Map<string, KeyEntry>()
  /** Chain position of the first KEY_REGISTER applied. The registry governs every signed item AFTER it. */
  started?: number

  constructor(root_keys?: RootKeys) {
    for (const pem of root_keys ?? []) {
      const fp = keyFingerprint(pem)
      if (!fp) throw new Error('a root key must be an Ed25519 public key (SPKI PEM)')
      this.roots.add(fp)
    }
  }

  /** True when a root key was supplied (the registry can be in force). */
  get rooted(): boolean { return this.roots.size > 0 }

  isRoot(pem: string): boolean {
    const fp = keyFingerprint(pem)
    return fp !== undefined && this.roots.has(fp)
  }

  /** In force for an item at `seq`: rooted, and a KEY_REGISTER sits at an earlier position. */
  inForceAt(seq: number): boolean {
    return this.rooted && this.started !== undefined && this.started < seq
  }

  entry(pem: string): KeyEntry | undefined {
    const fp = keyFingerprint(pem)
    return fp === undefined ? undefined : this.keys.get(fp)
  }

  /**
   * Was `pem` an active key of `subject_id`, holding `role`, at chain position `seq`, for this act? `tenant` is the tenant the
   * act concerns (a workflow's or a record's); undefined means a deployment-wide act (a policy revision, a key event).
   */
  holds(seq: number, subject_id: string, pem: string, role: Role, tenant?: string): { ok: boolean; reason?: string } {
    const e = this.entry(pem)
    if (!e || e.registered.seq >= seq) return { ok: false, reason: `the signing key is not registered on the book (as of position ${seq}): only a registered key can sign once the registry is in force` }
    if (e.revoked && e.revoked.seq < seq) return { ok: false, reason: `the signing key of '${e.subject_id}' was revoked at position ${e.revoked.seq} (${e.revoked.reason}); it signs nothing after that` }
    if (e.subject_id !== subject_id) return { ok: false, reason: `the signing key is registered to '${e.subject_id}', not '${subject_id}'` }
    if (!e.roles.includes(role)) return { ok: false, reason: `'${subject_id}' holds ${e.roles.join(', ')}; this needs the '${role}' role (segregation of duties)` }
    if (e.tenants) {
      if (tenant === undefined) return { ok: false, reason: `'${subject_id}''s key is scoped to tenant(s) ${e.tenants.join(', ')}: it cannot sign a deployment-wide act` }
      if (!e.tenants.includes(tenant)) return { ok: false, reason: `'${subject_id}''s key is scoped to tenant(s) ${e.tenants.join(', ')}, not ${tenant}: one tenant's key never decides for another's workflow (F-B)` }
    }
    return { ok: true }
  }

  /**
   * Why a KEY event at `seq`, signed by `pem`, may not be applied (undefined: it may). Authority: the root key, a registered
   * `key_admin`, or (KEY_REVOKE only) the key itself. Consistency: a key is registered once, to one subject, and a revoked key
   * stays revoked.
   */
  keyEventProblem(seq: number, d: KeyEventLike, pem: string): string | undefined {
    if (!this.rooted) return 'the key registry is anchored to a root key: open the ledger with root_keys'
    const fp = keyFingerprint(d.public_key)
    if (!fp) return 'public_key must be an Ed25519 public key (SPKI PEM)'
    const selfRevoke = d.kind === 'KEY_REVOKE' && keyFingerprint(pem) === fp && d.signer_id === d.subject_id
    const root = this.isRoot(pem)
    const admin = !root && !selfRevoke && this.inForceAt(seq) ? this.entry(pem) : undefined
    const authorized = root || selfRevoke || (admin !== undefined && this.holds(seq, d.signer_id, pem, 'key_admin', admin.tenants?.[0]).ok)
    if (!authorized) return `a ${d.kind} must be signed by the registry root key or a registered 'key_admin'${d.kind === 'KEY_REVOKE' ? ' (or by the key itself)' : ''}`
    const e = this.keys.get(fp)
    // A tenant-scoped key_admin manages only keys scoped within its own tenants (the per-tenant part of the registry).
    const within = (t: readonly string[] | undefined): boolean => !admin?.tenants || (!!t && t.length > 0 && t.every(x => admin.tenants!.includes(x)))
    if (d.kind === 'KEY_REGISTER') {
      if (e?.revoked) return `this key was revoked at position ${e.revoked.seq}: a revoked key is never re-registered (rotate: register a new key)`
      if (e) return `this key is already registered to '${e.subject_id}' (position ${e.registered.seq})`
      if (!within(d.tenants)) return `'${d.signer_id}' keeps tenant(s) ${admin!.tenants!.join(', ')} only: it registers keys scoped within them`
      return undefined
    }
    if (!e) return 'KEY_REVOKE names a key that is not registered'
    if (e.subject_id !== d.subject_id) return `the key is registered to '${e.subject_id}', not '${d.subject_id}'`
    if (e.revoked) return `the key was already revoked at position ${e.revoked.seq}`
    if (!within(e.tenants)) return `'${d.signer_id}' keeps tenant(s) ${admin!.tenants!.join(', ')} only: this key reaches beyond them`
    return undefined
  }

  /** Apply a KEY event that passed keyEventProblem. */
  apply(seq: number, decision_id: string, d: KeyEventLike): void {
    const fp = keyFingerprint(d.public_key)!
    if (d.kind === 'KEY_REGISTER') {
      this.keys.set(fp, {
        fingerprint: fp, subject_id: d.subject_id, public_key: d.public_key, roles: [...(d.roles ?? [])].sort(),
        ...(d.tenants ? { tenants: [...d.tenants].sort() } : {}),
        registered: { seq, decision_id, by: d.signer_id },
      })
      if (this.started === undefined) this.started = seq
      return
    }
    const e = this.keys.get(fp)!
    e.revoked = { seq, decision_id, by: d.signer_id, reason: d.reason ?? '' }
  }

  /** Every key ever registered, in registration order (cloned). */
  snapshot(): KeyEntry[] {
    return [...this.keys.values()].sort((a, b) => a.registered.seq - b.registered.seq).map(e => structuredClone(e))
  }
}
