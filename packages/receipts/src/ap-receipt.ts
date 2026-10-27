/**
 * What an ap_gate receipt stores, shared by the MCP tool (./mcp.ts) and the hosted gate (./http.ts). 2026-10-03.
 *
 * HASHES ONLY BY DEFAULT. A receipt holds no document text: the gate's outcome, the verdict id, its input hash and the sha256
 * of the whole verdict, each document's sha256 and length, each claim's rule, outcome and evidence offsets, and the remedies'
 * kinds and roles. The caller keeps the replayable proof ({ verdict, inputs }) from the answer. Storing the documents is an
 * opt-in (a hosted key's `store_documents`, or the MCP call's `store_documents: true`).
 *
 * BINDING. `bindProof` says whether a proof the customer kept belongs to a receipt: the verdict hashes to the receipt's
 * `verdict_sha256`, the verdict id and input hash are the receipt's, and each document's sha256 and length are the
 * receipt's. Only a bound proof is worth replaying against that receipt; a proof that does not bind names the field.
 */
import { createHash } from 'node:crypto'
import { canonicalize, hashOf, isApStructured, type ApDocuments, type PriorInvoice } from 'riposte-verify'
import type { ApGateDocuments } from './ap-gate.js'
import type { ApGateResult } from './ap-gate.js'

/** The parts of structured input a receipt hashes (each as its canonical JSON): what was checked, never the model's decision. */
export const STRUCTURED_PARTS = ['bill', 'purchase_order', 'item_receipts'] as const
import { stamped } from './version.js'

/** The AP policy every ap_gate call runs under (the engine's defaults, stated so the proof binds them). */
export const AP_POLICY = { price_tolerance: 0.02, total_tolerance: 0.005 } as const

export const sha256Hex = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex')
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)

/** At most this many prior invoices in one call's `history`. */
export const HISTORY_MAX = 10_000

/** Check a caller's `history` (invoices already booked): a list of { invoice_number, po_number?, total?, vendor?, paid_on? }. */
export function historyOf(x: unknown): PriorInvoice[] | string {
  if (!Array.isArray(x)) return '"history" must be a list of { invoice_number, po_number?, total?, vendor?, paid_on? }'
  if (x.length > HISTORY_MAX) return `"history" holds ${x.length} invoices; at most ${HISTORY_MAX} per call`
  const out: PriorInvoice[] = []
  for (let i = 0; i < x.length; i++) {
    const h = x[i]
    const at = `history[${i}]`
    if (!isObj(h)) return `${at} is not an object`
    const extra = Object.keys(h).filter((k) => !['invoice_number', 'po_number', 'total', 'vendor', 'paid_on'].includes(k))
    if (extra.length) return `${at} carries unknown field(s) ${extra.sort().join(', ')}`
    if (typeof h.invoice_number !== 'string' || !h.invoice_number.trim() || h.invoice_number.length > 128) return `${at}.invoice_number must be a non-empty string (at most 128 characters)`
    for (const k of ['po_number', 'vendor', 'paid_on'] as const) {
      if (h[k] !== undefined && (typeof h[k] !== 'string' || (h[k] as string).length > 256)) return `${at}.${k} must be a string (at most 256 characters)`
    }
    if (h.total !== undefined && !(typeof h.total === 'number' && Number.isFinite(h.total))) return `${at}.total must be a finite number`
    out.push({
      invoice_number: h.invoice_number,
      ...(h.po_number !== undefined ? { po_number: h.po_number as string } : {}),
      ...(h.total !== undefined ? { total: h.total as number } : {}),
      ...(h.vendor !== undefined ? { vendor: h.vendor as string } : {}),
      ...(h.paid_on !== undefined ? { paid_on: h.paid_on as string } : {}),
    })
  }
  return out
}

