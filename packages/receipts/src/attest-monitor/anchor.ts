/**
 * T3, the receipt-anchored host record: each reply's id and recorded model written to a signed receipt ledger when the reply
 * happens (for example from a Stop hook after every turn). Later the monitor reads those anchors with a pinned public key.
 * A reply whose anchor agrees rests on T3. An anchor that disagrees means the host record changed after it was anchored.
 * An anchor written more than the allowed lag after its reply does not count (the record could have changed before it).
 */
import { verifyChain, type Ledger, type LedgerEntry } from '../ledger.js'
import type { HostRecord } from './hosts.js'
import type { AnchorSet, Anchor } from './monitor.js'

export const ANCHOR_VERSION = 'riposte.model-reply-anchor/0.1.0'
const PLACEHOLDER = /^<.*>$/

/** Anchor every reply of a host record that has an id and a model, skipping ids already anchored on this ledger. */
export function anchorReplies(ledger: Ledger, record: HostRecord, run: string): { anchored: number; skipped: number } {
  const seen = new Set<string>()
  ledger.scan((e) => { const b = e.body as Record<string, unknown> | null; if (e.kind === 'model_reply' && b && typeof b.reply_id === 'string') seen.add(b.reply_id) })
  let anchored = 0, skipped = 0
  for (const r of record.replies) {
    if (!r.id || !r.model || PLACEHOLDER.test(r.model) || seen.has(r.id)) { skipped++; continue }
    ledger.append('model_reply', { anchor_version: ANCHOR_VERSION, run, reply_id: r.id, model: r.model, basis: r.basis, ...(r.at ? { reply_at: r.at } : {}), ...(r.request_id ? { request_id: r.request_id } : {}) })
    seen.add(r.id)
    anchored++
  }
  return { anchored, skipped }
}

/** Read anchors from a ledger's entries. The chain must verify with the pinned key and every entry must be signed. */
export function readAnchors(name: string, entries: readonly LedgerEntry[], publicKeyPem: string): AnchorSet {
  const check = verifyChain([...entries], { publicKey: publicKeyPem, requireSigned: true })
  const anchors = new Map<string, Anchor>()
  if (!check.ok) return { ledger: name, ok: false, reason: `the anchor ledger does not verify with the pinned key: ${check.reason}`, anchors }
  for (const e of entries) {
    const b = e.body as Record<string, unknown> | null
    if (e.kind !== 'model_reply' || !b || typeof b.reply_id !== 'string' || typeof b.model !== 'string') continue
    if (!anchors.has(b.reply_id)) anchors.set(b.reply_id, { reply_id: b.reply_id, model: b.model, seq: e.seq, at: e.at })
  }
  return { ledger: name, ok: true, ...(check.signers[0] ? { signer: check.signers[0] } : {}), anchors }
}
