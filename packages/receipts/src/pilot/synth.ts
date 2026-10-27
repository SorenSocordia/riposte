/**
 * A synthetic month in Ramp's export shapes (Bill, ApiPurchaseOrderResource, ApiItemReceiptResource; money as CurrencyAmount
 * in minor units), with planted mismatches, for the pilot's dry run and its tests (2026-10-03). SYNTHETIC: every vendor,
 * item and number is made up, and the plants are written to a separate truth file, never into the export.
 *
 * Plants: price over the PO by 3-8% · quantity over what was received · a line whose amount is not quantity × price · a total
 * that is not the sum of the lines · a repeat of a bill already paid (same vendor, invoice number and total) · a PO line never
 * received · a bill with no PO linked · a bill in another currency than its PO. Clean bills bill exactly what was ordered and
 * received. The buyer's own decisions are planted too: most clean bills paid, some held or still open; most planted bills
 * held, some paid (the buyer missed them).
 *
 * THE VENDOR-NAME VARIANT (2026-10-05: "the synthetic pilot's planted duplicates all share a vendor name, so it
 * never tests this"). `duplicate_vendor_variant`: a repeat of a bill already paid, same invoice number, same PO, same lines
 * and total, billed by a second vendor record whose name is a variant of the first ("…, Inc.", "… LLC", or a punctuation
 * change). Two vendor-master records for one supplier is the classic way a duplicate gets paid. About half of the planted
 * repeats are variants. Which ones, and the variant's wording, come from a second generator seeded from the same seed, so the
 * main stream is untouched: every bill of every seed is what it was before, except that some plain repeats now carry the
 * variant vendor. The truth file names the original bill, both vendor names and the expected decision (hold_duplicate).
 *
 * THE NEAR-MATCH VENDOR (2026-10-05: "a one-letter typo or a DBA name ... the synthetic month plants only
 * suffix and punctuation variants, which is exactly what the matcher handles, so its perfect score cannot show this gap").
 * `duplicate_near_match`: a repeat of a bill already paid (the same invoice number) billed by a second vendor record whose
 * name is a near match, not a suffix variant: a one-edit typo ("Sumit Electrical Supply" for "Summit Electrical Supply"),
 * one word abbreviated ("Summit Elec. Supply"), or a d/b/a name ("Northfield d/b/a NMH" for "Northfield Material Handling").
 * Half of them repeat the original's PO, lines and total; the other half (`other_po`) bill this row's own PO, lines and total,
 * which check out on their own, so only the duplicate check can catch them: the case that used to be paid (2026-10-05:
 * "a typo'd vendor with a different PO and total gets paid"). The right answer is not to pay it automatically: hold it as a
 * duplicate, or send it to a person, clearable only at the controller's rung (`clear_by`). It is chosen from a third stream
 * among the plain repeats the variant stream left alone, so the main stream and the variant stream are untouched: every
 * other bill of every seed is what it was before. (An `other_po` repeat keeps its row's PO and receipt in the export, where a
 * plain repeat drops them.)
 *
 * PAY APPLICATIONS (the same round). With `payApps: n`, the export also holds pay_applications/: for each of n contracts,
 * last month's G702/G703 and this month's, in the shape of packages/verify docs/examples/payapp-g702-g703.json, plus
 * decisions.csv. About half of this month's carry a planted error, each the kind a cold reader in the controller's role planted by hand in cold review round 2:
 * a shifted "previous" (continuity with last month), a payment due off by a round amount, and a line billed past its
 * scheduled value with the totals carried through. They come from a fourth stream: the bills do not change.
 *
 * THE APPENDED CLASSES (2026-10-05: "it plants only classes the gate checks ... 67 of 67 caught is a mirror").
 * Four bill classes the earlier checks never looked at, and one pay-application class, each appended after the main month
 * from its own stream, so every bill and application above is what it was before (`appended: false` leaves them out):
 *   vendor_mismatch                a bill from another vendor than the one its PO names (Ramp: the bill's vendor.id is not the
 *                                  PO's vendor_id); a person decides
 *   tax_on_untaxed_po              a "Sales tax" line on a PO with no tax terms; a person decides
 *   freight_po_silent              a "Freight" line on a PO that does not say whether freight is allowed; a person decides
 *                                  under the default freight rule, and the bill pays under a run that froze "allow"
 *                                  (by_freight_rule; the score reads the run's rule)
 *   line_overbilled_across_bills   an earlier paid bill billed all of PO line 1; this bill bills part of line 1 again while
 *                                  the order as a whole has room. Over-billing: hold. A gap the check states (PLANT_GAP), so the
 *                                  score marks it.
 *   payapp_retainage_under         this month's application states 10% retainage and every line withholds 5%, the totals
 *                                  carried through; a person decides
 * Ramp's Bill has no tax or freight field: tax and freight arrive as an expense line (Bill.line_items) with no PO line, beside
 * the inventory lines. The mapper reads every line; one such line whose whole memo names a freight charge is the bill's freight, and any
 * other (the tax line here) is a line no PO line matches. About one bill per class per 100 bills (at least one), so the month
 * holds a few more bills than --bills; one appended contract per 8 pay applications (at least one).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type Plant = 'price_over' | 'quantity_over' | 'line_math' | 'total_mismatch' | 'duplicate' | 'duplicate_vendor_variant' | 'duplicate_near_match' | 'not_received' | 'no_po' | 'currency'
  | 'vendor_mismatch' | 'tax_on_untaxed_po' | 'freight_po_silent' | 'line_overbilled_across_bills'
  | 'duplicate_leading_zero' | 'tax_at_rate' | 'tax_off_rate'
/** The plants the main stream picks from (its order is part of every seed's month: never reorder or extend it). */
const PICKED: readonly Plant[] = ['price_over', 'quantity_over', 'line_math', 'total_mismatch', 'duplicate', 'not_received', 'no_po', 'currency']
/**
 * The classes the gate's earlier checks never looked at (2026-10-05: "it plants only classes the gate checks
 * ... 67 of 67 caught is a mirror"). Appended bills from their own stream (synthMonth), so the main month is untouched.
 */
export const APPENDED_PLANTS: readonly Plant[] = ['vendor_mismatch', 'tax_on_untaxed_po', 'freight_po_silent', 'line_overbilled_across_bills']
/**
 * The classes appended on 2026-10-06 (the checks the gate gained that day), after every bill above and from their own stream:
 *   duplicate_leading_zero   a paid bill re-sent with a leading zero in its invoice number ("NOR-010345" for "NOR-10345"), same
 *                            vendor, PO, lines and total; a person decides (or a hold), clearable by an AP clerk
 *   tax_at_rate              a "Sales tax" line at exactly 8.25% of the lines on a PO with no tax terms: a person under the
 *                            default tax rule, a good bill under "allow" or "rate:8.25%" (by_tax_rule)
 *   tax_off_rate             the same at 9.5%: a person under "person" and "rate:8.25%", a good bill under "allow"
 */
export const APPENDED_LATER_PLANTS: readonly Plant[] = ['duplicate_leading_zero', 'tax_at_rate', 'tax_off_rate']
export const PLANTS: readonly Plant[] = [...PICKED, 'duplicate_vendor_variant', 'duplicate_near_match', ...APPENDED_PLANTS, ...APPENDED_LATER_PLANTS]
/** The tax rate the tax plants are written against: the run's rule "rate:8.25%" (2026-10-06). */
export const SYNTH_TAX_RATE = 0.0825
/**
 * What the checker should say for each plant (no_po: the bill cannot be checked; not_received: no receipt line names the PO
 * line, so the received quantity is unknown; currency: the price check cannot run; duplicate_near_match: a duplicate, so
 * hold_duplicate, and a person's abstain is also acceptable (PLANT_ACCEPTS); paying it is the failure).
 */
