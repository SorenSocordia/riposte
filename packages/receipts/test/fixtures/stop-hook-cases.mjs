// Fixed Stop-hook cases: Claude Code-shaped transcripts and hook inputs. Plain JS so the pre-change capture (node, against
// the built dist) and the tests (vitest, against src) read the very same bytes. Deterministic: no clock, no counter state.
const say = (n, text) => JSON.stringify({ type: 'assistant', timestamp: `2026-09-23T12:${String(n).padStart(2, '0')}:00Z`, message: { id: `m${n}`, model: 'x', content: [{ type: 'text', text }] } })
const prompt = (n, text) => JSON.stringify({ type: 'user', timestamp: `2026-09-23T12:${String(n).padStart(2, '0')}:00Z`, message: { role: 'user', content: text } })
function tool(n, name, input, out, isError = false) {
  const id = `toolu_${n}`
  return [
    JSON.stringify({ type: 'assistant', timestamp: `2026-09-23T12:${String(n).padStart(2, '0')}:00Z`, message: { id: `m${n}`, model: 'x', content: [{ type: 'tool_use', id, name, input }] } }),
    JSON.stringify({ type: 'user', timestamp: `2026-09-23T12:${String(n).padStart(2, '0')}:30Z`, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: out, is_error: isError }] } }),
  ]
}
const bash = (n, command, out, isError = false) => tool(n, 'Bash', { command }, out, isError)
const edit = (n, file_path) => tool(n, 'Edit', { file_path, old_string: 'a', new_string: 'b' }, 'The file has been updated successfully.')
const t = (...lines) => lines.flat().join('\n') + '\n'

const VITEST_OK = '\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m5 passed\u001b[39m\u001b[22m (5)\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m62 passed\u001b[39m\u001b[22m (62)'
const VITEST_FAIL = ' Test Files  1 failed | 4 passed (5)\n      Tests  1 failed | 61 passed (62)'
const LONG = 'All tests pass, and I also double-checked every single edge case in the parser, the lexer, the formatter and the CLI wrapper around them.'

export const FILES = {
  'red.jsonl': t(prompt(1, 'go'), bash(2, 'npm test', VITEST_FAIL, true), say(3, 'All tests pass.')),
  'green.jsonl': t(prompt(1, 'go'), bash(2, 'npm test', VITEST_OK), say(3, 'All 62 tests pass.')),
  'bare.jsonl': t(prompt(1, 'go'), edit(2, 'src/a.ts'), say(3, 'Fixed — all tests pass.')),
  'plain.jsonl': t(prompt(1, 'go'), say(2, 'Here is the plan.')),
  'lagging.jsonl': t(prompt(1, 'go'), bash(2, 'npm test', VITEST_OK)),
  'mixed.jsonl': t(prompt(1, 'go'), bash(2, 'npm test', VITEST_FAIL, true), say(3, 'All tests pass. I committed the change.')),
  'long.jsonl': t(prompt(1, 'go'), bash(2, 'npm test', VITEST_FAIL, true), say(3, LONG)),
  'fix.jsonl': t(prompt(1, 'go'), edit(2, 'src/a.ts'), say(3, 'Fixed.')),
}

export const readFixture = (p) => { const f = FILES[p]; if (f === undefined) throw new Error('ENOENT'); return f }

const hook = (transcript_path, extra = {}) => JSON.stringify({ hook_event_name: 'Stop', session_id: 's', transcript_path, stop_hook_active: false, ...extra })

export const INPUTS = {
  red: hook('red.jsonl'),
  green: hook('green.jsonl'),
  bare: hook('bare.jsonl'),
  plain: hook('plain.jsonl'),
  mixed: hook('mixed.jsonl'),
  long: hook('long.jsonl'),
  fix: hook('fix.jsonl'),
  'lagging-ok': hook('lagging.jsonl', { last_assistant_message: 'All 62 tests pass.' }),
  'lagging-wrong': hook('lagging.jsonl', { last_assistant_message: 'All 99 tests pass.' }),
  'red-last': hook('red.jsonl', { last_assistant_message: 'All tests pass.' }),
  'red-active': hook('red.jsonl', { stop_hook_active: true }),
  'not-json': 'not json',
  'no-path': JSON.stringify({ hook_event_name: 'Stop' }),
  missing: hook('missing.jsonl'),
}

export const OPTIONS = {
  default: {},
  'only-contradicted': { onlyContradicted: true },
  'record-only': { recordOnly: true },
  strict: { strict: true },
  'strict-only-contradicted': { strict: true, onlyContradicted: true },
}

// The environment a plugin gives the hook (--from-env), and the ledger body the bin writes for each case.
export const ENVS = {
  empty: {},
  block: { RIPOSTE_HOOK_MODE: 'block' },
  'only-contradicted': { RIPOSTE_HOOK_MODE: 'only-contradicted' },
  'record-only': { RIPOSTE_HOOK_MODE: 'record-only' },
  'block-strict': { RIPOSTE_HOOK_MODE: 'block', RIPOSTE_STRICT: '1' },
  bad: { RIPOSTE_HOOK_MODE: 'blok' },
  ledger: { RIPOSTE_LEDGER: ' /x/r.jsonl ' },
}
