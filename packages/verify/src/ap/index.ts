/**
 * AP three-way match — invoice ↔ purchase order ↔ goods receipt, as verify's standard proof object.
 *
 * Every check is its own claim (PASS / FAIL / INSUFFICIENT_DATA, with evidence spans into the document it read):
 *   ap.duplicate            CROSS_REFERENCE  (only if payment history is supplied) invoice not already booked — exact
 *                                            repeat FAILs (hold_duplicate); same vendor + PO + total under a new number
 *                                            ABSTAINS for a person to confirm; without history it is listed in not_checked.
 *                                            Engine 0.6.0 (./duplicate.ts): vendor names compared normalized (a ", Inc."
 *                                            variant of a booked number holds), and a look-alike name (a typo, an
 *                                            abbreviation, initials, a "d/b/a" name) holds for the controller; without
 *                                            history the claim is stated as not run (INSUFFICIENT_DATA), and the bill goes
 *                                            to a person (abstain, payable false), never approved (./decide.ts failClosed)
 *   ap.po_number            CROSS_REFERENCE  invoice's PO number === the PO's number
 *   ap.line[L].quantity     CROSS_REFERENCE  invoiced units ≤ units received (goods receipt)
 *   ap.line[L].price        CROSS_REFERENCE  invoiced unit price ≤ PO unit price × (1 + price_tolerance)
 *   ap.line[L].amount       RECOMPUTE        (0.2.0) stated line amount = quantity × unit price, within one minor unit
 *                                            (./line-math.ts; abstains on a line with a discount, fee or signed amount)
 *   ap.total                RECOMPUTE        stated total === Σ line amounts (+ freight only if the PO allows it)
 *   ap.po_balance           CROSS_REFERENCE  (engine 0.6.0, only with payment history, ./po-balance.ts)
 *                                            billed to date on the order (booked rows on this PO, same vendor, plus this
 *                                            bill's lines) ≤ Σ PO line quantity × unit price; over → a person decides (never a
 *                                            FAIL); last in the decision order. Amounts on the order, not quantities on a line
 *   ap.vendor               CROSS_REFERENCE  (engine 0.6.0, ./vendor.ts) the invoice names the PO's vendor
 *                                            ("Vendor:" on the PO), by name or by a sender's address built from it; otherwise a
 *                                            person decides (never a FAIL). A PO with no "Vendor:" field: not run, said in
 *                                            not_checked. Engine 0.6.0 also reads a stated total only from an amount on a
 *                                            total line, never an account, phone, routing, ZIP or reference number (./parse.ts)
 *   ap.remittance           CROSS_REFERENCE  (engine 0.6.0, ./remittance.ts; only when the bill's text carries
 *                                            them) a line matches a payment-redirection phrasing: a change of payment details,
 *                                            bank-account details, a payment app, a link to pay at, a payee email or phone; a
 *                                            person decides (never a FAIL), the controller clears it. Engine 0.6.0 also reads
 *                                            the sender's domain by look-alike rules in the vendor check, never an email header
 *                                            line, and a free-mail sender goes to a person (./vendor.ts); every approve names
 *                                            what it did not check (not_checked), and never asserts what it did not establish
 *   ap.bill_line[n].*       (engine 0.7.0) an invoice line that matches no PO line, or does not name the item of the PO line
 *                                            it was paired with (./parse.ts matchLines070): a person decides, the line named
 *   ap.tax                  (engine 0.7.0) a tax line, checked against the rate the PO block states (./tax.ts)
 * Engine 0.7.0 (./v070.ts) also reads the sender from the angle brackets (a display name shaped like another address goes to a
 * person), sends a sender not built from the vendor's name to a person when no domain is on file, reads payment-instruction
 * sentences (./remittance.ts), takes a partial bill as ordinary, reads a suffixed invoice number whole, and says a booked
 * number one suffix away is similar. Every approve of this path ends its scope with TEXT_PATH_NOT_CHECKED.
 * The document outcome is verify's ANY_FAIL_FAILS aggregation. On top of it, the POLICY DECISION applies the checks in
 * order and stops at the first failure (approve | hold_no_po | hold_quantity | hold_price | hold_line_math | hold_total),
 * and ABSTAINS — never guesses — when a check it would need before the first failure could not be decided.
 *
 * RULESET VERSIONS. 0.2.0 (current) adds the line recompute: 0.1.0 checked that the total adds up the stated line amounts,
 * never that a line's amount is its quantity × unit price, so "10 × 12.00 = 150.00" with a total that adds up was approved.
 * 0.1.0 is retained and selectable (`ruleset: 'ap-threeway@0.1.0'`) and re-performs its verdicts byte for byte; a changed
 * rule never keeps its old label. 0.2.0 only tightens: it never approves what 0.1.0 held.
 *
 * 0.3.0 (2026-10-14; minted, selectable as `ruleset: 'ap-threeway@0.3.0'`, not yet the default) answers a cold reader's
 * emailed bills (test/fixtures/ap-buyers-2026-10-13/README.md). It needs engine 0.7.0 or later (its readings extend that
 * engine's sentence and line readings) and is refused under an earlier one. One rule tightens: a sentence that names an
 * account, bank, lockbox, routing or remittance detail as closed, changed, new, updated or replaced, or that promises to
 * call, send or confirm payment instructions, sends the bill to a person, naming the sentence (./remittance.ts, kind
 * 'announced'); and an approve's "none was found" is said only when no sentence of the bill names payment at all. Four
 * readings loosen, each a supply-house habit that sent a clean bill to a person for a reason of reading, never of a check:
 * a pole count ("1P" for single pole; ./parse.ts POLES), a subtotal line that is the lines' sum (one that is not goes to a
 * person, both figures named), a distributor's invoice number after the word "invoice" ("S104412558.001"), and a unit price
 * per thousand or per hundred ("189.00/M"). 0.2.0 verdicts re-perform byte for byte: every reading here is gated on 0.3.0.
 *
 * 0.4.0 (2026-10-19; minted, selectable as `ruleset: 'ap-threeway@0.4.0'`, never the default under engine 0.7.2) answers six
 * cold readers' emailed bills that 0.3.0 approved (test/fixtures/ap-r10/README.md). It reads everything 0.3.0 reads, needs
 * engine 0.7.0 or later as 0.3.0 does, and only tightens: four readings send a bill 0.3.0 approved to a person, the line
 * named, and none loosens.
 *   - The opening step of a payment redirection (./remittance.ts readOpening, kind 'opening'): a sentence that asks for a
 *     reply, a call or a confirmation about the vendor's banking or wiring details, or for a reply or a call before payment is
 *     released, or that announces a move to a new bank or financial partner.
 *   - Every line read as spelled (./remittance.ts readAsSpelled): invisible characters left out, compatibility forms and
 *     accents set back, look-alike Cyrillic or Greek letters in a Latin word read as Latin, letters spelled apart by hyphens,
 *     dots, underscores or spaces joined when they spell a payment word. A line found only that way says how it was read.
 *   - A Reply-To at another registrable domain than the From line of its header block (./vendor.ts replyTosOf), when the
 *     vendor check would otherwise pass.
 *   - With no domain on file, a sender whose domain is the vendor's name run together passes under .com only; under another
 *     ending a person decides (./vendor.ts, 2026-10-20: a sixth bill, from aldinejan.net with nothing on file).
 * Its approve says what these readings read. No rule id, remedy or claim id is added, so the remedy table, and every verdict id
 * of 0.3.0 and earlier, is unchanged; 0.3.0 and 0.2.0 verdicts re-perform byte for byte: every reading here is gated on 0.4.0.
 *
 * Benchmark (public, Apache-2.0 data; see docs/BENCHMARK-AP.md): blind run 82/100 decided, 0 wrong;
 * with the two disclosed wording rules included here, 100/100, 0 wrong. Synthetic invoices — real ones will abstain more.
 *
 * Deterministic; no I/O; no clock except issued_at.
 */
import { hashOf, sha256 } from '../verdict/canonical.js'
import { attachRemedies, type RemedySpec, type RemedyTable } from '../verdict/remedy.js'
import { attachScope } from '../verdict/scope.js'
import type { ClaimVerdict, Coverage, Evidence, Outcome, Verdict } from '../verdict/schema.js'
import { SCHEMA_VERSION, engineAtLeast, engineFor, type EngineVersion } from '../version.js'
import { verdictIdentity } from '../protocol/verdict-id.js'
import { AP_LINE_MATH_RULE, adjustmentMarker, minorUnitDigits, recomputeLine } from './line-math.js'
import { close, matchLines, matchLines070, parseGoodsReceipt, parseInvoice, parsePurchaseOrder, round2, type LineMatch070, type Span } from './parse.js'
import { apPolicyDecision } from './decide.js'
import { duplicateClaimV060, duplicateRemediesV060, looseNumber, noHistoryClaim, NO_HISTORY_DETAIL } from './duplicate.js'
import { PO_BALANCE_NOT_RUN, PO_BALANCE_REMEDIES, bookedOnOrder, perLineGapNote, poBalanceClaim } from './po-balance.js'
import { TAX_REMEDIES, taxClaim } from './tax.js'
import { VENDOR_REMEDIES, textVendorNotChecked, textVendorNotChecked040, vendorClaimText, type TextVendorMatch } from './vendor.js'
import { BANK_NOT_CHECKED_TEXT, REMITTANCE_REMEDIES, bankNotCheckedText030, bankNotCheckedText040, bankNotCheckedText070, readRemittanceAll, remittanceClaim, type PaymentMention } from './remittance.js'
import { readsAs070 } from './v070.js'
import { QTY_TO_DATE_REMEDIES } from './qty-to-date.js'
import { moneyWords, totalWords } from './words.js'