export const PLANT_EXPECTED: Record<Plant, string> = {
  price_over: 'hold_price', quantity_over: 'hold_quantity', line_math: 'hold_line_math', total_mismatch: 'hold_total', duplicate: 'hold_duplicate', duplicate_vendor_variant: 'hold_duplicate', duplicate_near_match: 'hold_duplicate', not_received: 'abstain', no_po: 'not checked', currency: 'abstain',
  // the appended classes: what a careful clerk does with each. A bill from another vendor than the PO's, tax the PO carries
  // no terms for, and freight on a PO that does not say whether it is allowed each go to a person; a line billed again after
  // an earlier bill on the same PO already billed all of it is over-billing, held as a quantity problem.
  vendor_mismatch: 'abstain', tax_on_untaxed_po: 'abstain', freight_po_silent: 'abstain', line_overbilled_across_bills: 'hold_quantity',
  // 2026-10-06: a re-sent invoice number that differs only by a leading zero is a duplicate a person confirms; tax on a PO with
  // no tax terms goes to a person under the default tax rule (by_tax_rule says what each other rule makes of it)
  duplicate_leading_zero: 'abstain', tax_at_rate: 'abstain', tax_off_rate: 'abstain',
}
/** The checker decisions that count as right for a plant, when more than PLANT_EXPECTED's one does. */
export const PLANT_ACCEPTS: Partial<Record<Plant, readonly string[]>> = {
  duplicate_near_match: ['hold_duplicate', 'abstain'], line_overbilled_across_bills: ['hold_quantity', 'hold_total', 'abstain'],
  // the repeat bills the same PO as the paid original, so the order's balance may hold it first: any of these keeps it unpaid
  duplicate_leading_zero: ['abstain', 'hold_duplicate', 'hold_total'],
}
/**
 * A gap the check states it has, by plant: the truth file says it, and the score marks the class, so a bill the gate would pay
 * there reads as the disclosed gap it is, not as a surprise.
 */
export const PLANT_GAP: Partial<Record<Plant, string>> = {
  line_overbilled_across_bills: 'the PO balance check nets amounts on the order, not quantities on a line (AP-INPUT.md), so a line billed twice while the order as a whole has room is not caught',
}
/** The rung that may clear a plant, when the truth file names one: a near-match duplicate is the controller's call. */
export const PLANT_CLEAR_BY: Partial<Record<Plant, string>> = { duplicate_near_match: 'ap-controller', duplicate_leading_zero: 'ap-clerk' }

/**
 * What a correct check says about a tax plant under each tax rule a run can freeze (2026-10-06), keyed as the flag writes it:
 * "person" (the default: a person decides), "allow" (tax as billed is accepted), "rate:8.25%" (checked against 8.25% of the
 * lines to the cent, as the gate checks it: within rounding, one cent per taxable line, the bill pays, else a person decides;
 * the price tolerance is for prices, never tax). The score reads the run's rule; a rule not listed keeps `expected`.
 */
export function taxRuleAnswers(taxCents: number, linesCents: number, taxableLines = 1): Record<string, string> {
  const expectedCents = Math.round(linesCents * SYNTH_TAX_RATE)
  const within = Math.abs(taxCents - expectedCents) <= Math.max(taxableLines, 1)
  return { person: 'abstain', allow: 'approve', 'rate:8.25%': within ? 'approve' : 'abstain' }
}

/** The kinds of near match a second vendor record carries. */
export type NearKind = 'typo' | 'abbreviation' | 'dba'
/** Common business abbreviations, for the abbreviation kind ("Summit Elec. Supply"). */
const ABBREVIATIONS: Record<string, string> = {
  Electrical: 'Elec.', Electric: 'Elec.', Supply: 'Sup.', Industrial: 'Ind.', Material: 'Matl.', Products: 'Prods.', Packaging: 'Pkg.',
  Wholesale: 'Whse.', Hydraulics: 'Hydr.', Handling: 'Hdlg.', Tooling: 'Tlg.', Safety: 'Sfty.', Office: 'Ofc.', Abrasives: 'Abras.',
  Cable: 'Cbl.', Glass: 'Gl.', Fastener: 'Fstnr.',
}

/**
 * A near-match of a vendor name, as a second vendor record might carry it: a one-edit typo ("Sumit Electrical Supply"), one
 * word abbreviated ("Summit Elec. Supply"), or a d/b/a name ("Northfield d/b/a NMH"). A third each, by `r`.
 */
export function vendorNearMatch(name: string, r: number): { kind: NearKind; name: string } {
  const words = name.split(/\s+/)
  if (r >= 1 / 3 && r < 2 / 3) {
    // one word after the first abbreviated: the first with a common abbreviation, else the first long one cut to four letters
    let j = words.findIndex((w, k) => k > 0 && ABBREVIATIONS[w] !== undefined)
    if (j < 0) j = words.findIndex((w, k) => k > 0 && w.length > 5)
    if (j < 0) j = 0
    const short = ABBREVIATIONS[words[j]!] ?? `${words[j]!.slice(0, 4)}.`
    return { kind: 'abbreviation', name: words.map((w, k) => (k === j ? short : w)).join(' ') }
  }
  if (r < 1 / 3) {
    // a one-edit typo in the first word: a doubled letter written once ("Summit" → "Sumit"), else its last two letters swapped
    const w = words[0]!
    const dbl = /([a-z])\1/i.exec(w)
    const typo = dbl ? `${w.slice(0, dbl.index)}${w.slice(dbl.index + 1)}` : `${w.slice(0, -2)}${w.slice(-1)}${w.slice(-2, -1)}`
    return { kind: 'typo', name: [typo, ...words.slice(1)].join(' ') }
  }
  const initials = words.filter((x) => /^[A-Za-z]/.test(x) && !/^(co\.?|inc\.?|llc|and)$/i.test(x)).map((x) => x[0]!.toUpperCase()).join('')
  return { kind: 'dba', name: `${words[0]} d/b/a ${initials}` }
}

/** The planted pay-application errors (this month's application only), and (2026-10-06) the legitimate variants a check must pay. */
export type PayAppPlant = 'payapp_continuity' | 'payapp_payment_due' | 'payapp_over_scheduled' | 'payapp_retainage_under'
  | 'payapp_sov_raised' | 'payapp_new_co_line' | 'payapp_stored_formD'
/** The plants the pay-application stream picks from (part of every seed's applications: never reorder or extend it). */
export const PAYAPP_PLANTS: readonly PayAppPlant[] = ['payapp_continuity', 'payapp_payment_due', 'payapp_over_scheduled']
/**
 * Appended contracts (2026-10-05), from their own stream: this month's application states 10% retainage and every
 * line retains 5%, the totals carried through, so the arithmetic holds and only the stated rate shows it.
 */
export const PAYAPP_APPENDED: readonly PayAppPlant[] = ['payapp_retainage_under']
/**
 * What the pay-app check should do with each: the arithmetic or the continuity fails, so the gate holds it; retainage withheld
 * under the stated rate on every line, with no reduced rate stated, goes to a person, naming the dollar difference.
 */
export const PAYAPP_EXPECTED: Record<PayAppPlant | 'clean', 'pay' | 'hold' | 'person'> = {
  payapp_continuity: 'hold', payapp_payment_due: 'hold', payapp_over_scheduled: 'hold', payapp_retainage_under: 'person', clean: 'pay',
  payapp_sov_raised: 'person', payapp_new_co_line: 'pay', payapp_stored_formD: 'pay',
}
/**
 * Appended contracts (2026-10-06), one per class, from their own stream after every contract above:
 *   payapp_sov_raised      one line's scheduled value and the net change orders rise by one amount, with no change-order line
 *                          and no change order stated: a person decides (the owner)
 *   payapp_new_co_line     a new change-order line this month, the net change orders up by its scheduled value: a good
 *                          application, which pays
 *   payapp_stored_formD    materials stored on a line last month and installed this month, column D written as the form's
 *                          own heading has it (last month's D + E, stored materials not included): a good application, which pays
 */
export const PAYAPP_APPENDED_LATER: readonly PayAppPlant[] = ['payapp_sov_raised', 'payapp_new_co_line', 'payapp_stored_formD']

/** A vendor name as a second vendor record might spell it: a company suffix added, or punctuation changed. */
export function vendorVariant(name: string, r: number): string {
  if (r < 1 / 3) return `${name.replace(/[.,]$/, '')}, Inc.`
  if (r < 2 / 3) return `${name.replace(/[.,]$/, '')} LLC`
  return name.endsWith('.') ? name.slice(0, -1) : `${name}.`
}

