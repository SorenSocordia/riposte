import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  extractClaims, checkClaims, parseTestOutput, sessionFromClaudeCodeTranscript, turnEnds, claimsCli, auditTurns, stopHook, hookOptionsFromEnv,
  handleMcpRequest, openLedger, memoryStore, rootedJsonReader, rootedTextReader, type Step,
} from '../src/index.js'

// ── a Claude Code-shaped transcript builder ────────────────────────────────────────────────────────────────────────────
let k = 0
const ts = () => `2026-09-23T12:${String(++k % 60).padStart(2, '0')}:00Z`
const say = (text: string) => JSON.stringify({ type: 'assistant', timestamp: ts(), message: { id: `m${k}`, model: 'x', content: [{ type: 'text', text }] } })
const prompt = (text: string) => JSON.stringify({ type: 'user', timestamp: ts(), message: { role: 'user', content: text } })
function tool(name: string, input: Record<string, unknown>, out: string, isError = false): string[] {
  const id = `toolu_${++k}`
  return [
    JSON.stringify({ type: 'assistant', timestamp: ts(), message: { id: `m${k}`, model: 'x', content: [{ type: 'tool_use', id, name, input }] } }),
    JSON.stringify({ type: 'user', timestamp: ts(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: out, is_error: isError }] } }),
  ]
}
const bash = (command: string, out: string, isError = false) => tool('Bash', { command }, out, isError)
const edit = (file_path: string) => tool('Edit', { file_path, old_string: 'a', new_string: 'b' }, 'The file has been updated successfully.')
const session = (...lines: (string | string[])[]) => sessionFromClaudeCodeTranscript(lines.flat().join('\n'))
const check = (...lines: (string | string[])[]) => checkClaims(session(...lines))

const VITEST_OK = '\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m5 passed\u001b[39m\u001b[22m (5)\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m62 passed\u001b[39m\u001b[22m (62)'
const VITEST_FAIL = ' Test Files  1 failed | 4 passed (5)\n      Tests  1 failed | 61 passed (62)'

describe('claim extraction — assertive sentences only', () => {
  it('finds tests / build / commit / push / file claims, with counts and paths', () => {
    const c = extractClaims('Done. All 62 tests pass. The build is clean. Committed and pushed to main. Created `src/claims.ts` for this.')
    expect(c.map((x) => x.kind)).toEqual(['tests_pass', 'build_ok', 'committed', 'pushed', 'file_written'])
    expect(c[0]).toMatchObject({ count: 62 })
    expect(c[4]).toMatchObject({ path: 'src/claims.ts' })
    expect(extractClaims('All 1,232 engine tests pass.')[0]).toMatchObject({ count: 1232 })
  })

  it('skips hedged, negated, conditional and failed claims — it never puts words in the agent\'s mouth', () => {
    for (const s of ['Tests should pass now.', 'Not all tests pass yet.', 'If the build succeeds, we ship.', 'Nothing pushed until you say so.',
      "I haven't committed anything.", 'The tests will pass once the fix lands.', 'Tests pass except one.', 'Two tests failed and the rest pass.',
      'I tried to push but it was rejected.', 'Tests probably pass.']) {
      expect(extractClaims(s), s).toEqual([])
    }
  })

  it('commit/push idioms that are not git claims (found auditing a real session)', () => {
    for (const s of ['Week 2: compaction receipts, plus the stress test I already committed to.', 'A ledger of what the agent committed to.',
      'A Python shell tool (last pushed 2024) and a dormant package.', 'The change was pushed by the release bot.', 'Last committed in March.']) {
      expect(extractClaims(s), s).toEqual([])
    }
    expect(extractClaims('Committed and pushed to main.').map((c) => c.kind)).toEqual(['committed', 'pushed'])
  })

  it('a quotation is a mention, not a claim (found auditing a real session)', () => {
    expect(extractClaims('Next: it compares final claims ("tests pass", "pushed", "fixed") against the evidence.')).toEqual([])
    expect(extractClaims('Users kept writing “all tests pass” in their reports.')).toEqual([])
    expect(extractClaims('He said "go". All tests pass.').map((c) => c.kind)).toEqual(['tests_pass'])
  })

  it('ignores anything inside code', () => {
    expect(extractClaims('Run this:\n```bash\nnpm test  # all tests pass\ngit push\n```\nThat is the command.')).toEqual([])
  })
})

