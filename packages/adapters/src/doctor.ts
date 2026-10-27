/**
 * `riposte-action --doctor` (2026-10-05, the policy-error ruling): check the setup the PreToolUse hook
 * would run with, from the same environment, and say what it does on each class of call. Run it at install and after any
 * change to the policy or the environment. It is where the friction of a policy error lands: on the operator, once, before
 * any call, instead of on the user per transaction.
 *
 * It reads (never writes): RIPOSTE_ACTION_HOOK, RIPOSTE_ACTION_POLICY (or --policy), RIPOSTE_ACTION_LEDGER (or --ledger),
 * RIPOSTE_ACTION_ON_ERROR, and whether any RIPOSTE_GOV_* is set. A problem is anything that would put the hook on the safest
 * rung (./degraded.ts): a misspelled mode, a missing, unreadable or invalid policy (each rung misspelling with "did you
 * mean"). Healthy = no problem. Warnings (the fail-open opt-out, no ledger) are printed loudly but do not fail it.
 */
import { VOICE_LADDER } from 'riposte-verify'
import { actionHookOptionsFromEnv } from './claude-code.js'
import {
  CONSEQUENTIAL_WORDS, ON_ERROR_ENV, classify, onErrorFromEnv, problemInvalid, problemMissing, problemMode, problemUnreadable,
  readPolicyLoosely, type PolicyProblem,
} from './degraded.js'
import { parseActionPolicy, type ActionPolicy } from './policy.js'

export interface DoctorIo { readFile: (path: string) => string }

export interface DoctorRow { tool: string; rung: string; tier: string; class: 'consequential' | 'record-advise'; normally: string; on_policy_error: string }

export interface DoctorReport {
  healthy: boolean
  mode: { value: string; meaning: string }
  policy: { path: string | null; actions: number | null }
  ledger: { path: string | null; from: string | null }
  on_error: 'hold' | 'open'
  governance: boolean
  actions: DoctorRow[]
  undeclared: string
  on_policy_error: { consequential: string; record_advise: string; consequential_words: readonly string[] }
  problems: PolicyProblem[]
  warnings: string[]
}

const NORMALLY: Record<string, string> = {
  record: 'a FAIL or can\'t-tell is written to the ledger; nothing in-flow; the call runs',
  advise: 'a FAIL or can\'t-tell is shown in-flow to the person and the agent; the call runs',
  gate: 'a FAIL or can\'t-tell is held for a person (ask; deny when nobody can be asked, or on a repeat); a PASS is reviewed by a person (ask)',
  autonomy: 'a FAIL or can\'t-tell is held for a person (ask; deny when nobody can be asked, or on a repeat); a PASS runs',
}

