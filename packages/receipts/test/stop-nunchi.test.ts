/**
 * Nunchi at the "done" moment: the Stop hook's opt-in (RIPOSTE_NUNCHI=on).
 *
 * The default must not move by a byte. The golden file was captured from the PRE-CHANGE build (products/receipts/dist,
 * compiled from the Stop hook source as it stood since 2026-09-23) over 14 hook inputs × 5 option sets, 7 environments, and
 * 70 runs of the real bin (exit code, stderr, and the ledger body it wrote). These tests replay the same cases through the
 * changed source.
 *
 * With the opt-in, Nunchi changes HOW a sent-back stop is worded, never WHETHER one is sent back.
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
// plain JS, shared with the pre-change capture script (tests are not part of the tsc project)
import { FILES, INPUTS, OPTIONS, ENVS, readFixture } from './fixtures/stop-hook-cases.mjs'
import {
  AUDIENCES, DEFAULT_TIERS, NUNCHI_UNSET_TIER, SOFTENERS, STOP_SEND_BACK, factTokens, hookOptionsFromEnv, stopHook, stopReceipt,
  type Audience, type DeliveryFacts, type HookDecision, type StopHookOptions,
} from '../src/index.js'

interface BinCase { status: number; stdout: string; stderr: string; bodies: Record<string, unknown>[] }
const golden = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/stop-hook-default-golden.json', import.meta.url)), 'utf8')) as {
  stopHook: Record<string, HookDecision>; hookOptionsFromEnv: Record<string, unknown>; bin: Record<string, BinCase>
}
const inputs = INPUTS as Record<string, string>
const options = OPTIONS as Record<string, StopHookOptions>
const envs = ENVS as Record<string, Record<string, string>>
const read = readFixture as (p: string) => string
const plain = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T

describe('the default is byte-identical to the pre-change hook', () => {
  it('stopHook: every input × option set (code, stderr, result, wouldBlock, skipped)', () => {
    const keys = Object.keys(golden.stopHook)
    expect(keys).toHaveLength(Object.keys(inputs).length * Object.keys(options).length)
    for (const k of keys) {
      const [i, o] = k.split('|') as [string, string]
      expect(plain(stopHook(inputs[i]!, read, options[o]!)), k).toEqual(golden.stopHook[k])
    }
  })
  it('hookOptionsFromEnv: every environment (no nunchi key, no new problems)', () => {
    for (const [e, env] of Object.entries(envs)) expect(plain(hookOptionsFromEnv(env)), e).toEqual(golden.hookOptionsFromEnv[e])
  })
  it('the bin path (--hook --from-env): exit code, stderr, and the receipt body, for 70 recorded runs', () => {
    // the capture ran the real bin over real files; do the same here (real fs, so even the ENOENT text matches)
    const dir = mkdtempSync(join(tmpdir(), 'riposte-stop-golden-'))
    const fwd = (s: string) => s.split('\\').join('/')
    const scrub = (s: string) => s.split(fwd(dir)).join('<DIR>').split(dir).join('<DIR>')
    try {
      for (const [name, text] of Object.entries(FILES as Record<string, string>)) writeFileSync(join(dir, name), text)
      let bodies = 0
      for (const [k, g] of Object.entries(golden.bin)) {
        const [i, e] = k.split('|') as [string, string]
        let stdin = inputs[i]!
        if (stdin.startsWith('{')) { const h = JSON.parse(stdin) as Record<string, unknown>; if (typeof h.transcript_path === 'string') h.transcript_path = fwd(join(dir, h.transcript_path)); stdin = JSON.stringify(h) }
        const env = hookOptionsFromEnv(envs[e]!)
        // the bin's own logic (src/claims-cli.ts): stopHook, then the receipt when there were claims
        const d = stopHook(stdin, (p) => readFileSync(p, 'utf8'), env.opts)
        const problems = env.problems.map((p) => `riposte-claims: ${p}\n`).join('')
        expect(d.code, k).toBe(g.status)
        expect(scrub(problems + d.stderr), k).toBe(g.stderr)
        const written = d.result?.claims.length ? [JSON.parse(scrub(JSON.stringify(stopReceipt(d, env.mode, env.opts.strict === true))))] : []
        expect(written, k).toEqual(g.bodies)
        bodies += written.length
      }
      expect(bodies).toBe(41)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})

describe('RIPOSTE_NUNCHI=on: configuration', () => {
  it('reads the opt-in, the tier and the audience; unknown values are reported, never guessed', () => {
    expect(hookOptionsFromEnv({ RIPOSTE_NUNCHI: 'on' }).opts.nunchi).toEqual({ audience: 'solo' })
    expect(hookOptionsFromEnv({ RIPOSTE_NUNCHI: ' ON ', RIPOSTE_TIER: 'low', RIPOSTE_AUDIENCE: 'PR' }).opts.nunchi).toEqual({ tier: 'low', audience: 'pr' })
    for (const off of ['off', '0', 'false', 'no', '']) expect(hookOptionsFromEnv({ RIPOSTE_NUNCHI: off }), off).toMatchObject({ problems: [] })
    for (const off of ['off', '0', 'false', 'no', '']) expect(hookOptionsFromEnv({ RIPOSTE_NUNCHI: off }).opts.nunchi, off).toBeUndefined()
    const odd = hookOptionsFromEnv({ RIPOSTE_NUNCHI: 'loud' })
    expect(odd.opts.nunchi).toBeUndefined()
    expect(odd.problems).toEqual(['RIPOSTE_NUNCHI="loud" is not on or off; staying off (the default messages)'])
    const badAudience = hookOptionsFromEnv({ RIPOSTE_NUNCHI: 'on', RIPOSTE_AUDIENCE: 'board' })
    expect(badAudience.opts.nunchi).toEqual({ audience: 'solo' })
    expect(badAudience.problems[0]).toMatch(/RIPOSTE_AUDIENCE="board" is not one of solo \| pr \| auditor; using solo/)
    // tier and audience alone do nothing: the opt-in is RIPOSTE_NUNCHI
    expect(hookOptionsFromEnv({ RIPOSTE_TIER: 'low', RIPOSTE_AUDIENCE: 'pr' })).toEqual(hookOptionsFromEnv({}))
  })
})

describe('RIPOSTE_NUNCHI=on: how, never whether', () => {
  const TIERS = [...DEFAULT_TIERS, undefined, 'not-a-tier']
  const each = (fn: (k: string, def: HookDecision, on: HookDecision, ctx: { tier?: string; audience: Audience }) => void) => {
    for (const [i, input] of Object.entries(inputs)) for (const [o, opts] of Object.entries(options)) for (const tier of TIERS) for (const audience of AUDIENCES) {
      const nunchi = { ...(tier ? { tier } : {}), audience }
      fn(`${i}|${o}|${tier}|${audience}`, stopHook(input, read, opts), stopHook(input, read, { ...opts, nunchi }), { ...(tier ? { tier } : {}), audience })
    }
  }

  it('the exit code, the silence of a silent stop, and the check result are the default\'s in every register', () => {
    let sentBack = 0
    each((k, def, on) => {
      expect(on.code, k).toBe(def.code)
      expect(on.wouldBlock, k).toBe(def.wouldBlock)
      expect(on.skipped, k).toBe(def.skipped)
      expect(on.result, k).toEqual(def.result)
      expect(on.stderr === '', k).toBe(def.stderr === '')
      if (def.code === 1) expect(on.stderr, k).toBe(def.stderr) // our own failures read the same
      if (def.code === 2) sentBack++
    })
    expect(sentBack).toBeGreaterThan(0)
  })

  it('a sent-back stop is the Nunchi delivery plus the same instruction; every fact appears verbatim', () => {
    each((k, def, on) => {
      if (def.code !== 2) return
      const d = on.delivery!
      expect(d, k).toBeDefined()
      expect(on.stderr.endsWith(STOP_SEND_BACK), k).toBe(true)
      expect(on.stderr.startsWith(d.text), k).toBe(true)
      expect(d.moment).toBe('done-claim')
      expect(d.facts).toMatchObject({ source: 'claims', action: 'SURFACE', in_flow: true, outcome: def.result!.outcome })
      expect(d.timing.speak, k).toBe('now')
      for (const tok of factTokens(d.facts)) expect(on.stderr.includes(tok), `${k}: ${tok}`).toBe(true)
      // every claim the check did not support is among the delivered findings, in full (the default truncates at 120)
      for (const c of def.result!.claims) if (c.status !== 'SUPPORTED') expect(on.stderr, k).toContain(c.claim)
    })
  })

  it('the same facts and the same facts hash in every tier and audience', () => {
    const hashes = new Map<string, Set<string>>()
    each((k, def, on) => {
      if (!on.delivery) return
      const key = k.split('|').slice(0, 2).join('|') + `|${on.delivery.facts.action}|${on.delivery.facts.in_flow}`
      if (!hashes.has(key)) hashes.set(key, new Set())
      hashes.get(key)!.add(on.delivery.facts_hash)
    })
    expect(hashes.size).toBeGreaterThan(0)
    for (const [key, set] of hashes) expect(set.size, key).toBe(1)
  })

  it('the values floor: at the top tier (or unset / undeclared) the frame has no softeners; below it, tact prefixes the same statement', () => {
    const frameOf = (text: string, facts: DeliveryFacts) => {
      let t = text
      for (const tok of [...factTokens(facts)].sort((a, b) => b.length - a.length)) t = t.split(tok).join(' ')
      return t
    }
    const soft = (frame: string) => SOFTENERS.filter((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(frame))
    let floors = 0, tactful = 0
    each((k, def, on, ctx) => {
      if (def.code !== 2) return
      const d = on.delivery!
      const floor = ctx.tier === undefined || ctx.tier === 'severe' || ctx.tier === 'not-a-tier'
      expect(d.floor, k).toBe(floor)
      if (floor || ctx.audience === 'auditor') { expect(soft(frameOf(on.stderr, d.facts)), k).toEqual([]); floors++ }
      else if (ctx.tier === 'low') { expect(on.stderr, k).toMatch(/Heads-up, when you get a chance: /); tactful++ }
    })
    expect(floors).toBeGreaterThan(0)
    expect(tactful).toBeGreaterThan(0)
  })

  it('an unset tier renders as undeclared (plain words), and the default audience is the solo terminal', () => {
    const on = stopHook(inputs.red!, read, { nunchi: {} })
    expect(on.code).toBe(2)
    expect(on.delivery).toMatchObject({ audience: 'solo', floor: true, weight: 'floor', tier: { name: NUNCHI_UNSET_TIER, known: false } })
    expect(on.stderr).toMatch(/^RIPOSTE: closing claims failed a check, outcome FAIL \(1 finding\)\. Surfaced, not held\./)
    expect(on.stderr).toContain('tier unset (undeclared: treated as the top tier)')
  })

  it('silent stops stay silent; their delivery goes on the record only', () => {
    const green = stopHook(inputs.green!, read, { nunchi: { tier: 'low', audience: 'solo' } })
    expect(green).toMatchObject({ code: 0, stderr: '' })
    expect(green.delivery).toMatchObject({ timing: { speak: 'on-record' }, facts: { outcome: 'PASS', action: 'PROCEED', in_flow: false } })
    const rec = stopHook(inputs.red!, read, { recordOnly: true, nunchi: { tier: 'low' } })
    expect(rec).toMatchObject({ code: 0, stderr: '', wouldBlock: true })
    expect(rec.delivery).toMatchObject({ timing: { speak: 'on-record' }, facts: { outcome: 'FAIL', action: 'SURFACE', in_flow: false } })
    expect(stopHook(inputs.plain!, read, { nunchi: {} }).delivery).toBeUndefined() // nothing checkable, nothing to deliver
  })

  it('the receipt gains one key, tying it to the delivered facts by hash; everything else is the default body', () => {
    const def = stopHook(inputs.mixed!, read, {})
    const on = stopHook(inputs.mixed!, read, { nunchi: { tier: 'high', audience: 'pr' } })
    const a = stopReceipt(def, 'block', false)
    const b = stopReceipt(on, 'block', false)
    const { nunchi, ...rest } = b
    expect(rest).toEqual(a)
    expect(nunchi).toEqual({ delivery_version: 'nunchi-v0', facts_hash: on.delivery!.facts_hash, moment: 'done-claim', speak: 'now', weight: 'heavy', floor: false, tier: 'high', audience: 'pr' })
    expect(Object.keys(b)).toEqual([...Object.keys(a), 'nunchi'])
  })
})
