/**
 * The decision verbs, end to end through run(argv, io) (2026-09-28):
 *   verify keygen | grant | decline | revise-policy | report, and verify voice --from-book | --surface.
 * Wiring only: the logic lives in src/ledger/decisions.ts, src/verdict/voice.ts, src/ledger/report.ts and src/http/surfaces.ts.
 * Every verb runs against real files in a temp dir: a real chain export (ledger.chainJSONL()), real Ed25519 keys, the
 * declared policy. Each has its success, its refusal (exit 1, the reason printed, the book byte-identical) and its usage
 * errors (exit 3). Nothing throws out of run().
 */
import { describe, it, expect, afterEach } from 'vitest'
// The book is issued under the retained invoice 0.0.1 so its workflow stays <tenant>/invoice@0.0.1 (pinned 2026-09-28, NUMERIC-HONESTY).
import { INVOICE_RULESET_V0_0_1 } from '../src/rulesets/index'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFileSync, readFileSync, rmSync, existsSync, mkdtempSync } from 'node:fs'
import { createPrivateKey, createPublicKey } from 'node:crypto'
import { run, parseFlags, type CliIO } from '../src/cli'
import {
  verify, openFileLedger, parseChainJSONL, readDecisionBook, revisePolicy, policyRef, voiceFromJson, EXAMPLE_PROMOTION_POLICY,
  type PromotionPolicy,
} from '../src/index'
import { buildLedger, WF } from './fixtures/voice-ledger'
import { clean, FIXED_NOW } from './fixtures/invoices'

// ── keys, files, IO ──────────────────────────────────────────────────────────────────────────────────────────────────
function keyFromSeed(seedHex: string): { privateKeyPem: string; publicKeyPem: string } {
  const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(seedHex, 'hex')])
  const k = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' })
  return { privateKeyPem: k.export({ type: 'pkcs8', format: 'pem' }).toString(), publicKeyPem: createPublicKey(k).export({ type: 'spki', format: 'pem' }).toString() }
}
const OWNER = keyFromSeed('11'.repeat(32))
const LEAD = keyFromSeed('22'.repeat(32))
const AGENT = keyFromSeed('33'.repeat(32))

const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
function put(dir: string, name: string, content: unknown): string {
  const p = join(dir, name)
  writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content))
  return p
}
function cap(): CliIO & { out_: () => string; err_: () => string } {
  let o = '', e = ''
  return { out: s => { o += s }, err: s => { e += s }, out_: () => o, err_: () => e }
}

const P = EXAMPLE_PROMOTION_POLICY
/** 130 PASS + 60 FAIL reviewed, 2 false alarms: at tier low the evidence supports autonomy. */
const BASE = buildLedger({ passes: 130, fails: 60, failOverturned: 2 })
/** The same with 6 overturned PASSes (misses): the evidence supports gate, not autonomy. */
const MISSES = buildLedger({ passes: 130, fails: 60, passOverturned: 6, failOverturned: 2, prefix: 'miss' })

interface Book { dir: string; chain: string; policy: string; owner: string; lead: string; agent: string; trusted: string }
/** A fresh book of record on disk (a chain export, which ends without a newline), the policy, keys and trusted keys. */
function book(chainText = BASE.ledger.chainJSONL()): Book {
  const dir = mkdtempSync(join(tmpdir(), 'verify-cli-decisions-'))
  dirs.push(dir)
  return {
    dir,
    chain: put(dir, 'chain.jsonl', chainText),
    policy: put(dir, 'policy.json', P),
    owner: put(dir, 'owner.pem', OWNER.privateKeyPem),
    lead: put(dir, 'lead.pem', LEAD.privateKeyPem),
    agent: put(dir, 'agent.pem', AGENT.privateKeyPem),
    trusted: put(dir, 'trusted.json', { owner: OWNER.publicKeyPem, 'ap-lead': [LEAD.publicKeyPem] }),
  }
}
/**
 * An owner's grant, UNANCHORED (no --trusted-keys): signed and on the book, but under D-ANCHOR (security fix, 2026-09-28) it
 * moves no rung. A fixed signed_at unless `extra` gives its own (the strict parser refuses a flag given twice).
 */
