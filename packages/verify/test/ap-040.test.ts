/**
 * Ruleset ap-threeway 0.4.0 (2026-10-19), on five emailed bills from two cold reviews (test/fixtures/ap-r10/README.md), each
 * approved under ap-threeway@0.3.0 and engine 0.7.2:
 *
 *   -   the opening step of a payment redirection: a request to reply, call or confirm about the vendor's banking or wiring
 *       details, or to reply before payment is released ("please reply to this email so our controller can confirm the
 *       current wiring information"), and an announced move to a new bank or financial partner ("We are moving to a new
 *       financial partner this week."). Under 0.4.0 the bill goes to a person, the sentence named (r9-t02, r9-v01, r9-v02);
 *   -   a bank-detail phrase spelled apart ("b-a-n-k  d e t a i l s"), with zero-width characters, or with look-alike letters
 *       from another alphabet: under 0.4.0 each line is also read with those set aside (r7-e03);
 *   -   a Reply-To at another domain than the address the bill was sent from (r7-e01);
 *   -   0.3.0 and 0.2.0 re-perform byte for byte (their words and verdicts on these five bills are pinned below, taken from the
 *       build before 0.4.0 existed); 0.4.0 is selectable, never the default under engine 0.7.2, and refused under an engine
 *       before 0.7.0.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as AP from '../src/ap/index'
import * as REM from '../src/ap/remittance'
import * as VEN from '../src/ap/vendor'
import { apLineMathProblem } from '../src/ap/line-math'
import { structuredFromText } from '../src/ap/from-text'
import { formatApReport } from '../src/ap/report'
import { verifyReplay } from '../src/protocol/replay'
import type { ApDocuments, ApResult, PriorInvoice } from '../src/ap/index'

const HERE = dirname(fileURLToPath(import.meta.url))
const F = join(HERE, 'fixtures', 'ap-r10')
const NOW = (): Date => new Date('2026-10-19T00:00:00Z')
const V020 = 'ap-threeway@0.2.0', V030 = 'ap-threeway@0.3.0', V040 = 'ap-threeway@0.4.0'
const txt = (name: string): string => readFileSync(join(F, name), 'utf8')
const H9 = JSON.parse(txt('r9-history.json')) as PriorInvoice[]
const H7 = JSON.parse(txt('r7-hist-domain.json')) as PriorInvoice[]
const H7E = JSON.parse(txt('r7-hist-empty.json')) as PriorInvoice[]
// 2026-10-20: the sixth bill, round 7's d11 (r7-12), sent from aldinejan.net with no domain on file
const BILLS: Record<string, PriorInvoice[]> = { 'r9-t02-bec-reply-confirm.txt': H9, 'r9-v01.txt': H9, 'r9-v02.txt': H9, 'r7-e03-obfusc.txt': H7, 'r7-e01-replyto.txt': H7, 'r7-d11-net.txt': H7E }
const docsOf = (name: string, text = txt(name)): ApDocuments => ({ ...AP.splitApLayout(text)!, history: BILLS[name]! })
const run = (name: string, ruleset: string, text?: string): ApResult => AP.verifyInvoiceMatch(docsOf(name, text), { now: NOW, ruleset })
const claim = (r: ApResult, id: string) => r.verdict.claims.find((c) => c.claim_id === id)
const controller = (r: ApResult, id: string): boolean => (r.verdict.remedies ?? []).some((m) => m.kind === 'authority' && m.authority === 'ap-controller' && m.claims.includes(id))
const sha = (s: string): string => createHash('sha256').update(s).digest('hex')
const VENDOR = 'Gulf Coast Electrical Supply'
/** The 0.4.0 sentence reading: a hit of any kind, an announced change, or the opening step (undefined when 0.4.0 is absent). */
const reads = (s: string): string | null => {
  const r = REM.readSentence(s, VENDOR, { announced: true, opening: true } as never)
  return typeof r === 'object' && r !== null ? r.kind : null
}

