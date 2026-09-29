/**
 * The ruleset registry. Adding a document type = adding a folder under src/rulesets/ and one line here.
 */

import { INVOICE_RULESET, INVOICE_RULESET_V0_0_1 } from './invoice/index.js'
import { PAY_APP_RULESET } from './pay-app/index.js'
import type { Ruleset } from './types.js'

export const RULESETS: readonly Ruleset[] = [INVOICE_RULESET, PAY_APP_RULESET]

/**
 * Every version this build can evaluate under, current and retained. A changed rule never keeps its old label, and a
 * retained version stays resolvable ('invoice@0.0.1') so the verdicts issued under it can be re-performed.
 */
export const RULESET_VERSIONS: readonly Ruleset[] = [...RULESETS, INVOICE_RULESET_V0_0_1]

const BY_ID = new Map<string, Ruleset>(RULESETS.map(r => [r.id, r]))
const BY_REF = new Map<string, Ruleset>(RULESET_VERSIONS.map(r => [`${r.id}@${r.version}`, r]))

export type RulesetId = 'invoice' | 'pay-app'

/**
 * Resolve a ruleset by id (its current version), by 'id@version' (any version this build retains), or pass one through.
 * Unknown ids throw — a verdict must never be issued under a ruleset that doesn't exist.
 */
export function resolveRuleset(r: string | Ruleset | undefined): Ruleset {
  if (r === undefined) return INVOICE_RULESET
  if (typeof r !== 'string') return r
  const hit = BY_ID.get(r) ?? BY_REF.get(r)
  if (!hit) throw new Error(`unknown ruleset "${r}"; known: ${[...BY_ID.keys(), ...BY_REF.keys()].join(', ')}`)
  return hit
}

export { INVOICE_RULESET, INVOICE_RULESET_V0_0_1, PAY_APP_RULESET }
export type { Ruleset, RulesetRef, ComputeInput, ComputeOutput, Absence, AbsenceMap } from './types.js'