export interface SynthOptions {
  month: string; bills?: number; seed?: number; plantRate?: number; outsideMonth?: number; /** contracts with pay applications (2026-10-05); none by default */ payApps?: number
  /**
   * the appended classes (2026-10-05): per class, about one bill per 100 of `bills` (at least one), and one more
   * contract per 8 pay applications (at least one when there are any). false leaves them out: the month the generator wrote
   * before, byte for byte.
   */
  appended?: boolean
  /**
   * the classes appended on 2026-10-06 (APPENDED_LATER_PLANTS, PAYAPP_APPENDED_LATER): per bill class, about one bill per 100 of
   * `bills` (at least one), and one contract per pay-application class when there are any. false leaves them out: the month the
   * generator wrote on 2026-10-05, bill for bill (the truth file's tax plants carry by_tax_rule either way).
   */
  appendedLater?: boolean
  /**
   * the export's shape (2026-10-06): 'ramp' (the default: Ramp's JSON resources) or 'generic-csv' (this package's own CSV
   * columns, with the purchase-order column invoiced_quantity, so the billed-to-date check can net a line across bills).
   * Only writeSynthMonth reads it; synthMonth always builds the month in Ramp's shapes.
   */
  format?: 'ramp' | 'generic-csv'
}
export interface SynthTruth {
  synthetic: true; month: string; seed: number; bills: number
  /** the export's shape, when it is not Ramp's (2026-10-06) */
  format?: 'generic-csv'
  /**
   * `variant` on a duplicate_vendor_variant plant: the bill it repeats and both vendor records. `near` on a
   * duplicate_near_match plant: the same, with the kind of near match; `accepts` the decisions that count as right, and
   * `clear_by` the rung that may clear it (2026-10-05).
   */
  planted: Record<string, {
    plant: Plant; expected: string
    variant?: { repeats: string; original_vendor: { id: string; name: string }; variant_vendor: { id: string; name: string } }
    near?: { kind: NearKind; other_po: boolean; repeats: string; original_vendor: { id: string; name: string }; near_vendor: { id: string; name: string } }
    accepts?: readonly string[]; clear_by?: string
    /** vendor_mismatch (2026-10-05): the bill's vendor and the vendor the PO names */
    vendors?: { bill: { id: string; name: string }; purchase_order: { id: string; name: string } }
    /** tax_on_untaxed_po / freight_po_silent: the charge, in major units, as an expense line the PO has no line for */
    charge?: { kind: 'tax' | 'freight'; amount: number; memo: string }
    /** line_overbilled_across_bills: the earlier paid bill on the same PO and line, and the quantities */
    overbill?: { earlier_bill: string; po_line: string; received: number; billed_before: number; billed_now: number }
    /** a gap the check states it has (PLANT_GAP) */
    gap?: string
    /**
     * freight_po_silent: what a correct check says under each freight rule the run can freeze ("person", the default: a
     * person decides; "allow": the freight is added to the total and the bill pays). The score reads the run's rule.
     */
    by_freight_rule?: { person: string; allow: string }
    /** a tax plant (2026-10-06): what a correct check says under each tax rule the run can freeze (taxRuleAnswers) */
    by_tax_rule?: Record<string, string>
    /** duplicate_leading_zero (2026-10-06): the paid bill it repeats, its invoice number, and the number as re-sent */
    repeats?: { bill: string; invoice_number: string; sent_as: string }
  }>
  buyer: Record<string, 'pay' | 'hold' | 'open'>
  /** this month's pay applications, by file name in pay_applications/ (2026-10-05; absent without payApps) */
  pay_apps?: Record<string, {
    plant: PayAppPlant | null; expected: 'pay' | 'hold' | 'person'; buyer: 'pay' | 'hold' | 'open'; previous: string; retainage?: { stated: string; withheld_rate: string; under_by: number }
    /** the appended classes of 2026-10-06: what changed from last month's application, in dollars */
    change?: { line: number; from?: number; to?: number; by?: number; scheduled_value?: number; stored_last_month?: number }
  }>
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

const VENDORS = ['Northfield Material Handling', 'Calder Fastener Supply', 'Brightwater Industrial', 'Okafor Packaging Co.', 'Linden Electrical Wholesale', 'Marrow & Finch Tooling', 'Tessaro Safety Products', 'Quayside Office Supply', 'Halvorsen Hydraulics', 'Pemberton Lab Glass', 'Ridgeway Abrasives', 'Sunderland Cable & Wire']
const ITEMS = ['Extension cord 50 ft, 12 AWG', 'Floor marking tape, yellow', 'Wire shelving unit 48 in', 'Nitrile gloves, box of 100', 'Hex bolt M10 x 40, box of 50', 'Stretch wrap 18 in', 'Safety glasses, clear', 'Copier paper, case', 'Hydraulic hose 1/2 in, 10 ft', 'Beaker 500 ml, pack of 6', 'Flap disc 60 grit', 'THHN wire 12 AWG, 500 ft', 'Pallet jack wheel', 'Cable ties 8 in, pack of 100', 'LED panel 2x4', 'Shop towels, box']

export function synthMonth(o: SynthOptions): { bills: unknown[]; purchase_orders: unknown[]; item_receipts: unknown[]; truth: SynthTruth; vendors: { id: string; name: string }[]; pay_applications?: Record<string, Record<string, unknown>>; pay_decisions?: string } {
  const n = o.bills ?? 300
  const seed = o.seed ?? 7
  const rate = o.plantRate ?? 0.2
  const outside = o.outsideMonth ?? 12
  const rnd = mulberry32(seed)
  const rndVariant = mulberry32((seed ^ 0x5eed0001) >>> 0) // the variant's own stream: the main one is never consumed by it
  const rndNear = mulberry32((seed ^ 0x5eed0002) >>> 0) // the near match's own stream: neither of the others is consumed by it
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!
  const int = (lo: number, hi: number): number => lo + Math.floor(rnd() * (hi - lo + 1))
  const [y, m] = o.month.split('-').map(Number) as [number, number]
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const date = (mm: number, d: number): string => new Date(Date.UTC(y, mm - 1, d)).toISOString().slice(0, 10)
  const cents = (usd: number) => ({ amount: Math.round(usd * 100), currency_code: 'USD', minor_unit_conversion_rate: 100 })
  const id = (p: string, i: number) => `${p}_${String(seed).padStart(2, '0')}${String(i).padStart(5, '0')}`
  const vendors = VENDORS.map((name, i) => ({ id: id('vnd', i), name }))
  const bills: any[] = [], pos: any[] = [], receipts: any[] = []
  const truth: SynthTruth = { synthetic: true, month: o.month, seed, bills: n, planted: {}, buyer: {} }
  const paidBefore: any[] = []
  const total = n + outside
  for (let i = 0; i < total; i++) {
    let variant: SynthTruth['planted'][string]['variant']
    let near: SynthTruth['planted'][string]['near']
    let otherPo = false
    const inMonth = i < n
    let issue = inMonth ? date(m, int(1, days)) : (i % 2 ? date(m - 1, int(1, 28)) : date(m + 1, int(1, 28)))
    const v = pick(vendors)
    const poId = id('po', i)
    const lines = Array.from({ length: int(1, 4) }, (_, j) => { const qty = int(1, 120); const price = Math.round((2.5 + rnd() * 400) * 100) / 100; return { id: id(`pol${j}`, i), external_id: `L${j + 1}`, description: pick(ITEMS), quantity: qty, unit_price: cents(price), amount: cents(qty * price), _price: price, _qty: qty } })
    const poTotal = lines.reduce((s, l) => s + l.amount.amount, 0)
    pos.push({ id: poId, purchase_order_number: `PO-${40000 + i}`, vendor_id: v.id, amount: { amount: poTotal, currency_code: 'USD', minor_unit_conversion_rate: 100 }, line_items: lines.map(({ _price, _qty, ...l }) => l), created_at: `${date(m - 1, int(1, 28))}T09:00:00Z`, receipt_status: 'RECEIVED' })
    let plant: Plant | null = inMonth && rnd() < rate ? pick(PICKED) : null
    // a repeat needs an earlier paid bill it can follow within the month
    const eligible = plant === 'duplicate' ? paidBefore.filter((p) => p.issued_at.slice(0, 10) < date(m, days)) : []
    const original = eligible.length ? pick(eligible) : undefined
    if (plant === 'duplicate' && !original) plant = null
    if (original) { const d0 = Number(original.issued_at.slice(8, 10)); issue = date(m, int(d0 + 1, days)) }
    // receipts: everything ordered is received (before the bill), except a never-received line
    const recLines = lines.filter((_, j) => !(plant === 'not_received' && j === 0)).map((l, j) => ({ id: id(`irl${j}`, i), purchase_order_line_item_id: l.id, quantity: l._qty }))
    if (recLines.length) receipts.push({ id: id('ir', i), item_receipt_number: `IR-${70000 + i}`, purchase_order_id: poId, received_at: `${date(m, 1) < issue ? issue : date(m, 1)}T08:00:00Z`, line_items: recLines })
    // the bill
    let billLines = lines.map((l) => ({ id: id(`bil${l.external_id}`, i), purchase_order_line_item_id: l.id, quantity: l._qty, unit_price: cents(l._price), amount: cents(l._qty * l._price), memo: l.description }))
    const k = int(0, billLines.length - 1)
    if (plant === 'price_over') { const L = billLines[k]!; const p = Math.round(lines[k]!._price * (1 + 0.03 + rnd() * 0.05) * 100) / 100; L.unit_price = cents(p); L.amount = cents(L.quantity * p) }
    if (plant === 'quantity_over') { const L = billLines[k]!; L.quantity += int(1, 10); L.amount = cents(L.quantity * lines[k]!._price) }
    if (plant === 'line_math') { const L = billLines[k]!; L.amount = { ...L.amount, amount: L.amount.amount + int(500, 5000) } }
    let billTotal = billLines.reduce((s, l) => s + l.amount.amount, 0)
    if (plant === 'total_mismatch') billTotal += int(1000, 20000)
    let invoiceNumber = `${v.name.split(/\s+/)[0]!.slice(0, 3).toUpperCase()}-${10000 + i}`
    let vendor = v
    if (plant === 'duplicate' && original) {
      const p = original
      invoiceNumber = p.invoice_number; vendor = { id: p.vendor.id, name: p.vendor.name }
      if (rndVariant() < 0.5) { // a second vendor record for the same supplier: a new id, a variant of the name
        vendor = { id: `${p.vendor.id}_v`, name: vendorVariant(p.vendor.name, rndVariant()) }
        variant = { repeats: p.id, original_vendor: { id: p.vendor.id, name: p.vendor.name }, variant_vendor: vendor }
      } else if (rndNear() < 0.5) { // a second vendor record whose name is a near match: a typo, an abbreviation, or a d/b/a name
        const m = vendorNearMatch(p.vendor.name, rndNear())
        otherPo = rndNear() < 0.5 // half of them bill their own PO and total: the case that used to be paid
        vendor = { id: `${p.vendor.id}_n`, name: m.name }
        near = { kind: m.kind, other_po: otherPo, repeats: p.id, original_vendor: { id: p.vendor.id, name: p.vendor.name }, near_vendor: vendor }
      }
      if (!otherPo) {
        billLines = p.inventory_line_items.map((l: any, j: number) => ({ ...l, id: id(`bdl${j}`, i) })); billTotal = p.amount.amount
        // the repeat bills the same PO as the original
        pos.pop(); if (recLines.length) receipts.pop()
      } // else: the original's invoice number on this row's own PO, lines and total, all of which check out on their own
    }
    const currency = plant === 'currency' ? 'EUR' : 'USD'
    const bill: any = {
      id: id('bill', i), invoice_number: invoiceNumber, vendor: { id: vendor.id, name: vendor.name, type: 'BUSINESS' },
      amount: { amount: billTotal, currency_code: currency, minor_unit_conversion_rate: 100 },
      issued_at: `${issue}T00:00:00Z`, due_at: `${issue}T00:00:00Z`,
      purchase_order_id: plant === 'no_po' ? null : original && !otherPo ? original.purchase_order_id : poId,
      inventory_line_items: billLines.map((l) => (currency === 'EUR' ? { ...l, unit_price: { ...l.unit_price, currency_code: 'EUR' }, amount: { ...l.amount, currency_code: 'EUR' } } : l)),
      line_items: [], memo: null,
    }
    // the buyer's decision
    const r = rnd()
    const decision: 'pay' | 'hold' | 'open' = plant ? (r < 0.55 ? 'hold' : r < 0.9 ? 'pay' : 'open') : (r < 0.85 ? 'pay' : r < 0.9 ? 'hold' : 'open')
    if (decision === 'pay') Object.assign(bill, { status: 'PAID', status_summary: 'PAYMENT_COMPLETED', approval_status: 'APPROVED', paid_at: `${issue}T12:00:00Z` })
    else if (decision === 'hold') Object.assign(bill, { status: 'OPEN', status_summary: rnd() < 0.7 ? 'ON_HOLD' : 'APPROVAL_REJECTED', approval_status: rnd() < 0.5 ? 'REJECTED' : 'PENDING', paid_at: null })
    else Object.assign(bill, { status: 'OPEN', status_summary: rnd() < 0.5 ? 'AWAITING_PAYMENT' : 'PAYMENT_SCHEDULED', approval_status: 'APPROVED', paid_at: null })
    bills.push(bill)
    if (decision === 'pay' && !plant) paidBefore.push(bill)
    if (plant === 'duplicate' && variant) plant = 'duplicate_vendor_variant'
    if (plant === 'duplicate' && near) plant = 'duplicate_near_match'
    if (plant) truth.planted[bill.id] = { plant, expected: PLANT_EXPECTED[plant], ...(variant ? { variant } : {}), ...(near ? { near } : {}), ...(PLANT_ACCEPTS[plant] ? { accepts: PLANT_ACCEPTS[plant] } : {}), ...(PLANT_CLEAR_BY[plant] ? { clear_by: PLANT_CLEAR_BY[plant] } : {}) }
    if (inMonth) truth.buyer[bill.id] = decision
  }

  // ── the appended classes (2026-10-05) ─────────────────────────────────────────────────────────────────────
  // Bills after the main month's, from a fifth stream, so every bill above is what it was before. Each class gets about one
  // bill per 100 (at least one): a bill from another vendor than the PO's; tax on a PO with no tax terms; freight on a PO
  // that does not say whether freight is allowed (tax and freight as Ramp has them, an expense line with no PO line, since
  // its Bill has no tax or freight field); and a PO line billed again after an earlier paid bill on the same PO billed all
  // of it, while the order as a whole still has room (the earlier bill is a clean one, appended too).
  /** the index the next appended bill takes (each block of appended bills continues from the one before) */
  let next = total
  if (o.appended !== false) {
    const rx = mulberry32((seed ^ 0x5eed0005) >>> 0)
    const xint = (lo: number, hi: number): number => lo + Math.floor(rx() * (hi - lo + 1))
    const xpick = <T>(xs: readonly T[]): T => xs[Math.floor(rx() * xs.length)]!
    const per = Math.max(1, Math.round(n / 100))
    let j = total
    const plantDecision = (): 'pay' | 'hold' | 'open' => { const r = rx(); return r < 0.55 ? 'hold' : r < 0.9 ? 'pay' : 'open' }
    const status = (b: any, d: 'pay' | 'hold' | 'open', issue: string): void => {
      if (d === 'pay') Object.assign(b, { status: 'PAID', status_summary: 'PAYMENT_COMPLETED', approval_status: 'APPROVED', paid_at: `${issue}T12:00:00Z` })
      else if (d === 'hold') Object.assign(b, { status: 'OPEN', status_summary: 'ON_HOLD', approval_status: 'PENDING', paid_at: null })
      else Object.assign(b, { status: 'OPEN', status_summary: 'AWAITING_PAYMENT', approval_status: 'APPROVED', paid_at: null })
    }
    /** A PO for vendor `v` with `k` lines (fully received on `receivedOn`), its id and lines. */
    const order = (i: number, v: { id: string; name: string }, k: number, receivedOn: string) => {
      const poId = id('po', i)
      const lines = Array.from({ length: k }, (_, q) => { const qty = xint(2, 120); const price = Math.round((2.5 + rx() * 400) * 100) / 100; return { id: id(`pol${q}`, i), external_id: `L${q + 1}`, description: xpick(ITEMS), quantity: qty, unit_price: cents(price), amount: cents(qty * price), _price: price, _qty: qty } })
      pos.push({ id: poId, purchase_order_number: `PO-${40000 + i}`, vendor_id: v.id, amount: { amount: lines.reduce((s, l) => s + l.amount.amount, 0), currency_code: 'USD', minor_unit_conversion_rate: 100 }, line_items: lines.map(({ _price, _qty, ...l }) => l), created_at: `${date(m - 1, xint(1, 28))}T09:00:00Z`, receipt_status: 'RECEIVED' })
      receipts.push({ id: id('ir', i), item_receipt_number: `IR-${70000 + i}`, purchase_order_id: poId, received_at: `${receivedOn}T08:00:00Z`, line_items: lines.map((l, q) => ({ id: id(`irl${q}`, i), purchase_order_line_item_id: l.id, quantity: l._qty })) })
      return { poId, lines }
    }
    const billOf = (i: number, v: { id: string; name: string }, poId: string, issue: string, inv: any[], expense: any[], d: 'pay' | 'hold' | 'open'): any => {
      const b: any = {
        id: id('bill', i), invoice_number: `${v.name.split(/\s+/)[0]!.slice(0, 3).toUpperCase()}-${10000 + i}`, vendor: { id: v.id, name: v.name, type: 'BUSINESS' },
        amount: { amount: [...inv, ...expense].reduce((s, l) => s + l.amount.amount, 0), currency_code: 'USD', minor_unit_conversion_rate: 100 },
        issued_at: `${issue}T00:00:00Z`, due_at: `${issue}T00:00:00Z`, purchase_order_id: poId, inventory_line_items: inv, line_items: expense, memo: null,
      }
      status(b, d, issue)
      bills.push(b)
      truth.buyer[b.id] = d
      return b
    }
    const exact = (i: number, lines: { id: string; external_id: string; description: string; _qty: number; _price: number }[]) =>
      lines.map((l) => ({ id: id(`bil${l.external_id}`, i), purchase_order_line_item_id: l.id, quantity: l._qty, unit_price: cents(l._price), amount: cents(l._qty * l._price), memo: l.description }))
    const plant = (b: any, p: Plant, extra: Partial<SynthTruth['planted'][string]>): void => {
      truth.planted[b.id] = { plant: p, expected: PLANT_EXPECTED[p], ...extra, ...(PLANT_ACCEPTS[p] ? { accepts: PLANT_ACCEPTS[p] } : {}), ...(PLANT_GAP[p] ? { gap: PLANT_GAP[p] } : {}) }
    }
    for (let c = 0; c < per; c++) {
      // a bill from another vendor than the one the PO names, billing exactly what was ordered and received
      { const i = j++; const a = xpick(vendors); const others = vendors.filter((x) => x.id !== a.id); const other = xpick(others); const issue = date(m, xint(2, days))
        const { poId, lines } = order(i, a, xint(1, 4), issue)
        const b = billOf(i, other, poId, issue, exact(i, lines), [], plantDecision())
        plant(b, 'vendor_mismatch', { vendors: { bill: { id: other.id, name: other.name }, purchase_order: { id: a.id, name: a.name } } }) }
      // tax billed on a PO that carries no tax terms: a "Sales tax" expense line, 6% to 9.5% of the lines
      { const i = j++; const v = xpick(vendors); const issue = date(m, xint(2, days))
        const { poId, lines } = order(i, v, xint(1, 4), issue)
        const inv = exact(i, lines); const sub = inv.reduce((s, l) => s + l.amount.amount, 0); const tax = Math.round(sub * (0.06 + rx() * 0.035))
        const b = billOf(i, v, poId, issue, inv, [{ id: id('bxl0', i), purchase_order_line_item_id: null, memo: 'Sales tax', amount: { amount: tax, currency_code: 'USD', minor_unit_conversion_rate: 100 } }], plantDecision())
        // 2026-10-06: the right answer under each tax rule a run can freeze (the bill itself is unchanged)
        plant(b, 'tax_on_untaxed_po', { charge: { kind: 'tax', amount: tax / 100, memo: 'Sales tax' }, by_tax_rule: taxRuleAnswers(tax, sub, inv.length) }) }
      // freight on a PO that does not say whether freight is allowed: a "Freight" expense line, $25 to $250
      { const i = j++; const v = xpick(vendors); const issue = date(m, xint(2, days))
        const { poId, lines } = order(i, v, xint(1, 4), issue)
        const freight = xint(25, 250) * 100
        const b = billOf(i, v, poId, issue, exact(i, lines), [{ id: id('bxl0', i), purchase_order_line_item_id: null, memo: 'Freight', amount: { amount: freight, currency_code: 'USD', minor_unit_conversion_rate: 100 } }], plantDecision())
        plant(b, 'freight_po_silent', { charge: { kind: 'freight', amount: freight / 100, memo: 'Freight' }, by_freight_rule: { person: 'abstain', allow: 'approve' } }) }
      // a PO line billed again: an earlier bill (paid, clean) billed all of line 1 only; this one bills part of line 1 again
      { const i = j++; const i2 = j++; const v = xpick(vendors); const d1 = xint(1, days - 1); const first = date(m, d1); const second = date(m, xint(d1 + 1, days))
        const { poId, lines } = order(i, v, xint(2, 4), first)
        const l1 = lines[0]!
        const earlier = billOf(i, v, poId, first, exact(i, [l1]), [], 'pay')
        const again = xint(1, l1._qty)
        const b = billOf(i2, v, poId, second, [{ id: id('bilL1', i2), purchase_order_line_item_id: l1.id, quantity: again, unit_price: cents(l1._price), amount: cents(again * l1._price), memo: l1.description }], [], plantDecision())
        plant(b, 'line_overbilled_across_bills', { overbill: { earlier_bill: earlier.id, po_line: l1.id, received: l1._qty, billed_before: l1._qty, billed_now: again } }) }
    }
    truth.bills = Object.keys(truth.buyer).length
    next = j
  }

  // ── the classes appended on 2026-10-06 ──────────────────────────────────────────────────────────────────────────────────
  // Bills after every bill above, from a seventh stream, so the month, and the classes appended on 2026-10-05, are what they
  // were: a paid bill re-sent with a leading zero in its invoice number (the paid original is a clean bill, appended too); tax
  // at exactly 8.25% of the lines on a PO with no tax terms; tax at 9.5% on one. About one bill per class per 100 (at least one).
  if (o.appendedLater !== false) {
    const ry = mulberry32((seed ^ 0x5eed0007) >>> 0)
    const yint = (lo: number, hi: number): number => lo + Math.floor(ry() * (hi - lo + 1))
    const ypick = <T>(xs: readonly T[]): T => xs[Math.floor(ry() * xs.length)]!
    const per = Math.max(1, Math.round(n / 100))
    let j = next
    const decisionOf = (): 'pay' | 'hold' | 'open' => { const r = ry(); return r < 0.55 ? 'hold' : r < 0.9 ? 'pay' : 'open' }
    const usdMoney = (c: number) => ({ amount: c, currency_code: 'USD', minor_unit_conversion_rate: 100 })
    const orderY = (i: number, v: { id: string; name: string }, k: number, receivedOn: string) => {
      const poId = id('po', i)
      const lines = Array.from({ length: k }, (_, q) => { const qty = yint(2, 120); const price = Math.round((2.5 + ry() * 400) * 100) / 100; return { id: id(`pol${q}`, i), external_id: `L${q + 1}`, description: ypick(ITEMS), quantity: qty, unit_price: cents(price), amount: cents(qty * price), _price: price, _qty: qty } })
      pos.push({ id: poId, purchase_order_number: `PO-${40000 + i}`, vendor_id: v.id, amount: usdMoney(lines.reduce((s, l) => s + l.amount.amount, 0)), line_items: lines.map(({ _price, _qty, ...l }) => l), created_at: `${date(m - 1, yint(1, 28))}T09:00:00Z`, receipt_status: 'RECEIVED' })
      receipts.push({ id: id('ir', i), item_receipt_number: `IR-${70000 + i}`, purchase_order_id: poId, received_at: `${receivedOn}T08:00:00Z`, line_items: lines.map((l, q) => ({ id: id(`irl${q}`, i), purchase_order_line_item_id: l.id, quantity: l._qty })) })
      return { poId, lines }
    }
    const billY = (i: number, v: { id: string; name: string }, poId: string, issue: string, inv: any[], expense: any[], d: 'pay' | 'hold' | 'open', invoiceNumber?: string): any => {
      const b: any = {
        id: id('bill', i), invoice_number: invoiceNumber ?? `${v.name.split(/\s+/)[0]!.slice(0, 3).toUpperCase()}-${10000 + i}`, vendor: { id: v.id, name: v.name, type: 'BUSINESS' },
        amount: usdMoney([...inv, ...expense].reduce((s, l) => s + l.amount.amount, 0)),
        issued_at: `${issue}T00:00:00Z`, due_at: `${issue}T00:00:00Z`, purchase_order_id: poId, inventory_line_items: inv, line_items: expense, memo: null,
      }
      if (d === 'pay') Object.assign(b, { status: 'PAID', status_summary: 'PAYMENT_COMPLETED', approval_status: 'APPROVED', paid_at: `${issue}T12:00:00Z` })
      else if (d === 'hold') Object.assign(b, { status: 'OPEN', status_summary: 'ON_HOLD', approval_status: 'PENDING', paid_at: null })
      else Object.assign(b, { status: 'OPEN', status_summary: 'AWAITING_PAYMENT', approval_status: 'APPROVED', paid_at: null })
      bills.push(b)
      truth.buyer[b.id] = d
      return b
    }
    const exactY = (i: number, lines: { id: string; external_id: string; description: string; _qty: number; _price: number }[]) =>
      lines.map((l) => ({ id: id(`bil${l.external_id}`, i), purchase_order_line_item_id: l.id, quantity: l._qty, unit_price: cents(l._price), amount: cents(l._qty * l._price), memo: l.description }))
    const plantY = (b: any, p: Plant, extra: Partial<SynthTruth['planted'][string]>): void => {
      truth.planted[b.id] = { plant: p, expected: PLANT_EXPECTED[p], ...extra, ...(PLANT_ACCEPTS[p] ? { accepts: PLANT_ACCEPTS[p] } : {}), ...(PLANT_CLEAR_BY[p] ? { clear_by: PLANT_CLEAR_BY[p] } : {}) }
    }
    const taxed = (p: 'tax_at_rate' | 'tax_off_rate', rate: number): void => {
      const i = j++; const v = ypick(vendors); const issue = date(m, yint(2, days))
      const { poId, lines } = orderY(i, v, yint(1, 4), issue)
      const inv = exactY(i, lines); const sub = inv.reduce((s, l) => s + l.amount.amount, 0); const tax = Math.round(sub * rate)
      const b = billY(i, v, poId, issue, inv, [{ id: id('bxl0', i), purchase_order_line_item_id: null, memo: 'Sales tax', amount: usdMoney(tax) }], decisionOf())
      plantY(b, p, { charge: { kind: 'tax', amount: tax / 100, memo: 'Sales tax' }, by_tax_rule: taxRuleAnswers(tax, sub, inv.length) })
    }
    for (let c = 0; c < per; c++) {
      // a paid bill, and the same bill re-sent with a leading zero after its invoice number's prefix: same vendor, PO, lines, total
      { const i = j++; const i2 = j++; const v = ypick(vendors); const d1 = yint(1, days - 1); const first = date(m, d1); const second = date(m, yint(d1 + 1, days))
        const { poId, lines } = orderY(i, v, yint(1, 4), first)
        const original = billY(i, v, poId, first, exactY(i, lines), [], 'pay')
        const sentAs = String(original.invoice_number).replace(/-(\d)/, '-0$1')
        const b = billY(i2, v, poId, second, exactY(i2, lines), [], decisionOf(), sentAs)
        plantY(b, 'duplicate_leading_zero', { repeats: { bill: original.id, invoice_number: original.invoice_number, sent_as: sentAs } }) }
      taxed('tax_at_rate', SYNTH_TAX_RATE)
      taxed('tax_off_rate', 0.095)
    }
    truth.bills = Object.keys(truth.buyer).length
  }

  const pay = o.payApps ? synthPayApps(o.month, seed, o.payApps, o.appended !== false, o.appendedLater !== false) : undefined
  if (pay) truth.pay_apps = pay.truth
  return { bills, purchase_orders: pos, item_receipts: receipts, truth, vendors, ...(pay ? { pay_applications: pay.files, pay_decisions: pay.decisions } : {}) }
}

// ── pay applications (2026-10-05) ───────────────────────────────────────────────────────────────────────────────────────

const PROJECTS = ['Riverside Clinic HVAC', 'Harbor Street Garage Electrical', 'Elm Park School Plumbing', 'Mill Road Lab Fit-out', 'Cedar Row Apartments Fire Protection', 'Northgate Transit Depot Mechanical', 'Lakeview Library Controls', 'Quarry Lane Distribution Center Sprinklers']
const SOV_ITEMS = ['Mobilization and submittals', 'Ductwork, supply and return', 'Rooftop units and curbs', 'Hydronic piping and insulation', 'Controls integration', 'Testing, adjusting and balancing', 'Fixtures and trim', 'Underground rough-in', 'Switchgear and panels', 'Close-out and training']

/** Money in cents → a number with at most two decimals (the documents carry numbers, as the example does). */
const usd = (cents: number): number => Math.round(cents) / 100

/**
 * One contract's two applications: last month's (number k) and this month's (k + 1), each internally consistent: every line
 * G = D + E + F, H = C − G, % = G ÷ C, retainage I = 10% of G; the summary lines 1-9 from the lines. This month's D is last
 * month's G, and its line 7 is last month's line 6. A plant then breaks exactly one thing, the totals carried through.
 */
function contractApps(rnd: () => number, month: string, idx: number, plant: PayAppPlant | null): { prev: Record<string, unknown>; cur: Record<string, unknown> } {
  const int = (lo: number, hi: number): number => lo + Math.floor(rnd() * (hi - lo + 1))
  const [y, m] = month.split('-').map(Number) as [number, number]
  const end = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).toISOString().slice(0, 10)
  const prevEnd = m === 1 ? end(y - 1, 12) : end(y, m - 1)
  const k = int(1, 5)
  const n = int(3, 7)
  const items = Array.from({ length: n }, (_, j) => SOV_ITEMS[(idx * 3 + j) % SOV_ITEMS.length]!)
  const C = items.map(() => int(8, 160) * 50000) // scheduled values in cents: $4,000 to $80,000, in $500 steps
  // completion so far (cents, whole dollars): before last month, last month, this month
  const before = C.map((c, j) => Math.floor((c * (j === 0 ? int(10, 40) : int(0, 40))) / 100 / 100) * 100) // line 1 always has work from before last month
  const lastMonth = C.map((c, j) => Math.min(c - before[j]!, Math.floor((c * int(0, 30)) / 100 / 100) * 100))
  const thisMonth = C.map((c, j) => Math.min(c - before[j]! - lastMonth[j]!, Math.floor((c * int(0, 30)) / 100 / 100) * 100))
  const project = `${PROJECTS[idx % PROJECTS.length]}${idx >= PROJECTS.length ? ` ${Math.floor(idx / PROJECTS.length) + 1}` : ''} (synthetic)`
  const contractor = 'Example Mechanical Services (synthetic)'
  const original = C.reduce((s, c) => s + c, 0)
  // `div`: the retainage actually withheld, as a divisor of completed-to-date (10 = the stated 10%; 20 = 5%, the
  // payapp_retainage_under plant, whose application still states 10%)
  const build = (no: number, period: string, D: number[], E: number[], prevLine6: number, div = 10) => {
    const lines = C.map((c, j) => {
      const G = D[j]! + E[j]!
      return { item_no: String(j + 1), description: items[j]!, scheduled_value: usd(c), previous: usd(D[j]!), this_period: usd(E[j]!), materials_stored: 0, completed_to_date: usd(G), percent_complete: Math.round((G / c) * 1000) / 10, balance_to_finish: usd(c - G), retainage: usd(G / div) }
    })
    const line4 = C.reduce((s, _c, j) => s + D[j]! + E[j]!, 0)
    const line5 = line4 / div
    const line6 = line4 - line5
    return {
      doc: {
        project, contractor, owner: 'Example Health Properties (synthetic)', architect: 'Example Design Group (synthetic)', application_number: no, period_to: period, currency: 'USD',
        original_contract_sum: usd(original), net_change_orders: 0, contract_sum_to_date: usd(original), schedule_of_values: lines,
        total_completed_and_stored: usd(line4), retainage_rate: '10%', total_retainage: usd(line5), total_earned_less_retainage: usd(line6),
        less_previous_certificates: usd(prevLine6), current_payment_due: usd(line6 - prevLine6), balance_to_finish_including_retainage: usd(original - line6),
      } as Record<string, any>,
      line6,
    }
  }
  const beforeLine6 = before.reduce((s, x) => s + x, 0) * 0.9
  const p = build(k, prevEnd, before, lastMonth, beforeLine6)
  const G1 = C.map((_c, j) => before[j]! + lastMonth[j]!)
  let D2 = [...G1], E2 = [...thisMonth]
  if (plant === 'payapp_continuity') { const jj = G1.indexOf(Math.max(...G1)); D2[jj] = G1[jj]! - Math.min(100000, G1[jj]!) } // "previous" up to $1,000 below last month's completed
  if (plant === 'payapp_over_scheduled') { const j = int(0, n - 1); E2[j] = C[j]! - G1[j]! + int(1, 20) * 10000 } // billed past the scheduled value, totals carried through
  const c2 = build(k + 1, end(y, m), D2, E2, p.line6, plant === 'payapp_retainage_under' ? 20 : 10)
  if (plant === 'payapp_payment_due') c2.doc.current_payment_due = usd(Math.round(c2.doc.current_payment_due * 100) + 100000) // line 8 off by $1,000
  return { prev: p.doc, cur: c2.doc }
}