/** Retained so a verdict issued under it can be re-performed: the four checks without the line recompute. Never the default. */
export const AP_RULESET_V0_1_0 = { id: 'ap-threeway', version: '0.1.0', domain: 'accounts-payable' } as const
/** The line recompute (2026-10-03). The default under engines 0.6.0 to 0.7.1; retained so their verdicts re-perform. */
export const AP_RULESET_V0_2_0 = { id: 'ap-threeway', version: '0.2.0', domain: 'accounts-payable' } as const
/** The announced-change rule and the supply-house readings (2026-10-14; the header above). The default from engine 0.7.2. */
export const AP_RULESET_V0_3_0 = { id: 'ap-threeway', version: '0.3.0', domain: 'accounts-payable' } as const
/** The opening step, the spelled reading, the Reply-To and the sender's ending (2026-10-19; the header above). Selectable; never the default under engine 0.7.2. */
export const AP_RULESET_V0_4_0 = { id: 'ap-threeway', version: '0.4.0', domain: 'accounts-payable' } as const
export type ApRuleset = typeof AP_RULESET_V0_1_0 | typeof AP_RULESET_V0_2_0 | typeof AP_RULESET_V0_3_0 | typeof AP_RULESET_V0_4_0
/**
 * The engine from which ap-threeway@0.3.0 is the default for a bill that names no ruleset: the release that shipped it
 * (2026-10-14). Engines before it keep 0.2.0, so a verdict they issued re-performs byte for byte and an old engine asked for by
 * name is never handed a ruleset it refuses.
 */
const V030_DEFAULT_ENGINE: EngineVersion = '0.7.2'
/** The AP ruleset a bill is checked under when none is named, under engine `engine` (this build's when absent). */
export function defaultApRuleset(engine?: string): ApRuleset {
  return engineAtLeast(engineFor(engine), V030_DEFAULT_ENGINE) ? AP_RULESET_V0_3_0 : AP_RULESET_V0_2_0
}
/** The ruleset a bill is checked under when none is named, under this build's engine. */
export const AP_RULESET: ApRuleset = defaultApRuleset()
/** Every AP ruleset version this build can evaluate under, newest first. */
export const AP_RULESET_VERSIONS: readonly ApRuleset[] = [AP_RULESET_V0_4_0, AP_RULESET_V0_3_0, AP_RULESET_V0_2_0, AP_RULESET_V0_1_0]

/** True when ruleset `r` reads a bill the 0.3.0 way (the header above): 0.3.0 and any later version. */
export function readsAs030(r: ApRuleset): boolean {
  const [a, b] = r.version.split('.').map(Number) as [number, number]
  return a > 0 || (a === 0 && b >= 3)
}

/** True when ruleset `r` reads a bill the 0.4.0 way (the header above): 0.4.0 and any later version. */
export function readsAs040(r: ApRuleset): boolean {
  const [a, b] = r.version.split('.').map(Number) as [number, number]
  return a > 0 || (a === 0 && b >= 4)
}

/**
 * Resolve 'ap-threeway' (the current version), 'ap-threeway@<version>' (any version this build retains) or a ruleset ref.
 * Unknown ids or versions throw: a verdict is never issued under a ruleset that does not exist.
 */
export function resolveApRuleset(r?: string | { id: string; version: string }, engine?: string): ApRuleset {
  if (r === undefined) return defaultApRuleset(engine)
  const [id, version] = typeof r === 'string' ? r.split('@') as [string, string | undefined] : [r.id, r.version]
  const hit = id === AP_RULESET.id && (version === undefined ? defaultApRuleset(engine) : AP_RULESET_VERSIONS.find((v) => v.version === version))
  if (!hit) throw new Error(`unknown AP ruleset "${typeof r === 'string' ? r : `${r.id}@${r.version}`}"; known: ${AP_RULESET_VERSIONS.map((v) => `${v.id}@${v.version}`).join(', ')}`)
  return hit
}

/**
 * Remedies, declared next to the rules (2026-10-02; docs/REMEDIES.md), read from what actually holds an invoice in AP: a
 * receipt not yet posted, a price the buyer has not approved, a PO the invoice does not cite, arithmetic the vendor got
 * wrong, a resubmission. The roles are the usual AP ones; a deployment maps them to people. An `authority` remedy is that
 * role's mandate over THIS verdict only (receipts' ap_gate honours a ruling only within it). Can't-tell reasons not named
 * here take the remedies their insufficiency implies (verdict/remedy.ts).
 */
const lineMatch: RemedySpec = { kind: 'missing-operand', operand: { source: 'invoice', path: '{field}' }, when: ['AMBIGUOUS_REFERENCE'],
  detail: 'Which PO line this invoice line bills: the line match is not certain enough to check ({missing}). Name the PO line, and the check runs again.' }

export const AP_REMEDIES: RemedyTable = {
  AP_DUPLICATE: {
    fail: [
      { kind: 'authority', authority: 'ap-controller',
        detail: 'Invoice {asserted} is already booked ({op:booked_as}). Paying it again is lawful only if that booking was voided or credited: the controller rules, for this verdict only.' },
    ],
    abstain: [
      { kind: 'missing-operand', operand: { source: 'goods_receipt' }, when: ['AMBIGUOUS_REFERENCE'],
        detail: 'Same vendor, PO and total as a booked invoice under a new number: a goods receipt for this delivery, distinct from the one the booked invoice paid, settles it.' },
      { kind: 'authority', authority: 'ap-clerk', when: ['AMBIGUOUS_REFERENCE'],
        detail: 'A person confirms this is a new delivery and not a resubmission, for this verdict only.' },
      { kind: 'recompute-with', operand: { source: 'invoice', path: 'invoice_number' }, when: ['UNPARSEABLE'],
        detail: 'A legible invoice number, so the duplicate check can run.' },
    ],
  },
  AP_PO_MATCH: {
    fail: [
      { kind: 'missing-operand', operand: { source: 'invoice', path: 'po_number' },
        detail: 'The invoice cites {op:invoice_po}; the open order is {op:po}. The vendor reissues the invoice citing the order it bills, or the invoice is matched against the order it does cite: either is a new check.' },
      { kind: 'authority', authority: 'buyer',
        detail: 'The buyer may approve it as an invoice without a matching purchase order, for this verdict only.' },
    ],
    abstain: [
      { kind: 'recompute-with', operand: { source: 'purchase_order', path: 'po_number' }, when: ['UNPARSEABLE'],
        detail: 'A legible PO number on the purchase order.' },
      { kind: 'missing-operand', operand: { source: 'invoice', path: 'po_number' }, when: ['AMBIGUOUS_FIELD'],
        detail: 'The one purchase order this invoice bills: it cites several.' },
    ],
  },
  AP_QTY_RECEIVED: {
    fail: [
      { kind: 'missing-operand', operand: { source: 'goods_receipt', path: '{field}' },
        detail: 'Billed {asserted}, received {op:received}. A goods receipt for the other {variance} unit(s), posted when they arrive, lets the check pass as a new verdict.' },
      { kind: 'transform', transform: 'cap-at-received', operand: { source: 'invoice', path: '{field}' },
        detail: 'Pay for the {op:received} unit(s) received now, and the rest on receipt.' },
      { kind: 'authority', authority: 'buyer',
        detail: 'The buyer may approve paying for units not yet received, for this verdict only.' },
    ],
    abstain: [
      { kind: 'missing-operand', operand: { source: 'goods_receipt', path: '{field}' }, when: ['REFERENCE_NOT_PROVIDED'],
        detail: 'A goods-receipt line for this PO line: nothing has been received against it yet.' },
      lineMatch,
    ],
  },
  AP_PRICE_PO: {
    fail: [
      { kind: 'authority', authority: 'buyer',
        detail: 'Invoiced {asserted} per unit against {op:po_unit} on the PO (at most {expected} within tolerance). The buyer may approve the price variance for this verdict only; the PO is unchanged.' },
      { kind: 'missing-operand', operand: { source: 'purchase_order', path: '{field}' },
        detail: 'A PO change order at the invoiced price: the invoice is then checked as a new verdict.' },
    ],
    abstain: [lineMatch],
  },
  AP_LINE_MATH: {
    fail: [
      { kind: 'recompute-with', operand: { source: 'invoice', path: '{field}' },
        detail: '{op:quantity} × {op:unit_price} is {expected}; the line says {asserted}. Re-read the line; if the invoice itself is wrong, the vendor reissues it.' },
      { kind: 'authority', authority: 'ap-supervisor',
        detail: 'A person with AP authority may accept the line as stated, for this verdict only.' },
    ],
    abstain: [
      { kind: 'authority', authority: 'ap-clerk', when: ['AMBIGUOUS_FIELD'],
        detail: 'The line carries an adjustment (a discount, fee or signed amount) that quantity × unit price does not model: a person reads it, for this verdict only.' },
      lineMatch,
    ],
  },
  AP_TOTAL_SUM: {
    fail: [
      { kind: 'recompute-with', operand: { source: 'invoice', path: 'total' },
        detail: 'The lines (plus freight, if the PO allows it) come to {expected}; the stated total is {asserted} (off by {variance}). Re-read the total and every line amount.' },
      { kind: 'authority', authority: 'ap-supervisor',
        detail: 'A person with AP authority may accept the stated total (freight the PO does not allow, for instance), for this verdict only.' },
    ],
    abstain: [
      { kind: 'missing-operand', operand: { source: 'purchase_order', role: 'freight_allowed' }, when: ['AMBIGUOUS_UNIT'],
        detail: 'Whether the PO allows freight: the invoice bills freight and the PO does not say.' },
      { kind: 'recompute-with', operand: { source: 'invoice', path: 'total' }, when: ['UNPARSEABLE', 'AMBIGUOUS_FIELD', 'FIELD_MISSING'],
        detail: 'One unambiguous stated total, and every amount on the invoice read as a line, the total, or freight.' },
    ],
  },
}