describe('test output parsing', () => {
  it('reads vitest, jest, pytest, mocha, cargo and node --test summaries (ANSI stripped; file counts ignored)', () => {
    expect(parseTestOutput(VITEST_OK)).toEqual({ passed: [62], failed: 0, recognised: true })
    expect(parseTestOutput(VITEST_FAIL)).toMatchObject({ passed: [61], failed: 1 })
    expect(parseTestOutput('Tests:       1 failed, 5 passed, 6 total')).toMatchObject({ passed: [5], failed: 1 })
    expect(parseTestOutput('========= 3 failed, 10 passed in 0.12s =========')).toMatchObject({ passed: [10], failed: 3 })
    expect(parseTestOutput('  12 passing (30ms)\n  1 failing')).toMatchObject({ passed: [12], failed: 1 })
    expect(parseTestOutput('test result: ok. 5 passed; 0 failed; 0 ignored')).toMatchObject({ passed: [5], failed: 0 })
    expect(parseTestOutput('# pass 7\n# fail 0')).toMatchObject({ passed: [7], failed: 0 })
    expect(parseTestOutput('compiling…\ndone')).toMatchObject({ recognised: false })
  })
})

describe('claims vs the session\'s tool evidence', () => {
  it('SUPPORTED: tests ran after the last code edit and passed with the claimed count', () => {
    const r = check(prompt('fix it'), edit('src/a.ts'), bash('npx vitest run', VITEST_OK), say('Fixed. All 62 tests pass.'))
    expect(r.outcome).toBe('PASS')
    expect(r.claims[0]).toMatchObject({ kind: 'tests_pass', status: 'SUPPORTED', evidence: { tool: 'Bash', command: 'npx vitest run' } })
    expect(r.claims[0]!.evidence!.excerpt).toMatch(/62 passed/)
  })

  it('UNSUPPORTED: "tests pass" with no test run in the session — the confident done with nothing behind it', () => {
    const r = check(prompt('fix it'), edit('src/a.ts'), say('Fixed it — all tests pass.'))
    expect(r.outcome).toBe('ABSTAIN')
    expect(r.claims[0]).toMatchObject({ status: 'UNSUPPORTED', reason: 'no test run anywhere in this session' })
  })

  it('UNSUPPORTED: tests passed, then code changed — the evidence is stale', () => {
    const r = check(bash('npm test', VITEST_OK), edit('src/b.ts'), say('All tests pass.'))
    expect(r.claims[0]!.status).toBe('UNSUPPORTED')
    expect(r.claims[0]!.reason).toMatch(/before a later code edit \(src\/b\.ts/)
  })

  it('a docs edit after the run does not make it stale', () => {
    expect(check(bash('npm test', VITEST_OK), edit('README.md'), say('All tests pass.')).outcome).toBe('PASS')
  })

  it('CONTRADICTED: the last run failed, or the count is wrong', () => {
    const failed = check(bash('npm test', VITEST_FAIL, true), say('All tests pass.'))
    expect(failed).toMatchObject({ outcome: 'FAIL' })
    expect(failed.claims[0]!.reason).toMatch(/1 failing/)
    const wrongCount = check(bash('npm test', VITEST_OK), say('All 70 tests pass.'))
    expect(wrongCount.claims[0]).toMatchObject({ status: 'CONTRADICTED', reason: 'claims 70, the last run shows 62 passing' })
  })

  it('only the LAST run counts: an earlier green run does not cover a later red one', () => {
    expect(check(bash('npm test', VITEST_OK), bash('npm test', VITEST_FAIL, true), say('Tests pass.')).outcome).toBe('FAIL')
    expect(check(bash('npm test', VITEST_FAIL, true), bash('npm test', VITEST_OK), say('Tests pass.')).outcome).toBe('PASS')
  })

  it('multi-suite runs: a count matching one suite or the total is supported', () => {
    const two = 'Tests  1232 passed (1232)\nTests  60 passed (60)'
    expect(check(bash('npm test', two), say('1,232 + 60 tests pass.')).outcome).toBe('PASS')
    expect(check(bash('npm test', two), say('All 1,292 tests pass.')).outcome).toBe('PASS')
  })

  it('build claims: clean, broken, or never run', () => {
    expect(check(bash('npx tsc --noEmit', ''), say('The typecheck is clean.')).outcome).toBe('PASS')
    expect(check(bash('npx tsc --noEmit', "src/a.ts(3,1): error TS2322: Type 'string' is not assignable", true), say('The build is clean.')).outcome).toBe('FAIL')
    expect(check(say('The build is clean.')).claims[0]!.status).toBe('UNSUPPORTED')
  })

  it('git: committed / pushed need a successful command; "nothing to commit" and rejected pushes contradict', () => {
    expect(check(bash('git commit -m x', '[main 20ee033] x\n 3 files changed'), bash('git push origin main', 'To github.com:o/r.git\n   cf41d0d..20ee033  main -> main'), say('Committed and pushed.')).outcome).toBe('PASS')
    expect(check(bash('git commit -m x', 'nothing to commit, working tree clean'), say('Committed.')).claims[0]!.status).toBe('CONTRADICTED')
    expect(check(bash('git push', ' ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs')).outcome).toBe('ABSTAIN') // no claim made
    expect(check(bash('git push', ' ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs'), say('Pushed.')).outcome).toBe('FAIL')
    expect(check(say('Pushed to main.')).claims[0]).toMatchObject({ status: 'UNSUPPORTED', reason: 'no git push ran in this session' })
  })

  it('files: created by an edit tool or a shell redirect; otherwise unsupported', () => {
    expect(check(tool('Write', { file_path: 'C:\\repo\\src\\claims.ts', content: 'x' }, 'File created successfully'), say('Created `src/claims.ts`.')).outcome).toBe('PASS')
    expect(check(bash("cat > notes/plan.md <<'EOF'\nx\nEOF", ''), say('Wrote `notes/plan.md`.')).outcome).toBe('PASS')
    expect(check(say('Created `src/ghost.ts`.')).claims[0]!.status).toBe('UNSUPPORTED')
  })

  it('evidence is only what came BEFORE the final message', () => {
    const steps: Step[] = session(say('All tests pass.'), bash('npm test', VITEST_OK))
    const firstText = steps.findIndex((s) => s.kind === 'assistant_text')
    expect(checkClaims(steps, firstText).claims[0]!.status).toBe('UNSUPPORTED')
  })

  it('a message with no checkable claims ABSTAINs (nothing verified is not the same as verified)', () => {
    expect(check(say('Here is my plan for tomorrow.')).reasons[0]).toMatch(/no checkable completion claims/)
  })

  it('turn ends: the last assistant text before each user prompt', () => {
    const steps = session(prompt('a'), say('one'), bash('npm test', VITEST_OK), say('two'), prompt('b'), say('three'))
    const ends = turnEnds(steps)
    expect(ends.map((i) => (steps[i] as { text: string }).text)).toEqual(['two', 'three'])
  })

  it('tool results and slash-command records are not user prompts', () => {
    const steps = session(prompt('go'), bash('ls', 'a b'), JSON.stringify({ type: 'user', message: { content: '<command-name>/model</command-name>' } }), say('ok'))
    expect(steps.filter((s) => s.kind === 'user_prompt')).toHaveLength(1)
  })
})

describe('riposte-claims CLI and the MCP check_claims tool', () => {
  const t = (...lines: (string | string[])[]) => lines.flat().join('\n') + '\n'
  const files: Record<string, string> = {
    'good.jsonl': t(prompt('go'), bash('npm test', VITEST_OK), say('All 62 tests pass.')),
    'bad.jsonl': t(prompt('go'), bash('npm test', VITEST_FAIL, true), say('All tests pass.')),
    'bare.jsonl': t(prompt('go'), say('Fixed — all tests pass.')),
    'multi.jsonl': t(prompt('a'), bash('npm test', VITEST_OK), say('All 62 tests pass.'), prompt('b'), say('Pushed.'), prompt('c'), say('Here is a plan.')),
  }
  const read = (p: string) => { const f = files[p]; if (f === undefined) throw new Error('ENOENT'); return f }

  it('exit 0 PASS · 1 FAIL · 2 ABSTAIN · 3 usage; hook JSON on stdin works', () => {
    expect(claimsCli(['good.jsonl'], read).code).toBe(0)
    expect(claimsCli(['bad.jsonl'], read).code).toBe(1)
    expect(claimsCli(['bare.jsonl'], read).code).toBe(2)
    expect(claimsCli(['--nope'], read).code).toBe(3)
    expect(claimsCli([], read, JSON.stringify({ transcript_path: 'bad.jsonl', hook_event_name: 'Stop' })).code).toBe(1)
  })

  it('--all-turns audits every turn: claims counted, unbacked ones listed, worst outcome wins', () => {
    const r = claimsCli(['multi.jsonl', '--all-turns'], read)
    const a = JSON.parse(r.out)
    expect(a).toMatchObject({ turns: 3, turns_with_claims: 2, claims: { SUPPORTED: 1, CONTRADICTED: 0, UNSUPPORTED: 1 } })
    expect(a.flagged[0]).toMatchObject({ kind: 'pushed', status: 'UNSUPPORTED' })
    expect(r.code).toBe(2)
    expect(auditTurns(files['good.jsonl']!).outcomes.PASS).toBe(1)
  })

  it('MCP check_claims: reads under the root only, writes a receipt', () => {
    const root = mkdtempSync(join(tmpdir(), 'receipts-claims-'))
    writeFileSync(join(root, 's.jsonl'), files['bad.jsonl']!)
    const ledger = openLedger(memoryStore(), { now: () => new Date('2026-09-23T00:00:00Z') })
    const deps = { ledger, read: rootedJsonReader(root), readText: rootedTextReader(root) }
    const call = (args: unknown) => (handleMcpRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'check_claims', arguments: args } }, deps) as { result: { structuredContent: Record<string, unknown>; isError: boolean } }).result
    expect(call({ transcript: 's.jsonl' }).structuredContent).toMatchObject({ outcome: 'FAIL', receipt: { seq: 0 } })
    expect(call({ transcript: 's.jsonl', all_turns: true }).structuredContent).toMatchObject({ outcomes: { FAIL: 1 } })
    expect(call({ transcript: '../x.jsonl' }).isError).toBe(true)
    expect(ledger.entries().map((e) => e.kind)).toEqual(['claims_check', 'claims_check'])
    expect(ledger.verify()).toMatchObject({ ok: true })
  })
})

