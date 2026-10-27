/**
 * The `riposte-action` command, as a pure function over injected I/O (the bin in ./action-cli.ts only wires real I/O).
 *
 *   riposte-action --hook [--ledger <file>]                 Claude Code PreToolUse hook. Config from the environment
 *                                                           (RIPOSTE_ACTION_HOOK, RIPOSTE_ACTION_POLICY, RIPOSTE_ACTION_LEDGER,
 *                                                           RIPOSTE_ACTION_ON_ERROR).
 *                                                           OFF unless RIPOSTE_ACTION_HOOK is set. With any
 *                                                           RIPOSTE_GOV_* set, the governance check (./governance.ts) runs
 *                                                           first on every call, whatever the mode, and fails closed.
 *                                                           Receipts go only to RIPOSTE_ACTION_LEDGER or --ledger;
 *                                                           with neither, to no file, and stderr says so.
 *                                                           A policy error (missing, unreadable or invalid policy, misspelled
 *                                                           mode, malformed input) fails to the safest rung (./degraded.ts).
 *   riposte-action --doctor [--policy <file>] [--json]      check the setup the hook would run with (the same environment)
 *                                                           and print what it does on each class of call; run it at install
 *                                                           and after every change to the policy or the environment.
 *   riposte-action --check --policy <file> [--moment m] [--audience a]
 *                                                           stdin {"tool", "arguments"} → stdout the full check as JSON.
 *                                                           The LangGraph and OpenAI Agents adapters call this.
 *   riposte-action --lint --policy <file>                   validate an action policy.
 *
 * Exit codes: --hook 0 (1 only for a visible, non-blocking error under the fail-open opt-out; never 2) · --doctor 0 healthy,
 * 1 a problem the hook would run degraded on, 3 usage · --check 0 checked, 3 error · --lint 0 valid, 1 invalid, 3 error.
 */
import { dirname, isAbsolute, resolve } from 'node:path'
import { AUDIENCES, MOMENTS, type Audience, type Moment } from 'riposte-ai'
import { actionHookOptionsFromEnv, countPriorHolds, degradedHook, noLedgerNote, preToolUseHook } from './claude-code.js'
import {
  problemBadInput, problemInvalid, problemMissing, problemMode, problemUnreadable, onErrorFromEnv, readPolicyLoosely,
  type PolicyProblem, type PolicyReading,
} from './degraded.js'
import { doctor } from './doctor.js'
import { governanceFromEnv, governanceHook, type CheckerRunner, type GovernanceDeps, type ReceiptWriter } from './governance.js'
import { checkAction } from './hold.js'
import { lintActionPolicy, parseActionPolicy, type ActionPolicy } from './policy.js'

export const ACTION_USAGE = [
  'riposte-action --hook [--ledger <file>]                       (Claude Code PreToolUse; env RIPOSTE_ACTION_HOOK=off|record-only|on, RIPOSTE_ACTION_POLICY, RIPOSTE_ACTION_LEDGER, RIPOSTE_ACTION_ON_ERROR=hold|open)',
  'riposte-action --doctor [--policy <file>] [--ledger <file>] [--json]   (checks the setup the hook would run with; what it does on each class)',
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
  /** governance: the checker runner (default: spawn the checker) and the receipt writer (the bin appends to a ledger) */
  runChecker?: CheckerRunner
  writeReceipt?: ReceiptWriter
}

export interface CliOut { code: number; stdout: string; stderr: string }

interface Args { hook: boolean; check: boolean; lint: boolean; doctor: boolean; json: boolean; policy?: string; ledger?: string; moment?: string; audience?: string; help?: boolean; error?: string }