/**
 * The receipt body stored by default: no document text. Hashes, lengths, rule ids, outcomes, evidence offsets and remedy
 * kinds, enough to prove later which documents were checked and what was answered, given the documents. A consumed or
 * refused ruling is recorded by id and reason (role names, rule ids and key fingerprints; never document text).
 */
export function hashesOnlyBody(g: ApGateResult, docs: ApGateDocuments, key_id?: string): Record<string, unknown> {
  const v = g.check.verdict
  const doc = (s: string) => ({ sha256: sha256Hex(s), bytes: Buffer.byteLength(s, 'utf8') })
  // Structured input: each part hashed as its canonical JSON; evidence is JSON Pointers (paths, never values).
  const structured = isApStructured(docs)
  const documents = structured
    ? Object.fromEntries(STRUCTURED_PARTS.map((k) => [k, doc(canonicalize(docs[k]))]))
    : { invoice: doc((docs as ApDocuments).invoice), purchase_order: doc((docs as ApDocuments).purchase_order), goods_receipt: doc((docs as ApDocuments).goods_receipt) }
  const history = structured ? docs.payment_history ?? undefined : (docs as ApDocuments).history
  return stamped('ap_gate', {
    stored: 'hashes',
    ...(key_id !== undefined ? { key_id } : {}),
    action: g.action, effect: g.effect, model_decision: g.model_decision, checker_decision: g.checker_decision,
    verdict_id: v.verdict_id, input_hash: v.input_hash, outcome: v.outcome, ruleset: v.ruleset, engine_version: v.engine_version,
    verdict_sha256: hashOf(v),
    documents,
    ...(history ? { history: { count: history.length, sha256: hashOf(history) } } : {}),
    claims: v.claims.map((c) => ({
      claim_id: c.claim_id, rule_id: c.rule_id, outcome: c.outcome,
      ...(c.insufficiency ? { reason: c.insufficiency.reason } : {}),
      spans: c.evidence.flatMap((e) => e.locator.kind === 'span'
        ? [{ source_hash: e.locator.source_hash, start: e.locator.start, end: e.locator.end, ...(e.locator.line !== undefined ? { line: e.locator.line } : {}) }]
        : []),
      ...(structured ? { pointers: c.evidence.flatMap((e) => (e.locator.kind === 'field' ? [e.locator.path] : [])) } : {}),
    })),
    ...(g.remedies ? { remedies: g.remedies.map((r) => ({ kind: r.kind, ...(r.authority ? { authority: r.authority } : {}), ...(r.transform ? { transform: r.transform } : {}), clears: r.clears, claims: r.claims })) } : {}),
    ...(g.ruling ? { ruling: g.ruling } : {}),
    // 2026-10-04: a payment held because the verdict did not read PASS names the status it read
    ...(g.refusal ? { refusal: g.refusal } : {}),
  })
}

/**
 * The ap_gate receipt a proof belongs to: the entry named (`want`: a seq, or 8+ hex of its hash), else, among the receipts
 * carrying the proof's verdict id, the one it binds to, else the latest of them (so the refusal names a real entry). The
 * same invoice gated twice has one verdict id and two receipts; each proof binds to its own (its verdict's issued_at differs).
 */
export function receiptForProof<E extends { seq: number; kind: string; hash: string; body: unknown }>(entries: readonly E[], proof: unknown, want?: string): E | undefined {
  if (want !== undefined) return /^\d+$/.test(want) ? entries[Number(want)] : want.length >= 8 ? entries.find((x) => typeof x?.hash === 'string' && x.hash.startsWith(want)) : undefined
  const vid = isObj(proof) && isObj(proof.verdict) ? proof.verdict.verdict_id : undefined
  let latest: E | undefined
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!
    const b = e?.body // 2026-10-20: a line that is JSON null is passed over, as any line that is not an ap_gate receipt is
    if (e?.kind !== 'ap_gate' || !isObj(b)) continue
    const id = isObj(b.proof) && isObj(b.proof.verdict) ? b.proof.verdict.verdict_id : b.verdict_id
    if (id !== vid) continue
    latest ??= e
    if (bindProof(b, proof).ok) return e
  }
  return latest
}

