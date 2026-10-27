/**
 * The fields `verify ap` writes beside its verdict, re-derived on replay (2026-10-19).
 *
 * The output of `verify ap` is its verdict plus what the AP gate decides on it: `decision`, `payable`, `grounding`, `reasons`,
 * `not_checked` (src/ap ApResult), and, when --allow-open was given, `exit` and `allow_open` (cli.ts apChoice). The emailed-bill
 * output adds `read` (the sha256 of what it read, and the policy); the structured output adds `proof` (the verdict and its inputs).
 * A replay re-performs the verdict and byte-compares it. Until this date it compared none of the fields beside it, and named none
 * of them, because they are the command's own members: a cold reader rewrote a hold to "approve, all checks passed" and the replay
 * said "outcome VERIFIED", exit 0, under --strict. Those fields are what a person acts on, so they are compared too:
 *
 *   - each is derived again from the re-performed verdict's own inputs, under the verdict's engine and ruleset (the same reading
 *     replay-case.ts replayReading pins its gate line to), and compared with the file's, canonical JSON against canonical JSON;
 *   - for the output of `verify ap` (`whole`), each of the five must be present (the command always writes them), `exit` and
 *     `allow_open` come as a pair, and a key the command never writes is a difference too (the caller passes those keys in);
 *   - for a bundle ({ verdict, inputs }), only the fields it states are compared: a bundle need not state them.
 * Any difference fails the replay by name, with or without --strict. Nothing here reads a file or prints.
 */

import type { ApResult } from '../ap/index.js'
import { verifyInvoiceMatch, type ApDocuments, type ApPolicy } from '../ap/index.js'
import { verifyBillMatch } from '../ap/structured.js'
import { apExit } from '../verdict/exit.js'
import { canonicalize } from '../verdict/canonical.js'

/** The members the AP gate derives from a verdict and `verify ap` writes beside it, in the order a replay compares them. */
export const AP_DERIVED_KEYS = ['decision', 'payable', 'grounding', 'reasons', 'not_checked'] as const
/** The members `verify ap` writes when --allow-open was given (cli.ts apChoice): this run's exit, and whether the flag applied. */
export const AP_CHOICE_KEYS = ['exit', 'allow_open'] as const
/** The rulesets whose verdicts the AP gate decides on: the emailed-bill and the structured paths. */
const AP_RULESETS: ReadonlySet<string> = new Set(['ap-threeway', 'ap-structured'])

const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x)

/** The re-derivation a verdict's inputs allow: the structured or the emailed-bill gate, or none (not AP inputs). */
function apGateFor(verdict: unknown, inputs: unknown): ((engine: string | undefined) => ApResult) | undefined {
  if (!isObj(verdict) || !isObj(verdict.ruleset) || !isObj(inputs) || !isObj(inputs.policy)) return undefined
  const policy = inputs.policy as ApPolicy, ruleset = `${String(verdict.ruleset.id)}@${String(verdict.ruleset.version)}`
  if (isObj(inputs.ap_structured)) {
    const ap = inputs.ap_structured
    return (engine) => verifyBillMatch(ap, { policy, ruleset, now: () => new Date(0), ...(engine !== undefined ? { engine } : {}) })
  }
  if (isObj(inputs.ap)) {
    const ap = inputs.ap as unknown as ApDocuments
    return (engine) => verifyInvoiceMatch(ap, { policy, ruleset, now: () => new Date(0), ...(engine !== undefined ? { engine } : {}) })
  }
  return undefined
}

/**
 * The AP result the gate derives from a verdict's inputs, under `engine` (the verdict's own when 'verdict', this build's when
 * undefined). Undefined when the inputs are not AP inputs; throws when the engine cannot run them.
 */
export function apRederive(verdict: unknown, inputs: unknown, engine: string | undefined | 'verdict' = 'verdict'): ApResult | undefined {
  const gate = apGateFor(verdict, inputs)
  if (!gate) return undefined
  const e = engine === 'verdict' ? (isObj(verdict) && typeof verdict.engine_version === 'string' ? verdict.engine_version : undefined) : engine
  return gate(e)
}

/** Whether a bundle's verdict and inputs are ones the AP gate decides on (so the derived fields it states can be compared). */
export function apDerivable(bundle: unknown): boolean {
  if (!isObj(bundle) || !isObj(bundle.verdict)) return false
  const v = isObj(bundle.verdict.verdict) && typeof bundle.verdict.signature === 'string' ? bundle.verdict.verdict : bundle.verdict
  return isObj(v.ruleset) && AP_RULESETS.has(String(v.ruleset.id)) && apGateFor(v, bundle.inputs) !== undefined
}

/** The derived fields a file states, in AP_DERIVED_KEYS order. */
export const apDerivedKeysIn = (x: unknown): string[] => (isObj(x) ? AP_DERIVED_KEYS.filter(k => Object.prototype.hasOwnProperty.call(x, k)) : [])