describe('Stop hook (--hook)', () => {
  const t = (...lines: (string | string[])[]) => lines.flat().join('\n') + '\n'
  const files: Record<string, string> = {
    'red.jsonl': t(prompt('go'), bash('npm test', VITEST_FAIL, true), say('All tests pass.')),
    'green.jsonl': t(prompt('go'), bash('npm test', VITEST_OK), say('All 62 tests pass.')),
    'bare.jsonl': t(prompt('go'), edit('src/a.ts'), say('Fixed — all tests pass.')),
    'plain.jsonl': t(prompt('go'), say('Here is the plan.')),
    'lagging.jsonl': t(prompt('go'), bash('npm test', VITEST_OK)), // final message not flushed to the transcript yet
  }
  const read = (p: string) => { const f = files[p]; if (f === undefined) throw new Error('ENOENT'); return f }
  const hook = (transcript_path: string, extra: Record<string, unknown> = {}) => JSON.stringify({ hook_event_name: 'Stop', session_id: 's', transcript_path, stop_hook_active: false, ...extra })

  it('sends a contradicted "done" back (exit 2) with the claim, the reason and the evidence', () => {
    const d = stopHook(hook('red.jsonl'), read)
    expect(d.code).toBe(2)
    expect(d.stderr).toMatch(/"All tests pass\." — CONTRADICTED: the last test run reports 1 failing \[npm test/)
    expect(d.stderr).toMatch(/Run the check now and report what it actually shows, or correct the claim/)
  })

  it('an unbacked claim is sent back too, unless --only-contradicted', () => {
    expect(stopHook(hook('bare.jsonl'), read).code).toBe(2)
    expect(stopHook(hook('bare.jsonl'), read, { onlyContradicted: true }).code).toBe(0)
  })

  it('lets the agent stop when the claims are backed, or when there is nothing to check', () => {
    expect(stopHook(hook('green.jsonl'), read)).toMatchObject({ code: 0, stderr: '' })
    expect(stopHook(hook('plain.jsonl'), read).code).toBe(0)
  })

  it('never bounces twice: a stop that was already sent back once goes through', () => {
    expect(stopHook(hook('red.jsonl', { stop_hook_active: true }), read)).toMatchObject({ code: 0, skipped: expect.any(String) })
  })

  it('uses last_assistant_message when the transcript lags; evidence is the whole transcript', () => {
    expect(stopHook(hook('lagging.jsonl', { last_assistant_message: 'All 62 tests pass.' }), read).code).toBe(0)
    expect(stopHook(hook('lagging.jsonl', { last_assistant_message: 'All 99 tests pass.' }), read).code).toBe(2)
    // when the message IS in the transcript, evidence stops where it starts
    expect(stopHook(hook('red.jsonl', { last_assistant_message: 'All tests pass.' }), read).code).toBe(2)
  })

  it('our own failures never hold the agent hostage (exit 1, non-blocking)', () => {
    expect(stopHook('not json', read).code).toBe(1)
    expect(stopHook(JSON.stringify({ hook_event_name: 'Stop' }), read).code).toBe(1)
    expect(stopHook(hook('missing.jsonl'), read).code).toBe(1)
  })

  it('--record-only never sends anything back and never fails — it only records what it would have done', () => {
    expect(stopHook(hook('red.jsonl'), read, { recordOnly: true })).toMatchObject({ code: 0, stderr: '', wouldBlock: true, result: { outcome: 'FAIL' } })
    expect(stopHook(hook('green.jsonl'), read, { recordOnly: true })).toMatchObject({ code: 0, wouldBlock: false })
    expect(stopHook('not json', read, { recordOnly: true }).code).toBe(0)
    expect(stopHook(hook('missing.jsonl'), read, { recordOnly: true }).code).toBe(0)
    expect(claimsCli(['--hook', '--record-only'], read, hook('red.jsonl'))).toMatchObject({ code: 0, err: '' })
  })

  it('claimsCli routes --hook the same way', () => {
    expect(claimsCli(['--hook'], read, hook('red.jsonl')).code).toBe(2)
    expect(claimsCli(['--hook', '--only-contradicted'], read, hook('bare.jsonl')).code).toBe(0)
  })
})

describe('--strict: "done" means tested', () => {
  const strict = { strict: true }
  const checkS = (...lines: (string | string[])[]) => checkClaims(session(...lines), undefined, strict)

  it('off by default: completion words are not claims unless strict', () => {
    expect(extractClaims('Fixed the bug in the parser.')).toEqual([])
    expect(extractClaims('Fixed the bug in the parser.', strict).map((c) => c.kind)).toEqual(['completed'])
  })

  it('recognises assertive completions, skips hedges and reports about others', () => {
    for (const s of ['Done.', 'Done — the parser handles CRLF now.', 'I fixed the off-by-one.', 'Implemented the retry logic.', 'The issue is resolved.', "Everything's working now.", 'It works now.'])
      expect(extractClaims(s, strict).some((c) => c.kind === 'completed'), s).toBe(true)
    for (const s of ['It should be fixed now.', 'This might be done.', 'Fixed by the maintainers upstream.', 'Once this is resolved we can ship.', 'Not done yet.'])
      expect(extractClaims(s, strict).some((c) => c.kind === 'completed'), s).toBe(false)
  })

  it('someone else\'s completion, or a future one, is not the agent\'s claim (found auditing a real session)', () => {
    for (const s of ['I can see a fuzzer that caught real bugs that you then fixed.', "That's about 2.5 GB, and I'll be notified when it's done."])
      expect(extractClaims(s, strict).some((c) => c.kind === 'completed'), s).toBe(false)
    for (const s of ['- **Caught and fixed a real shipping bug.**', 'We have implemented the retry logic.'])
      expect(extractClaims(s, strict).some((c) => c.kind === 'completed'), s).toBe(true)
  })

  it('SUPPORTED only with a passing test run after the last code edit', () => {
    expect(checkS(edit('src/a.ts'), bash('npm test', VITEST_OK), say('Fixed.')).outcome).toBe('PASS')
    const noRun = checkS(edit('src/a.ts'), say('Fixed.'))
    expect(noRun.claims[0]).toMatchObject({ kind: 'completed', status: 'UNSUPPORTED', reason: expect.stringMatching(/no test ran in this session/) })
    expect(checkS(bash('npm test', VITEST_OK), edit('src/a.ts'), say('Done.')).claims[0]!.reason).toMatch(/before a later code edit/)
    expect(checkS(edit('src/a.ts'), bash('npm test', VITEST_FAIL, true), say('Implemented it.')).claims[0]).toMatchObject({ status: 'CONTRADICTED', reason: expect.stringMatching(/1 failing/) })
  })

  it('the strict hook sends a bare "Fixed." back; the default hook lets it through', () => {
    const files: Record<string, string> = { 'fix.jsonl': [prompt('go'), ...edit('src/a.ts'), say('Fixed.')].join('\n') }
    const read = (p: string) => files[p]!
    const input = JSON.stringify({ hook_event_name: 'Stop', transcript_path: 'fix.jsonl', stop_hook_active: false })
    expect(stopHook(input, read, { strict: true }).code).toBe(2)
    expect(stopHook(input, read).code).toBe(0)
    expect(claimsCli(['--hook', '--strict'], read, input).code).toBe(2)
  })
})

describe('plugin configuration from the environment (--from-env)', () => {
  it('defaults to record-only: an install measures before it ever enforces', () => {
    expect(hookOptionsFromEnv({})).toMatchObject({ mode: 'record-only', opts: { recordOnly: true, onlyContradicted: false, strict: false }, problems: [] })
  })
  it('reads mode, strict and ledger', () => {
    expect(hookOptionsFromEnv({ RIPOSTE_HOOK_MODE: 'block', RIPOSTE_STRICT: '1', RIPOSTE_LEDGER: ' /x/r.jsonl ' })).toMatchObject({ mode: 'block', opts: { recordOnly: false, onlyContradicted: false, strict: true }, ledger: '/x/r.jsonl' })
    expect(hookOptionsFromEnv({ RIPOSTE_HOOK_MODE: 'Only-Contradicted' }).opts).toMatchObject({ onlyContradicted: true, recordOnly: false })
  })
  it('an unrecognised mode falls back to the safe one and says so — never guessed', () => {
    const r = hookOptionsFromEnv({ RIPOSTE_HOOK_MODE: 'blok' })
    expect(r.mode).toBe('record-only')
    expect(r.problems[0]).toMatch(/is not one of record-only \| only-contradicted \| block; using record-only/)
  })
})
