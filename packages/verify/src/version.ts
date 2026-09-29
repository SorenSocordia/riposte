/**
 * Single source of version truth for the verifier.
 *
 * Every verdict records ENGINE_VERSION and the RULESET it was evaluated under, so a verdict issued
 * today can be replayed and re-audited later against exactly the rules that produced it.
 * A test asserts ENGINE_VERSION === package.json.version. Rulesets version independently of the engine.
 */

export const ENGINE_VERSION = '0.0.1'

/**
 * The default ruleset. 0.1.0 (2026-09-28): the rounding band is capped at what rounding can produce (red-team R6).
 * 0.0.1 stays resolvable as 'invoice@0.0.1' (src/rulesets/invoice/index.ts).
 */
export const RULESET = {
  id: 'invoice',
  version: '0.1.0',
  domain: 'invoice',
} as const

export const PAY_APP_RULESET_REF = {
  id: 'pay-app',
  version: '0.0.1',
  domain: 'pay-app',
} as const

export const SCHEMA_VERSION = 'v0' as const
