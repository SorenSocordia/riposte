/**
 * The host-neutral core of every hold adapter: one proposed tool call in, one disposition out.
 *
 *   verify_action (is every consequential value grounded?)  →  actionNotice(verdict, rung)  →  disposition  →  nunchi delivery
 *
 * The adapters (Claude Code, LangGraph, OpenAI Agents) only translate the disposition into their host's vocabulary. None of
 * them re-derives a hold: HOLD / SURFACE / PROCEED is the rung's handling in verify (ACTION_HANDLING), and this module adds
 * exactly one guard on top of it (below). Deterministic: the only clock is the verdict's issued_at, injectable.
 *
 * Dispositions:
 *   pass-through  the tool is not a declared action. The adapter does nothing at all.
 *   hold          FAIL or INSUFFICIENT_DATA at gate/autonomy: the action waits until a person resolves it.
 *   review        PASS at gate: a person reviews it before it runs (ACTION_HANDLING.gate.PASS = HUMAN_REVIEW).
 *   surface       FAIL or INSUFFICIENT_DATA at advise: shown in-flow to the person and the agent; the action is not held.
 *   record        FAIL or INSUFFICIENT_DATA at record: written to the book of record; nothing in-flow; the action is not held.
 *   proceed       PASS at record/advise (Riposte does not intervene) or at autonomy (proceeds within the declared bounds).
 *
 * THE GUARD (a finding, 2026-09-28): verify's `verdictFindings` aggregates with the engine-wide rule (PASS when any claim was
 * checked and none failed), but `verifyAction` is deliberately stricter ("execute only when every value is grounded, none
 * merely can't-tell"). For a partially grounded action (the amount on an allow-list, the account number with no declared
 * source) the verdict says INSUFFICIENT_DATA while the notice said PASS / PROCEED: at gate or autonomy the ungrounded
 * account number would have gone through. The adapters therefore never deliver an outcome softer than the verdict's own:
 * when the verdict is stricter, its outcome governs and the rung's handling for that outcome applies. Logged for the verify
 * owner in the delivery report (the fix belongs in notices.ts).
 */
import { actionNotice, hashOf, verifyAction, type ActionNotice, type ActionSources, type Verdict } from 'riposte-verify'
import { DEFAULT_TIERS, deliver, factsFromNotice, type Audience, type Delivery, type Moment } from 'riposte-ai'
import { ruleFor, type ActionPolicy, type ActionRule } from './policy.js'

export type Disposition = 'pass-through' | 'hold' | 'review' | 'surface' | 'record' | 'proceed'
export const DISPOSITIONS: readonly Disposition[] = ['pass-through', 'hold', 'review', 'surface', 'record', 'proceed']

export interface ProposedCall {
  tool: string
  arguments: Record<string, unknown>
}

export interface CheckDeps {
  /** Reads a rule's `text_file`. Unreadable → the text is absent (the values then cannot be grounded in it: INSUFFICIENT_DATA). */
  readText?: (path: string) => string
  now?: () => Date
  /** Default 'pre-action' (the adapters run before the tool). */
  moment?: Moment
  /** Overrides the policy's audience. */
  audience?: Audience
}

export interface ActionCheck {
  matched: true
  tool: string
  disposition: Exclude<Disposition, 'pass-through'>
  rule: ActionRule
  workflow: string
  /** hashOf({tool, arguments}): identifies this exact call (the loop guard keys on it) */
  call_hash: string
  verdict: Verdict
  /** verify's notice, made no softer than the verdict (see THE GUARD) */
  notice: ActionNotice
  /** set when THE GUARD applied: what verify's notice said, and why the verdict's outcome governs */
  guard?: string
  delivery: Delivery
  /** non-fatal problems (e.g. an unreadable text_file), each also visible in the verdict as an abstention */
  problems: string[]
}

export type ActionCheckResult = { matched: false; tool: string; disposition: 'pass-through' } | ActionCheck

const SEVERITY = { PASS: 0, INSUFFICIENT_DATA: 1, FAIL: 2 } as const
const knownOutcome = (o: unknown): o is keyof typeof SEVERITY => typeof o === 'string' && Object.prototype.hasOwnProperty.call(SEVERITY, o)

