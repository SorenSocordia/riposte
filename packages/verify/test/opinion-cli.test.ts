/**
 * `verify voice` and `verify opinion` — driven through run(argv, io) with a captured IO and temp files: a real chain
 * export (ledger.chainJSONL(), the file-ledger format), a declared policy, and a proposal.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFileSync, rmSync, existsSync } from 'node:fs'
import { run, parseOpinionArgs, type CliIO } from '../src/cli'
import { assessVoice, workflowCalibration, policyRef, EXAMPLE_PROMOTION_POLICY } from '../src/index'
import { buildLedger, WF } from './fixtures/voice-ledger'

const files: string[] = []
function tmp(name: string, content: unknown): string {
  const p = join(tmpdir(), `verify-opinion-cli-${process.pid}-${files.length}-${name}`)
  writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content))
  files.push(p)
  return p
}
afterEach(() => { for (const f of files.splice(0)) if (existsSync(f)) rmSync(f) })

function cap(): CliIO & { out_: () => string; err_: () => string } {
  let o = '', e = ''
  return { out: s => { o += s }, err: s => { e += s }, out_: () => o, err_: () => e }
}

const { ledger, failIds } = buildLedger({ passes: 130, fails: 60, failOverturned: 2 })
const CHAIN = ledger.chainJSONL()

describe('verify voice', () => {
  it('prints the chain status and the assessment; proposes, never grants', () => {
    const io = cap()
    const code = run(['voice', '--ledger', tmp('chain.jsonl', CHAIN), '--policy', tmp('policy.json', EXAMPLE_PROMOTION_POLICY), '--workflow', WF(), '--tier', 'low', '--granted', 'gate'], io)
    expect(code).toBe(0)
    const out = JSON.parse(io.out_())
    expect(out.chain).toMatchObject({ content_verified: true, ok: true, head: ledger.chainHead() })
    expect(out.assessment).toMatchObject({ granted: 'gate', earned: 'autonomy', level: 'gate' })
    expect(out.assessment.proposal).toMatchObject({ status: 'PROPOSED', from: 'gate', to: 'autonomy' })
  })

  it('lists the workflows on the ledger when --workflow is missing, and rejects unknown flags and bad levels', () => {
    const io = cap()
    expect(run(['voice', '--ledger', tmp('chain.jsonl', CHAIN), '--policy', tmp('policy.json', EXAMPLE_PROMOTION_POLICY), '--tier', 'low'], io)).toBe(3)
    expect(io.err_()).toMatch(/Workflows on this ledger:\n {2}acme\/invoice@0\.0\.1 \(190 verdicts\)/)
    const io2 = cap()
    expect(run(['voice', '--ledgr', 'x'], io2)).toBe(3)
    expect(io2.err_()).toMatch(/unknown option\(s\) --ledgr/)
    const io3 = cap()
    expect(run(['voice', '--ledger', tmp('chain.jsonl', CHAIN), '--policy', tmp('policy.json', EXAMPLE_PROMOTION_POLICY), '--workflow', WF(), '--tier', 'low', '--granted', 'king'], io3)).toBe(3)
    expect(io3.err_()).toMatch(/--granted must be one of/)
  })

  it('exits 2 while an URGENT demotion proposal is open, and never moves the rung itself', () => {
    const misses = buildLedger({ passes: 130, fails: 60, passOverturned: 6, failOverturned: 2, prefix: 'miss' })
    const io = cap()
    expect(run(['voice', '--ledger', tmp('chain.jsonl', misses.ledger.chainJSONL()), '--policy', tmp('policy.json', EXAMPLE_PROMOTION_POLICY), '--workflow', WF(), '--tier', 'low', '--granted', 'autonomy'], io)).toBe(2)
    const out = JSON.parse(io.out_())
    expect(out.assessment).toMatchObject({ granted: 'autonomy', level: 'autonomy', earned: 'gate' })
    expect(out.assessment.proposal).toMatchObject({ kind: 'DEMOTION_PROPOSAL', urgent: true, from: 'autonomy', to: 'gate' })
    expect(out.assessment.proposal.failing_cases).toHaveLength(6)
  })

  it('--grant fixes the settings: a grant made under another policy version is refused', () => {
    const grant = { level: 'gate', signer_id: 'ap-lead', signed_at: '2026-09-28T09:00:00Z', policy: policyRef(EXAMPLE_PROMOTION_POLICY), consequence_tier: 'low' }
    const io = cap()
    expect(run(['voice', '--ledger', tmp('chain.jsonl', CHAIN), '--policy', tmp('policy.json', EXAMPLE_PROMOTION_POLICY), '--workflow', WF(), '--grant', tmp('grant.json', grant)], io)).toBe(0)
    expect(JSON.parse(io.out_()).assessment).toMatchObject({ granted: 'gate', level: 'gate', consequence_tier: 'low', grant: { signer_id: 'ap-lead' } })
    const other = { ...EXAMPLE_PROMOTION_POLICY, version: '9.9.9' }
    const io2 = cap()
    expect(run(['voice', '--ledger', tmp('chain.jsonl', CHAIN), '--policy', tmp('policy.json', other), '--workflow', WF(), '--grant', tmp('grant.json', grant)], io2)).toBe(3)
    expect(io2.err_()).toMatch(/Settings are fixed at grant time/)
  })

  it('exits 1 when the chain does not verify (a tampered payload)', () => {
    const lines = CHAIN.split('\n')
    const ev = JSON.parse(lines[0]!)
    ev.payload.tenant_id = 'mallory'
    lines[0] = JSON.stringify(ev)
    const io = cap()
    expect(run(['voice', '--ledger', tmp('chain.jsonl', lines.join('\n')), '--policy', tmp('policy.json', EXAMPLE_PROMOTION_POLICY), '--workflow', WF(), '--tier', 'low'], io)).toBe(1)
    expect(JSON.parse(io.out_()).chain.content_verified).toBe(false)
  })
})

describe('verify opinion', () => {
  const proposal = assessVoice(workflowCalibration(ledger.all(), WF()), { workflow_id: WF(), consequence_tier: 'low', granted: 'gate' }, EXAMPLE_PROMOTION_POLICY).proposal!

  it('renders the promotion opinion from a proposal file (Markdown), exit 0', () => {
    const io = cap()
    expect(run(['opinion', '--ledger', tmp('chain.jsonl', CHAIN), '--policy', tmp('policy.json', EXAMPLE_PROMOTION_POLICY), '--proposal', tmp('proposal.json', proposal)], io)).toBe(0)
    expect(io.out_()).toMatch(/^# Opinion: Promote `acme\/invoice@0\.0\.1` from gate to autonomy\?/)
    expect(io.out_()).toMatch(/disposition \*\*PROPOSE_PROMOTION\*\*/)
    expect(io.out_()).toMatch(/## The steelmanned dissent/)
  })

  it('--json prints the source of truth; a doctored proposal is withheld with exit 1', () => {
    const io = cap()
    const doctored = { ...proposal, to: 'autonomy', from: 'record' }
    expect(run(['opinion', '--ledger', tmp('chain.jsonl', CHAIN), '--policy', tmp('policy.json', EXAMPLE_PROMOTION_POLICY), '--proposal', tmp('proposal.json', doctored), '--json'], io)).toBe(1)
    const op = JSON.parse(io.out_())
    expect(op.channel).toBe('COUNSEL')
    expect(op.ruling.disposition).toBe('WITHHELD')
  })

  it('argues whatever the evidence poses from a declaration, and a dispute by verdict id', () => {
    const io = cap()
    expect(run(['opinion', '--ledger', tmp('chain.jsonl', CHAIN), '--policy', tmp('policy.json', EXAMPLE_PROMOTION_POLICY), '--workflow', WF(), '--tier', 'high', '--granted', 'advise'], io)).toBe(0)
    expect(io.out_()).toMatch(/disposition \*\*NOT_YET\*\*/)
    const io2 = cap()
    expect(run(['opinion', '--ledger', tmp('chain.jsonl', CHAIN), '--dispute', failIds[7]!, '--claim', 'document.SUM_INT'], io2)).toBe(0)
    expect(io2.out_()).toMatch(/^# Opinion: Dispute: `document\.SUM_INT`/)
    expect(io2.out_()).toMatch(/disposition \*\*UPHOLD\*\*/)
  })

  it('usage errors exit 3', () => {
    const io = cap()
    expect(run(['opinion'], io)).toBe(3)
    expect(io.err_()).toMatch(/verify opinion needs --ledger/)
    const io2 = cap()
    expect(run(['opinion', '--ledger', tmp('chain.jsonl', CHAIN)], io2)).toBe(3)
    expect(io2.err_()).toMatch(/needs --policy/)
    const io3 = cap()
    expect(run(['opinion', '--ledger', tmp('chain.jsonl', CHAIN), '--dispute', 'nope'], io3)).toBe(3)
    expect(io3.err_()).toMatch(/not on the supplied book of record/)
    expect(parseOpinionArgs(['--json', '--bounds', 'under $5k']).bounds).toBe('under $5k')
  })
})
