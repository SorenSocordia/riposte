/**
 * Is the binding XML internally consistent? The built-in footing rulesets (rulesets.ts) run over the invoice's OWN
 * elements, and each house check is reported under the spec rule it implements (BR-CO-10/13/15/16, the line rule).
 *
 * This is independent of any agent: an inconsistent invoice is flagged even when every extracted value matches it.
 * One declared call-level choice: UBL footing runs STRICT (no relative band; the BR-CO asserts are exact to the cent).
 * The line rules run at the shipped rulesets' own slack (Peppol R120 0.02 + a float margin; ZATCA 0.005 + margin).
 *
 * What the twin hands the rulesets, beyond the mapped elements (E-INVOICE-2, 2026-09-28):
 *   - UBL line allowances and charges: each line's own cac:AllowanceCharge/cbc:Amount, summed by cbc:ChargeIndicator
 *     ('false' = BT-136, 'true' = BT-141) and rounded to the cent as R120 rounds them, become the built-in
 *     LINE_ALLOWANCE / LINE_CHARGE totals. A ChargeIndicator other than 'true'/'false', or an Amount that is missing,
 *     repeated or unparseable, makes that line's rule abstain (R120 itself would silently skip such an entry).
 *   - KSeF lines: P_9B and P_11A as well as P_10, so the ruleset's own guard (and its sourced reason) decides when a line
 *     is outside the identity.
 *   - KSeF Fa/Rozliczenie: DoZaplaty, SumaObciazen, SumaOdliczen and the Obciazenia / Odliczenia item lists, for a
 *     ruleset that checks DoZaplaty (0.2.0+; an earlier ruleset declares no such fields and ignores them).
 * One override remains, and it only moves a result toward ABSTAIN:
 *   - BR-CO-15 abstains when BT-110 is absent or ambiguous (bound only in the document currency; see bind.ts).
 */
import { verifyDeclarative, type Json } from '../declarative/evaluate.js'
import type { ClaimVerdict, Evidence } from '../verdict/schema.js'
import { bindField, parseDecimal, xpathOf, type BindResult, type EinvoiceBinding } from './bind.js'
import { KSEF_NS, UBL_NS, lineElements, type EinvoiceMap } from './map.js'
import { HOUSE_KSEF_RULESET, footingRulesetFor } from './rulesets.js'
import { kids, type XmlElement } from './xml.js'

export type ConsistencyProvenance = 'SPEC' | 'HOUSE_RECON'

export interface EinvoiceConsistency {
  /** the verdict claim id: xml.document.BR-CO-15, xml.line[1].PEPPOL-EN16931-R120 */
  claim_id: string
  /** the spec rule id (UBL; KSeF FA3-XSD:DoZaplaty) or the built-in code (other KSeF rules, prefixed KSEF-HOUSE:) */
  rule_id: string
  house_code: string
  /** the built-in ruleset the footing came from, id@version (+ the call-level choice, if any) */
  footing: string
  scope: string
  outcome: 'PASS' | 'FAIL' | 'ABSTAIN'
  detail: string
  provenance: ConsistencyProvenance
  /** the binding elements the rule read */
  operands: { term: string; xpath: string; value: number | string | null }[]
  claim: ClaimVerdict
}