type LaterPayAppPlant = 'payapp_sov_raised' | 'payapp_new_co_line' | 'payapp_stored_formD'

/**
 * One contract's two applications for a class appended on 2026-10-06. The same construction as contractApps, with
 * the columns it needs: F (materials presently stored), change orders, a new line. Each application is consistent on its own
 * (G = D + E + F, H = C − G, retainage 10% of G, the summary from the lines, the contract sum to date = original + net change
 * orders); this month's D is last month's G, except as the class says:
 *   payapp_sov_raised    line j's scheduled value rises by X, and the net change orders by X, with no change-order line
 *   payapp_new_co_line   line n + 1, "Change order 01", scheduled at X, starts this month; the net change orders rise by X
 *   payapp_stored_formD  line s stored S last month (in F); this month it is installed (in E) and D is last month's D + E, as
 *                        the form's column D heading says (stored materials not included)
 */
function contractAppsLater(rnd: () => number, month: string, idx: number, plant: LaterPayAppPlant): { prev: Record<string, unknown>; cur: Record<string, unknown>; change: NonNullable<NonNullable<SynthTruth['pay_apps']>[string]['change']> } {
  const int = (lo: number, hi: number): number => lo + Math.floor(rnd() * (hi - lo + 1))
  const [y, m] = month.split('-').map(Number) as [number, number]
  const end = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).toISOString().slice(0, 10)
  const prevEnd = m === 1 ? end(y - 1, 12) : end(y, m - 1)
  const k = int(1, 5)
  const n = int(3, 7)
  const items = Array.from({ length: n }, (_, j) => SOV_ITEMS[(idx * 3 + j) % SOV_ITEMS.length]!)
  const C = items.map(() => int(8, 160) * 50000)
  const before = C.map((c, j) => Math.floor((c * (j === 0 ? int(10, 40) : int(0, 40))) / 100 / 100) * 100)
  const lastMonth = C.map((c, j) => Math.min(c - before[j]!, Math.floor((c * int(0, 30)) / 100 / 100) * 100))
  const project = `${PROJECTS[idx % PROJECTS.length]}${idx >= PROJECTS.length ? ` ${Math.floor(idx / PROJECTS.length) + 1}` : ''} (synthetic)`
  const original = C.reduce((s, c) => s + c, 0)
  type Row = { desc: string; c: number; D: number; E: number; F: number }
  const build = (no: number, period: string, rows: Row[], netCO: number, prevLine6: number) => {
    const lines = rows.map((r, j) => {
      const G = r.D + r.E + r.F
      return { item_no: String(j + 1), description: r.desc, scheduled_value: usd(r.c), previous: usd(r.D), this_period: usd(r.E), materials_stored: usd(r.F), completed_to_date: usd(G), percent_complete: Math.round((G / r.c) * 1000) / 10, balance_to_finish: usd(r.c - G), retainage: usd(G / 10) }
    })
    const line4 = rows.reduce((s, r) => s + r.D + r.E + r.F, 0)
    const line5 = line4 / 10
    const line6 = line4 - line5
    return {
      doc: {
        project, contractor: 'Example Mechanical Services (synthetic)', owner: 'Example Health Properties (synthetic)', architect: 'Example Design Group (synthetic)', application_number: no, period_to: period, currency: 'USD',
        original_contract_sum: usd(original), net_change_orders: usd(netCO), contract_sum_to_date: usd(original + netCO), schedule_of_values: lines,
        total_completed_and_stored: usd(line4), retainage_rate: '10%', total_retainage: usd(line5), total_earned_less_retainage: usd(line6),
        less_previous_certificates: usd(prevLine6), current_payment_due: usd(line6 - prevLine6), balance_to_finish_including_retainage: usd(original + netCO - line6),
      } as Record<string, any>,
      line6,
    }
  }
  // last month: the stored class keeps S on the line with the most room left (in F, not yet installed)
  const room = C.map((c, j) => c - before[j]! - lastMonth[j]!)
  const s = room.indexOf(Math.max(...room))
  const S = plant === 'payapp_stored_formD' ? Math.max(100, Math.floor(Math.min(room[s]!, (C[s]! * int(5, 20)) / 100) / 100) * 100) : 0
  const prevRows: Row[] = C.map((c, j) => ({ desc: items[j]!, c, D: before[j]!, E: lastMonth[j]!, F: j === s ? S : 0 }))
  const p = build(k, prevEnd, prevRows, 0, before.reduce((sum, x) => sum + x, 0) * 0.9)
  // this month: last month's G as D (the stored class's line as the form writes it), new work within what is left
  const G1 = prevRows.map((r) => r.D + r.E + r.F)
  const curRows: Row[] = prevRows.map((r, j) => {
    const work = Math.min(r.c - G1[j]!, Math.floor((r.c * int(0, 30)) / 100 / 100) * 100)
    return j === s && S > 0 ? { ...r, D: r.D + r.E, E: S + work, F: 0 } : { ...r, D: G1[j]!, E: work, F: 0 }
  })
  let netCO = 0
  let change: NonNullable<NonNullable<SynthTruth['pay_apps']>[string]['change']>
  if (plant === 'payapp_sov_raised') {
    const j = int(0, n - 1)
    const X = int(10, 60) * 50000
    change = { line: j + 1, from: usd(curRows[j]!.c), to: usd(curRows[j]!.c + X), by: usd(X) }
    curRows[j] = { ...curRows[j]!, c: curRows[j]!.c + X }
    netCO = X
  } else if (plant === 'payapp_new_co_line') {
    const X = int(8, 40) * 50000
    curRows.push({ desc: 'Change order 01: added scope (synthetic)', c: X, D: 0, E: Math.floor((X * int(20, 60)) / 100 / 100) * 100, F: 0 })
    change = { line: curRows.length, scheduled_value: usd(X) }
    netCO = X
  } else change = { line: s + 1, stored_last_month: usd(S) }
  const c2 = build(k + 1, end(y, m), curRows, netCO, p.line6)
  return { prev: p.doc, cur: c2.doc, change }
}

