// The built host bins as real processes (npm run build → bin/riposte-codex.mjs, bin/riposte-cursor.mjs,
// bin/riposte-opencode.js). Skipped when they have not been built. Every spawn gets a scratch home (the default ledger is
// ~/.riposte/receipts.jsonl) and none of this shell's RIPOSTE_* / RECEIPTS_* variables.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { fixture, fixtureJson, readEntries, scratch, verifyLedger } from './hosts-helpers.js'

const bin = (f: string) => fileURLToPath(new URL(`../bin/${f}`, import.meta.url))
const built = ['riposte-codex.mjs', 'riposte-cursor.mjs', 'riposte-opencode.js'].every((f) => existsSync(bin(f)))
const s = scratch()
afterAll(() => s.done())

let n = 0
function home() {
  const h = s.path(`home${++n}`)
  const env: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => v !== undefined && !k.startsWith('RIPOSTE_') && !k.startsWith('RECEIPTS_'))) as Record<string, string>
  return { h, ledger: join(h, '.riposte', 'receipts.jsonl'), env: { ...env, HOME: h, USERPROFILE: h } }
}
const spawn = (file: string, input: string, env: Record<string, string>) =>
  spawnSync(process.execPath, [bin(file), '--hook'], { input, env, encoding: 'utf8', timeout: 30_000, windowsHide: true })

describe.skipIf(!built)('built host bins', () => {
  it('riposte-codex: record-only by default, exit 2 once in block mode, fail open on bad input', () => {
    const { ledger, env } = home()
    const t = s.path(`rollout${n}.jsonl`)
    writeFileSync(t, fixture('codex/planted-failing.rollout.jsonl'))
    const hook = { ...JSON.parse(fixture('codex/stop.template.json')), transcript_path: t, last_assistant_message: 'Fixed the date parser. All tests pass.' }
    const quiet = spawn('riposte-codex.mjs', JSON.stringify(hook), env)
    expect([quiet.status, quiet.stdout, quiet.stderr]).toEqual([0, '', ''])
    const bounce = spawn('riposte-codex.mjs', JSON.stringify(hook), { ...env, RIPOSTE_HOOK_MODE: 'block' })
    expect(bounce.status).toBe(2)
    expect(bounce.stdout).toBe('')
    expect(bounce.stderr).toMatch(/^Before you finish:/)
    const continued = spawn('riposte-codex.mjs', JSON.stringify({ ...hook, stop_hook_active: true }), { ...env, RIPOSTE_HOOK_MODE: 'block' })
    expect(continued.status).toBe(0)
    expect(readEntries(ledger).map((e) => [e.body.mode, e.body.would_block, e.body.blocked])).toEqual([['record-only', true, false], ['block', true, true]])
    expect(readEntries(ledger).map((e) => e.body.host)).toEqual(['codex', 'codex'])
    expect(verifyLedger(ledger).code).toBe(0)
    expect(spawn('riposte-codex.mjs', 'garbage', env).status).toBe(0)
    expect(spawn('riposte-codex.mjs', 'garbage', { ...env, RIPOSTE_HOOK_MODE: 'block' }).status).toBe(1)
  })

  it('riposte-cursor: journals each event, answers JSON, sends back once in block mode', () => {
    const { h, ledger, env } = home()
    const events = fixtureJson<Record<string, unknown>[]>('cursor/planted-failing.events.json')
    const outs = events.map((e) => spawn('riposte-cursor.mjs', JSON.stringify(e), { ...env, RIPOSTE_HOOK_MODE: 'block' }))
    for (const o of outs) { expect(o.status).toBe(0); expect(() => JSON.parse(o.stdout)).not.toThrow() }
    expect(JSON.parse(outs.at(-1)!.stdout).followup_message).toMatch(/^Before you finish:/)
    expect(existsSync(join(h, '.riposte', 'cursor-journal', 'conv-c4-0001.jsonl'))).toBe(true)
    const after = fixtureJson<Record<string, unknown>[]>('cursor/after-sendback.events.json').map((e) => spawn('riposte-cursor.mjs', JSON.stringify(e), { ...env, RIPOSTE_HOOK_MODE: 'block' }))
    expect(after.at(-1)!.stdout.trim()).toBe('{}')
    expect(readEntries(ledger)).toHaveLength(1)
    expect(readEntries(ledger)[0]!.body.host).toBe('cursor')
    expect(verifyLedger(ledger).code).toBe(0)
    const bad = spawn('riposte-cursor.mjs', 'garbage', env)
    expect([bad.status, bad.stdout.trim()]).toEqual([0, '{}'])
  })

  it('riposte-opencode.js: one export; checks on session.idle and records, record-only by default', async () => {
    const mod = await import(pathToFileURL(bin('riposte-opencode.js')).href)
    expect(Object.keys(mod)).toEqual(['RipostePlugin'])
    const ledger = s.path('oc-bin.jsonl')
    const saved = { RIPOSTE_LEDGER: process.env.RIPOSTE_LEDGER, RIPOSTE_HOOK_MODE: process.env.RIPOSTE_HOOK_MODE }
    process.env.RIPOSTE_LEDGER = ledger
    delete process.env.RIPOSTE_HOOK_MODE
    try {
      const prompts: unknown[] = []
      const hooks = await mod.RipostePlugin({ client: { session: { messages: async () => ({ data: fixtureJson('opencode/planted-failing.messages.json') }), promptAsync: async (o: unknown) => { prompts.push(o) } } } })
      await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 'ses_c4' } } })
      expect(prompts).toEqual([])
      expect(readEntries(ledger)[0]!.body).toMatchObject({ mode: 'record-only', would_block: true, blocked: false })
      expect(readEntries(ledger)[0]!.body.host).toBe('opencode')
      expect(readFileSync(ledger, 'utf8').split('\n').filter(Boolean)).toHaveLength(1)
    } finally {
      for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v
    }
  })
})
