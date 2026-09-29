/**
 * The labeled set for the 2026-09-28 e-invoice ruleset corrections (docs/RULESET-CORRECTIONS-2026-09-28.md).
 * CONSTRUCTED and hand-labeled from the specs; it is not field data. Pre-registered in
 * the ruleset-corrections pre-registration (frozen 2026-09-28 09:35) before the first measurement.
 *
 * Labels:
 *  - UBL (Peppol / ZATCA): CLEAN = the invoice satisfies BR-CO-10/13/15/16 exactly to the cent and its line rule
 *    (Peppol PEPPOL-EN16931-R120 with its 0.02 slack; ZATCA BR-KSA-EN16931-11 with only the product rounded half-up),
 *    and the extraction reports it faithfully (it may omit fields). ERROR = at least one of those rules is broken.
 *  - KSeF: CLEAN = the invoice's buckets, total and lines are what the FA(3) fields say they are; ERROR = a wrong P_15 or
 *    a wrong line net value. P_10 cases are deliberately absent: the sources do not say what P_10 means, so no label
 *    can be assigned without guessing.
 * CLEAN UBL invoices are BUILT (totals computed from the lines, half-up to the cent), so they foot by construction;
 * each ERROR is a clean invoice with one stated tampering.
 */
import type { LabeledCase } from '../../src/declarative/measure'

export interface SetCase extends LabeledCase { id: string; why: string }

const r2 = (x: number): number => Math.round((x + Number.EPSILON) * 100) / 100
type Line = Record<string, unknown> & { line_extension_amount: number }
interface Opts { vat: number; allowance?: number; charge?: number; prepaid?: number; omitTax?: boolean }