/**
 * verify's notice, never softer than the verdict's own outcome. Returns the notice unchanged when they agree.
 *
 * FAIL CLOSED (2026-10-04): an outcome outside PASS, INSUFFICIENT_DATA and
 * FAIL, on the verdict or on the notice, is held at every rung, and the guard says so on the receipt. It used to fall through
 * the severity table and land on SURFACE, which lets the call run.
 */
export function guardNotice(verdict: Verdict, notice: ActionNotice): { notice: ActionNotice; guard?: string } {
  const v = verdict.outcome as unknown
  if (!knownOutcome(v) || !knownOutcome(notice.outcome)) {
    return {
      notice: { ...notice, action: 'HOLD' },
      guard: `the verdict reads ${JSON.stringify(v)} and verify's notice read ${JSON.stringify(notice.outcome)}/${notice.action}: an outcome outside PASS, INSUFFICIENT_DATA and FAIL is held at every rung, so this action is HOLD at rung ${notice.level}`,
    }
  }
  if (SEVERITY[v] <= SEVERITY[notice.outcome]) return { notice }
  const outcome = v as 'FAIL' | 'INSUFFICIENT_DATA'
  const action: ActionNotice['action'] = notice.handling[outcome] === 'HOLD' ? 'HOLD' : 'SURFACE'
  return {
    notice: { ...notice, outcome, action },
    guard: `verify's notice read ${notice.outcome}/${notice.action}, but the verdict itself is ${v}: the stricter outcome governs, so this action is ${action} at rung ${notice.level}`,
  }
}

/** The disposition of a (guarded) notice. An action outside HOLD, SURFACE and PROCEED holds. */
export function dispositionOf(notice: ActionNotice): Exclude<Disposition, 'pass-through'> {
  if (notice.action === 'HOLD') return 'hold'
  if (notice.action === 'SURFACE') return notice.handling.delivery === 'in-flow' ? 'surface' : 'record'
  if (notice.action === 'PROCEED') return notice.handling.PASS === 'HUMAN_REVIEW' ? 'review' : 'proceed'
  return 'hold'
}

function sourcesOf(rule: ActionRule, deps: CheckDeps, problems: string[]): ActionSources {
  const s = rule.sources ?? {}
  const out: ActionSources = {}
  if (s.allowed) out.allowed = s.allowed
  if (s.records) out.records = s.records
  if (s.require) out.require = s.require
  if (typeof s.text === 'string') out.text = s.text
  else if (typeof s.text_file === 'string') {
    if (!deps.readText) problems.push(`sources.text_file "${s.text_file}" given but no reader: the source text is absent`)
    else {
      try { out.text = deps.readText(s.text_file) } catch (e) { problems.push(`sources.text_file "${s.text_file}" could not be read (${(e as Error).message}): the source text is absent`) }
    }
  }
  return out
}

/** Check one proposed call against the policy. Throws only on a programming error; the adapters fail open on a throw. */
export function checkAction(policy: ActionPolicy, call: ProposedCall, deps: CheckDeps = {}): ActionCheckResult {
  const rule = ruleFor(policy, call.tool)
  if (!rule) return { matched: false, tool: call.tool, disposition: 'pass-through' }
  const problems: string[] = []
  const args = call.arguments ?? {}
  const verdict = verifyAction({ tool: call.tool, arguments: args }, sourcesOf(rule, deps, problems), deps.now ? { now: deps.now } : {})
  const g = guardNotice(verdict, actionNotice(verdict, rule.level))
  const delivery = deliver(factsFromNotice(g.notice, `tool ${call.tool}`), {
    moment: deps.moment ?? 'pre-action',
    tier: rule.tier,
    tiers: policy.tiers ?? DEFAULT_TIERS,
    audience: deps.audience ?? policy.audience ?? 'solo',
  })
  return {
    matched: true,
    tool: call.tool,
    disposition: dispositionOf(g.notice),
    rule,
    workflow: rule.workflow ?? call.tool,
    call_hash: hashOf({ tool: call.tool, arguments: args }),
    verdict,
    notice: g.notice,
    ...(g.guard ? { guard: g.guard } : {}),
    delivery,
    problems,
  }
}