const UBL_RULE: Record<string, { id: string; text: string; terms: string[] }> = {
  LINES_SUM_INT: { id: 'BR-CO-10', text: 'Sum of Invoice line net amount (BT-106) = Σ Invoice line net amount (BT-131)', terms: ['BT-106', 'BT-131*'] },
  TAX_EXCL_INT: { id: 'BR-CO-13', text: 'Invoice total amount without VAT (BT-109) = Σ BT-131 − BT-107 + BT-108', terms: ['BT-109', 'BT-106', 'BT-107', 'BT-108'] },
  TAX_INCL_INT: { id: 'BR-CO-15', text: 'Invoice total amount with VAT (BT-112) = BT-109 + BT-110', terms: ['BT-112', 'BT-109', 'BT-110'] },
  PAYABLE_INT: { id: 'BR-CO-16', text: 'Amount due for payment (BT-115) = BT-112 − BT-113 + BT-114', terms: ['BT-115', 'BT-112', 'BT-113', 'BT-114'] },
}
const UBL_LINE_TERMS = ['BT-131', 'BT-129', 'BT-146', 'BT-149']
const KSEF_TEXT: Record<string, string> = {
  GROSS_INT: 'P_15 = Σ P_13_x + Σ P_14_x (house candidate; a declared abstention in the ruleset: no primary source states it)',
  LINE_NET_INT: 'P_11 = P_8B × P_9A (house identity from the MF sheet\'s worked examples; abstains on P_10 / P_9B / P_11A)',
}
/** The P_13_x / P_14_x buckets the built-in KSeF ruleset declares (the FA(3) XSD's set). */
const KSEF_RULESET_BUCKETS = Object.keys(HOUSE_KSEF_RULESET.fields).filter((k) => /^P_1[34]_/.test(k))
const KSEF_LINE_TERMS = ['P_11', 'P_8B', 'P_9A', 'P_10', 'P_9B', 'P_11A']
const KSEF_SPEC_RULE: Record<string, { id: string; text: string }> = {
  DOZAPLATY_INT: { id: 'FA3-XSD:DoZaplaty', text: 'DoZaplaty = P_15 + SumaObciazen − SumaOdliczen (FA(3) XSD Rozliczenie/DoZaplaty; MF information sheet p.105)' },
}

type Bound = Map<string, BindResult>

function bindAll(map: EinvoiceMap, root: XmlElement, scope: 'document' | 'line', index: number, terms: readonly string[]): Bound {
  const out: Bound = new Map()
  for (const t of terms) {
    const fm = map.fields.find((f) => f.term === t && f.scope === scope)
    if (fm) out.set(t, bindField(map, root, fm, { scope, index }))
  }
  return out
}

/** The value to hand the built-in ruleset: the parsed number, the raw text when unparseable (so it abstains), or absent. */
function jsonValue(b: BindResult | undefined): number | string | undefined {
  if (!b) return undefined
  if (b.ok) return b.binding.value as number
  if (b.reason === 'ELEMENT_ABSENT') return undefined
  return `UNBOUND:${b.reason}` // present but unusable → the evaluator reports UNPARSEABLE, never a default
}

function spanEvidence(xmlSha: string, b: EinvoiceBinding): Evidence[] {
  return [
    { locator: { kind: 'span', source_hash: xmlSha, start: b.span.start, end: b.span.end }, value: b.value, original: b.raw, confidence: 100, role: 'OPERAND' },
    { locator: { kind: 'field', source: 'evidence', path: b.xpath }, value: b.term, confidence: 100, role: 'CONTEXT' },
  ]
}

/** R120 rounds each line total as round(x × 100) div 100: to the cent, halves toward +∞ (as Math.round does). */
const cents = (x: number): number => Math.round(x * 100) / 100

/**
 * A UBL line's own allowances (BT-136) and charges (BT-141): the Amount of each direct cac:AllowanceCharge child,
 * by cbc:ChargeIndicator. Sources: Peppol part/line-allowance-charge.xml (cac:AllowanceCharge/cbc:Amount = BT-136,
 * BT-141; ChargeIndicator 'true' for charges, 'false' for allowances, PEPPOL-EN16931-R043); ZATCA Data Dictionary
 * (BT-136 / BT-141 = cac:InvoiceLine/cac:AllowanceCharge/cbc:Amount with ChargeIndicator false / true). A price-level
 * allowance (cac:Price/cac:AllowanceCharge, BT-147) is not a line allowance and is not read here.
 */
