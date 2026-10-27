/**
 * 2026-10-03, engine 0.3.0: the evidence ruling as engine primitives. A garbled load-bearing field is "not an
 * automatic fail, a flag, and a report with evidence": the verdict lists what it computed, what is struck and why, and what each
 * struck field would unlock; suspect is a flag, never a FAIL. Evidence tiers E0-E4 and the floor a verdict rests on. The scope
 * line on every verdict. Arbitration (the Salle): CORRECT, STRIKE, CORROBORATE as signed moves; the engine reads every document
 * itself; a value a party typed is refused and recorded by hash. Every fixture is inline (no OCR here: the tabletop exercises the
 * PDF route with real readers).
 */
import { describe, expect, it } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ENGINE_VERSION, verify, verifyDeclarative, verifyReplay, verifyInputs, gateStatus, gateLabel, gateStatusOpen, heldSuspectClaims,
  verifyCitations, scopeOf, renderScope, inferTier, provenanceTier, floorOf, keyFingerprint, signMove, countersignMove, signStatement,
  openCase, fileMove, caseStatus, replayCase, applyClock, readLedger, ledgerProblems, addWorkingDays, CaseRefused, actionNotice, renderActionNotice,
  type DeclarativeRuleset, type Verdict, type UnsignedMove, type EvidenceOverlay,
} from '../src/index'
import { run } from '../src/cli'

const EX = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'examples')
const V2 = JSON.parse(readFileSync(join(EX, 'peppol-en16931.ruleset.v0.2.json'), 'utf8')) as DeclarativeRuleset
const NOW = (): Date => new Date('2026-10-03T00:00:00Z')
const base = (): Record<string, unknown> => ({
  invoice_number: 'INV-1', issue_date: '2026-01-01', currency: 'EUR', amount_currency: 'EUR',
  lines: [{ line_extension_amount: 100, invoiced_quantity: 2, price_amount: 50 }, { line_extension_amount: 200, invoiced_quantity: 4, price_amount: 50 }],
  sum_of_line_net_amount: 300, tax_exclusive_amount: 300, tax_amount: 30, tax_inclusive_amount: 330, payable_amount: 330,
  vat_breakdown: [{ row: 1, tax_amount: 30 }],
})

/** A small ruleset with published terms: the amount due and its identity (BR-CO-16), as Peppol writes it. */
const PAY: DeclarativeRuleset = {
  id: 'pay-mini', version: '1.0.0', domain: 'e-invoice', distinguish_unreadable: true,
  fields: {
    PAYABLE: { paths: ['payable_amount'], term: 'BT-115 Amount due for payment', labels: ['Amount due for payment'] },
    TAX_INCL: { paths: ['tax_inclusive_amount'], term: 'BT-112 Invoice total amount with VAT' },
    PREPAID: { paths: ['prepaid_amount'], default: 0, term: 'BT-113 Paid amount' },
    ROUNDING: { paths: ['payable_rounding_amount'], default: 0, term: 'BT-114 Rounding amount' },
  },
  checks: [{ code: 'PAYABLE_INT', field: 'payable_amount', tol: 0.005, left: 'PAYABLE', op: '=', right: 'TAX_INCL - PREPAID + ROUNDING' }],
}

