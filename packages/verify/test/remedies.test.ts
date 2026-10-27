/**
 * Typed remedies (2026-10-02; src/verdict/remedy.ts, docs/REMEDIES.md). Every non-PASS verdict carries remedies; a remedy
 * never changes a verdict; verdict ids do not move. The frozen pins below were computed from the engine BEFORE remedies
 * existed (the same inputs, the same clock): each verdict here, with its `remedies` removed, must hash exactly as before.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import {
  verify, verifyDeclarative, verifyInvoiceMatch, splitApLayout, verifyCitations, verifyAction, lintRuleset, rulesetIdentity,
  INVOICE_RULESET, PAY_APP_RULESET, AP_REMEDIES, LEGAL_REMEDIES, REMEDY_KINDS, REMEDY_TRANSFORMS, remediesFor, attachRemedies,
  withoutRemedies, remedyTableProblems, normalizeDeclaration, canonicalize,
  type Verdict, type DeclarativeRuleset, type RemedyTable,
} from '../src/index'
import * as inv from './fixtures/invoices'
import * as pay from './fixtures/pay-apps'

const HERE = dirname(fileURLToPath(import.meta.url))
const NOW = (): Date => new Date('2026-10-02T00:00:00.000Z')
const sha = (s: string): string => createHash('sha256').update(s).digest('hex')
type J = Record<string, unknown>

const OPINIONS = {
  Twombly: 'To survive a motion to dismiss, a complaint must contain sufficient factual matter to state a claim to relief that is plausible on its face. A pleading that offers labels and conclusions will not do.',
  Carlisle: 'The court holds that the arbitration clause is unenforceable because it was procured by fraud in the inducement. Accordingly, the order compelling arbitration is reversed.',
}
const AP_CASES = readFileSync(join(HERE, '..', 'data', 'real', 'D-ap-distil', 'invoice_cases.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { id: string; input: string; decision: string })
/** The engine an example is made under (2026-10-03): this build's, or '0.0.1' for the frozen pins, which that engine made. */
const eng = (engine?: string): { engine?: string } => (engine !== undefined ? { engine } : {})
const ap = (decision: string, engine?: string): Verdict => verifyInvoiceMatch(splitApLayout(AP_CASES.find((c) => c.decision === decision)!.input)!, { now: NOW, ...eng(engine) }).verdict
const v = (x: J, refs: { contract?: J; evidence?: J[]; history?: J[] }, ruleset: 'invoice' | 'pay-app' = 'invoice', engine?: string): Verdict => verify(x, { ruleset, references: refs, now: NOW, ...eng(engine) })

/** The examples, built exactly as they were captured before remedies existed. */
const EXAMPLES: Record<string, (engine?: string) => Verdict> = {
  'invoice-broken': (e) => v(inv.broken, {}, 'invoice', e),
  'invoice-no-subtotal': (e) => v(inv.noSubtotal, {}, 'invoice', e),
  'invoice-over-rate': (e) => v(inv.singleLine, { contract: inv.contractOverRate }, 'invoice', e),
  'invoice-short-delivery': (e) => v(inv.singleLine, { evidence: [inv.evidenceShort] }, 'invoice', e),
  'invoice-duplicate': (e) => v(inv.withPriorIds, {}, 'invoice', e),
  'invoice-out-of-term': (e) => v(inv.singleLineOutOfTerm, { contract: inv.contractOk }, 'invoice', e),
  'invoice-multi-rate': (e) => v(inv.singleLine, { contract: inv.contractMultiRate }, 'invoice', e),
  'pay-app-broken': (e) => v(pay.brokenApp, { history: [pay.prevApp] }, 'pay-app', e),
  'pay-app-bare-percent': (e) => v(pay.barePercent, {}, 'pay-app', e),
  'pay-app-drift': (e) => v(pay.driftApp, { history: [pay.prevApp] }, 'pay-app', e),
  'ap-hold-price': (e) => ap('hold_price', e),
  'ap-hold-quantity': (e) => ap('hold_quantity', e),
  'ap-hold-no-po': (e) => ap('hold_no_po', e),
  'ap-hold-total': (e) => ap('hold_total', e),
  'legal-mixed': (e) => verifyCitations([
    { id: '1', case_name: 'Twombly', quote: 'plausible on its face' },
    { id: '2', case_name: 'Carlisle', quote: 'the arbitration clause is VALID because it was procured by fraud' },
    { id: '3', case_name: 'Ghost', cite: '1 F.4th 1', quote: 'anything' },
    { id: '4', case_name: 'Carlisle', proposition: 'fraud voids arbitration' },
  ], OPINIONS, { now: NOW, ...eng(e) }),
  'legal-not-found': (e) => verifyCitations([{ id: '5', case_name: 'Twombly', quote: 'a complaint need only recite the elements' }], OPINIONS, { now: NOW, ...eng(e) }),
}