/**
 * One field of the file that is not what the re-performed verdict derives. `stated` is absent when the file leaves the field out;
 * `rederived` is absent, and `never_written` true, for a key `verify ap` does not write at all.
 */
export interface ApFieldDifference { field: string; stated?: unknown; rederived?: unknown; never_written?: true }

/** The comparison: ok when no field differs. */
export interface ApFieldsCheck { ok: boolean; differences: ApFieldDifference[] }

const has = (o: Record<string, unknown>, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k)
const same = (a: unknown, b: unknown): boolean => canonicalize(a) === canonicalize(b)
/** The value at a dotted path from the file's top (`read.reviewed_by`), for naming a key the command never writes. */
const at = (o: Record<string, unknown>, path: string): unknown => path.split('.').reduce<unknown>((x, k) => (isObj(x) ? x[k] : undefined), o)

/**
 * Compare the fields `file` states beside its verdict with the ones `derived` (apRederive of the re-performed verdict) holds.
 * `whole`: `file` is the output of `verify ap`, so all five derived fields must be there, the --allow-open pair is compared when
 * either is present, and every path in `unknown` (keys the command never writes; replay-case.ts carriedKeys) is a difference.
 */
export function compareApFields(file: Record<string, unknown>, derived: ApResult, o: { whole: boolean; unknown?: readonly string[] }): ApFieldsCheck {
  const differences: ApFieldDifference[] = []
  const d = derived as unknown as Record<string, unknown>
  for (const k of AP_DERIVED_KEYS) {
    if (!has(file, k)) { if (o.whole) differences.push({ field: k, rederived: d[k] }); continue }
    if (!same(file[k], d[k])) differences.push({ field: k, stated: file[k], rederived: d[k] })
  }
  if (o.whole && (has(file, 'exit') || has(file, 'allow_open'))) {
    const x = apExit(derived, true)
    const want: Record<string, unknown> = { exit: x.exit, allow_open: x.allow_open ? 'stated' : 'stated, not applied' }
    for (const k of AP_CHOICE_KEYS) {
      if (!has(file, k)) differences.push({ field: k, rederived: want[k] })
      else if (!same(file[k], want[k])) differences.push({ field: k, stated: file[k], rederived: want[k] })
    }
  }
  if (o.whole) for (const p of o.unknown ?? []) differences.push({ field: p, stated: at(file, p), never_written: true })
  return { ok: differences.length === 0, differences }
}

/**
 * Re-derive and compare in one call: undefined when `inputs` are not AP inputs. A derivation that throws on inputs the verdict
 * re-performed on is a failure, never a pass (fail closed): it is reported against `decision`.
 */
export function checkApFields(file: Record<string, unknown>, verdict: unknown, inputs: unknown, o: { whole: boolean; unknown?: readonly string[] }): ApFieldsCheck | undefined {
  let derived: ApResult | undefined
  try { derived = apRederive(verdict, inputs) } catch (e) {
    return { ok: false, differences: [{ field: 'decision', stated: file.decision, rederived: `(the gate could not be run again: ${(e as Error).message})` }] }
  }
  return derived ? compareApFields(file, derived, o) : undefined
}

/** A value as a replay line shows it: its JSON, cut at 160 characters. */
const shown = (x: unknown): string => {
  const s = JSON.stringify(x) ?? 'undefined'
  return s.length > 160 ? `${s.slice(0, 157)}…` : s
}

/** The words a replay says one difference in (`decision: the file states "approve"; the verdict, re-performed, derives "hold_quantity"`). */
export function apDifferenceLine(d: ApFieldDifference): string {
  if (d.never_written) return `${d.field}: the file states ${shown(d.stated)}; \`ap\` never writes this key`
  const stated = Object.prototype.hasOwnProperty.call(d, 'stated') ? `the file states ${shown(d.stated)}` : 'absent from the file'
  return `${d.field}: ${stated}; the verdict, re-performed, derives ${shown(d.rederived)}`
}

/** The words that open the FAILED line (one file) and the reason (a case), before the field names. */
export const AP_FIELDS_WORDS = 'the outcome re-performed byte-identical, but the file is not what `ap` wrote for it'

/** The FAILED line's text (without "verify replay: FAILED: "): the words, then the fields by name. */
export const apFieldsHeadline = (c: ApFieldsCheck): string =>
  `${AP_FIELDS_WORDS}: ${c.differences.map(d => d.field).join(', ')} (the file was changed after it was written; each is below)`

/** A case's reason in a folder, over HTTP or MCP: the words and every difference, on one line. */
export const apFieldsReason = (c: ApFieldsCheck): string =>
  `${AP_FIELDS_WORDS}: ${c.differences.map(apDifferenceLine).join('; ')}`

/** The block a one-file replay's JSON carries when the fields differ (absent on a match, so a genuine file reads as before). */
export const apFieldsBlock = (c: ApFieldsCheck): { ok: boolean; differences: ApFieldDifference[] } => ({ ok: c.ok, differences: c.differences })