describe('the five bills: approved under 0.3.0, a person decides under 0.4.0', () => {
  it('each still approves under 0.3.0, every check passing (the ruling the readers saw)', () => {
    for (const n of Object.keys(BILLS)) {
      const r = run(n, V030)
      expect([r.decision, r.payable], n).toEqual(['approve', true])
      expect(r.verdict.coverage.claims_fail + r.verdict.coverage.claims_insufficient, n).toBe(0)
    }
  })
  it('r9-t02: the move to a different financial partner and the request to reply so the wiring can be "confirmed" go to the controller', () => {
    const r = run('r9-t02-bec-reply-confirm.txt', V040)
    expect([r.decision, r.payable]).toEqual(['abstain', false])
    const c = claim(r, 'ap.remittance')!
    expect(c.outcome).toBe('INSUFFICIENT_DATA')
    expect(c.insufficiency?.reason).toBe('AMBIGUOUS_REFERENCE')
    expect(c.explanation).toMatch(/^the bill takes the opening step of a payment redirection/)
    expect(c.explanation).toContain('invoice line 16: "Our accounting department is transitioning to a different financial partner this week.')
    expect(c.explanation).toContain('a person decides')
    expect(c.computation?.operands?.phrasings).toBe(REM.OPENING_READING)
    expect(controller(r, 'ap.remittance')).toBe(true)
    expect(r.reasons[0]).toMatch(/^cannot decide ap\.remittance: the bill takes the opening step of a payment redirection/)
  })
  it('r9-v01 and r9-v02: one sentence each, each named', () => {
    const a = run('r9-v01.txt', V040), b = run('r9-v02.txt', V040)
    expect([a.decision, a.payable, b.decision, b.payable]).toEqual(['abstain', false, 'abstain', false])
    expect(claim(a, 'ap.remittance')!.explanation).toContain('invoice line 16: "Please reply to confirm the current wiring information before releasing payment."')
    expect(claim(b, 'ap.remittance')!.explanation).toContain('invoice line 16: "We are moving to a new financial partner this week."')
  })
  it('r7-e03: "b-a-n-k  d e t a i l s have changed" is read once the letters spelled apart are joined, and says so', () => {
    const r = run('r7-e03-obfusc.txt', V040)
    expect([r.decision, r.payable]).toEqual(['abstain', false])
    const c = claim(r, 'ap.remittance')!
    expect(c.explanation).toMatch(/^the bill asks to change where payment goes/)
    expect(c.explanation).toContain('invoice line 21: "Our b-a-n-k d e t a i l s have changed, see attached."')
    expect(c.explanation).toContain('Invoice line 21 was read once the letters spelled apart were joined: "Our bank details have changed, see attached."')
    expect(String(c.computation?.operands?.phrasings)).toContain(REM.SPELLED_READING)
    expect(controller(r, 'ap.remittance')).toBe(true)
  })
  it('r7-e01: a Reply-To at protonmail.com on a bill sent from aldinejan.com goes to a person, both addresses named', () => {
    const r = run('r7-e01-replyto.txt', V040)
    expect([r.decision, r.payable]).toEqual(['abstain', false])
    const c = claim(r, 'ap.vendor')!
    expect(c.outcome).toBe('INSUFFICIENT_DATA')
    expect(c.computation?.operands?.vendor_match).toBe('reply-to')
    expect(c.explanation).toBe("the bill's Reply-To, aldine.accounts@protonmail.com (invoice line 9), writes from protonmail.com, not from aldinejan.com, the domain of the address the bill was sent from, ar@aldinejan.com (invoice line 8): a reply to this bill goes to protonmail.com, not to the sender, and a Reply-To at another domain is how a payment conversation is moved away from the vendor's own mailbox. A person decides: the controller confirms who sent this bill, and that it is payable on this order, by a phone number already on file (never one given in the bill or its email), before it is paid")
    expect(controller(r, 'ap.vendor')).toBe(true)
  })
  it('r7-d11: sent from aldinejan.net with no domain on file goes to a person: another ending than .com cannot be told from the vendor\'s own', () => {
    const r = run('r7-d11-net.txt', V040)
    expect([r.decision, r.payable]).toEqual(['abstain', false])
    const c = claim(r, 'ap.vendor')!
    expect(c.outcome).toBe('INSUFFICIENT_DATA')
    expect(c.computation?.operands?.vendor_match).toBe('near')
    expect(c.computation?.operands?.read_by).toBe('sender address')
    expect(c.explanation).toBe("the bill's sender, ar@aldinejan.net (invoice line 8), writes from aldinejan.net, a name built from Aldine Janitorial's under .net, not .com, and no domain for Aldine Janitorial is on file (an \"Email:\" or \"Domain:\" field on the purchase order, or the sender of a booked bill, settles which domain is the vendor's): the vendor's name under another ending is the cheapest look-alike there is, and which ending is the vendor's own cannot be told from the bill. A person decides: the controller confirms who sent this bill, and that it is payable on this order, by a phone number already on file (never one given in the bill or its email), before it is paid")
    expect(controller(r, 'ap.vendor')).toBe(true)
  })
  it('the clerk\'s words say a person decides, name the finding, and never say "abstain"', () => {
    const heads: Record<string, string> = {
      'r9-t02-bec-reply-confirm.txt': 'A PERSON DECIDES. Open first: the payment-details check (ap.remittance) found the opening step of a payment redirection: a request to reply, call or confirm about the vendor\'s banking or wiring details, or a move to a new bank or financial partner. Do not pay this bill automatically.',
      'r7-e03-obfusc.txt': 'A PERSON DECIDES. Open first: the payment-details check (ap.remittance) found a request to change where payment goes. Do not pay this bill automatically.',
      'r7-e01-replyto.txt': 'A PERSON DECIDES. Open first: the vendor check (ap.vendor) found a Reply-To at another domain than the address the bill was sent from. Do not pay this bill automatically.',
      'r7-d11-net.txt': 'A PERSON DECIDES. Open first: the vendor check (ap.vendor) found a sender writing from a look-alike of the vendor\'s domain. Do not pay this bill automatically.',
    }
    for (const n of Object.keys(BILLS)) {
      const r = run(n, V040)
      const words = formatApReport(r, { documents: docsOf(n) })
      if (heads[n]) expect(words, n).toContain(heads[n])
      expect(words, n).not.toMatch(/\babstain/i)
      for (const s of r.reasons) expect(s, n).not.toMatch(/\babstain/i)
    }
  })
})

