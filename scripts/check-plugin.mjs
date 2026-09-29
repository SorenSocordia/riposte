// Check that the built plugin is complete: every file its hooks.json and .mcp.json point at (${CLAUDE_PLUGIN_ROOT}/…) exists
// inside the plugin. A plugin installed from a marketplace is copied on its own, so a missing file would make Claude Code run
// `node <missing file>` on every matching event: a non-blocking error each time, and a hook that silently does nothing.
// build-plugin.mjs runs this check after every build, and fails the build on a missing file.
//   node scripts/check-plugin.mjs [plugin dir] [--smoke]        (default plugins/riposte · npm run check:plugin)
// --smoke also runs what is registered, the way Claude Code would: ${CLAUDE_PLUGIN_ROOT}, ${CLAUDE_PLUGIN_DATA} and
// ${CLAUDE_PROJECT_DIR} substituted, a scratch data dir, and no RIPOSTE_* or RECEIPTS_* inherited from this shell.
//   - every referenced script passes `node --check`;
//   - PreToolUse: with RIPOSTE_ACTION_HOOK unset the hook exits 0, prints nothing and writes nothing (off by default); with it
//     on and a policy that holds the call, it asks, and the receipt lands in the plugin's own ledger, never in RIPOSTE_LEDGER;
//   - Stop: an unbacked "All tests pass." is recorded (record-only by default: exit 0, `would_block` on the receipt);
//   - each MCP server answers `initialize`.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT_REF = /\$\{CLAUDE_PLUGIN_ROOT\}([^"'\s]*)/g

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))

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

// ── --smoke ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const say = (n, content) => JSON.stringify({ type: 'assistant', timestamp: `2026-01-01T00:0${n}:00Z`, message: { id: `m${n}`, model: 'x', content } })
const TRANSCRIPT = [
  JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:01:00Z', message: { role: 'user', content: 'go' } }),
  say(2, [{ type: 'tool_use', id: 'toolu_2', name: 'Bash', input: { command: 'npm test' } }]),
  JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:02:30Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_2', content: ' Test Files  1 failed | 4 passed (5)\n      Tests  1 failed | 61 passed (62)', is_error: true }] } }),
  say(3, [{ type: 'text', text: 'All tests pass.' }]),
].join('\n') + '\n'

function smoke(pluginDir, entries) {
  const fails = []
  const log = []
  const ok = (cond, what) => { log.push(`${cond ? 'ok  ' : 'FAIL'} ${what}`); if (!cond) fails.push(what) }
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('RIPOSTE_') && !k.startsWith('RECEIPTS_')))
  const dir = mkdtempSync(join(tmpdir(), 'riposte-plugin-smoke-'))
  try {
    const refs = [...new Set(entries.flatMap((e) => e.refs))].filter((r) => /\.(m?js|cjs)$/.test(r))
    for (const r of refs) {
      const c = spawnSync(process.execPath, ['--check', join(pluginDir, r)], { encoding: 'utf8' })
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
    const run = (cmd, input, env) => spawnSync(cmd, { shell: true, input, env: { ...base, ...env }, encoding: 'utf8', timeout: 30_000 })

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
        env: { ...base, ...env }, encoding: 'utf8', timeout: 30_000,
      })
      let reply
      try { reply = JSON.parse(r.stdout.trim().split('\n')[0]) } catch { reply = undefined }
      ok(r.status === 0 && reply?.id === 1 && reply?.result !== undefined, `${e.where}: answers initialize (exit ${r.status}${reply?.result?.serverInfo ? `, serverInfo ${JSON.stringify(reply.result.serverInfo)}` : ''})`)
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
  return { fails, log }
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2)
  const pluginDir = resolve(args.find((a) => !a.startsWith('--')) ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'plugins', 'riposte'))
  const r = checkPlugin(pluginDir)
  console.log(r.lines.join('\n'))
  if (r.problems.length) { console.error(`plugin INCOMPLETE: ${r.problems.length} of ${r.refs} referenced file(s) missing\n` + r.problems.join('\n')); process.exit(1) }
  console.log(`plugin complete: all ${r.refs} referenced file(s) present in ${pluginDir}`)
  if (args.includes('--smoke')) {
    const s = smoke(pluginDir, r.entries)
    console.log(s.log.join('\n'))
    if (s.fails.length) { console.error(`smoke FAILED: ${s.fails.length} check(s)`); process.exit(1) }
    console.log('smoke passed')
  }
}
