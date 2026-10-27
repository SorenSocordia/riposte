/**
 * 2026-10-05: `riposte-ledger verify` on a signed four-entry ledger with a torn tail, run with --no-sidecar, printed
 * `"ok": true` on stdout and "OK: 4 entries" as its first stderr line, and exited 1. A CI step that reads `.ok` passed a
 * torn ledger. Now the JSON's `ok` is true exactly when the exit is 0, `reason` names what failed first, `chain_ok` keeps
 * the hash chain's own answer, and the first stderr line never says OK over a non-zero exit.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateSigningKeypair } from 'riposte-verify'
import { fileStore, ledgerCli, openLedger, type LedgerEntry } from '../src/index.js'

const alice = generateSigningKeypair()
const mallory = generateSigningKeypair()
const dirs: string[] = []
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })
const readFile = (p: string): string => readFileSync(p, 'utf8')

/** Five signed entries written by the file store (so a head record sits beside the file), and both public keys on disk. */
function ledger(): { dir: string; L: string; lines: string[]; alicePub: string; malloryPub: string; entries: LedgerEntry[] } {
  const dir = mkdtempSync(join(tmpdir(), 'riposte-ok-exit-'))
  dirs.push(dir)
  const L = join(dir, 'r.jsonl')
  const l = openLedger(fileStore(L), { signingKey: alice.privateKeyPem })
  for (let i = 0; i < 5; i++) l.append('ap_gate', { bill: `B${i}`, decision: i % 2 ? 'HOLD' : 'EXECUTE' })
  const alicePub = join(dir, 'alice.pub.pem')
  const malloryPub = join(dir, 'mallory.pub.pem')
  writeFileSync(alicePub, alice.publicKeyPem)
  writeFileSync(malloryPub, mallory.publicKeyPem)
  return { dir, L, lines: readFileSync(L, 'utf8').split('\n').filter(Boolean), alicePub, malloryPub, entries: l.entries() }
}

/** A copy of the ledger with other lines; the head record copied beside it, or none. */
function variant(dir: string, L: string, name: string, lines: string[], tail = '', sidecar: 'copy' | 'none' = 'copy'): string {
  const f = join(dir, `${name}.jsonl`)
  writeFileSync(f, lines.map((l) => `${l}\n`).join('') + tail)
  if (sidecar === 'copy') copyFileSync(`${L}.head.json`, `${f}.head.json`)
  return f
}

describe('riposte-ledger verify: the JSON agrees with the exit code', () => {
  it('the reviewer\'s case: four whole entries, a torn tail, --no-sidecar → ok:false, exit 1, "torn tail" in words on the first line', () => {
    const { dir, L, lines } = ledger()
    const torn = `${lines[4]!.slice(0, -2)}${'x'.repeat(600)}`.slice(0, 534) // the reviewer's file carried 534 bytes of an unfinished fifth entry
    const f = variant(dir, L, 'torn2', lines.slice(0, 4), torn, 'none')
    const r = ledgerCli(['verify', f, '--no-sidecar'], readFile)
    expect(r.code).toBe(1)
    const out = JSON.parse(r.out)
    expect(out).toMatchObject({ ok: false, chain_ok: true, length: 4, signed: 4, torn_tail: { bytes: 534, after_line: 4 } })
    expect(out.reason).toBe('torn tail: the file ends in an unfinished line (534 bytes after entry 3), a crash mid-append')
    expect(r.err.split('\n')[0]).toMatch(/^NOT VERIFIED: torn tail\. The file ends in an unfinished line; the entries before it chain correctly on their own \(4 entries,/)
    expect(r.err).not.toMatch(/^OK/m)
    expect(r.err).toContain('TORN TAIL: the file ends in an unfinished line (534 bytes after entry 3)')
  })

  it('a torn tail with the head record read, and with --key: still ok:false, exit 1', () => {
    const { dir, L, lines, alicePub } = ledger()
    const f = variant(dir, L, 'torn-sc', lines, lines[0]!.slice(0, 40))
    for (const extra of [[], ['--key', alicePub]]) {
      const r = ledgerCli(['verify', f, ...extra], readFile)
      expect(r.code).toBe(1)
      expect(JSON.parse(r.out)).toMatchObject({ ok: false, chain_ok: true })
      expect(r.err).toMatch(/^NOT VERIFIED: torn tail\./)
    }
  })

  it('across every outcome verify can give, `ok` is true exactly when the exit is 0, and the first line says OK exactly then', () => {
    const { dir, L, lines, alicePub, malloryPub, entries } = ledger()
    const edited = [...lines]
    const o = JSON.parse(edited[1]!) as LedgerEntry & { body: { decision: string } }
    o.body.decision = 'EXECUTE'
    edited[1] = JSON.stringify(o)
    const H3 = entries[2]!.hash
    const cases: { name: string; argv: string[]; code: number }[] = [
      { name: 'clean', argv: [L], code: 0 },
      { name: 'clean, --key alice', argv: [L, '--key', alicePub], code: 0 },
      { name: 'clean, --key mallory', argv: [L, '--key', malloryPub], code: 1 },
      { name: 'clean, --head of entry 2', argv: [L, '--head', H3], code: 0 },
      { name: 'clean, --head not in the chain', argv: [L, '--head', 'f'.repeat(64)], code: 1 },
      { name: 'entry 1 edited', argv: [variant(dir, L, 'edit', edited)], code: 1 },
      { name: 'middle entry deleted', argv: [variant(dir, L, 'del', [...lines.slice(0, 2), ...lines.slice(3)])], code: 1 },
      { name: 'tail cut, head record left', argv: [variant(dir, L, 'cut', lines.slice(0, 3))], code: 1 },
      // 2026-10-05: no head record fails closed; --no-sidecar is the stated way to verify without one
      { name: 'tail cut, head record deleted', argv: [variant(dir, L, 'cut-nosc', lines.slice(0, 3), '', 'none')], code: 1 },
      { name: 'tail cut, head record deleted, --no-sidecar', argv: [variant(dir, L, 'cut-nosc2', lines.slice(0, 3), '', 'none'), '--no-sidecar'], code: 0 },
      { name: 'tail cut, --no-sidecar, --head of entry 4', argv: [variant(dir, L, 'cut-h', lines.slice(0, 3), '', 'none'), '--no-sidecar', '--head', entries[4]!.hash], code: 1 },
      { name: 'torn tail', argv: [variant(dir, L, 'torn', lines, lines[4]!.slice(0, 40))], code: 1 },
      { name: 'torn tail, --no-sidecar', argv: [variant(dir, L, 'torn-ns', lines.slice(0, 4), lines[4]!.slice(0, 80), 'none'), '--no-sidecar'], code: 1 },
    ]
    for (const c of cases) {
      const r = ledgerCli(['verify', ...c.argv], readFile)
      expect(r.code, c.name).toBe(c.code)
      const out = JSON.parse(r.out) as { ok: boolean; reason?: string; chain_ok: boolean }
      expect(out.ok, c.name).toBe(r.code === 0)
      expect(typeof out.chain_ok, c.name).toBe('boolean')
      if (r.code !== 0) expect(out.reason, c.name).toEqual(expect.any(String))
      expect(/^OK: /.test(r.err), c.name).toBe(r.code === 0)
    }
  })
})
