/**
 * Rule mining: propose the rules behind a set of labelled approve/hold decisions, judge them against an exact null,
 * and compile the survivors into an enforceable declarative ruleset.
 *
 *   const { cases, excluded } = apCasesToTable(distilCases)          // or build a CaseTable yourself
 *   const report = mine({ cases, excluded }, AP_MINE_SCHEMA)          // CANDLES + MORGUE, deterministic
 *   const { ruleset } = compileRuleset(report)                        // → verify(doc, { ruleset })
 */

import type { CaseTable, MineCase } from './types.js'

export { mine, resolveMineOptions, validateCaseTable, MINE_VERSION } from './miner.js'
export { buildGrammar, validateSchema, violated, renderTerm, DEFAULT_T_GRID, DEFAULT_EPS, type PreparedCase } from './grammar.js'
export { tally, learnT, judgeConsistency, judgeGrounding, judgeNovelty, allowedApproved, type Tally, type GroundingGates, type NoveltyInput, type NoveltyDecision } from './judges.js'
export { hypergeomAllHolds, hypergeomUpperTail, groundingP } from './stats.js'
export { compileRuleset, caseToExtraction, type CompiledRuleset, type CompileOptions } from './compile.js'
export { apCasesToTable, AP_MINE_SCHEMA, type DistilApCase } from './ap.js'
export type * from './types.js'

/** Parse JSON Lines (blank lines skipped). A bad line throws with its 1-based line number. */
export function parseJsonl(text: string): unknown[] {
  const out: unknown[] = []
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return
    try { out.push(JSON.parse(line)) } catch (e) { throw new Error(`line ${i + 1}: invalid JSON (${(e as Error).message})`) }
  })
  return out
}

/** Rows of a case-table JSONL file (`{ id, label, fields, lines? }` per line) → a CaseTable. A numeric id becomes a string; everything else is validated in mine(). */
export function caseTableFromRows(rows: unknown[]): CaseTable {
  return { cases: rows.map((r) => (r && typeof r === 'object' && typeof (r as { id?: unknown }).id === 'number' ? { ...(r as object), id: String((r as { id: number }).id) } : r)) as MineCase[] }
}