/** sha256(JSON.stringify(verdict)) as the engine produced it BEFORE remedies (2026-10-02, tmp capture; identical clock). */
const PRE_REMEDY_SHA: Record<string, string> = {
  'invoice-broken': 'f777cc590bc42443c92894f1b8f0fa063accaa1c7ee83dc703fac1da7f1e24d8',
  'invoice-no-subtotal': 'e599de4df9d96ccf0d03386a93122465f7f35fb30a5a5ec47e1d54b392505a30',
  'invoice-over-rate': 'a8e36e3724a249c1a35c9fec9fb2d62b4f7e985115b4068124025a8247edf07b',
  'invoice-short-delivery': 'be3fc9959dc875204ad044be292d9e61471bb7b25a71479f0c309b19747a0f18',
  'invoice-duplicate': '805a6a966a473e9309e75620ca1ed1dfdfa4e007f7deee568f323eb5822994e2',
  'invoice-out-of-term': '2efa8b32cc64e4f713ab74da769933c127905234c9eaf5ccd6dffea2c89f9439',
  'invoice-multi-rate': '26bb2c8e3b5f6de4951a0c7641e447388d5f0a701bd5b7fe153be9da62cb0f9b',
  'pay-app-broken': '1470d903dd81dca900bc897996af4a5563c02834abe7171ef1c42107345a400c',
  'pay-app-bare-percent': 'f78ae7e0c05401839ffa189ee406a931c96cc34bbe26679763eeb3a04107c00a',
  'pay-app-drift': '9f7aa7355407543e90f42a72fabda5030f70ae996e5c7ad272d5ce0580707143',
  'ap-hold-price': 'db593cfe767275a1d3813a45c5540b5d0380c06db5813bee19ef4a61cf4bd476',
  'ap-hold-quantity': '56d813302c27504a59ee32ef13a1acf8bac67eacd7be83283e44d141f011a4f3',
  'ap-hold-no-po': 'e6cf08f40f3e8198e476cb16f538dc1ed46ad7bd6ea1e53a4e13885ebdb93a04',
  'ap-hold-total': 'bf50f328f8eeb352f3537a4a41e7fde5c4e745ffb6719762177420729e1cd0a8',
  'legal-mixed': '878c94407d53fd305760f5e1b3d870a0059980fdd7f886f23a34f68f19f41e9c',
  'legal-not-found': '86a31bec9ebb28db046a378720688ba740a33b640d954f016003683049410486',
}
/** Over the 100 frozen AP cases, before remedies: sha256 of the per-case core hashes, and of the verdict ids, joined by \n. */
const AP_PRE_CORES = 'dc66f10df7744023cbd4a8a5c05169525b7a9c5142674dc3b06b5970106906e4'
const AP_PRE_IDS = '52d203e43fa8c4093cc9ea0ca5070d552dbfbb8fc96824626fd76b4ed5c1f15f'

const remedyOf = (verdict: Verdict, rule: string, kind?: string) => (verdict.remedies ?? []).filter((r) => r.clears.includes(rule) && (!kind || r.kind === kind))

