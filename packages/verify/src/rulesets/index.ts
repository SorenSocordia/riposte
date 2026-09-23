/**
 * The ruleset registry. Adding a document type = adding a folder under src/rulesets/ and one line here.
 */

import { INVOICE_RULESET } from './invoice/index.js'
import { PAY_APP_RULESET } from './pay-app/index.js'
import type { Ruleset } from './types.js'

export const RULESETS: readonly Ruleset[] = [INVOICE_RULESET, PAY_APP_RULESET]

const BY_ID = new Map<string, Ruleset>(RULESETS.map(r => [r.id, r]))

export type RulesetId = 'invoice' | 'pay-app'

/** Resolve a ruleset by id (or pass one through). Unknown ids throw — a verdict must never be issued under a ruleset that doesn't exist. */
export function resolveRuleset(r: string | Ruleset | undefined): Ruleset {
  if (r === undefined) return INVOICE_RULESET
  if (typeof r !== 'string') return r
  const hit = BY_ID.get(r)
  if (!hit) throw new Error(`unknown ruleset "${r}"; known: ${[...BY_ID.keys()].join(', ')}`)
  return hit
}

export { INVOICE_RULESET, PAY_APP_RULESET }
export type { Ruleset, RulesetRef, ComputeInput, ComputeOutput, Absence, AbsenceMap } from './types.js'
