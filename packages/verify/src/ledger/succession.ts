/**
 * RULESET_SUCCESSION: the replay a person signs when carrying a grant to a new ruleset version (D-RULESET-BUMP).
 *
 * A new ruleset version is a new workflow (`<tenant>/<ruleset>@<version>`), and an earned rung does not carry over by itself:
 * only a person moves a rung, and the evidence behind the old grant was gathered under the old rules. To carry it, a person
 * signs a GRANT on the new workflow that names the grant in force on the old one and carries this replay (decisions.ts
 * `Succession`): every verdict recorded under the old workflow, re-performed under the new ruleset, with how many changed,
 * in which direction, and which ones. So the signer sees which past PASSes the new rules would have held, and which past
 * holds they would have let through (a loosening, which needs its own stated reason).
 *
 * Deterministic: the same book, the same inputs and the same build give the same replay, byte for byte (the engines are
 * deterministic; the clock touches only `issued_at`, which the replay never reads). checkSuccessionReplay re-performs a
 * signed replay, so anyone holding the documents can confirm what the signer was shown.
 *
 * HONEST BOUNDARY: the book holds each verdict's input_hash, not its documents. A verdict is re-performed only when the caller
 * supplies its inputs and they hash to the verdict's input_hash; the rest are counted as not re-performed, and the succession
 * says how many. What the new ruleset says of those is unknown.
 */

import { hashOf } from '../verdict/canonical.js'
import type { Verdict } from '../verdict/schema.js'
import { verify } from '../verify.js'
import { verifyDeclarative } from '../declarative/evaluate.js'
import { isDeclarativeRuleset, type DeclarativeRuleset } from '../declarative/types.js'
import { RULESET_VERSIONS } from '../rulesets/index.js'
import type { Ruleset } from '../rulesets/types.js'
import { verifyReplay } from '../protocol/replay.js'
import type { TolerancePolicy } from '../tolerance.js'
import { engineFor, isRetainedEngine } from '../version.js'
import { grantUnderPolicy, type PromotionPolicy, type VoiceLevel } from '../verdict/voice.js'
import { GENESIS, type ChainSnapshot } from './chain.js'
import { recordWorkflow } from './sampling.js'
import type { Ledger } from './types.js'
import {
  DecisionRefused, DECISION_LEVELS, makeGrant, rulesetWorkflow,
  type DecisionEntry, type GrantDecision, type SuccessionChange, type SuccessionReplay,
} from './decisions.js'

export interface SuccessionReplayOptions {
  /**
   * The inputs a recorded verdict was issued on (the caller's document store): verify()'s `{ extraction, references, source }`,
   * or the declarative evaluator's `{ extraction, ruleset }`. Undefined: that verdict is not re-performed.
   */
  inputs: (verdict: Verdict) => unknown
  /** The new workflow's ruleset, when this build does not hold it by id@version (a declarative ruleset). */
  ruleset?: Ruleset | DeclarativeRuleset
  /** The rounding-tolerance override the old verdicts were issued under, when their inputs do not carry it (D-TOL-ID). */
  tolerance?: TolerancePolicy
  /** Replay only events 0 … through − 1 (checkSuccessionReplay: the span a signed replay names). Default: the whole book. */
  through?: number
  /**
   * The engine version to re-perform under (2026-10-03, version.ts engineFor): this build's when absent. checkSuccessionReplay
   * passes the version a signed replay names, so a replay signed under engine 0.0.1 is re-performed as 0.0.1 read it.
   */
  engine?: string
}

export interface SuccessionReplayResult {
  /** What the succession carries and the person signs (Succession.replay). */
  replay: SuccessionReplay
  /** The verdicts not re-performed, each with why: shown to the signer, not signed (the count is). Sorted by verdict_id. */
  not_reperformed: { verdict_id: string; reason: string }[]
}

type Target = { builtin: Ruleset } | { declarative: DeclarativeRuleset }

const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x)
const has = (x: Record<string, unknown>, ...keys: string[]): boolean => keys.every(k => Object.prototype.hasOwnProperty.call(x, k))
const FIXED = (): Date => new Date(0)

/** The two workflows, checked: versions of one ruleset, one tenant. Throws DecisionRefused otherwise. */
function workflows(from: string, to: string): { ruleset: string; version: string } {
  const a = rulesetWorkflow(from), b = rulesetWorkflow(to)
  if (!a || !b) throw new DecisionRefused(`a succession is between versions of one ruleset: both workflows are <tenant>/<ruleset>@<version> (${from} → ${to})`)
  if (a.tenant !== b.tenant || a.ruleset !== b.ruleset || a.version === b.version) {
    throw new DecisionRefused(`a succession carries a tenant's grant to another version of the same ruleset: ${from} → ${to} is not one`)
  }
  return { ruleset: b.ruleset, version: b.version }
}