describe('the taxonomy', () => {
  it('five kinds, four registered transformations, and every built-in table is well-formed', () => {
    expect([...REMEDY_KINDS]).toEqual(['missing-operand', 'transform', 'authority', 'recompute-with', 'none'])
    expect(Object.keys(REMEDY_TRANSFORMS).sort()).toEqual(['cap-at-received', 'declare-field-path', 'declare-unit', 'tax-inclusive-subtotal'])
    const tables: [string, RemedyTable][] = [['invoice', INVOICE_RULESET.remedyByCode!], ['pay-app', PAY_APP_RULESET.remedyByCode!], ['ap', AP_REMEDIES], ['legal', LEGAL_REMEDIES]]
    for (const [name, t] of tables) expect(remedyTableProblems(t, name), name).toEqual([])
  })

  it('every rule a built-in ruleset evaluates declares what answers its FAIL', () => {
    for (const code of [...INVOICE_RULESET.lineCodes, ...INVOICE_RULESET.documentCodes, 'DUP_PROHIB', 'DUP_NEAR']) expect(INVOICE_RULESET.remedyByCode![code]?.fail?.length, code).toBeGreaterThan(0)
    for (const code of [...PAY_APP_RULESET.lineCodes, ...PAY_APP_RULESET.documentCodes]) expect(PAY_APP_RULESET.remedyByCode![code]?.fail?.length, code).toBeGreaterThan(0)
    for (const code of ['AP_DUPLICATE', 'AP_PO_MATCH', 'AP_QTY_RECEIVED', 'AP_PRICE_PO', 'AP_LINE_MATH', 'AP_TOTAL_SUM']) expect(AP_REMEDIES[code]?.fail?.length, code).toBeGreaterThan(0)
    expect(LEGAL_REMEDIES.CITE_VERBATIM?.fail?.length).toBeGreaterThan(0)
  })
})

describe('verdict ids and verdict cores do not move (frozen against the engine before remedies)', () => {
  for (const [name, make] of Object.entries(EXAMPLES)) {
    it(`${name}: the verdict without its remedies is byte-identical to the pre-remedy verdict`, () => {
      // Engine 0.0.1, the engine the pins were taken under (2026-10-03, moved the engine to 0.1.0 and changed no
      // behaviour here; test/engine-defaults.test.ts shows these verdicts differ under 0.1.0 in engine_version and verdict_id only).
      const verdict = make('0.0.1')
      expect(sha(JSON.stringify(withoutRemedies(verdict)))).toBe(PRE_REMEDY_SHA[name])
    })
  }

  it('the 100 frozen AP bench cases: every verdict id and every verdict core as before; 68 non-PASS verdicts gain remedies', () => {
    const cores: string[] = [], ids: string[] = []
    let withRemedies = 0
    for (const c of AP_CASES) {
      const r = verifyInvoiceMatch(splitApLayout(c.input)!, { now: NOW, engine: '0.0.1' }) // the pins' engine (2026-10-03)
      cores.push(sha(JSON.stringify(withoutRemedies(r.verdict))))
      ids.push(r.verdict.verdict_id)
      if (r.verdict.remedies) withRemedies++
      expect(Boolean(r.verdict.remedies), c.id).toBe(r.verdict.outcome !== 'PASS')
    }
    expect(sha(cores.join('\n'))).toBe(AP_PRE_CORES)
    expect(sha(ids.join('\n'))).toBe(AP_PRE_IDS)
    expect(withRemedies).toBe(68)
  })
})

