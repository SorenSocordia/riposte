/**
 * Ruleset ap-threeway 0.3.0 (2026-10-14), on a controller's own emailed bills from a cold review, 2026-10-13
 * (test/fixtures/ap-buyers-2026-10-13/README.md):
 *
 *   -   an announced change of payment details with no instruction verb ("our old account at Wells Fargo was closed last week.
 *       Janet in our office will call you with the replacement info before you cut the check.") was APPROVED, exit 0, and the
 *       approve said no change of payment details was found. Under 0.3.0 the bill goes to a person, the sentence named; the five
 *       other redirections kept here keep their rulings; the clean bill still approves;
 *   -   the approve's "none was found" is said only when no sentence of the bill names payment at all; otherwise each sentence
 *       that does is named with how it was read;
 *   -   four supply-house habits each sent a clean bill to a person for a reason of reading, never of a check: "1P" for single
 *       pole, a Subtotal line, a distributor's invoice number, wire priced per thousand feet. Under 0.3.0 each is read, and a
 *       subtotal that is not the lines' sum still goes to a person, both figures named;
 *   -   0.2.0 re-performs byte for byte (its verdicts and words do not move), 0.3.0 is selectable and refused under an engine
 *       before 0.7.0, and the text reading converts to structured input the same way under both.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AP_RULESET, AP_RULESET_V0_2_0, AP_RULESET_V0_3_0, AP_RULESET_VERSIONS, defaultApRuleset, readsAs030, resolveApRuleset, splitApLayout, verifyInvoiceMatch, type ApDocuments, type ApResult, type PriorInvoice } from '../src/ap/index'
import { ANNOUNCED_READING, readRemittance, readSentence } from '../src/ap/remittance'
import { nameScore, parseInvoice } from '../src/ap/parse'
import { structuredFromText } from '../src/ap/from-text'
import { formatApReport } from '../src/ap/report'
import { verifyReplay } from '../src/protocol/replay'

const HERE = dirname(fileURLToPath(import.meta.url))
const F = join(HERE, 'fixtures', 'ap-buyers-2026-10-13')
const NOW = (): Date => new Date('2026-10-14T00:00:00Z')
const V020 = 'ap-threeway@0.2.0', V030 = 'ap-threeway@0.3.0'
const txt = (name: string): string => readFileSync(join(F, name), 'utf8')
const history = JSON.parse(txt('history.json')) as PriorInvoice[]
const docsOf = (name: string): ApDocuments => ({ ...splitApLayout(txt(name))!, history })
const run = (name: string, ruleset: string): ApResult => verifyInvoiceMatch(docsOf(name), { now: NOW, ruleset })
const claim = (r: ApResult, id: string) => r.verdict.claims.find((c) => c.claim_id === id)
const payment = (r: ApResult): string => r.not_checked.find((s) => s.startsWith('payment redirection')) ?? ''
const controller = (r: ApResult, id: string): boolean => (r.verdict.remedies ?? []).some((m) => m.kind === 'authority' && m.authority === 'ap-controller' && m.claims.includes(id))

/** The bill without its tax line, its total rewritten to the lines' sum (the structured conversion writes no bill.tax). */
const noTax = (text: string, total: string): string => text.replace(/Sales tax 8\.25%: USD [\d,.]+\n/, '').replace(/Total due: USD [\d,.]+/, `Total due: USD ${total}`)

const ANNOUNCED = 'Heads up, our old account at Wells Fargo was closed last week. Janet in our office will call you with the replacement info before you cut the check.'