function targetOf(to: { ruleset: string; version: string }, given: Ruleset | DeclarativeRuleset | undefined): Target | string {
  if (given !== undefined) {
    if (given.id !== to.ruleset || given.version !== to.version) return `the ruleset given is ${given.id}@${given.version}, not ${to.ruleset}@${to.version}`
    return isDeclarativeRuleset(given) ? { declarative: given } : { builtin: given as Ruleset }
  }
  const builtin = RULESET_VERSIONS.find(r => r.id === to.ruleset && r.version === to.version)
  return builtin ? { builtin } : `this build holds no ruleset ${to.ruleset}@${to.version}: pass it (a declarative ruleset) as \`ruleset\``
}

/** Re-perform one verdict's inputs under the new ruleset, or why it cannot be. */
function reperformUnder(target: Target, inputs: Record<string, unknown>, tol: TolerancePolicy | undefined, engine: string): Verdict | string {
  const tolerance = tol ?? (isObj(inputs.tolerance) ? (inputs.tolerance as unknown as TolerancePolicy) : undefined)
  let x: Record<string, unknown>
  try { x = structuredClone(inputs) } catch { x = inputs } // the engines never see the caller's objects
  if ('builtin' in target && has(x, 'extraction', 'references', 'source')) {
    const refs = isObj(x.references) ? x.references : {}
    return verify(x.extraction as Record<string, unknown>, {
      now: FIXED, ruleset: target.builtin, engine,
      references: { ...(refs.contract !== null && refs.contract !== undefined ? { contract: refs.contract as Record<string, unknown> } : {}), evidence: refs.evidence as Record<string, unknown>[], history: refs.history as Record<string, unknown>[] },
      ...(x.source !== null && x.source !== undefined ? { source: x.source as { text: string } } : {}),
      ...(tolerance ? { tolerance } : {}),
    })
  }
  if ('declarative' in target && has(x, 'extraction', 'ruleset') && isDeclarativeRuleset(x.ruleset)) {
    return verifyDeclarative(x.extraction as Record<string, unknown>, target.declarative, { now: FIXED, engine, ...(tolerance ? { tolerance } : {}) })
  }
  return `no engine re-performs inputs shaped { ${Object.keys(x).sort().join(', ')} } under ${'builtin' in target ? 'a built-in' : 'a declarative'} ruleset`
}

/**
 * Replay the verdicts recorded under `from` on this book under `to`'s ruleset: each distinct verdict (its first record), in
 * chain order. A verdict is re-performed when its inputs are supplied and bind to it (input_hash, D-TOL-ID folded) and an
 * engine in this build takes them; its recorded outcome is compared with the new ruleset's. Throws DecisionRefused when the
 * two workflows are not versions of one ruleset.
 */
export function successionReplay(book: Ledger | ChainSnapshot, from: string, to: string, opts: SuccessionReplayOptions): SuccessionReplayResult {
  const next = workflows(from, to)
  const { events, payloads } = 'snapshot' in book ? book.snapshot() : book
  const through = opts.through ?? events.length
  if (!Number.isInteger(through) || through < 0 || through > events.length) throw new DecisionRefused(`through ${through} is not a position on this book (0 to ${events.length})`)
  const target = targetOf(next, opts.ruleset)
  const engine_version = engineFor(opts.engine)
  const seen = new Set<string>()
  const changed: SuccessionChange[] = []
  const not: { verdict_id: string; reason: string }[] = []
  let reperformed = 0
  for (let i = 0; i < through; i++) {
    const ev = events[i]!
    if (ev.type !== 'RECORD' || seen.has(ev.verdict_id) || recordWorkflow(payloads[i]) !== from) continue
    seen.add(ev.verdict_id)
    const v = (payloads[i] as { verdict: Verdict }).verdict
    const skip = (reason: string): void => { not.push({ verdict_id: v.verdict_id, reason }) }
    if (typeof target === 'string') { skip(target); continue }
    const inputs = opts.inputs(v)
    if (inputs === undefined) { skip('no inputs supplied'); continue }
    if (!isObj(inputs)) { skip('the inputs are not an object'); continue }
    const bind = verifyReplay(v, inputs, opts.tolerance ? { tolerance: opts.tolerance } : {})
    if (!bind.id_ok || bind.input_ok !== true) { skip('the inputs supplied are not the ones it was issued on (they do not hash to its input_hash)'); continue }
    let again: Verdict | string
    try { again = reperformUnder(target, inputs, opts.tolerance, engine_version) } catch (e) { again = `the engine could not run on its inputs (${(e as Error).message})` }
    if (typeof again === 'string') { skip(again); continue }
    if (again.ruleset.id !== next.ruleset || again.ruleset.version !== next.version) { skip(`the engine ran ${again.ruleset.id}@${again.ruleset.version}, not ${next.ruleset}@${next.version}`); continue }
    reperformed++
    if (again.outcome !== v.outcome) changed.push({ verdict_id: v.verdict_id, from: v.outcome, to: again.outcome })
  }
  const byId = (x: { verdict_id: string }, y: { verdict_id: string }): number => (x.verdict_id < y.verdict_id ? -1 : x.verdict_id > y.verdict_id ? 1 : 0)
  return {
    replay: {
      replay_version: 'succession-replay-v0',
      through, head: through === 0 ? GENESIS : events[through - 1]!.entry_hash,
      engine_version, recorded: seen.size, reperformed, changed: changed.sort(byId),
    },
    not_reperformed: not.sort(byId),
  }
}

