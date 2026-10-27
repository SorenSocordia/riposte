// `verify ap --ruleset` on the emailed-bill (text) path: the flag was parsed and never passed on before 2026-10-20, so asking for
// ap-threeway@0.4.0 silently ran 0.3.0 (found by the lane that built 0.4.0; fixed by the lead). The reader's bill r9-t02 approves
// under the default and goes to a person under 0.4.0, so the two runs must differ, and each must name the ruleset it ran.
import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const HERE = join(__dirname)
const CLI = join(HERE, '..', 'dist', 'cli.js')
const BILL = join(HERE, 'fixtures', 'ap-r10', 'r9-t02-bec-reply-confirm.txt')
const HIST = join(HERE, 'fixtures', 'ap-r10', 'r9-history.json')
const run = (...extra: string[]) => {
  const r = spawnSync(process.execPath, [CLI, 'ap', BILL, '--history', HIST, ...extra], { encoding: 'utf8' })
  const j = JSON.parse(r.stdout) as { decision: string; ruleset?: { id: string; version: string }; verdict?: { ruleset?: { id: string; version: string } } }
  return { code: r.status, out: { decision: j.decision, ruleset: j.verdict?.ruleset ?? j.ruleset } }
}

describe('verify ap --ruleset on the text path', () => {
  it('a bill that names no ruleset is checked under the default (0.3.0 under this engine)', () => {
    const r = run()
    expect(r.out.ruleset).toEqual({ id: 'ap-threeway', version: '0.3.0', domain: 'accounts-payable' })
    expect(r.out.decision).toBe('approve')
    expect(r.code).toBe(0)
  })
  it('--ruleset ap-threeway@0.4.0 is passed on: the same bill goes to a person, the ruleset named', () => {
    const r = run('--ruleset', 'ap-threeway@0.4.0')
    expect(r.out.ruleset).toEqual({ id: 'ap-threeway', version: '0.4.0', domain: 'accounts-payable' })
    expect(r.out.decision).not.toBe('approve')
  })
  it('a ruleset version this engine does not carry is refused as a usage error (exit 3), not run as the default', () => {
    const r = spawnSync(process.execPath, [CLI, 'ap', BILL, '--history', HIST, '--ruleset', 'ap-threeway@9.9.9'], { encoding: 'utf8' })
    expect(r.status).toBe(3)
  })
})
