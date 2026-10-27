/**
 * BOOK FIRST (2026-09-28): the surfaces read each workflow's rung from the book of record (the GRANT in force, a
 * person's signed decision), never from a flag, and say a person's decline in words.
 *   - renderTenantReport / tenantOpinions take `voice.book`: granted workflows are listed (with or without verdicts), the
 *     rung is cited, a standing DECLINE is said ("declined by X at T; re-raises when …"), a lapsed one is named when the
 *     proposal is asked again, declarations cover only ungranted workflows and never override a grant, and a book that
 *     does not verify grants nothing;
 *   - voiceSurface takes the book (BookSettings), and MCP voice_assess takes `from_book`;
 *   - the managed tier (GET /v1/voice, POST /v1/opinion, the report) reads the GRANTs on its own ledger.
 * Over a real book (real verify() verdicts, real Ed25519 decisions through ledger.decide); temp ledgers only.
 *
 * SURFACES-2 (2026-09-28): the books anchor the owner's key (D-ANCHOR: an unanchored GRANT or DECLINE is on the book and has
 * no rung effect), so the grants here are in force; the unanchored cases say so. The report's words follow D-DECLINED-COPY
 * ("Kept at <rung> by <person>, <date>; stands until …" / "Not now: <person>, <date>; re-raises when …"), and a book-read ask
 * points at `verify opinion --from-book`.
 */
import { describe, it, expect } from 'vitest'
// The book is issued under the retained invoice 0.0.1 so its workflow stays <tenant>/invoice@0.0.1 (pinned 2026-09-28, NUMERIC-HONESTY).
import { INVOICE_RULESET_V0_0_1 } from '../src/rulesets/index'
import { createPrivateKey, createPublicKey } from 'node:crypto'
import {
  EXAMPLE_PROMOTION_POLICY, assessVoiceFromLedger, declineDecision, makeGrant, signDecision, policyRef, verify, snapshotOfLedger, openSnapshot,
  parseChainJSONL, MemoryLedger, renderTenantReport, workflowCalibration, assessVoice, createLedger,
  type Ledger, type VoiceLevel, type TrustedKeys,
} from '../src/index'
import { tenantOpinions, readRung, readVoiceBook, declarationsOverridden, type TenantReportOptions } from '../src/ledger/report'
import { voiceSurface, voiceFromJson } from '../src/http/surfaces'
import { createService, apiKeyAuth, type VoiceConfig } from '../src/http/service'
import { handleRequest, type JsonRpcRequest } from '../src/mcp/server'
import { buildLedger, freshClock, WF } from './fixtures/voice-ledger'
import { clean, broken, FIXED_NOW } from './fixtures/invoices'

const P = EXAMPLE_PROMOTION_POLICY
const SEPT = { since: '2026-09-01T00:00:00.000Z', until: '2026-10-01T00:00:00.000Z', label: '2026-09' }

function keyFromSeed(seedHex: string): { privateKeyPem: string; publicKeyPem: string } {
  const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(seedHex, 'hex')])
  const k = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' })
  return { privateKeyPem: k.export({ type: 'pkcs8', format: 'pem' }).toString(), publicKeyPem: createPublicKey(k).export({ type: 'spki', format: 'pem' }).toString() }
}
const OWNER = keyFromSeed('11'.repeat(32))
const AGENT = keyFromSeed('33'.repeat(32))