/** A UBL-style extraction whose totals foot exactly (BR-CO-10/13/15/16), from its lines. */
function ubl(lines: Line[], o: Opts): Record<string, unknown> {
  const sum = r2(lines.reduce((a, l) => a + l.line_extension_amount, 0))
  const excl = r2(sum - (o.allowance ?? 0) + (o.charge ?? 0))
  const tax = r2(excl * o.vat)
  const incl = r2(excl + tax)
  const payable = r2(incl - (o.prepaid ?? 0))
  return {
    lines,
    line_extension_amount: sum,
    ...(o.allowance !== undefined ? { allowance_total_amount: o.allowance } : {}),
    ...(o.charge !== undefined ? { charge_total_amount: o.charge } : {}),
    tax_exclusive_amount: excl,
    ...(o.omitTax ? {} : { tax_amount: tax }),
    tax_inclusive_amount: incl,
    ...(o.prepaid !== undefined ? { prepaid_amount: o.prepaid } : {}),
    payable_amount: payable,
  }
}
const L = (qty: number, price: number, net: number, extra: Record<string, unknown> = {}): Line => ({ invoiced_quantity: qty, price_amount: price, line_extension_amount: net, ...extra })
const set = (x: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> => ({ ...x, ...patch })

/** The UBL shapes shared by Peppol and ZATCA (VAT rate differs). `peppolOnly` marks R120-slack cases ZATCA forbids. */
function ublCases(vat: number, zatca: boolean): SetCase[] {
  const c: SetCase[] = []
  const add = (id: string, label: 'CLEAN' | 'ERROR', why: string, extraction: Record<string, unknown>): void => { c.push({ id, label, why, extraction }) }
  const base = ubl([L(10, 150, 1500), L(4, 25, 100)], { vat })
  add('C1-plain', 'CLEAN', 'two plain lines; totals foot', base)
  add('C2-doc-allowance-charge-prepaid', 'CLEAN', 'document allowance/charge and a prepayment; BR-CO-13/16 hold',
    ubl([L(10, 100, 1000)], { vat, allowance: 50, charge: 30, prepaid: 100 }))
  add('C3-line-allowance', 'CLEAN', 'line 1: 10 × 100 − 50 allowance = 950 (BT-136)',
    ubl([L(10, 100, 950, { line_allowance_amount: 50 }), L(2, 25, 50)], { vat }))
  add('C4-line-charge', 'CLEAN', 'line: 4 × 25 + 5 charge = 105 (BT-141)', ubl([L(4, 25, 105, { line_charge_amount: 5 })], { vat }))
  add('C5-line-allowance-and-charge', 'CLEAN', 'line: 3 × 200 − 30 + 12.50 = 582.50',
    ubl([L(3, 200, 582.5, { line_allowance_amount: 30, line_charge_amount: 12.5 })], { vat }))
  add('C6-base-quantity', 'CLEAN', 'line: 12 × (30 / 12 per base quantity) = 30', ubl([L(12, 30, 30, { base_quantity: 12 })], { vat }))
  add('C7-large-exact', 'CLEAN', 'a 1,000,000.00 invoice, exact', ubl([L(1, 1000000, 1000000)], { vat }))
  add('C8-tax-not-extracted', 'CLEAN', 'a correct invoice whose extraction omits BT-110 (tax_amount)', ubl([L(10, 100, 1000)], { vat, omitTax: true }))
  add('C9-allowance-as-list', 'CLEAN', 'the line allowance is reported as an item list, not a total',
    ubl([L(10, 100, 950, { allowance_charges: [{ charge_indicator: false, amount: 50 }] })], { vat }))
  if (!zatca) add('C10-r120-slack-edge', 'CLEAN', 'R120 accepts 0.02: 100 × 1.0002 = 100.02 stated as 100.00', ubl([L(100, 1.0002, 100)], { vat }))
  if (zatca) add('C10-rounded-product', 'CLEAN', '§9.3: 3 × 3.335 = 10.005, rounded half-up to 10.01', ubl([L(3, 3.335, 10.01)], { vat }))

  add('E1-payable-wrong', 'ERROR', 'BR-CO-16: payable 9999', set(base, { payable_amount: 9999 }))
  add('E2-incl-wrong', 'ERROR', 'BR-CO-15: tax-inclusive 1500 (payable follows)', set(base, { tax_inclusive_amount: 1500, payable_amount: 1500 }))
  const incl = base.tax_inclusive_amount as number
  add('E3-one-cent-BR-CO-15', 'ERROR', 'BR-CO-15 broken by 0.01 (payable follows)', set(base, { tax_inclusive_amount: r2(incl + 0.01), payable_amount: r2(incl + 0.01) }))
  add('E4-one-cent-BR-CO-10', 'ERROR', 'BR-CO-10 broken by 0.01: BT-106 = Σ BT-131 + 0.01, the rest foots on it',
    (() => { const x = ubl([L(10, 150, 1500), L(4, 25, 100)], { vat }); const s = 1600.01, t = r2(s * vat); return set(x, { line_extension_amount: s, tax_exclusive_amount: s, tax_amount: t, tax_inclusive_amount: r2(s + t), payable_amount: r2(s + t) }) })())
  const big = ubl([L(1, 1000000, 1000000)], { vat })
  const bigIncl = big.tax_inclusive_amount as number
  add('E5-band-hidden-300', 'ERROR', 'BR-CO-15 broken by 300.00 on a 1M invoice (inside the old uncapped 0.03% band)',
    set(big, { tax_inclusive_amount: r2(bigIncl + 300), payable_amount: r2(bigIncl + 300) }))
  add('E6-band-hidden-0.29', 'ERROR', 'BR-CO-13 broken by 0.29 on a 980 base (inside the old band); the rest foots on it',
    (() => { const x = ubl([L(10, 100, 1000)], { vat, allowance: 50, charge: 30 }); const e = 980.29, t = r2(e * vat); return set(x, { tax_exclusive_amount: e, tax_amount: t, tax_inclusive_amount: r2(e + t), payable_amount: r2(e + t) }) })())
  add('E7-line-wrong', 'ERROR', 'line: 10 × 100 stated 1010, totals foot on 1010', ubl([L(10, 100, 1010)], { vat }))
  add('E8-discount-not-applied', 'ERROR', 'line: 10 × 100 − 50 allowance reported, but the net is stated 1000',
    ubl([L(10, 100, 1000, { line_allowance_amount: 50 })], { vat }))
  if (zatca) add('E9-line-one-cent', 'ERROR', 'BR-KSA-EN16931-11: 1 × 10 stated 10.01 (beyond the product rounding)', ubl([L(1, 10, 10.01)], { vat }))
  return c
}

export const PEPPOL_SET: SetCase[] = ublCases(0.2, false)
export const ZATCA_SET: SetCase[] = ublCases(0.15, true)

const K = (buckets: Record<string, number>, lines: { P_8B: number; P_9A: number; P_11: number }[], p15?: number): Record<string, unknown> => {
  const total = r2(Object.values(buckets).reduce((a, b) => a + b, 0))
  return { lines, ...buckets, P_15: p15 ?? total }
}
const KL = (q: number, p: number, n: number) => ({ P_8B: q, P_9A: p, P_11: n })

export const KSEF_SET: SetCase[] = [
  { id: 'C1-single-rate', label: 'CLEAN', why: '23%: 1000 + 230 = 1230', extraction: K({ P_13_1: 1000, P_14_1: 230 }, [KL(10, 100, 1000)]) },
  { id: 'C2-multi-rate', label: 'CLEAN', why: '23% + 8% buckets', extraction: K({ P_13_1: 1000, P_14_1: 230, P_13_2: 500, P_14_2: 40 }, [KL(10, 100, 1000), KL(5, 100, 500)]) },
  { id: 'C3-P_13_6_1', label: 'CLEAN', why: '0% domestic (P_13_6_1)', extraction: K({ P_13_1: 1000, P_14_1: 230, P_13_6_1: 200 }, [KL(10, 100, 1000), KL(2, 100, 200)]) },
  { id: 'C4-P_13_6_2', label: 'CLEAN', why: '0% intra-EU supply (P_13_6_2)', extraction: K({ P_13_1: 1000, P_14_1: 230, P_13_6_2: 300 }, [KL(10, 100, 1000), KL(3, 100, 300)]) },
  { id: 'C5-P_13_6_3', label: 'CLEAN', why: '0% export (P_13_6_3)', extraction: K({ P_13_1: 1000, P_14_1: 230, P_13_6_3: 400 }, [KL(10, 100, 1000), KL(4, 100, 400)]) },
  { id: 'C6-P_13_7', label: 'CLEAN', why: 'exempt (P_13_7)', extraction: K({ P_13_1: 1000, P_14_1: 230, P_13_7: 150 }, [KL(10, 100, 1000), KL(1, 150, 150)]) },
  { id: 'C7-P_13_8', label: 'CLEAN', why: 'outside the territory (P_13_8)', extraction: K({ P_13_1: 1000, P_14_1: 230, P_13_8: 500 }, [KL(10, 100, 1000), KL(5, 100, 500)]) },
  { id: 'C8-P_13_9', label: 'CLEAN', why: 'art. 100 ust. 1 pkt 4 services (P_13_9)', extraction: K({ P_13_1: 1000, P_14_1: 230, P_13_9: 250 }, [KL(10, 100, 1000), KL(1, 250, 250)]) },
  { id: 'C9-P_13_10', label: 'CLEAN', why: 'domestic reverse charge (P_13_10)', extraction: K({ P_13_1: 1000, P_14_1: 230, P_13_10: 600 }, [KL(10, 100, 1000), KL(6, 100, 600)]) },
  { id: 'C10-P_13_11', label: 'CLEAN', why: 'margin procedure (P_13_11)', extraction: K({ P_13_1: 1000, P_14_1: 230, P_13_11: 350 }, [KL(10, 100, 1000), KL(1, 350, 350)]) },
  { id: 'C11-correction-negative', label: 'CLEAN', why: 'MF Przykład 23 method 1: −1 × 90 = −90', extraction: K({ P_13_1: -90, P_14_1: -20.7 }, [KL(-1, 90, -90)]) },
  { id: 'C12-eight-decimal-price', label: 'CLEAN', why: '3 × 33.33333333 = 99.99999999, P_11 100.00', extraction: K({ P_13_1: 100, P_14_1: 23 }, [KL(3, 33.33333333, 100)]) },
  { id: 'C13-grosz-sample', label: 'CLEAN', why: 'Σ buckets 2050.99, P_15 2051 (reported MF sample; ⚠ secondary)', extraction: K({ P_13_1: 1667.47, P_14_1: 383.52 }, [KL(1, 1667.47, 1667.47)], 2051) },
  { id: 'E1-P_15-wrong', label: 'ERROR', why: 'P_15 9999 on a 1230 invoice', extraction: K({ P_13_1: 1000, P_14_1: 230 }, [KL(10, 100, 1000)], 9999) },
  { id: 'E2-line-net-wrong', label: 'ERROR', why: 'P_11 1100 for 10 × 100 (buckets follow the line)', extraction: K({ P_13_1: 1100, P_14_1: 253 }, [KL(10, 100, 1100)]) },
  { id: 'E3-P_15-wrong-with-P_13_8', label: 'ERROR', why: 'P_15 off by 100 on an invoice with P_13_8', extraction: K({ P_13_1: 1000, P_14_1: 230, P_13_8: 500 }, [KL(10, 100, 1000), KL(5, 100, 500)], 1830) },
  { id: 'E4-line-net-off-by-1', label: 'ERROR', why: 'P_11 999 for 10 × 100', extraction: K({ P_13_1: 999, P_14_1: 229.77 }, [KL(10, 100, 999)]) },
]
