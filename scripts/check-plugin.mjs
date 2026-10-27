// Check that the built plugin is complete: every file its hooks.json and .mcp.json point at (${CLAUDE_PLUGIN_ROOT}/…) exists
// inside the plugin. A plugin installed from a marketplace is copied on its own, so a missing file would make Claude Code run
// `node <missing file>` on every matching event: a non-blocking error each time, and a hook that silently does nothing.
// build-plugin.mjs runs this check after every build, and fails the build on a missing file. The export runs it on the
// staged tree and refuses to publish an INCOMPLETE plugin (2026-10-05).
//   node scripts/check-plugin.mjs [plugin dir] [--smoke]        (default plugins/riposte · npm run check:plugin)
// It also reads bin/BUILD.json, which build-plugin writes: every built file must still have the sha256 recorded there (a bin
// edited or rebuilt by hand is refused), and, when the plugin sits in its repository, the engine and checker versions it was
// built from must be the sources' current ones (a stale build is refused: rebuild with `npm run build:plugin`).
// --smoke also runs what is registered, the way Claude Code would: ${CLAUDE_PLUGIN_ROOT}, ${CLAUDE_PLUGIN_DATA} and
// ${CLAUDE_PROJECT_DIR} substituted, a scratch data dir, and no RIPOSTE_* or RECEIPTS_* inherited from this shell.
//   - every referenced script passes `node --check`;
//   - PreToolUse: with RIPOSTE_ACTION_HOOK unset the hook exits 0, prints nothing and writes nothing (off by default); with it
//     on and a policy that holds the call, it asks, and the receipt lands in the plugin's own ledger, never in RIPOSTE_LEDGER;
//   - Stop: an unbacked "All tests pass." is recorded (record-only by default: exit 0, `would_block` on the receipt);
//   - each MCP server answers `initialize`;
//   - hosts/ (the claims check on Codex, Cursor and OpenCode, see hosts/README.md): every file the installer snippets point
//     at exists (RIPOSTE_HOSTS_DIR → hosts/), and with --smoke each port runs the way its host would, with a scratch home
//     (the ports' default ledger is ~/.riposte/receipts.jsonl): record-only by default, one send-back in block mode, never
//     a second, fail open on bad input; its ledger verifies with this plugin's riposte-ledger; each receipt names its `host`;
//     and the Codex port's receipt for the Stop smoke's session, without `host`, is byte for byte the Stop hook's own (which
//     carries no `host`).
// --reproduce (2026-10-05) rebuilds every bin from the sources beside the plugin, with scripts/build-plugin.mjs, into a
// scratch folder inside the repository (tmp/plugin-reproduce/, removed afterwards), and compares the rebuilt files, BUILD.json
// and BUILD-SOURCES.txt with the plugin's, byte for byte. Exit 0 identical · 1 a difference (each file named; for the source
// list, each source that differs) · 2 it cannot be compared here (no esbuild installed, or not the version BUILD.json names).
// A reviewer runs it after `npm install` in a fresh checkout to confirm the shipped bins are the ones the sources build.
// The smoke's scratch folder is tmp/ inside the repository too (the system temp folder only for a plugin outside one).
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT_REF = /\$\{CLAUDE_PLUGIN_ROOT\}([^"'\s]*)/g

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))

/** The build stamp build-plugin.mjs writes into the plugin's bin/. */
export const BUILD_STAMP = 'BUILD.json'

/**
 * The engine and checker versions of the sources beside a repository root: packages/<pkg>/src (the published layout) or
 * ../<pkg>/src (the workshop it is assembled from). Null for a version whose source is not there (an installed plugin).
 */
export function sourceVersions(root) {
  const find = (pkgName, file) => [join(root, 'packages', pkgName, 'src', file), join(root, '..', pkgName, 'src', file)].find((p) => existsSync(p))
  const read = (p, name) => (p ? (readFileSync(p, 'utf8').match(new RegExp(`export const ${name} = '([^']+)'`)) ?? [])[1] ?? null : null)
  return { engine_version: read(find('verify', 'version.ts'), 'ENGINE_VERSION'), checker_version: read(find('receipts', 'version.ts'), 'CHECKER_VERSION') }
}

