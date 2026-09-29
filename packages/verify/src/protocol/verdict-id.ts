/**
 * The verdict_id derivation, alone in a leaf module (core-tidy, 2026-09-29). ./replay.ts re-exports it; a producer that
 * only needs the id (a twin judge, reconcile, verdict/channel.ts) imports it from here, so it does not load replay, which
 * loads every engine to re-perform a check.
 */

import { sha256 } from '../verdict/canonical.js'

/** The one canonical verdict_id derivation — the single source of truth every producer and verifier must share. */
export function deriveVerdictId(input_hash: string, ruleset: { id: string; version: string }, engine_version: string): string {
  return sha256(`${input_hash}:${ruleset.id}@${ruleset.version}:${engine_version}`).slice(0, 32)
}