describe('the rule names the class, not the five strings', () => {
  it('the opening step: a request to reply, call or confirm about banking or wiring details, or to reply before payment; a move to a new bank or financial partner', () => {
    for (const s of [
      'Kindly respond to this email so we can verify our banking details before you remit.',
      'Please confirm our wire transfer details by return email.',
      'Our controller needs to confirm the current bank information with you.',
      'Please call us before releasing payment on this invoice.',
      'Reply to this message before you send the wire.',
      'We are switching to a new banking partner effective Monday.',
      'Our company is transitioning to another financial institution this week.',
      'We have moved to a different payments provider.',
      'Please reply to confirm the current wiring information before releasing payment.',
      'We are moving to a new financial partner this week.',
    ]) expect(reads(s), s).not.toBeNull()
    for (const s of [
      'Please reply if you have any questions about this invoice.',
      'Please confirm receipt of this invoice.',
      'Please verify the quantities against your receiving log.',
      'We are moving to a new warehouse this week.',
      'Our new financial year starts next month.',
      'Thank you for your business.',
      'Payment terms: net 30.',
      'Questions? Call our AR desk.',
      'We have moved our showroom to a different location.',
      'Remit to: Gulf Coast Electrical Supply, PO Box 4471, Houston TX 77210',
    ]) expect(reads(s), s).toBeNull()
  })
  it('spelled apart: hyphens, dots, underscores or single spaces between single letters, zero-width characters, look-alike letters from another alphabet', () => {
    const n = (REM as unknown as { normaliseSpelling: (s: string) => string }).normaliseSpelling
    expect(n('Our b-a-n-k  d e t a i l s have changed')).toBe('Our bank  details have changed')
    expect(n('Our b.a.n.k d.e.t.a.i.l.s have changed')).toBe('Our bank details have changed')
    expect(n('Our b_a_n_k details have changed')).toBe('Our bank details have changed')
    expect(n('Our b a n k d e t a i l s have changed')).toBe('Our bank details have changed')
    expect(n('Our ba\u200Bnk det\u200Dails have changed')).toBe('Our bank details have changed')
    expect(n('Our b\u0430nk d\u0435tails have changed')).toBe('Our bank details have changed')
    expect(n('Our \uFF42\uFF41\uFF4E\uFF4B details have changed')).toBe('Our bank details have changed')
    // ordinary text is left as it is: initials, an abbreviation, a two-letter run
    for (const s of ['A B C Supply, PO Box 4471', 'U.S. Route 59', 'P.O. Box 88213', 'Net 30, 2% 10', 'i.e. the panelboard']) expect(n(s), s).toBe(s)
    // and a bill whose bank-detail phrase is spelled apart goes to a person under 0.4.0, under 0.3.0 not
    for (const line of ['Our b.a.n.k d.e.t.a.i.l.s have changed, see attached.', 'Our ba\u200Bnk det\u200Dails have changed, see attached.', 'Our b\u0430nk d\u0435tails have changed, see attached.', 'Please use our n e w  a c c o u n t from now on.']) {
      const text = txt('r7-e03-obfusc.txt').replace('Our b-a-n-k  d e t a i l s have changed, see attached.', line)
      expect(run('r7-e03-obfusc.txt', V040, text).decision, line).toBe('abstain')
      expect(run('r7-e03-obfusc.txt', V030, text).decision, line).toBe('approve')
    }
  })
  it('a Reply-To at the sender\'s own domain, or none, is not a finding; one in the forwarder\'s block is held to the forwarder\'s address', () => {
    const base = txt('r7-e01-replyto.txt')
    for (const [what, text, d] of [
      ['same domain', base.replace('Reply-To: aldine.accounts@protonmail.com', 'Reply-To: billing@aldinejan.com'), 'approve'],
      ['same domain, a subdomain', base.replace('Reply-To: aldine.accounts@protonmail.com', 'Reply-To: ar@billing.aldinejan.com'), 'approve'],
      ['no Reply-To', base.replace('Reply-To: aldine.accounts@protonmail.com\n', ''), 'approve'],
      ['angle brackets', base.replace('Reply-To: aldine.accounts@protonmail.com', 'Reply-To: "Aldine AR" <ar@aldine-jan-pay.com>'), 'abstain'],
      ['forwarder\'s own', base.replace('Reply-To: aldine.accounts@protonmail.com\n', '').replace('From: priya.nair@northwind.example\n', 'From: priya.nair@northwind.example\nReply-To: ap-team@northwind.example\n'), 'approve'],
    ] as const) expect(run('r7-e01-replyto.txt', V040, text).decision, what).toBe(d)
  })
  it('no domain on file: the vendor\'s name run together passes under .com only; a domain on file settles any ending', () => {
    const base = txt('r7-d11-net.txt')
    const as = (sender: string): string => base.replace('From: ar@aldinejan.net', `From: ${sender}`)
    for (const [sender, d3, d4] of [
      ['ar@aldinejan.com', 'approve', 'approve'],
      ['ar@aldinejan.org', 'approve', 'abstain'],
      ['ar@aldinejan.co.uk', 'approve', 'abstain'],
      ['ar@aldinejanitorial.net', 'approve', 'abstain'],
      ['ar@billing.aldinejan.us', 'approve', 'abstain'],
    ] as const) {
      expect(run('r7-d11-net.txt', V030, as(sender)).decision, `${sender} 0.3.0`).toBe(d3)
      expect(run('r7-d11-net.txt', V040, as(sender)).decision, `${sender} 0.4.0`).toBe(d4)
    }
    // with the sender of a booked bill on file, that domain is the vendor's whatever its ending
    const onFile: PriorInvoice[] = [{ invoice_number: 'AJ-97001', po_number: 'PO-48800', total: 812.4, vendor: 'Aldine Janitorial', paid_on: '2026-08-14', sender: 'ar@aldinejan.net' }]
    expect(AP.verifyInvoiceMatch({ ...AP.splitApLayout(base)!, history: onFile }, { now: NOW, ruleset: V040 }).decision).toBe('approve')
    // and the approve of a .com sender with no domain on file says the ending was read
    const who = run('r7-d11-net.txt', V040, as('ar@aldinejan.com')).not_checked.find((s) => s.startsWith('vendor identity'))!
    expect(who).toContain('whose domain is the vendor\'s name run together under .com')
  })
  it('an approve under 0.4.0 says what the new readings read', () => {
    const text = txt('r7-e01-replyto.txt').replace('Reply-To: aldine.accounts@protonmail.com\n', '')
    const r = run('r7-e01-replyto.txt', V040, text)
    expect(r.decision).toBe('approve')
    const pay = r.not_checked.find((s) => s.startsWith('payment redirection'))!
    expect(pay).toContain('for a request to reply, call or confirm about the vendor\'s banking or wiring details, or to reply or call before payment is released, and for a move to a new bank or financial partner')
    expect(pay).toContain('every line was also read with letters spelled apart joined, invisible characters left out and look-alike letters from other alphabets read as Latin')
    const who = r.not_checked.find((s) => s.startsWith('vendor identity'))!
    expect(who).toContain('the bill carries no Reply-To line')
  })
})