export function parseActionArgs(argv: string[]): Args {
  const out: Args = { hook: false, check: false, lint: false, doctor: false, json: false }
  const take = (i: number, name: string): string | undefined => { const v = argv[i]; if (!v || v.startsWith('--')) { out.error = `${name} needs a value`; return undefined } return v }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === '--help' || a === '-h') out.help = true
    else if (a === '--hook') out.hook = true
    else if (a === '--check') out.check = true
    else if (a === '--lint') out.lint = true
    else if (a === '--doctor' || a === 'doctor') out.doctor = true
    else if (a === '--json') out.json = true
    else if (a === '--policy') { const v = take(++i, '--policy'); if (v) out.policy = v }
    else if (a === '--ledger') { const v = take(++i, '--ledger'); if (v) out.ledger = v }
    else if (a === '--moment') { const v = take(++i, '--moment'); if (v) out.moment = v }
    else if (a === '--audience') { const v = take(++i, '--audience'); if (v) out.audience = v }
    else out.error = `unknown argument ${a}`
    if (out.error) return out
  }
  if ([out.hook, out.check, out.lint, out.doctor].filter(Boolean).length > 1) out.error = 'one of --hook, --doctor, --check, --lint'
  return out
}

function loadPolicyText(path: string, text: string, io: CliIo): { policy: ActionPolicy; readText: (p: string) => string } {
  const policy = parseActionPolicy(text)
  const base = dirname(path)
  return { policy, readText: (p) => io.readFile(isAbsolute(p) ? p : resolve(base, p)) }
}
function loadPolicy(path: string, io: CliIo): { policy: ActionPolicy; readText: (p: string) => string } {
  return loadPolicyText(path, io.readFile(path), io)
}

