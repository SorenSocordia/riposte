/**
 * Authority rulings: a named role's call-scoped decision on ONE verdict (2026-10-02; verify docs/REMEDIES.md).
 *
 * A non-PASS verdict carries typed remedies. An `authority` remedy names a role (the buyer, the AP controller, the certifier)
 * and the rule ids it may rule on: that is the role's MANDATE for that verdict. A ruling is the person's answer, and it is:
 *   - bound to one verdict id and the exact rule ids it covers, never a session, a vendor or a rule in general;
 *   - Ed25519-signed over a domain-separated body (`riposte:authority-ruling:v1\n` + canonical JSON), so its signature is
 *     never valid as a verdict, a receipt, a ledger entry or a dispute ruling (verify's `riposte:ruling:v0`), or the reverse;
 *   - honoured only when its key is PINNED for its role (`Authorities`), only within that role's mandate in that verdict,
 *     and only once (a consumed ruling is spent: replaying the same invoice does not pay it twice);
 *   - never a waiver of later checks. It changes no verdict: the FAIL stays a FAIL on the record, and the ruling is the
 *     person's decision to act (allow) or to hold (deny) on that one verdict anyway.
 *
 * The principle is borrowed from APPA's call-scoped authority (Kravchenko et al., arXiv 2607.24625, Section 5): an exception
 * is authorized against the exact rendered call, under a pre-declared mandate, without lingering privilege. An agent cannot
 * forge one: it holds no pinned key, and nothing in Riposte's MCP tools writes a ruling.
 *
 * HONEST BOUNDARY: the signature proves the holder of a pinned key ruled. Binding that key to a person (and that person to the
 * role) is the deployment's: pin keys only for the people who hold the role.
 */
import { createHash, createPrivateKey, createPublicKey, sign as edSign, verify as edVerify } from 'node:crypto'
import { canonicalize, type Verdict } from 'riposte-verify'
import { keyFingerprint } from './ledger.js'

export const RULING_VERSION = 'riposte-authority-ruling/1'
export const RULING_SIGNING_PREFIX = 'riposte:authority-ruling:v1\n'

export type RulingDecision = 'allow' | 'deny'

export interface AuthorityRuling {
  ruling_version: typeof RULING_VERSION
  /** The one verdict it rules on. */
  verdict_id: string
  /** The rule ids it covers in that verdict (sorted, unique), each within the role's mandate there. */
  rules: string[]
  /** The role ruling (it must match an `authority` remedy of the verdict for every rule covered). */
  by: string
  decision: RulingDecision
  note: string
  /** When the person ruled (their claim, ISO-8601). */
  issued_at: string
}

export interface SignedRuling {
  ruling: AuthorityRuling
  /** First 32 hex of sha256 over canonicalize(ruling). */
  ruling_id: string
  alg: 'ed25519'
  /** SPKI PEM of the signer's public key. It counts only if pinned for the ruling's role. */
  public_key: string
  /** base64 Ed25519 over RULING_SIGNING_PREFIX + canonicalize(ruling). */
  signature: string
}

/** An unsigned ruling, as `riposte-ledger rule` records it without --key. ap_gate refuses it. */
export interface UnsignedRuling { ruling: AuthorityRuling; ruling_id: string }

/** role → the public key(s) pinned for it (PEM). A ruling by a role counts only when one of them signed it. */
export type Authorities = Readonly<Record<string, string | readonly string[]>>

const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x)
const sha = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex')
export const rulingIdOf = (r: AuthorityRuling): string => sha(canonicalize(r)).slice(0, 32)
const message = (r: AuthorityRuling): Buffer => Buffer.from(RULING_SIGNING_PREFIX + canonicalize(r), 'utf8')