/** A person's GRANT, signed and appended through the ledger's door. */
function grant(ledger: Ledger, level: VoiceLevel, o: { wf?: string; tier?: string; bounds?: string; at?: string; key?: string; signer?: string } = {}) {
  const d = makeGrant({
    workflow_id: o.wf ?? WF(), level, consequence_tier: o.tier ?? 'low', policy: policyRef(P),
    ...(o.bounds !== undefined ? { bounds: o.bounds } : level === 'autonomy' ? { bounds: 'PO-matched invoices under $5,000' } : {}),
    signer_id: o.signer ?? 'owner', signed_at: o.at ?? '2026-09-28T09:40:00Z',
  })
  return ledger.decide(signDecision(d, o.key ?? OWNER.privateKeyPem))
}
/** A person's DECLINE of the proposal on the book-read assessment. */
function decline(ledger: Ledger, wf = WF(), tier?: string) {
  const a = assessVoiceFromLedger(ledger, wf, P, tier ? { consequence_tier: tier } : {})
  const d = declineDecision(a, { signer_id: 'owner', signed_at: '2026-09-28T09:50:00Z', reason: 'the six misses were one vendor, since fixed' })
  return { entry: ledger.decide(signDecision(d, OWNER.privateKeyPem)), assessment: a }
}
/** A new PASS a person overturns: a failing case the decline did not see. */
function newMiss(ledger: Ledger, n = 'new-miss'): void {
  const v = verify({ ...clean, invoice_number: n }, { now: FIXED_NOW, ruleset: INVOICE_RULESET_V0_0_1 })
  ledger.record(v, { tenant_id: 'acme' })
  ledger.review(v.verdict_id, { reviewer_id: 'ap-lead', decision: 'OVERTURNED' })
}
/** The owner's key, anchored on the book: D-ANCHOR, a GRANT or DECLINE moves a rung only when its signer is anchored. */
const ANCHORS: TrustedKeys = { owner: OWNER.publicKeyPem }
const anchored = (): Ledger => createLedger({ now: freshClock(), trusted_keys: ANCHORS })
const strong = (): Ledger => buildLedger({ ledger: anchored(), passes: 130, fails: 60, failOverturned: 2 }).ledger
const misses = (): Ledger => buildLedger({ ledger: anchored(), passes: 130, fails: 60, passOverturned: 6, failOverturned: 2, prefix: 'miss' }).ledger
/** Unanchored books (no trusted keys): any valid signature passes the door, and D-ANCHOR gives it no rung effect on read. */
const looseStrong = (): Ledger => buildLedger({ passes: 130, fails: 60, failOverturned: 2 }).ledger
const looseMisses = (): Ledger => buildLedger({ passes: 130, fails: 60, passOverturned: 6, failOverturned: 2, prefix: 'miss' }).ledger
const FROM_BOOK = (wf: string, tail = ''): string => `verify opinion --from-book --ledger <chain.jsonl> --policy <policy.json> --workflow ${wf}${tail}`
const bookOpts = (ledger: Ledger, extra: Partial<NonNullable<TenantReportOptions['voice']>> = {}): TenantReportOptions =>
  ({ period: SEPT, voice: { policy: P, book: ledger, ...extra } })

// ── the report reads the book ────────────────────────────────────────────────────────────────────────────────────────

