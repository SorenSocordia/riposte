/**
 * Done-claims — an agent's closing words ("all tests pass", "pushed", "build is clean") checked against what its own tools
 * actually returned in the session.
 *
 * The season's most-cited agent failure is a confident "done" with nothing behind it. `checkDone` (./done.ts) checks claims
 * about STATE the agent states explicitly. This checks the claims it makes in PROSE at the end of a turn, against the tool
 * evidence in its transcript. It is built to run as a Stop hook.
 *
 * Per claim:
 *   SUPPORTED     the session's latest relevant tool result backs it (and no code was edited after that result)
 *   CONTRADICTED  the latest relevant result says otherwise (a failed test run, a rejected push, a different count)
 *   UNSUPPORTED   nothing in the session backs it: the check never ran, ran before the last code edit, or couldn't be read
 * Over the message: FAIL if anything is contradicted; ABSTAIN if something is unsupported (or there is nothing checkable);
 * PASS only if every claim found is supported.
 *
 * Conservative by design. Only assertive sentences are read. A sentence that hedges, negates or conditions ("should pass",
 * "not all tests pass", "if the build succeeds") is skipped, as is text inside code. That means it misses some claims, but it
 * doesn't put words in the agent's mouth. English only (the claim patterns are English; the evidence parsers are not).
 * Deterministic; no I/O.
 */

export type ClaimKind = 'tests_pass' | 'build_ok' | 'committed' | 'pushed' | 'file_written'
export type ClaimStatus = 'SUPPORTED' | 'CONTRADICTED' | 'UNSUPPORTED'

export interface ExtractedClaim { kind: ClaimKind; claim: string; count?: number; path?: string }

export interface Evidence { tool: string; command?: string; excerpt: string; at?: string; tool_use_id?: string }

export interface ClaimCheck extends ExtractedClaim { status: ClaimStatus; reason: string; evidence?: Evidence }

export interface ClaimsResult {
  outcome: 'PASS' | 'FAIL' | 'ABSTAIN'
  claims: ClaimCheck[]
  final_message_at?: string
  reasons: string[]
}

/** One step of a session, in order. Hosts adapt their transcripts into this (see sessionFromClaudeCodeTranscript). */
export type Step =
  | { kind: 'tool_use'; id: string; name: string; input: Record<string, unknown>; at?: string }
  | { kind: 'tool_result'; id: string; text: string; isError: boolean; at?: string }
  | { kind: 'assistant_text'; text: string; message_id?: string; at?: string }
  | { kind: 'user_prompt'; at?: string }

// ── claim extraction ────────────────────────────────────────────────────────────────────────────────────────────────────

const HEDGE = /\b(?:not|never|no longer|nothing|none|neither|nor|without|isn't|aren't|wasn't|weren't|doesn't|don't|didn't|won't|can't|cannot|haven't|hasn't|hadn't|fail(?:s|ed|ing|ure)?|except|should|would|will|might|may|could|expect(?:s|ed)?|if|unless|until|once|whether|hopefully|probably|likely|try|trying|tried|attempt(?:s|ed)?|want|need)\b/i
const NUM = String.raw`(\d{1,3}(?:,\d{3})+|\d+)`
const PATTERNS: { kind: ClaimKind; re: RegExp }[] = [
  { kind: 'tests_pass', re: new RegExp(String.raw`\b(?:all\s+)?(?:${NUM}\s+(?:[a-z-]+\s+){0,2})?tests?\s+(?:(?:all|now|still)\s+)?(?:pass(?:es|ed|ing)?\b|(?:are|is)\s+(?:all\s+)?(?:passing|green)\b)|\btests?\s+(?:are\s+)?(?:all\s+)?green\b|\btest\s+suite\s+pass(?:es|ed)?\b`, 'i') },
  { kind: 'build_ok', re: /\b(?:the\s+)?(?:build|compil(?:e|es|ation)|type-?check(?:s|ing)?|tsc)\b(?:\s+(?:is|was|now|all|still))*\s+(?:succeed(?:s|ed)?|pass(?:es|ed)?|clean(?:ly)?|green)\b|\bbuilds?\s+(?:cleanly|clean|successfully|fine)\b|\bno\s+type\s+errors\b/i },
  // not "committed to" (a pledge), "last committed" / "last pushed 2024" (a report about something else), or "… by" (someone else)
  { kind: 'committed', re: /\b(?<!last\s)committed\b(?!\s+(?:to|by)\b)|\bmade\s+(?:a|the)\s+commit\b/i },
  { kind: 'pushed', re: /\b(?<!last\s)pushed\b(?!\s+(?:back|by)\b)/i },
  { kind: 'file_written', re: /\b(?:created|wrote|added|saved)\s+`([^`\s]+\.[A-Za-z0-9]{1,8})`/i },
]

/**
 * Text that is the agent's own assertion: fenced code removed, and short double-quoted spans removed. A quotation is a
 * mention, not a claim ('it checks claims like "tests pass"'). Inline code stays here and is ignored only by the hedge test,
 * because it carries the file_written path.
 */
function prose(text: string): string {
  return text.replace(/```[\s\S]*?```/g, ' ').replace(/~~~[\s\S]*?~~~/g, ' ').replace(/"[^"\n]{1,160}"/g, ' ').replace(/“[^”\n]{1,160}”/g, ' ')
}

function sentences(text: string): string[] {
  return prose(text).split(/\n+|(?<=[.!?])\s+(?=[A-Z*_(`"'])/).map((s) => s.trim()).filter(Boolean)
}