/**
 * Re-perform a signed succession's replay: the same span of the same book, the same inputs. `ok` when this build gives the
 * replay the person signed, byte for byte; `differences` names what differs otherwise.
 */
export function checkSuccessionReplay(book: Ledger | ChainSnapshot, grant: DecisionEntry<GrantDecision>, opts: Omit<SuccessionReplayOptions, 'through'>): { ok: boolean; replay: SuccessionReplay; differences: string[] } {
  const s = grant.signed.decision.succeeds
  if (!s) throw new DecisionRefused(`GRANT ${grant.decision_id} carries no succession`)
  // 2026-10-03: under the engine the signed replay names, when this build carries it; else this build's (which then
  // differs on engine_version, and says so).
  const signedEngine = s.replay.engine_version
  const again = successionReplay(book, s.from, grant.signed.decision.workflow_id, { ...opts, through: s.replay.through, ...(isRetainedEngine(signedEngine) ? { engine: signedEngine } : {}) }).replay
  const signed = s.replay
  const differences: string[] = []
  for (const k of ['through', 'head', 'engine_version', 'recorded', 'reperformed'] as const) {
    if (again[k] !== signed[k]) differences.push(`${k}: signed ${signed[k]}, re-performed ${again[k]}`)
  }
  const key = (c: SuccessionChange): string => `${c.verdict_id} ${c.from}→${c.to}`
  const was = new Set(signed.changed.map(key)), now = new Set(again.changed.map(key))
  for (const c of signed.changed) if (!now.has(key(c))) differences.push(`changed: signed ${key(c)}, not re-performed so`)
  for (const c of again.changed) if (!was.has(key(c))) differences.push(`changed: re-performed ${key(c)}, not in the signed replay`)
  return { ok: differences.length === 0 && hashOf(again) === hashOf(signed), replay: again, differences }
}

export interface SuccessionInput {
  /** The GRANT in force on the old workflow (its entry on the book). */
  from: DecisionEntry<GrantDecision>
  /** The new workflow. */
  to: string
  /** successionReplay(...).replay. */
  replay: SuccessionReplay
  reason: string
  signer_id: string
  signed_at: string
  /** Default: the old grant's rung. Never above it. */
  level?: VoiceLevel
  /** Default: the old grant's bounds. */
  bounds?: string
  /** Required when the replay loosens (a recorded FAIL or INSUFFICIENT_DATA the new ruleset PASSes). */
  loosening_reason?: string
  note?: string
}

/**
 * The GRANT that carries a grant to a new ruleset version: at the old grant's tier, at its rung or below, with at least its
 * signature count when it carries autonomy. With `policy`, made through grantUnderPolicy (the tier declared, the rung grantable there, the tier's
 * signature count written in) and naming that policy; without, naming the old grant's policy. Sign it with signDecision and
 * append it with ledger.decide; a tier that needs two signatures then needs a GRANT_COSIGN, as any grant does.
 */
export function successionGrant(input: SuccessionInput, policy?: PromotionPolicy): GrantDecision {
  const fd = input.from.signed.decision
  if (fd.kind !== 'GRANT') throw new DecisionRefused('a succession carries a GRANT')
  const level = input.level ?? fd.level
  if (DECISION_LEVELS.indexOf(level) > DECISION_LEVELS.indexOf(fd.level)) throw new DecisionRefused(`a succession carries a rung, it never raises one: ${level} is above the grant's ${fd.level}`)
  const bounds = input.bounds ?? fd.bounds
  const succeeds = {
    from: fd.workflow_id, grant: input.from.decision_id, reason: input.reason, replay: structuredClone(input.replay),
    ...(input.loosening_reason !== undefined ? { loosening_reason: input.loosening_reason } : {}),
  }
  const common = {
    workflow_id: input.to, level, consequence_tier: fd.consequence_tier, ...(bounds !== undefined ? { bounds } : {}),
    signer_id: input.signer_id, signed_at: input.signed_at, ...(input.note !== undefined ? { note: input.note } : {}),
    // D-DUAL carries over on autonomy: the old grant's count, never fewer (a step down needs one person, as any does).
    ...(level === 'autonomy' && fd.signatures !== undefined ? { signatures: fd.signatures } : {}), succeeds,
  }
  if (policy) return grantUnderPolicy(policy, common)
  return makeGrant({ ...common, policy: { ...fd.policy } })
}