function synthPayApps(month: string, seed: number, contracts: number, appended = true, appendedLater = true): { files: Record<string, Record<string, unknown>>; decisions: string; truth: NonNullable<SynthTruth['pay_apps']> } {
  const rnd = mulberry32((seed ^ 0x5eed0003) >>> 0) // the pay applications' own stream: the bills never consume it
  const files: Record<string, Record<string, unknown>> = {}
  const truth: NonNullable<SynthTruth['pay_apps']> = {}
  const rows = ['file,decision']
  const one = (r: () => number, i: number, plant: PayAppPlant | null): void => {
    const { prev, cur } = contractApps(r, month, i, plant)
    const slug = `contract-${String(i + 1).padStart(2, '0')}`
    const prevFile = `${slug}-app${prev.application_number}.json`, curFile = `${slug}-app${cur.application_number}.json`
    files[prevFile] = prev
    files[curFile] = cur
    const x = r()
    const buyer: 'pay' | 'hold' | 'open' = plant ? (x < 0.55 ? 'hold' : x < 0.9 ? 'pay' : 'open') : (x < 0.85 ? 'pay' : x < 0.9 ? 'hold' : 'open')
    rows.push(`${prevFile},paid`, `${curFile},${buyer === 'pay' ? 'paid' : buyer === 'hold' ? 'held' : 'open'}`)
    // the retainage plant: what was withheld against what the stated 10% would withhold, in dollars
    const under = plant === 'payapp_retainage_under' ? usd(Math.round(Number(cur.total_completed_and_stored) * 100 / 10) - Math.round(Number(cur.total_retainage) * 100)) : undefined
    truth[curFile] = { plant, expected: PAYAPP_EXPECTED[plant ?? 'clean'], buyer, previous: prevFile, ...(under !== undefined ? { retainage: { stated: String(cur.retainage_rate), withheld_rate: '5%', under_by: under } } : {}) }
  }
  for (let i = 0; i < contracts; i++) one(rnd, i, rnd() < 0.5 ? PAYAPP_PLANTS[Math.floor(rnd() * PAYAPP_PLANTS.length)]! : null)
  // the appended contracts (2026-10-05): their own stream, after the others, so every contract above is unchanged
  let at = contracts
  if (appended && contracts > 0) {
    const rx = mulberry32((seed ^ 0x5eed0006) >>> 0)
    const extra = Math.max(1, Math.round(contracts / 8))
    for (let e = 0; e < extra; e++) one(rx, contracts + e, PAYAPP_APPENDED[e % PAYAPP_APPENDED.length]!)
    at = contracts + extra
  }
  // the classes appended on 2026-10-06: one contract each, from an eighth stream, after every contract above
  if (appendedLater && contracts > 0) {
    const ry = mulberry32((seed ^ 0x5eed0008) >>> 0)
    PAYAPP_APPENDED_LATER.forEach((plant, e) => {
      const i = at + e
      const { prev, cur, change } = contractAppsLater(ry, month, i, plant as LaterPayAppPlant)
      const slug = `contract-${String(i + 1).padStart(2, '0')}`
      const prevFile = `${slug}-app${prev.application_number}.json`, curFile = `${slug}-app${cur.application_number}.json`
      files[prevFile] = prev
      files[curFile] = cur
      const x = ry()
      // the buyer's decision: a planted error is mostly held; a good application (the two legitimate classes) mostly paid
      const buyer: 'pay' | 'hold' | 'open' = PAYAPP_EXPECTED[plant] !== 'pay' ? (x < 0.55 ? 'hold' : x < 0.9 ? 'pay' : 'open') : (x < 0.85 ? 'pay' : x < 0.9 ? 'hold' : 'open')
      rows.push(`${prevFile},paid`, `${curFile},${buyer === 'pay' ? 'paid' : buyer === 'hold' ? 'held' : 'open'}`)
      truth[curFile] = { plant, expected: PAYAPP_EXPECTED[plant], buyer, previous: prevFile, change }
    })
  }
  return { files, decisions: `${rows.join('\n')}\n`, truth }
}

