/**
 * succession_replay (MCP) and POST /v1/succession/replay over a chain export: the replay a person reviews before carrying a
 * grant to a new ruleset version (RULESET_SUCCESSION, ledger/succession.ts). Stateless and read-only: nothing is signed or
 * appended here, and no private key ever passes through. Two questions:
 *   - without `check`: the grant in force on `from` (under `policy` when given), and every verdict recorded under `from`
 *     re-performed under `to`'s ruleset with the inputs supplied: the counts, each change and its direction, what loosens,
 *     and each verdict not re-performed with why. With `signer_id` and `reason` (and `policy`), also the unsigned GRANT that
 *     would carry it, to be signed where the person's key lives (`verify succession`, or signDecision + ledger.decide).
 *   - with `check` (a succession GRANT's decision id): re-perform the replay it carries over its own span
 *     (checkSuccessionReplay); `ok` when this build gives the replay the person signed, byte for byte.
 */

import { MemoryLedger } from '../ledger/memory.js'
import { grantInForce, loosens, DecisionRefused, type DecisionEntry, type GrantDecision, type SuccessionReplay } from '../ledger/decisions.js'
import { successionReplay, checkSuccessionReplay, successionGrant, type SuccessionReplayResult } from '../ledger/succession.js'
import { bookRefusal } from '../ledger/report.js'
import { isDeclarativeRuleset, type DeclarativeRuleset } from '../declarative/types.js'
import { VOICE_LADDER, type PromotionPolicy, type VoiceLevel } from '../verdict/voice.js'
import type { TolerancePolicy } from '../tolerance.js'
import type { Verdict } from '../verdict/schema.js'
import { snapshotFromJson, anchorsFromJson, policyFromJson, SurfaceInputError } from './surfaces.js'
import { governing } from './dual.js'

export interface SuccessionSurface {
  surface_version: 'succession-replay-v0'
  from: string
  to: string
  /** The grant in force on `from` that a succession would carry (null: nothing to carry). Without `check`. */
  carries?: { decision_id: string; workflow_id: string; level: VoiceLevel; consequence_tier: string; signer_id: string; seq: number } | null
  /** The replay a succession would carry, and the verdicts not re-performed with why (shown, not signed). Without `check`. */
  replay?: SuccessionReplay
  not_reperformed?: { verdict_id: string; reason: string }[]
  /** How many changes go to PASS (a recorded hold the new ruleset passes): a succession then needs a loosening_reason. */
  loosens?: number
  /** With `signer_id` and `reason`: the GRANT that would carry it, unsigned. */
  unsigned?: GrantDecision
  /** With `check`: the signed replay re-performed. */
  check?: { decision_id: string; ok: boolean; differences: string[]; signed: SuccessionReplay; reperformed: SuccessionReplay; book?: { matches: boolean; reason?: string } }
  chain: { length: number; head: string }
}

const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x)
const str = (a: Record<string, unknown>, k: string): string | undefined => {
  if (a[k] === undefined) return undefined
  if (typeof a[k] !== 'string' || !a[k]) throw new SurfaceInputError(`"${k}" must be a non-empty string`)
  return a[k] as string
}

/** `inputs`: [{ verdict_id, inputs }] or { "<verdict_id>": inputs }, the inputs each recorded verdict was issued on. */
function inputsFromJson(x: unknown): Map<string, unknown> {
  const rows = Array.isArray(x) ? x : isObj(x) ? Object.entries(x).map(([verdict_id, inputs]) => ({ verdict_id, inputs })) : undefined
  if (!rows) throw new SurfaceInputError('"inputs" is required: [{ verdict_id, inputs }] or { "<verdict_id>": inputs }, the inputs each recorded verdict was issued on')
  const out = new Map<string, unknown>()
  for (const r of rows) {
    if (!isObj(r) || typeof r.verdict_id !== 'string' || !isObj(r.inputs)) throw new SurfaceInputError('"inputs" items must be { verdict_id, inputs: { ... } }')
    if (out.has(r.verdict_id)) throw new SurfaceInputError(`"inputs" gives verdict ${r.verdict_id} twice`)
    out.set(r.verdict_id, r.inputs)
  }
  return out
}

function toleranceFromJson(x: unknown): TolerancePolicy | undefined {
  if (x === undefined) return undefined
  if (!isObj(x) || typeof x.rel !== 'number' || typeof x.absCap !== 'number' || !(x.rel >= 0) || !(x.absCap >= 0)) {
    throw new SurfaceInputError('"tolerance" must be { "rel": <fraction ≥ 0>, "absCap": <amount ≥ 0> }')
  }
  return { rel: x.rel, absCap: x.absCap }
}

