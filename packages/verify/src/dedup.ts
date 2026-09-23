/**
 * Duplicate detection — exact and NEAR.
 *
 * `prior_invoice_ids` is the caller's history of already-processed invoice numbers. ERPs already refuse an EXACT repeat
 * of an invoice number; the money leaks through the gap they don't cover — the same invoice re-entered as `28417-A`,
 * `028417`, `28417 ` or under a second vendor record. Richmond's city auditor found ~$5.8M in duplicate payments incl.
 * a $5M wire paid twice, attributed to "minor differences in invoice numbers" and "multiple vendor records".
 *
 *   DUP_PROHIB  exact membership (raw id ∈ prior)                         → FAIL (locked): a certain duplicate.
 *   DUP_NEAR    normalized collision that is NOT exact                    → FAIL: surfaced for a human before payment.
 *                 'formatting'  same number, different punctuation/leading zeros/case → near-certain duplicate.
 *                 'revision'    same base with a revision suffix (-A, -R1, -REVISED)  → possibly a legitimate re-issue; review.
 *
 * Never auto-blocks: DUP_NEAR is a FAIL because money should not move until it is cleared, but the explanation says
 * whether it looks like a reformat (almost surely a dup) or a re-issue (a human should decide). Deterministic; no fuzzy scores.
 */

import type { BoundValue } from './kernel/types.js'
import { evidenceFromBinding } from './verdict/from-report.js'
import type { ClaimVerdict, Evidence } from './verdict/schema.js'

// A revision suffix is a LETTER or a word (REV, COPY, …) — NEVER a bare number. A numeric suffix is a sequence/part
// number: INV-01 and INV-02 are DIFFERENT invoices, not revisions of one (red-team break, 2026-09-22).
const REVISION_TOKEN = /^(?:REV(?:ISED)?\d*|CORRECTED|AMENDED|COPY|DUPLICATE|DUP|REISSUED?|FINAL|[A-Z])$/

/**
 * Canonical SEGMENTS: uppercase, split on any run of non-alphanumerics, leading zeros stripped per numeric segment.
 * Grouping is PRESERVED — "12-345" → [12, 345] and "123-45" → [123, 45] are different (red-team break); "INV-028417"
 * and "INV 28417" → [INV, 28417] are the same (leading-zero/formatting variant).
 */
function segments(raw: string): string[] {
  return raw.toUpperCase().split(/[^A-Z0-9]+/).filter(s => s.length > 0)
    .map(s => (/^\d+$/.test(s) ? s.replace(/^0+(?=\d)/, '') : s))
}

/** Formatting-insensitive key: same segment sequence → same key. */
export function tightId(raw: string): string {
  return segments(raw).join('|')
}

/** The base key with a trailing revision token (a letter or REV/COPY/…, never a bare number) removed — only when a multi-segment core remains. */
export function baseId(raw: string): string {
  const segs = segments(raw)
  if (segs.length >= 2 && REVISION_TOKEN.test(segs[segs.length - 1] as string)) return segs.slice(0, -1).join('|')
  return segs.join('|')
}

export type NearKind = 'formatting' | 'revision'

export interface DuplicateFinding {
  exact: string[]
  near: { id: string; kind: NearKind }[]
}

/** Classify the current id against the prior history: exact repeats and near-collisions (near excludes exact). */
export function classifyDuplicates(currentRaw: string, priors: string[]): DuplicateFinding {
  const exact: string[] = []
  const near: { id: string; kind: NearKind }[] = []
  const curTight = tightId(currentRaw)
  const curBase = baseId(currentRaw)
  for (const p of priors) {
    if (typeof p !== 'string' || p.length === 0) continue
    if (p === currentRaw) { exact.push(p); continue }
    if (tightId(p) === curTight) { near.push({ id: p, kind: 'formatting' }); continue }
    if (baseId(p) === curBase) near.push({ id: p, kind: 'revision' })
  }
  // formatting collisions first (stronger signal)
  near.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'formatting' ? -1 : 1))
  return { exact, near }
}