describe('an announced change of payment details, with no instruction verb (B2-bank-subtle.txt)', () => {
  it('0.2.0 approved it, 15 of 15, and said no change of payment details was found (the ruling the review saw)', () => {
    const r = run('B2-bank-subtle.txt', V020)
    expect([r.decision, r.payable]).toEqual(['approve', true])
    expect(r.verdict.coverage).toMatchObject({ claims_pass: 15, claims_fail: 0, claims_insufficient: 0 })
    expect(claim(r, 'ap.remittance')).toBeUndefined()
    expect(payment(r)).toContain('were scanned; none was found')
  })
  it('0.3.0 sends it to a person, names the sentence, and the controller clears it', () => {
    const r = run('B2-bank-subtle.txt', V030)
    expect([r.decision, r.payable]).toEqual(['abstain', false])
    const c = claim(r, 'ap.remittance')!
    expect(c.outcome).toBe('INSUFFICIENT_DATA')
    expect(c.insufficiency?.reason).toBe('AMBIGUOUS_REFERENCE')
    expect(c.explanation).toContain(`invoice line 22: "${ANNOUNCED}"`)
    expect(c.explanation).toMatch(/^the bill announces a change of payment details, or promises new payment instructions/)
    expect(c.explanation).toContain('never one given in the bill, its email, or the call that follows')
    expect(c.computation?.operands?.found).toBe('an announced change of payment details, or a promise of payment instructions')
    expect(c.computation?.operands?.phrasings).toBe(ANNOUNCED_READING)
    expect(controller(r, 'ap.remittance')).toBe(true)
    expect(r.reasons[0]).toMatch(/^cannot decide ap\.remittance: the bill announces a change of payment details/)
    const words = formatApReport(r, { documents: docsOf('B2-bank-subtle.txt') })
    expect(words).toContain('A PERSON DECIDES. Open first: the payment-details check (ap.remittance) found an announced change of payment details, or a promise of payment instructions. Do not pay this bill automatically.')
    expect(words).not.toMatch(/none was found/)
  })
  it('each of the two sentences is read on its own: the closed account, and the promised replacement info', () => {
    const [closed, promise] = ANNOUNCED.split(/(?<=\.) /) as [string, string]
    expect(readSentence(closed, 'Lone Star Electric Supply', { announced: true })).toEqual({ kind: 'announced' })
    expect(readSentence(promise, 'Lone Star Electric Supply', { announced: true })).toEqual({ kind: 'announced' })
    // without the 0.3.0 reading, neither sentence is anything (the 0.2.0 approve)
    expect(readSentence(closed, 'Lone Star Electric Supply')).toBeNull()
    expect(readSentence(promise, 'Lone Star Electric Supply')).toBeNull()
  })
  it('the rule in other words: a detail named as closed or replaced, or a promise of payment instructions; "unchanged" is neither', () => {
    // a person decides on each of these: read as an announced change, or already as a change by the 0.7.0 reading
    const announced = (s: string): boolean => { const r = readSentence(s, 'Lone Star Electric Supply', { announced: true }); return typeof r === 'object' && r !== null && (r.kind === 'announced' || r.kind === 'change') }
    for (const s of [
      'Our lockbox at Frost Bank has been closed.',
      'The routing number on your file is no longer valid.',
      'Our remittance account was replaced this month.',
      'Janet will call you with the replacement info before you cut the check.',
      'Someone from our office will reach out to confirm the new banking details.',
      'Please call Janet to confirm our payment instructions before releasing payment.',
      'We will send updated remittance instructions under separate cover.',
      'Hold payment until our controller confirms where to send the check.',
    ]) expect(announced(s), s).toBe(true)
    for (const s of [
      'Remittance details unchanged.',
      'Our bank account details have not changed.',
      'Questions? Call our AR desk.',
      'Thank you for your business.',
      'Payment terms: net 30.',
      'The PO is now closed; no further deliveries are due.',
      'We will send the packing list with the next delivery.',
      'Remit to: Lone Star Electric Supply, PO Box 4410, Houston TX 77210',
    ]) expect(announced(s), s).toBe(false)
  })
})

