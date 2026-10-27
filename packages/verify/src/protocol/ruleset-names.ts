/**
 * The declarative ruleset names this build carries, read from the carried list itself (2026-10-05): the CLI's
 * help, its "no ruleset named X" message, the HTTP router's refusal and the MCP tool descriptions all print these, so none of them
 * can go stale when a version is added or the default moves (the MCP description still said peppol-en16931 = 0.2.0 after 0.3.0
 * became the default for new verdicts).
 */
import { DECLARATIVE_RULESETS, DECLARATIVE_DOMAIN_DEFAULTS, resolveDeclarativeRuleset } from '../rulesets/declarative.js'

/** Every declarative name: each carried id (at its default version), each id@version, then each domain name. */
export function carriedRulesetNames(): string[] {
  const ids = [...new Set(DECLARATIVE_RULESETS.map(r => r.id))]
  return [...ids, ...DECLARATIVE_RULESETS.map(r => `${r.id}@${r.version}`), ...Object.keys(DECLARATIVE_DOMAIN_DEFAULTS)]
}

/** The version a carried name resolves to for a new verdict under this build's engine, or '?' when this build lacks it. */
export function carriedDefaultVersion(name: string): string {
  try { return resolveDeclarativeRuleset(name)?.version ?? '?' } catch { return '?' }
}