function lineAllowancesCharges(map: EinvoiceMap, line: XmlElement): { allowances: EinvoiceBinding[]; charges: EinvoiceBinding[] } | { problem: string } {
  const allowances: EinvoiceBinding[] = [], charges: EinvoiceBinding[] = []
  const source = map.profile === 'zatca-ksa' ? 'ZATCA-DD' as const : 'PEPPOL-SYNTAX' as const
  for (const ac of kids(line, UBL_NS.cac, 'AllowanceCharge')) {
    const ind = kids(ac, UBL_NS.cbc, 'ChargeIndicator')
    const flag = ind.length === 1 ? ind[0]!.text.replace(/\s+/g, ' ').trim() : null
    if (flag !== 'true' && flag !== 'false') return { problem: `${xpathOf(ac)} has cbc:ChargeIndicator ${flag === null ? `×${ind.length}` : JSON.stringify(flag)}; only 'true' (BT-141) or 'false' (BT-136) says which total it belongs to` }
    const amt = kids(ac, UBL_NS.cbc, 'Amount')
    if (amt.length !== 1) return { problem: `${xpathOf(ac)} has ${amt.length} cbc:Amount elements; one is required` }
    const el = amt[0]!
    const value = el.children.length ? null : parseDecimal(el.text)
    if (value === null) return { problem: `${xpathOf(el)} reads ${JSON.stringify(el.text)}, which is not a valid amount` }
    const charge = flag === 'true'
    const b: EinvoiceBinding = {
      field: charge ? 'line_charge_amount' : 'line_allowance_amount', term: charge ? 'BT-141' : 'BT-136',
      name: charge ? 'Invoice line charge amount' : 'Invoice line allowance amount', source, kind: 'amount',
      declared_xpath: `/Invoice/cac:InvoiceLine/cac:AllowanceCharge[cbc:ChargeIndicator='${flag}']/cbc:Amount`,
      xpath: xpathOf(el), raw: el.text, value, span: { ...el.inner }, ...(el.attrs.currencyID !== undefined ? { currency: el.attrs.currencyID.trim() } : {}),
    }
    ;(charge ? charges : allowances).push(b)
  }
  return { allowances, charges }
}

/**
 * KSeF Fa/Rozliczenie as the built-in ruleset reads it: the three amounts (bound, with spans) and the two item lists
 * (their Kwota texts; the ruleset only needs to know a list is there). Source: FA(3) XSD l.3212-3281.
 */
function ksefRozliczenie(root: XmlElement): { json: Json; bindings: EinvoiceBinding[] } | null {
  const fa = kids(root, KSEF_NS, 'Fa')[0]
  const rz = fa ? kids(fa, KSEF_NS, 'Rozliczenie') : []
  if (rz.length !== 1) return null
  const json: Json = {}, bindings: EinvoiceBinding[] = []
  for (const name of ['DoZaplaty', 'SumaObciazen', 'SumaOdliczen']) {
    const els = kids(rz[0]!, KSEF_NS, name)
    if (els.length === 0) continue
    const el = els[0]!
    const value = els.length === 1 && !el.children.length ? parseDecimal(el.text) : null
    if (value === null) { json[name] = `UNBOUND:${els.length > 1 ? 'AMBIGUOUS_ELEMENT' : 'BINDING_UNPARSEABLE'}`; continue }
    json[name] = value
    bindings.push({ field: name, term: name, name, source: 'KSEF-XSD', kind: 'amount', declared_xpath: `/Faktura/Fa/Rozliczenie/${name}`, xpath: xpathOf(el), raw: el.text, value, span: { ...el.inner } })
  }
  for (const list of ['Obciazenia', 'Odliczenia']) {
    const items = kids(rz[0]!, KSEF_NS, list)
    if (items.length) json[list] = items.map((it) => kids(it, KSEF_NS, 'Kwota')[0]?.text.trim() ?? '')
  }
  return { json, bindings }
}

