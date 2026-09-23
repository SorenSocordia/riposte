/**
 * Single source of version truth for the verifier.
 *
 * Every verdict records ENGINE_VERSION and the RULESET it was evaluated under, so a verdict issued
 * today can be replayed and re-audited later against exactly the rules that produced it.
 * A test asserts ENGINE_VERSION === package.json.version. Rulesets version independently of the engine.
 */

export const ENGINE_VERSION = '0.0.1'

/** The default ruleset. */
export const RULESET = {
  id: 'invoice',
  version: '0.0.1',
  domain: 'invoice',
} as const

export const PAY_APP_RULESET_REF = {
  id: 'pay-app',
  version: '0.0.1',
  domain: 'pay-app',
} as const

export const SCHEMA_VERSION = 'v0' as const
