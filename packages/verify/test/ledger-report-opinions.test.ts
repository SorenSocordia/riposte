/**
 * The tenant report's opinions section: "what Riposte is asking for this month", the day-1 audit report of
 * Audit → Advise → Autonomy. Over a real book of record (real verify() verdicts through the real ledger):
 *  - the open proposals, urgent demotions first, each with the one-line ruling of ITS courtroom opinion (the same
 *    opinion `verify opinion` renders) and the path to read and dispute it; an UNEVIDENCED demotion (granted above the
 *    record, nothing gone wrong) is a standing notice, listed apart from the asks (D-UNEVIDENCED, SURFACES-2);
 *  - the FAIL / ABSTAIN notices by rung: surfaced at record and advise, HELD at gate and autonomy, each disputable;
 *  - deterministic, tenant-scoped, period-bounded, and honest when empty (no book, no policy, a book that fails).
 */
import { describe, it, expect } from 'vitest'
// The book is issued under the retained invoice 0.0.1 so its workflow stays <tenant>/invoice@0.0.1 (pinned 2026-09-28, NUMERIC-HONESTY).
import { INVOICE_RULESET_V0_0_1 } from '../src/rulesets/index'
import {
  renderTenantReport, EXAMPLE_PROMOTION_POLICY, assessVoice, workflowCalibration, promotionOpinion, snapshotOfLedger, verify,
  createLedger, MemoryLedger, parseChainJSONL, type WorkflowDeclaration, type Ledger,
} from '../src/index'
import { tenantOpinions, renderOpinionsSection, monthPeriod, type TenantReportOptions } from '../src/ledger/report'
import { buildLedger } from './fixtures/voice-ledger'
import { broken, FIXED_NOW } from './fixtures/invoices'

const P = EXAMPLE_PROMOTION_POLICY
const SEPT = { since: '2026-09-01T00:00:00.000Z', until: '2026-10-01T00:00:00.000Z', label: '2026-09' }
const DECLS: WorkflowDeclaration[] = [
  { workflow_id: 'acme/invoice@0.0.1', consequence_tier: 'low', granted: 'gate', bounds: 'PO-matched invoices under $1,000' },
  { workflow_id: 'beta/invoice@0.0.1', consequence_tier: 'low', granted: 'gate' },
  { workflow_id: 'acme/new@1.0.0', consequence_tier: 'low', granted: 'advise' },
]

/**
 * acme: 130 PASS + 60 FAIL reviewed (2 overturned) and one unreviewed FAIL → earns autonomy at gate (a promotion).
 * beta: 10 PASS + 5 FAIL reviewed (1 overturned) at gate → an urgent demotion.
 * gamma: nothing declared (record); one unreviewed ABSTAIN and one unreviewed FAIL, surfaced.
 * acme/new: declared advise with no verdicts yet → an unevidenced demotion: a standing notice, not an ask.
 */
function book(): { ledger: Ledger; openFail: string; gammaFail: string; gammaAbstain: string } {
  const a = buildLedger({ passes: 130, fails: 60, failOverturned: 2 })
  buildLedger({ ledger: a.ledger, tenant: 'beta', passes: 10, fails: 5, failOverturned: 1 })
  const open = verify({ ...broken, invoice_number: 'OPEN-1' }, { now: FIXED_NOW, ruleset: INVOICE_RULESET_V0_0_1 })
  a.ledger.record(open, { tenant_id: 'acme' })
  const abstain = verify({ invoice_number: 'EMPTY-1' }, { now: FIXED_NOW, ruleset: INVOICE_RULESET_V0_0_1 })
  expect(abstain.outcome).toBe('INSUFFICIENT_DATA')
  a.ledger.record(abstain, { tenant_id: 'gamma' })
  const gfail = verify({ ...broken, invoice_number: 'G-1' }, { now: FIXED_NOW, ruleset: INVOICE_RULESET_V0_0_1 })
  a.ledger.record(gfail, { tenant_id: 'gamma' })
  return { ledger: a.ledger, openFail: open.verdict_id, gammaFail: gfail.verdict_id, gammaAbstain: abstain.verdict_id }
}
const OPTS: TenantReportOptions = { period: SEPT, voice: { policy: P, declarations: DECLS } }