/** Problems with the build stamp: missing, a file that changed since the build, or versions older than the sources'. */
export function checkBuildStamp(pluginDir) {
  const p = join(pluginDir, 'bin', BUILD_STAMP)
  if (!existsSync(p)) return { lines: [`MISSING bin/${BUILD_STAMP}  (written by scripts/build-plugin.mjs: the bins were not built by it)`], problems: [`bin/${BUILD_STAMP} missing: build the plugin with scripts/build-plugin.mjs`] }
  let stamp
  try { stamp = readJson(p) } catch (e) { return { lines: [`BROKEN  bin/${BUILD_STAMP}`], problems: [`bin/${BUILD_STAMP} does not parse (${e.message})`] } }
  const lines = [], problems = []
  for (const [rel, want] of Object.entries(stamp.files ?? {})) {
    const full = join(pluginDir, rel)
    const got = existsSync(full) ? createHash('sha256').update(readFileSync(full)).digest('hex') : null
    const ok = got === want
    lines.push(`${ok ? 'ok     ' : 'CHANGED'} build stamp  ${rel}${ok ? '' : got === null ? '  (missing)' : '  (its sha256 is not the one the build recorded)'}`)
    if (!ok) problems.push(`${rel}: ${got === null ? 'missing' : 'changed since scripts/build-plugin.mjs built it'}; rebuild the plugin`)
  }
  const now = sourceVersions(join(pluginDir, '..', '..'))
  for (const k of ['engine_version', 'checker_version']) {
    if (now[k] === null) continue // the sources are not beside this plugin (an installed copy): only the hashes are checked
    const ok = stamp[k] === now[k]
    lines.push(`${ok ? 'ok     ' : 'STALE  '} build stamp  ${k} ${stamp[k]}${ok ? '' : ` (the sources are at ${now[k]})`}`)
    if (!ok) problems.push(`the plugin was built from ${k.replace('_', ' ')} ${stamp[k]}, but the sources are at ${now[k]}: rebuild with npm run build:plugin`)
  }
  return { lines, problems }
}