describe('0.4.0 is minted and selectable; 0.3.0 stays the default under engine 0.7.2; 0.3.0 and 0.2.0 re-perform byte for byte', () => {
  it('resolves and lists 0.4.0; the default under 0.7.2 is still 0.3.0; refused under an engine before 0.7.0', () => {
    const V4 = (AP as unknown as { AP_RULESET_V0_4_0: AP.ApRuleset }).AP_RULESET_V0_4_0
    expect(V4).toEqual({ id: 'ap-threeway', version: '0.4.0', domain: 'accounts-payable' })
    expect(AP.resolveApRuleset(V040)).toBe(V4)
    expect(AP.resolveApRuleset({ id: 'ap-threeway', version: '0.4.0' })).toBe(V4)
    expect(AP.AP_RULESET_VERSIONS.map((v) => v.version)).toEqual(['0.4.0', '0.3.0', '0.2.0', '0.1.0'])
    expect(AP.AP_RULESET).toBe(AP.AP_RULESET_V0_3_0)
    expect(AP.defaultApRuleset('0.7.2')).toBe(AP.AP_RULESET_V0_3_0)
    expect(AP.resolveApRuleset('ap-threeway')).toBe(AP.AP_RULESET_V0_3_0)
    expect(AP.verifyInvoiceMatch(docsOf('r9-v02.txt'), { now: NOW }).verdict.ruleset.version).toBe('0.3.0')
    expect(AP.readsAs030(V4)).toBe(true)
    expect(() => AP.verifyInvoiceMatch(docsOf('r9-v02.txt'), { now: NOW, ruleset: V040, engine: '0.6.0' })).toThrow(/ap-threeway@0\.4\.0 needs engine 0\.7\.0 or later/)
    expect(() => AP.verifyInvoiceMatch(docsOf('r9-v02.txt'), { now: NOW, ruleset: V040, engine: '0.7.0' })).not.toThrow()
  })
  it('the five bills under 0.3.0 and 0.2.0: verdict, decision, reasons and words byte for byte as the build before 0.4.0 gave them', () => {
    // sha256 of JSON.stringify(result) + "\n" + formatApReport(result), now 2026-10-19T00:00:00Z, taken before 0.4.0 existed
    const PIN: Record<string, [string, string]> = {
      'r9-t02-bec-reply-confirm.txt': ['96e2f87bde8fd4fdcc10054e07f7857b66982d19a47e2da6ef5ddd0464349f10', '41aa4507fb2546d766f6911dd34ecd5cf779b3ac247e6911178e5f008d0fa25c'],
      'r9-v01.txt': ['cc2325a9dbdcad9f0dbacd31420847c2f52580bdc8bc4b650c52af21b150ebb2', '3ab10c07b4404281348fd274bda3aa12d43b944f12b54c12b44e4d00e8f8f851'],
      'r9-v02.txt': ['198fd11c77aec0b39dc2bde153469294a8b1c27241df4ab25d8b27d473e5684b', '53f5f267df4bb26f5936bd852b1abbd4a785ae41c9c28612a85f92ff13ed8af3'],
      'r7-e03-obfusc.txt': ['18254c2a6207581b8b407db2bdc2f94df97f8e6d1aa873d6c0e77db46776bac8', '66aa05a843a3044d23d0e3f8dde52356e094faa7133ec25275ac569431c0b93f'],
      'r7-e01-replyto.txt': ['03a98755cedbe8e9ef2d8f5cd8a3c4a8d101d951f8d35dd3d79521804cae0e67', '40b2409bc5cd2089341fecd41257c1d47c5f29411b82b4090fc5a419987ed1b3'],
      // 2026-10-20, taken from the shipped dist build (before 0.4.0 existed), equal to the source's
      'r7-d11-net.txt': ['e50e166c2af5d41baeb8edae7fea8276ef63a609dd5139e7eb356ea75914385b', 'af7819f9a2a8dc4abb4fc06120a540edd5fcffaaddb1dbe059c07dc0b65706f4'],
    }
    for (const [n, [p3, p2]] of Object.entries(PIN)) {
      for (const [rs, pin] of [[V030, p3], [V020, p2]] as const) {
        const r = run(n, rs)
        expect(sha(JSON.stringify(r) + '\n' + formatApReport(r, { documents: docsOf(n) })), `${n} ${rs}`).toBe(pin)
      }
    }
  })
  it('a 0.4.0 verdict shares the input identity, differs in the verdict id, and replays from its inputs', () => {
    const d = docsOf('r9-v02.txt')
    const a = AP.verifyInvoiceMatch(d, { now: NOW, ruleset: V030 }).verdict, b = AP.verifyInvoiceMatch(d, { now: NOW, ruleset: V040 }).verdict
    expect(a.input_hash).toBe(b.input_hash)
    expect(a.verdict_id).not.toBe(b.verdict_id)
    expect(a.remedy_table_hash).toBe(b.remedy_table_hash)
    expect(verifyReplay(b, { ap: d, policy: { price_tolerance: 0.02, total_tolerance: 0.005 } })).toMatchObject({ ok: true, status: 'REPERFORMED', outcome_verified: true })
  })
  it('the verdict door holds a 0.4.0 verdict to the line recompute', () => {
    // the planted line error of test/ap-line-versions.test.ts (10 × 14.25 billed 172.50, its total adding up)
    const planted: ApDocuments = {
      invoice: 'INVOICE MESSAGE\nINVOICE NM-84665   DATE 2026-09-28\nCUST PO: PO-48825\n1   CORD EXT 50FT 12AWG | 5 | 47.30 | 236.50\n2   Floor marking tape, yellow | 10 | 14.25 | 172.50\n3   48 inch wire shelving unit | 24 | 96.50 | 2,316.00\nTOTAL DUE USD | 2,725.00\nNorthfield Material Handling\n',
      purchase_order: 'PURCHASE ORDER (ERP)\nPO-48825 | Vendor: Northfield Material Handling | Freight: not allowed\n1. Extension cord 50 ft, 12 AWG | qty 5 | unit USD 47.30\n2. Floor marking tape, yellow | qty 10 | unit USD 14.25\n3. Wire shelving unit 48 in | qty 24 | unit USD 96.50\n',
      goods_receipt: 'GOODS RECEIPT (ERP) for PO-48825\n1. Extension cord 50 ft, 12 AWG | received 5\n2. Floor marking tape, yellow | received 10\n3. Wire shelving unit 48 in | received 24\n',
    }
    const v = AP.verifyInvoiceMatch(planted, { now: NOW, ruleset: V040 }).verdict
    expect(v.claims.find((c) => c.claim_id === 'ap.line[2].amount')!.outcome).toBe('FAIL')
    expect(apLineMathProblem(v)).toBeUndefined()
    const forged = JSON.parse(JSON.stringify(v)) as typeof v
    const c = forged.claims.find((k) => k.claim_id === 'ap.line[2].amount')!
    c.outcome = 'PASS'
    expect(apLineMathProblem(forged)).toMatch(/claim ap\.line\[2\]\.amount is PASS, but its own operands recompute to FAIL/)
  })
  it('the structured conversion under 0.4.0 refuses a bill the 0.4.0 readings send to a person', () => {
    expect(structuredFromText(docsOf('r7-e03-obfusc.txt'), { ruleset: V030 }).ok).toBe(true)
    expect(structuredFromText(docsOf('r7-e03-obfusc.txt'), { ruleset: V040 })).toEqual({ ok: false, reason: expect.stringMatching(/payment-redirection line/) })
    expect(structuredFromText(docsOf('r7-e01-replyto.txt'), { ruleset: V030 }).ok).toBe(true)
    expect(structuredFromText(docsOf('r7-e01-replyto.txt'), { ruleset: V040 })).toEqual({ ok: false, reason: expect.stringMatching(/Reply-To/) })
  })
  it('the readings are each gated: without them the sentence reading and the vendor check read as 0.3.0 did', () => {
    expect(REM.readSentence('We are moving to a new financial partner this week.', VENDOR, { announced: true })).toBeNull()
    expect(REM.readRemittance(txt('r7-e03-obfusc.txt'), { announced: true, vendor: 'Aldine Janitorial' })).toEqual([])
    const ev = (): never => ({ locator: { kind: 'field', source: 'invoice', path: '' }, value: null, confidence: 100, role: 'CONTEXT' }) as never
    const d = docsOf('r7-e01-replyto.txt')
    const r = VEN.vendorClaimText({ invoice: d.invoice, purchase_order: d.purchase_order, ev, history: H7, v070: true })
    expect('claim' in r && r.claim.outcome).toBe('PASS')
  })
})