/** Run the built-in footing over the invoice's own elements. Empty when the profile has no footing. */
export function checkEinvoiceConsistency(map: EinvoiceMap, root: XmlElement, xmlSha: string): EinvoiceConsistency[] {
  const ubl = map.profile !== 'ksef-fa3'
  const ruleset = footingRulesetFor(map.profile)
  const footing = `${ruleset.id}@${ruleset.version}${ubl ? ', strict (rel 0)' : ''}`
  const lines = lineElements(map, root)

  // ---- bind every element the footing reads, and build the built-in ruleset's JSON shape
  const docTerms = ubl ? ['BT-106', 'BT-107', 'BT-108', 'BT-109', 'BT-110', 'BT-112', 'BT-113', 'BT-114', 'BT-115'] : ['P_15', ...KSEF_RULESET_BUCKETS]
  const doc = bindAll(map, root, 'document', 0, docTerms)
  const lineBound = lines.map((_, i) => bindAll(map, root, 'line', i, ubl ? UBL_LINE_TERMS : KSEF_LINE_TERMS))
  const lineAC = ubl ? lines.map((l) => lineAllowancesCharges(map, l)) : []
  const rozliczenie = ubl ? null : ksefRozliczenie(root)

  const extraction: Json = {}
  const put = (o: Json, key: string, b: BindResult | undefined): void => { const v = jsonValue(b); if (v !== undefined) o[key] = v }
  if (ubl) {
    put(extraction, 'line_extension_amount', doc.get('BT-106'))
    put(extraction, 'allowance_total_amount', doc.get('BT-107'))
    put(extraction, 'charge_total_amount', doc.get('BT-108'))
    put(extraction, 'tax_exclusive_amount', doc.get('BT-109'))
    put(extraction, 'tax_amount', doc.get('BT-110'))
    put(extraction, 'tax_inclusive_amount', doc.get('BT-112'))
    put(extraction, 'prepaid_amount', doc.get('BT-113'))
    put(extraction, 'payable_rounding_amount', doc.get('BT-114'))
    put(extraction, 'payable_amount', doc.get('BT-115'))
    extraction.lines = lineBound.map((lb, i) => {
      const o: Json = {}
      put(o, 'line_extension_amount', lb.get('BT-131')); put(o, 'invoiced_quantity', lb.get('BT-129'))
      put(o, 'price_amount', lb.get('BT-146')); put(o, 'base_quantity', lb.get('BT-149'))
      const ac = lineAC[i]!
      if ('problem' in ac) return o
      if (ac.allowances.length) o.line_allowance_amount = cents(ac.allowances.reduce((a, b) => a + (b.value as number), 0))
      if (ac.charges.length) o.line_charge_amount = cents(ac.charges.reduce((a, b) => a + (b.value as number), 0))
      return o
    })
  } else {
    for (const t of ['P_15', ...KSEF_RULESET_BUCKETS]) put(extraction, t, doc.get(t))
    if (rozliczenie) extraction.Rozliczenie = rozliczenie.json
    extraction.lines = lineBound.map((lb) => {
      const o: Json = {}
      for (const t of KSEF_LINE_TERMS) put(o, t, lb.get(t))
      return o
    })
  }

  // UBL: STRICT (no relative band). The CEN schematron asserts BR-CO-10/13/15/16 exactly to the cent
  // (round(x * 10 * 10) div 100), and the 0.1.0 UBL rulesets say so themselves (rel 0); the option is kept explicit.
  // KSeF keeps its own ruleset policy (band capped at 0.02).
  const verdict = verifyDeclarative(extraction, ruleset, { now: () => new Date(0), ...(ubl ? { tolerance: { rel: 0, absCap: 0 } } : {}) })
  const out: EinvoiceConsistency[] = []
  for (const hc of verdict.claims) {
    const m = /^(document|line\[(\d+)\])\.(.+)$/.exec(hc.claim_id)
    if (!m) continue
    const scope = m[1]!
    const li = m[2] !== undefined ? Number(m[2]) : -1
    const code = m[3]!
    let rule_id: string, text: string, provenance: ConsistencyProvenance, bound: BindResult[]
    let abstainWhy: string | null = null
    if (ubl) {
      if (code === 'LINE_MATH_INT') {
        rule_id = map.profile === 'peppol-bis3' ? 'PEPPOL-EN16931-R120' : 'BR-KSA-EN16931-11'
        text = 'Invoice line net amount (BT-131) = BT-129 × (BT-146 / BT-149) + Σ BT-141 − Σ BT-136'
        const ac = lineAC[li]!
        if ('problem' in ac) abstainWhy = `a line allowance/charge cannot be read: ${ac.problem}`
        bound = [...lineBound[li]!.values(), ...('problem' in ac ? [] : [...ac.allowances, ...ac.charges].map((binding): BindResult => ({ ok: true, binding })))]
      } else {
        const r = UBL_RULE[code]
        if (!r) continue
        rule_id = r.id; text = r.text
        bound = r.terms.flatMap((t) => (t === 'BT-131*' ? lineBound.map((lb) => lb.get('BT-131')!) : doc.has(t) ? [doc.get(t)!] : []))
      }
      provenance = 'SPEC'
      // the one override (toward ABSTAIN only): the built-in TAX_AMT is required since 0.1.0, but a BT-110 that is present
      // in the wrong currency is passed as unparseable; say why in the rule's own terms
      if (code === 'TAX_INCL_INT' && !doc.get('BT-110')?.ok) abstainWhy = `BT-110 is not bound (${(doc.get('BT-110') as { detail?: string } | undefined)?.detail ?? 'absent'})`
    } else if (KSEF_SPEC_RULE[code]) {
      rule_id = KSEF_SPEC_RULE[code]!.id
      text = KSEF_SPEC_RULE[code]!.text
      provenance = 'SPEC'
      bound = [...(doc.has('P_15') ? [doc.get('P_15')!] : []), ...(rozliczenie?.bindings ?? []).map((binding): BindResult => ({ ok: true, binding }))]
    } else {
      rule_id = `KSEF-HOUSE:${code}`
      text = KSEF_TEXT[code] ?? code
      provenance = 'HOUSE_RECON'
      bound = code === 'GROSS_INT' ? [...doc.values()] : [...lineBound[li]!.values()]
    }

    const operands = bound.filter((b): b is Extract<BindResult, { ok: true }> => b.ok).map((b) => ({ term: b.binding.term, xpath: b.binding.xpath, value: b.binding.value }))
    const evidence = bound.flatMap((b) => (b.ok ? spanEvidence(xmlSha, b.binding) : []))
    const claim_id = `xml.${scope}.${rule_id}`
    const base = { claim_id, kind: 'CONSISTENCY' as const, tier: 'DETERMINISTIC' as const, field: hc.field, rule_id, rule_name: `${text} [house ${code}, ${footing}]` }
    let claim: ClaimVerdict, outcome: EinvoiceConsistency['outcome'], detail: string
    if (abstainWhy !== null || hc.outcome === 'INSUFFICIENT_DATA' || evidence.length === 0) {
      detail = abstainWhy ?? hc.insufficiency?.detail ?? 'no operand element could be bound'
      outcome = 'ABSTAIN'
      claim = { ...base, outcome: 'INSUFFICIENT_DATA', asserted: null, evidence: [], locked: false,
        insufficiency: { reason: abstainWhy !== null ? 'OUT_OF_RULESET_SCOPE' : hc.insufficiency?.reason ?? 'FIELD_MISSING', detail },
        explanation: `${rule_id}: ${detail}; not checked.` }
    } else {
      outcome = hc.outcome
      detail = hc.explanation
      claim = { ...base, outcome: hc.outcome, asserted: hc.asserted, evidence, locked: hc.locked,
        ...(hc.computation ? { computation: hc.computation } : {}), ...(hc.variance !== undefined ? { variance: hc.variance } : {}),
        explanation: `${rule_id} (${scope}): ${hc.explanation}${hc.outcome === 'FAIL' ? ' The invoice is internally inconsistent: its own elements do not satisfy the rule.' : ''}` }
    }
    out.push({ claim_id, rule_id, house_code: code, footing, scope, outcome, detail, provenance, operands, claim })
  }
  return out
}