export function actionCli(argv: string[], env: Record<string, string | undefined>, io: CliIo): CliOut {
  const args = parseActionArgs(argv)
  if (args.help) return { code: 0, stdout: '', stderr: `${ACTION_USAGE}\n` }
  if (args.error) return { code: 3, stdout: '', stderr: `${args.error}\n${ACTION_USAGE}\n` }

  if (args.doctor) {
    const d = doctor(env, io, { ...(args.policy ? { policy: args.policy } : {}), ...(args.ledger ? { ledger: args.ledger } : {}) })
    return { code: d.healthy ? 0 : 1, stdout: args.json ? `${JSON.stringify(d.report, null, 2)}\n` : d.text, stderr: '' }
  }

  if (args.hook) {
    const cfg = actionHookOptionsFromEnv(env)
    const onErr = onErrorFromEnv(env)
    const notes = [...cfg.problems, ...(onErr.problem ? [onErr.problem] : [])].map((p) => `riposte-action: ${p}\n`).join('')
    // Governance (RIPOSTE_GOV_*): runs whatever the action-policy mode, and fails closed. Its receipts go to
    // RIPOSTE_GOV_RECEIPTS, else this hook's explicit ledger (RIPOSTE_ACTION_LEDGER, then --ledger); never RIPOSTE_LEDGER.
    const gov = governanceFromEnv(env, { receiptsFallback: cfg.ledger ?? args.ledger })
    const govDeps: GovernanceDeps | undefined = gov.on ? { gov, ...(io.runChecker ? { run: io.runChecker } : {}), ...(io.writeReceipt ? { writeReceipt: io.writeReceipt } : {}) } : undefined
    if (cfg.mode === 'off') {
      if (!govDeps) return { code: 0, stdout: '', stderr: notes }
      let stdin = ''
      try { stdin = io.stdin() } catch { stdin = '' } // unreadable input: the governance check denies it
      const g = governanceHook(stdin, govDeps)
      return { code: 0, stdout: g.stdout, stderr: notes + g.stderr }
    }
    // Only an explicit ledger. RIPOSTE_ACTION_LEDGER, else --ledger, else none (never RIPOSTE_LEDGER).
    const ledgerPath = cfg.ledger ?? args.ledger
    let ledger: LedgerLike | undefined
    let ledgerNote = ''
    const openTheLedger = (): void => {
      if (ledgerPath && io.openLedger) {
        try { ledger = io.openLedger(ledgerPath) } catch (e) { ledgerNote = `riposte-action: ledger not opened (${(e as Error).message}); the loop guard falls back to asking\n` }
      }
    }
    const recordIt = (record: unknown): void => {
      if (record && ledger) {
        try { ledger.append('action_check', record) } catch (e) { ledgerNote += `riposte-action: receipt not written: ${(e as Error).message}\n` }
      } else if (record && !ledgerPath) ledgerNote += noLedgerNote(Boolean(env.RIPOSTE_LEDGER?.trim()))
    }

    // Is the action policy applicable at all? A problem here is a policy error: the safest rung (./degraded.ts).
    const failCode = cfg.mode === 'on' ? 1 : 0
    const opened = govDeps ? 'the action policy is not checked; governance still is' : 'nothing is checked'
    const policyPath = cfg.policy ?? args.policy
    let problem: PolicyProblem | undefined
    let legacy: { code: 0 | 1; stderr: string } = { code: failCode, stderr: '' }
    let reading: PolicyReading = readPolicyLoosely(undefined)
    let loaded: { policy: ActionPolicy; readText: (p: string) => string } | undefined
    let text: string | undefined
    let readError: string | undefined
    if (policyPath) { try { text = io.readFile(policyPath) } catch (e) { readError = (e as Error).message } }
    if (text !== undefined) {
      try { loaded = loadPolicyText(policyPath!, text, io); reading = readPolicyLoosely(text, true) } catch (e) {
        reading = readPolicyLoosely(text)
        problem = problemInvalid(policyPath!, text, (e as Error).message)
        legacy = { code: failCode, stderr: `riposte-action --hook: ${(e as Error).message} (failing open: ${opened})\n` }
      }
    }
    if (cfg.mode === 'invalid') {
      // a misspelled mode is the first problem named; a policy problem beside it is named too
      const extra = problem ? ` (and ${problem.problem})` : !policyPath ? '' : readError !== undefined ? ` (and the action policy ${policyPath} cannot be read: ${readError})` : ''
      const m = problemMode(cfg.modeRaw ?? '')
      problem = { ...m, problem: m.problem + extra }
      legacy = { code: 0, stderr: `riposte-action: RIPOSTE_ACTION_HOOK="${cfg.modeRaw}" is not one of off | record-only | on; staying off\n` }
    } else if (!policyPath) {
      problem = problemMissing(cfg.mode)
      legacy = { code: failCode, stderr: `riposte-action --hook: RIPOSTE_ACTION_HOOK=${cfg.mode} but no RIPOSTE_ACTION_POLICY is set (failing open: ${opened})\n` }
    } else if (readError !== undefined) {
      problem = problemUnreadable(policyPath, readError)
      legacy = { code: failCode, stderr: `riposte-action --hook: ${readError} (failing open: ${opened})\n` }
    }

    let stdin: string | undefined
    let stdinError: string | undefined
    try { stdin = io.stdin() } catch (e) { stdinError = (e as Error).message }
    if (!problem && stdinError !== undefined) {
      problem = problemBadInput(`stdin cannot be read: ${stdinError}`)
      legacy = { code: failCode, stderr: `riposte-action --hook: cannot read stdin: ${stdinError}\n` }
    }

    if (problem) {
      let govStderr = ''
      if (govDeps) {
        const g = governanceHook(stdin ?? '', govDeps)
        if (g.denied) return { code: 0, stdout: g.stdout, stderr: notes + g.stderr }
        govStderr = g.stderr
      }
      const r = degradedHook(stdin, { problem, mode: cfg.mode, ...(cfg.modeRaw !== undefined ? { modeRaw: cfg.modeRaw } : {}), reading, onError: onErr.onError, legacy })
      if (r.record) { openTheLedger(); recordIt(r.record) }
      return { code: r.code, stdout: r.stdout, stderr: notes + govStderr + ledgerNote + r.stderr }
    }

    openTheLedger()
    const r = preToolUseHook(stdin!, cfg.mode as 'on' | 'record-only', {
      policy: loaded!.policy, readText: loaded!.readText, onError: onErr.onError, ...(io.now ? { now: io.now } : {}),
      ...(ledger ? { priorHolds: (s: string, h: string) => countPriorHolds(ledger!.entries(), s, h) } : {}),
      ...(govDeps ? { governance: govDeps } : {}),
    })
    recordIt(r.record)
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