describe('engine 0.3.0: strike and recompute; suspect is a flag, never a FAIL', () => {
  it('is retained (current until 0.4.0 became current on 2026-10-04); a verdict lists computed, struck (with provenance and candidates), would_unlock, counts, the floor, and ends with its scope', () => {
    expect(ENGINE_VERSION).toBe('0.7.2') // 2026-10-04: 0.4.0, then 0.5.0; 2026-10-05: 0.6.0 is current; this test names engine 0.3.0, the engine it describes
    const v = verifyDeclarative({ ...base(), payable_amount: '4O0.00' }, V2, { now: NOW, engine: '0.3.0' })
    expect([v.engine_version, v.outcome, gateStatus(v), gateStatusOpen(v), gateLabel(v)]).toEqual(['0.3.0', 'PASS', 'PASS-WITH-OPEN', 'OPEN', 'OPEN'])
    expect(v.claims.filter(c => c.outcome === 'FAIL')).toEqual([])
    expect(v.claims.some(c => c.suspect !== undefined)).toBe(false) // HELD-SUSPECT is retired under 0.3.0
    expect(heldSuspectClaims(v)).toEqual([])
    expect(v.struck).toHaveLength(1)
    const s = v.struck![0]!
    expect(s).toMatchObject({ field: 'PAYABLE', role: 'PAYABLE', path: 'payable_amount', reason: 'suspect', provenance: { raw: '"4O0.00"', tier: 'unstated' } })
    expect(s.candidates!.failing).toBeGreaterThan(0)
    expect(s.candidates!.shown[0]).toMatchObject({ read_as: '40.00', value: 40, fails: ['document.PAYABLE_INT'] })
    expect(v.would_unlock).toEqual([{ field: 'PAYABLE', claims: ['document.PAYABLE_INT', 'document.BR15_PRESENT'] }])
    expect(v.counts).toMatchObject({ checks_fail: 0, checks_struck: 2, fields_struck: 1, suspect: 1, unreadable: 0 })
    expect(v.computed!.pass).not.toContain('document.PAYABLE_INT')
    expect(v.evidence_floor).toBe('unstated')
    expect(Object.keys(v).at(-1)).toBe('scope')
    expect(v.scope).toEqual({ ruleset: 'peppol-en16931@0.2.0', engine_version: '0.3.0', evidence_floor: 'unstated', statements: ['advisories are counsel, not verdicts', 'this is a check, not a decision'] })
    expect(verifyReplay(v, { extraction: { ...base(), payable_amount: '4O0.00' }, ruleset: V2 }).status).toBe('REPERFORMED')
  })
  it('the garbled tax total too; "held_suspect": false keeps the strike, without the flag; a clean document has nothing struck', () => {
    const t = verifyDeclarative({ ...base(), tax_amount: '9°9', tax_inclusive_amount: 399, payable_amount: 399 }, V2, { now: NOW })
    expect([gateStatusOpen(t), t.struck!.map(x => [x.field, x.reason])]).toEqual(['OPEN', [['TAX_AMT', 'suspect']]])
    const off = verifyDeclarative({ ...base(), payable_amount: '4O0.00' }, { ...V2, held_suspect: false }, { now: NOW })
    expect([gateStatusOpen(off), off.struck!.map(x => x.reason), off.counts!.suspect]).toEqual(['OPEN', ['unreadable'], 0])
    const clean = verifyDeclarative(base(), V2, { now: NOW })
    expect([gateStatusOpen(clean), clean.struck, clean.would_unlock, clean.counts!.checks_computed]).toEqual(['PASS', [], [], 12])
  })
  it('a computed FAIL elsewhere stays FAIL: a struck field never rescues a check that ran and failed', () => {
    const v = verifyDeclarative({ ...base(), payable_amount: '4O0.00', tax_inclusive_amount: 999 }, V2, { now: NOW })
    expect([v.outcome, gateStatusOpen(v)]).toEqual(['FAIL', 'FAIL'])
    expect(v.struck!.length).toBe(1)
  })
  it('an absent field is not struck (PASS-WITH-OPEN, as before); a value printed but unread is', () => {
    const { payable_amount: _p, ...absent } = base()
    const a = verifyDeclarative(absent, V2, { now: NOW })
    expect([gateStatusOpen(a), a.struck]).toEqual(['PASS-WITH-OPEN', []])
    const printed = verifyDeclarative(absent, V2, { now: NOW, source: { text: 'Invoice\nAmount due for payment EUR ###' } })
    expect([gateStatusOpen(printed), printed.struck!.map(x => [x.field, x.reason, x.path])]).toEqual(['OPEN', [['PAYABLE', 'unreadable', undefined]]])
  })
  it('the remedy for a struck field: evidence, never a typed value', () => {
    const v = verifyDeclarative({ ...base(), payable_amount: '4O0.00' }, V2, { now: NOW })
    const r = v.remedies!.find(x => x.operand?.role === 'PAYABLE')!
    expect(r.kind).toBe('missing-operand')
    expect(r.detail).toMatch(/is struck: unreadable; reported as "4O0\.00"\. It is answered by evidence, never by a typed value: a CORRECT carrying the page or document that prints it \(the engine reads it\), or a CORROBORATE from an independent source/)
  })
  it('earlier engines keep their bytes: no blocks, no scope; a 0.2.0 verdict still reads HELD-SUSPECT', () => {
    for (const engine of ['0.0.1', '0.1.0', '0.2.0']) {
      const v = verifyDeclarative({ ...base(), payable_amount: '4O0.00' }, V2, { now: NOW, engine })
      for (const k of ['computed', 'struck', 'would_unlock', 'counts', 'evidence_floor', 'scope']) expect(k in v, `${engine} ${k}`).toBe(false)
    }
    expect(gateLabel(verifyDeclarative({ ...base(), payable_amount: '4O0.00' }, V2, { now: NOW, engine: '0.2.0' }))).toBe('HELD-SUSPECT')
  })
  it('the CLI gate: OPEN, each struck field and what it unlocks, exit 2; the scope closes the message', () => {
    const dir = mkdtempSync(join(tmpdir(), 'v1b-gate-'))
    writeFileSync(join(dir, 'x.json'), JSON.stringify({ ...base(), payable_amount: '4O0.00' }))
    let err = ''
    const code = run([join(dir, 'x.json'), '--ruleset', 'peppol-en16931', '--gate'], { out: () => {}, err: s => { err += s } })
    expect(code).toBe(2)
    expect(err).toMatch(/^verify: OPEN: 10 check\(s\) computed, 2 wait on 1 struck field\(s\):\n {2}PAYABLE \(payable_amount\): suspect \(\d+ of \d+ readings one step away fail a check, e\.g\. "40\.00"; a flag, not a FAIL\) → unlocks document\.PAYABLE_INT, document\.BR15_PRESENT\n {2}Nothing is booked as a FAIL\./)
    expect(err).toContain('This is a check, not a decision.')
  })
  it('with --case-dir and --parties an OPEN verdict opens its case automatically; a clean one opens none', () => {
    const dir = mkdtempSync(join(tmpdir(), 'v1b-auto-'))
    const k = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString()
    writeFileSync(join(dir, 'parties.json'), JSON.stringify({ format: 'verify-parties/1', parties: [{ id: 'f', role: 'filer', public_key: k }] }))
    writeFileSync(join(dir, 'x.json'), JSON.stringify({ ...base(), payable_amount: '4O0.00' }))
    writeFileSync(join(dir, 'ok.json'), JSON.stringify(base()))
    let err = ''
    // exit 2: an OPEN verdict is not a pass (the CLI fails closed from 2026-10-05; it exited 0 on the outcome before)
    expect(run([join(dir, 'x.json'), '--ruleset', 'peppol-en16931', '--case-dir', join(dir, 'case'), '--parties', join(dir, 'parties.json')], { out: () => {}, err: s => { err += s } })).toBe(2)
    expect(err).toMatch(/the verdict is OPEN: case case-[0-9a-f]{24} opened in .*case \(2 working days, suspect; deadline /)
    expect(readLedger(join(dir, 'case')).map(r => r.kind)).toEqual(['case.open'])
    let err2 = ''
    run([join(dir, 'ok.json'), '--ruleset', 'peppol-en16931', '--case-dir', join(dir, 'case2'), '--parties', join(dir, 'parties.json')], { out: () => {}, err: s => { err2 += s } })
    expect(err2).not.toMatch(/opened/)
  })
})

describe('the scope line, on every engine\'s 0.3.0 verdict', () => {
  it('declarative, the built-in invoice, the legal check: generated from the verdict; the notice ends with it', () => {
    const d = verifyDeclarative(base(), V2, { now: NOW, engine: '0.3.0' }) // names the engine it describes
    const i = verify({ subtotal: 100, tax_amount: 10, total: 110 }, { now: NOW })
    const l = verifyCitations([{ id: 'c1', quote: 'a short passage', source_key: 's' }] as never, { s: 'Here is a short passage of text.' }, { now: NOW })
    for (const v of [d, i, l]) {
      expect(v.scope, v.ruleset.id).toEqual(scopeOf(v))
      expect(Object.keys(v).at(-1)).toBe('scope')
    }
    expect([i.scope!.evidence_floor, l.scope!.evidence_floor]).toEqual(['unstated', 'unstated'])
    expect(renderScope(d.scope!)).toEqual([
      'Scope: checked against peppol-en16931@0.2.0 by engine 0.3.0; evidence floor unstated (the values carry no provenance: the extraction is checked as given).',
      'Advisories are counsel, not verdicts.', 'This is a check, not a decision.',
    ])
    const n = renderActionNotice(actionNotice(verifyDeclarative({ ...base(), payable_amount: 999 }, V2, { now: NOW }), 'gate'))
    expect(n.trimEnd().split('\n').slice(-2)).toEqual(['Advisories are counsel, not verdicts.', 'This is a check, not a decision.'])
    expect('scope' in verify({ subtotal: 100, tax_amount: 10, total: 110 }, { now: NOW, engine: '0.2.0' })).toBe(false)
  })
})

describe('evidence tiers (EV1)', () => {
  it('inference never raises a tier: text layer E2, OCR E3, structured E1, supplied E4; a stated better tier, or E0, is capped', () => {
    expect([inferTier('pdf-text-layer+ocr-a'), inferTier('ocr-a+ocr-b'), inferTier('pdf-text-layer|ocr-a+ocr-a|ocr-b'), inferTier('ubl-xml'), inferTier('supplied'), inferTier(undefined)]).toEqual(['E2', 'E3', 'E3', 'E1', 'E4', 'E4'])
    expect(provenanceTier({ reader: 'ocr-a+ocr-b', tier: 'E1' })).toEqual({ tier: 'E3', capped: { stated: 'E1', inferred: 'E3' } })
    expect(provenanceTier({ reader: 'ubl-xml', tier: 'E0' })).toEqual({ tier: 'E1', capped: { stated: 'E0', inferred: 'E1' } })
    expect(provenanceTier({ reader: 'pdf-text-layer+ocr-a', tier: 'E3' })).toEqual({ tier: 'E3' })
    expect([floorOf([]), floorOf(['E0', 'E2']), floorOf(['E1', 'unstated']), floorOf(['E3', 'E4'])]).toEqual(['none', 'E2', 'unstated', 'E4'])
  })
  const prov = (line: number, raw: string, extra: Record<string, unknown> = {}) => ({ page: 1, line, raw, reader: 'pdf-text-layer+ocr-a', ...extra })
  const env = (fields: Record<string, unknown>) => ({ extraction_contract: '0.1', ruleset: 'pay-mini@1.0.0', fields })
  it('an envelope states its floor; a field with no provenance is struck as an unsupported assertion, never load-bearing', () => {
    const ok = verifyDeclarative(env({ PAYABLE: { value: 1034, provenance: prov(9, '1,034.00') }, TAX_INCL: { value: 1533.91, provenance: prov(7, '1,533.91', { tier: 'E2' }) }, PREPAID: { value: 500, provenance: prov(8, '500.00') }, ROUNDING: { value: 0.09, provenance: { page: 1, line: 8, raw: '0.09', reader: 'ocr-a+ocr-b' } } }) as never, PAY, { now: NOW })
    expect([ok.outcome, gateStatusOpen(ok), ok.evidence_floor]).toEqual(['PASS', 'PASS', 'E3'])
    const e4 = verifyDeclarative(env({ PAYABLE: { value: 1034 }, TAX_INCL: { value: 1533.91, provenance: prov(7, '1,533.91') }, PREPAID: { value: 500, provenance: prov(8, '500.00') }, ROUNDING: { value: 0.09, provenance: prov(8, '0.09') } }) as never, PAY, { now: NOW })
    expect([gateStatusOpen(e4), e4.struck!.map(x => [x.field, x.reason, x.provenance.tier])]).toEqual(['OPEN', [['PAYABLE', 'unsupported-assertion', 'E4']]])
    const capped = verifyDeclarative(env({ PAYABLE: { value: 1034, provenance: { ...prov(9, '1,034.00'), reader: 'ocr-a+ocr-b', tier: 'E1' } }, TAX_INCL: { value: 1533.91, provenance: prov(7, '1,533.91') }, PREPAID: { value: 500, provenance: prov(8, '500.00') }, ROUNDING: { value: 0.09, provenance: prov(8, '0.09') } }) as never, PAY, { now: NOW })
    expect([capped.evidence_floor, capped.findings!.map(f => f.kind)]).toEqual(['E3', ['tier-claim-capped']])
  })
  it('an envelope\'s UNREADABLE value is suspect when a reader\'s own reading would fail the check', () => {
    const u = verifyDeclarative(env({ PAYABLE: { value: 'UNREADABLE', provenance: { ...prov(9, '1,084.00'), readings: [{ reader: 'pdf-text-layer', raw: '1,084.00' }, { reader: 'ocr-a', raw: '1,034.00' }] } }, TAX_INCL: { value: 1533.91, provenance: prov(7, '1,533.91') }, PREPAID: { value: 500, provenance: prov(8, '500.00') }, ROUNDING: { value: 0.09, provenance: prov(8, '0.09') } }) as never, PAY, { now: NOW })
    expect(u.struck![0]).toMatchObject({ field: 'PAYABLE', reason: 'suspect', provenance: { line: 9, reader: 'pdf-text-layer+ocr-a', tier: 'E2' }, candidates: { checked: 2, failing: 1, passing: 1, shown: [{ read_as: '1,084.00', value: 1084, fails: ['document.PAYABLE_INT'] }] } })
  })
})

describe('the evidence overlay: the higher tier computes; a conflict is on the record', () => {
  const garbled = { payable_amount: '1O34.00', tax_inclusive_amount: 1533.91, prepaid_amount: 500, payable_rounding_amount: 0.09 }
  const item = (value: number, tier: 'E0' | 'E1' | 'E2' | 'E3', source_id: string, move_id = 'm'.repeat(64)) => ({ value, tier, kind: 'corroborate' as const, source_id, move_id })
  it('an E0 value recovers a struck field: supported at E0; the verdict replays with its overlay', () => {
    const evidence: EvidenceOverlay = { fields: { payable_amount: [item(1034, 'E0', 'bank:x')] } }
    const v = verifyDeclarative(garbled, PAY, { now: NOW, evidence })
    expect([v.outcome, gateStatusOpen(v), v.struck]).toEqual(['PASS', 'PASS', []])
    expect(v.support).toEqual([{ field: 'PAYABLE', path: 'payable_amount', value: 1034, tier: 'E0', supported_at: 'E0', sources: [{ source_id: 'bank:x', tier: 'E0', value: 1034, agrees: true, move_id: 'm'.repeat(64) }] }])
    expect(verifyReplay(v, verifyInputs(garbled, { ruleset: PAY, evidence })).status).toBe('REPERFORMED')
    expect(verifyReplay(v, { extraction: garbled, ruleset: PAY }).status).toBe('FAILED') // the overlay is part of the input
    expect(() => verifyDeclarative(garbled, PAY, { now: NOW, evidence, engine: '0.2.0' })).toThrow(/evidence overlay is read from engine 0\.3\.0 on/)
    expect(() => verifyDeclarative(garbled, PAY, { now: NOW, evidence: { fields: { payable_amount: [{ ...item(1034, 'E0', 'b'), tier: 'E4' as never }] } } })).toThrow(/an E4 value never enters an overlay/)
  })
  it('E0 beats a lower tier that disagrees (finding); two values at one tier with nothing higher strike the field (conflict)', () => {
    const v = verifyDeclarative(garbled, PAY, { now: NOW, evidence: { fields: { payable_amount: [item(1034, 'E0', 'bank:x'), item(1084, 'E2', 'document:f')] } } })
    expect([gateStatusOpen(v), v.findings!.map(f => [f.kind, f.kept!.tier, f.against!.tier])]).toEqual(['PASS', [['tier-conflict', 'E0', 'E2']]])
    const c = verifyDeclarative(garbled, PAY, { now: NOW, evidence: { fields: { payable_amount: [item(1034, 'E2', 'document:a'), item(1084, 'E2', 'document:b')] } } })
    expect([gateStatusOpen(c), c.struck!.map(x => x.reason), c.counts!.conflict]).toEqual(['OPEN', ['conflict'], 1])
    // a readable plain value (unstated) is overridden by a stated tier that disagrees, and the conflict is recorded
    const r = verifyDeclarative({ ...garbled, payable_amount: 1084 }, PAY, { now: NOW, evidence: { fields: { payable_amount: [item(1034, 'E0', 'bank:x')] } } })
    expect([r.outcome, r.findings![0]!.against]).toEqual(['PASS', { value: 1084, tier: 'unstated', source: 'filing' }])
  })
  it('a STRIKE withdraws a field (never its default) or the whole document', () => {
    const f = verifyDeclarative({ ...garbled, payable_amount: 1034 }, PAY, { now: NOW, evidence: { struck: [{ path: 'prepaid_amount', move_id: 's'.repeat(64), reason: 'not on the invoice' }] } })
    expect([gateStatusOpen(f), f.struck!.map(x => [x.field, x.reason, x.provenance.move_id])]).toEqual(['OPEN', [['PREPAID', 'withdrawn', 's'.repeat(64)]]])
    const d = verifyDeclarative({ ...garbled, payable_amount: 1034 }, PAY, { now: NOW, evidence: { struck: [{ document: true, move_id: 's'.repeat(64), reason: 'withdrawn' }] } })
    expect([d.outcome, d.counts!.withdrawn, d.evidence_floor]).toEqual(['INSUFFICIENT_DATA', 4, 'none'])
  })
})

// ── arbitration ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const keys = () => { const k = generateKeyPairSync('ed25519'); return { pub: k.publicKey.export({ type: 'spki', format: 'pem' }).toString(), priv: k.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() } }
function world() {
  const filer = keys(), vendor = keys(), operator = keys(), bank = keys(), stranger = keys()
  const parties = { format: 'verify-parties/1', parties: [{ id: 'buyer-ap', role: 'filer', public_key: filer.pub }, { id: 'vendor', role: 'counterparty', public_key: vendor.pub }, { id: 'controller', role: 'operator', public_key: operator.pub }], sources: [{ id: 'bank:op', tier: 'E0', public_key: bank.pub }] }
  return { filer, vendor, operator, bank, stranger, parties }
}
const T0 = '2026-10-05T09:00:00Z'
let nonceN = 0
const nonce = (): string => (++nonceN).toString(16).padStart(16, '0')
function move(caseId: string, who: { pub: string; priv: string }, body: Partial<UnsignedMove>, at = '2026-10-05T10:00:00Z'): Uint8Array {
  const u = { format: 'verify-move/1', case: caseId, by: keyFingerprint(who.pub)!, at, nonce: nonce(), expires_at: '2026-10-30T00:00:00Z', reason: 'test', ...body } as UnsignedMove
  return new Uint8Array(Buffer.from(JSON.stringify(signMove(u, who.priv))))
}
const statement = (bank: { priv: string }, amount: number) => new Uint8Array(Buffer.from(JSON.stringify(signStatement({ format: 'verify-source-statement/1', source: 'bank:op', issued_at: '2026-10-04T00:00:00Z', body: { lines: [{ ref: 'INV-1', amount }] } }, bank.priv))))
import { createHash } from 'node:crypto'
const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex')

function opened(extraction: Record<string, unknown>, document?: Uint8Array) {
  const w = world()
  const dir = mkdtempSync(join(tmpdir(), 'v1b-case-'))
  const v = verifyDeclarative(extraction, PAY, { now: () => new Date(T0) })
  const st = openCase({ dir, verdict: v, inputs: verifyInputs(extraction, { ruleset: PAY }), parties: w.parties, now: T0, ...(document ? { document } : {}) })
  return { w, dir, st, id: st.record.case_id }
}
const garbled = { payable_amount: '1O34.00', tax_inclusive_amount: 1533.91, prepaid_amount: 500, payable_rounding_amount: 0.09 }

describe('arbitration: a case, three moves, a clock (the Salle)', () => {
  it('opens only on an OPEN verdict that re-performs (or a disputed FAIL); the clock is 2 working days with a suspect field', () => {
    const { st } = opened(garbled)
    expect([st.record.why, st.record.clock.kind, st.record.clock.deadline, st.status]).toEqual(['struck', 'suspect', '2026-10-07T09:00:00Z', 'open'])
    const w = world()
    const clean = { ...garbled, payable_amount: 1034 }
    expect(() => openCase({ dir: mkdtempSync(join(tmpdir(), 'v1b-')), verdict: verifyDeclarative(clean, PAY, { now: NOW }), inputs: verifyInputs(clean, { ruleset: PAY }), parties: w.parties, now: T0 })).toThrow(CaseRefused)
    const tampered = { ...verifyDeclarative(garbled, PAY, { now: NOW }), outcome: 'FAIL' as const }
    expect(() => openCase({ dir: mkdtempSync(join(tmpdir(), 'v1b-')), verdict: tampered, inputs: verifyInputs(garbled, { ruleset: PAY }), parties: w.parties, now: T0 })).toThrow(/does not re-perform/)
    expect(addWorkingDays('2026-10-09T12:00:00Z', 1)).toBe('2026-10-12T12:00:00Z') // Friday + 1 working day = Monday
  })
  it('a CORRECT carrying a typed value is refused and recorded by the move\'s hash; its value never enters the record', async () => {
    const { w, dir, id } = opened(garbled)
    const m = move(id, w.vendor, { type: 'correct', field: { role: 'PAYABLE' }, value: 1034 } as never)
    const r = await fileMove({ dir, move: m, now: '2026-10-05T10:00:00Z' })
    expect([r.accepted, r.refusal!.code, r.status]).toEqual([false, 'e4-value', 'open'])
    const row = readLedger(dir).at(-1)!
    expect([row.kind, row.data.move_sha256, row.data.code]).toEqual(['move.refused', sha(m), 'e4-value'])
    expect(readFileSync(join(dir, 'ledger.jsonl'), 'utf8')).not.toContain('1034')
  })
  it('a CORROBORATE from a signed E0 statement resolves PASS, linked before/after; both verdicts replay', async () => {
    const { w, dir, id, st } = opened(garbled)
    const doc = statement(w.bank, 1034)
    const r = await fileMove({ dir, move: move(id, w.operator, { type: 'corroborate', field: { role: 'PAYABLE' }, evidence: { file: 'stmt.json', sha256: sha(doc), locator: 'lines[0].amount' } }), evidence: doc, now: '2026-10-05T10:00:00Z' })
    expect([r.accepted, r.before!.gate, r.after!.gate, r.resolution, r.status]).toEqual([true, 'OPEN', 'PASS', 'PASS', 'resolved'])
    expect(r.verdict!.case).toEqual({ case_id: id, prior_verdict_id: st.latest.verdict_id, move_id: r.move_id })
    expect(r.verdict!.support![0]).toMatchObject({ field: 'PAYABLE', tier: 'E0', supported_at: 'E0' })
    const rep = await replayCase(dir, { reread: true })
    expect([rep.ok, rep.verdicts.map(v => v.status), rep.moves.map(m => [m.signature, m.reread])]).toEqual([true, ['REPERFORMED', 'REPERFORMED'], [[true, 'same']]])
    expect(caseStatus(dir, '2026-10-05T11:00:00Z')).toMatchObject({ status: 'resolved', resolution: 'PASS', moves: { accepted: 1, refused: 0 }, parties: { controller: { corroborate: 1 } } })
  })
  it('independence: the filing\'s own document, or a source already on the field, is refused', async () => {
    const pdfish = new Uint8Array(Buffer.from('%PDF-1.4 the invoice itself'))
    const { w, dir, id } = opened({ ...garbled, prepaid_amount: '5OO.00' }, pdfish)
    const same = await fileMove({ dir, move: move(id, w.filer, { type: 'corroborate', field: { role: 'PAYABLE' }, evidence: { file: 'inv.pdf', sha256: sha(pdfish) } }), evidence: pdfish, now: '2026-10-05T10:00:00Z' })
    expect(same.refusal?.code).toBe('not-independent')
    const doc = statement(w.bank, 1034)
    const first = await fileMove({ dir, move: move(id, w.operator, { type: 'corroborate', field: { role: 'PAYABLE' }, evidence: { file: 's.json', sha256: sha(doc), locator: 'lines[0].amount' } }), evidence: doc, now: '2026-10-05T10:00:00Z' })
    expect([first.accepted, first.after!.gate]).toEqual([true, 'OPEN']) // PREPAID is still struck
    const again = await fileMove({ dir, move: move(id, w.vendor, { type: 'corroborate', field: { role: 'PAYABLE' }, evidence: { file: 's.json', sha256: sha(doc), locator: 'lines[0].amount' } }), evidence: doc, now: '2026-10-05T10:00:00Z' })
    expect(again.refusal?.code).toBe('not-independent')
  })
  it('the door: unknown key, bad signature, a reused nonce, a role, a filer\'s CORRECT without countersign, an unenrolled statement', async () => {
    const { w, dir, id } = opened(garbled)
    const doc = statement(w.bank, 1034)
    const ev = { file: 's.json', sha256: sha(doc), locator: 'lines[0].amount' }
    expect((await fileMove({ dir, move: move(id, w.stranger, { type: 'corroborate', field: { role: 'PAYABLE' }, evidence: ev }), evidence: doc, now: '2026-10-05T10:00:00Z' })).refusal?.code).toBe('unknown-signer')
    const forged = JSON.parse(Buffer.from(move(id, w.vendor, { type: 'corroborate', field: { role: 'PAYABLE' }, evidence: ev })).toString())
    forged.reason = 'edited after signing'
    expect((await fileMove({ dir, move: new Uint8Array(Buffer.from(JSON.stringify(forged))), evidence: doc, now: '2026-10-05T10:00:00Z' })).refusal?.code).toBe('bad-signature')
    expect((await fileMove({ dir, move: move(id, w.operator, { type: 'correct', field: { role: 'PAYABLE' }, evidence: ev }), evidence: doc, now: '2026-10-05T10:00:00Z' })).refusal?.code).toBe('role')
    expect((await fileMove({ dir, move: move(id, w.filer, { type: 'correct', field: { role: 'PAYABLE' }, evidence: ev }), evidence: doc, now: '2026-10-05T10:00:00Z' })).refusal?.code).toBe('countersign')
    const rogue = keys()
    const fake = new Uint8Array(Buffer.from(JSON.stringify(signStatement({ format: 'verify-source-statement/1', source: 'bank:op', issued_at: '2026-10-04T00:00:00Z', body: { lines: [{ amount: 1034 }] } }, rogue.priv))))
    expect((await fileMove({ dir, move: move(id, w.vendor, { type: 'corroborate', field: { role: 'PAYABLE' }, evidence: { file: 'f.json', sha256: sha(fake), locator: 'lines[0].amount' } }), evidence: fake, now: '2026-10-05T10:00:00Z' })).refusal?.code).toBe('unauthenticated-source')
    const typed = new Uint8Array(Buffer.from(JSON.stringify({ payable_amount: 1034 })))
    expect((await fileMove({ dir, move: move(id, w.vendor, { type: 'correct', field: { role: 'PAYABLE' }, evidence: { file: 't.json', sha256: sha(typed) } }), evidence: typed, now: '2026-10-05T10:00:00Z' })).refusal?.code).toBe('not-a-document')
    // a countersigned filer CORRECT passes the door (and then the engine reads the document: a statement is no invoice page, so it reads it at its locator)
    const u = JSON.parse(Buffer.from(move(id, w.filer, { type: 'correct', field: { role: 'PAYABLE' }, evidence: ev })).toString())
    const cs = countersignMove(u, keyFingerprint(w.vendor.pub)!, w.vendor.priv)
    const ok = await fileMove({ dir, move: new Uint8Array(Buffer.from(JSON.stringify(cs))), evidence: doc, now: '2026-10-05T10:00:00Z' })
    expect([ok.accepted, ok.after!.gate]).toEqual([true, 'PASS'])
    const replayed = await fileMove({ dir, move: new Uint8Array(Buffer.from(JSON.stringify(cs))), evidence: doc, now: '2026-10-05T10:00:00Z' })
    expect(replayed.refusal?.code).toBe('nonce-reused')
    expect(caseStatus(dir, '2026-10-05T11:00:00Z').parties.vendor!.refused).toBe(3)
  })
  it('a CORRECT with the UBL XML reads the field at E1; a STRIKE of the document books UNSUPPORTED', async () => {
    const xml = new Uint8Array(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'einvoice', 'peppol-bis3-invoice.xml')))
    const a = opened(garbled)
    const r = await fileMove({ dir: a.dir, move: move(a.id, a.w.vendor, { type: 'correct', field: { role: 'PAYABLE' }, evidence: { file: 'inv.xml', sha256: sha(xml) } }), evidence: xml, now: '2026-10-05T10:00:00Z' })
    expect([r.accepted, r.after!.gate, r.verdict!.support![0]!.tier, r.verdict!.support![0]!.value]).toEqual([true, 'PASS', 'E1', 1034])
    const b = opened(garbled)
    const s = await fileMove({ dir: b.dir, move: move(b.id, b.w.operator, { type: 'strike', target: { document: 'filing' } }), now: '2026-10-05T10:00:00Z' })
    expect([s.accepted, s.resolution, s.verdict!.counts!.withdrawn]).toEqual([true, 'UNSUPPORTED', 4])
    expect(caseStatus(b.dir, '2026-10-05T11:00:00Z')).toMatchObject({ resolution: 'UNSUPPORTED', moves: { by_type: { strike: 1 } } })
  })
  it('the clock: past the deadline the case resolves UNSUPPORTED, never PASS; then only a higher-tier CORROBORATE reopens it', async () => {
    const { w, dir, id } = opened(garbled)
    expect(applyClock(dir, '2026-10-07T08:59:59Z').status).toBe('open')
    const st = applyClock(dir, '2026-10-07T09:00:01Z')
    expect([st.status, st.resolution, st.closed_on]).toEqual(['resolved', 'UNSUPPORTED', 'E4'])
    const xml = new Uint8Array(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'einvoice', 'peppol-bis3-invoice.xml')))
    const late = await fileMove({ dir, move: move(id, w.vendor, { type: 'correct', field: { role: 'PAYABLE' }, evidence: { file: 'x.xml', sha256: sha(xml) } }, '2026-10-08T00:00:00Z'), evidence: xml, now: '2026-10-08T00:00:00Z' })
    expect(late.refusal?.code).toBe('case-closed')
    const doc = statement(w.bank, 1034)
    const reopen = await fileMove({ dir, move: move(id, w.operator, { type: 'corroborate', field: { role: 'PAYABLE' }, evidence: { file: 's.json', sha256: sha(doc), locator: 'lines[0].amount' } }, '2026-10-08T00:00:00Z'), evidence: doc, now: '2026-10-08T00:00:00Z' })
    expect([reopen.accepted, reopen.resolution]).toEqual([true, 'PASS'])
    expect(readLedger(dir).map(r => r.kind)).toEqual(['case.open', 'case.resolve', 'move.refused', 'case.reopen', 'move.accepted', 'verdict', 'case.resolve'])
  })
  it('the record is hash-chained: an edited row breaks the chain, and nothing more is appended', async () => {
    const { w, dir, id } = opened(garbled)
    await fileMove({ dir, move: move(id, w.vendor, { type: 'correct', field: { role: 'PAYABLE' }, value: 1 } as never), now: '2026-10-05T10:00:00Z' })
    expect(ledgerProblems(readLedger(dir))).toEqual([])
    // an edit to any row before the head breaks the next row's link (the head itself needs a witness: a stated want)
    const text = readFileSync(join(dir, 'ledger.jsonl'), 'utf8').replace('"why":"struck"', '"why":"dispute"')
    writeFileSync(join(dir, 'ledger.jsonl'), text)
    appendFileSync(join(dir, 'ledger.jsonl'), '')
    expect(ledgerProblems(readLedger(dir))).toEqual(['row 2: prev does not chain to row 1'])
    await expect(fileMove({ dir, move: move(id, w.vendor, { type: 'correct', field: { role: 'PAYABLE' }, value: 1 } as never), now: '2026-10-05T10:00:00Z' })).rejects.toThrow(/does not chain/)
  })
})

void (null as unknown as Verdict)
