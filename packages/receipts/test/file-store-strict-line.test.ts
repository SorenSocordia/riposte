// 2026-10-19: the file store reads every line under the engine's hash contract. The cold reviewer's repeated-key line
// (`"decision":"EXECUTE","decision":"HOLD"`, fixtures/ledger-cold-review-2026-10-13/case-dupkey-conflict) verified through the
// store once its head record was recomputed to match, because JSON.parse keeps the last value. It must refuse as corrupt.
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { fileStore, openLedger } from '../src/index.js'

const FX = join(__dirname, 'fixtures', 'ledger-cold-review-2026-10-13')
const D = mkdtempSync(join(tmpdir(), 'receipts-strict-line-'))
afterAll(() => rmSync(D, { recursive: true, force: true }))

describe('the file store under the strict line reader', () => {
  const pub = readFileSync(join(FX, 'pub.pem'), 'utf8')
  const head = JSON.parse(readFileSync(join(FX, 'receipts.jsonl.head.json'), 'utf8')).head as string

  it('refuses the repeated-key line even when the head record has been recomputed to match it', () => {
    const L = join(D, 'recomputed.jsonl')
    copyFileSync(join(FX, 'case-dupkey-conflict', 'receipts.jsonl'), L)
    writeFileSync(`${L}.head.json`, JSON.stringify({ version: 1, ledger: 'recomputed.jsonl', count: 5, head, bytes: readFileSync(L).length }))
    const c = openLedger(fileStore(L, { lock: false } as never)).verify({ publicKey: pub })
    expect(c.ok).toBe(false)
    expect(c.chain_ok).toBe(false)
    expect(c.reason).toMatch(/cannot be read one way/)
    expect(c.reason).toMatch(/"decision"/)
    expect(c.broken_at).toBe(2)
  })

  it('still reads the pristine ledger', () => {
    const L = join(D, 'pristine.jsonl')
    mkdirSync(D, { recursive: true })
    copyFileSync(join(FX, 'receipts.jsonl'), L)
    copyFileSync(join(FX, 'receipts.jsonl.head.json'), `${L}.head.json`)
    const c = openLedger(fileStore(L, { lock: false } as never)).verify({ publicKey: pub })
    expect(c.ok).toBe(true)
  })
})