describe('every non-PASS verdict carries a typed remedy, and every open claim is answered', () => {
  const all: [string, Verdict][] = [
    ...Object.entries(EXAMPLES).map(([n, f]) => [n, f()] as [string, Verdict]),
    ...inv.ALL_STANDALONE.map(([n, x]) => [`invoice:${n}`, verify(x, { now: NOW })] as [string, Verdict]),
    ...pay.ALL_PAY_APPS.map(([n, x]) => [`pay-app:${n}`, verify(x, { ruleset: 'pay-app', now: NOW })] as [string, Verdict]),
    ['action:ungrounded', verifyAction({ tool: 'wire', arguments: { to: '8' } }, { allowed: { to: ['9'] } }, { now: NOW })],
  ]
  for (const [name, verdict] of all) {
    it(name, () => {
      const open = verdict.claims.filter((c) => c.outcome !== 'PASS')
      if (verdict.outcome !== 'PASS') expect(verdict.remedies?.length, 'a non-PASS verdict carries remedies').toBeGreaterThan(0)
      if (!open.length && verdict.outcome === 'PASS') expect(verdict.remedies).toBeUndefined()
      for (const c of open) {
        const answering = (verdict.remedies ?? []).filter((r) => r.claims.includes(c.claim_id))
        expect(answering.length, `${c.claim_id} is answered`).toBeGreaterThan(0)
        for (const r of answering) expect(r.clears).toContain(c.rule_id)
      }
      for (const r of verdict.remedies ?? []) {
        expect(REMEDY_KINDS).toContain(r.kind)
        if (r.kind === 'transform') expect(REMEDY_TRANSFORMS[r.transform!]).toBeDefined()
        if (r.kind === 'authority') expect(r.authority).toMatch(/\S/)
        expect(r.detail).not.toMatch(/\{[a-z:A-Z_]+\}/) // every template filled
        expect(r.detail, 'no fact read as "?" (a claim without that fact)').not.toMatch(/(^|[\s(":])\?([\s.,;)"]|$)/)
      }
    })
  }
})

describe('a remedy never changes a verdict', () => {
  it('attaching remedies leaves the outcome, the claims and the coverage exactly as they were', () => {
    for (const make of Object.values(EXAMPLES)) {
      const verdict = make()
      const core = canonicalize(withoutRemedies(verdict))
      const again = attachRemedies(JSON.parse(core) as Verdict, { declared: () => ({ fail: [{ kind: 'none', detail: 'x' }] }) })
      expect(canonicalize(withoutRemedies(again))).toBe(core)
    }
  })
  it('deterministic: the same input gives the same remedies, byte for byte, whatever the clock', () => {
    const a = verify(inv.broken, { now: NOW })
    const b = verify(inv.broken, { now: () => new Date('2031-01-01T00:00:00Z') })
    expect(canonicalize(a.remedies)).toBe(canonicalize(b.remedies))
  })
  it('one remedy answers every claim it fits: a missing contract is one remedy per rule, naming every line', () => {
    const twoLines = { ...inv.clean }
    const r = verify(twoLines, { now: NOW }).remedies!
    const rate = r.filter((x) => x.clears.includes('RATE_SUP'))
    expect(rate).toHaveLength(1)
    expect(rate[0]).toMatchObject({ kind: 'missing-operand', operand: { source: 'contract', role: 'RATE_CONTRACTED' }, claims: ['line[0].RATE_SUP', 'line[1].RATE_SUP'] })
  })
})

describe('the built-in rulesets: what answers what (read from what makes each rule fail)', () => {
  it('invoice: a footing FAIL is re-read or ruled on by AP; a rate over contract is the contract owner\'s call or an amendment', () => {
    const broken = EXAMPLES['invoice-broken']!()
    expect(remedyOf(broken, 'SUM_INT', 'recompute-with')[0]!.detail).toBe('The line amounts sum to 1775; the subtotal says 1750.5 (the lines are off by 24.5). Re-read the subtotal and every line amount: a dropped, doubled or misread line is the usual cause.')
    expect(remedyOf(broken, 'SUM_INT', 'authority')[0]!.authority).toBe('ap-supervisor')
    expect(remedyOf(broken, 'TAX_INT', 'authority')[0]!.authority).toBe('tax-reviewer')
    expect(remedyOf(broken, 'MATH_INT', 'recompute-with')[0]!.operand).toEqual({ source: 'invoice', path: 'line_items[1]' })
    const rate = EXAMPLES['invoice-over-rate']!()
    expect(remedyOf(rate, 'RATE_SUP').map((r) => [r.kind, r.authority ?? r.operand?.role])).toEqual([['authority', 'contract-owner'], ['missing-operand', 'RATE_CONTRACTED']])
    expect(remedyOf(rate, 'RATE_SUP', 'authority')[0]!.detail).toContain('Billed at 150 against the contracted 140')
    const dup = EXAMPLES['invoice-duplicate']!()
    expect(remedyOf(dup, 'DUP_PROHIB', 'authority')[0]!.authority).toBe('ap-controller')
  })

  it('invoice: a can\'t-tell names the missing operand; a computed role names why it could not be computed', () => {
    const r = EXAMPLES['invoice-no-subtotal']!()
    expect(remedyOf(r, 'SUM_INT')).toEqual([expect.objectContaining({ kind: 'missing-operand', operand: { source: 'invoice', role: 'SUBTOTAL' } })])
    expect(remedyOf(r, 'TOTAL_INT')[0]!.detail).toBe('EXPECTED_GRAND_TOTAL is computed from the document and could not be: SUBTOTAL not present on the extraction')
    expect(remedyOf(r, 'DUP_PROHIB')[0]!.operand).toEqual({ source: 'history', role: 'PRIOR_CLAIM_IDS', path: 'prior_invoice_ids' })
    expect(remedyOf(EXAMPLES['invoice-multi-rate']!(), 'RATE_SUP')[0]).toMatchObject({ kind: 'missing-operand', operand: { source: 'contract', role: 'RATE_CONTRACTED' } })
  })

  it('pay-app: overbilling past the schedule is answered by a change order or a correction, never by a ruling', () => {
    const r = EXAMPLES['pay-app-broken']!()
    expect(remedyOf(r, 'G703_CAP').map((x) => x.kind)).toEqual(['missing-operand', 'recompute-with'])
    expect(remedyOf(r, 'G703_CAP', 'authority')).toEqual([])
    expect(remedyOf(r, 'G703_TOTAL', 'authority')[0]!.authority).toBe('certifier')
    expect(remedyOf(r, 'G702_DONE', 'recompute-with')[0]!.operand).toEqual({ source: 'pay-app', role: 'TOTAL_COMPLETED_STORED', path: 'total_completed_and_stored' })
  })

  it('pay-app: a bare percent is answered by the registered declare-unit transformation', () => {
    const r = EXAMPLES['pay-app-bare-percent']!()
    const t = remedyOf(r, 'G703_PCT', 'transform')
    expect(t.length).toBeGreaterThan(0)
    expect(t[0]).toMatchObject({ transform: 'declare-unit', operand: { source: 'pay-app', role: 'PERCENT_COMPLETE', path: 'line[0].percent_complete' } })
    // 2026-10-05: under engine 0.6.0 the words count the line as a person does ("Line 1" for line[0]), as the claims do; the
    // path keeps the index. Engines up to 0.5.0 keep "Line 0" (rulesets/pay-app/axioms.ts PAY_APP_REMEDIES_V060).
    expect(t[0]!.detail).toBe('Line 1: the percent complete is a bare number between 0 and 1, which reads two ways (that many percent, or that fraction of the whole). Send it as a whole number (45) or with a percent sign ("45%").')
  })

  it('AP: a price over tolerance is the buyer\'s call; billed-but-not-received names the receipt, the cap, or the buyer', () => {
    const price = EXAMPLES['ap-hold-price']!()
    expect(remedyOf(price, 'AP_PRICE_PO', 'authority')[0]!.authority).toBe('buyer')
    const qty = EXAMPLES['ap-hold-quantity']!()
    expect(remedyOf(qty, 'AP_QTY_RECEIVED').map((r) => r.kind)).toEqual(['missing-operand', 'transform', 'authority'])
    expect(remedyOf(qty, 'AP_QTY_RECEIVED', 'transform')[0]!.transform).toBe('cap-at-received')
    const po = EXAMPLES['ap-hold-no-po']!()
    expect(remedyOf(po, 'AP_PO_MATCH', 'missing-operand')[0]!.detail).toMatch(/^The invoice cites PO-\d+; the open order is PO-\d+\./)
  })

  it('legal: a misquote is answered only by correcting the brief (no authority); a missing opinion names the opinion', () => {
    // Engine 0.5.0: these opinion texts name no caption, and engine 0.6.0 checks a quotation only against a text that names its
    // cite (engine 0.6.0's legal remedies: test/legal-060.test.ts).
    const r = EXAMPLES['legal-mixed']!('0.5.0')
    const mis = r.remedies!.filter((x) => x.claims.includes('cite.2'))
    expect(mis.map((x) => x.kind)).toEqual(['recompute-with'])
    expect(mis[0]!.detail).toContain('The opinion reads: "The court holds that the arbitration clause is unenforceable')
    expect(r.remedies!.find((x) => x.claims.includes('cite.3'))).toMatchObject({ kind: 'missing-operand', operand: { source: 'opinion', path: '1 F.4th 1' } })
    expect(r.remedies!.filter((x) => x.claims.includes('cite.4')).map((x) => x.authority ?? x.kind)).toEqual(['missing-operand', 'attorney-of-record'])
    const nf = EXAMPLES['legal-not-found']!('0.5.0')
    expect(nf.remedies![0]!.detail).toContain('it may be fabricated')
  })
})

describe('declarative rulesets: `remedy` per check', () => {
  const base: DeclarativeRuleset = {
    id: 'po-total', version: '1.0.0',
    fields: { TOTAL: { paths: ['total'] }, LINE: { paths: ['amount'], line: true }, LIMIT: { paths: ['limit'] } },
    checks: [
      { code: 'FOOT', left: 'TOTAL', op: '=', right: 'sum(LINE)' },
      { code: 'CAP', left: 'TOTAL', op: '<=', right: 'LIMIT' },
    ],
  }
  const withRemedies: DeclarativeRuleset = {
    ...base,
    checks: [
      { ...base.checks[0]!, remedy: { kind: 'recompute-with', operand: { source: 'po', path: 'total' }, detail: 'Total {asserted} but the lines make {expected}.' } },
      { ...base.checks[1]!, remedy: {
        fail: [{ kind: 'authority', authority: 'budget-owner', detail: 'Over the limit by {variance}.' }],
        abstain: [{ kind: 'missing-operand', operand: { source: 'po', role: 'LIMIT', path: 'limit' }, when: ['FIELD_MISSING'], detail: 'The PO limit.' }],
      } },
    ],
  }
  const doc = { total: 120, limit: 100, line_items: [{ amount: 50 }, { amount: 60 }] }

  it('the declared remedies answer FAIL and ABSTAIN, with the claim\'s facts filled in', () => {
    const r = verifyDeclarative(doc, withRemedies, { now: NOW })
    expect(r.outcome).toBe('FAIL')
    expect(r.remedies).toEqual([
      { kind: 'recompute-with', operand: { source: 'po', path: 'total' }, detail: 'Total 120.00 but the lines make 110.00.', clears: ['FOOT'], claims: ['document.FOOT'] },
      { kind: 'authority', authority: 'budget-owner', detail: 'Over the limit by 20.00.', clears: ['CAP'], claims: ['document.CAP'] },
    ])
    const noLimit = verifyDeclarative({ ...doc, limit: undefined, total: 110 }, withRemedies, { now: NOW })
    expect(noLimit.remedies).toEqual([{ kind: 'missing-operand', operand: { source: 'po', role: 'LIMIT', path: 'limit' }, detail: 'The PO limit.', clears: ['CAP'], claims: ['document.CAP'] }])
  })

  it('a check that declares none: its can\'t-tell implies a remedy, its FAIL says `none` (the finding stands)', () => {
    const r = verifyDeclarative(doc, base, { now: NOW })
    expect(r.remedies!.map((x) => [x.kind, x.clears[0]])).toEqual([['none', 'FOOT'], ['none', 'CAP']])
  })

  it('through engine 0.1.0, declaring or editing a remedy never moves the verdict_id or the core (remedies are not part of the ruleset\'s identity)', () => {
    const a = verifyDeclarative(doc, base, { now: NOW, engine: '0.1.0' })
    const b = verifyDeclarative(doc, withRemedies, { now: NOW, engine: '0.1.0' })
    expect(b.verdict_id).toBe(a.verdict_id)
    expect(b.input_hash).toBe(a.input_hash)
    expect(canonicalize(withoutRemedies(b))).toBe(canonicalize(withoutRemedies(a)))
    expect(rulesetIdentity(base)).toBe(base) // a ruleset with no remedy is its own identity: its bytes never change
    expect(canonicalize(rulesetIdentity(withRemedies))).toBe(canonicalize(base))
    // engine 0.2.0 (red-team F9): the input_hash is unchanged, but the remedy table enters the id, so the id moves
    const a2 = verifyDeclarative(doc, base, { now: NOW }), b2 = verifyDeclarative(doc, withRemedies, { now: NOW })
    expect(b2.input_hash).toBe(a2.input_hash)
    expect(b2.remedy_table_hash).not.toBe(a2.remedy_table_hash)
    expect(b2.verdict_id).not.toBe(a2.verdict_id)
  })

  it('lint: kinds, registered transforms, an authority\'s role, `when` only on ABSTAIN', () => {
    expect(lintRuleset(withRemedies).ok).toBe(true)
    const bad = (remedy: unknown): string[] => lintRuleset({ ...base, checks: [{ ...base.checks[0]!, remedy } as never] }).errors
    expect(bad({ kind: 'waive', detail: 'x' })[0]).toContain('kind must be one of missing-operand, transform, authority, recompute-with, none')
    expect(bad({ kind: 'transform', transform: 'round-it-off', detail: 'x' })[0]).toContain('transform "round-it-off" is not registered')
    expect(bad({ kind: 'authority', detail: 'x' })[0]).toContain('an authority remedy names the role that may rule')
    expect(bad({ fail: [{ kind: 'none', detail: 'x', when: ['FIELD_MISSING'] }] })[0]).toContain('"when" filters ABSTAIN remedies')
    expect(bad({ kind: 'missing-operand', detail: 'x' })[0]).toContain('a missing-operand remedy names its operand')
    expect(bad({ kind: 'none', detail: '' })[0]).toContain('detail is required')
  })

  it('an unlinted ruleset with a malformed remedy still never crashes a verdict: the malformed remedy is dropped', () => {
    const rs = { ...base, checks: [{ ...base.checks[0]!, remedy: [{ kind: 'waive' }, { kind: 'none', detail: 'kept' }] } as never, base.checks[1]!] }
    const r = verifyDeclarative(doc, rs, { now: NOW })
    expect(r.remedies![0]).toMatchObject({ kind: 'none', detail: 'kept', clears: ['FOOT'] })
    expect(normalizeDeclaration({ kind: 'waive' })).toBeUndefined()
  })
})

describe('the verdict-level remedy', () => {
  it('a non-PASS verdict with no open claim still says what would answer it', () => {
    expect(remediesFor({ outcome: 'INSUFFICIENT_DATA', claims: [] })).toEqual([
      { kind: 'missing-operand', operand: { source: 'document' }, detail: 'no claim could be formed from these inputs: supply a document the ruleset reads', clears: [], claims: [] },
    ])
    expect(remediesFor({ outcome: 'PASS', claims: [] })).toBeUndefined()
  })
})
