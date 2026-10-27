/**
 * The action policy: which tool calls are consequential, at which rung each one runs, its consequence tier, and where its
 * values must come from. A PERSON writes this file. Nothing in Riposte edits it; nothing moves a rung (a design rule:
 * "the human should be allowed to choose demotion or promotion").
 *
 *   {
 *     "policy_version": "riposte-action-policy-v0",
 *     "tiers": ["low", "moderate", "high", "severe"],          // ascending consequence (default: verify's example tiers)
 *     "audience": "solo",                                       // solo | pr | auditor (how notices are worded)
 *     "actions": [
 *       { "tool": "mcp__bank__transfer", "workflow": "ap.transfer", "level": "gate", "tier": "severe", "set_by": "controller@example.com",
 *         "sources": { "allowed": { "to_account": ["220-000-1111"] }, "require": ["to_account", "amount"] } },
 *       { "tool": "mcp__bank__pay_invoice", "level": "gate", "tier": "severe",
 *         "sources": { "records": [{ "amount": 500, "to_account": "220-000-1111" }, { "amount": 900, "to_account": "330-000-2222" }] } }
 *     ]
 *   }
 *
 * A tool that is not listed passes through untouched: the adapters only ever act on declared actions.
 *
 * DECISION (fork point: when the ledger's signed GRANT event lands): the rung is read from this file. Once a grant is a
 * signed chain event, `level` should be resolved from the book of record, with this file's value as a cross-check that
 * refuses to run on a mismatch.
 */
import { VOICE_LADDER, type VoiceLevel } from 'riposte-verify'
import { AUDIENCES, DEFAULT_TIERS, type Audience } from 'riposte-ai'
import { didYouMean } from './degraded.js'

/** "; got 'gaet', did you mean gate?" when the value is a string close to one of the options (2026-10-05). */
const got = (v: unknown, options: readonly string[]): string => {
  if (typeof v !== 'string') return ''
  const m = didYouMean(v, options)
  return `; got '${v}'${m ? `, did you mean ${m}?` : ''}`
}

export const ACTION_POLICY_VERSION = 'riposte-action-policy-v0'

export interface ActionRuleSources {
  /** Per-argument allow-lists of approved values (verify_action's `allowed`). */
  allowed?: Record<string, (string | number)[]>
  /**
   * Approved records (verify_action's `records`): each one argument values approved TOGETHER, e.g. one invoice's amount and
   * payee account. The arguments they name must all equal ONE record, so an amount approved for one invoice paid to another
   * invoice's account is refused. Every record names the same arguments, and they are the tool's argument names.
   */
  records?: Record<string, string | number>[]
  /** Which arguments must be grounded (default: every top-level scalar argument). */
  require?: string[]
  /** Source text the values may be quoted from (distinctive strings only; numbers need an allow-list). */
  text?: string
  /** Or a file holding that text, relative to the policy file. */
  text_file?: string
}

export interface ActionRule {
  /** The tool name exactly as the host reports it (Claude Code: `mcp__server__tool`, `Bash`…; LangGraph / OpenAI: the tool's name). */
  tool: string
  /** The workflow this action belongs to (for the ledger and, later, per-workflow voice). Default: the tool name. */
  workflow?: string
  /** The rung a person set: record | advise | gate | autonomy. */
  level: VoiceLevel
  /** The declared consequence tier (one of `tiers`). Delivery weight follows it; the top tier is the values floor. */
  tier: string
  /** Who set the rung. Recorded on every receipt. */
  set_by?: string
  sources?: ActionRuleSources
}

export interface ActionPolicy {
  policy_version: typeof ACTION_POLICY_VERSION
  tiers?: string[]
  audience?: Audience
  actions: ActionRule[]
}

export interface PolicyLintResult { ok: boolean; errors: string[] }

const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x)

const isApprovedValue = (x: unknown): boolean => typeof x === 'string' || typeof x === 'number'

/**
 * Why `x` is not a usable list of approved records, or undefined: an empty list, an empty record, a value that is not a string
 * or number, or records that name different arguments (a record missing an argument the others name could never ground it).
 */
function recordsProblem(x: unknown): string | undefined {
  if (!Array.isArray(x) || x.length === 0) return 'must be a non-empty array of approved records, each { <argument>: <approved value> }'
  let names: string | undefined
  for (const [i, r] of x.entries()) {
    if (!isObj(r) || Object.keys(r).length === 0) return `[${i}] must be a non-empty object: { <argument>: <approved value> }`
    const bad = Object.entries(r).find(([, v]) => !isApprovedValue(v))
    if (bad) return `[${i}].${bad[0]} must be a string or a number (an approved value)`
    const these = Object.keys(r).sort().join(', ')
    if (names === undefined) names = these
    else if (these !== names) return `[${i}] names ${these}, but [0] names ${names}: every record must name the same arguments`
  }
  return undefined
}

