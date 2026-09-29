/**
 * The `riposte-action` command, as a pure function over injected I/O (the bin in ./action-cli.ts only wires real I/O).
 *
 *   riposte-action --hook [--ledger <file>]                 Claude Code PreToolUse hook. Config from the environment
 *                                                           (RIPOSTE_ACTION_HOOK, RIPOSTE_ACTION_POLICY, RIPOSTE_ACTION_LEDGER).
 *                                                           OFF unless RIPOSTE_ACTION_HOOK is record-only or on.
 *                                                           Receipts go only to RIPOSTE_ACTION_LEDGER or --ledger (D14);
 *                                                           with neither, to no file, and stderr says so.
 *   riposte-action --check --policy <file> [--moment m] [--audience a]
 *                                                           stdin {"tool", "arguments"} → stdout the full check as JSON.
 *                                                           The LangGraph and OpenAI Agents adapters call this.
 *   riposte-action --lint --policy <file>                   validate an action policy.
 *
 * Exit codes: --hook 0 (or 1 for a visible, non-blocking error when enforcing; never 2) · --check 0 checked, 3 error ·
 * --lint 0 valid, 1 invalid, 3 error.
 */
import { dirname, isAbsolute, resolve } from 'node:path'
import { AUDIENCES, MOMENTS, type Audience, type Moment } from 'riposte-ai'
import { actionHookOptionsFromEnv, countPriorHolds, noLedgerNote, preToolUseHook } from './claude-code.js'
import { checkAction } from './hold.js'
import { lintActionPolicy, parseActionPolicy, type ActionPolicy } from './policy.js'

export const ACTION_USAGE = [
  'riposte-action --hook [--ledger <file>]                       (Claude Code PreToolUse; env RIPOSTE_ACTION_HOOK=off|record-only|on, RIPOSTE_ACTION_POLICY, RIPOSTE_ACTION_LEDGER)',
  'riposte-action --check --policy <file> [--moment pre-action|done-claim|mid-flow] [--audience solo|pr|auditor]   (stdin {"tool","arguments"})',
  'riposte-action --lint --policy <file>',
].join('\n')

export interface LedgerLike { entries(): { kind: string; body: unknown }[]; append(kind: 'action_check', body: unknown): unknown }

export interface CliIo {
  stdin: () => string
  readFile: (path: string) => string
  /** open (or create) the ledger at a path */
  openLedger?: (path: string) => LedgerLike
  now?: () => Date
}

export interface CliOut { code: number; stdout: string; stderr: string }

interface Args { hook: boolean; check: boolean; lint: boolean; policy?: string; ledger?: string; moment?: string; audience?: string; help?: boolean; error?: string }

export function parseActionArgs(argv: string[]): Args {
  const out: Args = { hook: false, check: false, lint: false }
  const take = (i: number, name: string): string | undefined => { const v = argv[i]; if (!v || v.startsWith('--')) { out.error = `${name} needs a value`; return undefined } return v }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === '--help' || a === '-h') out.help = true
    else if (a === '--hook') out.hook = true
    else if (a === '--check') out.check = true
    else if (a === '--lint') out.lint = true
    else if (a === '--policy') { const v = take(++i, '--policy'); if (v) out.policy = v }
    else if (a === '--ledger') { const v = take(++i, '--ledger'); if (v) out.ledger = v }
    else if (a === '--moment') { const v = take(++i, '--moment'); if (v) out.moment = v }
    else if (a === '--audience') { const v = take(++i, '--audience'); if (v) out.audience = v }
    else out.error = `unknown argument ${a}`
    if (out.error) return out
  }
  if ([out.hook, out.check, out.lint].filter(Boolean).length > 1) out.error = 'one of --hook, --check, --lint'
  return out
}

function loadPolicy(path: string, io: CliIo): { policy: ActionPolicy; readText: (p: string) => string } {
  const policy = parseActionPolicy(io.readFile(path))
  const base = dirname(path)
  return { policy, readText: (p) => io.readFile(isAbsolute(p) ? p : resolve(base, p)) }
}

