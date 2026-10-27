/**
 * Who may clear a pay application, named by role (a cold review, 2026-10-12; test/fixtures/ap-emailed-bills/p04-shortret.json).
 * A subcontractor reviewing a sub-tier's application is the payer, not the AIA owner, and "the owner (owner)" read as someone
 * else. The pay-application path takes a payer_role: the AIA title is printed only when it says owner; otherwise the words name
 * the payer. The ruling role in the verdict is unchanged (a ruling is signed for it), so no verdict moves.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verify } from '../src/verify'
import { formatPayAppReport } from '../src/rulesets/pay-app/report'
import { run } from '../src/cli'

const HERE = dirname(fileURLToPath(import.meta.url))
const P04 = join(HERE, 'fixtures', 'ap-emailed-bills', 'p04-shortret.json')
const PREV = join(HERE, '..', 'docs', 'examples', 'payapp-g702-g703.previous.json')
const doc = JSON.parse(readFileSync(P04, 'utf8')) as Record<string, unknown>
const prev = JSON.parse(readFileSync(PREV, 'utf8')) as unknown
const v = verify(doc as never, { ruleset: 'pay-app', references: { history: [prev] }, now: () => new Date('2026-10-12T00:00:00Z') })

describe('the payer, by role', () => {
  it('by default the payer is named as the payer, never as the AIA owner', () => {
    const out = formatPayAppReport(v, { extraction: doc })
    expect(out).toContain("who may clear it: the payer's controller (ruling role: owner), for this application only")
    expect(out).not.toContain('the owner (owner)')
  })
  it('payer_role owner prints the AIA title', () => {
    expect(formatPayAppReport(v, { extraction: doc, payer_role: 'owner' })).toContain('who may clear it: the owner (owner), for this application only')
  })
  it('the command line takes --payer-role owner|payer, and refuses anything else by name', () => {
    const cli = (...extra: string[]) => { let err = ''; const code = run([P04, '--ruleset', 'pay-app', '--history', PREV, ...extra], { out: () => {}, err: (s: string) => { err += s } }); return { code, err } }
    expect(cli().err).toContain("the payer's controller (ruling role: owner)")
    expect(cli('--payer-role', 'owner').err).toContain('the owner (owner)')
    const bad = cli('--payer-role', 'architect')
    expect(bad.code).toBe(3)
    expect(bad.err).toContain('--payer-role')
  })
  it('the verdict is the same whatever the role: only the words move', () => {
    let a = '', b = ''
    run([P04, '--ruleset', 'pay-app', '--history', PREV], { out: (s: string) => { a += s }, err: () => {} })
    run([P04, '--ruleset', 'pay-app', '--history', PREV, '--payer-role', 'owner'], { out: (s: string) => { b += s }, err: () => {} })
    const strip = (s: string) => { const x = JSON.parse(s) as { issued_at?: string }; delete x.issued_at; return x }
    expect(strip(a)).toEqual(strip(b))
  })
})