describe('the report reads each rung from the book of record', () => {
  it('a GRANT sets the rung, is cited, and the ask points at verify opinion --from-book', () => {
    const ledger = strong()
    const g = grant(ledger, 'gate')
    const o = tenantOpinions(ledger, bookOpts(ledger))
    const row = o.workflows.find(w => w.workflow_id === WF())!
    expect(row).toMatchObject({ granted: 'gate', declared: true, consequence_tier: 'low', earned: 'autonomy', rung_from: 'grant' })
    expect(row.grant).toEqual({ decision_id: g.decision_id, seq: g.seq, entry_hash: g.entry_hash, signer_id: 'owner', signed_at: '2026-09-28T09:40:00Z', anchored: true })
    expect(o.asking).toHaveLength(1)
    expect(o.asking[0]).toMatchObject({ kind: 'PROMOTION_PROPOSAL', from: 'gate', to: 'autonomy', rung_from: 'grant', verified: true })
    expect(o.asking[0]!.opinion_command).toBe(FROM_BOOK(WF()))
    // the same proposal the book-read assessment raises
    expect(o.asking[0]!.proposal_id).toBe(assessVoiceFromLedger(ledger, WF(), P).proposal!.proposal_id)
    // 2026-09-28: the grants block lists the decisions that have no effect (none on this anchored book).
    expect(o.grants).toEqual({ verified: true, unanchored_signers: [], no_effect: [], overridden: [] })

    const md = renderTenantReport(ledger, bookOpts(ledger))
    expect(md).toContain('| `acme/invoice@0.0.1` | gate | low | 190 | autonomy |')
    expect(md).toContain(`- \`acme/invoice@0.0.1\`: the rung is read from the book of record, GRANT \`${g.decision_id.slice(0, 12)}…\` (seq ${g.seq}) signed by owner at 2026-09-28T09:40:00Z.`)
    expect(md).toContain(`Read the opinion, then sign (\`verify grant … --level autonomy --answers ${o.asking[0]!.proposal_id}\`) or decline (\`verify decline … --assessment <verify voice --from-book output>\`; declining costs nothing): \`${FROM_BOOK(WF())}\``)
    // a tenant report names the tenant in the command (the opinion is read under the tenant's scope)
    expect(tenantOpinions(ledger, { ...bookOpts(ledger), tenant_id: 'acme' }).asking[0]!.opinion_command).toBe(FROM_BOOK(WF(), ' --tenant acme'))
    // the same anchors passed explicitly read the same book
    const explicit = tenantOpinions(ledger, bookOpts(ledger, { trusted_keys: ANCHORS }))
    expect(explicit.workflows[0]!.grant!.anchored).toBe(true)
    expect(explicit.grants!.unanchored_signers).toEqual([])
  })

  it('D-ANCHOR: an unanchored GRANT is on the book and has no effect on the rung the report reads', () => {
    const ledger = looseStrong()
    grant(ledger, 'autonomy')
    const o = tenantOpinions(ledger, bookOpts(ledger))
    expect(o.workflows.find(w => w.workflow_id === WF())).toMatchObject({ granted: 'record', rung_from: 'none' })
    expect(o.workflows.find(w => w.workflow_id === WF())!.grant).toBeUndefined()
    expect(o.grants).toMatchObject({ verified: true, unanchored_signers: ['owner'] })
    expect(renderTenantReport(ledger, bookOpts(ledger))).not.toMatch(/\| `acme\/invoice@0\.0\.1` \| autonomy \|/)
  })

  it('a granted workflow with no verdicts yet is listed, at the rung a person granted', () => {
    const ledger = strong()
    grant(ledger, 'advise', { wf: 'acme/payments@1' })
    const o = tenantOpinions(ledger, bookOpts(ledger))
    expect(o.workflows.map(w => [w.workflow_id, w.granted, w.records, w.rung_from])).toEqual([
      ['acme/invoice@0.0.1', 'record', 190, 'none'],
      ['acme/payments@1', 'advise', 0, 'grant'],
    ])
    // declared: false for the ungranted, undeclared workflow (nothing to weigh it against), true for the granted one
    expect(o.workflows.map(w => w.declared)).toEqual([false, true])
  })

  it('no GRANT on the book: the same data as the declarations path; a record-level declaration is read on the book', () => {
    const ledger = strong()
    const decls = [{ workflow_id: WF(), consequence_tier: 'low', granted: 'gate' as VoiceLevel, bounds: 'PO-matched' }, { workflow_id: 'acme/other@1', consequence_tier: 'low', granted: 'record' as VoiceLevel }]
    const flag = tenantOpinions(ledger, { period: SEPT, voice: { policy: P, declarations: decls } })
    const book = tenantOpinions(ledger, bookOpts(ledger, { declarations: decls }))
    // BOOK FIRST, always (the report reads its own ledger when no `voice.book` is given): the two reads are the same book
    expect(book.workflows).toEqual(flag.workflows)
    expect(book.asking).toEqual(flag.asking) // the gate declaration (bounds) takes the flag path, unchanged
    expect(book.workflows.map(w => [w.workflow_id, w.rung_from])).toEqual([[WF(), 'declaration'], ['acme/other@1', 'none']])
    expect(book.notices).toEqual(flag.notices)

    // a declaration at record with no bounds is measured ON the book, so a person's record-level decline holds it back
    const bare = strong()
    const recordDecl = [{ workflow_id: WF(), consequence_tier: 'low', granted: 'record' as VoiceLevel }]
    const before = tenantOpinions(bare, bookOpts(bare, { declarations: recordDecl }))
    expect(before.asking[0]).toMatchObject({ kind: 'PROMOTION_PROPOSAL', from: 'record', to: 'advise', rung_from: 'none' })
    expect(before.asking[0]!.opinion_command).toBe(FROM_BOOK(WF(), ' --tier low'))
    const flagRecord = tenantOpinions(bare, { period: SEPT, voice: { policy: P, declarations: recordDecl } })
    expect(before.asking[0]!.proposal_id).toBe(flagRecord.asking[0]!.proposal_id)
    decline(bare, WF(), 'low')
    const after = tenantOpinions(bare, bookOpts(bare, { declarations: recordDecl }))
    expect(after.asking).toEqual([])
    expect(after.declined.map(d => [d.workflow_id, d.kind, d.from, d.to])).toEqual([[WF(), 'PROMOTION_PROPOSAL', 'record', 'advise']])
    // the report's own ledger is the book by default, so the decline binds there too (it used to be asked again)
    expect(tenantOpinions(bare, { period: SEPT, voice: { policy: P, declarations: recordDecl } }).asking).toEqual([])
  })

  it('a declaration never overrides a GRANT: the grant governs, and the report says so', () => {
    const ledger = strong()
    const g = grant(ledger, 'gate')
    const decls = [{ workflow_id: WF(), consequence_tier: 'low', granted: 'advise' as VoiceLevel }]
    const o = tenantOpinions(ledger, bookOpts(ledger, { declarations: decls }))
    expect(o.workflows[0]).toMatchObject({ granted: 'gate', rung_from: 'grant' })
    expect(o.grants!.overridden).toEqual([{ workflow_id: WF(), declared: { granted: 'advise', consequence_tier: 'low' }, grant: { decision_id: g.decision_id, level: 'gate', consequence_tier: 'low' } }])
    const md = renderTenantReport(ledger, bookOpts(ledger, { declarations: decls }))
    expect(md).toContain(`- ◇ \`acme/invoice@0.0.1\`: a declaration says \`advise\` at tier 'low'; the GRANT in force (\`${g.decision_id.slice(0, 12)}…\`) says \`gate\` at tier 'low'. The book governs: a declaration never overrides a person's signed grant.`)
    // the same list the CLI prints on stderr, comparing only what a declaration states
    expect(declarationsOverridden(ledger.decisionBook().decisions, [{ workflow_id: WF(), consequence_tier: 'low' }])).toEqual([])
    expect(declarationsOverridden(ledger.decisionBook().decisions, [{ workflow_id: WF(), granted: 'autonomy' }])[0]!.declared).toEqual({ granted: 'autonomy' })
    expect(declarationsOverridden(ledger.decisionBook().decisions, [{ workflow_id: 'acme/none@1', granted: 'autonomy' }])).toEqual([])
  })

  it('a chain export is the same book as the Ledger', () => {
    const ledger = strong()
    grant(ledger, 'gate')
    const chain = parseChainJSONL(ledger.chainJSONL())
    // a chain export carries no anchors of its own: the owner's key is passed with it, as the Ledger carries its own
    expect(JSON.stringify(tenantOpinions(ledger, bookOpts(ledger)))).toBe(JSON.stringify(tenantOpinions(ledger, bookOpts(ledger, { book: chain, trusted_keys: ANCHORS }))))
    expect(() => readVoiceBook({ events: 5 } as never)).toThrow(/book must be a Ledger or a chain export/)
  })

  it('tenant-scoped: another tenant\'s grants are not listed', () => {
    const ledger = strong()
    buildLedger({ ledger, tenant: 'beta', passes: 10, fails: 5, failOverturned: 1 })
    grant(ledger, 'gate', { wf: WF('beta') })
    grant(ledger, 'advise', { wf: 'beta/new@1' })
    const acme = tenantOpinions(ledger, { ...bookOpts(ledger), tenant_id: 'acme' })
    expect(acme.workflows.map(w => w.workflow_id)).toEqual([WF()])
    expect(renderTenantReport(ledger, { ...bookOpts(ledger), tenant_id: 'acme' })).not.toContain('beta/')
    const beta = tenantOpinions(ledger, { ...bookOpts(ledger), tenant_id: 'beta' })
    expect(beta.workflows.map(w => [w.workflow_id, w.granted])).toEqual([[WF('beta'), 'gate'], ['beta/new@1', 'advise']])
  })

  it('deterministic: byte-identical renders of the same book', () => {
    const ledger = misses()
    grant(ledger, 'autonomy')
    decline(ledger)
    expect(renderTenantReport(ledger, bookOpts(ledger))).toBe(renderTenantReport(ledger, bookOpts(ledger)))
  })
})

