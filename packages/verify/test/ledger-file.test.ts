/**
 * File-backed ledger — the book of record must survive a restart with the tamper-evident chain intact. Persist, reopen,
 * and prove the head hash is identical and verifyContent() still passes; then prove appends continue the chain on disk.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { openFileLedger, verifyDeclarative } from '../src/index'
import type { DeclarativeRuleset } from '../src/declarative/types'

const ruleset: DeclarativeRuleset = {
  id: 'test-total', version: '1.0.0', domain: 'test',
  fields: { SUB: { paths: ['subtotal'] }, TAX: { paths: ['tax'] }, TOTAL: { paths: ['total'] } },
  checks: [{ code: 'TOTAL_INT', left: 'TOTAL', op: '=', right: 'SUB + TAX', field: 'total' }],
}
const NOW = () => new Date('2026-09-22T00:00:00Z')
const paths: string[] = []
const tmpPath = (): string => { const p = join(tmpdir(), `verify-ledger-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`); paths.push(p); return p }
afterEach(() => { for (const p of paths.splice(0)) if (existsSync(p)) rmSync(p) })

describe('openFileLedger', () => {
  it('survives a reopen with the chain head identical and content intact', () => {
    const path = tmpPath()
    const led1 = openFileLedger(path, { now: NOW })
    const v = verifyDeclarative({ subtotal: 1, tax: 1, total: 9 }, ruleset, { now: NOW }) // FAIL
    led1.record(v, { tenant_id: 't' })
    led1.review(v.verdict_id, { reviewer_id: 'r', decision: 'OVERTURNED' })
    const head1 = led1.chainHead()
    const stats1 = led1.stats('t')

    const led2 = openFileLedger(path) // "restart"
    expect(led2.chainHead()).toBe(head1)
    expect(led2.verifyContent().ok).toBe(true)
    expect(led2.stats('t')).toEqual(stats1)
    expect(led2.get(v.verdict_id)?.review?.decision).toBe('OVERTURNED')
  })

  it('continues the chain on disk when a reopened ledger appends', () => {
    const path = tmpPath()
    const a = openFileLedger(path, { now: NOW })
    a.record(verifyDeclarative({ subtotal: 1, tax: 1, total: 2 }, ruleset, { now: NOW }), { tenant_id: 't' })

    const b = openFileLedger(path)
    b.record(verifyDeclarative({ subtotal: 2, tax: 2, total: 4 }, ruleset, { now: NOW }), { tenant_id: 't' })
    expect(b.verifyContent().ok).toBe(true)
    expect(b.stats('t').total).toBe(2)

    const c = openFileLedger(path) // reopen again — both records present, chain still whole
    expect(c.stats('t').total).toBe(2)
    expect(c.verifyContent().ok).toBe(true)
    expect(c.events().length).toBe(2)
  })

  it('a tampered on-disk chain is detected on reopen', () => {
    const path = tmpPath()
    const led = openFileLedger(path, { now: NOW })
    led.record(verifyDeclarative({ subtotal: 1, tax: 1, total: 2 }, ruleset, { now: NOW }), { tenant_id: 't' })
    // Corrupt the payload on disk, keeping the JSON well-formed.
    const line = JSON.parse(readFileSync(path, 'utf8').trim())
    line.payload.tenant_id = 'someone-else'
    writeFileSync(path, JSON.stringify(line) + '\n')
    const reopened = openFileLedger(path)
    expect(reopened.verifyContent().ok).toBe(false) // payload_hash no longer matches the altered body
  })
})
