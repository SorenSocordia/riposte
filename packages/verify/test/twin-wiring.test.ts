/**
 * Wiring for the structured-twin module (CREDENCE-1's src/twin/, logic untouched here): the package exports it, the
 * `verify twin` CLI verb runs it, and its verdicts are VERDICT-channel material that replays and flows through the
 * per-action notices. Synthetic inline-XBRL only.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFileSync, rmSync, existsSync } from 'node:fs'
import {
  parseInlineXbrl, parseIxNumber, decodeEntities, isUsGaap, FS_CORE_TWIN_MAP, verifyAgainstTwin, bindTwinFields, twinGate,
  twinVerdictInput, stampVerdictChannel, assertVerdict, verifyReplay, actionNotice, type TwinClaim,
} from '../src/index'
import { run, parseTwinArgs, type CliIO } from '../src/cli'

const NS = 'xmlns="http://www.w3.org/1999/xhtml" xmlns:ix="http://www.xbrl.org/2013/inlineXBRL" xmlns:us-gaap="http://fasb.org/us-gaap/2024" xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:iso4217="http://www.xbrl.org/2003/iso4217" xmlns:ixt="http://www.xbrl.org/inlineXBRL/transformation/2020-02-12"'
const CTX = '<xbrli:context id="i24"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">0000000001</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>2024-12-31</xbrli:instant></xbrli:period></xbrli:context>'
const UNIT = '<xbrli:unit id="usd"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit>'
const HTML = `<?xml version="1.0" encoding="utf-8"?><html ${NS}><head><title>10-K</title></head><body>`
  + `<div style="display:none"><ix:header><ix:resources>${CTX}${UNIT}</ix:resources></ix:header></div>`
  + '<table><tr><td>Total assets</td><td><ix:nonFraction name="us-gaap:Assets" contextRef="i24" unitRef="usd" decimals="-3" scale="3" format="ixt:num-dot-decimal">1,234,567</ix:nonFraction></td></tr></table></body></html>'
const OPTS = { periodEnd: '2024-12-31', now: () => new Date('2026-09-28T12:00:00Z') }

const files: string[] = []
function tmp(name: string, content: unknown): string {
  const p = join(tmpdir(), `verify-twin-wiring-${process.pid}-${files.length}-${name}`)
  writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content))
  files.push(p)
  return p
}
afterEach(() => { for (const f of files.splice(0)) if (existsSync(f)) rmSync(f) })
function cap(): CliIO & { out_: () => string; err_: () => string } {
  let o = '', e = ''
  return { out: s => { o += s }, err: s => { e += s }, out_: () => o, err_: () => e }
}

describe('the package exports the twin module', () => {
  it('every public twin name is reachable from the package root', () => {
    for (const f of [parseInlineXbrl, parseIxNumber, decodeEntities, isUsGaap, verifyAgainstTwin, bindTwinFields, twinGate, twinVerdictInput]) expect(typeof f).toBe('function')
    expect(FS_CORE_TWIN_MAP.fields.length).toBeGreaterThan(0)
  })
})

describe('twin verdicts are VERDICT-channel material', () => {
  const pass: TwinClaim[] = [{ id: 'a', field: 'assets', value: 1_234_567_000 }]
  const fail: TwinClaim[] = [{ id: 'a', field: 'assets', value: 1_234_000_000 }]

  it('stampVerdictChannel accepts them unchanged (same id, same bytes), and they replay against twinVerdictInput', () => {
    for (const claims of [pass, fail]) {
      const r = verifyAgainstTwin(HTML, claims, OPTS)
      expect(() => assertVerdict(r.verdict)).not.toThrow()
      const s = stampVerdictChannel(r.verdict)
      expect(s.verdict_id).toBe(r.verdict.verdict_id)
      const { channel: _c, ...rest } = s
      expect(JSON.stringify(rest)).toBe(JSON.stringify(r.verdict))
      expect(verifyReplay(r.verdict, twinVerdictInput(r.twin.sha256, claims, OPTS)).ok).toBe(true)
    }
    expect(verifyAgainstTwin(HTML, pass, OPTS).verdict.outcome).toBe('PASS')
    expect(verifyAgainstTwin(HTML, fail, OPTS).verdict.outcome).toBe('FAIL')
  })

  it('a twin FAIL flows through the per-action notice: surfaced at record, held at gate, with span evidence and a dispute path', () => {
    const v = verifyAgainstTwin(HTML, fail, OPTS).verdict
    const rec = actionNotice(v, 'record'), gate = actionNotice(v, 'gate')
    expect(rec.action).toBe('SURFACE')
    expect(gate.action).toBe('HOLD')
    const f = rec.findings[0]!
    expect(f.evidence[0]!.locator.kind).toBe('span')
    expect(f.dispute).toBe(`verify opinion --ledger <chain.jsonl> --dispute ${v.verdict_id} --claim ${f.claim_id}`)
  })
})

describe('`verify twin`', () => {
  it('PASS → exit 0 and prints {verdict, judgments, twin}; FAIL → 1; ABSTAIN → 2', () => {
    const html = tmp('primary.htm', HTML)
    const ok = cap()
    expect(run(['twin', '--html', html, '--period-end', '2024-12-31', '--claims', tmp('c.json', [{ id: 'a', field: 'assets', value: 1_234_567_000 }])], ok)).toBe(0)
    const out = JSON.parse(ok.out_())
    expect(out.verdict.outcome).toBe('PASS')
    expect(out.judgments[0]).toMatchObject({ outcome: 'PASS', reason: 'MATCH' })
    expect(out.twin.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(run(['twin', '--html', html, '--period-end', '2024-12-31', '--claims', tmp('c.json', { claims: [{ id: 'a', field: 'assets', value: 1_234_000_000 }] })], cap())).toBe(1)
    expect(run(['twin', '--html', html, '--period-end', '2024-12-31', '--claims', tmp('c.json', [{ id: 'w', field: 'widgets', value: 1 }])], cap())).toBe(2)
    expect(run(['twin', '--html', html, '--period-end', '2024-12-31', '--tolerance', '0', '--period-tolerance-days', '3', '--claims', tmp('c.json', [{ id: 'a', field: 'assets', value: 1_234_567_000 }])], cap())).toBe(0)
  })

  it('usage errors exit 3', () => {
    const html = tmp('primary.htm', HTML)
    const c = tmp('c.json', [{ id: 'a', field: 'assets', value: 1 }])
    const io = cap()
    expect(run(['twin'], io)).toBe(3)
    expect(io.err_()).toMatch(/verify twin needs --html/)
    expect(run(['twin', '--html', html, '--period-end', '12/31/2024', '--claims', c], cap())).toBe(3)
    expect(run(['twin', '--html', html, '--period-end', '2024-12-31', '--claims', c, '--tolerance', '-1'], cap())).toBe(3)
    expect(run(['twin', '--html', html, '--period-end', '2024-12-31', '--claims', tmp('bad.json', [{ id: 'a', field: 'assets', value: '1' }])], cap())).toBe(3)
    expect(run(['twin', '--html', html, '--period-end', '2024-12-31', '--claims', c, '--sheet', 'x'], cap())).toBe(3)
    expect(parseTwinArgs(['--period-tolerance-days', '7']).periodToleranceDays).toBe('7')
  })
})