/**
 * The remedy table engine 0.6.0 answers from (2026-10-05): AP_REMEDIES with the duplicate check's remedies told apart by what
 * the claim says (./duplicate.ts duplicateRemediesV060), and (2026-10-05) the PO balance check's (./po-balance.ts).
 * Engines up to 0.5.0 keep AP_REMEDIES, so their verdict ids and remedies replay byte for byte. Adding AP_PO_BALANCE moved the
 * remedy_table_hash, and so the verdict_id, of every AP verdict under engine 0.6.0 (unreleased; the pinned id was moved by hand).
 * 2026-10-05: the vendor check's remedies (AP_VENDOR_MATCH, ./vendor.ts) and the tax check's (AP_TAX, ./tax.ts)
 * joined the table, so the 0.6.0 remedy_table_hash and every 0.6.0 AP verdict_id moved again (repinned by hand).
 */
/* 2026-10-06: the payment-details check's remedies (AP_REMITTANCE, ./remittance.ts) and the billed-to-date check's
 * (AP_QTY_TO_DATE, ./qty-to-date.ts) joined the table, so the 0.6.0 remedy_table_hash and every 0.6.0 AP verdict_id moved again
 * (repinned by hand). */
export const AP_REMEDIES_V060: RemedyTable = { ...duplicateRemediesV060(AP_REMEDIES), AP_PO_BALANCE: PO_BALANCE_REMEDIES, AP_VENDOR_MATCH: VENDOR_REMEDIES, AP_TAX: TAX_REMEDIES, AP_REMITTANCE: REMITTANCE_REMEDIES, AP_QTY_TO_DATE: QTY_TO_DATE_REMEDIES }

/** The AP remedy table a verdict of engine `engine` is answered from (and whose hash its verdict_id binds). */
export function apRemediesFor(engine: EngineVersion): RemedyTable {
  return engineAtLeast(engine, '0.6.0') ? AP_REMEDIES_V060 : AP_REMEDIES
}

export type ApDecision = 'approve' | 'hold_duplicate' | 'hold_no_po' | 'hold_quantity' | 'hold_price' | 'hold_line_math' | 'hold_total' | 'abstain'

/**
 * The text path's "Not checked" line about tax on an approve (2026-10-06): what was read (no amount on the bill was read as
 * tax), what is not read (tax inside a price, a tax line with no amount) and that the text path reads no tax terms on the PO.
 */
export const TAX_NOT_CHECKED_TEXT = 'tax: no amount on the bill was read as tax (every amount on it was read as a line, the total or freight); tax included in a price, or a tax line with no amount, is not read, and the text path reads no tax terms on the purchase order, so whether tax was due was not checked'

/**
 * Engine 0.7.0 (2026-10-13): the text path reads a tax line and the rate the purchase order states, so the "Not checked" line
 * about tax on an approve with no tax line says what the order states. An approve whose tax line was checked against the
 * order's rate carries no such line (it was checked).
 */
export function taxNotCheckedText070(rate: number | null): string {
  return `tax: no line of the bill was read as tax (every amount on it was read as a line, the total or freight)${rate === null ? ', and the purchase order states no tax rate' : `; the purchase order states a tax rate of ${Math.round(rate * 1e6) / 1e4}%`}; tax included in a price is not read, so whether tax was due was not checked`
}

/** Engine 0.7.0: the sentence every emailed-text approve carries under "Not checked", last. */
export const TEXT_PATH_NOT_CHECKED = 'This bill was read from text; the structured path is the product and this path is a convenience with the limits listed.'

/**
 * An invoice already in the payer's books (from the ERP / payment history). `vendor_id` and `vendor_tax_id` (2026-10-05,
 * optional) name the vendor it was booked under; engine 0.6.0's duplicate check prefers them to the name when the bill side
 * carries one too (the text path's purchase order carries none, so on that path only the name is compared).
 */
export interface PriorInvoice { invoice_number: string; po_number?: string; total?: number; vendor?: string; vendor_id?: string; vendor_tax_id?: string; paid_on?: string
  /** 2026-10-05 (engine 0.6.0's PO balance check): true when the invoice was booked without a purchase order; not counted against any order */
  no_purchase_order?: boolean
  /**
   * 2026-10-06, text path, optional: the address the booked bill came from. When the purchase order names no domain for the
   * vendor, the senders of its booked bills are its domains on file, and the vendor check compares the bill's sender with them
   * (./vendor.ts).
   */
  sender?: string }

export interface ApDocuments {
  /** the invoice as received (email body / text) */
  invoice: string
  /** the ERP purchase order, as text ("PO-123 | Vendor: … | Freight: …" + numbered lines) */
  purchase_order: string
  /** the ERP goods receipt, as text (numbered lines "… | received N") */
  goods_receipt: string
  /** OPTIONAL: invoices already booked/paid. Enables the duplicate check (the most common real AP loss). */
  history?: PriorInvoice[]
}

export interface ApPolicy {
  /** max fractional overcharge on unit price before hold_price. Default 0.02 (2%). */
  price_tolerance?: number
  /** total comparison tolerance in currency units. Default 0.005. */
  total_tolerance?: number
  /**
   * Engine 0.6.0 (2026-10-05): freight billed on a purchase order that does not say whether it allows freight.
   * 'person' (the default, the behaviour before) sends the bill to a person; 'allow' adds the freight into the total as an
   * allowed charge, and the words say the run's policy allowed it. A PO that says freight is not allowed is never overridden.
   * A pilot registers it in its pre-registration (packages/receipts PILOT.md), as it does the price tolerance.
   */
  freight?: 'allow' | 'person'
  /**
   * Engine 0.6.0 (2026-10-06): tax billed on a purchase order that states no tax terms (structured input; the
   * text path reads no tax line). 'person' (the default, the behaviour before) sends the bill to a person; { rate } checks the
   * tax within the price tolerance of rate × the taxable lines, as a stated PO rate is checked; 'allow' accepts the tax as
   * billed, and the words say so. A purchase order that states its tax terms is never overridden. A pilot registers it in its
   * pre-registration (packages/receipts PILOT.md), as it does the freight rule.
   */
  tax?: 'person' | 'allow' | { rate: number }
}

/**
 * The policy, every field resolved. `freight` appears only when it is 'allow', and `tax` only when it is not 'person', so a
 * default policy hashes as it did before.
 */
export interface ApResolvedPolicy { price_tolerance: number; total_tolerance: number; freight?: 'allow'; tax?: 'allow' | { rate: number } }

/**
 * The policy a verdict is made under, every field resolved (2026-10-05): the defaults filled in, and a value that
 * is not a finite number of at least 0 refused (Error), under every engine. Both paths hash exactly this object into the
 * verdict's input_hash (as `policy`), and a proof carries it as its inputs' `policy`, so a replay re-performs the verdict under
 * the same tolerances. Infinity, NaN and a negative tolerance were never meaningful, and Infinity and NaN hash alike.
 */
export function apPolicyOf(policy?: ApPolicy): ApResolvedPolicy {
  const one = (v: unknown, name: string, dflt: number): number => {
    if (v === undefined) return dflt
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Error(`policy.${name} must be a finite number of at least 0 (got ${typeof v === 'number' ? String(v) : JSON.stringify(v)})`)
    return v
  }
  // 2026-10-05: the freight policy; 'person' is the default and is never written, so a default policy hashes as before
  const f: unknown = policy?.freight
  if (f !== undefined && f !== 'allow' && f !== 'person') throw new Error(`policy.freight must be "allow" or "person" (got ${JSON.stringify(f)})`)
  // 2026-10-06: the tax policy; 'person' is the default and is never written, so a default policy hashes as before
  const t: unknown = policy?.tax
  const rateOk = (x: unknown): x is { rate: number } => typeof x === 'object' && x !== null && !Array.isArray(x) && Object.keys(x).length === 1 &&
    typeof (x as { rate?: unknown }).rate === 'number' && Number.isFinite((x as { rate: number }).rate) && (x as { rate: number }).rate >= 0 && (x as { rate: number }).rate <= 1
  if (t !== undefined && t !== 'allow' && t !== 'person' && !rateOk(t)) throw new Error(`policy.tax must be "person", "allow" or { "rate": <a fraction from 0 to 1, 0.0825 for 8.25%> } (got ${JSON.stringify(t)})`)
  return {
    price_tolerance: one(policy?.price_tolerance, 'price_tolerance', 0.02), total_tolerance: one(policy?.total_tolerance, 'total_tolerance', 0.005),
    ...(f === 'allow' ? { freight: 'allow' as const } : {}),
    ...(t === 'allow' ? { tax: 'allow' as const } : rateOk(t) ? { tax: { rate: t.rate } } : {}),
  }
}

/**
 * `--tax person|allow|rate:<pct>` (2026-10-06), one spelling for `verify ap` and a pilot's pre-registration: the policy, or a
 * message saying what it must be. The rate is a percent with its sign ("rate:8.25%") or a fraction ("rate:0.0825"); a bare 8.25
 * is refused (it reads two ways).
 */