export function successionFromJson(a: Record<string, unknown>): SuccessionSurface {
  const snap = snapshotFromJson(a.ledger)
  if (!snap.events) throw new SurfaceInputError('"ledger" is required: the book of record as the chain export (ledger.chainJSONL()) string, or { events, payloads }')
  const seed = { events: snap.events, payloads: snap.payloads ?? [] }
  let led: MemoryLedger
  try {
    led = new MemoryLedger({ seed, ...anchorsFromJson(a) })
  } catch (e) {
    throw new SurfaceInputError(`the book could not be read: ${(e as Error).message}`)
  }
  const db = led.decisionBook()
  if (!db.ok) throw new SurfaceInputError(bookRefusal(db))
  const inputs = inputsFromJson(a.inputs)
  if (a.ruleset !== undefined && !isDeclarativeRuleset(a.ruleset)) throw new SurfaceInputError('"ruleset" must be a declarative ruleset (a built-in one is found by the "to" version)')
  const opts = {
    inputs: (v: Verdict) => inputs.get(v.verdict_id),
    ...(a.ruleset !== undefined ? { ruleset: a.ruleset as DeclarativeRuleset } : {}),
    ...(a.tolerance !== undefined ? { tolerance: toleranceFromJson(a.tolerance)! } : {}),
  }
  const chain = { length: db.check.length, head: db.check.head }
  const ref = str(a, 'check')
  if (ref !== undefined) {
    const foreign = ['from', 'to', 'signer_id', 'reason', 'loosening_reason', 'level', 'signed_at', 'note'].filter(k => a[k] !== undefined)
    if (foreign.length) throw new SurfaceInputError(`"check" re-performs a succession already on the book: ${foreign.map(k => `"${k}"`).join(', ')} cannot be given with it`)
    if (!/^[0-9a-f]{12,}$/.test(ref)) throw new SurfaceInputError('"check" must be the succession GRANT\'s decision id (hex), or a unique prefix of at least 12 characters')
    const hits = db.decisions.filter(e => e.signed.decision.kind === 'GRANT' && e.decision_id.startsWith(ref))
    if (hits.length !== 1) throw new SurfaceInputError(hits.length ? `"check" ${ref} names ${hits.length} grants on the book: give more of the decision id` : `no GRANT ${ref} on the book`)
    const g = hits[0] as DecisionEntry<GrantDecision>
    const s = g.signed.decision.succeeds
    if (!s) throw new SurfaceInputError(`GRANT ${g.decision_id.slice(0, 12)} carries no succession: there is no replay to check`)
    const c = checkSuccessionReplay(led, g, opts)
    return {
      surface_version: 'succession-replay-v0', from: s.from, to: g.signed.decision.workflow_id,
      check: { decision_id: g.decision_id, ok: c.ok, differences: c.differences, signed: s.replay, reperformed: c.replay, ...(g.replay ? { book: g.replay } : {}) },
      chain,
    }
  }
  const from = str(a, 'from'), to = str(a, 'to')
  if (!from || !to) throw new SurfaceInputError('"from" and "to" are required (<tenant>/<ruleset>@<version>), or "check" (a succession GRANT\'s decision id)')
  const policy: PromotionPolicy | undefined = a.policy !== undefined ? policyFromJson(a.policy) : undefined
  const g = grantInForce(db.decisions, from, governing(policy))
  let r: SuccessionReplayResult
  let unsigned: GrantDecision | undefined
  try {
    r = successionReplay(led, from, to, opts)
    const signer_id = str(a, 'signer_id'), reason = str(a, 'reason')
    if (signer_id !== undefined || reason !== undefined) {
      if (!signer_id || !reason || !policy) throw new SurfaceInputError('the unsigned GRANT needs "signer_id", "reason" and "policy" together')
      if (!g) throw new SurfaceInputError(`nothing is granted on ${from}${policy ? ` under ${policy.policy_id}@${policy.version}` : ''}: there is no grant to carry`)
      const level = str(a, 'level')
      if (level !== undefined && !VOICE_LADDER.includes(level as VoiceLevel)) throw new SurfaceInputError(`"level" must be one of ${VOICE_LADDER.join(', ')}`)
      const loosening_reason = str(a, 'loosening_reason'), note = str(a, 'note')
      unsigned = successionGrant({
        from: g, to, replay: r.replay, reason, signer_id, signed_at: str(a, 'signed_at') ?? new Date().toISOString(),
        ...(level !== undefined ? { level: level as VoiceLevel } : {}),
        ...(loosening_reason !== undefined ? { loosening_reason } : {}), ...(note !== undefined ? { note } : {}),
      }, policy)
    }
  } catch (e) {
    if (e instanceof DecisionRefused) throw new SurfaceInputError(`the succession is refused: ${e.message}`)
    throw e
  }
  const gd = g?.signed.decision
  return {
    surface_version: 'succession-replay-v0', from, to,
    carries: g && gd ? { decision_id: g.decision_id, workflow_id: gd.workflow_id, level: gd.level, consequence_tier: gd.consequence_tier, signer_id: gd.signer_id, seq: g.seq } : null,
    replay: r.replay, not_reperformed: r.not_reperformed, loosens: r.replay.changed.filter(loosens).length,
    ...(unsigned ? { unsigned } : {}),
    chain,
  }
}