const toInt = (s: string | undefined): number | undefined => (s === undefined ? undefined : Number(s.replace(/,/g, '')))

export function extractClaims(text: string): ExtractedClaim[] {
  const out: ExtractedClaim[] = []
  for (const s of sentences(text)) {
    if (HEDGE.test(s.replace(/`[^`]*`/g, ' '))) continue
    for (const { kind, re } of PATTERNS) {
      const m = s.match(re)
      if (!m) continue
      const claim = s.length > 200 ? `${s.slice(0, 197)}…` : s
      if (kind === 'tests_pass') { const n = toInt(m[1]); out.push(n === undefined ? { kind, claim } : { kind, claim, count: n }) }
      else if (kind === 'file_written') out.push({ kind, claim, path: m[1]! })
      else out.push({ kind, claim })
    }
  }
  return out
}

// ── evidence ────────────────────────────────────────────────────────────────────────────────────────────────────────────

const SHELL = /^(?:bash|shell|run_command|execute_command|terminal|exec)$/i
const EDIT_TOOLS = /^(?:edit|write|multiedit|notebookedit|str_replace_based_edit_tool|apply_patch)$/i
const DOC_FILE = /\.(?:md|mdx|txt|rst)$/i
const TEST_CMD = /\b(?:vitest|jest|mocha|pytest|py\.test|phpunit|rspec|ava|tap)\b|\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|\b(?:go|cargo|dotnet|mix|deno)\s+test\b|\bnode\s+--test\b/i
const BUILD_CMD = /\btsc(?:\.cmd)?\b|\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:build|typecheck)\b|\b(?:cargo|go|dotnet)\s+build\b|\bmake\b|\b(?:gradle|mvn|webpack)\b|\b(?:vite|next)\s+build\b/i
const COMMIT_CMD = /\bgit\s+(?:-[^\s]+\s+(?:[^\s-][^\s]*\s+)?)*commit\b/i
const PUSH_CMD = /\bgit\s+(?:-[^\s]+\s+(?:[^\s-][^\s]*\s+)?)*push\b/i
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g

interface Run { use: Extract<Step, { kind: 'tool_use' }>; result?: Extract<Step, { kind: 'tool_result' }>; index: number }

function shellRuns(steps: Step[], upTo: number, cmd: RegExp): Run[] {
  const results = new Map<string, Extract<Step, { kind: 'tool_result' }>>()
  for (let i = 0; i < upTo; i++) { const s = steps[i]!; if (s.kind === 'tool_result') results.set(s.id, s) }
  const runs: Run[] = []
  for (let i = 0; i < upTo; i++) {
    const s = steps[i]!
    if (s.kind !== 'tool_use' || !SHELL.test(s.name) || typeof s.input.command !== 'string' || !cmd.test(s.input.command)) continue
    const result = results.get(s.id)
    runs.push(result ? { use: s, result, index: i } : { use: s, index: i })
  }
  return runs
}

/** The last non-doc file edit before `upTo`, if it came after step `after`. */
function editAfter(steps: Step[], after: number, upTo: number): { path: string; at?: string } | null {
  for (let i = upTo - 1; i > after; i--) {
    const s = steps[i]!
    if (s.kind !== 'tool_use' || !EDIT_TOOLS.test(s.name)) continue
    const p = String(s.input.file_path ?? s.input.path ?? s.input.notebook_path ?? '')
    if (p && DOC_FILE.test(p)) continue
    return { path: p || '(unknown file)', ...(s.at ? { at: s.at } : {}) }
  }
  return null
}

const excerpt = (text: string, re?: RegExp): string => {
  const clean = text.replace(ANSI, '')
  const lines = clean.split('\n').map((l) => l.trim()).filter(Boolean)
  const hit = re ? lines.filter((l) => re.test(l)) : []
  const pick = (hit.length ? hit : lines.slice(-3)).slice(-3).join(' ⏎ ')
  return pick.length > 240 ? `${pick.slice(0, 237)}…` : pick
}

const evidenceOf = (r: Run, re?: RegExp): Evidence => ({
  tool: r.use.name, command: String(r.use.input.command).slice(0, 200), excerpt: r.result ? excerpt(r.result.text, re) : '(no result recorded)',
  ...(r.result?.at ?? r.use.at ? { at: (r.result?.at ?? r.use.at)! } : {}), tool_use_id: r.use.id,
})

/** Test-runner summaries: vitest/jest/pytest/mocha/cargo/node --test/go. Returns passed/failed per summary line found. */
export function parseTestOutput(raw: string): { passed: number[]; failed: number; recognised: boolean } {
  const text = raw.replace(ANSI, '')
  const passed: number[] = []
  let failed = 0
  let recognised = false
  for (const line of text.split('\n')) {
    const l = line.trim()
    // vitest "Tests  1 failed | 19 passed (20)" · jest "Tests: 1 failed, 5 passed, 6 total" · pytest "3 failed, 10 passed in 0.1s"
    // cargo "test result: ok. 5 passed; 0 failed" · mocha "12 passing" / "1 failing" · node --test "# pass 5" / "# fail 0"
    if (/^(?:Tests:?\s|test result:|=+\s|# (?:pass|fail)\b|\d+\s+(?:passed|failed|passing|failing)\b)/i.test(l) || /\b\d+\s+(?:passed|failed)\b.*\bin\s+[\d.]+s\b/.test(l)) {
      const p = l.match(/(\d[\d,]*)\s+(?:passed|passing)\b/i) ?? l.match(/^# pass\s+(\d+)/i)
      const f = l.match(/(\d[\d,]*)\s+(?:failed|failing)\b/i) ?? l.match(/^# fail\s+(\d+)/i)
      if (p || f) recognised = true
      if (p) passed.push(Number(p[1]!.replace(/,/g, '')))
      if (f) failed += Number(f[1]!.replace(/,/g, ''))
    }
    if (/^--- FAIL\b|^FAIL\s+\S/.test(l)) { recognised = true; failed += 1 } // go test
    if (/^ok\s+\S+\s+[\d.]+s/.test(l)) { recognised = true; passed.push(1) } // go test package
  }
  return { passed, failed, recognised }
}

function checkOne(c: ExtractedClaim, steps: Step[], upTo: number): ClaimCheck {
  const stale = (r: Run) => editAfter(steps, r.result ? steps.indexOf(r.result) : r.index, upTo)
  const unsupported = (reason: string, evidence?: Evidence): ClaimCheck => ({ ...c, status: 'UNSUPPORTED', reason, ...(evidence ? { evidence } : {}) })

  if (c.kind === 'tests_pass' || c.kind === 'build_ok') {
    const isTests = c.kind === 'tests_pass'
    const runs = shellRuns(steps, upTo, isTests ? TEST_CMD : BUILD_CMD)
    const last = runs[runs.length - 1]
    if (!last) return unsupported(isTests ? 'no test run anywhere in this session' : 'no build or typecheck ran in this session')
    if (!last.result) return unsupported('the last run has no recorded result', evidenceOf(last))
    const edited = stale(last)
    if (edited) return unsupported(`${isTests ? 'tests' : 'the build'} last ran before a later code edit (${edited.path}${edited.at ? ` at ${edited.at}` : ''})`, evidenceOf(last))
    if (isTests) {
      const t = parseTestOutput(last.result.text)
      const ev = evidenceOf(last, /passed|failed|passing|failing|test result|# (?:pass|fail)|^ok\s|FAIL/i)
      if (t.failed > 0) return { ...c, status: 'CONTRADICTED', reason: `the last test run reports ${t.failed} failing`, evidence: ev }
      if (last.result.isError) return { ...c, status: 'CONTRADICTED', reason: 'the last test run exited with an error', evidence: ev }
      if (!t.recognised || !t.passed.length) return unsupported('the last test run ended without a recognisable pass count', ev)
      const sum = t.passed.reduce((a, b) => a + b, 0)
      if (c.count !== undefined && c.count !== sum && !t.passed.includes(c.count))
        return { ...c, status: 'CONTRADICTED', reason: `claims ${c.count}, the last run shows ${t.passed.join(' + ')} passing`, evidence: ev }
      return { ...c, status: 'SUPPORTED', reason: `the last test run: ${t.passed.join(' + ')} passing, 0 failing`, evidence: ev }
    }
    const ev = evidenceOf(last, /error|warning|built|compiled|success/i)
    if (last.result.isError) return { ...c, status: 'CONTRADICTED', reason: 'the last build exited with an error', evidence: ev }
    if (/\berror(?:\s+TS\d+)?\s*:|\b[1-9]\d*\s+errors?\b|\bbuild failed\b/i.test(last.result.text.replace(ANSI, '')))
      return { ...c, status: 'CONTRADICTED', reason: 'the last build output reports errors', evidence: ev }
    return { ...c, status: 'SUPPORTED', reason: 'the last build/typecheck ran without errors', evidence: ev }
  }

  if (c.kind === 'committed' || c.kind === 'pushed') {
    const runs = shellRuns(steps, upTo, c.kind === 'committed' ? COMMIT_CMD : PUSH_CMD)
    const last = runs[runs.length - 1]
    if (!last) return unsupported(`no git ${c.kind === 'committed' ? 'commit' : 'push'} ran in this session`)
    if (!last.result) return unsupported('the last run has no recorded result', evidenceOf(last))
    const text = last.result.text.replace(ANSI, '')
    const ev = evidenceOf(last, /->|rejected|error|fatal|nothing to commit|changed|create mode|\[\S+ [0-9a-f]{7}/i)
    if (last.result.isError) return { ...c, status: 'CONTRADICTED', reason: `the last git ${c.kind === 'committed' ? 'commit' : 'push'} exited with an error`, evidence: ev }
    if (c.kind === 'committed' && /nothing to commit|no changes added to commit/i.test(text)) return { ...c, status: 'CONTRADICTED', reason: 'git reported nothing to commit', evidence: ev }
    if (c.kind === 'pushed' && /\[rejected\]|\berror:|\bfatal:/i.test(text)) return { ...c, status: 'CONTRADICTED', reason: 'the push was rejected', evidence: ev }
    return { ...c, status: 'SUPPORTED', reason: `the last git ${c.kind === 'committed' ? 'commit' : 'push'} succeeded`, evidence: ev }
  }

  // file_written
  const want = c.path!.replace(/\\/g, '/').replace(/^\.\//, '')
  const results = new Map<string, Extract<Step, { kind: 'tool_result' }>>()
  for (let i = 0; i < upTo; i++) { const s = steps[i]!; if (s.kind === 'tool_result') results.set(s.id, s) }
  for (let i = upTo - 1; i >= 0; i--) {
    const s = steps[i]!
    if (s.kind !== 'tool_use') continue
    const r = results.get(s.id)
    const ok = r && !r.isError
    if (EDIT_TOOLS.test(s.name)) {
      const p = String(s.input.file_path ?? s.input.path ?? '').replace(/\\/g, '/')
      if (p === want || p.endsWith(`/${want}`)) {
        const ev: Evidence = { tool: s.name, excerpt: p, tool_use_id: s.id, ...(s.at ? { at: s.at } : {}) }
        return ok ? { ...c, status: 'SUPPORTED', reason: `${s.name} wrote ${p}`, evidence: ev } : { ...c, status: 'CONTRADICTED', reason: `${s.name} on ${p} failed`, evidence: ev }
      }
    } else if (SHELL.test(s.name) && typeof s.input.command === 'string' && s.input.command.replace(/\\/g, '/').includes(want) && /(?:>|\btee\b|\bcp\b|\bmv\b|\btouch\b|writeFileSync)/.test(s.input.command) && ok) {
      return { ...c, status: 'SUPPORTED', reason: 'a shell command wrote it', evidence: { tool: s.name, command: s.input.command.slice(0, 200), excerpt: want, tool_use_id: s.id, ...(s.at ? { at: s.at } : {}) } }
    }
  }
  return unsupported(`no tool in this session wrote ${c.path}`)
}

/**
 * Check the claims in the assistant message that ends at step index `finalIndex` (default: the last assistant text).
 * Evidence is everything before that message.
 */
export function checkClaims(steps: Step[], finalIndex?: number): ClaimsResult {
  let end = finalIndex ?? -1
  if (end < 0) for (let i = steps.length - 1; i >= 0; i--) if (steps[i]!.kind === 'assistant_text') { end = i; break }
  if (end < 0) return { outcome: 'ABSTAIN', claims: [], reasons: ['no assistant message to check'] }
  // the final message = the contiguous run of assistant text ending at `end` (one reply can be several text blocks)
  let start = end
  while (start > 0 && steps[start - 1]!.kind === 'assistant_text') start--
  const texts = steps.slice(start, end + 1) as Extract<Step, { kind: 'assistant_text' }>[]
  return checkMessageClaims(texts.map((t) => t.text).join('\n'), steps, start, texts[texts.length - 1]!.at)
}

/**
 * Check the claims in `text` against the evidence in `steps` before index `upTo` (default: all of them). For hosts that hand
 * over the final message separately, e.g. a Stop hook's `last_assistant_message` when the transcript has not caught up yet.
 */
export function checkMessageClaims(text: string, steps: Step[], upTo = steps.length, at?: string): ClaimsResult {
  const claims = extractClaims(text).map((c) => checkOne(c, steps, upTo))
  const base = at ? { final_message_at: at } : {}
  if (!claims.length) return { outcome: 'ABSTAIN', claims, ...base, reasons: ['no checkable completion claims in the final message'] }
  const contra = claims.filter((c) => c.status === 'CONTRADICTED')
  const unsup = claims.filter((c) => c.status === 'UNSUPPORTED')
  const reasons = [...contra, ...unsup].map((c) => `${c.status}: "${c.claim}" — ${c.reason}`)
  if (contra.length) return { outcome: 'FAIL', claims, ...base, reasons }
  if (unsup.length) return { outcome: 'ABSTAIN', claims, ...base, reasons }
  return { outcome: 'PASS', claims, ...base, reasons: [`all ${claims.length} claim(s) are backed by this session's tool results`] }
}

/** The index where the final assistant message starts, if its text equals `text` (whitespace-insensitive); else -1. */
export function findFinalMessage(steps: Step[], text: string): number {
  let end = -1
  for (let i = steps.length - 1; i >= 0; i--) if (steps[i]!.kind === 'assistant_text') { end = i; break }
  if (end < 0) return -1
  let start = end
  while (start > 0 && steps[start - 1]!.kind === 'assistant_text') start--
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim()
  const joined = (steps.slice(start, end + 1) as Extract<Step, { kind: 'assistant_text' }>[]).map((t) => t.text).join('\n')
  return norm(joined) === norm(text) ? start : -1
}

/** Indices of every turn-final assistant text (the last assistant text before each user prompt, and at the end). */
export function turnEnds(steps: Step[]): number[] {
  const out: number[] = []
  let lastText = -1
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!
    if (s.kind === 'assistant_text') lastText = i
    else if (s.kind === 'user_prompt' && lastText >= 0) { out.push(lastText); lastText = -1 }
  }
  if (lastText >= 0) out.push(lastText)
  return out
}

const textOf = (c: unknown): string => typeof c === 'string' ? c : Array.isArray(c)
  ? c.map((x) => (x && typeof x === 'object' ? (typeof (x as { text?: unknown }).text === 'string' ? (x as { text: string }).text : '') : '')).join('\n')
  : ''

/**
 * A Claude Code transcript (JSONL) as Steps. Assistant text and tool_use blocks, tool_result blocks (with is_error), and real
 * user prompts, which are user entries with text that are neither tool results nor slash-command records.
 */
export function sessionFromClaudeCodeTranscript(jsonl: string): Step[] {
  const steps: Step[] = []
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue
    let j: Record<string, unknown>
    try { j = JSON.parse(line) } catch { continue }
    const msg = (j.message ?? {}) as Record<string, unknown>
    const at = typeof j.timestamp === 'string' ? j.timestamp : undefined
    const stamp = at ? { at } : {}
    if (j.type === 'assistant' && Array.isArray(msg.content)) {
      for (const b of msg.content as Record<string, unknown>[]) {
        if (b?.type === 'text' && typeof b.text === 'string') steps.push({ kind: 'assistant_text', text: b.text, ...(typeof msg.id === 'string' ? { message_id: msg.id } : {}), ...stamp })
        else if (b?.type === 'tool_use' && typeof b.id === 'string') steps.push({ kind: 'tool_use', id: b.id, name: String(b.name ?? ''), input: (b.input && typeof b.input === 'object' ? b.input : {}) as Record<string, unknown>, ...stamp })
      }
    } else if (j.type === 'user') {
      const c = msg.content
      if (Array.isArray(c) && c.some((b) => (b as { type?: unknown })?.type === 'tool_result')) {
        for (const b of c as Record<string, unknown>[]) if (b?.type === 'tool_result' && typeof b.tool_use_id === 'string') steps.push({ kind: 'tool_result', id: b.tool_use_id, text: textOf(b.content), isError: b.is_error === true, ...stamp })
      } else if (!j.isMeta) {
        const t = textOf(c).trim()
        if (t && !/^<(?:command-|local-command-)/.test(t)) steps.push({ kind: 'user_prompt', ...stamp })
      }
    }
  }
  return steps
}