/** The plugin's hook and MCP config: plugin.json's `hooks` / `mcpServers` when set (a path or inline), else the defaults. */
function configs(pluginDir) {
  const manifestPath = join(pluginDir, '.claude-plugin', 'plugin.json')
  const manifest = existsSync(manifestPath) ? readJson(manifestPath) : {}
  const load = (field, fallback) => {
    const v = manifest[field]
    if (v && typeof v === 'object' && !Array.isArray(v)) return [{ name: `plugin.json ${field}`, config: v }]
    const paths = v === undefined ? (existsSync(join(pluginDir, fallback)) ? [fallback] : []) : [v].flat()
    return paths.map((p) => ({ name: p.replace(/^\.\//, ''), config: readJson(join(pluginDir, p)) }))
  }
  return { hooks: load('hooks', 'hooks/hooks.json'), mcp: load('mcpServers', '.mcp.json') }
}

/** Every registered hook command and MCP server, each with the plugin files it points at. */
export function pluginEntries(pluginDir) {
  const { hooks, mcp } = configs(pluginDir)
  const out = []
  const refsIn = (s) => [...String(s).matchAll(ROOT_REF)].map((m) => m[1])
  for (const { name, config } of hooks) {
    for (const [event, groups] of Object.entries(config.hooks ?? {})) {
      groups.forEach((g, i) => (g.hooks ?? []).forEach((h, j) => {
        if (h.type !== 'command') return
        out.push({ kind: 'hook', event, matcher: g.matcher, command: h.command, where: `${name} ${event}[${i}].hooks[${j}]`, refs: refsIn(h.command) })
      }))
    }
  }
  for (const { name, config } of mcp) {
    for (const [server, s] of Object.entries(config.mcpServers ?? {})) {
      out.push({ kind: 'mcp', server, spec: s, where: `${name} ${server}`, refs: [s.command, ...(s.args ?? [])].flatMap(refsIn) })
    }
  }
  return out
}

/** Problems (empty = complete): a referenced file that is missing, is not a file, or resolves outside the plugin. */
export function checkPlugin(pluginDir) {
  const entries = pluginEntries(pluginDir)
  const problems = []
  const lines = []
  for (const e of entries) {
    for (const ref of e.refs) {
      const full = resolve(pluginDir, `.${ref.startsWith('/') ? '' : '/'}${ref}`)
      const rel = relative(pluginDir, full)
      let why = ''
      if (rel.startsWith('..') || isAbsolute(rel)) why = 'resolves outside the plugin (a marketplace install copies the plugin on its own)'
      else if (!existsSync(full)) why = 'missing'
      else if (!statSync(full).isFile()) why = 'not a file'
      lines.push(`${why ? 'MISSING' : 'ok     '} ${e.where}  ${rel.split('\\').join('/')}${why ? `  (${why})` : ''}`)
      if (why) problems.push(`${e.where}: \${CLAUDE_PLUGIN_ROOT}${ref} ${why}`)
    }
  }
  return { entries, problems, lines, refs: entries.reduce((n, e) => n + e.refs.length, 0) }
}

// ── hosts/ ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
const HOSTS_REF = /RIPOSTE_HOSTS_DIR([^"'\s]*)/g

/** Every command the host snippets register (hosts/codex/hooks.json, hosts/cursor/hooks.json), and the OpenCode plugin file. */
export function hostEntries(pluginDir) {
  const dir = join(pluginDir, 'hosts')
  if (!existsSync(dir)) return []
  const out = []
  for (const host of ['codex', 'cursor']) {
    const p = join(dir, host, 'hooks.json')
    if (!existsSync(p)) { out.push({ host, event: '(snippet)', where: `hosts/${host}/hooks.json`, refs: [`/${host}/hooks.json`] }); continue }
    for (const [event, groups] of Object.entries(readJson(p).hooks ?? {})) {
      groups.forEach((g, i) => (host === 'codex' ? g.hooks ?? [] : [g]).forEach((h, j) => {
        if (typeof h.command !== 'string') return
        out.push({ host, event, command: h.command, where: `hosts/${host}/hooks.json ${event}[${i}]${host === 'codex' ? `.hooks[${j}]` : ''}`, refs: [...h.command.matchAll(HOSTS_REF)].map((m) => m[1]) })
      }))
    }
  }
  out.push({ host: 'opencode', event: 'session.idle', where: 'hosts/opencode', refs: ['/opencode/riposte.js'] })
  return out
}

/** Problems (empty = complete): a file the host snippets point at that is missing or resolves outside hosts/. */
export function checkHosts(pluginDir) {
  const base = join(pluginDir, 'hosts')
  const entries = hostEntries(pluginDir)
  const problems = []
  const lines = []
  for (const e of entries) {
    for (const ref of e.refs) {
      const full = resolve(base, `.${ref.startsWith('/') ? '' : '/'}${ref}`)
      const rel = relative(base, full)
      const why = rel.startsWith('..') || isAbsolute(rel) ? 'resolves outside hosts/' : !existsSync(full) ? 'missing' : !statSync(full).isFile() ? 'not a file' : ''
      lines.push(`${why ? 'MISSING' : 'ok     '} ${e.where}  hosts/${rel.split('\\').join('/')}${why ? `  (${why})` : ''}`)
      if (why) problems.push(`${e.where}: RIPOSTE_HOSTS_DIR${ref} ${why}`)
    }
  }
  return { entries, problems, lines }
}

// The Stop smoke's session (TRANSCRIPT below) as a Codex rollout: the same call id, command, output, times and reply.
const CODEX_ROLLOUT = [
  { timestamp: '2026-01-01T00:01:00Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'go' }] } },
  { timestamp: '2026-01-01T00:02:00Z', type: 'response_item', payload: { type: 'function_call', name: 'exec_command', arguments: JSON.stringify({ cmd: 'npm test' }), call_id: 'toolu_2' } },
  { timestamp: '2026-01-01T00:02:30Z', type: 'response_item', payload: { type: 'function_call_output', call_id: 'toolu_2', output: 'Wall time: 1.0000 seconds\nProcess exited with code 1\nOutput:\n Test Files  1 failed | 4 passed (5)\n      Tests  1 failed | 61 passed (62)' } },
  { timestamp: '2026-01-01T00:03:00Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'All tests pass.' }] } },
].map((l) => JSON.stringify(l)).join('\n') + '\n'
const cursorEvent = (ev, extra) => JSON.stringify({ conversation_id: 'smoke-conv', generation_id: 'g1', model: 'default', hook_event_name: ev, cursor_version: '1.7.2', workspace_roots: ['/w'], user_email: null, transcript_path: null, ...extra })
const CURSOR_TURN = [
  ['afterFileEdit', { file_path: '/w/src/a.ts', edits: [{ old_string: 'a', new_string: 'b' }] }],
  ['postToolUse', { tool_name: 'Shell', tool_input: { command: 'npm test' }, tool_output: JSON.stringify({ exitCode: 1, stdout: ' Tests  1 failed | 61 passed (62)' }), tool_use_id: 't1', cwd: '/w', duration: 900 }],
  ['postToolUseFailure', { tool_name: 'Read', tool_input: { file_path: '/w/missing.ts' }, tool_use_id: 't2', cwd: '/w', error_message: 'not found', failure_type: 'error', duration: 2, is_interrupt: false }],
  ['afterAgentResponse', { text: 'All tests pass.' }],
  ['stop', { status: 'completed', loop_count: 0 }],
]
const OPENCODE_MESSAGES = [
  { info: { id: 'u1', sessionID: 's', role: 'user', time: { created: 1 } }, parts: [{ type: 'text', text: 'go' }] },
  { info: { id: 'a1', sessionID: 's', role: 'assistant', time: { created: 2, completed: 5 } }, parts: [
    { type: 'tool', callID: 'c1', tool: 'bash', state: { status: 'completed', input: { command: 'npm test' }, output: ' Tests  1 failed | 61 passed (62)', title: 'npm test', metadata: { exit: 1 }, time: { start: 3, end: 4 } } },
    { type: 'text', text: 'All tests pass.', time: { start: 4, end: 5 } },
  ] },
]

async function smokeHosts(pluginDir, hosts, stopEntry, dir, base) {
  const fails = []
  const log = []
  const ok = (cond, what) => { log.push(`${cond ? 'ok  ' : 'FAIL'} ${what}`); if (!cond) fails.push(what) }
  const hostsDir = join(pluginDir, 'hosts')
  const sub = (cmd) => cmd.replaceAll('RIPOSTE_HOSTS_DIR', hostsDir)
  let n = 0
  const home = () => { const h = join(dir, `host-home-${n++}`); mkdirSync(h, { recursive: true }); return { h, ledger: join(h, '.riposte', 'receipts.jsonl'), env: { ...base, HOME: h, USERPROFILE: h } } }
  const run = (cmd, input, env) => spawnSync(sub(cmd), { shell: true, input, env, encoding: 'utf8', timeout: 30_000, windowsHide: true })
  const receipts = (p) => (existsSync(p) ? readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
  const verify = (ledger, what) => {
    const v = spawnSync(process.execPath, [join(pluginDir, 'bin', 'riposte-ledger.mjs'), 'verify', ledger], { encoding: 'utf8', timeout: 30_000, windowsHide: true, env: base })
    ok(v.status === 0, `${what}: its ledger verifies with bin/riposte-ledger.mjs (exit ${v.status}${v.status === 0 ? '' : `, ${(v.stdout + v.stderr).trim().slice(0, 160)}`})`)
  }

  // Codex
  const codex = hosts.find((e) => e.host === 'codex' && e.event === 'Stop')
  ok(Boolean(codex), 'hosts/codex/hooks.json registers a Stop command')
  if (codex) {
    const c = home()
    const rollout = join(c.h, 'rollout.jsonl')
    writeFileSync(rollout, CODEX_ROLLOUT)
    const hook = { session_id: 's', transcript_path: rollout, cwd: c.h, hook_event_name: 'Stop', model: 'm', turn_id: 't', permission_mode: 'default', stop_hook_active: false, last_assistant_message: null }
    const r0 = run(codex.command, JSON.stringify(hook), c.env)
    const got0 = receipts(c.ledger)
    ok(r0.status === 0 && r0.stdout === '' && got0.length === 1 && got0[0].body?.would_block === true && got0[0].body?.blocked === false,
      `codex: an unbacked "All tests pass." is recorded, not sent back (exit ${r0.status}, stdout ${JSON.stringify(r0.stdout.slice(0, 40))}, receipts ${got0.length}${r0.stderr ? `, stderr ${JSON.stringify(r0.stderr.trim().slice(0, 120))}` : ''})`)
    const r1 = run(codex.command, JSON.stringify(hook), { ...c.env, RIPOSTE_HOOK_MODE: 'block' })
    ok(r1.status === 2 && r1.stdout === '' && /^Before you finish:/.test(r1.stderr), `codex: block mode sends it back with exit 2 and the reason on stderr (exit ${r1.status})`)
    const r2 = run(codex.command, JSON.stringify({ ...hook, stop_hook_active: true }), { ...c.env, RIPOSTE_HOOK_MODE: 'block' })
    ok(r2.status === 0 && receipts(c.ledger).length === 2, `codex: a stop already sent back is let through, unrecorded (exit ${r2.status}, receipts ${receipts(c.ledger).length})`)
    const r3 = run(codex.command, 'not json', c.env)
    const r4 = run(codex.command, 'not json', { ...c.env, RIPOSTE_HOOK_MODE: 'block' })
    ok(r3.status === 0 && r4.status === 1, `codex: bad input fails open (record-only exit ${r3.status}; block exit ${r4.status}, never 2)`)
    verify(c.ledger, 'codex')
    if (stopEntry) { // the Stop hook itself on the same session: the receipt bodies must match byte for byte
      const st = home()
      const transcript = join(st.h, 'session.jsonl')
      writeFileSync(transcript, TRANSCRIPT)
      const data = join(st.h, 'data'); mkdirSync(data, { recursive: true })
      const cmd = stopEntry.command.replaceAll('${CLAUDE_PLUGIN_ROOT}', pluginDir).replaceAll('${CLAUDE_PLUGIN_DATA}', data)
      spawnSync(cmd, { shell: true, input: JSON.stringify({ hook_event_name: 'Stop', session_id: 's', transcript_path: transcript, stop_hook_active: false }), env: st.env, encoding: 'utf8', timeout: 30_000, windowsHide: true })
      const claude = receipts(join(data, 'receipts.jsonl'))[0]?.body
      const { host, ...rest } = got0[0]?.body ?? {}
      const same = claude !== undefined && JSON.stringify(rest) === JSON.stringify(claude)
      ok(claude !== undefined && !('host' in claude), `codex: the Claude Code Stop hook's own receipt carries no host, so its bytes are unchanged (${claude === undefined ? 'no Stop receipt' : 'host' in claude ? `host ${JSON.stringify(claude.host)}` : 'no host'})`)
      ok(host === 'codex' && same, `codex: its receipt names host "codex" and, without it, is byte for byte the Claude Code Stop hook's for the same session (host ${JSON.stringify(host)}, ${claude === undefined ? 'no Stop receipt' : same ? 'identical' : 'DIFFERENT'})`)
    }
  }

  // Cursor
  const cursor = hosts.filter((e) => e.host === 'cursor' && e.command)
  const byEvent = Object.fromEntries(cursor.map((e) => [e.event, e]))
  const needed = ['postToolUse', 'postToolUseFailure', 'afterFileEdit', 'afterAgentResponse', 'stop', 'sessionEnd']
  ok(needed.every((ev) => byEvent[ev]), `hosts/cursor/hooks.json registers ${needed.join(', ')} (${Object.keys(byEvent).join(', ')})`)
  if (needed.every((ev) => byEvent[ev])) {
    const turn = (env) => CURSOR_TURN.map(([ev, extra]) => run(byEvent[ev].command, cursorEvent(ev, extra), env))
    const q = home()
    const outs = turn(q.env)
    const json = outs.every((o) => { try { JSON.parse(o.stdout); return o.status === 0 } catch { return false } })
    const got = receipts(q.ledger)
    ok(json && outs.at(-1).stdout.trim() === '{}' && got.length === 1 && got[0].body?.would_block === true && got[0].body?.blocked === false && got[0].body?.host === 'cursor',
      `cursor: every event answers JSON; at stop an unbacked "All tests pass." is recorded with host "cursor", no follow-up (stop stdout ${JSON.stringify(outs.at(-1).stdout.trim().slice(0, 60))}, receipts ${got.length}, host ${JSON.stringify(got[0]?.body?.host)})`)
    const b = home()
    const bounce = turn({ ...b.env, RIPOSTE_HOOK_MODE: 'block' }).at(-1)
    let follow = ''
    try { follow = JSON.parse(bounce.stdout).followup_message ?? '' } catch { /* reported below */ }
    ok(/^Before you finish:/.test(follow), `cursor: block mode answers a followup_message (stdout ${JSON.stringify(bounce.stdout.trim().slice(0, 60))})`)
    const again = run(byEvent.stop.command, cursorEvent('stop', { generation_id: 'g2', status: 'completed', loop_count: 1 }), { ...b.env, RIPOSTE_HOOK_MODE: 'block' })
    ok(again.stdout.trim() === '{}' && receipts(b.ledger).length === 1, `cursor: the follow-up turn is not sent back again (stdout ${JSON.stringify(again.stdout.trim())}, receipts ${receipts(b.ledger).length})`)
    const bad = run(byEvent.stop.command, 'not json', q.env)
    ok(bad.status === 0 && bad.stdout.trim() === '{}', `cursor: bad input fails open with {} (exit ${bad.status})`)
    const end = run(byEvent.sessionEnd.command, cursorEvent('sessionEnd', { reason: 'completed', duration_ms: 1 }), q.env)
    ok(end.status === 0 && !existsSync(join(q.h, '.riposte', 'cursor-journal', 'smoke-conv.jsonl')), `cursor: sessionEnd deletes the conversation's journal (exit ${end.status})`)
    verify(q.ledger, 'cursor')
  }

  // OpenCode: loaded in this process the way OpenCode loads a plugin file (OpenCode itself runs it under its own runtime)
  const file = join(hostsDir, 'opencode', 'riposte.js')
  if (existsSync(file)) {
    const o = home()
    const keep = Object.fromEntries(Object.keys(process.env).filter((k) => k.startsWith('RIPOSTE_') || k.startsWith('RECEIPTS_')).map((k) => [k, process.env[k]]))
    for (const k of Object.keys(keep)) delete process.env[k]
    process.env.RIPOSTE_LEDGER = o.ledger
    try {
      const mod = await import(pathToFileURL(file).href)
      const fns = Object.values(mod)
      ok(fns.length === 1 && typeof fns[0] === 'function', `opencode: the plugin file exports exactly one function (${Object.keys(mod).join(', ')})`)
      const prompts = []
      const client = { session: { messages: async () => ({ data: OPENCODE_MESSAGES }), promptAsync: async (x) => { prompts.push(x); return {} } } }
      const hooks = await fns[0]({ client })
      await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 's' } } })
      const got = receipts(o.ledger)
      ok(prompts.length === 0 && got.length === 1 && got[0].body?.would_block === true && got[0].body?.host === 'opencode', `opencode: on session.idle an unbacked "All tests pass." is recorded with host "opencode", nothing sent (prompts ${prompts.length}, receipts ${got.length}, host ${JSON.stringify(got[0]?.body?.host)})`)
      process.env.RIPOSTE_HOOK_MODE = 'block'
      const hooks2 = await fns[0]({ client })
      await hooks2.event({ event: { type: 'session.idle', properties: { sessionID: 's' } } })
      await hooks2.event({ event: { type: 'session.idle', properties: { sessionID: 's' } } })
      ok(prompts.length === 1, `opencode: block mode sends it back once through promptAsync (prompts ${prompts.length})`)
      const broken = await fns[0]({ client: { session: { messages: async () => { throw new Error('down') } } } })
      let threw = false
      try { await broken.event({ event: { type: 'session.idle', properties: { sessionID: 's' } } }) } catch { threw = true }
      ok(!threw, 'opencode: a failing client never rejects the event hook')
      verify(o.ledger, 'opencode')
    } finally {
      delete process.env.RIPOSTE_LEDGER; delete process.env.RIPOSTE_HOOK_MODE
      Object.assign(process.env, keep)
    }
  } else ok(false, 'opencode: hosts/opencode/riposte.js is missing')
  return { fails, log }
}

// ── --smoke ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const say = (n, content) => JSON.stringify({ type: 'assistant', timestamp: `2026-01-01T00:0${n}:00Z`, message: { id: `m${n}`, model: 'x', content } })
const TRANSCRIPT = [
  JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:01:00Z', message: { role: 'user', content: 'go' } }),
  say(2, [{ type: 'tool_use', id: 'toolu_2', name: 'Bash', input: { command: 'npm test' } }]),
  JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:02:30Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_2', content: ' Test Files  1 failed | 4 passed (5)\n      Tests  1 failed | 61 passed (62)', is_error: true }] } }),
  say(3, [{ type: 'text', text: 'All tests pass.' }]),
].join('\n') + '\n'

async function smoke(pluginDir, entries) {
  const fails = []
  const log = []
  const ok = (cond, what) => { log.push(`${cond ? 'ok  ' : 'FAIL'} ${what}`); if (!cond) fails.push(what) }
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('RIPOSTE_') && !k.startsWith('RECEIPTS_')))
  const dir = mkdtempSync(join(scratchRoot(pluginDir), 'riposte-plugin-smoke-'))
  try {
    const refs = [...new Set(entries.flatMap((e) => e.refs))].filter((r) => /\.(m?js|cjs)$/.test(r))
    for (const r of refs) {
      const c = spawnSync(process.execPath, ['--check', join(pluginDir, r)], { encoding: 'utf8', windowsHide: true })
      ok(c.status === 0, `node --check ${r.replace(/^\//, '')}${c.status === 0 ? '' : `: ${c.stderr.trim().split('\n')[0]}`}`)
    }
    let n = 0
    const scratch = () => {
      const s = join(dir, String(n++)); const data = join(s, 'data'), project = join(s, 'project')
      mkdirSync(data, { recursive: true }); mkdirSync(project)
      const sub = (x) => String(x).replaceAll('${CLAUDE_PLUGIN_ROOT}', pluginDir).replaceAll('${CLAUDE_PLUGIN_DATA}', data).replaceAll('${CLAUDE_PROJECT_DIR}', project)
      const ledger = join(data, 'receipts.jsonl')
      const kinds = () => existsSync(ledger) ? readFileSync(ledger, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []
      return { s, data, project, sub, ledger, kinds }
    }
    const run = (cmd, input, env) => spawnSync(cmd, { shell: true, input, env: { ...base, ...env }, encoding: 'utf8', timeout: 30_000, windowsHide: true })

    for (const e of entries.filter((x) => x.kind === 'hook')) {
      if (e.event === 'PreToolUse') {
        const tool = 'mcp__smoke__transfer'
        if (e.matcher && !new RegExp(e.matcher).test(tool)) { log.push(`skip ${e.where}: matcher ${e.matcher} does not match ${tool}`); continue }
        const input = (session) => JSON.stringify({ session_id: session, transcript_path: '/t.jsonl', cwd: '/w', permission_mode: 'default', hook_event_name: 'PreToolUse', tool_name: tool, tool_input: { to_account: '110-234-5678', amount: 500 }, tool_use_id: 'toolu_smoke' })
        const off = scratch()
        const r0 = run(off.sub(e.command), input('s-off'), {})
        ok(r0.status === 0 && r0.stdout === '' && r0.stderr === '' && !existsSync(off.ledger), `${e.where}: off by default (exit ${r0.status}, stdout ${JSON.stringify(r0.stdout.slice(0, 60))}, stderr ${JSON.stringify(r0.stderr.slice(0, 60))}, ledger ${existsSync(off.ledger) ? 'written' : 'untouched'})`)
        const on = scratch()
        const policy = join(on.s, 'policy.json'), decoy = join(on.s, 'inherited-ledger.jsonl')
        writeFileSync(policy, JSON.stringify({ policy_version: 'riposte-action-policy-v0', actions: [{ tool, level: 'gate', tier: 'severe', set_by: 'smoke', sources: { allowed: { amount: [500] } } }] }))
        const r1 = run(on.sub(e.command), input('s-on'), { RIPOSTE_ACTION_HOOK: 'on', RIPOSTE_ACTION_POLICY: policy, RIPOSTE_LEDGER: decoy })
        let decision
        try { decision = JSON.parse(r1.stdout).hookSpecificOutput?.permissionDecision } catch { decision = undefined }
        const got = on.kinds().map((x) => x.kind)
        ok(r1.status === 0 && decision === 'ask', `${e.where}: on, an ungrounded argument at gate is held (exit ${r1.status}, permissionDecision ${decision}${r1.status === 0 ? '' : `, stderr ${JSON.stringify(r1.stderr.trim().slice(0, 160))}`})`)
        ok(got.length === 1 && got[0] === 'action_check' && !existsSync(decoy), `${e.where}: the receipt is in the plugin ledger (${JSON.stringify(got)}), none in an inherited RIPOSTE_LEDGER (${existsSync(decoy) ? 'WRITTEN' : 'untouched'})`)
      } else if (e.event === 'Stop') {
        const st = scratch()
        const transcript = join(st.s, 'session.jsonl')
        writeFileSync(transcript, TRANSCRIPT)
        const r = run(st.sub(e.command), JSON.stringify({ hook_event_name: 'Stop', session_id: 's-stop', transcript_path: transcript, stop_hook_active: false }), {})
        const got = st.kinds()
        ok(r.status === 0 && got.length === 1 && got[0].kind === 'claims_check' && got[0].body?.would_block === true && got[0].body?.blocked === false,
          `${e.where}: an unbacked "All tests pass." is recorded, not blocked (exit ${r.status}, receipts ${JSON.stringify(got.map((x) => ({ kind: x.kind, would_block: x.body?.would_block, blocked: x.body?.blocked })))})`)
      } else log.push(`skip ${e.where}: no smoke case for ${e.event}`)
    }

    for (const e of entries.filter((x) => x.kind === 'mcp')) {
      const m = scratch()
      const env = Object.fromEntries(Object.entries(e.spec.env ?? {}).map(([k, v]) => [k, m.sub(v)]))
      const r = spawnSync(m.sub(e.spec.command), (e.spec.args ?? []).map(m.sub), {
        input: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'check-plugin', version: '0' } } }) + '\n',
        env: { ...base, ...env }, encoding: 'utf8', timeout: 30_000, windowsHide: true,
      })
      let reply
      try { reply = JSON.parse(r.stdout.trim().split('\n')[0]) } catch { reply = undefined }
      ok(r.status === 0 && reply?.id === 1 && reply?.result !== undefined, `${e.where}: answers initialize (exit ${r.status}${reply?.result?.serverInfo ? `, serverInfo ${JSON.stringify(reply.result.serverInfo)}` : ''})`)
    }

    const hosts = hostEntries(pluginDir)
    if (hosts.length) {
      const h = await smokeHosts(pluginDir, hosts, entries.find((x) => x.kind === 'hook' && x.event === 'Stop'), dir, base)
      log.push(...h.log)
      fails.push(...h.fails)
    } else log.push('skip hosts/: none in this plugin')
  } finally { rmSync(dir, { recursive: true, force: true }) }
  return { fails, log }
}