describe('a person\'s decline, said in words', () => {
  it('the keep-it loop: URGENT demotion → declined (said, not asked) → a new miss → asked again, naming the lapsed decline', () => {
    const ledger = misses()
    grant(ledger, 'autonomy')
    const asked = tenantOpinions(ledger, bookOpts(ledger))
    expect(asked.asking.map(p => [p.kind, p.urgent, p.from, p.to])).toEqual([['DEMOTION_PROPOSAL', true, 'autonomy', 'gate']])
    expect(renderTenantReport(ledger, bookOpts(ledger))).toContain('keep the rung (`verify decline … --assessment <verify voice --from-book output>`) or step it down (`verify grant … --level gate`)')

    const { entry, assessment } = decline(ledger)
    const o = tenantOpinions(ledger, bookOpts(ledger))
    expect(o.asking).toEqual([])
    expect(o.declined).toHaveLength(1)
    const d = o.declined[0]!
    expect(d).toMatchObject({ workflow_id: WF(), kind: 'DEMOTION_PROPOSAL', consequence_tier: 'low', from: 'autonomy', to: 'gate' })
    expect(d.decline).toMatchObject({ decision_id: entry.decision_id, seq: entry.seq, signer_id: 'owner', signed_at: '2026-09-28T09:50:00Z', reason: 'the six misses were one vendor, since fixed', suppressed_proposal_id: assessment.proposal!.proposal_id })
    const md = renderTenantReport(ledger, bookOpts(ledger))
    expect(md).toMatch(/### Asking for \(0\)\n\nRiposte is asking for nothing: no change the record supports is open: the one it supports was declined by a person \(below\), standing until the evidence changes\./)
    // D-DECLINED-COPY: "Kept at <rung> by <person>, <date>; stands until …", apart from the asks
    expect(md).toContain('### Declined, standing until the evidence changes (1)')
    expect(md).toMatch(/\n1\. `acme\/invoice@0\.0\.1`: \*\*Kept at `autonomy` by owner, 2026-09-28T09:50:00Z\*\*; stands until a new failing case[^\n]+\n/)
    expect(md).toContain(`   - The step down to \`gate\` was declined · tier 'low' · their reason: "the six misses were one vendor, since fixed" (DECLINE \`${entry.decision_id.slice(0, 12)}…\`, seq ${entry.seq}; it holds back proposal \`${assessment.proposal!.proposal_id.slice(0, 12)}…\`).`)
    expect(md).toContain('   - It stands: no new failing case or blocker since owner declined it at 2026-09-28T09:50:00Z (6 failing case(s) seen).')
    expect(d).toMatchObject({ disposition: 'DECLINED', verified: true, opinion_command: FROM_BOOK(WF()) })
    expect(md).toContain(`   - Opinion \`${d.opinion_id.slice(0, 12)}…\` (DECLINED, premises ✓): \`${FROM_BOOK(WF())}\``)
    expect(md.indexOf('### Asking for (0)')).toBeLessThan(md.indexOf('### Declined, standing until the evidence changes (1)'))

    newMiss(ledger)
    const again = tenantOpinions(ledger, bookOpts(ledger))
    expect(again.declined).toEqual([])
    expect(again.asking).toHaveLength(1)
    expect(again.asking[0]!.decline_lapsed).toMatchObject({ decision_id: entry.decision_id, signer_id: 'owner', why: expect.stringMatching(/1 new failing case/) })
    const md2 = renderTenantReport(ledger, bookOpts(ledger))
    expect(md2).toMatch(/\*\*URGENT · step down\*\* `acme\/invoice@0\.0\.1`: `autonomy` → `gate`/)
    expect(md2).toMatch(/   - Asked again: owner declined this at 2026-09-28T09:50:00Z \("the six misses were one vendor, since fixed"; decision `[0-9a-f]{12}…`\), and that decline no longer stands: the evidence against the grant changed since the decline: 1 new failing case\(s\) \([0-9a-f]+\)\./)
    expect(md2).not.toContain('### Declined')
  })

  it('a declined promotion is said with what would re-raise it: a fresh sample of the rung\'s own min_n', () => {
    const ledger = strong()
    grant(ledger, 'gate')
    decline(ledger)
    const o = tenantOpinions(ledger, bookOpts(ledger))
    expect(o.declined.map(d => [d.kind, d.from, d.to])).toEqual([['PROMOTION_PROPOSAL', 'gate', 'autonomy']])
    const md = renderTenantReport(ledger, bookOpts(ledger))
    // D-DECLINED-COPY: "Not now: <person>, <date>; re-raises when …"
    expect(md).toContain('1. `acme/invoice@0.0.1`: **Not now: owner, 2026-09-28T09:50:00Z**; re-raises when 100 more reviewed PASS verdict(s): a fresh sample of autonomy\'s own min_n (100) since the decline')
    expect(md).toContain('   - The promotion `gate` → `autonomy` was declined · tier \'low\' · their reason:')
    expect(md).not.toMatch(/\*\*Promotion\*\* `acme\/invoice/)
  })
})

describe('a book that does not verify grants nothing', () => {
  it('under trusted keys that do not anchor its signer: no rung is read, nothing is proposed, notices are listed as unread', () => {
    const ledger = looseMisses()
    ledger.record(verify({ ...broken, invoice_number: 'open-fail' }, { now: FIXED_NOW, ruleset: INVOICE_RULESET_V0_0_1 }), { tenant_id: 'acme' }) // awaiting a person
    grant(ledger, 'autonomy', { key: AGENT.privateKeyPem, signer: 'agent-7' })
    const trusted: TrustedKeys = { owner: OWNER.publicKeyPem }
    const o = tenantOpinions(ledger, bookOpts(ledger, { trusted_keys: trusted }))
    expect(o.grants).toMatchObject({ verified: false, reason: expect.stringMatching(/does not verify at event \d+ .*signer 'agent-7' has no anchored key.*grants nothing/) })
    expect(o.book.content_verified).toBe(false)
    expect(o.workflows).toHaveLength(1)
    expect(o.workflows[0]).toMatchObject({ workflow_id: WF(), granted: 'record', declared: false, rung_from: 'unread' })
    expect(o.asking).toEqual([])
    expect(o.notices).toEqual([])
    expect(o.notices_unread!.map(w => w.workflow_id)).toEqual([WF()])
    const md = renderTenantReport(ledger, bookOpts(ledger, { trusted_keys: trusted }))
    expect(md).toContain('| `acme/invoice@0.0.1` | ⚠ unread (the book did not verify) | — | 191 | ⚠ not weighed |')
    expect(md).toMatch(/⚠ Withheld: the book of record did not verify/)
    expect(md).toContain('#### rung unread: the book of record did not verify, so whether each is held cannot be read from it')
    expect(md).toMatch(/✗ FAIL `[0-9a-f]{16}…` · [^·]+ · rung unread · /)
    // a declaration does not stand in for a grant the book may hold
    const withDecl = tenantOpinions(ledger, bookOpts(ledger, { trusted_keys: trusted, declarations: [{ workflow_id: WF(), consequence_tier: 'low', granted: 'gate' }] }))
    expect(withDecl.workflows[0]).toMatchObject({ granted: 'record', rung_from: 'unread', declared: false })
    // readRung says the same
    expect(readRung(ledger.decisionBook({ trusted_keys: trusted }), ledger, WF(), undefined)).toMatchObject({ from: 'unread', granted: 'record', problem: expect.stringMatching(/grants nothing/) })
  })
})

// ── the voice surface reads the book ─────────────────────────────────────────────────────────────────────────────────

describe('voiceSurface / voice_assess read the book', () => {
  const tool = (args: unknown) => handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'voice_assess', arguments: args } } as JsonRpcRequest)!.result as { isError: boolean; structuredContent?: Record<string, any>; content: { text: string }[] }

  it('the GRANT in force sets the level; the assessment is assessVoiceFromLedger\'s, citing it', () => {
    const ledger = strong()
    const g = grant(ledger, 'gate')
    const view = openSnapshot(snapshotOfLedger(ledger))
    const s = voiceSurface(view, WF(), { book: ledger }, P)
    expect(s).toMatchObject({ level: 'gate', granted: 'gate', declared: true, earned: 'autonomy', verified: true })
    expect(s.assessment).toEqual(assessVoiceFromLedger(ledger, WF(), P))
    expect(s.assessment!.book!.grant).toEqual({ decision_id: g.decision_id, seq: g.seq, entry_hash: g.entry_hash })
    expect(s.open_proposal).toMatchObject({ kind: 'PROMOTION_PROPOSAL', from: 'gate', to: 'autonomy' })
    // no policy: the level is still the grant's, and nothing is weighed
    expect(voiceSurface(view, WF(), { book: ledger }, undefined)).toMatchObject({ level: 'gate', declared: true, earned: null, open_proposal: null, note: expect.stringMatching(/No promotion policy/) })
  })

  it('nothing granted: record; weighed only when a tier is declared, and then equal to the flag path at record', () => {
    const ledger = strong()
    const view = openSnapshot(snapshotOfLedger(ledger))
    const u = voiceSurface(view, WF(), { book: ledger }, P)
    expect(u).toMatchObject({ level: 'record', declared: false, earned: null, open_proposal: null, assessment: null })
    expect(u.note).toMatch(/no signed GRANT.*day-1 default/)
    const t = voiceSurface(view, WF(), { book: ledger, consequence_tier: 'low' }, P)
    const flag = voiceSurface(view, WF(), { consequence_tier: 'low', granted: 'record' }, P)
    expect(t.open_proposal).toEqual(flag.open_proposal)
    expect(t.assessment!.book).toEqual({ head: ledger.chainHead(), length: ledger.events().length })
  })

  it('a book that does not verify is refused, never read as record', () => {
    const ledger = looseStrong()
    grant(ledger, 'gate', { key: AGENT.privateKeyPem, signer: 'agent-7' })
    const view = openSnapshot(snapshotOfLedger(ledger))
    expect(() => voiceSurface(view, WF(), { book: ledger, trusted_keys: { owner: OWNER.publicKeyPem } }, P)).toThrow(/does not verify.*grants nothing/)
  })

  it('MCP voice_assess with from_book equals the book-path surface; flags are refused; trusted_keys anchor', () => {
    const ledger = strong()
    grant(ledger, 'gate')
    const chain = ledger.chainJSONL()
    // a chain export carries no anchors: the owner's key is passed, as the Ledger carries its own
    const r = tool({ ledger: chain, policy: P, workflow_id: WF(), from_book: true, trusted_keys: ANCHORS })
    expect(r.isError).toBe(false)
    const direct = voiceSurface(openSnapshot(snapshotOfLedger(ledger)), WF(), { book: ledger }, P)
    expect(r.structuredContent).toEqual(JSON.parse(JSON.stringify(direct)))
    expect(r.structuredContent).toMatchObject({ level: 'gate', granted: 'gate' })
    // without the anchor the grant has no effect (D-ANCHOR): the rung is record
    expect(tool({ ledger: chain, policy: P, workflow_id: WF(), from_book: true, consequence_tier: 'low' }).structuredContent).toMatchObject({ level: 'record' })
    expect(voiceFromJson({ ledger: chain, policy: P, workflow_id: WF(), from_book: true, trusted_keys: { owner: OWNER.publicKeyPem } }).assessment!.book!.unanchored_signers).toBeUndefined()
    const refused: [Record<string, unknown>, RegExp][] = [
      [{ granted: 'autonomy' }, /"granted" cannot be passed with it/],
      [{ bounds: 'all', grant: {} }, /"grant", "bounds" cannot be passed/],
      [{ consequence_tier: 'high', trusted_keys: ANCHORS }, /made at consequence tier 'low', not 'high'/],
      [{ trusted_keys: { owner: 5 } }, /trusted_keys\.owner/],
      [{ trusted_keys: 'x' }, /"trusted_keys" must be/],
      [{ trusted_keys: { owner: AGENT.publicKeyPem } }, /does not verify/],
      [{ workflow_id: undefined }, /workflow_id/],
    ]
    for (const [extra, why] of refused) {
      const e = tool({ ledger: chain, policy: P, workflow_id: WF(), from_book: true, ...extra })
      expect(e.isError, JSON.stringify(extra)).toBe(true)
      expect(e.content[0]!.text).toMatch(why)
    }
    const nb = tool({ ledger: chain, policy: P, workflow_id: WF(), from_book: 'yes' })
    expect(nb.isError).toBe(true)
    expect(nb.content[0]!.text).toMatch(/"from_book" must be true or false/)
    // without from_book, the flag path is unchanged, even on a book that holds a grant
    expect(tool({ ledger: chain, policy: P, workflow_id: WF(), consequence_tier: 'low', granted: 'advise' }).structuredContent).toMatchObject({ level: 'advise' })
  })
})

// ── the managed tier reads its own ledger ────────────────────────────────────────────────────────────────────────────

describe('managed tier: the GRANTs on the tier\'s ledger govern', () => {
  const get = (svc: ReturnType<typeof createService>, path: string) => svc.handle({ method: 'GET', path, headers: { 'x-api-key': 'ka' } })
  const post = (svc: ReturnType<typeof createService>, path: string, body: unknown) => svc.handle({ method: 'POST', path, body, headers: { 'x-api-key': 'ka' } })
  const declaredAdvise: VoiceConfig = { policy: P, settings: () => ({ consequence_tier: 'low', granted: 'advise' }) }

  it('GET /v1/voice: the GRANT, not the declared settings; a workflow with no GRANT keeps its declaration', () => {
    const ledger = strong()
    const svc = createService({ ledger, voice: declaredAdvise, authenticate: apiKeyAuth({ ka: 'acme' }) })
    expect(get(svc, `/v1/voice/${encodeURIComponent(WF())}`).json).toMatchObject({ level: 'advise', declared: true })
    const g = grant(ledger, 'gate')
    const r = get(svc, `/v1/voice/${encodeURIComponent(WF())}`)
    expect(r.status).toBe(200)
    expect(r.json).toMatchObject({ tenant_id: 'acme', level: 'gate', granted: 'gate', declared: true, earned: 'autonomy' })
    expect((r.json as { assessment: { book: { grant: { decision_id: string } } } }).assessment.book.grant.decision_id).toBe(g.decision_id)
  })

  it('POST /v1/opinion: the settings on record are the GRANT; restating it is fine, changing it is 409', () => {
    const ledger = strong()
    const svc = createService({ ledger, voice: declaredAdvise, authenticate: apiKeyAuth({ ka: 'acme' }) })
    grant(ledger, 'gate')
    const ok = post(svc, '/v1/opinion', { workflow_id: WF() })
    expect(ok.status).toBe(200)
    const op = (ok.json as { opinion: { verified: boolean; ruling: { disposition: string } } }).opinion
    expect(op.verified).toBe(true)
    expect(op.ruling.disposition).toBe('PROPOSE_PROMOTION')
    expect(post(svc, '/v1/opinion', { workflow_id: WF(), granted: 'gate', consequence_tier: 'low' }).status).toBe(200)
    const changed = post(svc, '/v1/opinion', { workflow_id: WF(), granted: 'advise' })
    expect(changed.status).toBe(409)
    expect((changed.json as { error: string }).error).toMatch(/rung gate/)
  })

  it('GET /v1/ledger/report cites the GRANT and says a decline; a book that does not verify is 409 on /v1/voice', () => {
    const ledger = misses()
    const svc = createService({ ledger, voice: { policy: P }, authenticate: apiKeyAuth({ ka: 'acme' }), now: () => new Date('2026-09-15T12:00:00Z') })
    grant(ledger, 'autonomy')
    decline(ledger)
    const md = (get(svc, '/v1/ledger/report').json as { markdown: string }).markdown
    expect(md).toContain('| `acme/invoice@0.0.1` | autonomy | low | 190 | gate |')
    expect(md).toContain('### Declined, standing until the evidence changes (1)')
    expect(md).toContain('**Kept at `autonomy` by owner, 2026-09-28T09:50:00Z**; stands until')

    // the report is served with no voice config at all: the book still sets the rung shown
    const bare = createService({ ledger, authenticate: apiKeyAuth({ ka: 'acme' }) })
    expect((get(bare, '/v1/ledger/report').json as { markdown: string }).markdown).toContain('| `acme/invoice@0.0.1` | autonomy | low | 190 | — |')

    const anchored = new MemoryLedger({ seed: parseChainJSONL(ledger.chainJSONL()), trusted_keys: { someone: AGENT.publicKeyPem } })
    const svc2 = createService({ ledger: anchored, voice: { policy: P }, authenticate: apiKeyAuth({ ka: 'acme' }) })
    const r = get(svc2, `/v1/voice/${encodeURIComponent(WF())}`)
    expect(r.status).toBe(409)
    expect((r.json as { error: string }).error).toMatch(/does not verify.*grants nothing/)
  })

  it('a ledger with no grants: the report is byte-identical to the declarations-only report', () => {
    const ledger = strong()
    const settings = (_t: string, wf: string) => (wf === WF() ? { consequence_tier: 'low', granted: 'gate' as VoiceLevel, bounds: 'PO-matched' } : undefined)
    const viaBook = renderTenantReport(ledger, { tenant_id: 'acme', period: SEPT, voice: { policy: P, book: ledger, declarations: wf => settings('acme', wf) } })
    const viaDecl = renderTenantReport(ledger, { tenant_id: 'acme', period: SEPT, voice: { policy: P, declarations: wf => settings('acme', wf) } })
    expect(viaBook).toBe(viaDecl)
    // and an assessment through the report equals a direct one
    const a = assessVoice(workflowCalibration(ledger.all(), WF()), { workflow_id: WF(), consequence_tier: 'low', granted: 'gate', bounds: 'PO-matched' }, P)
    expect(tenantOpinions(ledger, { voice: { policy: P, book: ledger, declarations: wf => settings('acme', wf) } }).asking[0]!.proposal_id).toBe(a.proposal!.proposal_id)
  })
})
