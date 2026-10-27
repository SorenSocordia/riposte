/**
 * The named aggregation rules: how a verdict's outcome follows from its claims. A verdict names the rule it actually uses, and
 * every reader that recomputes an outcome (the book's door, a dispute opinion) recomputes with the rule named, never an assumed one.
 *
 *   ANY_FAIL_FAILS                                 FAIL if any claim FAILs; else INSUFFICIENT_DATA if no claim could run; else PASS
 *   ANY_FAIL_FAILS_CONSISTENCY_ALONE_NEVER_PASSES  FAIL if any claim FAILs; else PASS only if a claim of a kind other than
 *                                                  CONSISTENCY PASSed; else INSUFFICIENT_DATA
 *
 * The second (added 2026-09-29) is for a verdict that checks a document against itself (CONSISTENCY claims) as well as the values
 * checked against it: an internal inconsistency still FAILs it, but the document agreeing with itself never stands in for values
 * nobody verified. The e-invoice twin names it since 0.3.0 (its footing claims are CONSISTENCY; its extracted values are not).
 */
import type { Aggregation, ClaimKind, Outcome } from './schema.js'
import { engineAtLeast, isRetainedEngine } from '../version.js'

export const AGGREGATIONS: readonly Aggregation[] = ['ANY_FAIL_FAILS', 'ANY_FAIL_FAILS_CONSISTENCY_ALONE_NEVER_PASSES']

/**
 * What a GATE reads from a verdict (2026-10-03). The verdict keeps its three outcomes; a gate reads four:
 *
 *   PASS               the verdict PASSes and every deterministic claim ran and held
 *   PASS-WITH-OPEN     the verdict PASSes, but at least one deterministic claim could not run (an open ABSTAIN)
 *   FAIL               the verdict FAILs
 *   INSUFFICIENT_DATA  no claim could run
 *
 * Under ANY_FAIL_FAILS a can't-tell never blocks PASS: a lien waiver with its statutory notice missing PASSes on the checks
 * that ran. A gate that acts on money (or anything else that cannot be taken back) must not read that as PASS, so every gate
 * in this package and in receipts holds on PASS-WITH-OPEN (`holdsAtGate`).
 *
 * Why a gate reading and not a new aggregation rule: the verdict is a proof object with three outcomes (VERDICT-SCHEMA v0,
 * rule 1). A fourth outcome, or a stricter default aggregation, would change the recorded outcome of every verdict that has
 * an open claim, so every such verdict already issued would stop replaying byte for byte. The gate reading is a pure
 * function of the claims, so any reader recomputes it; nothing recorded changes.
 *
 * A judgement-tier (REASONED) abstention does not open a verdict: judgement never hardens a gate (verdict/notices.ts).
 */
export type GateStatus = 'PASS' | 'PASS-WITH-OPEN' | 'FAIL' | 'INSUFFICIENT_DATA'

/**
 * HELD-SUSPECT (engine 0.2.0, 2026-10-03): a deterministic claim that could not read a value, where a reading of that value one
 * character away FAILs the check (ClaimVerdict.suspect). The gate BOOKS it as a FAIL: gateStatus returns FAIL, so every gate
 * (this package's, receipts', the adapters') blocks and records a FAIL against the document, and a garbled character can no
 * longer turn a FAIL into an open check. `gateLabel` names it HELD-SUSPECT for a person. A ruleset that says
 * `"held_suspect": false` makes no suspect claims, so its unreadable values stay plain holds (PASS-WITH-OPEN).
 */
export type GateLabel = GateStatus | 'HELD-SUSPECT' | 'OPEN'

type GateClaim = { outcome: Outcome; tier?: string; suspect?: unknown }

/**
 * OPEN (engine 0.3.0, 2026-10-03: the product ruling "not an automatic fail, a flag, and a report with evidence"). A verdict
 * whose outcome is not FAIL and which has a struck LOAD-BEARING field (a field at least one claim waits on: unreadable,
 * suspect, withdrawn, unsupported-assertion or conflict; `Verdict.would_unlock`) is OPEN: not PASS, not FAIL. It resolves by
 * evidence (a CORRECT or CORROBORATE move), by a STRIKE (UNSUPPORTED), or by its clock (UNSUPPORTED), never by a typed value.
 *
 * `gateStatus` keeps its four values, because receipts and the adapters compile against them: there an OPEN verdict reads
 * PASS-WITH-OPEN (or INSUFFICIENT_DATA when nothing ran). Both hold; neither is PASS or FAIL. `gateStatusOpen` names it.
 * A computed FAIL elsewhere in the verdict stays FAIL: a struck field never rescues a check that ran and failed.
 */