describe('the five other redirections keep their rulings; the clean bill approves; the look-alike domain still goes to a person', () => {
  it('B1, B3, R1 to R3: a person decides under both, for the payment-details check, with the same words', () => {
    for (const n of ['B1-bank-explicit.txt', 'B3-bank-w9.txt', 'R1.txt', 'R2.txt', 'R3.txt']) {
      const a = run(n, V020), b = run(n, V030)
      expect([a.decision, a.payable], n).toEqual(['abstain', false])
      expect([b.decision, b.payable], n).toEqual(['abstain', false])
      expect(claim(a, 'ap.remittance')!.explanation, n).toBe(claim(b, 'ap.remittance')!.explanation)
      expect(b.reasons, n).toEqual(a.reasons)
    }
  })
  it('A-clean approves under both; C-lookalike-domain goes to a person under both, for the vendor check', () => {
    for (const v of [V020, V030]) {
      const a = run('A-clean.txt', v)
      expect([a.decision, a.payable], v).toEqual(['approve', true])
      expect(a.verdict.coverage.claims_pass, v).toBe(15)
      const c = run('C-lookalike-domain.txt', v)
      expect([c.decision, c.payable], v).toEqual(['abstain', false])
      expect(c.reasons[0], v).toMatch(/^cannot decide ap\.vendor: .*look-alike/)
    }
  })
})

describe('the approve says "none was found" only when no sentence names payment; otherwise it names each and how it was read', () => {
  it('A-clean: the standing remit-to address is named; the signature "Accounts Receivable" is not a payment sentence', () => {
    const r = run('A-clean.txt', V030)
    const p = payment(r)
    expect(p).toContain('for an account, bank, lockbox, routing or remittance detail named as closed, changed, new, updated or replaced, and for a promise to call, send or confirm payment instructions')
    expect(p).toContain('no sentence was read as an instruction, a change or a promise, though one sentence names payment: invoice line 24 was read as the vendor\'s standing remit-to postal address, which was not checked against the vendor master')
    expect(p).not.toContain('none was found')
    expect(p).toContain('a wording the reading does not parse is not caught')
  })
  it('a bill with a payment-terms sentence names it and says it was read as neither an instruction, a change nor a promise', () => {
    const text = txt('A-clean.txt').replace('Questions? Call our AR desk.', 'Payment terms: net 30 from the invoice date.')
    const r = verifyInvoiceMatch({ ...splitApLayout(text)!, history }, { now: NOW, ruleset: V030 })
    expect(r.decision).toBe('approve')
    expect(payment(r)).toContain('though 2 sentences name payment: invoice line 24 was read as the vendor\'s standing remit-to postal address')
    expect(payment(r)).toContain('invoice line 22, "Payment terms: net 30 from the invoice date.", names payment and was read as neither an instruction about where payment goes, a change of payment details nor a promise of one')
  })
  it('a bill with no payment sentence at all: "none was found, and no sentence of the bill names payment at all"', () => {
    const text = txt('A-clean.txt').replace('Remit to: Lone Star Electric Supply, PO Box 4410, Houston TX 77210\n', '')
    const r = verifyInvoiceMatch({ ...splitApLayout(text)!, history }, { now: NOW, ruleset: V030 })
    expect(r.decision).toBe('approve')
    expect(payment(r)).toContain('were scanned; none was found, and no sentence of the bill names payment at all; a wording')
  })
  it('0.2.0 keeps its wording byte for byte', () => {
    const r = run('A-clean.txt', V020)
    expect(payment(r)).toBe('payment redirection: every sentence of the bill was read for an instruction about where payment goes (a verb of sending, paying, remitting, mailing, wiring, directing or updating with an account, an institution, an address, a lockbox, a link or an assignee as its object, or a change or an attachment about payment details), and the 25 phrasings listed in docs/AP-INPUT.md were scanned; none was found; invoice line 24 was read as the vendor\'s standing remit-to postal address, which was not checked against the vendor master; a wording the reading does not parse is not caught; the vendor\'s bank details are not part of the inputs, so where the payment goes was not checked against the vendor master')
  })
})

