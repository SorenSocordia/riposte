/**
 * The CLI, book first (2026-09-28), end to end through run(argv, io) on real temp files:
 *   - `verify revise-policy --from <prior.json> --draft <next.json> --reason …` builds the revision itself (revisePolicy),
 *     so a person never hand-builds the revised body; `--out` writes it (never over a file); the --revised form is unchanged;
 *   - `verify report` reads the book directly (no CLI adapter): it cites the GRANT, points a book-read rung at
 *     `verify opinion --from-book`, and says a person's decline in words (D-DECLINED-COPY).
 * Each refusal exits 1 with the book byte-identical; usage errors exit 3.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFileSync, readFileSync, rmSync, mkdtempSync } from 'node:fs'
import { createPrivateKey, createPublicKey } from 'node:crypto'
import { run, type CliIO } from '../src/cli'
import { revisePolicy, policyRef, parseChainJSONL, readDecisionBook, EXAMPLE_PROMOTION_POLICY, type PromotionPolicy } from '../src/index'
import { buildLedger, WF } from './fixtures/voice-ledger'

function keyFromSeed(seedHex: string): { privateKeyPem: string; publicKeyPem: string } {
  const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(seedHex, 'hex')])
  const k = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' })
  return { privateKeyPem: k.export({ type: 'pkcs8', format: 'pem' }).toString(), publicKeyPem: createPublicKey(k).export({ type: 'spki', format: 'pem' }).toString() }
}
const OWNER = keyFromSeed('11'.repeat(32))
const P = EXAMPLE_PROMOTION_POLICY
const BASE = buildLedger({ passes: 130, fails: 60, failOverturned: 2 })
const MISSES = buildLedger({ passes: 130, fails: 60, passOverturned: 6, failOverturned: 2, prefix: 'miss' })

const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
const put = (dir: string, name: string, content: unknown): string => {
  const p = join(dir, name)
  writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content))
  return p
}
const cap = (): CliIO & { out_: () => string; err_: () => string } => {
  let o = '', e = ''
  return { out: s => { o += s }, err: s => { e += s }, out_: () => o, err_: () => e }
}
function book(chainText = BASE.ledger.chainJSONL()) {
  const dir = mkdtempSync(join(tmpdir(), 'verify-cli-book-first-'))
  dirs.push(dir)
  return { dir, chain: put(dir, 'chain.jsonl', chainText), policy: put(dir, 'policy.json', P), owner: put(dir, 'owner.pem', OWNER.privateKeyPem), trusted: put(dir, 'trusted.json', { owner: OWNER.publicKeyPem }) }
}
const ok = (argv: string[]): Record<string, any> => {
  const io = cap()
  const code = run(argv, io)
  if (code !== 0) throw new Error(`expected exit 0 from ${argv[0]}, got ${code}: ${io.err_()}`)
  return JSON.parse(io.out_())
}
/** The version after the example policy's (the example's version moves when its body does, so these tests follow it). */
const NEXT = ((v: string): string => { const [maj, min] = v.split('.').map(Number); return `${maj}.${(min as number) + 1}.0` })(P.version)
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const NEXT_TIERS = P.tiers.map(t => (t.tier === 'low' ? { ...t, autonomy: { min_n: 150, max_error: 0.03 } } : t))
const REASON = 'month-end volume: autonomy needs a larger sample'
const draftArgs = (b: ReturnType<typeof book>, draft: string, extra: string[] = []): string[] => [
  'revise-policy', '--ledger', b.chain, '--key', b.owner, '--signer', 'owner', '--from', b.policy, '--draft', draft, '--reason', REASON,
  ...(extra.includes('--signed-at') ? [] : ['--signed-at', '2026-09-28T10:00:00Z']), ...extra,
]