// ── scratch, inside the repository ──────────────────────────────────────────────────────────────────────────────────────
/** Where scratch goes: tmp/ at the repository root the plugin sits in (gitignored), else the system temp folder. */
function scratchRoot(pluginDir) {
  const root = join(pluginDir, '..', '..')
  if (!existsSync(join(root, 'scripts', 'check-plugin.mjs'))) return tmpdir()
  const t = join(root, 'tmp')
  mkdirSync(t, { recursive: true })
  return t
}

// ── --reproduce ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Rebuild the plugin's bins from the sources beside it and compare them with the plugin's, byte for byte.
 * Returns { code, lines, problems }: code 0 identical, 1 a difference, 2 cannot be compared here.
 */
export async function reproducePlugin(pluginDir) {
  const root = resolve(pluginDir, '..', '..')
  const lines = [], problems = []
  const stampPath = join(pluginDir, 'bin', BUILD_STAMP)
  if (!existsSync(stampPath)) return { code: 1, lines, problems: [`bin/${BUILD_STAMP} missing: nothing to compare with`] }
  const recorded = readFileSync(stampPath)
  let stamp
  try { stamp = JSON.parse(recorded.toString('utf8')) } catch (e) { return { code: 1, lines, problems: [`bin/${BUILD_STAMP} does not parse (${e.message})`] } }
  const buildScript = join(dirname(fileURLToPath(import.meta.url)), 'build-plugin.mjs')
  if (!existsSync(buildScript)) return { code: 2, lines, problems: ['scripts/build-plugin.mjs is not beside this script: the plugin cannot be rebuilt here'] }
  let esbuildVersion
  try { esbuildVersion = (await import('esbuild')).version } catch { return { code: 2, lines, problems: ['esbuild is not installed: run npm install at the repository root first'] } }
  const want = stamp.esbuild
  if (want && esbuildVersion !== want) return { code: 2, lines, problems: [`BUILD.json was built with esbuild ${want}; this tree has esbuild ${esbuildVersion}. Install the same version (npm install esbuild@${want}) and run --reproduce again.`] }
  if (!want) lines.push('note   BUILD.json names no esbuild version (a build from before 2026-10-05): comparing with the installed one')
  const { buildPlugin, SOURCES_FILE } = await import(pathToFileURL(buildScript).href)
  const scratch = join(scratchRoot(pluginDir), 'plugin-reproduce', `${process.pid}-${Date.now().toString(36)}`)
  try {
    const rebuilt = await buildPlugin({ root, plugin: join(scratch, 'plugins', 'riposte'), logLevel: 'warning', versions: sourceVersions(root), stampFile: BUILD_STAMP })
    const fileSha = (p) => (existsSync(p) ? createHash('sha256').update(readFileSync(p)).digest('hex') : null)
    for (const rel of [...new Set([...Object.keys(stamp.files ?? {}), ...Object.keys(rebuilt.files)])].sort()) {
      const shipped = fileSha(join(pluginDir, rel))
      const again = rebuilt.files[rel] ?? null
      const ok = shipped !== null && shipped === again && stamp.files?.[rel] === again
      lines.push(`${ok ? 'same   ' : 'DIFFERS'} ${rel}  ${again ? again.slice(0, 16) : 'not rebuilt'}${ok ? '' : `  (shipped ${shipped ? shipped.slice(0, 16) : 'missing'}, BUILD.json ${stamp.files?.[rel]?.slice(0, 16) ?? 'absent'})`}`)
      if (!ok) problems.push(`${rel}: the rebuild ${again ? `gives ${again.slice(0, 16)}…` : 'does not produce it'}; the plugin ships ${shipped ? `${shipped.slice(0, 16)}…` : 'nothing'}${stamp.files?.[rel] ? `, BUILD.json records ${stamp.files[rel].slice(0, 16)}…` : ''}`)
    }
    for (const f of [BUILD_STAMP, SOURCES_FILE]) {
      const a = join(pluginDir, 'bin', f), b = join(scratch, 'plugins', 'riposte', 'bin', f)
      const same = existsSync(a) && readFileSync(a).equals(readFileSync(b))
      lines.push(`${same ? 'same   ' : 'DIFFERS'} bin/${f}  ${fileSha(b).slice(0, 16)}`)
      if (!same) problems.push(`bin/${f}: the rebuild's is not byte for byte the plugin's`)
    }
    // which sources differ, when the source lists do
    const listA = join(pluginDir, 'bin', SOURCES_FILE), listB = join(scratch, 'plugins', 'riposte', 'bin', SOURCES_FILE)
    if (existsSync(listA) && !readFileSync(listA).equals(readFileSync(listB))) {
      const parse = (p) => new Map(readFileSync(p, 'utf8').trim().split('\n').map((l) => { const [h, ...rest] = l.split('  '); return [rest.join('  '), h] }))
      const A = parse(listA), B = parse(listB)
      const diff = [...new Set([...A.keys(), ...B.keys()])].sort().filter((k) => A.get(k) !== B.get(k))
      for (const k of diff.slice(0, 20)) problems.push(`  source ${k}: shipped list ${A.get(k)?.slice(0, 16) ?? 'absent'}, this tree ${B.get(k)?.slice(0, 16) ?? 'absent'}`)
      if (diff.length > 20) problems.push(`  … and ${diff.length - 20} more source(s)`)
    }
    lines.push(`rebuilt with esbuild ${esbuildVersion}; sources ${rebuilt.sources.files} files, sha256 ${rebuilt.sources.sha256}`)
  } finally { rmSync(scratch, { recursive: true, force: true }) }
  return { code: problems.length ? 1 : 0, lines, problems }
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2)
  const pluginDir = resolve(args.find((a) => !a.startsWith('--')) ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'plugins', 'riposte'))
  if (args.includes('--reproduce')) {
    const x = await reproducePlugin(pluginDir)
    console.log(x.lines.join('\n'))
    if (x.code === 0) console.log(`reproduced: every bin, BUILD.json and BUILD-SOURCES.txt rebuilt byte for byte from the sources in ${resolve(pluginDir, '..', '..')}`)
    else console.error(`${x.code === 2 ? 'cannot reproduce here' : 'NOT REPRODUCED'}: ${x.problems.length} problem(s)\n${x.problems.join('\n')}`)
    process.exit(x.code)
  }
  const r = checkPlugin(pluginDir)
  console.log(r.lines.join('\n'))
  if (r.problems.length) { console.error(`plugin INCOMPLETE: ${r.problems.length} of ${r.refs} referenced file(s) missing\n` + r.problems.join('\n')); process.exit(1) }
  console.log(`plugin complete: all ${r.refs} referenced file(s) present in ${pluginDir}`)
  const b = checkBuildStamp(pluginDir)
  console.log(b.lines.join('\n'))
  if (b.problems.length) { console.error(`plugin INCOMPLETE: the build stamp disagrees with the plugin or its sources (${b.problems.length} problem(s))\n` + b.problems.join('\n')); process.exit(1) }
  const h = checkHosts(pluginDir)
  if (h.lines.length) console.log(h.lines.join('\n'))
  if (h.problems.length) { console.error(`hosts INCOMPLETE: ${h.problems.length} file(s) the host snippets point at are missing\n` + h.problems.join('\n')); process.exit(1) }
  if (args.includes('--smoke')) {
    const s = await smoke(pluginDir, r.entries)
    console.log(s.log.join('\n'))
    if (s.fails.length) { console.error(`smoke FAILED: ${s.fails.length} check(s)`); process.exit(1) }
    console.log('smoke passed')
  }
}