describe('four supply-house habits that sent a clean bill to a person', () => {
  it('"1P" for single pole (A-1p.txt): 0.2.0 matched too weakly to check (score 0.3); 0.3.0 approves', () => {
    const a = run('A-1p.txt', V020)
    expect(a.decision).toBe('abstain')
    expect(a.reasons[0]).toContain('invoice line 17, "20A 1P BREAKER", matches purchase-order line 3, "Breaker 20A single pole", too weakly to check (score 0.3)')
    const b = run('A-1p.txt', V030)
    expect([b.decision, b.payable]).toEqual(['approve', true])
    expect(b.verdict.coverage.claims_pass).toBe(15)
    expect(nameScore('20A 1P BREAKER', 'Breaker 20A single pole')).toBeLessThan(0.34)
    expect(nameScore('20A 1P BREAKER', 'Breaker 20A single pole', { poles: true })).toBe(1)
    expect(nameScore('20A 2P BREAKER', 'Breaker 20A single pole', { poles: true })).toBeLessThan(nameScore('20A 2P BREAKER', 'Breaker 20A double pole', { poles: true }))
    // only 1 to 4 poles are read: a "50P" pack count is left as it was
    expect(nameScore('LATEX GLOVES 50P', 'Latex gloves, 50 pack', { poles: true })).toBe(nameScore('LATEX GLOVES 50P', 'Latex gloves, 50 pack'))
  })
  it('a Subtotal line (A-subtotal.txt): 0.2.0 could not place the amount; 0.3.0 reads it as the lines\' sum and approves', () => {
    const a = run('A-subtotal.txt', V020)
    expect(a.decision).toBe('abstain')
    expect(a.reasons[0]).toContain('an amount on the invoice (8878, in "Subtotal: USD 8,878.00") is not a line item, the total, freight, or a known stray')
    const b = run('A-subtotal.txt', V030)
    expect([b.decision, b.payable]).toEqual(['approve', true])
    expect(claim(b, 'ap.total')!.explanation).toBe('The lines add to 8,878.00, plus tax 732.44: 9,610.44 in all; the bill says 9,610.44. The subtotal line (8,878.00) is the lines\' sum.')
    expect(claim(b, 'ap.total')!.evidence.some((e) => e.role === 'CONTEXT' && e.value === 8878)).toBe(true)
  })
  it('a Subtotal line that is not the lines\' sum goes to a person, both figures named (the hold is right, and says why)', () => {
    const text = txt('A-subtotal.txt').replace('Subtotal: USD 8,878.00', 'Subtotal: USD 8,787.00')
    const r = verifyInvoiceMatch({ ...splitApLayout(text)!, history }, { now: NOW, ruleset: V030 })
    expect([r.decision, r.payable]).toEqual(['abstain', false])
    expect(r.reasons[0]).toBe('cannot decide ap.total: the subtotal line (invoice line 19, "Subtotal: USD 8,787.00") says 8,787.00, but the lines read add to 8,878.00: a line may have been misread, or the bill\'s own arithmetic is off; cannot tell which')
    expect(structuredFromText(splitApLayout(noTax(text, '8,878.00'))!, { ruleset: V030 })).toEqual({ ok: false, reason: 'a subtotal line that is not the lines\' sum' })
  })
  it('a distributor\'s invoice number (H-numeric-invno.txt, S104412558.001): 0.2.0 read no number; 0.3.0 reads it after the word "invoice" and approves', () => {
    const a = run('H-numeric-invno.txt', V020)
    expect(a.decision).toBe('abstain')
    expect(a.reasons[0]).toBe('cannot decide ap.duplicate: invoice number unclear, so the duplicate check cannot run')
    const b = run('H-numeric-invno.txt', V030)
    expect([b.decision, b.payable]).toEqual(['approve', true])
    expect(b.grounding.invoice_number).toBe('S104412558.001')
    expect(claim(b, 'ap.duplicate')!.explanation).toBe('Invoice S104412558.001 does not appear among 1 booked invoice(s).')
    // away from the word "invoice" only the hyphenated shape is read; a PO number and a short number never are
    const inv = splitApLayout(txt('H-numeric-invno.txt'))!.invoice
    expect(parseInvoice(inv.replace(/invoice S104412558\.001/gi, 'S104412558.001'), { strictTotals: true, readTax: true, suffixNumbers: true, plainNumbers: true }).invoiceNumber).toBeNull()
    expect(parseInvoice('Invoice 7731 total USD 1.00\nInvoice 2026-10-14', { plainNumbers: true }).invoiceNumber).toBeNull()
    expect(parseInvoice('Invoice 1044125580 for PO-7731', { plainNumbers: true }).invoiceNumber?.value).toBe('1044125580')
  })
  it('wire priced per thousand feet (W-wire-perM.txt): 0.2.0 could not read the line and 11 of 15 checks could not run; 0.3.0 reads 189.00/M as 0.189 and approves, the tax within rounding', () => {
    const a = run('W-wire-perM.txt', V020)
    expect(a.decision).toBe('abstain')
    expect(a.verdict.coverage.claims_insufficient).toBe(11)
    expect(a.reasons[0]).toContain('an amount on the invoice (472.5, in "- 2,500 FT THHN 12 AWG CU STR BLK @ USD 189.00/M = USD 472.50") was not read as a line')
    const b = run('W-wire-perM.txt', V030)
    expect([b.decision, b.payable]).toEqual(['approve', true])
    expect(b.verdict.coverage).toMatchObject({ claims_pass: 15, claims_insufficient: 0 })
    expect(claim(b, 'ap.line[1].price')!.explanation).toContain('invoiced 0.189, PO 0.189')
    expect(claim(b, 'ap.line[1].amount')!.explanation).toContain('2500 × 0.189 = 472.5; the line says 472.5')
    // the bill's tax is three cents under the rate: one cent per taxable line is rounding, so it passes and says so
    expect(claim(b, 'ap.tax')!.outcome).toBe('PASS')
    expect(claim(b, 'ap.tax')!.explanation).toContain('738.91 (under by 0.03, within rounding: 0.01 per taxable line, 0.03 on this bill)')
    // the markers: /M and /C, "per M", "per 1,000", "per hundred"; a lowercase /m is a metre and is not read
    const unit = (line: string): number | undefined => parseInvoice(`Invoice AB-12345\n${line}\nTotal due: USD 1.00`, { pricePer: true }).lines[0]?.unit
    expect(unit('- 2,500 FT WIRE @ USD 189.00/M = USD 472.50')).toBe(0.189)
    expect(unit('- 500 EA SCREWS @ USD 12.50/C = USD 62.50')).toBe(0.125)
    expect(unit('- 2,500 FT WIRE @ USD 189.00 per M = USD 472.50')).toBe(0.189)
    expect(unit('- 2,500 FT WIRE @ USD 189.00 per 1,000 = USD 472.50')).toBe(0.189)
    expect(unit('- 500 EA SCREWS @ USD 12.50 per hundred = USD 62.50')).toBe(0.125)
    expect(parseInvoice('Invoice AB-12345\n- 2,500 FT WIRE @ USD 189.00/m = USD 472.50\nTotal due: USD 1.00', { pricePer: true }).lines).toEqual([])
  })
})