describe('verify revise-policy --from --draft --reason', () => {
  it('Riposte builds the revision: the same body revisePolicy builds, signed by the reviser, chained to the prior\'s hash', () => {
    const b = book()
    const draft = put(b.dir, 'next.json', { version: NEXT, tiers: NEXT_TIERS })
    const before = readFileSync(b.chain, 'utf8')
    const res = ok(draftArgs(b, draft))
    const expected = revisePolicy(P, { version: NEXT, tiers: NEXT_TIERS }, { revised_by: 'owner', revised_at: '2026-09-28T10:00:00Z', reason: REASON })
    expect(res.appended.signed.decision).toMatchObject({
      kind: 'POLICY_REVISION', policy: policyRef(expected), supersedes: policyRef(P), reason: REASON, changes: ['low.autonomy: min_n 100 → 150'],
      signer_id: 'owner', signed_at: '2026-09-28T10:00:00Z',
    })
    expect(res.appended.signed.decision.policy_body).toEqual(expected)
    const after = readFileSync(b.chain, 'utf8')
    expect(after.startsWith(before)).toBe(true)
    const { events, payloads } = parseChainJSONL(after)
    expect(readDecisionBook(events, payloads).ok).toBe(true)
    // the grant made under 0.1.0 stands under it, and the book names the version superseding it
    ok(['grant', '--ledger', b.chain, '--key', b.owner, '--signer', 'owner', '--trusted-keys', b.trusted, '--workflow', WF(), '--level', 'gate', '--tier', 'low', '--policy', b.policy, '--signed-at', '2026-09-28T10:01:00Z'])
    const a = ok(['voice', '--from-book', '--ledger', b.chain, '--policy', b.policy, '--workflow', WF(), '--trusted-keys', b.trusted]).assessment
    expect(a.book.superseded_by).toEqual([{ policy: policyRef(expected), decision_id: res.appended.decision_id, seq: res.appended.seq, lints: true }])
  })

  it('--out writes the revised policy (the body on the book), and never over a file', () => {
    const b = book()
    const draft = put(b.dir, 'next.json', { ...P, version: NEXT, tiers: NEXT_TIERS, revision: { stale: true } }) // a full policy file; its revision is replaced
    const out = join(b.dir, 'policy-0.2.0.json')
    const io = cap()
    expect(run(draftArgs(b, draft, ['--out', out]), io)).toBe(0)
    const written = JSON.parse(readFileSync(out, 'utf8')) as PromotionPolicy
    expect(written).toEqual(JSON.parse(io.out_()).appended.signed.decision.policy_body)
    expect(written.revision).toMatchObject({ revised_by: 'owner', reason: REASON, supersedes: policyRef(P) })
    expect(io.err_()).toMatch(new RegExp(`wrote the revised policy example-illustrative@${esc(NEXT)} to `))
    // the written file is the --policy for a grant under the new version
    ok(['grant', '--ledger', b.chain, '--key', b.owner, '--signer', 'owner', '--trusted-keys', b.trusted, '--workflow', WF(), '--level', 'gate', '--tier', 'low', '--policy', out])

    const b2 = book()
    const taken = put(b2.dir, 'taken.json', 'mine')
    const before = readFileSync(b2.chain, 'utf8')
    const io2 = cap()
    expect(run(draftArgs(b2, put(b2.dir, 'next.json', { version: NEXT, tiers: NEXT_TIERS }), ['--out', taken]), io2)).toBe(1)
    expect(io2.err_()).toMatch(/REFUSED: .*taken\.json already exists/)
    expect(readFileSync(taken, 'utf8')).toBe('mine')
    expect(readFileSync(b2.chain, 'utf8')).toBe(before)
  })

  it('refusals exit 1 and append nothing', () => {
    const b = book()
    const before = readFileSync(b.chain, 'utf8')
    const cases: [string[], RegExp][] = [
      [draftArgs(b, put(b.dir, 'same.json', { version: NEXT })), /REFUSED: a revision must change something/],
      [draftArgs(b, put(b.dir, 'sameversion.json', { version: P.version, tiers: NEXT_TIERS })), /REFUSED: a revision must carry a new version/],
      [draftArgs(b, put(b.dir, 'noversion.json', { tiers: NEXT_TIERS })), /REFUSED: a revision must carry a new version/],
      [draftArgs(b, put(b.dir, 'other.json', { policy_id: 'someone-else', version: NEXT, tiers: NEXT_TIERS })), /REFUSED: the draft is policy 'someone-else', not 'example-illustrative'/],
      [draftArgs(b, put(b.dir, 'lax.json', { version: NEXT, tiers: P.tiers.map(t => (t.tier === 'severe' ? { ...t, autonomy: { min_n: 10, max_error: 0.5 } } : t)) })), /REFUSED: the revised policy does not lint: .*burden decreases with consequence/],
      [draftArgs(b, put(b.dir, 'next.json', { version: NEXT, tiers: NEXT_TIERS })).map(t => (t === b.policy ? put(b.dir, 'badprior.json', { ...P, method: 'vibes' }) : t)), /REFUSED: the prior policy \(--from\) does not lint/],
      [draftArgs(b, put(b.dir, 'next2.json', { version: NEXT, tiers: NEXT_TIERS }), ['--signed-at', 'yesterday']), /REFUSED: signed_at must be an ISO-8601 timestamp/],
    ]
    for (const [argv, why] of cases) {
      const io = cap()
      expect(run(argv, io), String(why)).toBe(1)
      expect(io.err_()).toMatch(why)
      expect(readFileSync(b.chain, 'utf8')).toBe(before)
    }
    // the same version twice: the book refuses the second
    ok(draftArgs(b, put(b.dir, 'once.json', { version: NEXT, tiers: NEXT_TIERS })))
    const after = readFileSync(b.chain, 'utf8')
    const io = cap()
    expect(run(draftArgs(b, put(b.dir, 'twice.json', { version: NEXT, tiers: NEXT_TIERS }), ['--signed-at', '2026-09-28T10:05:00Z']), io)).toBe(1)
    expect(io.err_()).toMatch(new RegExp(`REFUSED: example-illustrative@${esc(NEXT)} is already on the book`))
    expect(readFileSync(b.chain, 'utf8')).toBe(after)
  })

  it('usage errors exit 3 and touch nothing; the --revised form is unchanged', () => {
    const b = book()
    const before = readFileSync(b.chain, 'utf8')
    const draft = put(b.dir, 'next.json', { version: NEXT, tiers: NEXT_TIERS })
    const usage: [string[], RegExp][] = [
      [['revise-policy', '--ledger', b.chain, '--key', b.owner, '--signer', 'owner', '--from', b.policy, '--draft', draft], /the draft form needs --reason/],
      [['revise-policy', '--ledger', b.chain, '--key', b.owner, '--signer', 'owner', '--draft', draft, '--reason', 'x'], /the draft form needs --from/],
      [['revise-policy', '--ledger', b.chain, '--key', b.owner, '--signer', 'owner', '--revised', draft, '--from', b.policy], /--from belongs to the draft form/],
      [['revise-policy', '--ledger', b.chain, '--key', b.owner, '--signer', 'owner', '--revised', draft, '--out', 'x.json', '--signed-at', 'now'], /--signed-at, --out belong to the draft form/],
      [draftArgs(b, put(b.dir, 'arr.json', [])), /--draft must be the next version/],
      [draftArgs(b, draft).map(t => (t === b.policy ? put(b.dir, 'arrprior.json', []) : t)), /--from must be the prior promotion policy/],
      [draftArgs(b, join(b.dir, 'missing.json')), /error reading input/],
      [['revise-policy', '--ledger', b.chain, '--key', b.owner, '--signer', 'owner'], /needs --revised <policy\.json> .* or --from <prior\.json> --draft <next\.json> --reason <text>/],
    ]
    for (const [argv, why] of usage) {
      const io = cap()
      expect(run(argv, io), String(why)).toBe(3)
      expect(io.err_()).toMatch(why)
    }
    expect(readFileSync(b.chain, 'utf8')).toBe(before)
    // the --revised form, as before
    const r = revisePolicy(P, { version: NEXT, tiers: NEXT_TIERS }, { revised_by: 'owner', revised_at: '2026-09-28T10:00:00Z', reason: REASON })
    expect(ok(['revise-policy', '--ledger', b.chain, '--key', b.owner, '--signer', 'owner', '--revised', put(b.dir, 'built.json', r)]).appended.signed.decision.policy).toEqual(policyRef(r))
  })
})