export function parseTaxPolicy(raw: string | undefined): { value: 'person' | 'allow' | { rate: number } } | { error: string } {
  if (raw === undefined || raw.startsWith('--')) return { error: '--tax needs a value: person (a person decides, the default), allow (tax accepted as billed) or rate:<percent> (rate:8.25%)' }
  const t = raw.trim()
  if (t === 'person' || t === 'allow') return { value: t }
  const m = /^rate:\s*(\d+(?:\.\d+)?|\.\d+)\s*(%?)$/.exec(t)
  const v = m ? Number(m[1]) / (m[2] ? 100 : 1) : NaN
  if (!m || !Number.isFinite(v) || v < 0 || v > 1) return { error: `--tax ${JSON.stringify(raw)}: give person, allow, or rate:<percent> (rate:8.25%, or the fraction rate:0.0825)` }
  return { value: { rate: Math.round(v * 1e9) / 1e9 } }
}

/** A tax policy as the flag writes it: "person", "allow" or "rate:8.25%". */
export function taxPolicyText(p: 'person' | 'allow' | { rate: number } | undefined | null): string {
  if (p === undefined || p === null || p === 'person') return 'person'
  if (p === 'allow') return 'allow'
  return `rate:${Math.round(p.rate * 1e6) / 1e4}%`
}

/**
 * Engine 0.6.0: the tax policy a verdict is made under, or null for 'person'. Refused under an earlier engine,
 * which has no tax check, and on the text path (`text` true): there a taxed bill on a purchase order that states no tax rate
 * goes to a person (engine 0.7.0 checks a tax line against a rate the purchase order states; 0.6.0 reads no tax line).
 */
export function apTaxByPolicy(pol: ApResolvedPolicy, v060: boolean, text = false): 'allow' | { rate: number } | null {
  if (pol.tax === undefined) return null
  if (!v060) throw new Error('policy.tax needs engine 0.6.0 or later: earlier engines have no tax check')
  if (text) throw new Error('policy.tax applies to structured input (ap --input) only: on the text path a taxed bill on a purchase order that states no tax rate goes to a person')
  return pol.tax
}

/** Engine 0.6.0: `freight: 'allow'` is refused under an earlier engine, which has no such policy and could not honour it. */
export function apFreightByPolicy(pol: ApResolvedPolicy, v060: boolean): boolean {
  if (pol.freight === 'allow' && !v060) throw new Error('policy.freight "allow" needs engine 0.6.0 or later: earlier engines send freight on a purchase order that does not say to a person')
  return pol.freight === 'allow'
}

export interface ApResult {
  verdict: Verdict
  decision: ApDecision
  /**
   * false = do not pay; true = all checks passed; null = abstained (a human must look). Engine 0.6.0: never
   * null. true exactly on an approve, which stands only on a verdict that reads PASS; every abstain, including a bill whose
   * duplicate check could not run (PASS_WITH_OPEN), is false: a person decides, nothing is paid automatically.
   */
  payable: boolean | null
  /** the six-field answer a clerk acts on (null fields where not applicable) */
  grounding: { invoice_number: string | null; po_number: string | null; item: string | null; invoiced: string | number | null; expected: string | number | null }
  reasons: string[]
  /** checks that did NOT run, and why — the honest scope of this decision */
  not_checked: string[]
}

export interface VerifyInvoiceMatchOptions {
  policy?: ApPolicy
  producer?: string
  now?: () => Date
  /** 'ap-threeway' (current, 0.2.0) or 'ap-threeway@0.1.0' (retained, to re-perform its verdicts). See resolveApRuleset. */
  ruleset?: string | { id: string; version: string }
  /** The engine version to re-perform under (2026-10-03, version.ts engineFor): this build's when absent, or an earlier one it retains. For replay. */
  engine?: string
}

/** Split the three-document layout "INVOICE MESSAGE … PURCHASE ORDER (ERP) … GOODS RECEIPT (ERP) …" into its parts. */
export function splitApLayout(text: string): ApDocuments | null {
  const iPo = text.indexOf('PURCHASE ORDER (ERP)')
  const iGr = text.indexOf('GOODS RECEIPT (ERP)')
  if (iPo < 0 || iGr < 0 || iGr < iPo) return null
  return { invoice: text.slice(0, iPo), purchase_order: text.slice(iPo, iGr), goods_receipt: text.slice(iGr) }
}

type Src = 'invoice' | 'purchase_order' | 'goods_receipt'

/**
 * Engine 0.7.0: an unclear invoice number in words: the numbers the bill reads, each with its lines, and any of them that is
 * booked (as looseNumber reads them), so the person it goes to sees the near match the check almost made.
 */
function unclearNumberWords(mentions: readonly { value: string; lines: number[] }[], history: readonly PriorInvoice[]): string {
  const at = (l: readonly number[]): string => (l.length === 1 ? `invoice line ${l[0]}` : `invoice lines ${l.join(', ')}`)
  const list = mentions.map((m) => `${m.value} (${at(m.lines)})`)
  const read = list.length <= 2 ? list.join(' and ') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
  const booked = mentions.flatMap((m) => {
    const h = history.find((r) => looseNumber(r.invoice_number) === looseNumber(m.value))
    return h ? [`${m.value} is booked${h.invoice_number.trim().toUpperCase() !== m.value ? ` as ${h.invoice_number}` : ''}${h.paid_on ? ` (paid ${h.paid_on})` : ''}`] : []
  })
  return `invoice number unclear: the bill reads ${read}, so the duplicate check cannot run${booked.length ? `; ${booked.join('; ')}` : ''}`
}

/**
 * Ruleset 0.3.0: the first subtotal line that is neither the lines' sum nor the lines plus the freight read, or null when every
 * subtotal line (or none) agrees.
 */
function subtotalOff(subtotals: readonly { value: number; span: Span; text: string }[], lines: readonly { amount: number }[], freight: readonly { value: number }[], tol: number): { value: number; span: Span; text: string } | null {
  const sum = round2(lines.reduce((a, l) => a + l.amount, 0))
  const withFreight = freight.length === 1 ? round2(sum + freight[0]!.value) : null
  return subtotals.find((s) => !close(round2(s.value), sum, tol) && (withFreight === null || !close(round2(s.value), withFreight, tol))) ?? null
}