export type GateStatusOpen = GateStatus | 'OPEN'

type StruckView = { would_unlock?: readonly { claims: readonly string[] }[] }

/** True when a verdict (engine 0.3.0) has a struck field some claim waits on. Always false for an earlier engine's verdict. */
export function hasStruckLoadBearing(v: StruckView): boolean {
  return (v.would_unlock ?? []).some(w => w.claims.length > 0)
}

/** The gate reading with OPEN (engine 0.3.0): OPEN for a non-FAIL verdict with a struck load-bearing field; else gateStatus. */
export function gateStatusOpen(v: { outcome: Outcome; claims: readonly GateClaim[] } & StruckView): GateStatusOpen {
  if (v.outcome !== 'FAIL' && hasStruckLoadBearing(v)) return 'OPEN'
  return gateStatus(v)
}

/** The deterministic claims held as suspect (engine 0.2.0); empty for every verdict of an earlier engine. */
export function heldSuspectClaims<C extends GateClaim>(v: { claims: readonly C[] }): C[] {
  return v.claims.filter(c => c.outcome === 'INSUFFICIENT_DATA' && c.tier !== 'REASONED' && c.suspect !== undefined)
}

export function gateStatus(v: { outcome: Outcome; claims: readonly GateClaim[] }): GateStatus {
  if (v.outcome === 'FAIL') return 'FAIL'
  if (heldSuspectClaims(v).length > 0) return 'FAIL' // HELD-SUSPECT is booked as a FAIL
  if (v.outcome !== 'PASS') return v.outcome
  return v.claims.some(c => c.outcome === 'INSUFFICIENT_DATA' && c.tier !== 'REASONED') ? 'PASS-WITH-OPEN' : 'PASS'
}

/**
 * What a person reads at the gate: gateStatus, except that a FAIL booked only for suspect claims reads HELD-SUSPECT (engine 0.2.0
 * verdicts), and a verdict with a struck load-bearing field reads OPEN (engine 0.3.0).
 */
export function gateLabel(v: { outcome: Outcome; claims: readonly GateClaim[] } & StruckView): GateLabel {
  if (v.outcome !== 'FAIL' && heldSuspectClaims(v).length > 0) return 'HELD-SUSPECT'
  if (v.outcome !== 'FAIL' && hasStruckLoadBearing(v)) return 'OPEN'
  return gateStatus(v)
}

/** The claims that keep a PASS verdict open at a gate: deterministic claims that could not run. */
export function openClaims<C extends { outcome: Outcome; tier?: string }>(v: { claims: readonly C[] }): C[] {
  return v.claims.filter(c => c.outcome === 'INSUFFICIENT_DATA' && c.tier !== 'REASONED')
}

/** Only a clean PASS goes through a gate. */
export const holdsAtGate = (s: GateStatus): boolean => s !== 'PASS'

/**
 * The gate reading a verdict RECORDS (engine 0.6.0, 2026-10-05). A consumer that reads one field (a SIEM, a
 * script, a spreadsheet) read `outcome`, and `outcome: "PASS"` on an invoice whose totals could not be read looked like a pass.
 * From engine 0.6.0 every verdict carries `gate_status` beside `outcome`, so the reading is in the record itself:
 *
 *   PASS               the verdict PASSes, every deterministic claim ran and held, and no load-bearing field is struck
 *   PASS_WITH_OPEN     every check that ran held, but at least one could not run (an open deterministic claim, or a struck
 *                      load-bearing field: what a person reads as OPEN reads PASS_WITH_OPEN here)
 *   FAIL               the verdict FAILs (or, engine 0.2.0 only, a claim is held as suspect)
 *   INSUFFICIENT_DATA  no claim could run
 *
 * The record's spelling uses an underscore, like INSUFFICIENT_DATA; a person reads `PASS-WITH-OPEN` (gateStatus). `outcome` keeps
 * its meaning (the named aggregation over the claims), so nothing that reads `outcome` changes. A pure function of the verdict:
 * a replay re-derives it and compares it like any engine output.
 */
export type RecordedGateStatus = 'PASS' | 'PASS_WITH_OPEN' | 'FAIL' | 'INSUFFICIENT_DATA'

/** The value `gate_status` records for a verdict (see RecordedGateStatus). */
export function recordedGateStatus(v: { outcome: Outcome; claims: readonly GateClaim[] } & StruckView): RecordedGateStatus {
  const s = gateStatus(v)
  if (s === 'PASS-WITH-OPEN') return 'PASS_WITH_OPEN'
  if (s === 'PASS' && hasStruckLoadBearing(v)) return 'PASS_WITH_OPEN'
  return s
}

