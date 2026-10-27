/**
 * The scope-and-consent line (engine 0.3.0, 2026-10-03; docs/EVIDENCE.md). Every verdict, of every engine, ends with the same
 * facts, generated from the verdict and never typed: the law and version it was checked against, the engine, the evidence
 * floor it rests on, that advisories are counsel and not verdicts, and that the user accepts a check, not a decision.
 *
 * `scopeOf` is a pure function of the verdict, so a replay re-derives it and compares it like any engine output. A verdict of
 * an engine before 0.3.0 carries none and gets none (`attachScope` leaves it alone), so every earlier verdict keeps its bytes.
 */

import type { EvidenceFloor, Verdict, VerdictScope } from './schema.js'
import { engineAtLeast, isRetainedEngine } from '../version.js'
import { attachGateStatus } from './aggregation.js'

export const SCOPE_STATEMENTS = ['advisories are counsel, not verdicts', 'this is a check, not a decision'] as const

/** The scope block a verdict carries, from the verdict itself. A verdict without an evidence floor states `unstated`. */
export function scopeOf(v: Pick<Verdict, 'ruleset' | 'engine_version' | 'evidence_floor'>): VerdictScope {
  return {
    ruleset: `${v.ruleset.id}@${v.ruleset.version}`,
    engine_version: v.engine_version,
    evidence_floor: v.evidence_floor ?? 'unstated',
    statements: SCOPE_STATEMENTS,
  }
}

/** True for an engine whose verdicts end with a scope block (0.3.0 and later). */
export function carriesScope(engine_version: string): boolean {
  return isRetainedEngine(engine_version) && engineAtLeast(engine_version, '0.3.0')
}

/**
 * Close a verdict with its scope block, as its last key (in place; returned for chaining). Every issuer calls this right after
 * attachRemedies. A verdict of an engine before 0.3.0 is returned unchanged.
 * Engine 0.6.0: it records `gate_status` too, right after `outcome` (verdict/aggregation.ts attachGateStatus), since
 * this is the one call every issuer makes once its claims are final. A verdict of an earlier engine gets no gate_status.
 */
export function attachScope<V extends Verdict>(v: V): V {
  attachGateStatus(v)
  if (!carriesScope(v.engine_version)) return v
  delete v.scope
  v.scope = scopeOf(v)
  return v
}

const FLOOR_WORDS: Record<EvidenceFloor, string> = {
  E0: 'E0 (a system of record, through an authenticated channel)',
  E1: 'E1 (a structured document)',
  E2: 'E2 (a PDF text layer)',
  E3: 'E3 (OCR of a scan)',
  E4: 'E4 (an assertion)',
  unstated: 'unstated (the values carry no provenance: the extraction is checked as given)',
  none: 'none (no check was computed)',
}

/** The scope block as the closing lines of a human-readable report. */
export function renderScope(s: VerdictScope): string[] {
  return [
    `Scope: checked against ${s.ruleset} by engine ${s.engine_version}; evidence floor ${FLOOR_WORDS[s.evidence_floor] ?? s.evidence_floor}.`,
    'Advisories are counsel, not verdicts.',
    'This is a check, not a decision.',
  ]
}

/** The scope lines for any verdict-shaped object: its own block, or none for a verdict that carries none. */
export function scopeLines(v: { scope?: VerdictScope } | undefined): string[] {
  return v?.scope ? renderScope(v.scope) : []
}