/** Why `r` is not a well-formed ruling, or undefined. */
export function rulingShapeProblem(r: unknown): string | undefined {
  if (!isObj(r)) return 'not a ruling'
  const keys = ['ruling_version', 'verdict_id', 'rules', 'by', 'decision', 'note', 'issued_at']
  const extra = Object.keys(r).filter((k) => !keys.includes(k))
  if (extra.length) return `a ruling carries unknown field(s) ${extra.sort().join(', ')}`
  if (r.ruling_version !== RULING_VERSION) return `ruling_version must be ${RULING_VERSION}`
  if (typeof r.verdict_id !== 'string' || !/^[0-9a-f]{32}$/.test(r.verdict_id)) return 'verdict_id must be a 32-hex verdict id'
  if (!Array.isArray(r.rules) || !r.rules.length || r.rules.some((x) => typeof x !== 'string' || !x)) return 'rules must list the rule ids it covers'
  if (r.rules.join('\u0000') !== [...new Set(r.rules as string[])].sort().join('\u0000')) return 'rules must be sorted and unique'
  if (typeof r.by !== 'string' || !r.by.trim()) return 'by must name the role ruling'
  if (r.decision !== 'allow' && r.decision !== 'deny') return 'decision must be allow or deny'
  if (typeof r.note !== 'string' || !r.note.trim()) return 'note must say why (a ruling is a person\'s reason on the record)'
  if (typeof r.issued_at !== 'string' || Number.isNaN(Date.parse(r.issued_at))) return 'issued_at must be an ISO-8601 time'
  return undefined
}

export function makeRuling(i: { verdict_id: string; rules: readonly string[]; by: string; decision: RulingDecision; note: string; now?: () => Date }): AuthorityRuling {
  const r: AuthorityRuling = {
    ruling_version: RULING_VERSION, verdict_id: i.verdict_id, rules: [...new Set(i.rules)].sort(), by: i.by, decision: i.decision,
    note: i.note, issued_at: (i.now ?? (() => new Date()))().toISOString(),
  }
  const p = rulingShapeProblem(r)
  if (p) throw new Error(p)
  return r
}

export function signRuling(r: AuthorityRuling, privateKeyPem: string): SignedRuling {
  const p = rulingShapeProblem(r)
  if (p) throw new Error(p)
  const key = createPrivateKey(privateKeyPem)
  if (key.asymmetricKeyType !== 'ed25519') throw new Error(`a ruling is signed with an Ed25519 key, not ${key.asymmetricKeyType}`)
  return {
    ruling: r, ruling_id: rulingIdOf(r), alg: 'ed25519',
    public_key: createPublicKey(key).export({ type: 'spki', format: 'pem' }).toString(),
    signature: edSign(null, message(r), key).toString('base64'),
  }
}

/** The rule ids a role may rule on in a verdict: the non-PASS rules its authority remedies clear. */
export function mandateOf(verdict: Pick<Verdict, 'remedies' | 'claims'>, role: string): string[] {
  const open = new Set(verdict.claims.filter((c) => c.outcome !== 'PASS').map((c) => c.rule_id))
  const out = new Set<string>()
  for (const r of verdict.remedies ?? []) if (r.kind === 'authority' && r.authority === role) for (const id of r.clears) if (open.has(id)) out.add(id)
  return [...out].sort()
}

/** The rule ids of every claim that is not PASS: what an `allow` must cover, all of it, to clear the verdict. */
export function openRules(verdict: Pick<Verdict, 'claims'>): string[] {
  return [...new Set(verdict.claims.filter((c) => c.outcome !== 'PASS').map((c) => c.rule_id))].sort()
}

/**
 * Authorities from a JSON file: { "<role>": "<public key PEM, or a path to one>" | [ … ] }. A path is read relative to the
 * file's own folder (`readRelative`). Throws on anything that is not a public key, so a typo never silently pins nothing.
 */
export function authoritiesFromJson(json: unknown, readRelative: (path: string) => string): Authorities {
  if (!isObj(json)) throw new Error('authorities: a JSON object { "<role>": "<public key PEM or path>" | [ … ] }')
  const out: Record<string, string[]> = {}
  for (const [role, v] of Object.entries(json)) {
    const list = typeof v === 'string' ? [v] : Array.isArray(v) && v.every((x) => typeof x === 'string') ? v as string[] : undefined
    if (!list || !list.length) throw new Error(`authorities.${role}: a public key PEM or a path, or a list of them`)
    out[role] = list.map((x) => {
      const pem = x.includes('-----BEGIN') ? x : readRelative(x)
      if (!spki(pem)) throw new Error(`authorities.${role}: ${x.includes('-----BEGIN') ? 'not a public key' : `${x} is not a public key`}`)
      return pem
    })
  }
  return out
}