describe('what Riposte is asking for: the open proposals', () => {
  it('urgent demotions first, then promotions; each ruling is its own courtroom opinion\'s, verbatim', () => {
    const { ledger } = book()
    const o = tenantOpinions(ledger, OPTS)
    expect(o.asking.map(p => [p.workflow_id, p.kind, p.from, p.to])).toEqual([
      ['beta/invoice@0.0.1', 'DEMOTION_PROPOSAL', 'gate', 'advise'],
      ['acme/invoice@0.0.1', 'PROMOTION_PROPOSAL', 'gate', 'autonomy'],
    ])
    // D-UNEVIDENCED (E4 flipped: urgent := basis === 'failure'): a day-1 grant with no record is a standing notice, not an ask
    expect(o.standing.map(p => [p.workflow_id, p.kind, p.from, p.to, p.basis, p.urgent])).toEqual([
      ['acme/new@1.0.0', 'DEMOTION_PROPOSAL', 'advise', 'record', 'unevidenced', false],
    ])
    const snapshot = snapshotOfLedger(ledger)
    for (const p of [...o.asking, ...o.standing]) {
      const { workflow_id, ...settings } = DECLS.find(d => d.workflow_id === p.workflow_id)!
      const proposal = assessVoice(workflowCalibration(ledger.all(), workflow_id), { workflow_id, ...settings }, P).proposal!
      expect(p.proposal_id).toBe(proposal.proposal_id)
      const op = promotionOpinion({ snapshot, policy: P, proposal })
      expect(p.opinion_id).toBe(op.opinion_id)
      expect(p.ruling).toBe(op.ruling.statement)
      expect(p.verified).toBe(true)
      expect(p.urgent).toBe(p.kind === 'DEMOTION_PROPOSAL' && p.basis === 'failure')
    }
    expect(o.asking[0]!.basis).toBe('failure')
    expect(o.asking[0]!.failing_cases).toHaveLength(1)
    expect(o.asking[0]!.failing_cases[0]!.dispute).toMatch(/^verify opinion --ledger <chain\.jsonl> --dispute [0-9a-f]{32}$/)
  })

  it('renders each ask with its ruling, its failing cases, and how to read (and so dispute) the opinion', () => {
    const md = renderTenantReport(book().ledger, OPTS)
    expect(md).toContain('## Opinions: what Riposte is asking for (2026-09)')
    expect(md).toContain('### Asking for (2)')
    expect(md).toContain('1. **URGENT · step down** `beta/invoice@0.0.1`: `gate` → `advise`')
    expect(md).toContain('2. **Promotion** `acme/invoice@0.0.1`: `gate` → `autonomy`')
    // acme/new: a day-1 grant with no verdicts. D-UNEVIDENCED (2026-09-28): a standing notice listed apart, never an ask or an alarm.
    expect(md).toContain('### Granted above the evidence (1)')
    expect(md).toContain('1. **Granted above the evidence** `acme/new@1.0.0` at `advise`: the record does not yet support it, and nothing has gone wrong')
    expect(md.indexOf('### Asking for (2)')).toBeLessThan(md.indexOf('### Granted above the evidence (1)'))
    expect(md).not.toMatch(/URGENT[^\n]*acme\/new/)
    expect(md).toContain('   - Ruling: Proposed: promote `acme/invoice@0.0.1` from `gate` to `autonomy`')
    expect(md).toContain('   - Failing cases (1), each disputable on its own:')
    expect(md).toContain('`verify opinion --ledger <chain.jsonl> --policy <policy.json> --workflow acme/invoice@0.0.1 --tier low --granted gate --bounds "PO-matched invoices under $1,000"`')
    expect(md).toContain('declining costs nothing')
    expect(md).toContain('◇ This is the illustrative example policy')
    // the section sits before the tamper-evidence attestation, which stays last
    expect(md.indexOf('## Opinions')).toBeLessThan(md.indexOf('## Tamper-evidence'))
    expect(md.indexOf('## Per-rule calibration')).toBeLessThan(md.indexOf('## Opinions'))
  })

  it('never changes a rung: every workflow row carries exactly the rung a person granted', () => {
    const o = tenantOpinions(book().ledger, OPTS)
    expect(o.workflows.map(w => [w.workflow_id, w.granted, w.declared, w.earned ?? null])).toEqual([
      ['acme/invoice@0.0.1', 'gate', true, 'autonomy'],
      ['acme/new@1.0.0', 'advise', true, 'record'],
      ['beta/invoice@0.0.1', 'gate', true, 'record'],
      ['gamma/invoice@0.0.1', 'record', false, null],
    ])
  })
})

