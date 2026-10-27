/**
 * Per-action handling (the design ruling, 2026-09-28, as corrected 08:35: *"the human should be made aware of what
 * fails in case they want to dispute"*):
 *  - at EVERY rung, every FAIL is surfaced to the person with its evidence and a dispute path for that single finding;
 *  - whether it also HOLDS the action is the rung's: surfaced at record and advise, held at gate and autonomy;
 *  - PASS: unchanged at record/advise, human review at gate, proceeds within bounds at autonomy;
 *  - the findings and dispute paths are identical at every rung; only the handling differs.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFileSync, rmSync, existsSync } from 'node:fs'
import {
  verify, actionNotice, renderActionNotice, verdictFindings, renderVerdict, assessVoice, workflowCalibration,
  EXAMPLE_PROMOTION_POLICY, ACTION_HANDLING, VOICE_LADDER, snapshotOfLedger, disputeOpinion, type VoiceLevel,
} from '../src/index'
import { run, type CliIO } from '../src/cli'
import { ALL_STANDALONE, broken, clean, FIXED_NOW } from './fixtures/invoices'
import { buildLedger, WF } from './fixtures/voice-ledger'

const files: string[] = []
function tmp(name: string, content: unknown): string {
  const p = join(tmpdir(), `verify-notice-${process.pid}-${files.length}-${name}`)
  writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content))
  files.push(p)
  return p
}
afterEach(() => { for (const f of files.splice(0)) if (existsSync(f)) rmSync(f) })
function cap(): CliIO & { out_: () => string; err_: () => string } {
  let o = '', e = ''
  return { out: s => { o += s }, err: s => { e += s }, out_: () => o, err_: () => e }
}

const HOLDS: Record<VoiceLevel, boolean> = { record: false, advise: false, gate: true, autonomy: true }

describe('the handling table: surfaced at record and advise, held at gate and autonomy', () => {
  it('is exactly the ruling', () => {
    expect(ACTION_HANDLING).toEqual({
      record: { FAIL: 'SURFACE', INSUFFICIENT_DATA: 'SURFACE', PASS: 'UNCHANGED', delivery: 'notice', every_fail_disputable: true },
      advise: { FAIL: 'SURFACE', INSUFFICIENT_DATA: 'SURFACE', PASS: 'UNCHANGED', delivery: 'in-flow', every_fail_disputable: true },
      gate: { FAIL: 'HOLD', INSUFFICIENT_DATA: 'HOLD', PASS: 'HUMAN_REVIEW', delivery: 'in-flow', every_fail_disputable: true },
      autonomy: { FAIL: 'HOLD', INSUFFICIENT_DATA: 'HOLD', PASS: 'ACT_WITHIN_BOUNDS', delivery: 'in-flow', every_fail_disputable: true },
    })
  })

  it('for every fixture and every rung: the same findings and dispute paths; the action follows the rung\'s handling', () => {
    for (const [name, doc] of ALL_STANDALONE) {
      const v = verify(doc, { now: FIXED_NOW })
      const base = verdictFindings(v)
      expect(base.outcome, name).toBe(v.outcome)
      const fails = v.claims.filter(c => c.outcome === 'FAIL').map(c => c.claim_id)
      const absts = v.claims.filter(c => c.outcome === 'INSUFFICIENT_DATA').map(c => c.claim_id)
      expect(base.findings.map(f => f.claim_id), name).toEqual([...fails, ...absts]) // every one, FAILs first
      for (const level of VOICE_LADDER) {
        const n = actionNotice(v, level)
        expect(n.findings, `${name}@${level}`).toEqual(base.findings) // awareness is identical at every rung
        expect(n.handling).toEqual(ACTION_HANDLING[level])
        expect(n.action, `${name}@${level}`).toBe(v.outcome === 'PASS' ? 'PROCEED' : HOLDS[level] ? 'HOLD' : 'SURFACE')
      }
    }
  })

  it('an assessment at each granted rung carries that rung\'s handling', () => {
    const { ledger } = buildLedger({ passes: 130, fails: 60, passOverturned: 6, failOverturned: 2 })
    const cal = workflowCalibration(ledger.all(), WF())
    for (const granted of VOICE_LADDER) {
      const a = assessVoice(cal, { workflow_id: WF(), consequence_tier: 'low', granted }, EXAMPLE_PROMOTION_POLICY)
      expect(a.handling).toEqual(ACTION_HANDLING[granted])
    }
    expect(() => actionNotice(verify(clean, { now: FIXED_NOW }), 'boss' as VoiceLevel)).toThrow(/unknown rung/)
  })
})

describe('every FAIL is visible, with its evidence and a dispute path, at every rung', () => {
  it('each FAIL carries its cells and a dispute command naming its verdict and claim', () => {
    const v = verify(broken, { now: FIXED_NOW })
    const fails = verdictFindings(v).findings.filter(f => f.outcome === 'FAIL')
    expect(fails.length).toBe(3)
    for (const f of fails) {
      expect(f.evidence.length).toBeGreaterThan(0)
      expect(f.dispute).toBe(`verify opinion --ledger <chain.jsonl> --dispute ${v.verdict_id} --claim ${f.claim_id}`)
      expect(f.expected).toBeDefined()
    }
  })

  it('a can\'t-tell verdict is surfaced and held as INSUFFICIENT_DATA, the verdict\'s own word (ABSTAIN is no longer printed)', () => {
    const v = verify({ invoice_number: 'INV-1' }, { now: FIXED_NOW })
    expect(v.outcome).toBe('INSUFFICIENT_DATA')
    const rec = renderActionNotice(actionNotice(v, 'record'))
    expect(rec).toMatch(/^\*\*INSUFFICIENT_DATA: surfaced, not held\*\* · rung `record`.*the checks could not decide \(INSUFFICIENT_DATA: can't tell\)/)
    expect(renderActionNotice(actionNotice(v, 'gate'))).toMatch(/^\*\*HELD for a person\*\* · rung `gate`.*could not decide \(INSUFFICIENT_DATA: can't tell\)/)
    for (const level of VOICE_LADDER) expect(renderActionNotice(actionNotice(v, level))).not.toContain('ABSTAIN')
  })

  it('renders per rung: record surfaces a notice, advise surfaces in-flow, gate and autonomy hold; the findings are always there', () => {
    const v = verify(broken, { now: FIXED_NOW })
    const rec = renderActionNotice(actionNotice(v, 'record'))
    expect(rec).toMatch(/^\*\*FAIL: surfaced, not held\*\* · rung `record` \(a notice on the record\)/)
    expect(renderActionNotice(actionNotice(v, 'advise'))).toMatch(/^\*\*FAIL: surfaced, not held\*\* · rung `advise` \(shown in-flow to the person and the agent\)/)
    expect(renderActionNotice(actionNotice(v, 'gate'))).toMatch(/^\*\*HELD for a person\*\* · rung `gate`.*It stays held until a person resolves it\./)
    expect(renderActionNotice(actionNotice(v, 'autonomy'))).toMatch(/^\*\*HELD for a person\*\* · rung `autonomy`/)
    for (const level of VOICE_LADDER) {
      const md = renderActionNotice(actionNotice(v, level))
      expect(md).toMatch(/- ✗ \*\*Law of Footing\*\* \(`document\.SUM_INT`\) on `subtotal`/)
      expect(md).toMatch(/ {2}- `invoice:totals\.subtotal` = 1750\.5 · confidence 100/)
      expect(md).toMatch(/ {2}- dispute this finding: `verify opinion --ledger <chain\.jsonl> --dispute [0-9a-f]{32} --claim document\.SUM_INT`/)
    }
    expect(renderActionNotice(actionNotice(verify(clean, { now: FIXED_NOW }), 'autonomy'))).toMatch(/^\*\*PROCEED\*\* · rung `autonomy`.*proceeds unreviewed within the declared bounds/)
    expect(renderActionNotice(actionNotice(verify(clean, { now: FIXED_NOW }), 'record'))).toMatch(/Riposte does not intervene/)
  })

  it('the VERDICT card is rung-free: each FAIL with its cells and dispute path, and the per-rung handling stated', () => {
    const md = renderVerdict(verify(broken, { now: FIXED_NOW }))
    expect(md).not.toMatch(/HELD for a person/)
    expect(md).toMatch(/At record and advise it is surfaced, not held; at gate and autonomy it holds the action until a person resolves it\./)
    expect(md).toMatch(/ {2}- dispute: `verify opinion --ledger <chain\.jsonl> --dispute [0-9a-f]{32} --claim document\.SUM_INT`/)
  })
})

describe('a dispute is reachable from a single FAIL', () => {
  it('the notice\'s own dispute command, run against the book of record, yields the dispute opinion for that one finding', () => {
    const { ledger, failIds } = buildLedger({ passes: 5, fails: 12, failOverturned: 1 })
    const v = ledger.get(failIds[4]!)!.verdict
    const finding = actionNotice(v, 'record').findings.find(f => f.outcome === 'FAIL' && f.claim_id === 'document.TAX_INT')!
    const argv = finding.dispute.replace(/^verify /, '').split(' ').map(t => (t === '<chain.jsonl>' ? tmp('chain.jsonl', ledger.chainJSONL()) : t))
    const io = cap()
    expect(run(argv, io)).toBe(0)
    expect(io.out_()).toMatch(/^# Opinion: Dispute: `document\.TAX_INT`/)
    expect(io.out_()).toMatch(/disposition \*\*UPHOLD\*\*/)
    const op = disputeOpinion({ snapshot: snapshotOfLedger(ledger), verdict_id: v.verdict_id, claim_id: finding.claim_id })
    expect(op.subject).toMatchObject({ claim_id: 'document.TAX_INT', outcome: 'FAIL' })
  })

  it('`verify notice`: default rung record (surfaced, exit 2); gate holds (exit 1); a PASS proceeds (exit 0); --json for hosts', () => {
    const vb = tmp('v.json', verify(broken, { now: FIXED_NOW }))
    const rec = cap()
    expect(run(['notice', vb], rec)).toBe(2)
    expect(rec.out_()).toMatch(/surfaced, not held/)
    const gate = cap()
    expect(run(['notice', vb, '--level', 'gate'], gate)).toBe(1)
    expect(gate.out_()).toMatch(/HELD for a person/)
    const ok = cap()
    expect(run(['notice', tmp('v.json', verify(clean, { now: FIXED_NOW })), '--level', 'autonomy', '--json'], ok)).toBe(0)
    expect(JSON.parse(ok.out_())).toMatchObject({ action: 'PROCEED', level: 'autonomy', handling: { PASS: 'ACT_WITHIN_BOUNDS' } })
    expect(run(['notice'], cap())).toBe(3)
    expect(run(['notice', vb, '--level', 'boss'], cap())).toBe(3)
    expect(run(['notice', tmp('x.json', { hello: 1 })], cap())).toBe(3)
  })
})