export function actionCli(argv: string[], env: Record<string, string | undefined>, io: CliIo): CliOut {
  const args = parseActionArgs(argv)
  if (args.help) return { code: 0, stdout: '', stderr: `${ACTION_USAGE}\n` }
  if (args.error) return { code: 3, stdout: '', stderr: `${args.error}\n${ACTION_USAGE}\n` }

  if (args.hook) {
    const cfg = actionHookOptionsFromEnv(env)
    const notes = cfg.problems.map((p) => `riposte-action: ${p}\n`).join('')
    if (cfg.mode === 'off') return { code: 0, stdout: '', stderr: notes }
    const failCode = cfg.mode === 'on' ? 1 : 0
    const policyPath = cfg.policy ?? args.policy
    if (!policyPath) return { code: failCode, stdout: '', stderr: `${notes}riposte-action --hook: RIPOSTE_ACTION_HOOK=${cfg.mode} but no RIPOSTE_ACTION_POLICY is set (failing open: nothing is checked)\n` }
    let loaded
    try { loaded = loadPolicy(policyPath, io) } catch (e) { return { code: failCode, stdout: '', stderr: `${notes}riposte-action --hook: ${(e as Error).message} (failing open: nothing is checked)\n` } }
    let stdin: string
    try { stdin = io.stdin() } catch (e) { return { code: failCode, stdout: '', stderr: `${notes}riposte-action --hook: cannot read stdin: ${(e as Error).message}\n` } }
    // D14: only an explicit ledger. RIPOSTE_ACTION_LEDGER, else --ledger, else none (never RIPOSTE_LEDGER).
    const ledgerPath = cfg.ledger ?? args.ledger
    let ledger: LedgerLike | undefined
    let ledgerNote = ''
    if (ledgerPath && io.openLedger) {
      try { ledger = io.openLedger(ledgerPath) } catch (e) { ledgerNote = `riposte-action: ledger not opened (${(e as Error).message}); the loop guard falls back to asking\n` }
    }
    const r = preToolUseHook(stdin, cfg.mode, {
      policy: loaded.policy, readText: loaded.readText, ...(io.now ? { now: io.now } : {}),
      ...(ledger ? { priorHolds: (s: string, h: string) => countPriorHolds(ledger!.entries(), s, h) } : {}),
    })
    if (r.record && ledger) {
      try { ledger.append('action_check', r.record) } catch (e) { ledgerNote += `riposte-action: receipt not written: ${(e as Error).message}\n` }
    } else if (r.record && !ledgerPath) {
      ledgerNote += noLedgerNote(Boolean(env.RIPOSTE_LEDGER?.trim()))
    }
    return { code: r.code, stdout: r.stdout, stderr: notes + ledgerNote + r.stderr }
  }

  if (args.check || args.lint) {
    if (!args.policy) return { code: 3, stdout: '', stderr: `--policy <file> is required\n${ACTION_USAGE}\n` }
    if (args.lint) {
      let x: unknown
      try { x = JSON.parse(io.readFile(args.policy)) } catch (e) { return { code: 3, stdout: '', stderr: `cannot read ${args.policy}: ${(e as Error).message}\n` } }
      const lint = lintActionPolicy(x)
      return { code: lint.ok ? 0 : 1, stdout: `${JSON.stringify(lint, null, 2)}\n`, stderr: lint.ok ? '' : `${lint.errors.join('\n')}\n` }
    }
    if (args.moment !== undefined && !(MOMENTS as readonly string[]).includes(args.moment)) return { code: 3, stdout: '', stderr: `--moment must be one of ${MOMENTS.join(' | ')}\n` }
    if (args.audience !== undefined && !(AUDIENCES as readonly string[]).includes(args.audience)) return { code: 3, stdout: '', stderr: `--audience must be one of ${AUDIENCES.join(' | ')}\n` }
    try {
      const { policy, readText } = loadPolicy(args.policy, io)
      const call: unknown = JSON.parse(io.stdin())
      if (call === null || typeof call !== 'object' || typeof (call as { tool?: unknown }).tool !== 'string') throw new Error('stdin must be {"tool": "<name>", "arguments": {…}}')
      const c = call as { tool: string; arguments?: unknown }
      const a = c.arguments === undefined ? {} : c.arguments
      if (a === null || typeof a !== 'object' || Array.isArray(a)) throw new Error('"arguments" must be an object')
      const r = checkAction(policy, { tool: c.tool, arguments: a as Record<string, unknown> }, {
        readText, ...(io.now ? { now: io.now } : {}),
        ...(args.moment ? { moment: args.moment as Moment } : {}), ...(args.audience ? { audience: args.audience as Audience } : {}),
      })
      return { code: 0, stdout: `${JSON.stringify(r)}\n`, stderr: '' }
    } catch (e) { return { code: 3, stdout: '', stderr: `riposte-action --check: ${(e as Error).message}\n` } }
  }
  return { code: 3, stdout: '', stderr: `nothing to do\n${ACTION_USAGE}\n` }
}
