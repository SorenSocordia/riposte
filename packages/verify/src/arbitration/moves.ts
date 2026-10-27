/**
 * The three moves of arbitration (engine 0.3.0, 2026-10-03; docs/EVIDENCE.md): CORRECT, STRIKE, CORROBORATE. Each is a
 * signed document, verified like the governance proposals: an Ed25519 signature over a domain prefix and the canonical JSON of
 * every field except `sig` and `countersign`; the signer named by key fingerprint and looked up in the case's parties file; a
 * nonce never used before in the case; a time window (`at` … `expires_at`).
 *
 *   { "format": "verify-move/1", "case": "case-…", "type": "correct", "by": "<fingerprint>", "at": "…Z", "nonce": "…",
 *     "expires_at": "…Z", "field": { "role": "PAYABLE" },
 *     "evidence": { "file": "rescan.pdf", "sha256": "…" }, "reason": "the original scan, re-scanned at 300 dpi", "sig": "…" }
 *
 * What a move may NEVER carry: a value. Parties file documents; only the engine reads. A move with `value` is refused as an
 * assertion (E4) and recorded by the sha256 of its bytes, never by its content.
 */

import { createPrivateKey, createPublicKey, sign as edSign, verify as edVerify } from 'node:crypto'
import { canonicalize, sha256 } from '../verdict/canonical.js'

export const MOVE_FORMAT = 'verify-move/1'
const DOMAIN = 'verify-move/1 envelope\n'

export type MoveType = 'correct' | 'strike' | 'corroborate'
export const MOVE_TYPES: readonly MoveType[] = ['correct', 'strike', 'corroborate']

/** The field a move is about: its role in the ruleset, and (optionally) the extraction path it was reported at. */
export interface MoveField { role: string; path?: string }
/** The document a move files. `file` names it in the case (or beside the move); `sha256` binds its bytes. */
export interface MoveEvidence { file: string; sha256: string; locator?: string; source_id?: string }
export type StrikeTarget = { document: string } | { field: MoveField }

export interface UnsignedMove {
  format: typeof MOVE_FORMAT
  case: string
  type: MoveType
  by: string
  at: string
  nonce: string
  expires_at: string
  field?: MoveField
  target?: StrikeTarget
  evidence?: MoveEvidence
  reason: string
  /** never lawful: a move carrying a value is refused as an assertion (E4) */
  value?: unknown
}
export interface Move extends UnsignedMove { sig: string; countersign?: { by: string; sig: string } }

const HEX64 = /^[0-9a-f]{64}$/
const NONCE = /^[0-9a-f]{16,64}$/
const B64 = /^[A-Za-z0-9+/]+={0,2}$/
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/
export const isIso = (s: unknown): s is string => typeof s === 'string' && ISO.test(s) && !Number.isNaN(Date.parse(s))
const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x)

/** The content a signature covers: every field except `sig` and `countersign`. */
function content(m: UnsignedMove | Move): Record<string, unknown> {
  const { sig: _s, countersign: _c, ...rest } = m as Move
  return rest as Record<string, unknown>
}

/** What a hand signs: the domain prefix, then the canonical JSON of the move without its signatures. */
export function moveSignedBytes(m: UnsignedMove | Move): Buffer {
  return Buffer.from(DOMAIN + canonicalize(content(m)), 'utf8')
}

/** A move's id: the sha256 of its canonical content (signatures excluded). Unique because every move carries a nonce. */
export function moveId(m: UnsignedMove | Move): string {
  return sha256(canonicalize(content(m)))
}

/** Sign a move with a private key (PEM). */
export function signMove(u: UnsignedMove, privateKeyPem: string): Move {
  const sig = edSign(null, moveSignedBytes(u), createPrivateKey(privateKeyPem)).toString('base64')
  return { ...u, sig }
}

/** A second hand on a move (a counterparty countersigning a filer's CORRECT): the same bytes, another key. */
export function countersignMove(m: Move, by: string, privateKeyPem: string): Move {
  const sig = edSign(null, moveSignedBytes(m), createPrivateKey(privateKeyPem)).toString('base64')
  return { ...m, countersign: { by, sig } }
}

/** Check a signature over a move's bytes against a public key (PEM). */
export function moveSignatureValid(m: Move, sig: string, publicPem: string): boolean {
  if (typeof sig !== 'string' || !B64.test(sig)) return false
  try { return edVerify(null, moveSignedBytes(m), createPublicKey(publicPem), Buffer.from(sig, 'base64')) } catch { return false }
}

export type MoveRefusalCode =
  | 'shape' | 'e4-value' | 'no-evidence' | 'not-a-document' | 'case-mismatch' | 'unknown-signer' | 'held' | 'bad-signature'
  | 'nonce-reused' | 'not-yet-valid' | 'expired' | 'role' | 'countersign' | 'case-closed' | 'evidence-missing'
  | 'evidence-unreadable' | 'unauthenticated-source' | 'not-independent' | 'field-unknown' | 'reopen-tier'