/** Validate a policy. Refuses rather than guesses: an unknown rung, an undeclared tier or a duplicate tool is an error. */
export function lintActionPolicy(x: unknown): PolicyLintResult {
  const errors: string[] = []
  if (!isObj(x)) return { ok: false, errors: ['the policy must be a JSON object'] }
  if (x.policy_version !== ACTION_POLICY_VERSION) errors.push(`policy_version must be "${ACTION_POLICY_VERSION}"`)
  let tiers: readonly string[] = DEFAULT_TIERS
  if (x.tiers !== undefined) {
    if (!Array.isArray(x.tiers) || x.tiers.length === 0 || !x.tiers.every((t) => typeof t === 'string' && t)) errors.push('tiers must be a non-empty array of tier names, ascending in consequence')
    else if (new Set(x.tiers).size !== x.tiers.length) errors.push('tiers must not repeat a name')
    else tiers = x.tiers as string[]
  }
  if (x.audience !== undefined && !(AUDIENCES as readonly unknown[]).includes(x.audience)) errors.push(`audience must be one of ${AUDIENCES.join(' | ')}`)
  if (!Array.isArray(x.actions)) return { ok: false, errors: [...errors, 'actions must be an array'] }
  const seen = new Set<string>()
  x.actions.forEach((a, i) => {
    const at = `actions[${i}]`
    if (!isObj(a)) { errors.push(`${at} must be an object`); return }
    if (typeof a.tool !== 'string' || !a.tool) errors.push(`${at}.tool must be a tool name`)
    else if (seen.has(a.tool)) errors.push(`${at}.tool "${a.tool}" is declared twice`)
    else seen.add(a.tool)
    if (!(VOICE_LADDER as readonly unknown[]).includes(a.level)) errors.push(`${at}.level must be one of ${VOICE_LADDER.join(' | ')} (a rung a person set)${got(a.level, VOICE_LADDER)}`)
    if (typeof a.tier !== 'string' || !tiers.includes(a.tier)) errors.push(`${at}.tier must be one of the declared tiers (${tiers.join(', ')})${got(a.tier, tiers)}`)
    if (a.workflow !== undefined && typeof a.workflow !== 'string') errors.push(`${at}.workflow must be a string`)
    if (a.set_by !== undefined && typeof a.set_by !== 'string') errors.push(`${at}.set_by must be a string`)
    if (a.sources !== undefined) {
      const s = a.sources
      if (!isObj(s)) { errors.push(`${at}.sources must be an object`); return }
      if (s.allowed !== undefined) {
        if (!isObj(s.allowed) || !Object.values(s.allowed).every((v) => Array.isArray(v) && v.every((y) => typeof y === 'string' || typeof y === 'number'))) {
          errors.push(`${at}.sources.allowed must map argument names to arrays of approved strings or numbers`)
        }
      }
      if (s.records !== undefined) {
        const problem = recordsProblem(s.records)
        if (problem) errors.push(`${at}.sources.records ${problem}`)
      }
      if (s.require !== undefined && !(Array.isArray(s.require) && s.require.every((r) => typeof r === 'string'))) errors.push(`${at}.sources.require must be an array of argument names`)
      if (s.text !== undefined && typeof s.text !== 'string') errors.push(`${at}.sources.text must be a string`)
      if (s.text_file !== undefined && typeof s.text_file !== 'string') errors.push(`${at}.sources.text_file must be a path`)
      if (s.text !== undefined && s.text_file !== undefined) errors.push(`${at}.sources: give text or text_file, not both`)
    }
  })
  return { ok: errors.length === 0, errors }
}

/** Parse and validate a policy from JSON text. Throws with every problem listed. */
export function parseActionPolicy(text: string): ActionPolicy {
  let x: unknown
  try { x = JSON.parse(text) } catch (e) { throw new Error(`the action policy is not JSON: ${(e as Error).message}`) }
  const lint = lintActionPolicy(x)
  if (!lint.ok) throw new Error(`the action policy is invalid: ${lint.errors.join('; ')}`)
  return x as ActionPolicy
}

/** The rule for a tool, or undefined (the tool is not a declared action: pass it through). */
export function ruleFor(policy: ActionPolicy, tool: string): ActionRule | undefined {
  return policy.actions.find((a) => a.tool === tool)
}