describe('ruleset 0.3.0 is minted and selectable; 0.2.0 stays the default and re-performs byte for byte', () => {
  it('is the default from engine 0.7.2; an engine before it keeps 0.2.0 and never throws for want of a named ruleset', () => {
    expect(defaultApRuleset('0.7.1')).toBe(AP_RULESET_V0_2_0)
    expect(defaultApRuleset('0.7.2')).toBe(AP_RULESET_V0_3_0)
    expect(() => verifyInvoiceMatch(docsOf('A-clean.txt'), { now: NOW, engine: '0.6.0' })).not.toThrow()
    expect(verifyInvoiceMatch(docsOf('B2-bank-subtle.txt'), { now: NOW, engine: '0.7.1' }).decision).toBe('approve')
    expect(verifyInvoiceMatch(docsOf('B2-bank-subtle.txt'), { now: NOW, engine: '0.7.2' }).decision).not.toBe('approve')
  })
  it('resolves, lists, and is refused under an engine before 0.7.0', () => {
    expect(AP_RULESET).toBe(AP_RULESET_V0_3_0)
    expect(resolveApRuleset(V030)).toBe(AP_RULESET_V0_3_0)
    expect(resolveApRuleset({ id: 'ap-threeway', version: '0.3.0' })).toBe(AP_RULESET_V0_3_0)
    // 2026-10-19: 0.4.0 is minted beside it (test/ap-040.test.ts); 0.3.0 stays the default under engine 0.7.2
    expect(AP_RULESET_VERSIONS.map((v) => v.version)).toEqual(['0.4.0', '0.3.0', '0.2.0', '0.1.0'])
    expect([readsAs030(AP_RULESET_V0_3_0), readsAs030(AP_RULESET_V0_2_0)]).toEqual([true, false])
    expect(() => verifyInvoiceMatch(docsOf('A-clean.txt'), { now: NOW, ruleset: V030, engine: '0.6.0' })).toThrow(/ap-threeway@0\.3\.0 needs engine 0\.7\.0 or later/)
    expect(() => verifyInvoiceMatch(docsOf('A-clean.txt'), { now: NOW, ruleset: V030, engine: '0.7.0' })).not.toThrow()
  })
  it('the two versions share the input identity and differ in the verdict id; a 0.3.0 verdict replays from its inputs', () => {
    const d = docsOf('B2-bank-subtle.txt')
    const a = verifyInvoiceMatch(d, { now: NOW, ruleset: V020 }).verdict, b = verifyInvoiceMatch(d, { now: NOW, ruleset: V030 }).verdict
    expect(a.input_hash).toBe(b.input_hash)
    expect(a.verdict_id).not.toBe(b.verdict_id)
    expect([a.ruleset.version, b.ruleset.version]).toEqual(['0.2.0', '0.3.0'])
    expect(verifyReplay(b, { ap: d, policy: { price_tolerance: 0.02, total_tolerance: 0.005 } })).toMatchObject({ ok: true, status: 'REPERFORMED', outcome_verified: true })
  })
  it('the text reading converts to structured input under 0.3.0 for the bills it now reads, and refuses the announced change', () => {
    // the conversion writes no bill.tax, so the bills are converted without their tax line
    const totals: Record<string, string> = { 'A-1p.txt': '8,878.00', 'A-subtotal.txt': '8,878.00', 'H-numeric-invno.txt': '8,878.00', 'W-wire-perM.txt': '8,956.50' }
    for (const n of ['A-1p.txt', 'A-subtotal.txt', 'H-numeric-invno.txt', 'W-wire-perM.txt']) {
      expect(structuredFromText(splitApLayout(noTax(txt(n), totals[n]!))!, { ruleset: V030 }).ok, n).toBe(true)
      // under 0.2.0 (the default through engine 0.7.1) the same four are declined for the reasons of reading they had
      expect(structuredFromText(splitApLayout(noTax(txt(n), totals[n]!))!, { ruleset: V020 }).ok, n).toBe(false)
      // and under the default from engine 0.7.2 they are read
      expect(structuredFromText(splitApLayout(noTax(txt(n), totals[n]!))!).ok, n).toBe(true)
    }
    expect(structuredFromText(splitApLayout(noTax(txt('B2-bank-subtle.txt'), '8,878.00'))!, { ruleset: V030 })).toEqual({ ok: false, reason: expect.stringMatching(/announced change/) })
    // under 0.2.0 the announced change converts; under the default from engine 0.7.2 it is refused, the sentence named
    expect(structuredFromText(splitApLayout(noTax(txt('B2-bank-subtle.txt'), '8,878.00'))!, { ruleset: V020 }).ok).toBe(true)
    expect(structuredFromText(splitApLayout(noTax(txt('B2-bank-subtle.txt'), '8,878.00'))!)).toEqual({ ok: false, reason: expect.stringMatching(/announced change/) })
  })
  it('readRemittance without `announced` does not read the announced sentence; with it, the line is a hit of kind announced', () => {
    expect(readRemittance(ANNOUNCED, { sentences: true, vendor: 'Lone Star Electric Supply' })).toEqual([])
    const hits = readRemittance(ANNOUNCED, { announced: true, vendor: 'Lone Star Electric Supply' })
    expect(hits).toHaveLength(1)
    expect(hits[0]!.kind).toBe('announced')
    expect(hits[0]!.matched).toEqual([ANNOUNCED_READING])
  })
})