export interface MoveRefusal { code: MoveRefusalCode; detail: string }

/**
 * The first shape problem with a move, as a typed refusal, or undefined. A `value` is named first, whatever else is wrong with
 * the move: a typed number is an assertion, and the record should say exactly that.
 */
export function moveShapeRefusal(x: unknown): MoveRefusal | undefined {
  if (!isObj(x)) return { code: 'shape', detail: 'a move is a JSON object' }
  if (Object.prototype.hasOwnProperty.call(x, 'value')) return { code: 'e4-value', detail: 'the move carries a value: a party files documents, never values (an assertion, E4, may open a move but never closes one); the engine reads the value from the evidence itself' }
  const allowed = ['format', 'case', 'type', 'by', 'at', 'nonce', 'expires_at', 'field', 'target', 'evidence', 'reason', 'sig', 'countersign']
  for (const k of Object.keys(x)) if (!allowed.includes(k)) return { code: 'shape', detail: `unexpected field "${k}"` }
  if (x.format !== MOVE_FORMAT) return { code: 'shape', detail: `format must be "${MOVE_FORMAT}"` }
  if (typeof x.case !== 'string' || !x.case) return { code: 'shape', detail: 'a move names its case' }
  if (!MOVE_TYPES.includes(x.type as MoveType)) return { code: 'shape', detail: `type must be one of ${MOVE_TYPES.join(', ')}` }
  if (typeof x.by !== 'string' || !HEX64.test(x.by)) return { code: 'shape', detail: '"by" must be a key fingerprint (64 hex)' }
  if (!isIso(x.at)) return { code: 'shape', detail: '"at" must be an ISO time (UTC, Z)' }
  if (!isIso(x.expires_at)) return { code: 'shape', detail: '"expires_at" must be an ISO time (UTC, Z)' }
  if (typeof x.nonce !== 'string' || !NONCE.test(x.nonce)) return { code: 'shape', detail: 'a move carries a nonce (16 to 64 hex)' }
  if (typeof x.reason !== 'string' || !x.reason.trim() || x.reason.length > 500) return { code: 'shape', detail: 'a move needs a reason (1 to 500 characters)' }
  if (typeof x.sig !== 'string' || !B64.test(x.sig)) return { code: 'shape', detail: 'a move is signed (sig)' }
  const fieldOk = (f: unknown): boolean => isObj(f) && typeof f.role === 'string' && f.role !== '' && (f.path === undefined || (typeof f.path === 'string' && f.path !== '')) && Object.keys(f).every(k => k === 'role' || k === 'path')
  if (x.field !== undefined && !fieldOk(x.field)) return { code: 'shape', detail: 'field is { role, path? }' }
  if (x.evidence !== undefined) {
    const e = x.evidence
    if (!isObj(e) || typeof e.file !== 'string' || !e.file || typeof e.sha256 !== 'string' || !HEX64.test(e.sha256)) return { code: 'shape', detail: 'evidence is { file, sha256, locator?, source_id? }' }
    for (const k of Object.keys(e)) if (!['file', 'sha256', 'locator', 'source_id'].includes(k)) return { code: 'shape', detail: `unexpected evidence field "${k}"` }
    if (e.locator !== undefined && typeof e.locator !== 'string') return { code: 'shape', detail: 'evidence.locator must be a string' }
    if (e.source_id !== undefined && typeof e.source_id !== 'string') return { code: 'shape', detail: 'evidence.source_id must be a string' }
  }
  if (x.countersign !== undefined) {
    const c = x.countersign
    if (!isObj(c) || typeof c.by !== 'string' || !HEX64.test(c.by) || typeof c.sig !== 'string' || !B64.test(c.sig)) return { code: 'shape', detail: 'countersign is { by: fingerprint, sig }' }
  }
  if (x.type === 'correct' || x.type === 'corroborate') {
    if (x.field === undefined) return { code: 'shape', detail: `a ${String(x.type).toUpperCase()} names the field it is about` }
    if (x.evidence === undefined) return { code: 'no-evidence', detail: `a ${String(x.type).toUpperCase()} carries evidence: a document the engine reads (a PDF, a UBL XML) or a signed source statement` }
    if (x.target !== undefined) return { code: 'shape', detail: 'only a STRIKE names a target' }
  }
  if (x.type === 'strike') {
    const t = x.target
    const ok = isObj(t) && Object.keys(t).length === 1 && ((typeof t.document === 'string' && (t.document === 'filing' || HEX64.test(t.document))) || fieldOk(t.field))
    if (!ok) return { code: 'shape', detail: 'a STRIKE names exactly one target: { document: "filing" | sha256 } or { field: { role, path? } }' }
    if (x.evidence !== undefined || x.field !== undefined) return { code: 'shape', detail: 'a STRIKE names a target only (no field, no evidence)' }
  }
  return undefined
}