describe('FAIL / ABSTAIN notices by rung', () => {
  it('surfaced at record, HELD at gate; unreviewed ones listed with their dispute path; reviewed ones counted as resolved', () => {
    const { ledger, openFail, gammaFail, gammaAbstain } = book()
    const o = tenantOpinions(ledger, OPTS)
    expect(o.notices.map(r => r.level)).toEqual(['record', 'gate'])
    const [rec, gate] = o.notices
    expect(rec!.workflows.map(w => w.workflow_id)).toEqual(['gamma/invoice@0.0.1'])
    expect(rec!.workflows[0]!.open.map(n => [n.verdict_id, n.outcome, n.action])).toEqual([[gammaAbstain, 'INSUFFICIENT_DATA', 'SURFACE'], [gammaFail, 'FAIL', 'SURFACE']])
    const acme = gate!.workflows.find(w => w.workflow_id === 'acme/invoice@0.0.1')!
    expect(acme).toMatchObject({ fail: 61, abstain: 0, resolved: 60 })
    expect(acme.open.map(n => [n.verdict_id, n.action])).toEqual([[openFail, 'HOLD']])
    expect(acme.open[0]!.dispute).toBe(`verify opinion --ledger <chain.jsonl> --dispute ${openFail}`)
    expect(gate!.workflows.find(w => w.workflow_id === 'beta/invoice@0.0.1')).toMatchObject({ fail: 5, resolved: 5, open: [] })
    const md = renderTenantReport(ledger, OPTS)
    expect(md).toContain('#### `record`: surfaced as a notice on the record; nothing is held')
    expect(md).toContain('#### `gate`: HELD until a person resolves it')
    expect(md).toContain(`· HELD · Law of Footing on \`subtotal\``)
  })

  it('the period bounds the notices, not the proposals (voice weighs the whole record)', () => {
    const { ledger } = book()
    const o = tenantOpinions(ledger, { ...OPTS, period: { since: '2026-10-01T00:00:00.000Z', until: '2026-11-01T00:00:00.000Z', label: '2026-10' } })
    expect(o.notices).toEqual([])
    expect(o.asking).toHaveLength(2)
    expect(o.standing).toHaveLength(1)
    expect(renderTenantReport(ledger, { ...OPTS, period: { since: '2026-10-01T00:00:00.000Z', label: '2026-10' } })).toContain('No FAIL or ABSTAIN on record in the period.')
  })

  it('caps each list and says how many more', () => {
    const { ledger } = buildLedger({ passes: 1, fails: 4, reviewedFails: 0 })
    const md = renderTenantReport(ledger, { period: SEPT, max_notices: 2 })
    expect(md).toContain('4 FAIL · 0 ABSTAIN; 4 awaiting a person, 0 resolved.')
    expect(md).toContain('  - … 2 more awaiting a person')
  })
})