describe('D-UNEVIDENCED, the CLI side: exit 2 only for evidence of failure', () => {
  it('a day-1 grant above what the record supports: a standing notice (exit 0), said plainly in voice and in the report', () => {
    const b = book(buildLedger({ passes: 3, fails: 2 }).ledger.chainJSONL()) // far too few reviews for advise; nothing has failed
    ok(['grant', '--ledger', b.chain, '--key', b.owner, '--signer', 'owner', '--trusted-keys', b.trusted, '--workflow', WF(), '--level', 'advise', '--tier', 'low', '--policy', b.policy, '--signed-at', '2026-09-28T09:40:00Z'])
    const io = cap()
    expect(run(['voice', '--from-book', '--ledger', b.chain, '--policy', b.policy, '--workflow', WF(), '--trusted-keys', b.trusted], io)).toBe(0)
    const a = JSON.parse(io.out_()).assessment
    expect(a.proposal).toMatchObject({ kind: 'DEMOTION_PROPOSAL', basis: 'unevidenced', from: 'advise', to: 'record', failing_cases: [] })
    expect(a.level).toBe('advise')
    // the flag path reads the same basis
    expect(run(['voice', '--ledger', b.chain, '--policy', b.policy, '--workflow', WF(), '--tier', 'low', '--granted', 'advise'], cap())).toBe(0)
    // the surface says it plainly, and exits 0
    const s = cap()
    expect(run(['voice', '--from-book', '--surface', '--ledger', b.chain, '--policy', b.policy, '--workflow', WF(), '--trusted-keys', b.trusted], s)).toBe(0)
    expect(JSON.parse(s.out_()).note).toMatch(/^A standing notice, not an alarm: a person granted `advise` above what the book of record supports, and nothing has gone wrong/)
    // the report: not URGENT
    const r = cap()
    expect(run(['report', '--ledger', b.chain, '--policy', b.policy, '--trusted-keys', b.trusted], r)).toBe(0)
    expect(r.out_()).toContain('1. **Granted above the evidence** `acme/invoice@0.0.1` at `advise`: the record does not yet support it, and nothing has gone wrong (a standing notice, not an alarm; the rung stays as a person set it)')
    expect(r.out_()).toContain('   - Nothing to decide unless a person wants to: let the record catch up, or step the rung down (`verify grant … --level record`).')
    expect(r.out_()).not.toContain('URGENT')
  })

  it('evidence of failure stays URGENT: exit 2 on both voice paths and the surface', () => {
    const b = book(MISSES.ledger.chainJSONL())
    ok(['grant', '--ledger', b.chain, '--key', b.owner, '--signer', 'owner', '--trusted-keys', b.trusted, '--workflow', WF(), '--level', 'autonomy', '--tier', 'low', '--policy', b.policy, '--bounds', 'all', '--signed-at', '2026-09-28T09:40:00Z'])
    const io = cap()
    expect(run(['voice', '--from-book', '--ledger', b.chain, '--policy', b.policy, '--workflow', WF(), '--trusted-keys', b.trusted], io)).toBe(2)
    expect(JSON.parse(io.out_()).assessment.proposal).toMatchObject({ kind: 'DEMOTION_PROPOSAL', basis: 'failure', urgent: true })
    expect(run(['voice', '--from-book', '--surface', '--ledger', b.chain, '--policy', b.policy, '--workflow', WF(), '--trusted-keys', b.trusted], cap())).toBe(2)
    expect(run(['voice', '--ledger', b.chain, '--policy', b.policy, '--workflow', WF(), '--tier', 'low', '--granted', 'autonomy', '--bounds', 'all'], cap())).toBe(2)
  })
})

