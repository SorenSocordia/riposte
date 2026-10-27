/**
 * 2026-10-03, for the host ports (Codex, Cursor, OpenCode), which could not edit receipts:
 *   1. stopDecision: the Stop decision on a session's steps, host-neutral (no round trip through the Claude transcript shape)
 *   2. stopReceipt's optional `host`, written only when given (a Claude Code receipt keeps its bytes)
 *   3. parseTestOutput no longer counts vitest's "FAIL  <file> > <test>" line as a Go failure (one failing test read "2 failing")
 */
import { describe, it, expect } from 'vitest'
import { stopHook, stopDecision, stopReceipt, stopReceiptHost, sessionFromClaudeCodeTranscript, parseTestOutput, checkClaims, type Step } from '../src/index.js'
import { FILES, INPUTS, readFixture } from './fixtures/stop-hook-cases.mjs'

describe('1. stopDecision: the same decision as stopHook, on the steps themselves', () => {
  it('on every golden stop-hook case and every mode, byte for byte', () => {
    const modes = [{}, { onlyContradicted: true }, { recordOnly: true }, { strict: true }, { nunchi: { tier: 'low' } }]
    let compared = 0
    for (const [name, input] of Object.entries(INPUTS as Record<string, string>)) {
      // the broken-input cases (not JSON, no path, a missing transcript, already sent back) never reach the decision
      let hook: { transcript_path?: string; last_assistant_message?: string; stop_hook_active?: boolean }
      try { hook = JSON.parse(input) } catch { continue }
      if (hook.stop_hook_active || !hook.transcript_path || (FILES as Record<string, string>)[hook.transcript_path] === undefined) continue
      compared++
      const steps = sessionFromClaudeCodeTranscript((FILES as Record<string, string>)[hook.transcript_path!]!)
      for (const opts of modes) {
        const viaHook = stopHook(input, readFixture, opts)
        const direct = stopDecision(steps, hook.last_assistant_message ?? null, opts)
        expect([name, JSON.stringify(direct)]).toEqual([name, JSON.stringify(viaHook)])
      }
    }
    expect(compared).toBeGreaterThanOrEqual(10)
  })

  it('a host passes its own steps: a failing run and "all tests pass" is sent back', () => {
    const steps: Step[] = [
      { kind: 'user_prompt' },
      { kind: 'tool_use', id: 't1', name: 'shell', input: { command: 'npx vitest run' } },
      { kind: 'tool_result', id: 't1', text: ' FAIL  test/a.test.ts > parser > rejects junk\n      Tests  1 failed | 3 passed (4)', isError: true },
      { kind: 'assistant_text', text: 'All tests pass.' },
    ]
    const d = stopDecision(steps, null)
    expect(d.code).toBe(2)
    expect(d.result!.claims[0]!.status).toBe('CONTRADICTED')
  })
})

describe('2. the receipt says which host stopped', () => {
  const d = stopHook((INPUTS as Record<string, string>).mixed!, readFixture, {})
  it('without a host the receipt is byte-identical to before, and reads as claude-code', () => {
    const r = stopReceipt(d, 'block', false)
    expect('host' in r).toBe(false)
    expect(Object.keys(r).slice(0, 3)).toEqual(['source', 'mode', 'strict'])
    expect(stopReceiptHost(r)).toBe('claude-code')
  })
  it('with a host it is recorded right after source, and nothing else moves', () => {
    const r = stopReceipt(d, 'block', false, 'codex')
    expect(Object.keys(r).slice(0, 4)).toEqual(['source', 'host', 'mode', 'strict'])
    expect(stopReceiptHost(r)).toBe('codex')
    const { host: _h, ...rest } = r
    expect(JSON.stringify(rest)).toBe(JSON.stringify(stopReceipt(d, 'block', false)))
  })
})

describe('3. parseTestOutput counts each failing test once', () => {
  it('vitest: one failing test is 1 failing (its FAIL line is not a Go failure)', () => {
    const out = ' FAIL  test/a.test.ts > parser > rejects junk\nAssertionError: expected 1 to be 2\n Test Files  1 failed | 2 passed (3)\n      Tests  1 failed | 3 passed (4)'
    expect(parseTestOutput(out)).toEqual({ passed: [3], failed: 1, recognised: true }) // the Tests line counts; Test Files and the FAIL line do not
    const r = parseTestOutput(' FAIL  test/a.test.ts > parser > rejects junk\n      Tests  1 failed | 3 passed (4)')
    expect(r.failed).toBe(1)
  })
  it('vitest suite errors ("FAIL  file [ file ]") are not counted either', () => {
    expect(parseTestOutput(' FAIL  test/a.test.ts [ test/a.test.ts ]\n      Tests  2 failed | 1 passed (3)').failed).toBe(2)
  })
  it('go test: each "--- FAIL:" is one; the package line counts only for a build failure', () => {
    expect(parseTestOutput('--- FAIL: TestParse (0.00s)\n    parse_test.go:12: got 1\nFAIL\nFAIL\texample.com/p\t0.012s').failed).toBe(1)
    expect(parseTestOutput('--- FAIL: TestA (0.00s)\n--- FAIL: TestB (0.00s)\nFAIL\texample.com/p\t0.02s').failed).toBe(2)
    expect(parseTestOutput('# example.com/p\n./p.go:3:1: syntax error\nFAIL\texample.com/p [build failed]').failed).toBe(1)
    expect(parseTestOutput('ok  \texample.com/p\t0.010s')).toEqual({ passed: [1], failed: 0, recognised: true })
  })
  it('the claim is still contradicted, now with the right count in its evidence', () => {
    const steps: Step[] = [
      { kind: 'tool_use', id: 't', name: 'Bash', input: { command: 'npx vitest run' } },
      { kind: 'tool_result', id: 't', text: ' FAIL  test/a.test.ts > x\n      Tests  1 failed | 9 passed (10)', isError: true },
      { kind: 'assistant_text', text: 'All tests pass.' },
    ]
    const c = checkClaims(steps).claims[0]!
    expect(c.status).toBe('CONTRADICTED')
    expect(c.reason).toContain('1 failing')
    expect(c.reason).not.toContain('2 failing')
  })
})