/** Does `proof` ({ verdict, inputs }) belong to the ap_gate receipt `body`? Never throws. */
export type ProofBinding = { ok: true } | { ok: false; field: string; reason: string }

export function bindProof(body: unknown, proof: unknown): ProofBinding {
  const no = (field: string, reason: string): ProofBinding => ({ ok: false, field, reason })
  if (!isObj(body)) return no('body', 'the entry carries no receipt body')
  if (!isObj(proof) || !isObj(proof.verdict)) return no('proof', 'not a proof: { "verdict": …, "inputs": { "ap": …, "policy": … } }')
  const v = proof.verdict
  // A receipt that stored its documents carries the proof itself: the presented one must be it.
  if (isObj(body.proof) && isObj(body.proof.verdict)) {
    return hashOf(body.proof.verdict) === hashOf(v) ? { ok: true } : no('proof.verdict', 'the proof\'s verdict is not the one this receipt stored')
  }
  if (typeof body.verdict_sha256 !== 'string') return no('verdict_sha256', 'this receipt records no verdict hash (written before 2026-10-02, or not an ap_gate receipt)')
  let vh: string
  try { vh = hashOf(v) } catch { return no('verdict_sha256', 'the proof\'s verdict cannot be hashed') }
  if (vh !== body.verdict_sha256) return no('verdict_sha256', `the proof's verdict hashes to ${vh.slice(0, 16)}…; the receipt records ${body.verdict_sha256.slice(0, 16)}…`)
  if (v.verdict_id !== body.verdict_id) return no('verdict_id', `the proof is verdict ${String(v.verdict_id)}; the receipt is ${String(body.verdict_id)}`)
  if (v.input_hash !== body.input_hash) return no('input_hash', 'the proof\'s input hash is not the receipt\'s')
  const ap = isObj(proof.inputs) && isObj(proof.inputs.ap) ? proof.inputs.ap : undefined
  const docs = isObj(body.documents) ? body.documents : undefined
  const st = isObj(proof.inputs) && isObj(proof.inputs.ap_structured) ? proof.inputs.ap_structured : undefined
  // A structured receipt names a bill (text receipts share the purchase_order name, so it cannot tell them apart).
  if (docs && isObj(docs.bill)) {
    for (const k of STRUCTURED_PARTS) {
      const want = isObj(docs[k]) ? docs[k] as { sha256?: unknown; bytes?: unknown } : undefined
      if (!want) continue
      if (!st || st[k] === undefined) return no(`documents.${k}`, `the proof carries no structured ${k}`)
      let text: string
      try { text = canonicalize(st[k]) } catch { return no(`documents.${k}`, `the proof's ${k} has no canonical JSON form`) }
      if (sha256Hex(text) !== want.sha256) return no(`documents.${k}.sha256`, `the proof's ${k} is not the document this receipt hashed`)
      if (Buffer.byteLength(text, 'utf8') !== want.bytes) return no(`documents.${k}.bytes`, `the proof's ${k} is not the length this receipt recorded`)
    }
    return { ok: true }
  }
  if (docs) {
    for (const k of ['invoice', 'purchase_order', 'goods_receipt'] as const) {
      const want = isObj(docs[k]) ? docs[k] as { sha256?: unknown; bytes?: unknown } : undefined
      const text = ap?.[k]
      if (!want) continue
      if (typeof text !== 'string') return no(`documents.${k}`, `the proof carries no ${k} text`)
      if (sha256Hex(text) !== want.sha256) return no(`documents.${k}.sha256`, `the proof's ${k} is not the document this receipt hashed`)
      if (Buffer.byteLength(text, 'utf8') !== want.bytes) return no(`documents.${k}.bytes`, `the proof's ${k} is not the length this receipt recorded`)
    }
  }
  return { ok: true }
}