export function doctor(env: Record<string, string | undefined>, io: DoctorIo, opts: { policy?: string; ledger?: string } = {}): { healthy: boolean; text: string; report: DoctorReport } {
  const cfg = actionHookOptionsFromEnv(env)
  const onErr = onErrorFromEnv(env)
  const problems: PolicyProblem[] = []
  const warnings: string[] = []
  const policyPath = opts.policy ?? cfg.policy
  const ledgerPath = cfg.ledger ?? opts.ledger
  const governance = Object.keys(env).some((k) => /^RIPOSTE_GOV/i.test(k) && (env[k]?.trim() ?? '') !== '')

  let meaning: string
  if (cfg.mode === 'invalid') { problems.push(problemMode(cfg.modeRaw ?? '')); meaning = 'NOT A MODE: the hook runs on the safest rung until it is fixed (consequential calls held)' }
  else if (cfg.mode === 'off') meaning = 'off: the hook does nothing (one node start per call); set record-only to measure or on to enforce'
  else if (cfg.mode === 'record-only') meaning = 'record-only: every declared call is checked and recorded with what would have happened; nothing is delivered'
  else meaning = 'on: every declared call is checked and its rung is delivered'

  let policy: ActionPolicy | undefined
  let text: string | undefined
  if (!policyPath) { if (cfg.mode !== 'off') problems.push(problemMissing(cfg.mode === 'invalid' ? (cfg.modeRaw ?? '') : cfg.mode)) }
  else {
    try { text = io.readFile(policyPath) } catch (e) { problems.push(problemUnreadable(policyPath, (e as Error).message)) }
    if (text !== undefined) { try { policy = parseActionPolicy(text) } catch (e) { problems.push(problemInvalid(policyPath, text, (e as Error).message)) } }
  }
  if (onErr.problem) warnings.push(onErr.problem)
  if (onErr.onError === 'open') warnings.push(`${ON_ERROR_ENV}=open is set: on a policy error the hook FAILS OPEN (the old behaviour) and consequential calls run unheld. Each affected call prints a line and writes a receipt saying so. Unset it to hold them.`)
  if (cfg.mode !== 'off' && !ledgerPath) warnings.push('no action ledger (RIPOSTE_ACTION_LEDGER or --ledger): receipts, including governance degraded ones, are recorded to no file, and the loop guard has no memory of earlier holds')

  const reading = readPolicyLoosely(text, policy !== undefined)
  const rows: DoctorRow[] = []
  const actions = policy?.actions ?? (reading.readable === 'partial' ? [...reading.rules].map(([tool, r]) => ({ tool, level: r.level, tier: '?' })) : [])
  for (const a of actions as { tool: string; level: unknown; tier?: unknown }[]) {
    const c = classify(a.tool, reading)
    if (c.cls === 'pass-through') continue
    const rung = typeof a.level === 'string' ? a.level : JSON.stringify(a.level)
    rows.push({
      tool: a.tool, rung, tier: String(a.tier ?? '?'), class: c.cls,
      normally: (VOICE_LADDER as readonly unknown[]).includes(a.level) ? NORMALLY[a.level as string]! : 'the rung cannot be read: held on the safest rung until it is fixed',
      on_policy_error: c.cls === 'consequential' ? 'held (deny), the denial names the fix' : 'runs, with a governance degraded receipt',
    })
  }
  const healthy = problems.length === 0
  const report: DoctorReport = {
    healthy, mode: { value: cfg.mode === 'invalid' ? (cfg.modeRaw ?? '') : cfg.mode, meaning },
    policy: { path: policyPath ?? null, actions: policy ? policy.actions.length : null },
    ledger: { path: ledgerPath ?? null, from: cfg.ledger ? 'RIPOSTE_ACTION_LEDGER' : opts.ledger ? '--ledger' : null },
    on_error: onErr.onError, governance, actions: rows,
    undeclared: policy ? 'tools the policy does not declare pass through untouched' : 'while the policy cannot be read, every tool is classed by its name (see on_policy_error)',
    on_policy_error: {
      consequential: cfg.mode === 'record-only' ? 'would be held: recorded as a would-deny (record-only never delivers)' : onErr.onError === 'open' ? 'RUN UNHELD (the fail-open opt-out is set), with a receipt that says so' : 'held (deny) with a typed reason that names the fix, until the operator fixes it',
      record_advise: 'run, with a governance degraded receipt on the action ledger',
      consequential_words: CONSEQUENTIAL_WORDS,
    },
    problems, warnings,
  }

  const L: string[] = ['riposte-action doctor', '']
  L.push(`mode       RIPOSTE_ACTION_HOOK=${report.mode.value || '(unset)'}: ${meaning}`)
  L.push(`policy     ${policyPath ?? '(none)'}${policy ? `: valid, ${policy.actions.length} declared action(s)` : policyPath ? ': CANNOT BE APPLIED (see problems)' : ''}`)
  L.push(`ledger     ${ledgerPath ? `${ledgerPath} (${report.ledger.from})` : '(none)'}`)
  L.push(`on error   ${onErr.onError}${onErr.onError === 'hold' ? ' (the default: consequential calls held, others run on the record)' : ': FAIL OPEN (the opt-out)'}`)
  L.push(`governance ${governance ? 'RIPOSTE_GOV_* is set: the fleet check runs first on every call and fails closed (its own checks)' : 'not configured'}`)
  L.push('', 'What the hook does on each declared action:')
  if (!rows.length) L.push('  (none declared)')
  for (const r of rows) L.push(`  ${r.tool}  rung ${r.rung}, tier ${r.tier}, ${r.class}`, `    normally: ${r.normally}`, `    on a policy error: ${r.on_policy_error}`)
  L.push(`  undeclared tools: ${report.undeclared}`)
  L.push('', 'On a policy or equipment error (unreadable or invalid policy, misspelled mode, malformed hook input):')
  L.push(`  consequential calls (a gate or autonomy rule; with no readable rule, a name with pay, transfer, wire, refund, apply, submit, file, …): ${report.on_policy_error.consequential}`)
  L.push(`  every other call: ${report.on_policy_error.record_advise}`)
  L.push('  a document error (a FAIL or a can\'t-tell on the call\'s own values) is not a policy error: it keeps its rung, above')
  if (warnings.length) L.push('', `WARNINGS (${warnings.length}):`, ...warnings.map((w) => `  - ${w}`))
  if (problems.length) L.push('', `PROBLEMS (${problems.length}): until fixed, the hook runs on the safest rung`, ...problems.map((p) => `  - ${p.code}: ${p.problem}\n    fix: ${p.fix}`))
  L.push('', healthy ? 'healthy: the hook will apply the policy as written' : `NOT HEALTHY: ${problems.length} problem(s)`)
  return { healthy, text: `${L.join('\n')}\n`, report }
}