/** A CSV cell: quoted when it holds a comma, a quote or a line break. */
const csvCell = (v: unknown): string => { const t = v === null || v === undefined ? '' : String(v); return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t }
const csvText = (header: readonly string[], rows: unknown[][]): string => `${[header.join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\n')}\n`
/** Minor units → a decimal with two places (the CSV carries major units). */
const major = (cents: number): string => (cents / 100).toFixed(2)

/**
 * The same month in this package's own CSV columns (the generic-csv source; 2026-10-06), and the truth that goes with it. Every
 * bill, order and receipt is the Ramp month's, written as rows: a bill line names its PO line by the line's item code (L1,
 * L2, …), a bill's "Sales tax" line is its `tax` column, and each PO line carries `invoiced_quantity`, the quantity billed on it
 * before the month (by bills not held), so the billed-to-date check nets a line across the month's bills. Two classes read
 * differently here, and the truth says so: a PO line billed again across bills is caught (no gap: the export states what was
 * invoiced), and a freight charge, which these columns have no field for, arrives as a line no PO line matches, so a person
 * decides under either freight rule.
 */
export function synthMonthCsv(s: ReturnType<typeof synthMonth>): { files: Record<string, string>; truth: SynthTruth } {
  const vendorName = new Map<string, string>()
  for (const v of s.vendors) vendorName.set(v.id, v.name)
  const bills = s.bills as any[], pos = s.purchase_orders as any[], receipts = s.item_receipts as any[]
  for (const b of bills) if (!vendorName.has(b.vendor.id)) vendorName.set(b.vendor.id, b.vendor.name)
  const poById = new Map<string, any>(pos.map((p) => [p.id, p]))
  const lineOf = new Map<string, { po: any; item: string }>()
  for (const p of pos) for (const l of p.line_items) lineOf.set(l.id, { po: p, item: l.external_id })
  const monthStart = `${s.truth.month}-01`
  // the quantity billed on each PO line before the month, by bills the buyer did not hold
  const before = new Map<string, number>()
  for (const b of bills) {
    if (s.truth.buyer[b.id] === 'hold' || String(b.issued_at).slice(0, 10) >= monthStart) continue
    for (const l of b.inventory_line_items) if (l.purchase_order_line_item_id) before.set(l.purchase_order_line_item_id, (before.get(l.purchase_order_line_item_id) ?? 0) + l.quantity)
  }
  const status = (b: any): string => (b.status === 'PAID' ? 'paid' : b.status_summary === 'ON_HOLD' || b.status_summary === 'APPROVAL_REJECTED' ? 'held' : 'open')
  const billRows: unknown[][] = []
  for (const b of bills) {
    const po = b.purchase_order_id ? poById.get(b.purchase_order_id) : undefined
    const taxLine = (b.line_items as any[]).find((l) => l.memo === 'Sales tax')
    const head = [b.id, b.invoice_number, b.vendor.name, String(b.issued_at).slice(0, 10), b.amount.currency_code, major(b.amount.amount), taxLine ? major(taxLine.amount.amount) : '', po ? po.purchase_order_number : '', status(b)]
    for (const l of b.inventory_line_items) {
      const ref = lineOf.get(l.purchase_order_line_item_id)
      billRows.push([...head, l.id, ref ? ref.item : '', l.memo ?? '', l.quantity, major(l.unit_price.amount), major(l.amount.amount)])
    }
    for (const l of b.line_items as any[]) if (l !== taxLine) billRows.push([...head, l.id, (l.memo ?? 'CHARGE').toUpperCase(), l.memo ?? '', 1, major(l.amount.amount), major(l.amount.amount)])
  }
  const poRows: unknown[][] = []
  for (const p of pos) for (const l of p.line_items) poRows.push([p.id, p.purchase_order_number, vendorName.get(p.vendor_id) ?? '', p.amount.currency_code, l.id, l.external_id, l.description, l.quantity, major(l.unit_price.amount), major(l.amount.amount), before.get(l.id) ?? 0])
  const recRows: unknown[][] = []
  for (const r of receipts) {
    const po = poById.get(r.purchase_order_id)
    for (const l of r.line_items) recRows.push([r.id, r.item_receipt_number, po ? po.purchase_order_number : '', String(r.received_at).slice(0, 10), lineOf.get(l.purchase_order_line_item_id)?.item ?? '', l.quantity])
  }
  const files: Record<string, string> = {
    'bills.csv': csvText(['ref', 'invoice_number', 'vendor', 'date', 'currency', 'total', 'tax', 'po', 'status', 'line_id', 'item', 'description', 'quantity', 'rate', 'amount'], billRows),
    'purchase_orders.csv': csvText(['ref', 'number', 'vendor', 'currency', 'line_id', 'item', 'description', 'quantity', 'rate', 'amount', 'invoiced_quantity'], poRows),
    'item_receipts.csv': csvText(['ref', 'number', 'po', 'date', 'item', 'quantity'], recRows),
  }
  const planted: SynthTruth['planted'] = {}
  for (const [ref, t] of Object.entries(s.truth.planted)) {
    if (t.plant === 'line_overbilled_across_bills') { const { gap: _gap, ...rest } = t; planted[ref] = { ...rest, expected: 'abstain' } } // the export states what was invoiced: caught
    else if (t.plant === 'freight_po_silent') planted[ref] = { ...t, by_freight_rule: { person: 'abstain', allow: 'abstain' } } // no freight column: a line no PO line matches
    else planted[ref] = t
  }
  return { files, truth: { ...s.truth, format: 'generic-csv', planted } }
}