describe('deterministic, tenant-scoped, honest when empty', () => {
  it('the same book renders byte-identically, and as_of stays out of the section', () => {
    const { ledger } = book()
    expect(renderTenantReport(ledger, OPTS)).toBe(renderTenantReport(ledger, OPTS))
    expect(JSON.stringify(tenantOpinions(ledger, OPTS))).toBe(JSON.stringify(tenantOpinions(ledger, { ...OPTS, as_of: '2031-01-01' })))
  })

  it('one tenant sees only its own workflows, proposals and notices', () => {
    const md = renderTenantReport(book().ledger, { ...OPTS, tenant_id: 'acme' })
    expect(md).toContain('`acme/invoice@0.0.1`')
    expect(md).toContain('`acme/new@1.0.0`')
    expect(md).not.toMatch(/beta\/|gamma\//)
    const o = tenantOpinions(book().ledger, { ...OPTS, tenant_id: 'beta' })
    expect(o.asking.map(p => p.workflow_id)).toEqual(['beta/invoice@0.0.1'])
  })

  it('no book: says Riposte is asking for nothing; a rung a person granted with no record behind it is a standing notice', () => {
    expect(renderTenantReport(createLedger(), { ...OPTS, voice: { policy: P } })).toContain('No workflow has a verdict on record yet: Riposte is asking for nothing, and there is nothing to notice.')
    // declared day-1 grants above record, with no evidence: an unevidenced demotion for each, a standing notice (never an ask)
    const o = tenantOpinions(createLedger(), OPTS)
    expect(o.asking).toEqual([])
    expect(o.standing.map(p => [p.workflow_id, p.kind, p.basis, p.urgent])).toEqual([
      ['acme/invoice@0.0.1', 'DEMOTION_PROPOSAL', 'unevidenced', false], ['acme/new@1.0.0', 'DEMOTION_PROPOSAL', 'unevidenced', false], ['beta/invoice@0.0.1', 'DEMOTION_PROPOSAL', 'unevidenced', false],
    ])
    expect(o.notices).toEqual([])
    const md = renderOpinionsSection(o)
    expect(md).toContain('No FAIL or ABSTAIN on record in the period.')
    expect(md).toContain('Riposte is asking for nothing: nothing has gone wrong under what a person granted, and no workflow\'s record supports a promotion. 3 workflows run above what the record yet supports: a standing notice (below), not an ask.')
    expect(md).toContain('### Granted above the evidence (3)')
  })

  it('no policy: proposes nothing, says why, and still lists every FAIL / ABSTAIN (all at record)', () => {
    const { ledger } = book()
    const o = tenantOpinions(ledger, { period: SEPT })
    expect(o.asking).toEqual([])
    expect(o.notices.map(r => r.level)).toEqual(['record'])
    const md = renderTenantReport(ledger, { period: SEPT })
    expect(md).toContain('No promotion policy is declared: Riposte weighs no evidence toward a rung change and proposes nothing.')
    expect(md).toContain('| `beta/invoice@0.0.1` | record (nothing granted) |')
  })

  it('a policy that does not lint proposes nothing, and says so', () => {
    const md = renderTenantReport(book().ledger, { ...OPTS, voice: { policy: { ...P, tiers: [] }, declarations: DECLS } })
    expect(md).toMatch(/The declared promotion policy does not lint \(tiers must be a non-empty array/)
    expect(md).toContain('### Asking for (0)')
  })

  it('settings the policy refuses are named per workflow, not silently skipped', () => {
    const o = tenantOpinions(book().ledger, { ...OPTS, voice: { policy: P, declarations: [{ workflow_id: 'acme/invoice@0.0.1', consequence_tier: 'galactic', granted: 'gate' }] } })
    expect(o.workflows.find(w => w.workflow_id === 'acme/invoice@0.0.1')!.problem).toMatch(/galactic/)
  })

  it('a book whose content does not verify: proposals withheld, notices flagged', () => {
    const { ledger } = buildLedger({ passes: 130, fails: 60, failOverturned: 2 })
    const lines = ledger.chainJSONL().split('\n')
    const i = lines.findIndex(l => l.includes('"type":"REVIEW"'))
    lines[i] = lines[i]!.replace('"reviewer_id":"ap-lead"', '"reviewer_id":"someone-else"')
    const tampered = new MemoryLedger({ seed: parseChainJSONL(lines.join('\n')) })
    const o = tenantOpinions(tampered, OPTS)
    expect(o.book.content_verified).toBe(false)
    expect(o.asking).toEqual([])
    const md = renderOpinionsSection(o)
    expect(md).toContain('⚠ Withheld: the book of record did not verify')
    expect(md).toContain('⚠ Read from a book of record that did not verify')
  })

  it('monthPeriod is the UTC calendar month, across a year end', () => {
    expect(monthPeriod(new Date('2026-09-15T12:00:00Z'))).toEqual(SEPT)
    expect(monthPeriod(new Date('2026-12-31T23:59:59Z'))).toEqual({ since: '2026-12-01T00:00:00.000Z', until: '2027-01-01T00:00:00.000Z', label: '2026-12' })
  })
})