export function verifyInvoiceMatch(docs: ApDocuments, options: VerifyInvoiceMatchOptions = {}): ApResult {
  const ruleset = resolveApRuleset(options.ruleset, options.engine)
  const engine_version = engineFor(options.engine)
  // Engine 0.6.0 (2026-10-05): the duplicate check of ./duplicate.ts, and a run without history states it.
  const v060 = engineAtLeast(engine_version, '0.6.0')
  // Engine 0.7.0 (2026-10-13; ./v070.ts): the emailed-bill readings. Every one below is gated on it.
  const v070 = v060 && readsAs070(engine_version)
  const lineMath = ruleset.version !== AP_RULESET_V0_1_0.version
  // Ruleset 0.3.0 (2026-10-14; the header): the announced-change rule and the supply-house readings. Every one is gated on it,
  // and it extends the 0.7.0 readings, so it is refused under an earlier engine rather than silently losing a rule.
  const v030 = readsAs030(ruleset)
  if (v030 && !v070) throw new Error(`${ruleset.id}@${ruleset.version} needs engine 0.7.0 or later: its announced-change rule and supply-house readings extend that engine's sentence and line readings (engine ${engine_version} asked for)`)
  // Ruleset 0.4.0 (2026-10-19; the header): the opening step, the spelled reading and the Reply-To. Every one is gated on it, and
  // it reads everything 0.3.0 reads (so the engine check above refuses it under an engine before 0.7.0 too).
  const v040 = readsAs040(ruleset)
  const pol = apPolicyOf(options.policy)
  const { price_tolerance: tolP, total_tolerance: tolT } = pol
  const freightByPolicy = apFreightByPolicy(pol, v060)
  apTaxByPolicy(pol, v060, true) // 2026-10-06: refused here (the text path reads no tax line)
  const hashes: Record<Src, string> = { invoice: sha256(docs.invoice), purchase_order: sha256(docs.purchase_order), goods_receipt: sha256(docs.goods_receipt) }
  const ev = (src: Src, span: Span, value: string | number, role: Evidence['role']): Evidence =>
    ({ locator: { kind: 'span', source_hash: hashes[src], start: span.start, end: span.end, line: span.line }, value, confidence: 100, role })

  // engine 0.6.0: a stated total is an amount on a total line, never an account or phone number (./parse.ts)
  // engine 0.7.0: a tax line is the bill's tax, and an invoice number is read with its suffix
  // ruleset 0.3.0: a subtotal line, a price per thousand or hundred, and a distributor's invoice number are read too
  const inv = parseInvoice(docs.invoice, v070 ? { strictTotals: true, readTax: true, suffixNumbers: true, ...(v030 ? { subtotals: true, pricePer: true, plainNumbers: true } : {}) } : v060 ? { strictTotals: true } : {})
  const match = v030 ? { poles: true } : {}
  const po = parsePurchaseOrder(docs.purchase_order)
  const gr = parseGoodsReceipt(docs.goods_receipt)
  const claims: ClaimVerdict[] = []
  const insufficient = (claim_id: string, field: string, rule_id: string, rule_name: string, reason: NonNullable<ClaimVerdict['insufficiency']>['reason'], detail: string): ClaimVerdict =>
    ({ claim_id, kind: 'CROSS_REFERENCE', tier: 'DETERMINISTIC', outcome: 'INSUFFICIENT_DATA', field, asserted: null, rule_id, rule_name, evidence: [], insufficiency: { reason, detail }, locked: false, explanation: detail })

  // --- claim: duplicate (only when payment history is supplied) ----------------------------------
  const not_checked: string[] = []
  const vendor = docs.purchase_order.match(/Vendor:\s*([^|\n]+)/)?.[1]?.trim() ?? null
  const sameVendor = (h: PriorInvoice): boolean => !h.vendor || !vendor || h.vendor.trim().toLowerCase() === vendor.toLowerCase()
  const history = docs.history
  if (!history) {
    not_checked.push('duplicate check: no payment history supplied (pass history to enable it)')
    if (v060) claims.push(noHistoryClaim('pass history to enable it'))
  } else if (!inv.invoiceNumber) {
    // engine 0.7.0: an unclear number names the numbers the bill reads, and any of them that is booked (the near match it
    // almost made), so the person it goes to starts from there
    const said = v070 && inv.invoiceNumberMentions.length > 1 ? unclearNumberWords(inv.invoiceNumberMentions, history) : null
    claims.push(insufficient('ap.duplicate', 'invoice_number', 'AP_DUPLICATE', 'Invoice not already booked', 'UNPARSEABLE', said ?? 'invoice number unclear, so the duplicate check cannot run'))
  } else if (v060) {
    const invNo = inv.invoiceNumber
    claims.push(duplicateClaimV060({
      invoice_number: invNo.value, history, vendor: { name: vendor, ids: [], tax_ids: [] },
      po_number: inv.poNumbers.length === 1 ? inv.poNumbers[0]!.value : null,
      total: inv.totals.length === 1 ? round2(inv.totals[0]!.value) : null, total_tolerance: tolT,
      invoiceEvidence: ev('invoice', invNo.span, invNo.value, 'OPERAND'),
      historyEvidence: (i) => ({ locator: { kind: 'field', source: 'history', path: `history[${i}]` }, value: history[i]!.invoice_number, confidence: 100, role: 'REFERENCE' }),
      historyContext: { locator: { kind: 'field', source: 'history', path: 'history' }, value: history.length, confidence: 100, role: 'CONTEXT' },
      ...(v070 ? { similarNumbers: true } : {}),
    }))
  } else {
    const invNo = inv.invoiceNumber
    const num = invNo.value.toUpperCase()
    const exact = history.findIndex((h) => h.invoice_number.trim().toUpperCase() === num && sameVendor(h))
    const statedTotal = inv.totals.length === 1 ? round2(inv.totals[0]!.value) : null
    const invPo = inv.poNumbers.length === 1 ? inv.poNumbers[0]!.value : null
    const near = exact >= 0 ? -1 : history.findIndex((h) => sameVendor(h) && invPo !== null && h.po_number === invPo &&
      statedTotal !== null && h.total !== undefined && close(round2(h.total), statedTotal, tolT))
    const histEv = (i: number): Evidence => ({ locator: { kind: 'field', source: 'history', path: `history[${i}]` }, value: history[i]!.invoice_number, confidence: 100, role: 'REFERENCE' })
    if (exact >= 0) {
      const h = history[exact]!
      claims.push({ claim_id: 'ap.duplicate', kind: 'CROSS_REFERENCE', tier: 'DETERMINISTIC', outcome: 'FAIL', field: 'invoice_number', asserted: invNo.value,
        rule_id: 'AP_DUPLICATE', rule_name: 'Invoice not already booked',
        computation: { formula: 'invoice_number not in history (same vendor)', operands: { invoice_number: invNo.value, booked_as: h.invoice_number }, result: h.invoice_number },
        evidence: [ev('invoice', invNo.span, invNo.value, 'OPERAND'), histEv(exact)], locked: true,
        explanation: `Invoice ${invNo.value} is already in the books${h.paid_on ? ` (paid ${h.paid_on})` : ''}. Paying it again would be a duplicate payment.` })
    } else if (near >= 0) {
      const h = history[near]!
      claims.push({ ...insufficient('ap.duplicate', 'invoice_number', 'AP_DUPLICATE', 'Invoice not already booked', 'AMBIGUOUS_REFERENCE',
        `possible resubmission: same vendor, same PO (${h.po_number}) and same total (${h.total}) as booked invoice ${h.invoice_number}, under a different number — a person should confirm this is a new delivery`),
        evidence: [histEv(near)] })
    } else {
      claims.push({ claim_id: 'ap.duplicate', kind: 'CROSS_REFERENCE', tier: 'DETERMINISTIC', outcome: 'PASS', field: 'invoice_number', asserted: invNo.value,
        rule_id: 'AP_DUPLICATE', rule_name: 'Invoice not already booked',
        computation: { formula: 'invoice_number not in history (same vendor)', operands: { invoice_number: invNo.value, history_size: history.length }, result: null },
        evidence: [ev('invoice', invNo.span, invNo.value, 'OPERAND'), { locator: { kind: 'field', source: 'history', path: 'history' }, value: history.length, confidence: 100, role: 'CONTEXT' }],
        locked: true, explanation: `Invoice ${invNo.value} does not appear among ${history.length} booked invoice(s).` })
    }
  }

  // --- claim: PO number -------------------------------------------------------------------------
  if (!po.number) {
    claims.push(insufficient('ap.po_number', 'po_number', 'AP_PO_MATCH', 'Invoice references the purchase order', 'UNPARSEABLE', 'the purchase order number could not be read'))
  } else if (inv.poNumbers.length > 1) {
    claims.push(insufficient('ap.po_number', 'po_number', 'AP_PO_MATCH', 'Invoice references the purchase order', 'AMBIGUOUS_FIELD', `the invoice mentions several PO numbers (${inv.poNumbers.map((p) => p.value).join(', ')})`))
  } else if (inv.poNumbers.length === 0) {
    claims.push({ claim_id: 'ap.po_number', kind: 'CROSS_REFERENCE', tier: 'DETERMINISTIC', outcome: 'FAIL', field: 'po_number', asserted: null, rule_id: 'AP_PO_MATCH', rule_name: 'Invoice references the purchase order',
      computation: { formula: 'invoice.po_number = po.number', operands: { invoice_po: null, po: po.number.value }, result: po.number.value },
      evidence: [ev('purchase_order', po.number.span, po.number.value, 'REFERENCE')], locked: true, explanation: `The invoice cites no PO number; the open order is ${po.number.value}.` })
  } else {
    const ip = inv.poNumbers[0]!
    const ok = ip.value === po.number.value
    claims.push({ claim_id: 'ap.po_number', kind: 'CROSS_REFERENCE', tier: 'DETERMINISTIC', outcome: ok ? 'PASS' : 'FAIL', field: 'po_number', asserted: ip.value, rule_id: 'AP_PO_MATCH', rule_name: 'Invoice references the purchase order',
      computation: { formula: 'invoice.po_number = po.number', operands: { invoice_po: ip.value, po: po.number.value }, result: po.number.value },
      evidence: [ev('invoice', ip.span, ip.value, 'OPERAND'), ev('purchase_order', po.number.span, po.number.value, 'REFERENCE')], locked: true,
      explanation: ok ? `Invoice cites ${ip.value}, which is the purchase order.` : `Invoice cites ${ip.value}; the open order is ${po.number.value}.` })
  }

  // --- claim: payment details (engine 0.6.0; ./remittance.ts): only when the bill's text carries them ---------
  let remittanceRan = false
  // engine 0.7.0: every sentence is read too, and a standing remit-to postal address is named on an approve
  let standing: { line: number }[] = []
  // ruleset 0.3.0: every other sentence that names payment, so the approve says how each was read
  let mentions: PaymentMention[] = []
  if (v060) {
    // ruleset 0.4.0: the opening step and the spelled reading (`opening`)
    const rc = remittanceClaim(docs.invoice, (span, value) => ev('invoice', span, value, 'OPERAND'), v070 ? { v070: true, vendor, ...(v030 ? { announced: true } : {}), ...(v040 ? { opening: true } : {}) } : {})
    if (rc) { claims.push(rc); remittanceRan = true }
    if (v070) { const all = readRemittanceAll(docs.invoice, { sentences: true, vendor, ...(v030 ? { announced: true } : {}), ...(v040 ? { opening: true } : {}) }); standing = all.standing; mentions = all.mentions }
  }

  // --- claim: vendor (engine 0.6.0; ./vendor.ts): the invoice names the PO's vendor ---------------------------
  // 2026-10-06: sender domains by the look-alike rules, the PO's own domain when it names one, never a header line
  let vendorRan = false
  let vendorMatched: TextVendorMatch | null = null
  if (v060) {
    // 2026-10-06: a booked bill's sender puts the vendor's domain on file when the purchase order names none
    const vc = vendorClaimText({ invoice: docs.invoice, purchase_order: docs.purchase_order, ev: (src, span, value, role) => ev(src, span, value, role),
      history, historyEv: (i, value) => ({ locator: { kind: 'field', source: 'history', path: `history[${i}].sender` }, value, confidence: 100, role: 'REFERENCE' }),
      ...(v070 ? { v070: true } : {}),
      // ruleset 0.4.0: with no domain on file, the vendor's name under another ending than .com, and a Reply-To at another
      // domain than the sender's, go to a person
      ...(v040 ? { v040: true } : {}) })
    if ('claim' in vc) { claims.push(vc.claim); vendorRan = true; vendorMatched = vc.matched } else not_checked.push(vc.notRun)
  }

  // --- line matching (needed by quantity + price claims) ------------------------------------------
  let lineProblem: string | null = null
  const byPo = new Map<number, (typeof inv.lines)[number]>()
  // engine 0.7.0 (./parse.ts matchLines070): a partial bill is ordinary; an invoice line that matches no PO line, or does not
  // name the item of the PO line it was paired with, is its own claim, named; a PO line no line bills is not checked
  let unmatched: LineMatch070['unmatched'] = []
  let unbilled: number[] = []
  if (!po.lines.length) lineProblem = 'the purchase order lines could not be read'
  // engine 0.7.0: fewer lines than the PO is a partial bill only when every amount on the invoice was read (as a line, the
  // total, freight, tax or a known stray). An amount left unread may be the line that is missing, so then it is a reading problem
  else if (v070 && inv.lines.length < po.lines.length && (inv.unclassified.length || inv.ambiguousTotal)) {
    lineProblem = `read ${inv.lines.length} invoice line(s) but the PO has ${po.lines.length}, and ${inv.unclassified.length ? `an amount on the invoice (${inv.unclassified[0]!.value}, in "${inv.unclassified[0]!.text.slice(0, 80)}") was not read as a line` : 'the total could not be read'}: cannot tell whether the bill is partial`
  } else if (v070) {
    const mm = matchLines070(inv.lines, po.lines, match)
    if (mm.problem) lineProblem = mm.problem
    else { for (const [i, j] of mm.pairs) byPo.set(j, inv.lines[i]!); unmatched = mm.unmatched; unbilled = mm.unbilled }
  } else if (inv.lines.length !== po.lines.length) lineProblem = `read ${inv.lines.length} invoice line(s) but the PO has ${po.lines.length}`
  else {
    const m = matchLines(inv.lines, po.lines, match)
    if (!m) lineProblem = 'invoice lines could not be matched to PO lines'
    else if (m.minScore < 0.34) lineProblem = `a line match is too weak to trust (score ${m.minScore.toFixed(2)})`
    else if (m.margin < 0.25) lineProblem = `two different line matchings are nearly as plausible (margin ${m.margin.toFixed(2)})`
    else for (const [i, j] of m.pairs) byPo.set(j, inv.lines[i]!)
  }

  // --- claims: quantity + price (+ line amount, 0.2.0) per PO line ---------------------------------
  const amountInsufficient = (L: number, reason: NonNullable<ClaimVerdict['insufficiency']>['reason'], detail: string): ClaimVerdict =>
    ({ ...insufficient(`ap.line[${L}].amount`, `line[${L}].amount`, AP_LINE_MATH_RULE.id, AP_LINE_MATH_RULE.name, reason, detail), kind: 'RECOMPUTE' })
  for (let j = 0; j < po.lines.length; j++) {
    const pl = po.lines[j]!
    const L = pl.index
    const il = byPo.get(j)
    const rl = gr.find((r) => r.index === L)
    // engine 0.7.0: a PO line no line of this bill bills is not checked (said under not_checked below)
    if (v070 && !lineProblem && !il && unbilled.includes(j)) continue
    if (lineProblem || !il) {
      claims.push(insufficient(`ap.line[${L}].quantity`, `line[${L}].quantity`, 'AP_QTY_RECEIVED', 'Billed units were received', 'AMBIGUOUS_REFERENCE', lineProblem ?? `no invoice line matched PO line ${L}`))
      claims.push(insufficient(`ap.line[${L}].price`, `line[${L}].unit_price`, 'AP_PRICE_PO', 'Unit price within PO tolerance', 'AMBIGUOUS_REFERENCE', lineProblem ?? `no invoice line matched PO line ${L}`))
      if (lineMath) claims.push(amountInsufficient(L, 'AMBIGUOUS_REFERENCE', lineProblem ?? `no invoice line matched PO line ${L}`))
      continue
    }
    if (!rl) {
      claims.push(insufficient(`ap.line[${L}].quantity`, `line[${L}].quantity`, 'AP_QTY_RECEIVED', 'Billed units were received', 'REFERENCE_NOT_PROVIDED', `no goods-receipt line for PO line ${L}`))
    } else {
      const ok = il.qty <= rl.received
      claims.push({ claim_id: `ap.line[${L}].quantity`, kind: 'CROSS_REFERENCE', tier: 'DETERMINISTIC', outcome: ok ? 'PASS' : 'FAIL', field: `line[${L}].quantity`, asserted: il.qty,
        rule_id: 'AP_QTY_RECEIVED', rule_name: 'Billed units were received',
        computation: { formula: 'invoice.qty ≤ receipt.received', operands: { invoiced: il.qty, received: rl.received }, result: rl.received },
        evidence: [ev('invoice', il.span, il.qty, 'OPERAND'), ev('goods_receipt', rl.span, rl.received, 'REFERENCE')], locked: true,
        ...(ok ? {} : { variance: il.qty - rl.received }),
        explanation: `${pl.name}: billed ${il.qty}, received ${rl.received}${ok ? '' : ' — more billed than received'}. (Invoice line "${il.name}".)` })
    }
    const max = pl.unit * (1 + tolP)
    const okP = il.unit <= max + 1e-9
    claims.push({ claim_id: `ap.line[${L}].price`, kind: 'CROSS_REFERENCE', tier: 'DETERMINISTIC', outcome: okP ? 'PASS' : 'FAIL', field: `line[${L}].unit_price`, asserted: il.unit,
      rule_id: 'AP_PRICE_PO', rule_name: 'Unit price within PO tolerance',
      computation: { formula: `invoice.unit ≤ po.unit × ${1 + tolP}`, operands: { invoiced: il.unit, po_unit: pl.unit }, result: round2(max * 10000) / 10000, tolerance: { rel: tolP } },
      evidence: [ev('invoice', il.span, il.unit, 'OPERAND'), ev('purchase_order', pl.span, pl.unit, 'REFERENCE')], locked: true,
      ...(okP ? {} : { variance: round2(il.unit - pl.unit) }),
      // engine 0.6.0: the tolerance is a parameter (ap --price-tolerance), so the words name it
      explanation: `${pl.name}: invoiced ${il.unit}, PO ${pl.unit} (max ${max.toFixed(4)}${v060 ? ` at the ${Math.round(tolP * 1e6) / 1e4}% price tolerance` : ''})${okP ? '' : ' — over tolerance'}.` })
    if (!lineMath) continue
    // The line's own arithmetic, in the currency named on the PO line (its minor unit is the tolerance).
    const currency = docs.purchase_order.slice(pl.span.start, pl.span.end).match(/\bunit\s*([A-Z]{3})\b/)?.[1] ?? null
    const digits = minorUnitDigits(currency)
    const m = recomputeLine({ quantity: il.qty, unit_price: il.unit, amount: il.amount, minor_digits: digits })
    if (!m.ok) { claims.push(amountInsufficient(L, m.reason, m.detail)); continue }
    const lineText = docs.invoice.slice(il.span.start, il.span.end)
    const marker = m.outcome === 'FAIL' ? adjustmentMarker(lineText) : null
    if (marker) {
      claims.push(amountInsufficient(L, 'AMBIGUOUS_FIELD', `${pl.name}: ${il.qty} × ${il.unit} = ${m.recomputed_text} but the line says ${il.amount}, and the line carries an adjustment ("${marker}") that quantity × unit price does not model; not guessing a FAIL`))
      continue
    }
    const okA = m.outcome === 'PASS'
    claims.push({ claim_id: `ap.line[${L}].amount`, kind: 'RECOMPUTE', tier: 'DETERMINISTIC', outcome: m.outcome, field: `line[${L}].amount`, asserted: il.amount,
      rule_id: AP_LINE_MATH_RULE.id, rule_name: AP_LINE_MATH_RULE.name,
      computation: { formula: AP_LINE_MATH_RULE.formula, operands: { quantity: il.qty, unit_price: il.unit, exact_product: m.exact_product, ...(currency ? { currency } : {}), minor_unit_digits: digits }, result: m.recomputed, tolerance: { abs: m.tolerance } },
      evidence: [ev('invoice', il.span, il.amount, 'OPERAND'), ev('invoice', il.span, il.qty, 'OPERAND'), ev('invoice', il.span, il.unit, 'OPERAND'), ...(currency ? [ev('purchase_order', pl.span, currency, 'CONTEXT')] : [])],
      locked: true, ...(okA ? {} : { variance: m.variance }),
      explanation: okA
        ? `${pl.name}: ${il.qty} × ${il.unit} = ${m.exact_product}; the line says ${il.amount}${m.deviation > 0 ? ` (within one minor unit, ${m.tolerance}: rounding)` : ''}. (Invoice line "${il.name}".)`
        : `${pl.name}: ${il.qty} × ${il.unit} = ${m.recomputed_text}, but the line says ${il.amount} (${m.variance > 0 ? 'over' : 'under'} by ${m.variance_text.replace(/^-/, '')}). (Invoice line "${il.name}".)` })
  }

  // --- claims: invoice lines that match no PO line (engine 0.7.0): can't-tell, naming the line and its nearest PO line --------
  const billLines: { prefix: string; name: string | null }[] = []
  if (v070 && !lineProblem) {
    for (const u of unmatched) {
      const il = inv.lines[u.i]!
      const n = u.i + 1
      const prefix = `ap.bill_line[${n}]`
      const near = u.nearest === null ? null : po.lines[u.nearest]!
      const detail = !near
        ? `invoice line ${il.span.line}, "${il.name}", matches no purchase-order line (the purchase order has ${po.lines.length === 1 ? 'one line' : `${po.lines.length} lines`}, each billed by another line of this bill): a person reads it before the bill is paid`
        : u.why === 'item'
          ? `invoice line ${il.span.line}, "${il.name}", does not name the item of purchase-order line ${near.index}, "${near.name}" (the item word "${u.item}" is not on it): a person confirms which purchase-order line it bills before the bill is paid`
          : `invoice line ${il.span.line}, "${il.name}", matches purchase-order line ${near.index}, "${near.name}", too weakly to check (score ${u.score}): a person confirms which purchase-order line it bills before the bill is paid`
      const e = [ev('invoice', il.span, il.name, 'CONTEXT'), ...(near ? [ev('purchase_order', near.span, near.name, 'CONTEXT')] : [])]
      claims.push({ ...insufficient(`${prefix}.quantity`, `bill_line[${n}].quantity`, 'AP_QTY_RECEIVED', 'Billed units were received', 'AMBIGUOUS_REFERENCE', detail), evidence: e })
      claims.push({ ...insufficient(`${prefix}.price`, `bill_line[${n}].unit_price`, 'AP_PRICE_PO', 'Unit price within PO tolerance', 'AMBIGUOUS_REFERENCE', detail), evidence: e })
      if (lineMath) claims.push({ ...insufficient(`${prefix}.amount`, `bill_line[${n}].amount`, AP_LINE_MATH_RULE.id, AP_LINE_MATH_RULE.name, 'AMBIGUOUS_REFERENCE', detail), kind: 'RECOMPUTE', evidence: e })
      billLines.push({ prefix, name: il.name })
    }
    for (const j of unbilled) {
      const pl = po.lines[j]!
      not_checked.push(unmatched.length
        ? `PO line ${pl.index} (${pl.name}) was not matched to a line of this bill: nothing was checked against it`
        : `PO line ${pl.index} (${pl.name}) is not billed on this bill: nothing to check against it`)
    }
  }

  // --- claim: total -------------------------------------------------------------------------------
  const totalVals = [...new Set(inv.totals.map((t) => round2(t.value)))]
  if (inv.ambiguousTotal) {
    claims.push({ ...insufficient('ap.total', 'total', 'AP_TOTAL_SUM', 'Stated total equals the lines (+ allowed freight)', 'UNPARSEABLE',
      `the total is written with a space inside the number ("${inv.ambiguousTotal.slice(0, 80)}") and no currency marker in front of it — it could be read two ways; not guessing`), kind: 'RECOMPUTE' })
  } else if (totalVals.length !== 1) {
    claims.push({ ...insufficient('ap.total', 'total', 'AP_TOTAL_SUM', 'Stated total equals the lines (+ allowed freight)', totalVals.length ? 'AMBIGUOUS_FIELD' : 'FIELD_MISSING', totalVals.length ? `several different stated totals (${totalVals.join(', ')})` : 'no stated total found'), kind: 'RECOMPUTE' })
  } else if (inv.unclassified.length) {
    const u = inv.unclassified[0]!
    claims.push({ ...insufficient('ap.total', 'total', 'AP_TOTAL_SUM', 'Stated total equals the lines (+ allowed freight)', 'AMBIGUOUS_FIELD',
      `an amount on the invoice (${u.value}, in "${u.text.slice(0, 80)}") is not a line item, the total, freight, or a known stray — cannot tell whether it belongs in the total`), kind: 'RECOMPUTE' })
  } else if (inv.freight.length > 1) {
    claims.push({ ...insufficient('ap.total', 'total', 'AP_TOTAL_SUM', 'Stated total equals the lines (+ allowed freight)', 'AMBIGUOUS_FIELD', 'several freight amounts'), kind: 'RECOMPUTE' })
  } else if (inv.tax.length > 1) {
    // engine 0.7.0 (only it reads tax lines)
    claims.push({ ...insufficient('ap.total', 'total', 'AP_TOTAL_SUM', 'Stated total equals the lines (+ allowed freight)', 'AMBIGUOUS_FIELD', `several tax lines (${inv.tax.map((t) => `invoice line ${t.span.line}`).join(', ')}): cannot tell which is the bill's tax`), kind: 'RECOMPUTE' })
  } else if (inv.freight.length && po.freightAllowed === null && !freightByPolicy) {
    claims.push({ ...insufficient('ap.total', 'total', 'AP_TOTAL_SUM', 'Stated total equals the lines (+ allowed freight)', 'AMBIGUOUS_UNIT', 'freight billed but the PO does not say whether freight is allowed'), kind: 'RECOMPUTE' })
  } else if (v030 && inv.lines.length && subtotalOff(inv.subtotals, inv.lines, inv.freight, tolT)) {
    // ruleset 0.3.0: a subtotal line that is not the lines' sum (nor the lines plus freight) means a line was misread, or the
    // bill's own arithmetic is off; which, the reading cannot tell, so a person decides, both figures named
    const s = subtotalOff(inv.subtotals, inv.lines, inv.freight, tolT)!
    claims.push({ ...insufficient('ap.total', 'total', 'AP_TOTAL_SUM', 'Stated total equals the lines (+ allowed freight)', 'AMBIGUOUS_FIELD',
      `the subtotal line (invoice line ${s.span.line}, "${s.text.slice(0, 80)}") says ${moneyWords(s.value, minorUnitDigits(null))}, but the lines read add to ${moneyWords(round2(inv.lines.reduce((a, l) => a + l.amount, 0)), minorUnitDigits(null))}: a line may have been misread, or the bill's own arithmetic is off; cannot tell which`), kind: 'RECOMPUTE',
      evidence: [ev('invoice', s.span, s.value, 'OPERAND'), ...inv.lines.map((l) => ev('invoice', l.span, l.amount, 'OPERAND'))] })
  } else if (!inv.lines.length) {
    claims.push({ ...insufficient('ap.total', 'total', 'AP_TOTAL_SUM', 'Stated total equals the lines (+ allowed freight)', 'UNPARSEABLE', 'no invoice lines could be read'), kind: 'RECOMPUTE' })
  } else {
    const stated = inv.totals[0]!
    // engine 0.6.0: freight on a PO that does not say is allowed when the run's freight policy says so
    const byPolicy = freightByPolicy && po.freightAllowed === null && inv.freight.length > 0
    const allowed = po.freightAllowed ?? (byPolicy ? true : null)
    const freight = inv.freight.length && allowed ? inv.freight[0]!.value : 0
    // engine 0.7.0: a tax line is added into the total, as the structured path adds bill.tax (whether it is due is the tax check's)
    const tax = inv.tax.length ? inv.tax[0]!.value : 0
    const sum = round2(inv.lines.reduce((s, l) => s + l.amount, 0) + freight + tax)
    const ok = close(round2(stated.value), sum, tolT)
    const evidence: Evidence[] = [ev('invoice', stated.span, stated.value, 'OPERAND'), ...inv.lines.map((l) => ev('invoice', l.span, l.amount, 'OPERAND'))]
    if (inv.freight.length) evidence.push(ev('invoice', inv.freight[0]!.span, inv.freight[0]!.value, allowed ? 'OPERAND' : 'CONTEXT'))
    if (inv.tax.length) evidence.push(ev('invoice', inv.tax[0]!.span, inv.tax[0]!.value, 'OPERAND'))
    // ruleset 0.3.0: a subtotal line that is the lines' sum is read as such, shown as context, and said
    for (const s of inv.subtotals) evidence.push(ev('invoice', s.span, s.value, 'CONTEXT'))
    const subtotalNote = inv.subtotals.length ? ` The subtotal line${inv.subtotals.length === 1 ? '' : 's'} (${inv.subtotals.map((s) => moneyWords(s.value, minorUnitDigits(null))).join(', ')}) ${inv.subtotals.length === 1 ? 'is' : 'are'} the lines' sum${inv.subtotals.some((s) => inv.freight.length && !close(round2(s.value), round2(inv.lines.reduce((a, l) => a + l.amount, 0)), tolT)) ? ' with freight' : ''}.` : ''
    claims.push({ claim_id: 'ap.total', kind: 'RECOMPUTE', tier: 'DETERMINISTIC', outcome: ok ? 'PASS' : 'FAIL', field: 'total', asserted: stated.value,
      rule_id: 'AP_TOTAL_SUM', rule_name: 'Stated total equals the lines (+ allowed freight)',
      computation: { formula: inv.tax.length ? 'total = Σ line.amount + (freight if PO allows) + tax' : 'total = Σ line.amount + (freight if PO allows)', operands: { lines: round2(sum - freight - tax), freight, freight_allowed: po.freightAllowed, ...(inv.tax.length ? { tax } : {}), ...(byPolicy ? { freight_policy: 'allow' } : {}) }, result: sum, tolerance: { abs: tolT } },
      evidence, locked: true, ...(ok ? {} : { variance: round2(stated.value - sum) }),
      // engine 0.6.0: in a clerk's words, never one number twice (./words.ts totalWords)
      explanation: v060
        ? totalWords({ stated: stated.value, lines: round2(sum - freight - tax), sum, ok, freight: inv.freight.length ? inv.freight[0]!.value : null, freightAllowed: allowed, ...(byPolicy ? { freightBy: 'policy' as const } : {}), ...(inv.tax.length ? { tax } : {}), digits: minorUnitDigits(null) }) + subtotalNote
        : `Stated total ${stated.value}; lines ${round2(sum - freight)}${inv.freight.length ? `, freight ${inv.freight[0]!.value} ${po.freightAllowed ? 'allowed' : 'NOT allowed (excluded)'}` : ''} = ${sum}.${ok ? '' : ' Does not add up.'}` })
  }

  // --- claim: tax (engine 0.7.0; ./tax.ts): only when the bill carries one tax line ------------------------------------------
  // checked to the cent against the rate the purchase order states ("Tax: 8.25%"), as the structured path checks bill.tax; a
  // purchase order that states none sends the bill to a person ("tax line present, PO states no rate")
  const taxRan = v070 && inv.tax.length === 1
  if (taxRan) {
    const t = inv.tax[0]!
    claims.push(taxClaim({
      tax: t.value, rate: po.taxRate?.value ?? null,
      lines: inv.lines.map((l) => ({ amount: l.amount, taxable: true })),
      minor_digits: minorUnitDigits(null),
      taxEvidence: ev('invoice', t.span, t.value, 'OPERAND'),
      rateEvidence: po.taxRate ? ev('purchase_order', po.taxRate.span, po.taxRate.value, 'REFERENCE') : null,
      lineEvidence: inv.lines.map((l) => ev('invoice', l.span, l.amount, 'OPERAND')),
      textLine: { line: t.span.line, text: t.text },
    }))
  }

  // --- claim: PO balance (engine 0.6.0; only with payment history: ./po-balance.ts) -------------------------
  if (v060 && history) {
    if (!po.number) {
      claims.push(insufficient('ap.po_balance', 'po_balance', 'AP_PO_BALANCE', 'Billed to date within the purchase order', 'UNPARSEABLE', 'the purchase order number could not be read, so what is already booked on the order cannot be counted'))
    } else {
      const currencyOf = (pl: (typeof po.lines)[number]): string | null => docs.purchase_order.slice(pl.span.start, pl.span.end).match(/\bunit\s*([A-Z]{3})\b/)?.[1] ?? null
      const curs = [...new Set(po.lines.map(currencyOf))]
      const orderCurrency = curs.length === 1 ? curs[0]! : null
      claims.push(poBalanceClaim({
        po_number: po.number.value, invoice_number: inv.invoiceNumber?.value ?? null,
        order_lines: po.lines.map((pl) => ({ total: pl.qty * pl.unit })),
        order_currency: orderCurrency,
        order_evidence: po.lines.flatMap((pl) => [ev('purchase_order', pl.span, pl.qty, 'REFERENCE'), ev('purchase_order', pl.span, pl.unit, 'REFERENCE')]),
        bill_amounts: inv.lines.map((l) => l.amount),
        bill_currency: null,
        bill_evidence: inv.lines.map((l) => ev('invoice', l.span, l.amount, 'OPERAND')),
        history,
        historyEvidence: (i) => ({ locator: { kind: 'field', source: 'history', path: `history[${i}]` }, value: history[i]!.invoice_number, confidence: 100, role: 'REFERENCE' }),
        historyPointer: (i, f) => `history[${i}].${f === 'po_number' ? 'po_number' : 'total'}`,
        vendor: { name: vendor, ids: [], tax_ids: [] },
        minor_digits: minorUnitDigits(orderCurrency),
        tolerance: tolT,
      }))
      // 2026-10-05: an earlier bill on this order is netted by amount only; the answer says so where it applies
      const gap = perLineGapNote(po.number.value, bookedOnOrder({ po_number: po.number.value, invoice_number: inv.invoiceNumber?.value ?? null, history, vendor: { name: vendor, ids: [], tax_ids: [] } }))
      if (gap) not_checked.push(gap)
    }
  } else if (v060) not_checked.push(`${PO_BALANCE_NOT_RUN} (pass history to enable it)`)

  // --- verdict ------------------------------------------------------------------------------------
  const coverage: Coverage = { claims_total: claims.length, claims_checked: 0, claims_pass: 0, claims_fail: 0, claims_insufficient: 0 }
  for (const c of claims) { if (c.outcome === 'PASS') coverage.claims_pass++; else if (c.outcome === 'FAIL') coverage.claims_fail++; else coverage.claims_insufficient++ }
  coverage.claims_checked = coverage.claims_pass + coverage.claims_fail
  // verify's aggregation, unchanged: FAIL if any claim FAILs; else INSUFFICIENT_DATA if nothing could run; else PASS.
  // (The POLICY decision below is stricter: it never approves past an undecided check.)
  const outcome: Outcome = coverage.claims_fail > 0 ? 'FAIL' : coverage.claims_checked === 0 ? 'INSUFFICIENT_DATA' : 'PASS'
  // 2026-10-05: the resolved policy (a default one is exactly { price_tolerance, total_tolerance }, as before)
  const input_hash = hashOf({ ap: docs, policy: pol })
  // Engine 0.2.0: the id also binds the remedy table (protocol/verdict-id.ts verdictIdentity); engine 0.6.0 answers from its own.
  const remedies = apRemediesFor(engine_version)
  const { verdict_id, remedy_table_hash } = verdictIdentity(input_hash, ruleset, engine_version, remedies)
  const verdict: Verdict = {
    schema_version: SCHEMA_VERSION, verdict_id, issued_at: (options.now ?? (() => new Date()))().toISOString(), engine_version,
    ruleset: { ...ruleset }, input_hash, ...(remedy_table_hash !== undefined ? { remedy_table_hash } : {}), replayable: true,
    document: { extraction_hash: sha256(docs.invoice), ...(options.producer !== undefined ? { producer: options.producer } : {}), line_items: inv.lines.length },
    references: { contract: true, evidence: 1, history: history?.length ?? 0, source: true },
    outcome, aggregation: 'ANY_FAIL_FAILS', claims, coverage,
  }
  // Typed remedies for every non-PASS claim, outside the hashed core (verdict/remedy.ts): the verdict_id above is unchanged.
  attachScope(attachRemedies(verdict, { declared: (rule) => remedies[rule], document: 'invoice' }))

  // --- policy decision: checks in order, stop at first failure, abstain if an earlier check is undecided (./decide.ts) --------
  return apPolicyDecision({
    verdict, claims, coverage, history: Boolean(history), lineMath, not_checked,
    // engine 0.6.0: the PO balance check is the last in order (./decide.ts), so a hold on any other check wins
    ...(v060 && history ? { poBalance: true } : {}),
    // engine 0.6.0: the vendor check, when the PO names a vendor
    ...(vendorRan ? { vendor: true } : {}),
    // engine 0.6.0: the payment-details check, when the bill's text carries payment details, and what an approve
    // did not check, said under "Not checked" (the vendor's identity beyond the match, the bank details, tax)
    ...(remittanceRan ? { remittance: true } : {}),
    // engine 0.7.0: the tax check, when the bill carries a tax line, after the vendor check (a stated rate of 0 holds as hold_total)
    ...(taxRan ? { tax: true } : {}),
    // ruleset 0.4.0: the approve says what its readings read (the Reply-To, the opening step, the spelled reading)
    ...(v040 ? { approveScope: [
      ...(vendorMatched ? [textVendorNotChecked040(vendorMatched, docs.invoice)] : []),
      bankNotCheckedText040(standing, mentions),
      ...(taxRan ? [] : [taxNotCheckedText070(po.taxRate?.value ?? null)]),
      TEXT_PATH_NOT_CHECKED,
    ] } : v070 ? { approveScope: [
      ...(vendorMatched ? [textVendorNotChecked(vendorMatched)] : []),
      // ruleset 0.3.0: "none was found" only when no sentence names payment; otherwise each is named with how it was read
      v030 ? bankNotCheckedText030(standing, mentions) : bankNotCheckedText070(standing),
      ...(taxRan ? [] : [taxNotCheckedText070(po.taxRate?.value ?? null)]),
      TEXT_PATH_NOT_CHECKED,
    ] } : v060 ? { approveScope: [
      ...(vendorMatched ? [textVendorNotChecked(vendorMatched)] : []),
      BANK_NOT_CHECKED_TEXT,
      TAX_NOT_CHECKED_TEXT,
    ] } : {}),
    // engine 0.7.0: an approve of a partial bill says so
    ...(v070 && !lineProblem && unbilled.length && !unmatched.length
      ? { approveNotes: [`partial: ${po.lines.length - unbilled.length} of ${po.lines.length} purchase-order lines billed; ${unbilled.length} line${unbilled.length === 1 ? '' : 's'} open`] } : {}),
    // engine 0.7.0: the lines in order are the PO lines this bill bills, then its lines that match none
    lines: v070 && !lineProblem
      ? [...po.lines.filter((_, j) => !unbilled.includes(j)).map((pl) => ({ prefix: `ap.line[${pl.index}]`, name: pl.name })), ...billLines]
      : po.lines.map((pl) => ({ prefix: `ap.line[${pl.index}]`, name: pl.name })),
    invoice_number: inv.invoiceNumber?.value ?? null,
    po_number: inv.poNumbers.length === 1 ? inv.poNumbers[0]!.value : null,
    approveReason: history ? 'all checks passed, including the duplicate check' : lineMath ? 'all five checks passed' : 'all four checks passed',
    ...(v060 && !history ? { openReason: `${NO_HISTORY_DETAIL} (pass history to enable it)` } : {}),
    // engine 0.6.0: never approve past a check that could not run; every abstain is payable false (./decide.ts)
    ...(v060 ? { failClosed: true } : {}),
  })
}