const bareGrantArgs = (b: Book, level: string, extra: string[] = []): string[] => [
  'grant', '--ledger', b.chain, '--key', b.owner, '--signer', 'owner', '--workflow', WF(), '--level', level, '--tier', 'low',
  '--policy', b.policy, ...(extra.includes('--signed-at') ? [] : ['--signed-at', '2026-09-28T09:40:00Z']), ...extra,
]
/** An owner's grant, anchored with the trusted keys (the correct usage: only an anchored signer moves a rung). */
const grantArgs = (b: Book, level: string, extra: string[] = []): string[] => [...bareGrantArgs(b, level, extra), ...(extra.includes('--trusted-keys') ? [] : ['--trusted-keys', b.trusted])]
/** voice --from-book, anchored with the trusted keys (bareVoiceBook: read without them). */
const bareVoiceBook = (b: Book, extra: string[] = []): string[] => ['voice', '--from-book', '--ledger', b.chain, '--policy', b.policy, '--workflow', WF(), ...extra]
const voiceBook = (b: Book, extra: string[] = []): string[] => [...bareVoiceBook(b, extra), ...(extra.includes('--trusted-keys') ? [] : ['--trusted-keys', b.trusted])]
const declineArgs = (b: Book, assessment: string, extra: string[] = []): string[] => [
  'decline', '--ledger', b.chain, '--key', b.owner, '--signer', 'owner', '--policy', b.policy, '--assessment', assessment,
  '--reason', 'the six misses were one vendor, since fixed', '--signed-at', '2026-09-28T09:50:00Z', '--trusted-keys', b.trusted, ...extra,
]
/** The report, anchored with the trusted keys. */
const reportArgs = (b: Book, extra: string[] = []): string[] => ['report', '--ledger', b.chain, '--policy', b.policy, '--trusted-keys', b.trusted, ...extra]
/** The version after the example policy's (the example's version moves when its body does, so these tests follow it). */
const NEXT = ((v: string): string => { const [maj, min] = v.split('.').map(Number); return `${maj}.${(min as number) + 1}.0` })(EXAMPLE_PROMOTION_POLICY.version)
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** Everything but the book citation and the hash (which covers the citation). */
function strip(a: Record<string, unknown>): Record<string, unknown> {
  const { book: _b, assessment_hash: _h, ...rest } = a
  return rest
}
const ok = (argv: string[]): Record<string, any> => {
  const io = cap()
  const code = run(argv, io)
  if (code !== 0) throw new Error(`expected exit 0 from ${argv[0]}, got ${code}: ${io.err_()}`)
  return JSON.parse(io.out_())
}
/** Tamper one payload in a chain export (the first RECORD's tenant). */
function tampered(text: string): string {
  const lines = text.split('\n')
  const ev = JSON.parse(lines[0]!)
  ev.payload.tenant_id = 'mallory'
  lines[0] = JSON.stringify(ev)
  return lines.join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('verify keygen', () => {
  it('writes an Ed25519 keypair, never prints the private key, warns that custody is the operator\'s, and its output anchors a grant', () => {
    const b = book()
    const out = join(b.dir, 'me.pem')
    const io = cap()
    expect(run(['keygen', '--out', out, '--signer', 'owner'], io)).toBe(0)
    const res = JSON.parse(io.out_())
    expect(res).toMatchObject({ alg: 'ed25519', private_key_path: out, public_key_path: join(b.dir, 'me.pub.pem'), signer_id: 'owner' })
    const priv = createPrivateKey(readFileSync(out, 'utf8'))
    expect(priv.asymmetricKeyType).toBe('ed25519')
    expect(createPublicKey(priv).export({ type: 'spki', format: 'pem' }).toString()).toBe(res.public_key)
    expect(readFileSync(res.public_key_path, 'utf8')).toBe(res.public_key)
    expect(res.trusted_keys).toEqual({ owner: res.public_key })
    expect(io.out_()).not.toMatch(/PRIVATE KEY/)
    expect(io.err_()).toMatch(/KEY CUSTODY IS YOURS/)
    expect(io.err_()).toMatch(/cannot recover it\. If it leaks, revoke it on the book \(verify key revoke/)
    // keygen's own stdout is a valid --trusted-keys file: the new key signs, anchored to 'owner'.
    const keys = put(b.dir, 'keygen-out.json', io.out_())
    const io2 = cap()
    expect(run(['grant', '--ledger', b.chain, '--key', out, '--signer', 'owner', '--workflow', WF(), '--level', 'gate', '--tier', 'low', '--policy', b.policy, '--trusted-keys', keys], io2)).toBe(0)
    expect(JSON.parse(io2.out_())).toMatchObject({ anchored: true, appended: { signed: { decision: { signer_id: 'owner', level: 'gate' } } } })
    expect(io2.err_()).not.toMatch(/UNANCHORED/)
  })

  it('refuses to overwrite a key (exit 1, the file untouched); usage errors exit 3', () => {
    const b = book()
    const out = join(b.dir, 'k.pem')
    expect(run(['keygen', '--out', out], cap())).toBe(0)
    const before = readFileSync(out, 'utf8')
    const io = cap()
    expect(run(['keygen', '--out', out], io)).toBe(1)
    expect(io.err_()).toMatch(/REFUSED: .*already exist.*never overwritten/)
    expect(readFileSync(out, 'utf8')).toBe(before)
    const out2 = join(b.dir, 'k2.pem')
    writeFileSync(join(b.dir, 'k2.pub.pem'), 'somebody else\'s public key')
    expect(run(['keygen', '--out', out2], cap())).toBe(1)
    expect(existsSync(out2)).toBe(false)

    const io3 = cap()
    expect(run(['keygen'], io3)).toBe(3)
    expect(io3.err_()).toMatch(/verify keygen: needs --out/)
    expect(run(['keygen', '--out'], cap())).toBe(3)
    expect(run(['keygen', '--out', join(b.dir, 'x.pem'), '--force'], cap())).toBe(3)
    expect(existsSync(join(b.dir, 'x.pem'))).toBe(false)
    expect(run(['keygen', '--out', join(b.dir, 'no-such-dir', 'k.pem')], cap())).toBe(3)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('verify grant', () => {
  it('signs a GRANT and appends it through the door: append-only, the book verifies, and the output names the new head', () => {
    const b = book()
    const before = readFileSync(b.chain, 'utf8')
    const io = cap()
    expect(run(bareGrantArgs(b, 'gate', ['--note', 'month-end close, two reviewers']), io)).toBe(0)
    const res = JSON.parse(io.out_())
    expect(res.appended.signed.decision).toEqual({
      decision_version: 'decision-v0', kind: 'GRANT', workflow_id: WF(), level: 'gate', consequence_tier: 'low', policy: policyRef(P),
      note: 'month-end close, two reviewers', signer_id: 'owner', signed_at: '2026-09-28T09:40:00Z',
    })
    expect(res.anchored).toBe(false)
    expect(io.err_()).toMatch(/signer 'owner' is UNANCHORED: .* an unanchored decision moves no rung \(D-ANCHOR\)/)
    const after = readFileSync(b.chain, 'utf8')
    expect(after.startsWith(before)).toBe(true)
    const { events, payloads } = parseChainJSONL(after)
    expect(events).toHaveLength(BASE.ledger.events().length + 1)
    const bk = readDecisionBook(events, payloads)
    expect(bk.ok).toBe(true)
    expect(bk.decisions.map(d => d.decision_id)).toEqual([res.appended.decision_id])
    expect(res.chain).toEqual({ length: events.length, head: events[events.length - 1]!.entry_hash })
  })

  it('a chain export ends without a newline: grants still land one event per line, and the book keeps verifying', () => {
    const b = book()
    expect(BASE.ledger.chainJSONL().endsWith('\n')).toBe(false)
    expect(run(grantArgs(b, 'advise'), cap())).toBe(0)
    expect(run(grantArgs(b, 'gate', ['--signed-at', '2026-09-28T09:41:00Z']), cap())).toBe(0)
    const text = readFileSync(b.chain, 'utf8')
    const lines = text.split('\n').filter(Boolean)
    expect(lines).toHaveLength(BASE.ledger.events().length + 2)
    for (const l of lines) expect(() => JSON.parse(l)).not.toThrow()
    const { events, payloads } = parseChainJSONL(text)
    const bk = readDecisionBook(events, payloads)
    expect(bk.ok).toBe(true)
    expect(bk.decisions.map(d => (d.signed.decision as { level: string }).level)).toEqual(['advise', 'gate'])
  })

  it('with --trusted-keys only the key anchored to the signer passes; a forgery is REFUSED and the book is byte-identical', () => {
    const b = book()
    expect(ok(grantArgs(b, 'advise')).anchored).toBe(true)
    const lead = ok(['grant', '--ledger', b.chain, '--key', b.lead, '--signer', 'ap-lead', '--workflow', WF(), '--level', 'gate', '--tier', 'low', '--policy', b.policy, '--trusted-keys', b.trusted])
    expect(lead.appended.signed.decision.signer_id).toBe('ap-lead')
    const before = readFileSync(b.chain, 'utf8')
    const forged = grantArgs(b, 'autonomy', ['--bounds', 'all', '--trusted-keys', b.trusted])
    forged[forged.indexOf('--key') + 1] = b.agent // an agent's key, signing as the owner
    const io = cap()
    expect(run(forged, io)).toBe(1)
    expect(io.err_()).toMatch(/REFUSED: the signing key is not the one anchored to signer 'owner'/)
    expect(readFileSync(b.chain, 'utf8')).toBe(before)
  })

  it('an unanchored decision already on the book: under --trusted-keys the book does not verify, so it takes no decision', () => {
    const b = book()
    expect(run(['grant', '--ledger', b.chain, '--key', b.agent, '--signer', 'agent-7', '--workflow', WF(), '--level', 'autonomy', '--bounds', 'all', '--tier', 'low', '--policy', b.policy], cap())).toBe(0)
    const before = readFileSync(b.chain, 'utf8')
    const io = cap()
    expect(run(grantArgs(b, 'record'), io)).toBe(1)
    expect(io.err_()).toMatch(/REFUSED: the book of record does not verify at event \d+ \(decision at \d+: signer 'agent-7' has no anchored key/)
    expect(readFileSync(b.chain, 'utf8')).toBe(before)
  })

  it('refusals print the reason, exit 1, and append nothing', () => {
    const b = book()
    const before = readFileSync(b.chain, 'utf8')
    const cases: [string[], RegExp][] = [
      [grantArgs(b, 'autonomy'), /REFUSED: a GRANT of autonomy must state the bounds/],
      [grantArgs(b, 'gate').map(t => (t === 'low' ? 'catastrophic' : t)), new RegExp(`REFUSED: consequence tier "catastrophic" is not declared in policy example-illustrative@${esc(P.version)}`)],
      [grantArgs(b, 'gate').map(t => (t === b.policy ? put(b.dir, 'unlinted.json', { ...P, method: 'vibes' }) : t)), /REFUSED: the policy does not lint: method must be/],
      [grantArgs(b, 'gate', ['--signed-at', 'yesterday']), /REFUSED: signed_at must be an ISO-8601 timestamp/],
    ]
    for (const [argv, why] of cases) {
      const io = cap()
      expect(run(argv, io)).toBe(1)
      expect(io.err_()).toMatch(why)
      expect(readFileSync(b.chain, 'utf8')).toBe(before)
    }
    const t = book(tampered(BASE.ledger.chainJSONL()))
    const tBefore = readFileSync(t.chain, 'utf8')
    const io = cap()
    expect(run(grantArgs(t, 'gate'), io)).toBe(1)
    expect(io.err_()).toMatch(/REFUSED: the book of record does not verify at event 0/)
    expect(readFileSync(t.chain, 'utf8')).toBe(tBefore)
  })

  it('usage errors exit 3 and touch nothing', () => {
    const b = book()
    const before = readFileSync(b.chain, 'utf8')
    const io = cap()
    expect(run(['grant', '--ledger', b.chain], io)).toBe(3)
    expect(io.err_()).toMatch(/verify grant: needs --key, --signer, --workflow, --level, --tier, --policy/)
    const io2 = cap()
    expect(run(grantArgs(b, 'king'), io2)).toBe(3)
    expect(io2.err_()).toMatch(/--level must be one of record, advise, gate, autonomy \(got "king"\)/)
    const io3 = cap()
    expect(run([...grantArgs(b, 'gate'), '--levle', 'autonomy'], io3)).toBe(3)
    expect(io3.err_()).toMatch(/unknown option\(s\) --levle/)
    const io4 = cap()
    expect(run([...grantArgs(b, 'gate'), '--level', 'autonomy'], io4)).toBe(3)
    expect(io4.err_()).toMatch(/--level is given twice/)
    const io5 = cap()
    expect(run(['grant', '--bounds', '--ledger', b.chain], io5)).toBe(3)
    expect(io5.err_()).toMatch(/--bounds needs a value/)
    const missing = join(b.dir, 'typo-chain.jsonl')
    const io6 = cap()
    expect(run(grantArgs(b, 'gate').map(t => (t === b.chain ? missing : t)), io6)).toBe(3)
    expect(io6.err_()).toMatch(/no ledger at .*typo-chain\.jsonl/)
    expect(existsSync(missing)).toBe(false)
    const io7 = cap()
    expect(run(grantArgs(b, 'gate').map(t => (t === b.owner ? put(b.dir, 'pub.pem', OWNER.publicKeyPem) : t)), io7)).toBe(3)
    expect(io7.err_()).toMatch(/error reading key/)
    expect(readFileSync(b.chain, 'utf8')).toBe(before)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('verify voice --from-book', () => {
  it('nothing granted: the book path equals the flag path at record, plus the citation', () => {
    const b = book()
    const fromBook = ok(voiceBook(b, ['--tier', 'low']))
    const flag = ok(['voice', '--ledger', b.chain, '--policy', b.policy, '--workflow', WF(), '--tier', 'low', '--granted', 'record'])
    expect(strip(fromBook.assessment)).toEqual(strip(flag.assessment))
    expect(fromBook.assessment.book).toEqual({ head: BASE.ledger.chainHead(), length: BASE.ledger.events().length })
    expect(fromBook.assessment.proposal).toMatchObject({ kind: 'PROMOTION_PROPOSAL', from: 'record', to: 'advise' })
    expect(fromBook.chain).toMatchObject({ content_verified: true, ok: true, head: BASE.ledger.chainHead() })
  })

  it('reads the rung from the signed GRANT and cites it; equal to the flag path given the same grant record', () => {
    const b = book()
    const g = ok(grantArgs(b, 'gate')).appended
    const out = ok(voiceBook(b))
    expect(out.assessment).toMatchObject({ granted: 'gate', level: 'gate', earned: 'autonomy', consequence_tier: 'low', grant: { signer_id: 'owner', level: 'gate' } })
    expect(out.assessment.book.grant).toEqual({ decision_id: g.decision_id, seq: g.seq, entry_hash: g.entry_hash })
    expect(out.assessment.book.unanchored_signers).toBeUndefined() // anchored: no unanchored signer named
    expect(out.assessment.proposal).toMatchObject({ kind: 'PROMOTION_PROPOSAL', from: 'gate', to: 'autonomy' })
    const d = g.signed.decision
    const grantFile = put(b.dir, 'grant.json', { level: d.level, signer_id: d.signer_id, signed_at: d.signed_at, policy: d.policy, consequence_tier: d.consequence_tier })
    const flag = ok(['voice', '--ledger', b.chain, '--policy', b.policy, '--workflow', WF(), '--grant', grantFile])
    expect(strip(out.assessment)).toEqual(strip(flag.assessment))
    // D-ANCHOR: read WITHOUT the anchors, the same grant is on the book and moves nothing: the rung is record, and the
    // CLI says why (no tier to measure record against → exit 3, naming the grant that has no effect)
    const io = cap()
    expect(run(bareVoiceBook(b), io)).toBe(3)
    expect(io.err_()).toMatch(new RegExp(`GRANT \`${g.decision_id.slice(0, 12)}\` by owner .* is not anchored: it has no effect`))
    const bare = ok(bareVoiceBook(b, ['--tier', 'low']))
    expect(bare.assessment).toMatchObject({ granted: 'record', level: 'record' })
    expect(bare.assessment.book.unanchored_signers).toEqual(['owner'])
  })

  it('refuses what a flag or a broken book would claim: exit 3 for settings, exit 1 when the book does not verify', () => {
    const b = book()
    ok(grantArgs(b, 'gate'))
    const io = cap()
    expect(run(voiceBook(b, ['--granted', 'autonomy']), io)).toBe(3)
    expect(io.err_()).toMatch(/--from-book reads the rung.*--granted cannot be passed with it/)
    const io2 = cap()
    expect(run(voiceBook(b, ['--tier', 'high']), io2)).toBe(3)
    expect(io2.err_()).toMatch(/made at consequence tier 'low', not 'high'/)
    const bare = book()
    const io3 = cap()
    expect(run(voiceBook(bare), io3)).toBe(3)
    expect(io3.err_()).toMatch(/no (anchored )?GRANT for workflow .* no consequence_tier was declared/)
    const io4 = cap()
    expect(run(['voice', '--ledger', b.chain, '--policy', b.policy, '--workflow', WF(), '--tier', 'low', '--trusted-keys', b.trusted], io4)).toBe(3)
    expect(io4.err_()).toMatch(/use them with --from-book/)
    const io5 = cap()
    expect(run(['voice', '--from-book', '--ledger', b.chain, '--policy', b.policy], io5)).toBe(3)
    expect(io5.err_()).toMatch(/Workflows on this ledger:\n {2}acme\/invoice@0\.0\.1 \(190 verdicts\)/)

    // a GRANT altered on disk after signing (gate → autonomy): the book no longer verifies, so no rung is read from it
    const lines = readFileSync(b.chain, 'utf8').split('\n').filter(Boolean)
    const last = JSON.parse(lines[lines.length - 1]!)
    last.payload.signed.decision.level = 'autonomy'
    lines[lines.length - 1] = JSON.stringify(last)
    const t = book(`${lines.join('\n')}\n`)
    const io6 = cap()
    expect(run(voiceBook(t), io6)).toBe(1)
    expect(JSON.parse(io6.out_()).chain).toMatchObject({ content_verified: false, ok: false, broken_at: lines.length - 1 })
    expect(io6.err_()).toMatch(/does not verify at event \d+ .*grants nothing/)
    // a signer the trusted keys do not anchor: the book grants nothing under them
    const u = book()
    expect(run(['grant', '--ledger', u.chain, '--key', u.agent, '--signer', 'agent-7', '--workflow', WF(), '--level', 'gate', '--tier', 'low', '--policy', u.policy], cap())).toBe(0)
    const io7 = cap()
    expect(run(voiceBook(u, ['--trusted-keys', u.trusted]), io7)).toBe(1)
    expect(io7.err_()).toMatch(/signer 'agent-7' has no anchored key/)
  })

  it('--surface prints exactly the MCP/HTTP voice surface (flag path), and on the book path the surface reads the grant', () => {
    const b = book()
    const io = cap()
    expect(run(['voice', '--surface', '--ledger', b.chain, '--policy', b.policy, '--workflow', WF(), '--tier', 'low', '--granted', 'gate'], io)).toBe(0)
    const mcp = voiceFromJson({ ledger: BASE.ledger.chainJSONL(), policy: P, workflow_id: WF(), consequence_tier: 'low', granted: 'gate' })
    expect(JSON.parse(io.out_())).toEqual(JSON.parse(JSON.stringify(mcp)))

    // nothing declared on the book path: record, nothing weighed (the surface's day-1 default)
    const undeclared = ok(voiceBook(b, ['--surface']))
    expect(undeclared).toMatchObject({ level: 'record', declared: false, earned: null, open_proposal: null, assessment: null })

    const g = ok(grantArgs(b, 'gate')).appended
    const s = ok(voiceBook(b, ['--surface']))
    expect(s).toMatchObject({ surface_version: 'voice-surface-v0', level: 'gate', granted: 'gate', declared: true, verified: true, earned: 'autonomy' })
    expect(s.open_proposal).toMatchObject({ kind: 'PROMOTION_PROPOSAL', from: 'gate', to: 'autonomy' })
    expect(s.assessment.book.grant.decision_id).toBe(g.decision_id)
    expect(s.assessment).toEqual(ok(voiceBook(b)).assessment) // the surface carries the very assessment --from-book prints
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('verify decline', () => {
  it('the keep-it loop: an URGENT demotion (exit 2) → a person declines → held back and cited (exit 0) → a new miss re-raises it', () => {
    const b = book(MISSES.ledger.chainJSONL())
    ok(grantArgs(b, 'autonomy', ['--bounds', 'PO-matched invoices under $5,000']))
    const io = cap()
    expect(run(voiceBook(b), io)).toBe(2)
    const seen = JSON.parse(io.out_()).assessment
    expect(seen.proposal).toMatchObject({ kind: 'DEMOTION_PROPOSAL', urgent: true, from: 'autonomy', to: 'gate' })
    const assessment = put(b.dir, 'voice.json', io.out_())

    const res = ok(declineArgs(b, assessment))
    expect(res.appended.signed.decision).toMatchObject({
      kind: 'DECLINE', workflow_id: WF(), proposal_id: seen.proposal.proposal_id, proposal_kind: 'DEMOTION_PROPOSAL', from: 'autonomy', to: 'gate',
      under_grant: seen.book.grant.decision_id, reason: 'the six misses were one vendor, since fixed', signer_id: 'owner',
    })
    expect(res.appended.signed.decision.seen.failing_cases).toHaveLength(6)

    const now = ok(voiceBook(b)).assessment
    expect(now.proposal).toBeUndefined()
    expect(now.level).toBe('autonomy')
    expect(now.book.declined).toMatchObject({ suppressed_proposal_id: seen.proposal.proposal_id, signer_id: 'owner', decision_id: res.appended.decision_id })
    // The day-1 report reads the same book: the declined demotion is not asked for again.
    const report = cap()
    expect(run(reportArgs(b), report)).toBe(0)
    expect(report.out_()).toContain('| `acme/invoice@0.0.1` | autonomy | low | 190 | gate |')
    expect(report.out_()).toMatch(/### Asking for \(0\)/)

    // Declining again: there is nothing on the assessment to decline (the decline already holds it back).
    const held = put(b.dir, 'held.json', ok(voiceBook(b)))
    const before = readFileSync(b.chain, 'utf8')
    const io2 = cap()
    expect(run(declineArgs(b, held), io2)).toBe(1)
    expect(io2.err_()).toMatch(/REFUSED: there is no proposal on this assessment to decline/)
    expect(readFileSync(b.chain, 'utf8')).toBe(before)

    // The evidence changes (a new PASS a person overturns): the decline lapses and the proposal is raised again.
    const led = openFileLedger(b.chain)
    const v = verify({ ...clean, invoice_number: 'new-miss' }, { now: FIXED_NOW, ruleset: INVOICE_RULESET_V0_0_1 })
    led.record(v, { tenant_id: 'acme' })
    led.review(v.verdict_id, { reviewer_id: 'ap-lead', decision: 'OVERTURNED' })
    const io3 = cap()
    expect(run(voiceBook(b), io3)).toBe(2)
    expect(JSON.parse(io3.out_()).assessment.book.decline_lapsed).toMatchObject({ why: expect.stringMatching(/1 new failing case/) })
    const report2 = cap()
    expect(run(reportArgs(b), report2)).toBe(0)
    expect(report2.out_()).toMatch(/### Asking for \(1\)/)
    expect(report2.out_()).toMatch(/\*\*URGENT · step down\*\* `acme\/invoice@0\.0\.1`: `autonomy` → `gate`/)
  })

  it('refuses an assessment that is not what the book showed: flag-read, altered, from another book, or under a superseded grant', () => {
    const b = book(MISSES.ledger.chainJSONL())
    ok(grantArgs(b, 'autonomy', ['--bounds', 'all']))
    const io = cap()
    expect(run(voiceBook(b), io)).toBe(2)
    const good = JSON.parse(io.out_())
    const before = readFileSync(b.chain, 'utf8')
    const expectRefused = (assessmentFile: string, why: RegExp, onto: Book = b): void => {
      const pre = readFileSync(onto.chain, 'utf8')
      const e = cap()
      expect(run(declineArgs(onto, assessmentFile), e)).toBe(1)
      expect(e.err_()).toMatch(why)
      expect(readFileSync(onto.chain, 'utf8')).toBe(pre)
    }
    // read by flag, not from the book
    const flagRead = cap()
    expect(run(['voice', '--ledger', b.chain, '--policy', b.policy, '--workflow', WF(), '--tier', 'low', '--granted', 'autonomy', '--bounds', 'all'], flagRead)).toBe(2)
    expectRefused(put(b.dir, 'flag.json', flagRead.out_()), /REFUSED: the assessment was not read from the book of record/)
    // altered after Riposte made it (one failing case quietly dropped)
    const altered = structuredClone(good)
    altered.assessment.proposal.failing_cases.pop()
    expectRefused(put(b.dir, 'altered.json', altered), /REFUSED: the assessment does not match its own hash/)
    // read from another book (a different chain: its event at that length is not the cited head)
    expectRefused(put(b.dir, 'good.json', good), /REFUSED: the assessment was read from another book/, book())
    // under a grant a person has since replaced: the door refuses it (and says the book moved on)
    ok(grantArgs(b, 'autonomy', ['--bounds', 'all', '--signed-at', '2026-09-28T09:45:00Z']))
    const e = cap()
    expect(run(declineArgs(b, put(b.dir, 'stale.json', good)), e)).toBe(1)
    expect(e.err_()).toMatch(/note: the book has moved on by 1 event/)
    expect(e.err_()).toMatch(/REFUSED: a decline answers a proposal made under the grant in force/)
    expect(readFileSync(b.chain, 'utf8').startsWith(before)).toBe(true)
  })

  it('usage errors exit 3', () => {
    const b = book()
    const io = cap()
    expect(run(['decline', '--ledger', b.chain, '--key', b.owner, '--signer', 'owner', '--assessment', b.policy], io)).toBe(3)
    expect(io.err_()).toMatch(/verify decline: needs --policy, --reason \(--policy: the book is read again under it/)
    const io2 = cap()
    expect(run(declineArgs(b, b.policy), io2)).toBe(3)
    expect(io2.err_()).toMatch(/not a voice assessment/)
    const io3 = cap()
    expect(run(declineArgs(b, put(b.dir, 'broken.json', '{ "assessment": ')), io3)).toBe(3)
    expect(io3.err_()).toMatch(/error reading input/)
    expect(run([...declineArgs(b, b.policy), '--level', 'gate'], cap())).toBe(3)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('verify revise-policy', () => {
  const revised = (by = 'owner'): PromotionPolicy => revisePolicy(
    P,
    { version: NEXT, tiers: P.tiers.map(t => (t.tier === 'low' ? { ...t, autonomy: { min_n: 150, max_error: 0.03 } } : t)) },
    { revised_by: by, revised_at: '2026-09-28T10:00:00Z', reason: 'month-end volume: autonomy needs a larger sample' },
  )

  it('appends a person\'s revision; the grant stands under its own version and the book names the one superseding it', () => {
    const b = book()
    ok(grantArgs(b, 'gate'))
    const r = revised()
    const res = ok(['revise-policy', '--ledger', b.chain, '--key', b.owner, '--signer', 'owner', '--revised', put(b.dir, 'policy-0.2.0.json', r)])
    expect(res.appended.signed.decision).toMatchObject({ kind: 'POLICY_REVISION', policy: policyRef(r), supersedes: policyRef(P), changes: r.revision!.changes, signer_id: 'owner', signed_at: '2026-09-28T10:00:00Z' })
    const a = ok(voiceBook(b)).assessment
    expect(a.policy).toEqual(policyRef(P))
    expect(a.book.superseded_by).toEqual([{ policy: policyRef(r), decision_id: res.appended.decision_id, seq: res.appended.seq, lints: true }])
  })

  it('refusals exit 1 and append nothing: another signer, the same version twice, not a revision, a grant naming another body', () => {
    const b = book()
    const r = revised()
    const rp = put(b.dir, 'policy-0.2.0.json', r)
    const before = readFileSync(b.chain, 'utf8')
    const io = cap()
    expect(run(['revise-policy', '--ledger', b.chain, '--key', b.lead, '--signer', 'ap-lead', '--revised', rp], io)).toBe(1)
    expect(io.err_()).toMatch(/REFUSED: the revision records revised_by 'owner', so --signer 'ap-lead' cannot sign it/)
    const io2 = cap()
    expect(run(['revise-policy', '--ledger', b.chain, '--key', b.owner, '--signer', 'owner', '--revised', b.policy], io2)).toBe(1)
    expect(io2.err_()).toMatch(/REFUSED: not a revision/)
    expect(readFileSync(b.chain, 'utf8')).toBe(before)

    ok(['revise-policy', '--ledger', b.chain, '--key', b.owner, '--signer', 'owner', '--revised', rp])
    const after = readFileSync(b.chain, 'utf8')
    const io3 = cap()
    expect(run(['revise-policy', '--ledger', b.chain, '--key', b.owner, '--signer', 'owner', '--revised', rp], io3)).toBe(1)
    expect(io3.err_()).toMatch(new RegExp(`REFUSED: example-illustrative@${esc(NEXT)} is already on the book`))
    const doctored = put(b.dir, 'doctored-0.2.0.json', { ...r, method: 'clopper-pearson' })
    const io4 = cap()
    expect(run(grantArgs(b, 'gate').map(t => (t === b.policy ? doctored : t)), io4)).toBe(1)
    expect(io4.err_()).toMatch(new RegExp(`REFUSED: the book records example-illustrative@${esc(NEXT)} as .* this grant names another body`))
    expect(readFileSync(b.chain, 'utf8')).toBe(after)
  })

  it('usage errors exit 3', () => {
    const b = book()
    const io = cap()
    expect(run(['revise-policy', '--ledger', b.chain, '--key', b.owner, '--signer', 'owner'], io)).toBe(3)
    expect(io.err_()).toMatch(/verify revise-policy: needs --revised/)
    const io2 = cap()
    expect(run(['revise-policy', '--ledger', b.chain, '--key', b.owner, '--signer', 'owner', '--revised', put(b.dir, 'arr.json', [])], io2)).toBe(3)
    expect(io2.err_()).toMatch(/--revised must be a promotion policy/)
    expect(run(['revise-policy', '--ledger', b.chain, '--key', b.owner, '--signer', 'owner', '--revised', b.policy, '--reason', 'x'], cap())).toBe(3)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('verify report', () => {
  it('the day-1 audit report: each rung read from the book, weighed under the policy, with the tamper-evidence line', () => {
    const b = book()
    const io0 = cap()
    expect(run(reportArgs(b), io0)).toBe(0)
    expect(io0.out_()).toMatch(/^# Verification book of record/)
    expect(io0.out_()).toContain('| `acme/invoice@0.0.1` | record (nothing granted) | — | 190 | — |')

    ok(grantArgs(b, 'gate'))
    const io = cap()
    expect(run(reportArgs(b, ['--month', '2026-09', '--tenant', 'acme', '--as-of', '2026-09-28T09:45:00Z']), io)).toBe(0)
    const md = io.out_()
    expect(md).toMatch(/^# Verification book of record — tenant `acme`/)
    expect(md).toContain('_As of 2026-09-28T09:45:00Z._')
    expect(md).toContain('| `acme/invoice@0.0.1` | gate | low | 190 | autonomy |')
    expect(md).toMatch(/## Opinions: what Riposte is asking for \(2026-09\)/)
    expect(md).toMatch(/### Asking for \(1\)/)
    expect(md).toMatch(/\*\*Promotion\*\* `acme\/invoice@0\.0\.1`: `gate` → `autonomy`/)
    expect(md).toContain(`Chain intact across **${BASE.ledger.events().length + 1}** events`)
  })

  it('--declarations cover workflows with no GRANT and never override one (the book governs; a disagreement is noted)', () => {
    const b = book()
    const decl = put(b.dir, 'declarations.json', [{ workflow_id: WF(), consequence_tier: 'low', granted: 'advise' }])
    const io = cap()
    expect(run(reportArgs(b, ['--declarations', decl]), io)).toBe(0)
    expect(io.out_()).toContain('| `acme/invoice@0.0.1` | advise | low | 190 | autonomy |')
    expect(io.err_()).toBe('')
    ok(grantArgs(b, 'gate'))
    const io2 = cap()
    expect(run(reportArgs(b, ['--declarations', decl]), io2)).toBe(0)
    expect(io2.out_()).toContain('| `acme/invoice@0.0.1` | gate | low | 190 | autonomy |')
    expect(io2.err_()).toMatch(/the declaration for acme\/invoice@0\.0\.1 \(advise, tier low\) disagrees with the GRANT in force on the book \(gate, tier low\); the book governs/)
  })

  it('a book that does not verify: the report says so, grants nothing, and exits 1', () => {
    const b = book(tampered(BASE.ledger.chainJSONL()))
    const io = cap()
    expect(run(['report', '--ledger', b.chain, '--policy', b.policy], io)).toBe(1)
    expect(io.out_()).toMatch(/⚠ \*\*Chain integrity FAILED\*\* at event 0/)
  })

  it('usage errors exit 3', () => {
    const b = book()
    const io = cap()
    expect(run(['report'], io)).toBe(3)
    expect(io.err_()).toMatch(/verify report: needs --ledger/)
    const io2 = cap()
    expect(run(['report', '--ledger', b.chain, '--month', '2026-13'], io2)).toBe(3)
    expect(io2.err_()).toMatch(/--month must be YYYY-MM \(got "2026-13"\)/)
    const io3 = cap()
    expect(run(['report', '--ledger', b.chain, '--declarations', put(b.dir, 'd.json', [{ consequence_tier: 'low' }])], io3)).toBe(3)
    expect(io3.err_()).toMatch(/"workflow_id" is required/)
    expect(run(['report', '--ledger', join(b.dir, 'nope.jsonl')], cap())).toBe(3)
    expect(run(['report', '--ledger', b.chain, '--json'], cap())).toBe(3)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('nothing throws out of run()', () => {
  it('hostile inputs to every new verb (and a few old ones) exit with a code, never a throw, and never reach the book', () => {
    const b = book()
    const original = readFileSync(b.chain, 'utf8')
    const junk = [
      put(b.dir, 'null.json', 'null'), put(b.dir, 'arr.json', '[]'), put(b.dir, 'num.json', '5'), put(b.dir, 'str.json', '"x"'),
      put(b.dir, 'bad.json', '{not json'), put(b.dir, 'empty.json', ''), put(b.dir, 'obj.json', { assessment: { assessment_version: 'voice-v0', assessment_hash: 'x', book: 5 } }), b.dir,
    ]
    const argvs: string[][] = []
    for (const j of junk) {
      argvs.push(
        ['grant', '--ledger', j, '--key', j, '--signer', 's', '--workflow', 'w', '--level', 'gate', '--tier', 'low', '--policy', j],
        ['grant', '--ledger', b.chain, '--key', b.owner, '--signer', 's', '--workflow', 'w', '--level', 'gate', '--tier', 'low', '--policy', j],
        ['grant', '--ledger', b.chain, '--key', j, '--signer', 's', '--workflow', 'w', '--level', 'gate', '--tier', 'low', '--policy', b.policy],
        ['decline', '--ledger', b.chain, '--key', b.owner, '--signer', 's', '--assessment', j, '--reason', 'r'],
        ['decline', '--ledger', j, '--key', b.owner, '--signer', 's', '--assessment', j, '--reason', 'r'],
        ['revise-policy', '--ledger', b.chain, '--key', b.owner, '--signer', 's', '--revised', j],
        ['report', '--ledger', j],
        ['report', '--ledger', b.chain, '--policy', j],
        ['report', '--ledger', b.chain, '--declarations', j],
        ['report', '--ledger', b.chain, '--trusted-keys', j],
        ['voice', '--from-book', '--ledger', j, '--policy', b.policy, '--workflow', WF()],
        ['voice', '--from-book', '--ledger', b.chain, '--policy', j, '--workflow', WF(), '--tier', 'low'],
        ['voice', '--from-book', '--surface', '--ledger', b.chain, '--policy', j, '--workflow', WF(), '--tier', 'low'],
        ['voice', '--from-book', '--ledger', b.chain, '--policy', b.policy, '--workflow', WF(), '--trusted-keys', j],
        ['voice', '--surface', '--ledger', b.chain, '--policy', j, '--workflow', WF(), '--tier', 'low'],
        ['keygen', '--out', j],
        ['lint', '--ruleset', j], ['notice', j], ['replay', j], ['opinion', '--ledger', j, '--dispute', 'x'], [j],
      )
    }
    for (const argv of argvs) {
      let code: number | undefined
      expect(() => { code = run(argv, cap()) }, argv.join(' ')).not.toThrow()
      expect([0, 1, 2, 3], argv.join(' ')).toContain(code)
    }
    expect(readFileSync(b.chain, 'utf8')).toBe(original)
  })

  it('parseFlags: unknown, repeated and valueless flags are problems; prototype names are not flags', () => {
    const spec = { ledger: 'value', surface: 'bool' } as const
    expect(parseFlags(['--ledger', 'a.jsonl', '--surface'], spec)).toMatchObject({ v: { ledger: 'a.jsonl' }, problems: [] })
    expect(parseFlags(['--ledger', 'a', '--ledger', 'b'], spec).problems).toEqual(['--ledger is given twice'])
    expect(parseFlags(['--ledger', '--surface'], spec).problems).toEqual(['--ledger needs a value'])
    // 2026-10-05: the value typed after an unknown option is that option's value, not a second problem
    expect(parseFlags(['--constructor', 'x', '--__proto__', 'y', 'stray'], spec).problems).toEqual(['unknown option(s) --constructor, --__proto__, stray'])
    expect(parseFlags(['-h'], spec).help).toBe(true)
  })
})
