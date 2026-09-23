/**
 * Independent replay-binding check — the first half of the portable trust primitive.
 *
 * A verdict's id is `sha256(input_hash : ruleset.id@version : engine_version).slice(0,32)` — the same derivation every
 * producer uses. This module re-derives it WITHOUT the rule engine, so any third party can confirm two things with
 * nothing but sha256 + canonical JSON:
 *   (1) the verdict_id is bound to its input_hash + ruleset version + engine  → the id/ruleset/engine weren't altered;
 *   (2) (when the original inputs are supplied) the input_hash matches those exact inputs → the verdict is FOR this doc.
 *
 * SCOPE, stated honestly: this binds the verdict to its INPUTS/ruleset/engine. It does NOT by itself attest the
 * OUTCOME (a determined function of those, but not committed to by the id) — for that, either re-execute with the engine
 * (byte-identical `replayView`) or verify a signed envelope (see ./envelope.ts). The two together = a Verifiable Verdict.
 */

import { sha256, hashOf } from '../verdict/canonical.js'
import type { Verdict } from '../verdict/schema.js'

export interface ReplayCheck {
  /** id_ok AND (input_ok when inputs were supplied). */
  ok: boolean
  /** The verdict_id correctly derives from input_hash + ruleset@version + engine_version. */
  id_ok: boolean
  /** Only present when inputs were supplied: input_hash matches hashOf(inputs). */
  input_ok?: boolean
  expected_verdict_id: string
  expected_input_hash?: string
  reason?: string
}

/** The one canonical verdict_id derivation — the single source of truth every producer and verifier must share. */
export function deriveVerdictId(input_hash: string, ruleset: { id: string; version: string }, engine_version: string): string {
  return sha256(`${input_hash}:${ruleset.id}@${ruleset.version}:${engine_version}`).slice(0, 32)
}

export function verifyReplay(verdict: Verdict, inputs?: unknown): ReplayCheck {
  const expected_verdict_id = deriveVerdictId(verdict.input_hash, verdict.ruleset, verdict.engine_version)
  const id_ok = expected_verdict_id === verdict.verdict_id
  const out: ReplayCheck = { ok: id_ok, id_ok, expected_verdict_id }
  if (!id_ok) out.reason = `verdict_id does not derive from input_hash + ruleset@version + engine_version (expected ${expected_verdict_id})`
  if (inputs !== undefined) {
    const expected_input_hash = hashOf(inputs)
    const input_ok = expected_input_hash === verdict.input_hash
    out.input_ok = input_ok
    out.expected_input_hash = expected_input_hash
    out.ok = id_ok && input_ok
    if (id_ok && !input_ok) out.reason = `input_hash does not match the supplied inputs (expected ${expected_input_hash}) — this verdict is not for these inputs`
  }
  return out
}