/**
 * Write the month as an export folder and the truth beside it: Ramp's (bills.json, purchase_orders.json, item_receipts.json,
 * each a page { data, page }) by default, or generic CSV (bills.csv, purchase_orders.csv, item_receipts.csv; synthMonthCsv)
 * with `format: 'generic-csv'`. Pay applications, when asked for, are the same files either way.
 */
export function writeSynthMonth(exportDir: string, truthPath: string, o: SynthOptions): SynthTruth {
  const s = synthMonth(o)
  mkdirSync(exportDir, { recursive: true })
  if (o.format === 'generic-csv') {
    const c = synthMonthCsv(s)
    for (const [name, text] of Object.entries(c.files)) writeFileSync(join(exportDir, name), text)
    s.truth = c.truth
  } else {
    const page = (data: unknown[]) => `${JSON.stringify({ data, page: { next: null } }, null, 1)}\n`
    writeFileSync(join(exportDir, 'bills.json'), page(s.bills))
    writeFileSync(join(exportDir, 'purchase_orders.json'), page(s.purchase_orders))
    writeFileSync(join(exportDir, 'item_receipts.json'), page(s.item_receipts))
  }
  if (s.pay_applications) {
    const dir = join(exportDir, 'pay_applications')
    mkdirSync(dir, { recursive: true })
    for (const [name, doc] of Object.entries(s.pay_applications)) writeFileSync(join(dir, name), `${JSON.stringify(doc, null, 1)}\n`)
    writeFileSync(join(dir, 'decisions.csv'), s.pay_decisions!)
  }
  writeFileSync(truthPath, `${JSON.stringify(s.truth, null, 1)}\n`)
  return s.truth
}
