/**
 * Measured (never asserted) accuracy for the e-invoice twin, in the pattern of declarative/measure.ts:
 * run the judge over a labelled set, score with bench/score.ts, and bind the rates to exactly this map version and
 * this set through a canonical sha256 (`measured_on`).
 *
 * Unit of measurement: ONE extracted claim. Labels: CLEAN (the value is what the invoice says: should PASS) and
 * ERROR (a seeded mistake: should FAIL). An abstention is scored as neither, and reported. The XML's own footing is
 * not part of this measurement (consistency is off), because a claim label says nothing about the document.
 */
import { canonicalize, sha256 } from '../verdict/canonical.js'
import type { DeclaredAccuracy } from '../verdict/schema.js'
import { score, type Judgment, type Metrics } from '../bench/score.js'
import type { Label } from '../bench/corpus.js'
import { verifyEinvoiceTwin, type EinvoiceClaim, type EinvoiceDiagnosis, type EinvoiceReason } from './judge.js'

export const EINVOICE_TWIN_VERSION = '0.3.0'

export interface EinvoiceLabeledClaim {
  claim: EinvoiceClaim
  label: Label
  /** for ERROR: the seeded error type (e.g. 'transposed_digits'); for CLEAN: the variant ('exact', 'spaced_id' …) */
  kind: string
}

export interface EinvoiceLabeledDocument {
  /** a stable name for the report */
  name: string
  xml: string
  claims: readonly EinvoiceLabeledClaim[]
}

export interface EinvoiceMeasurementRow {
  document: string
  claim_id: string
  field: string
  label: Label
  kind: string
  judgment: Judgment
  reason: EinvoiceReason
  diagnosis?: EinvoiceDiagnosis
}

export interface EinvoiceTwinMeasurement {
  accuracy: DeclaredAccuracy
  metrics: Metrics
  /** per label × kind: how many PASS / FAIL / abstained */
  by_kind: Record<string, { label: Label; n: number; pass: number; fail: number; abstain: number }>
  rows: EinvoiceMeasurementRow[]
}

const J = { PASS: 'PASS', FAIL: 'FAIL', ABSTAIN: 'INSUFFICIENT_DATA' } as const

/** Deterministic: the same set → the same rates and the same measured_on. No clock enters the rates. */
export function measureEinvoiceTwin(docs: readonly EinvoiceLabeledDocument[]): EinvoiceTwinMeasurement {
  const rows: EinvoiceMeasurementRow[] = []
  for (const d of docs) {
    const r = verifyEinvoiceTwin(d.xml, d.claims.map((c) => c.claim), { consistency: false, now: () => new Date(0) })
    d.claims.forEach((lc, i) => {
      const j = r.judgments[i]!
      rows.push({ document: d.name, claim_id: lc.claim.id, field: lc.claim.field, label: lc.label, kind: lc.kind, judgment: J[j.outcome], reason: j.reason, ...(j.diagnosis ? { diagnosis: j.diagnosis } : {}) })
    })
  }
  const metrics = score(rows)
  const measured_on = sha256(canonicalize({
    twin: `twin-einvoice@${EINVOICE_TWIN_VERSION}`,
    documents: docs.map((d) => ({ name: d.name, xml_sha256: sha256(d.xml), claims: d.claims })),
  }))
  const by_kind: EinvoiceTwinMeasurement['by_kind'] = {}
  for (const r of rows) {
    const k = `${r.label}:${r.kind}`
    const s = (by_kind[k] ??= { label: r.label, n: 0, pass: 0, fail: 0, abstain: 0 })
    s.n++
    if (r.judgment === 'PASS') s.pass++; else if (r.judgment === 'FAIL') s.fail++; else s.abstain++
  }
  const accuracy: DeclaredAccuracy = { domain: 'e-invoice', ruleset_version: EINVOICE_TWIN_VERSION, fp_rate: metrics.fp_rate, fn_rate: metrics.fn_rate, abstain_rate: metrics.abstain_rate, measured_on }
  return { accuracy, metrics, by_kind, rows }
}
