/**
 * The declarative rulesets this build carries by NAME (2026-10-03), so a caller can say `peppol-en16931` instead of
 * passing the JSON. Each is a verbatim copy of its file under docs/examples (a test compares them byte for byte, by content
 * and by the file's sha256), embedded so resolution needs no file I/O.
 *
 *   name                    resolves to
 *   peppol-en16931          the default version: 0.3.0 for engine 0.6.0 on (2026-10-05); 0.2.0 for engines
 *                           0.1.0 to 0.5.0 (from 2026-10-03); 0.1.0 before
 *   peppol-en16931@0.3.0    0.3.0  (docs/examples/peppol-en16931.ruleset.v0.3.json), the default under engine 0.6.0
 *   peppol-en16931@0.2.0    0.2.0  (docs/examples/peppol-en16931.ruleset.v0.2.json)
 *   peppol-en16931@0.1.0    0.1.0  (docs/examples/peppol-en16931.ruleset.json), kept and pinned: its verdicts replay
 *   e-invoice               the default e-invoice ruleset: peppol-en16931 at its default version
 *
 * A name that is not here is not a name (the caller reads it as a file path). A known id with a version this build does not
 * carry is refused, naming the versions it does.
 */

import type { DeclarativeRuleset } from '../declarative/types.js'
import { ENGINE_VERSION, engineAtLeast, engineFor } from '../version.js'
import { HOUSE_PEPPOL_RULESET } from '../twin-einvoice/rulesets.js'
import { PEPPOL_EN16931_V0_2_0 } from './peppol-en16931-v020.js'
import { PEPPOL_EN16931_V0_3_0 } from './peppol-en16931-v030.js'

/** Every declarative ruleset carried by name, by id and version. */
export const DECLARATIVE_RULESETS: readonly DeclarativeRuleset[] = Object.freeze([HOUSE_PEPPOL_RULESET, PEPPOL_EN16931_V0_2_0, PEPPOL_EN16931_V0_3_0])

/**
 * The version a bare id resolves to under this build's engine (ENGINE_VERSION). Peppol 0.2.0 became the default on 2026-10-03
 * (engine 0.1.0). 0.3.0 is the default for engine 0.6.0 on (2026-10-05): it is the version MISSES rows F4 (a line
 * overbilled 0.02 at a time passed) and F8 (a VAT error hidden across five rows) were fixed in, so a new verdict on the bare name
 * gets the fixed checks. A replay never resolves a bare name to this default: it re-performs under the version the verdict names
 * (protocol/replay.ts replayRulesetRef), so a 0.2.0 verdict still replays under 0.2.0.
 */
export const DECLARATIVE_DEFAULT_VERSIONS: Readonly<Record<string, string>> = Object.freeze({ 'peppol-en16931': '0.3.0' })

/** The versions a bare id resolved to under engines 0.1.0 to 0.5.0, kept for a caller that asks for one of those engines. */
export const DECLARATIVE_DEFAULT_VERSIONS_BEFORE_0_6_0: Readonly<Record<string, string>> = Object.freeze({ 'peppol-en16931': '0.2.0' })

/** The default versions under engine `engine` (this build's when absent). */
export function declarativeDefaultVersions(engine?: string): Readonly<Record<string, string>> {
  return engineAtLeast(engineFor(engine ?? ENGINE_VERSION), '0.6.0') ? DECLARATIVE_DEFAULT_VERSIONS : DECLARATIVE_DEFAULT_VERSIONS_BEFORE_0_6_0
}

/** A domain name and the ruleset id it resolves to (at that id's default version). */
export const DECLARATIVE_DOMAIN_DEFAULTS: Readonly<Record<string, string>> = Object.freeze({ 'e-invoice': 'peppol-en16931' })

const own = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k)

/** True when `ref` is a name this build resolves: a carried id or domain, with or without `@version`. */
export function isDeclarativeRulesetName(ref: unknown): ref is string {
  if (typeof ref !== 'string') return false
  const [id] = ref.split('@') as [string]
  return own(DECLARATIVE_DOMAIN_DEFAULTS, id) ? !ref.includes('@') : DECLARATIVE_RULESETS.some(r => r.id === id)
}

/**
 * The ruleset a name resolves to (a fresh copy: the caller may not change the carried one), or undefined when `ref` is not a
 * name this build carries. Throws when the id is carried but the version is not, naming the versions that are. A bare id
 * resolves to its default under `engine` (this build's engine when absent; see declarativeDefaultVersions); an id@version is
 * that version under any engine.
 */
export function resolveDeclarativeRuleset(ref: string, engine?: string): DeclarativeRuleset | undefined {
  if (!isDeclarativeRulesetName(ref)) return undefined
  const [name, asked] = ref.split('@') as [string, string | undefined]
  const id = own(DECLARATIVE_DOMAIN_DEFAULTS, name) ? DECLARATIVE_DOMAIN_DEFAULTS[name]! : name
  const version = asked ?? declarativeDefaultVersions(engine)[id] ?? latest(id)
  const hit = DECLARATIVE_RULESETS.find(r => r.id === id && r.version === version)
  if (!hit) throw new Error(`ruleset ${id}@${version} is not one this build carries; it carries ${DECLARATIVE_RULESETS.filter(r => r.id === id).map(r => `${r.id}@${r.version}`).join(', ')}`)
  return structuredClone(hit)
}

/** The highest version carried for an id (numeric, part by part). Only used when an id names no default. */
function latest(id: string): string | undefined {
  const parts = (v: string): number[] => v.split('.').map(Number)
  return DECLARATIVE_RULESETS.filter(r => r.id === id).map(r => r.version).sort((a, b) => {
    const x = parts(a), y = parts(b)
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0)
    return 0
  }).pop()
}