function priorsOf(b: BoundValue | undefined): string[] {
  if (!b) return []
  const v = b.value
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

/** Build the exact-duplicate and near-duplicate claims for an invoice. Returns [] neither when the inputs don't permit a check. */
export function duplicateClaims(docId: BoundValue | undefined, priorBinding: BoundValue | undefined): ClaimVerdict[] {
  const base = {
    kind: 'CONSISTENCY' as const,
    tier: 'DETERMINISTIC' as const,
    field: 'invoice_number',
  }
  const idEvidence: Evidence[] = docId ? [evidenceFromBinding('DOCUMENT_ID', docId)] : []
  const priorEvidence: Evidence[] = priorBinding ? [evidenceFromBinding('PRIOR_CLAIM_IDS', priorBinding)] : []

  // No id, or no prior history supplied → cannot check.
  if (!docId || typeof docId.value !== 'string') {
    return [{
      ...base, claim_id: 'document.DUP_PROHIB', outcome: 'INSUFFICIENT_DATA', asserted: null,
      rule_id: 'DUP_PROHIB', rule_name: 'Law of Duplicate Prohibition', evidence: [],
      insufficiency: { reason: 'FIELD_MISSING', detail: 'no invoice number on the extraction; cannot check for duplicates', missing: ['DOCUMENT_ID'] },
      locked: false, explanation: 'No invoice number to compare against prior invoices.',
    }]
  }
  const currentRaw = String(docId.originalValue ?? docId.value)
  // The field being ABSENT ("I didn't check") is INSUFFICIENT; an EMPTY array ("here is my history: none") is a valid PASS.
  if (!priorBinding || !Array.isArray(priorBinding.value)) {
    return [{
      ...base, claim_id: 'document.DUP_PROHIB', outcome: 'INSUFFICIENT_DATA', asserted: docId.value,
      rule_id: 'DUP_PROHIB', rule_name: 'Law of Duplicate Prohibition', evidence: [],
      insufficiency: { reason: 'FIELD_MISSING', detail: 'no prior_invoice_ids supplied; supply the prior invoice-number history to check for duplicates', missing: ['PRIOR_CLAIM_IDS'] },
      locked: false, explanation: 'No prior invoice history supplied.',
    }]
  }

  const priors = priorsOf(priorBinding)
  const { exact, near } = classifyDuplicates(currentRaw, priors)
  const claims: ClaimVerdict[] = []

  claims.push(exact.length > 0
    ? {
        ...base, claim_id: 'document.DUP_PROHIB', outcome: 'FAIL', asserted: docId.value,
        rule_id: 'DUP_PROHIB', rule_name: 'Law of Duplicate Prohibition',
        computation: { formula: 'invoice_number ∉ prior_invoice_ids', operands: { DOCUMENT_ID: docId.value, matched: exact }, result: false },
        evidence: [...idEvidence, ...priorEvidence], locked: true,
        explanation: `This invoice number was already processed (exact match: ${exact.join(', ')}). Paying it again is a duplicate.`,
      }
    : {
        ...base, claim_id: 'document.DUP_PROHIB', outcome: 'PASS', asserted: docId.value,
        rule_id: 'DUP_PROHIB', rule_name: 'Law of Duplicate Prohibition',
        computation: { formula: 'invoice_number ∉ prior_invoice_ids', operands: { DOCUMENT_ID: docId.value }, result: true },
        evidence: [...idEvidence, ...priorEvidence], locked: false,
        explanation: 'No prior invoice carries this exact number.',
      })

  claims.push(near.length > 0
    ? {
        ...base, claim_id: 'document.DUP_NEAR', outcome: 'FAIL', asserted: docId.value,
        rule_id: 'DUP_NEAR', rule_name: 'Law of Near-Duplicate Prohibition',
        computation: { formula: 'normalize(invoice_number) ∉ normalize(prior_invoice_ids)', operands: { DOCUMENT_ID: docId.value, matched: near.map(n => `${n.id} (${n.kind})`) }, result: false },
        evidence: [...idEvidence, ...priorEvidence], locked: false,
        explanation: near[0]!.kind === 'formatting'
          ? `A prior invoice number normalizes to the same value (${near.map(n => n.id).join(', ')}) — same number, different formatting. Almost certainly a duplicate; do not pay until cleared.`
          : `A prior invoice number shares this base with a revision suffix (${near.map(n => n.id).join(', ')}). This may be a legitimate re-issue with a corrected amount — a human should confirm before payment.`,
      }
    : {
        ...base, claim_id: 'document.DUP_NEAR', outcome: 'PASS', asserted: docId.value,
        rule_id: 'DUP_NEAR', rule_name: 'Law of Near-Duplicate Prohibition',
        computation: { formula: 'normalize(invoice_number) ∉ normalize(prior_invoice_ids)', operands: { DOCUMENT_ID: docId.value }, result: true },
        evidence: [...idEvidence, ...priorEvidence], locked: false,
        explanation: 'No prior invoice number normalizes to this one (no formatting or revision-suffix collision).',
      })

  return claims
}