describe('verify report reads the book directly', () => {
  it('cites the GRANT, points the ask at verify opinion --from-book, and says the decline in words', () => {
    const b = book(MISSES.ledger.chainJSONL())
    const g = ok(['grant', '--ledger', b.chain, '--key', b.owner, '--signer', 'owner', '--trusted-keys', b.trusted, '--workflow', WF(), '--level', 'autonomy', '--tier', 'low', '--policy', b.policy, '--bounds', 'PO-matched invoices under $5,000', '--signed-at', '2026-09-28T09:40:00Z']).appended
    const io = cap()
    expect(run(['report', '--ledger', b.chain, '--policy', b.policy, '--trusted-keys', b.trusted], io)).toBe(0)
    const md = io.out_()
    expect(md).toContain(`- \`acme/invoice@0.0.1\`: the rung is read from the book of record, GRANT \`${g.decision_id.slice(0, 12)}…\` (seq ${g.seq}) signed by owner at 2026-09-28T09:40:00Z.`)
    expect(md).toContain('keep the rung (`verify decline … --assessment <verify voice --from-book output>`) or step it down (`verify grant … --level gate`); the decision is a person\'s: `verify opinion --from-book --ledger <chain.jsonl> --policy <policy.json> --workflow acme/invoice@0.0.1`')
    expect(md).not.toContain('--granted autonomy')

    // the person reads it from the book, as the report says, and declines
    const v = cap()
    expect(run(['voice', '--from-book', '--ledger', b.chain, '--policy', b.policy, '--workflow', WF(), '--trusted-keys', b.trusted], v)).toBe(2)
    ok(['decline', '--ledger', b.chain, '--key', b.owner, '--signer', 'owner', '--trusted-keys', b.trusted, '--policy', b.policy, '--assessment', put(b.dir, 'voice.json', v.out_()), '--reason', 'one vendor, since fixed', '--signed-at', '2026-09-28T09:50:00Z'])
    const io2 = cap()
    expect(run(['report', '--ledger', b.chain, '--policy', b.policy, '--trusted-keys', b.trusted], io2)).toBe(0)
    const md2 = io2.out_()
    expect(md2).toMatch(/### Asking for \(0\)/)
    expect(md2).toContain('### Declined, standing until the evidence changes (1)')
    expect(md2).toContain('`acme/invoice@0.0.1`: **Kept at `autonomy` by owner, 2026-09-28T09:50:00Z**; stands until a new failing case')
    expect(md2).toContain('their reason: "one vendor, since fixed"')
  })

  it('--declarations for an ungranted workflow keep the flag path and its opinion command, byte-for-byte', () => {
    const b = book()
    const decl = put(b.dir, 'declarations.json', [{ workflow_id: WF(), consequence_tier: 'low', granted: 'advise' }])
    const io = cap()
    expect(run(['report', '--ledger', b.chain, '--policy', b.policy, '--trusted-keys', b.trusted, '--declarations', decl], io)).toBe(0)
    expect(io.out_()).toContain('`verify opinion --ledger <chain.jsonl> --policy <policy.json> --workflow acme/invoice@0.0.1 --tier low --granted advise`')
    expect(io.out_()).not.toContain('the rung is read from the book of record')
  })
})