const spki = (pem: string): string | undefined => { try { return createPublicKey(pem).export({ type: 'spki', format: 'der' }).toString('base64') } catch { return undefined } }
/** A key's fingerprint as the ledger and replay print it (ledger.ts keyFingerprint: sha256 over the DER bytes, 64 hex), or undefined. */
export const keyFingerprintOf = (pem: string): string | undefined => { try { return keyFingerprint(pem) } catch { return undefined } }

/** Why a ruling was refused, as a stable code (2026-10-03; the hosted rulings route answers with it). */
export type RulingRefusal =
  | 'ruling.invalid' | 'ruling.altered' | 'ruling.unsigned' | 'ruling.bad_signature' | 'ruling.key_not_pinned'
  | 'ruling.other_verdict' | 'ruling.outside_mandate' | 'ruling.consumed'

export interface RulingCheck {
  ok: boolean
  reason?: string
  /** present when refused */
  code?: RulingRefusal
  ruling_id?: string
  decision?: RulingDecision
  rules?: string[]
  by?: string
}

/**
 * Is `x` a ruling this verdict may act on? Every condition, in order: well-formed; the id derives; SIGNED (an unsigned
 * ruling is refused); the signature verifies; the key is pinned for the role; it names THIS verdict; every rule it covers is
 * within the role's mandate here; it was not consumed before. Never throws.
 */
export function checkRuling(x: unknown, verdict: Pick<Verdict, 'verdict_id' | 'remedies' | 'claims'>, opts: { authorities?: Authorities; consumed?: ReadonlySet<string> } = {}): RulingCheck {
  const no = (code: RulingRefusal, reason: string, extra: Partial<RulingCheck> = {}): RulingCheck => ({ ok: false, reason, code, ...extra })
  if (!isObj(x) || !isObj(x.ruling)) return no('ruling.invalid', 'not a ruling')
  const shape = rulingShapeProblem(x.ruling)
  if (shape) return no('ruling.invalid', shape)
  const r = x.ruling as unknown as AuthorityRuling
  const id = rulingIdOf(r)
  const base = { ruling_id: id, decision: r.decision, rules: r.rules, by: r.by }
  if (x.ruling_id !== id) return no('ruling.altered', 'ruling_id does not derive from the ruling (altered after it was written)', base)
  if (typeof x.signature !== 'string' || typeof x.public_key !== 'string') return no('ruling.unsigned', 'unsigned: a ruling counts only when signed by a key pinned for its role', base)
  if (x.alg !== 'ed25519') return no('ruling.bad_signature', `unsupported alg: ${String(x.alg)}`, base)
  let sigOk = false
  try { sigOk = edVerify(null, message(r), createPublicKey(x.public_key), Buffer.from(x.signature, 'base64')) } catch { sigOk = false }
  if (!sigOk) return no('ruling.bad_signature', 'the signature does not verify: the ruling was altered, or the key does not match', base)
  const pinned = opts.authorities?.[r.by]
  if (pinned === undefined) return no('ruling.key_not_pinned', `no key is pinned for role '${r.by}': only a pinned authority's ruling counts`, base)
  const mine = spki(x.public_key)
  if (!mine || !(typeof pinned === 'string' ? [pinned] : pinned).map(spki).includes(mine)) return no('ruling.key_not_pinned', `signed by a key that is not pinned for role '${r.by}' (fingerprint ${keyFingerprintOf(x.public_key) ?? '?'})`, base)
  if (r.verdict_id !== verdict.verdict_id) return no('ruling.other_verdict', `the ruling is for verdict ${r.verdict_id}, not ${verdict.verdict_id}: a ruling covers one verdict only`, base)
  const mandate = new Set(mandateOf(verdict, r.by))
  const outside = r.rules.filter((rule) => !mandate.has(rule))
  if (outside.length) return no('ruling.outside_mandate', `role '${r.by}' has no mandate over ${outside.join(', ')} in this verdict (its authority remedies cover: ${[...mandate].join(', ') || 'nothing'})`, base)
  if (opts.consumed?.has(id)) return no('ruling.consumed', 'already consumed: a ruling is spent once, on one action', base)
  return { ok: true, ...base }
}
