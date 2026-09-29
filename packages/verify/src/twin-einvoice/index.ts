/**
 * E-invoice structured-twin mode: check an agent's extracted invoice values against the invoice's own binding XML
 * (Peppol BIS Billing 3.0 UBL Invoice, ZATCA's UBL profile, KSeF FA(3)), where the XML itself is the legal invoice.
 *
 *   verifyEinvoiceTwin(xml, claims, opts)   → a verify Verdict + per-claim judgments (PASS / FAIL / ABSTAIN) + the
 *                                             XML's own footing (BR-CO-10/13/15/16, the line rule) as consistency claims
 *                                             + the two answered apart (`outcomes.extraction`, `outcomes.footing`)
 *   detectProfile(root) / parseXml(xml)     → which declared profile a document is, from its own markers
 *   bindField(map, root, field, scope)      → one field's binding element (concrete XPath, span, parsed value)
 *   EINVOICE_MAPS                           → the declared field → element maps, each entry citing its primary source
 *   measureEinvoiceTwin(documents)          → measured fp / fn / abstain rates on a labelled claim set (house pattern)
 *
 * Not wired into src/index.ts or the CLI by this module (the integrator does that).
 */
export { parseXml, XmlParseError, kids, positionOf } from './xml.js'
export type { XmlElement, XmlSpan } from './xml.js'
export { EINVOICE_MAPS, PEPPOL_BIS3_MAP, ZATCA_MAP, KSEF_FA3_MAP, KSEF_BUCKETS, SOURCES, UBL_NS, KSEF_NS } from './map.js'
export type { EinvoiceMap, EinvoiceFieldMap, EinvoiceProfile, FieldKind, FieldScope, SourceKey } from './map.js'
export { detectProfile, bindField, xpathOf, parseDecimal, parseIsoDate, PEPPOL_BIS3_CUSTOMIZATION, ZATCA_PROFILE_ID } from './bind.js'
export type { EinvoiceBinding, BindResult, BindFailure, ProfileDetection, ScopeRef } from './bind.js'
export { checkEinvoiceConsistency } from './consistency.js'
export type { EinvoiceConsistency, ConsistencyProvenance } from './consistency.js'
export { HOUSE_PEPPOL_RULESET, HOUSE_ZATCA_RULESET, HOUSE_KSEF_RULESET, PEPPOL_TWIN_FOOTING, PEPPOL_LINE_SLACK } from './rulesets.js'
export { verifyEinvoiceTwin, einvoiceVerdictInput, resolveField } from './judge.js'
export type { EinvoiceClaim, EinvoiceTwinOptions, EinvoiceTwinOutcomes, EinvoiceOutcome, EinvoiceReason, EinvoiceAbstainReason, EinvoiceDiagnosis, EinvoiceJudgment, EinvoiceMatchRef, EinvoiceTwinResult } from './judge.js'
export { measureEinvoiceTwin, EINVOICE_TWIN_VERSION } from './measure.js'
export type { EinvoiceLabeledClaim, EinvoiceLabeledDocument, EinvoiceMeasurementRow, EinvoiceTwinMeasurement } from './measure.js'