/** True for an engine whose verdicts record `gate_status` (0.6.0 and later). */
export function carriesGateStatus(engine_version: string): boolean {
  return isRetainedEngine(engine_version) && engineAtLeast(engine_version, '0.6.0')
}

/**
 * Record `gate_status` on a verdict of engine 0.6.0 or later, as the key right after `outcome` (in place; returned for chaining).
 * verdict/scope.ts attachScope calls it, so every issuer that closes its verdict with a scope block records it too. A verdict of
 * an earlier engine is returned unchanged, so every earlier verdict keeps its bytes.
 */
export function attachGateStatus<V extends { engine_version: string; outcome: Outcome; claims: readonly GateClaim[] } & StruckView>(v: V): V {
  if (!carriesGateStatus(v.engine_version)) return v
  const gate_status = recordedGateStatus(v)
  const o = v as unknown as Record<string, unknown>
  const entries = Object.entries(o).filter(([k]) => k !== 'gate_status')
  for (const k of Object.keys(o)) delete o[k]
  let placed = false
  for (const [k, val] of entries) {
    o[k] = val
    if (k === 'outcome') { o.gate_status = gate_status; placed = true }
  }
  if (!placed) o.gate_status = gate_status
  return v
}

/** The headline word a person reads for a gate status: PASS, PASS-WITH-OPEN, FAIL or INSUFFICIENT_DATA. */
export const gateWord = (s: RecordedGateStatus | GateStatus): GateStatus => (s === 'PASS_WITH_OPEN' ? 'PASS-WITH-OPEN' : s)

/**
 * The one headline a CLI prints for a verdict (2026-10-05), never a bare PASS when a check was open:
 *   `PASS: 13 of 13 checks ran and held`
 *   `PASS-WITH-OPEN: 3 of 13 checks could not run`
 *   `FAIL: 2 of 13 checks failed`
 *   `INSUFFICIENT_DATA: none of the 13 checks could run`
 * The status is the verdict's own `gate_status` when it records one, else the same reading recomputed from its claims (so a verdict
 * of an earlier engine reads the same way). A judgement-tier (REASONED) claim is counted, but never opens a verdict.
 */
export function gateHeadline(v: { outcome: Outcome; claims: readonly GateClaim[]; gate_status?: unknown } & StruckView): string {
  const s: RecordedGateStatus = v.gate_status === 'PASS' || v.gate_status === 'PASS_WITH_OPEN' || v.gate_status === 'FAIL' || v.gate_status === 'INSUFFICIENT_DATA'
    ? v.gate_status : recordedGateStatus(v)
  const n = v.claims.length
  const checks = (k: number): string => `${k} of ${n} check${n === 1 ? '' : 's'}`
  if (s === 'FAIL') {
    const failed = v.claims.filter(c => c.outcome === 'FAIL').length
    const held = heldSuspectClaims(v).length
    return failed ? `FAIL: ${checks(failed)} failed` : `FAIL: ${checks(held)} held as suspect (a reading one character away fails)`
  }
  if (s === 'INSUFFICIENT_DATA') return n ? `INSUFFICIENT_DATA: none of the ${n} check${n === 1 ? '' : 's'} could run` : 'INSUFFICIENT_DATA: no check applied'
  const open = openClaims(v).length
  if (s === 'PASS_WITH_OPEN') return open ? `PASS-WITH-OPEN: ${checks(open)} could not run` : `PASS-WITH-OPEN: every check that ran held, and a load-bearing field is struck`
  const passed = v.claims.filter(c => c.outcome === 'PASS').length
  const judged = n - passed
  return `PASS: ${checks(passed)} ran and held${judged ? `; ${judged} judgement claim${judged === 1 ? '' : 's'} did not decide (judgement never opens a verdict)` : ''}`
}

/** The outcome `claims` give under `aggregation`. Deterministic; reads only each claim's outcome and kind. */
export function aggregateOutcome(aggregation: Aggregation, claims: readonly { outcome: Outcome; kind?: ClaimKind }[]): Outcome {
  if (claims.some(c => c.outcome === 'FAIL')) return 'FAIL'
  const passes = aggregation === 'ANY_FAIL_FAILS_CONSISTENCY_ALONE_NEVER_PASSES'
    ? claims.some(c => c.outcome === 'PASS' && c.kind !== 'CONSISTENCY')
    : claims.some(c => c.outcome === 'PASS')
  return passes ? 'PASS' : 'INSUFFICIENT_DATA'
}
