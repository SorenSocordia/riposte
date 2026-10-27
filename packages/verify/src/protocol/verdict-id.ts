/**
 * The verdict_id derivation, alone in a leaf module (core-tidy, 2026-09-29). ./replay.ts re-exports it; a producer that
 * only needs the id (a twin judge, reconcile, verdict/channel.ts) imports it from here, so it does not load replay, which
 * loads every engine to re-perform a check.
 *
 * Engine 0.2.0 (2026-10-03): a verdict also binds the remedy table it was answered from. Its `remedy_table_hash` is the sha256
 * of that table (canonical JSON), and the id derives from it as a fourth part. A verdict without one (every verdict of engines
 * 0.0.1 and 0.1.0) derives from the three parts exactly as before.
 */

import { hashOf, sha256 } from '../verdict/canonical.js'

/** The one canonical verdict_id derivation — the single source of truth every producer and verifier must share. */
export function deriveVerdictId(input_hash: string, ruleset: { id: string; version: string }, engine_version: string, remedy_table_hash?: string): string {
  const base = `${input_hash}:${ruleset.id}@${ruleset.version}:${engine_version}`
  return sha256(remedy_table_hash === undefined ? base : `${base}:${remedy_table_hash}`).slice(0, 32)
}

/** True for an engine whose verdicts bind their remedy table (0.2.0 and later; 0.0.1 and 0.1.0 never did). */
export function bindsRemedyTable(engine_version: string): boolean {
  return engine_version !== '0.0.1' && engine_version !== '0.1.0'
}

/** The hash a verdict carries for the remedy table it was answered from (an engine without declared remedies hashes {}). */
export function remedyTableHashOf(table: unknown): string {
  return hashOf(table ?? {})
}

/**
 * A verdict's identity fields under `engine_version`: its id, and from engine 0.2.0 the hash of its remedy table. Spread the
 * result into the verdict so the hash sits beside the id it feeds.
 */
export function verdictIdentity(input_hash: string, ruleset: { id: string; version: string }, engine_version: string, table: unknown): { verdict_id: string; remedy_table_hash?: string } {
  if (!bindsRemedyTable(engine_version)) return { verdict_id: deriveVerdictId(input_hash, ruleset, engine_version) }
  const remedy_table_hash = remedyTableHashOf(table)
  return { verdict_id: deriveVerdictId(input_hash, ruleset, engine_version, remedy_table_hash), remedy_table_hash }
}
