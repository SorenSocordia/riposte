/**
 * Independent replay check — the first half of the portable trust primitive.
 *
 * A verdict's id is `sha256(input_hash : ruleset.id@version : engine_version).slice(0,32)` — the same derivation every
 * producer uses. This module re-derives it, so any third party can confirm with nothing but sha256 + canonical JSON:
 *   (1) the verdict_id is bound to its input_hash + ruleset version + engine  → the id/ruleset/engine weren't altered;
 *   (2) (when the original inputs are supplied) the input_hash matches those exact inputs → the verdict is FOR this doc.
 *
 * THE OUTCOME IS NOT IN THE ID (2026-09-28). The id commits to the inputs, not the result: a self-consistent
 * verdict with its outcome flipped PASS↔FAIL keeps the genuine id. So the binding alone never says the outcome is right.
 * When the inputs are supplied, verifyReplay RE-PERFORMS the check with this build's engine for the verdict's ruleset
 * (verify / the declarative evaluator / verifyAction / the AP match / the citation check / reconcile; the twins when the
 * document itself is supplied) and byte-compares the recomputed body with the presented one (everything except
 * `issued_at` and the annotations added after the engine: `channel`, `ledger`, `declared_accuracy`, `action_context`, and from
 * 2026-10-03 `case`, the arbitration link a re-verdict carries).
 * Any difference fails, naming the first differing field.
 * THE FULL EXEMPT SET (2026-10-05; docs/REPLAY.md): issued_at, the five annotations above, and `document.producer`
 * (the caller's label: it is carried into the re-run, so it always "matches"); and, for a verdict of engine 0.0.1 or 0.1.0 that
 * carries none, the remedies, only when the caller asks for it (`lenientRemedies`; re-derived and reported, `remedies_not_carried`).
 * Without that option such a verdict FAILS at `remedies` (2026-10-05, miss F18). notReperformedFields names them for any verdict;
 * the CLI prints them in single-file and folder mode alike, and `verify replay --strict` fails on each of them except
 * document.producer, which it reports as the issuer's label (replay-case.ts strictProblems, strictNotes, 2026-10-05).
 * issued_at is never compared, and never anything but a timestamp: replayInputProblem refuses a malformed one.
 *
 * THE ENGINE THE VERDICT NAMES (2026-10-03). A check is re-performed under the behaviour of the engine version the
 * verdict names, when this build carries it (version.ts ENGINE_VERSIONS: 0.0.1 and 0.1.0). Engine 0.1.0 changed only how
 * the declarative evaluator reads (absent vs unreadable, strict numbers, by default); a 0.0.1 verdict is re-performed with
 * the 0.0.1 reading, and the verdict made again names 0.0.1, so its bytes and its id are compared as issued. A version this
 * build does not carry is not re-performed (STRUCTURE_ONLY), as before.
 *
 * REMEDIES ARE RE-DERIVED, NEVER TRUSTED (2026-10-03, engine 0.2.0; red-team F9). A declarative ruleset travels in the inputs with
 * its remedies, and the input identity sets remedies aside, so a bundle could carry doctored remedy text in both its ruleset and
 * its verdict and still re-perform to a match. Three checks close that:
 *   - a verdict of engine 0.2.0 binds its remedy table: its id derives from `remedy_table_hash` (./verdict-id.ts), and one
 *     without the hash does not replay;
 *   - every engine: when the inputs carry a declarative ruleset this build carries by id@version, and it is that ruleset once
 *     remedies are set aside, its remedies must BE that ruleset's; otherwise the replay FAILS naming the first check whose remedy
 *     differs (the pinned ruleset wins, never the bundle);
 *   - a verdict of engine 0.2.0 that is not PASS must carry its remedies: dropping them is a divergence, not "issued before
 *     remedies existed".
 *
 *   status          what the check established
 *   REPERFORMED     the binding holds AND the outcome was re-performed here and is byte-identical: outcome_verified
 *   STRUCTURE_ONLY  the binding holds; the outcome was NOT re-performed (no inputs, no engine for them here, another engine
 *                   or ruleset version, or a twin without its document). Nothing here says the outcome is right.
 *   FAILED          the binding does not hold, or the re-performed verdict differs from the presented one
 *   REFUSED         not a verdict: nothing could be derived from it
 *
 * `ok` keeps its meaning: every check that RAN passed (the binding, and the re-performance when it ran). It is NOT an
 * outcome attestation on its own; `outcome_verified` is. A signed envelope (./envelope.ts) is the other route: it proves
 * the body, outcome included, is what the key holder issued (not that it is right).
 *
 * NOT A VERDICT → A REFUSAL, NEVER A THROW (2026-09-28). Given anything that is not verdict-shaped (null, an array, a
 * number, an object without its binding fields), verifyReplay answers `{ ok: false, refused: true, reason }`: nothing
 * can be derived from it, so nothing verifies. A verifier's answer to garbage is "no, and why", not a crash in the caller.
 *
 * A REPLAY NAMES WHAT IT WAS NOT GIVEN (2026-10-04). A declarative verdict is issued on an extraction and a ruleset it does
 * not embed, and on page text, quotes, choice values or archive files when it says so. declarativeReplayNeeds reads that off
 * the verdict alone, so a caller who left one out is told which flag, before any hash is compared. When the inputs are given and
 * input_hash still differs, the reason names the input that disagrees, where the verdict records it (`input_mismatch`); where
 * it does not, the reason lists what agrees and what the verdict does not record.
 *   The CLI's exit contract for this (`verify replay`, cli.ts; decided 2026-10-04, keep it):
 *     no inputs at all        exit 2  STRUCTURE_ONLY: the binding was checked; the line names the flags this verdict needs.
 *                                     A structure check is a lawful call, not a mistake: it does not become exit 3.
 *     some inputs, not all    exit 3  a usage error, one line naming the flags and the ones left out; nothing on stdout,
 *                                     never "input_hash does not match" (that is a forged or foreign input, exit 1).
 *     all inputs, hash differs exit 1 FAILED, as always, with `input_mismatch` naming what disagrees.
 */

import { sha256, hashOf, canonicalize } from '../verdict/canonical.js'
import type { Verdict } from '../verdict/schema.js'
import { bindsRemedyTable, deriveVerdictId } from './verdict-id.js'
// The engines. verify() from its own module, never the package barrel (which re-exports this one): no cycle, and a bundle
// that reaches replay (verdict/channel.ts, verdict/voice.ts) does not pull the whole package in.
import { verify } from '../verify.js'
import { verifyDeclarative, type ArchiveFile } from '../declarative/evaluate.js'
import { isDeclarativeRuleset, remedyTableOf, rulesetIdentity, type DeclarativeRuleset, type SuppliedChoice } from '../declarative/types.js'
import type { EvidenceOverlay } from '../declarative/evidence.js'
import { resolveDeclarativeRuleset, isDeclarativeRulesetName, DECLARATIVE_DOMAIN_DEFAULTS } from '../rulesets/declarative.js'
import type { Remedy } from '../verdict/schema.js'
import { RULESETS, RULESET_VERSIONS } from '../rulesets/index.js'
import { verifyAction, type ProposedAction, type ActionSources } from '../action/index.js'
import { verifyInvoiceMatch, AP_RULESET, type ApDocuments, type ApPolicy } from '../ap/index.js'
import { verifyBillMatch, AP_STRUCTURED_RULESET } from '../ap/structured.js'
import { verifyCitations, type Citation, type OpinionSources } from '../legal/index.js'
import { textOf } from '../legal/binding.js'
import { reconcile, type ReconciliationRuleset } from '../reconcile/index.js'
import { verifyAgainstTwin, type TwinClaim } from '../twin/judge.js'
import { FS_CORE_TWIN_MAP, FS_CORE_TWIN_MAP_V02, FS_CORE_TWIN_MAP_V021, type TwinConceptMap } from '../twin/map.js'
import { parseTwinPresentation, type TwinPresentationInput } from '../twin/presentation.js'
import { verifyEinvoiceTwin, type EinvoiceClaim } from '../twin-einvoice/judge.js'
import type { EinvoiceProfile } from '../twin-einvoice/map.js'
import { toleranceIdentity, toleranceProblem, type TolerancePolicy } from '../tolerance.js'
import { nonFinitePath } from './hash-input.js'
import { ENGINE_VERSION, ENGINE_VERSIONS, isRetainedEngine } from '../version.js'
import { pinProblem } from '../algorithms/index.js'

export type ReplayStatus = 'REPERFORMED' | 'STRUCTURE_ONLY' | 'FAILED' | 'REFUSED'

export interface ReplayCheck {
  /** Every check that RAN passed: id_ok, input_ok (with inputs) and the re-performance (when it ran). Not an outcome attestation: read outcome_verified. */
  ok: boolean
  /** The verdict_id correctly derives from input_hash + ruleset@version + engine_version. */
  id_ok: boolean
  /** Only present when inputs were supplied: input_hash matches hashOf(inputs). */
  input_ok?: boolean
  /** Empty when the input is refused (not a verdict: no id can be derived from it). */
  expected_verdict_id: string
  /** The input_hash computed here from the supplied inputs (the name predates the recorded/computed labels; kept for readers). */
  expected_input_hash?: string
  /** Present when input_hash does not match (2026-10-05): the hash the verdict records. */
  recorded_input_hash?: string
  /** Present when input_hash does not match (2026-10-05): the hash computed here from the supplied inputs. */
  computed_input_hash?: string
  reason?: string
  /** Present (true) when the input is not a verdict: nothing was derived or compared, so nothing verifies. `reason` says why. */
  refused?: true
  /** True ONLY when the outcome was re-performed here and the recomputed verdict is byte-identical (issued_at aside). */
  outcome_verified: boolean
  status: ReplayStatus
  /** Present when the check was re-performed: which engine, and whether the recomputed body is byte-identical. */
  reperformed?: ReperformResult
  /** Why the outcome was not re-performed (status STRUCTURE_ONLY). */
  not_reperformed?: string
  /**
   * Present when input_hash does not match verify()'s or the declarative evaluator's inputs (2026-10-04): which input
   * disagrees, by what the verdict records of each. `differs` is determined; when it is empty, the difference is in one of
   * `unrecorded`, the inputs the verdict keeps no record of.
   */
  input_mismatch?: InputMismatch
}

/** An input of verify() or the declarative evaluator, by the name its record (or its absence) is reported under. */
export type InputClass = 'extraction' | 'ruleset' | 'ruleset_content' | 'source' | 'source_text' | 'quotes' | 'contract' | 'evidence'
  | 'history' | 'supplied_choices' | 'archive_files' | 'tolerance' | 'evidence_overlay'

export interface InputMismatch {
  /** inputs whose record on the verdict disagrees with what was supplied */
  differs: InputClass[]
  /** inputs whose record on the verdict agrees with what was supplied */
  agrees: InputClass[]
  /** inputs the verdict keeps no record of: when nothing differs, the difference is in one of these */
  unrecorded: InputClass[]
  /** false when the verdict records no input at all (no extraction hash, no references): nothing can be told */
  recorded: boolean
}

export interface ReperformResult {
  /** The engine that re-performed it (e.g. `verify:invoice`, `declarative`, `action`, `ap`, `legal`, `reconcile`, `twin`, `twin-einvoice`). */
  engine: string
  identical: boolean
  /** The first field where the presented verdict differs from the re-performed one (a path: `outcome`, `claims[0].outcome`). */
  first_difference?: string
  /** Fields on the presented verdict that are not the engine's output and were NOT re-performed (the book's, a stamp, a measurement). */
  annotations?: string[]
  /**
   * The typed remedies the re-performed verdict carries (2026-10-02; verdict/remedy.ts), present when it has any. When the
   * presented verdict carries remedies they are compared byte for byte like any engine output; see `remedies_not_carried`.
   */
  remedies?: Remedy[]
  /**
   * Present (true) when the presented verdict carries no remedies but the re-performed one does: a verdict issued before
   * remedies existed (or with them removed). Remedies sit outside the hashed core and never change an outcome, so the CORE
   * is compared and the re-derived remedies are reported in `remedies`. From 2026-10-05 such a replay FAILS at
   * `remedies` unless `ReplayOptions.lenientRemedies` is set; the flag stays on the failed result so a caller can say why.
   */
  remedies_not_carried?: true
}

export interface ReplayOptions {
  /**
   * The rounding-tolerance override the verdict was issued under (verify()'s `options.tolerance`). Since 2026-09-28 the
   * input_hash commits to it (D-TOL-ID), so it is folded into verify()/declarative inputs before the binding check; a
   * verdict issued earlier, whose input_hash does not commit to it, still binds without it and re-performs with it.
   */
  tolerance?: TolerancePolicy
  /** The twins' inputs commit to the document by sha256; supply its text (the iXBRL HTML or the e-invoice XML) to re-perform. */
  document?: string
  /** Twin v0.2+: the filing's presentation linkbase files (re-read as the map requires). */
  presentation?: TwinPresentationInput
  /**
   * 2026-10-05 (miss F18): accept a verdict of engine 0.0.1 or 0.1.0 that carries no remedies, comparing its core and
   * reporting the re-derived remedies (`remedies_not_carried`). Without it such a verdict FAILS at `remedies`: a replayed file must
   * carry what the verdict said. `verify replay --lenient-remedies`. Engine 0.2.0 on binds its remedy table, so it never applies there.
   */
  lenientRemedies?: boolean
}

/**
 * Fields a verdict may carry that the engine did not produce (added after it: a stamp, the ledger, a measurement). THE EXEMPT SET
 * (2026-10-05; docs/REPLAY.md): a replay never compares these, so it never re-performs them, and every replay names the ones
 * a verdict carries: `issued_at`, these five, and `document.producer` (the caller's label, carried into the re-run as given). When
 * the presented verdict carries no `remedies` and its engine (0.0.1, 0.1.0) did not bind them, the remedies are re-derived and
 * said so. Everything else is the engine's output and is byte-compared. `verify replay --strict` fails on any of them.
 */
export const ANNOTATIONS = ['channel', 'ledger', 'declared_accuracy', 'action_context', 'case'] as const

/**
 * The members each annotation with an object shape declares (verdict/schema.ts; 2026-10-19). An annotation is added after the
 * engine and never compared, so a member it does not declare is a claim nothing checks: a cold reader (platform engineer's role)
 * added `action_context: { approved: true, amount: "1894.92" }` to a verdict and the replay said VERIFIED, exit 0. Such a member
 * is refused (annotationMemberProblem), with or without --strict. The writers in this build write these shapes exactly: the book
 * (ledger/memory.ts) its tenant, retention and reviewer; arbitration (arbitration/case.ts) its case link; a measured accuracy
 * (declarative/measure.ts) its six fields. Nothing in this build writes `action_context`. `channel` is a string: no members.
 */
export const ANNOTATION_SHAPES: Readonly<Record<string, readonly string[]>> = {
  ledger: ['tenant_id', 'retention_until', 'reviewer'],
  declared_accuracy: ['domain', 'ruleset_version', 'fp_rate', 'fn_rate', 'abstain_rate', 'measured_on'],
  action_context: ['tool_name', 'call_id', 'argument_path'],
  case: ['case_id', 'prior_verdict_id', 'move_id'],
}
/** The members of a `ledger` annotation's reviewer (verdict/schema.ts Verdict.ledger.reviewer). */
const LEDGER_REVIEWER_SHAPE: readonly string[] = ['id', 'decided_at', 'decision', 'note']

/**
 * Why a verdict cannot be replayed because an annotation carries a member its declared shape does not have, or undefined
 * (2026-10-19). Read off the verdict alone, in ANNOTATIONS order; every such member is named by its path
 * (`action_context.approved`). A replay refuses it (status REFUSED, exit 3) before anything is hashed.
 */
export function annotationMemberProblem(verdict: unknown): string | undefined {
  if (!isObj(verdict)) return undefined
  const found: { at: string; shape: readonly string[]; members: string[] }[] = []
  const check = (at: string, value: unknown, shape: readonly string[]): void => {
    if (!isObj(value)) return
    const members = Object.keys(value).filter(k => !shape.includes(k)).map(k => `${at}.${k}`)
    if (members.length) found.push({ at, shape, members })
  }
  for (const a of ANNOTATIONS) {
    const shape = ANNOTATION_SHAPES[a]
    if (!shape) continue
    check(a, verdict[a], shape)
    if (a === 'ledger' && isObj(verdict.ledger)) check('ledger.reviewer', verdict.ledger.reviewer, LEDGER_REVIEWER_SHAPE)
  }
  if (!found.length) return undefined
  const n = found.reduce((s, f) => s + f.members.length, 0)
  const parts = found.map(f => `the verdict's ${f.at} carries ${f.members.length === 1 ? 'a member' : 'members'} its declared shape { ${f.shape.join(', ')} } does not have: ${f.members.join(', ')}`)
  return `${parts.join('; ')} (an annotation is added after the engine and is never compared, so a member it does not declare is a claim nothing checks; remove ${n === 1 ? 'it' : 'them'}: annotations sit outside what the verdict_id binds, so the verdict replays without ${n === 1 ? 'it' : 'them'})`
}

/**
 * The fields of `verdict` a replay does not re-perform (the exempt set above, issued_at aside), in the order a replay names them:
 * the annotations it carries, then `document.producer` when it carries one. Read off the verdict alone, so a folder replay names
 * them per case exactly as a single replay does.
 */
export function notReperformedFields(verdict: unknown): string[] {
  if (!isObj(verdict)) return []
  return [
    ...ANNOTATIONS.filter(k => verdict[k] !== undefined),
    ...(isObj(verdict.document) && typeof verdict.document.producer === 'string' ? ['document.producer'] : []),
  ]
}

const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x)

/**
 * The inputs as their input_hash IDENTIFIES them: a declarative ruleset's declared remedies are not part of its identity
 * (declarative/types.ts rulesetIdentity, 2026-10-02). Inputs without one are returned as they are.
 */
export function inputIdentity(inputs: unknown): unknown {
  if (!isObj(inputs) || !isDeclarativeRuleset(inputs.ruleset)) return inputs
  const id = rulesetIdentity(inputs.ruleset)
  return id === inputs.ruleset ? inputs : { ...inputs, ruleset: id }
}

/** verify()'s or the declarative evaluator's inputs: the shapes whose input_hash commits to a tolerance override. */
const takesTolerance = (x: unknown): x is Record<string, unknown> =>
  isObj(x) && Object.prototype.hasOwnProperty.call(x, 'extraction') &&
  (Object.prototype.hasOwnProperty.call(x, 'references') || isDeclarativeRuleset(x.ruleset))

/** Why supplied inputs (or a restated tolerance) cannot be bound by input_hash faithfully, or undefined. Never throws. */
function unbindableInputs(inputs: unknown, opts: ReplayOptions): string | undefined {
  if (opts.tolerance !== undefined) {
    const p = toleranceProblem(opts.tolerance)
    if (p) return `the restated rounding-tolerance override is not one an engine reads exactly as its identity hashes it (${p})`
  }
  if (takesTolerance(inputs) && Object.prototype.hasOwnProperty.call(inputs, 'tolerance')) {
    const p = toleranceProblem(inputs.tolerance)
    if (p) return `the inputs' rounding-tolerance override is not one an engine reads exactly as its identity hashes it (${p})`
  }
  let at: string | undefined
  try { at = nonFinitePath(inputs, '$') } catch { at = undefined }
  if (at !== undefined) return `the supplied inputs hold a number that is not finite at ${at}: the hash writes Infinity, -Infinity and NaN as null, so they cannot be told from null`
  return undefined
}

/** The inputs as their input_hash binds them: a restated override is part of the input (D-TOL-ID). */
function boundInputs(inputs: unknown, opts: ReplayOptions): unknown {
  if (!opts.tolerance || !takesTolerance(inputs) || Object.prototype.hasOwnProperty.call(inputs, 'tolerance')) return inputs
  return { ...inputs, tolerance: toleranceIdentity(opts.tolerance) }
}

/**
 * Why `x` cannot be replay-checked (it lacks what the verdict_id derives from), or undefined. The binding fields only:
 * verdict_id, input_hash, ruleset {id, version}, engine_version, each a string.
 */
export function replayInputProblem(x: unknown): string | undefined {
  if (!isObj(x)) return `not a verdict: ${x === null ? 'null' : Array.isArray(x) ? 'an array' : typeof x}, not a verdict object`
  const missing: string[] = []
  if (typeof x.verdict_id !== 'string') missing.push('verdict_id')
  if (typeof x.input_hash !== 'string') missing.push('input_hash')
  if (!isObj(x.ruleset) || typeof x.ruleset.id !== 'string' || typeof x.ruleset.version !== 'string') missing.push('ruleset {id, version}')
  if (typeof x.engine_version !== 'string') missing.push('engine_version')
  if (missing.length) return `not a verdict: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing or not a string, so no verdict_id can be derived`
  // 2026-10-05: issued_at is exempt from the comparison, never from being a timestamp. `{"lol":1}` used to
  // replay as VERIFIED, strict included.
  return issuedAtProblem(x.issued_at)
}

/** An ISO-8601 date-time with its offset, as every engine writes issued_at (Date#toISOString, or the same without milliseconds). */
const ISO_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-](\d{2}):(\d{2}))$/

/**
 * Why a verdict's `issued_at` is not a timestamp, or undefined (absent is undefined here: `--strict` names an absent one). A
 * timestamp is an ISO-8601 date-time with seconds optional, a fraction optional, and a `Z` or `±hh:mm` offset, naming a real
 * calendar instant (no 2026-02-30, no hour 24).
 */
export function issuedAtProblem(v: unknown): string | undefined {
  if (v === undefined) return undefined
  const shown = typeof v === 'string' ? JSON.stringify(v) : `${JSON.stringify(v) ?? typeof v} (a ${v === null ? 'null' : Array.isArray(v) ? 'list' : typeof v}, not a string)`
  const m = typeof v === 'string' ? ISO_INSTANT.exec(v) : null
  const bad = `issued_at is not an ISO-8601 timestamp: ${shown}. A verdict records when it was issued as, for example, 2026-10-05T16:03:24.839Z`
  if (!m) return bad
  const [y, mo, d, h, mi, s, oh, om] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? '0', m[7] ?? '0', m[8] ?? '0'].map(Number) as number[]
  const days = new Date(Date.UTC(y!, mo!, 0)).getUTCDate()
  if (mo! < 1 || mo! > 12 || d! < 1 || d! > days || h! > 23 || mi! > 59 || s! > 59 || oh! > 23 || om! > 59) return bad
  return undefined
}

/** The one canonical verdict_id derivation (./verdict-id.ts), re-exported here where every caller has found it. */
export { deriveVerdictId }

export const STRUCTURE_ONLY_NOTE = 'structure verified; outcome NOT re-performed'

export function verifyReplay(verdict: Verdict, inputs?: unknown, opts: ReplayOptions = {}): ReplayCheck {
  // 2026-10-19: an annotation member its declared shape does not have is refused too, before anything is hashed
  const problem = replayInputProblem(verdict) ?? annotationMemberProblem(verdict)
  if (problem) return { ok: false, id_ok: false, expected_verdict_id: '', reason: problem, refused: true, outcome_verified: false, status: 'REFUSED' }
  // Engine 0.2.0: the id derives from the remedy table hash too, when the verdict carries one (./verdict-id.ts).
  const rth = typeof verdict.remedy_table_hash === 'string' ? verdict.remedy_table_hash : undefined
  const expected_verdict_id = deriveVerdictId(verdict.input_hash, verdict.ruleset, verdict.engine_version, rth)
  const id_ok = expected_verdict_id === verdict.verdict_id
  const out: ReplayCheck = { ok: id_ok, id_ok, expected_verdict_id, outcome_verified: false, status: id_ok ? 'STRUCTURE_ONLY' : 'FAILED' }
  if (!id_ok) out.reason = `verdict_id does not derive from input_hash + ruleset@version + engine_version${rth !== undefined ? ' + remedy_table_hash' : ''} (expected ${expected_verdict_id})`
  // A verdict of an engine that binds its remedy table (0.2.0 on), carried by this build, without the hash: its remedies are
  // bound to nothing, so it does not replay.
  if (id_ok && rth === undefined && isRetainedEngine(verdict.engine_version) && bindsRemedyTable(verdict.engine_version)) {
    out.ok = false
    out.status = 'FAILED'
    out.reason = `a verdict of engine ${verdict.engine_version} binds the remedy table it was answered from, and this one carries no remedy_table_hash`
    return out
  }
  // Engine 0.4.0: a verdict made with pinned algorithms is re-performed only by those exact procedures. A pin this build's
  // registry does not carry byte for byte (another implementation, another quoted source, or none) refuses the replay.
  if (id_ok && Array.isArray((verdict as { algorithms?: unknown }).algorithms)) {
    for (const pin of (verdict as { algorithms: unknown[] }).algorithms) {
      const problem = pinProblem(pin)
      if (problem === undefined) continue
      out.ok = false
      out.status = 'FAILED'
      out.reason = `replay refuses: ${problem}. A verdict made with a pinned algorithm is re-performed only by that procedure (src/algorithms)`
      return out
    }
  }
  if (inputs === undefined) {
    if (id_ok) out.not_reperformed = `${STRUCTURE_ONLY_NOTE}: no inputs were supplied, so the check was not run again (the verdict_id binds the inputs, not the outcome)`
    return out
  }
  // 2026-10-05 (a cold reader's Collisions A and B, cold review round 2): inputs the hash cannot bind faithfully do not verify. A
  // non-finite number hashes as null, so it cannot be told from its null twin; a restated tolerance whose shape the engine and
  // the identity read differently cannot be told from another override. The binding cannot be checked, so it FAILS (as a cycle does).
  const unbindable = unbindableInputs(inputs, opts)
  if (unbindable !== undefined) {
    out.input_ok = false
    out.ok = false
    out.status = 'FAILED'
    out.reason = `${unbindable}, so the input binding cannot be checked`
    return out
  }
  const bound = boundInputs(inputs, opts)
  let expected_input_hash: string
  let legacy = false
  try {
    expected_input_hash = hashOf(inputIdentity(bound))
    // A verdict issued before 2026-09-28 did not commit to its override: it still binds to the inputs without it.
    if (bound !== inputs && expected_input_hash !== verdict.input_hash && hashOf(inputIdentity(inputs)) === verdict.input_hash) {
      expected_input_hash = verdict.input_hash
      legacy = true
    }
  } catch (e) {
    // Inputs that cannot be canonicalized (a cycle): the binding cannot be checked, so it does not verify.
    out.input_ok = false
    out.ok = false
    out.status = 'FAILED'
    out.reason = `the supplied inputs cannot be canonicalized (${(e as Error).message}), so the input binding cannot be checked`
    return out
  }
  const input_ok = expected_input_hash === verdict.input_hash
  out.input_ok = input_ok
  out.expected_input_hash = expected_input_hash
  out.ok = id_ok && input_ok
  const unstated = takesTolerance(inputs) && !opts.tolerance && !Object.prototype.hasOwnProperty.call(inputs, 'tolerance')
  if (id_ok && !input_ok) {
    // 2026-10-04: which input disagrees, where the verdict records it (verify()'s and declarative inputs only; any other
    // shape keeps the sentence it always had, byte for byte).
    const m = inputMismatch(verdict, inputs, opts)
    if (m) out.input_mismatch = m.mismatch
    const hint = unstated && (!m || !m.mismatch.differs.length) ? '. If it was issued under a rounding-tolerance override, restate it: the input identity includes the override' : ''
    // 2026-10-05: both hashes, labelled for what they are. The verdict RECORDS one; this replay COMPUTED the other from
    // the inputs it was given. (`expected_input_hash` keeps its name for compatibility: it is the computed hash.)
    out.recorded_input_hash = verdict.input_hash
    out.computed_input_hash = expected_input_hash
    const sourceSuspect = m !== undefined && (m.mismatch.differs.includes('source_text') || (!m.mismatch.differs.length && m.mismatch.unrecorded.includes('source_text')))
    const lineEndings = sourceSuspect ? '. The page text is hashed byte for byte: if it was re-saved or copied, check its line endings (CRLF or LF), a trailing newline and a byte-order mark' : ''
    const other = m === undefined ? otherInputMismatch(verdict, inputs) : undefined
    out.reason = `input_hash does not match the supplied inputs: recorded ${verdict.input_hash}, computed ${expected_input_hash} — this verdict is not for these inputs${m ? m.detail : other ?? ''}${lineEndings}${hint}`
  }
  if (!out.ok) { out.status = 'FAILED'; return out }

  // The binding holds. Now the outcome: run the check again and compare what comes out.
  const r = reperform(verdict, bound, opts, legacy)
  if ('not' in r) {
    out.not_reperformed = `${STRUCTURE_ONLY_NOTE}: ${r.not}`
    return out
  }
  out.reperformed = r.result
  if (r.result.identical && r.result.remedies_not_carried && !opts.lenientRemedies) {
    // 2026-10-05 (miss F18): a verdict of engine 0.0.1 or 0.1.0 whose remedies are absent is refused by default. The
    // core matched, but a replayed file must carry what the verdict said; a stranger holds the bundle whole, so a deleted list is an
    // edit, never "issued before remedies existed" unless the caller says so (lenientRemedies, `verify replay --lenient-remedies`).
    const n = r.result.remedies?.length ?? 0
    out.reperformed = { ...r.result, identical: false, first_difference: 'remedies' }
    out.ok = false
    out.status = 'FAILED'
    out.reason = `the verdict carries no remedies; the engine re-derives ${n} ${n === 1 ? 'remedy' : 'remedies'} for it (engine ${verdict.engine_version}); a replayed verdict must carry what it said. For a verdict issued before remedies existed, \`verify replay --lenient-remedies\` compares its core and reports the re-derived remedies`
  } else if (r.result.identical) {
    out.outcome_verified = true
    out.status = 'REPERFORMED'
  } else if (r.pinned !== undefined) {
    out.ok = false
    out.status = 'FAILED'
    out.reason = r.pinned
  } else {
    out.ok = false
    out.status = 'FAILED'
    const remedy = remedyNamed(r.result)
    // 2026-10-06: the override hint only where an override can move the difference (a check's outcome or arithmetic, the
    // outcome, the gate, the coverage, the remedies); a field the engine never writes (one added to the verdict) gets none
    const movable = /^(claims|outcome|gate_status|coverage|remedies)(\b|\[|\.|$)/.test(r.result.first_difference ?? '')
    const override = (r.result.engine.startsWith('verify:') || r.result.engine === 'declarative') && !opts.tolerance && movable
      ? '. If it was issued under a rounding-tolerance override, restate it (a verdict issued before 2026-09-28 does not commit to it in input_hash)' : ''
    out.reason = `the re-performed verdict differs from the presented one at \`${r.result.first_difference}\`${remedy}: the check run again on these inputs does not give this verdict (${r.result.engine}, engine ${verdict.engine_version})${override}`
  }
  return out
}

/** " (the remedy that answers PAYABLE_INT)" when a divergence sits inside the remedies, naming the rules that remedy clears. */
function remedyNamed(r: ReperformResult): string {
  const m = /^remedies\[(\d+)\]/.exec(r.first_difference ?? '')
  if (!m) return ''
  const clears = r.remedies?.[Number(m[1])]?.clears
  return clears?.length ? ` (the remedy that answers ${clears.join(', ')})` : ''
}

// ── what a replay must be given, and which input it was given wrong (2026-10-04) ─────────────────────────────────

/** Ruleset ids of the engines other than the declarative evaluator: a verdict under one of them is never a declarative one. */
const NON_DECLARATIVE_IDS: ReadonlySet<string> = new Set([
  ...RULESET_VERSIONS.map(r => r.id), 'action', 'legal', AP_RULESET.id, AP_STRUCTURED_RULESET.id, 'twin-einvoice',
  ...[FS_CORE_TWIN_MAP, FS_CORE_TWIN_MAP_V02, FS_CORE_TWIN_MAP_V021].map(m => m.id),
])

/**
 * True when `v` is a verdict of the declarative evaluator, read off the verdict alone: its binding fields, an extraction hash,
 * the references every declarative verdict carries (`{ contract: false, evidence: 0, history: 0, source: <boolean> }`) and a
 * ruleset id no other engine issues under. Anything less certain reads false, and the replay behaves exactly as before.
 */
export function isDeclarativeVerdict(v: unknown): v is Verdict {
  if (replayInputProblem(v) !== undefined) return false
  const x = v as Record<string, unknown>
  const doc = x.document, refs = x.references
  return isObj(doc) && typeof doc.extraction_hash === 'string' && isObj(refs) && refs.contract === false && refs.evidence === 0
    && refs.history === 0 && typeof refs.source === 'boolean' && !NON_DECLARATIVE_IDS.has((x.ruleset as { id: string }).id)
}

/** The flag a replay passes an input with. */
export type ReplayInput = 'extraction' | 'ruleset' | 'source' | 'quotes' | 'supplied-choices' | 'archive-file'

export interface ReplayNeed {
  input: ReplayInput
  /** the flag as a caller types it, with what it takes: `--source <file>`, `--ruleset peppol-en16931@0.2.0 (or its file)` */
  flag: string
  /** archive files: how many the verdict hashed */
  count?: number
}

export interface ReplayNeeds {
  /** `${id}@${version}` of the verdict's ruleset */
  ruleset: string
  /** every input the verdict was issued with, in the order a caller passes them */
  needs: ReplayNeed[]
  /** inputs it may have been issued with that the verdict alone cannot tell: its quotes, when its ruleset is not to hand */
  maybe: ReplayNeed[]
  /** what it was issued with, in words: "page text and an external extraction" */
  issued_with: string
}

/** What a caller passed, by input: given or not (archive files: how many). */
export type ReplayGiven = Partial<Record<ReplayInput, boolean | number>>

const sourceId = (raw: string): string => (raw.startsWith('source.') ? raw : `source.${raw}`)

/** "a", "a and b", "a, b and c" (or `or`). */
function listOf(items: readonly string[], last = 'and'): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} ${last} ${items[items.length - 1]}`
}

/** This build's copy of ruleset `ref` (id@version), or undefined when it carries no such name or version. Never throws. */
function carriedRuleset(ref: string): DeclarativeRuleset | undefined {
  try { return resolveDeclarativeRuleset(ref) } catch { return undefined }
}

/** The quotes a caller supplied that a verdict checked: its QUOTE_MATCH claims on the source text, less its ruleset's own passages. */
function callerQuotes(v: Verdict, ruleset: DeclarativeRuleset | undefined): Map<string, string> {
  const own = new Set((ruleset?.quotes ?? []).map(q => sourceId(q.id)))
  const out = new Map<string, string>()
  for (const c of Array.isArray(v.claims) ? (v.claims as unknown[]) : []) {
    if (!isObj(c) || c.rule_id !== 'QUOTE_MATCH' || typeof c.claim_id !== 'string' || !c.claim_id.startsWith('source.') || own.has(c.claim_id)) continue
    out.set(c.claim_id, canonicalize({ quote: c.asserted ?? null, label: c.field ?? null }))
  }
  return out
}

/** The same, from the inputs' own `source.quotes` (textmatch writes `field: label ?? 'quote'`). */
function suppliedQuotes(source: unknown): Map<string, string> {
  const out = new Map<string, string>()
  const quotes = isObj(source) && Array.isArray(source.quotes) ? (source.quotes as unknown[]) : []
  for (const q of quotes) if (isObj(q) && typeof q.id === 'string') out.set(sourceId(q.id), canonicalize({ quote: q.quote ?? null, label: q.label ?? 'quote' }))
  return out
}

/** The sha256 of the source text a verdict's quote evidence records (every textmatch span carries it), if any. */
function recordedSourceHash(v: Verdict): string | undefined {
  for (const c of Array.isArray(v.claims) ? (v.claims as unknown[]) : []) {
    if (!isObj(c) || c.kind !== 'QUOTE_MATCH' || !Array.isArray(c.evidence)) continue
    for (const e of c.evidence as unknown[]) {
      if (isObj(e) && isObj(e.locator) && e.locator.kind === 'span' && typeof e.locator.source_hash === 'string' && e.locator.source_hash !== '') return e.locator.source_hash
    }
  }
  return undefined
}

/** The choice slots a verdict records as supplied by a judge (engine 0.5.0). */
function judgeChoices(v: Verdict): string[] {
  const list = (v as unknown as { choices?: unknown }).choices
  return Array.isArray(list) ? list.filter(c => isObj(c) && isObj(c.source) && c.source.by === 'judge' && typeof c.id === 'string').map(c => (c as { id: string }).id) : []
}

/** How many supplied archive files a verdict records it hashed (engine 0.5.0: `archives[].matched` = `archive_files[i]`). */
function archiveFilesHashed(v: Verdict): number {
  const list = (v as unknown as { archives?: unknown }).archives
  const seen = new Set<string>()
  if (Array.isArray(list)) for (const a of list) if (isObj(a) && typeof a.matched === 'string' && /^archive_files\[\d+\]/.test(a.matched)) seen.add(a.matched.replace(/^(archive_files\[\d+\]).*$/, '$1'))
  return seen.size
}

/**
 * What a replay of a declarative verdict must be given, read off the verdict (2026-10-04), or undefined when it is not a
 * declarative verdict (isDeclarativeVerdict). Always the extraction and the ruleset, which it binds by hash and does not embed;
 * the page text when `references.source`; the caller's quotes when it checked passages its ruleset does not declare (told from
 * `ruleset` when it is the verdict's id@version, else from this build's copy of that name; neither to hand, they are `maybe`);
 * the judge's choice values and archive files when it records them (engine 0.5.0).
 */
export function declarativeReplayNeeds(verdict: unknown, ruleset?: unknown): ReplayNeeds | undefined {
  if (!isDeclarativeVerdict(verdict)) return undefined
  const v = verdict
  const ref = `${v.ruleset.id}@${v.ruleset.version}`
  const carried = carriedRuleset(ref)
  const needs: ReplayNeed[] = [
    { input: 'extraction', flag: '--extraction <file>' },
    { input: 'ruleset', flag: carried ? `--ruleset ${ref} (or its file)` : `--ruleset <the file of ${ref}>` },
  ]
  const maybe: ReplayNeed[] = []
  const words: string[] = []
  if (v.references.source === true) { needs.push({ input: 'source', flag: '--source <file>' }); words.push('page text') }
  const quoteClaims = (Array.isArray(v.claims) ? (v.claims as unknown[]) : []).some(c => isObj(c) && c.rule_id === 'QUOTE_MATCH' && typeof c.claim_id === 'string' && c.claim_id.startsWith('source.'))
  if (quoteClaims) {
    const own = isDeclarativeRuleset(ruleset) && ruleset.id === v.ruleset.id && ruleset.version === v.ruleset.version ? ruleset : carried
    if (own === undefined) maybe.push({ input: 'quotes', flag: '--quotes <file>' })
    else if (callerQuotes(v, own).size > 0) { needs.push({ input: 'quotes', flag: '--quotes <file>' }); words.push('quotes') }
  }
  if (judgeChoices(v).length) { needs.push({ input: 'supplied-choices', flag: '--supplied-choices <file>' }); words.push('the judge\'s choice values') }
  const files = archiveFilesHashed(v)
  if (files > 0) { needs.push({ input: 'archive-file', flag: `--archive-file <file>${files > 1 ? ` (×${files})` : ''}`, count: files }); words.push(files > 1 ? `${files} archive files` : 'an archive file') }
  return { ruleset: ref, needs, maybe, issued_with: listOf([...words, 'an external extraction']) }
}

/** The needs this call left out (archive files: fewer than the verdict hashed). */
export function missingReplayInputs(n: ReplayNeeds, given: ReplayGiven): ReplayNeed[] {
  return n.needs.filter(need => {
    const g = given[need.input]
    return need.input === 'archive-file' ? (typeof g === 'number' ? g : g ? 1 : 0) < (need.count ?? 1) : !g
  })
}

/**
 * The one sentence a replay prints about its inputs: "this verdict was issued with page text and an external extraction
 * under ruleset peppol-en16931@0.2.0: pass --extraction <file>, --ruleset peppol-en16931@0.2.0 (or its file) and --source <file>",
 * plus "; this call leaves out --source" when `given` is passed and something is missing.
 */
export function replayNeedsSentence(n: ReplayNeeds, given?: ReplayGiven): string {
  const maybe = n.maybe.length ? `, and ${listOf(n.maybe.map(m => m.flag))} if it was issued with them (without its ruleset, the verdict alone cannot tell)` : ''
  const missing = given ? missingReplayInputs(n, given) : []
  return `this verdict was issued with ${n.issued_with} under ruleset ${n.ruleset}: pass ${listOf(n.needs.map(m => m.flag))}${maybe}${missing.length ? `; this call leaves out ${listOf(missing.map(m => m.flag.replace(/ .*$/, '')))}` : ''}`
}

/**
 * The ruleset a replay's `--ruleset` names: a name this build carries, given without `@version`, whose id is the verdict's
 * ruleset id, means the version the verdict names (`peppol-en16931` replays a peppol-en16931@0.1.0 verdict under 0.1.0, not under
 * the default). Anything else (a file, an id@version, another id) is returned as given.
 */
export function replayRulesetRef(arg: string, verdict: unknown): string {
  if (arg.includes('@') || !isDeclarativeRulesetName(arg) || !isObj(verdict) || !isObj(verdict.ruleset) || typeof verdict.ruleset.version !== 'string') return arg
  const id = Object.prototype.hasOwnProperty.call(DECLARATIVE_DOMAIN_DEFAULTS, arg) ? DECLARATIVE_DOMAIN_DEFAULTS[arg]! : arg
  return id === verdict.ruleset.id ? `${id}@${verdict.ruleset.version}` : arg
}

/**
 * Which of verify()'s or the declarative evaluator's inputs disagrees with the verdict, by what the verdict records of each
 * since 2026-10-04: the extraction (`document.extraction_hash`), whether page text was given (`references.source`), the page text itself
 * (the sha256 its quote evidence carries), the caller's quotes (its QUOTE_MATCH claims), the ruleset (its id@version), the
 * references (contract, evidence and history counts), the judge's choice values and archive files (engine 0.5.0). Undefined for
 * inputs of any other shape. `detail` continues the reason's sentence.
 */
function inputMismatch(verdict: Verdict, inputs: unknown, opts: ReplayOptions): { mismatch: InputMismatch; detail: string } | undefined {
  if (!takesTolerance(inputs)) return undefined
  const x = inputs
  const v = verdict as Verdict & Record<string, unknown>
  const doc = isObj(v.document) ? v.document : undefined
  const refs = isObj(v.references) ? v.references : undefined
  const recorded = typeof doc?.extraction_hash === 'string' || refs !== undefined
  const differs: [InputClass, string][] = [], agrees: [InputClass, string][] = [], unrecorded: [InputClass, string][] = []
  const shape = (): InputMismatch => ({ differs: differs.map(d => d[0]), agrees: agrees.map(a => a[0]), unrecorded: unrecorded.map(u => u[0]), recorded })
  const tolerance: [InputClass, string] = ['tolerance', opts.tolerance || Object.prototype.hasOwnProperty.call(x, 'tolerance') ? 'the rounding-tolerance override restated' : 'a rounding-tolerance override']
  if (!recorded) {
    unrecorded.push(tolerance)
    return { mismatch: shape(), detail: '. This verdict records no per-input hashes, so which input disagrees cannot be told' }
  }
  // the extraction
  if (typeof doc?.extraction_hash === 'string') {
    let h: string | undefined
    try { h = hashOf(x.extraction) } catch { h = undefined }
    if (h === doc.extraction_hash) agrees.push(['extraction', 'the extraction\'s hash'])
    else differs.push(['extraction', 'the extraction is not the one it was issued on (its hash is not the verdict\'s document.extraction_hash)'])
  }
  // the ruleset
  const declarativeVerdict = isDeclarativeVerdict(verdict as unknown) // not a reference: no narrowing of v
  const ref = `${v.ruleset.id}@${v.ruleset.version}`
  const supplied = isDeclarativeRuleset(x.ruleset) ? x.ruleset as DeclarativeRuleset : undefined
  if (declarativeVerdict && !supplied) differs.push(['ruleset', `it was issued under the declarative ruleset ${ref}, and these inputs carry no ruleset (--ruleset)`])
  else if (!declarativeVerdict && supplied && NON_DECLARATIVE_IDS.has(v.ruleset.id)) differs.push(['ruleset', `it was issued under the built-in ruleset ${ref}, and these inputs carry the declarative ruleset ${supplied.id}@${supplied.version}`])
  else if (supplied) {
    if (`${supplied.id}@${supplied.version}` !== ref) differs.push(['ruleset', `it was issued under ruleset ${ref}, and the ruleset supplied is ${supplied.id}@${supplied.version}`])
    else {
      agrees.push(['ruleset', `the ruleset id@version (${ref})`])
      const carried = carriedRuleset(ref)
      const same = carried !== undefined && canonicalize(rulesetIdentity(carried)) === canonicalize(rulesetIdentity(supplied))
      unrecorded.push(['ruleset_content', `the ruleset's content (the verdict records only its id@version${same ? '; the copy supplied is the one this build carries under that name' : ''})`])
    }
  }
  // the page text: whether it was given, and (when the quote evidence records its sha256) which text
  const text = isObj(x.source) && typeof x.source.text === 'string' && x.source.text.length > 0 ? x.source.text : undefined
  if (typeof refs?.source === 'boolean') {
    if (refs.source && text === undefined) differs.push(['source', 'it was issued with page text, and none was supplied (--source)'])
    else if (!refs.source && text !== undefined) differs.push(['source', 'it was issued without page text, and page text was supplied (leave out --source)'])
    else {
      agrees.push(['source', 'whether page text was supplied'])
      if (text !== undefined) {
        const h = recordedSourceHash(v)
        if (h === undefined) unrecorded.push(['source_text', 'the page text itself (the verdict records only that page text was supplied)'])
        else if (sha256(text) === h) agrees.push(['source_text', 'the page text\'s sha256'])
        else differs.push(['source_text', 'the page text is not the text it was issued on (its sha256 is not the one the verdict\'s quote evidence records)'])
      }
    }
  }
  // the caller's quotes: the verdict's QUOTE_MATCH claims, less the passages its ruleset requires
  const checked = callerQuotes(v, supplied ?? (declarativeVerdict ? carriedRuleset(ref) : undefined))
  const given = suppliedQuotes(x.source)
  if (checked.size || given.size) {
    const ids = (m: Map<string, string>): string => (m.size ? [...m.keys()].sort().join(', ') : 'none')
    const sameIds = ids(checked) === ids(given)
    const changed = sameIds ? [...checked.keys()].filter(k => checked.get(k) !== given.get(k)) : []
    if (!sameIds) differs.push(['quotes', `the quotes are not the ones it was issued with (it checked ${ids(checked)}; these inputs carry ${ids(given)}) (--quotes)`])
    else if (changed.length) differs.push(['quotes', `the quotes are not the ones it was issued with (the text or label of ${changed.sort().join(', ')} differs) (--quotes)`])
    else agrees.push(['quotes', 'the quotes'])
  }
  // the references a built-in ruleset binds
  const xr = isObj(x.references) ? x.references : undefined
  if (xr && refs && !declarativeVerdict) {
    const contract = xr.contract !== null && xr.contract !== undefined
    const ne = Array.isArray(xr.evidence) ? xr.evidence.length : 0, nh = Array.isArray(xr.history) ? xr.history.length : 0
    let ok = true
    if (typeof refs.contract === 'boolean' && refs.contract !== contract) { ok = false; differs.push(['contract', refs.contract ? 'it was issued with a contract, and none was supplied (--contract)' : 'it was issued without a contract, and one was supplied (leave out --contract)']) }
    if (typeof refs.evidence === 'number' && refs.evidence !== ne) { ok = false; differs.push(['evidence', `it was issued with ${refs.evidence} evidence document(s), and ${ne} were supplied (--evidence)`]) }
    if (typeof refs.history === 'number' && refs.history !== nh) { ok = false; differs.push(['history', `it was issued with ${refs.history} history document(s), and ${nh} were supplied (--history)`]) }
    if (ok) agrees.push(['contract', 'the references (contract, evidence and history counts)'])
  }
  // engine 0.5.0: the judge's choice values and archive files, as far as the verdict records them
  const judged = judgeChoices(v)
  const hasChoices = Object.prototype.hasOwnProperty.call(x, 'supplied_choices')
  if (judged.length && !hasChoices) differs.push(['supplied_choices', `it was issued with the judge's values for ${listOf(judged)}, and none were supplied (--supplied-choices)`])
  else if (hasChoices) unrecorded.push(['supplied_choices', 'the choice values supplied'])
  const hashed = archiveFilesHashed(v)
  const nFiles = Array.isArray(x.archive_files) ? x.archive_files.length : 0
  if (hashed > nFiles) differs.push(['archive_files', `it was issued with ${hashed} archive file(s), and ${nFiles} were supplied (--archive-file)`])
  else if (nFiles) unrecorded.push(['archive_files', 'the archive files supplied'])
  if (Object.prototype.hasOwnProperty.call(x, 'evidence')) unrecorded.push(['evidence_overlay', 'the arbitration evidence overlay'])
  unrecorded.push(tolerance)
  // the likeliest first: the page text, then what the caller restates, then the ruleset's content (most often the carried copy)
  const rank: InputClass[] = ['source_text', 'supplied_choices', 'archive_files', 'evidence_overlay', 'ruleset_content', 'tolerance']
  unrecorded.sort((a, b) => rank.indexOf(a[0]) - rank.indexOf(b[0]))
  const detail = differs.length
    ? `: ${differs.map(d => d[1]).join('; ')}`
    : `: every input it records agrees (${listOf(agrees.map(a => a[1]))}), so the difference is in one it does not record: ${listOf(unrecorded.map(u => u[1]), 'or')}`
  return { mismatch: shape(), detail }
}

/**
 * Which input disagrees, for the engines whose inputs are not verify()'s or the declarative evaluator's (2026-10-05: a
 * stranger edited one byte of a legal bundle's quote and was told only that input_hash differed). Every such verdict records
 * `document.extraction_hash` over ONE of its inputs (legal: the citations; AP: the invoice text or the structured bill; action: the
 * proposed action; reconcile: the documents), so the replay can say whether that input is the one that changed, or else that the
 * change is in the inputs the verdict does not record. `detail` continues the reason's sentence; undefined for any other shape.
 */
function otherInputMismatch(verdict: Verdict, inputs: unknown): string | undefined {
  const doc = isObj((verdict as unknown as Record<string, unknown>).document) ? (verdict as unknown as { document: Record<string, unknown> }).document : undefined
  const recorded = typeof doc?.extraction_hash === 'string' ? doc.extraction_hash : undefined
  if (!recorded || !isObj(inputs)) return undefined
  const x = inputs
  const tryHash = (f: () => string): string | undefined => { try { return f() } catch { return undefined } }
  let input: string, rest: string, h: string | undefined, plural = false
  if (isObj(x.ap_structured)) { input = 'the bill'; rest = 'the purchase order, the item receipts, the payment history or the policy'; h = tryHash(() => sha256(canonicalize((x.ap_structured as Record<string, unknown>).bill))) }
  else if (isObj(x.ap) && typeof (x.ap as Record<string, unknown>).invoice === 'string') { input = 'the invoice text'; rest = 'the purchase order, the goods receipt or the policy'; h = sha256((x.ap as { invoice: string }).invoice) }
  else if (Array.isArray(x.citations)) {
    input = 'the citations'; plural = true; rest = 'the opinion sources (the texts the quotations are checked against)'; h = tryHash(() => hashOf(x.citations))
    // engine 0.6.0 records each opinion text's sha256 and stated origin (opinion_sources, docs/LEGAL.md "Provenance"): name the one that moved
    const named = h === recorded ? opinionSourcesMoved(verdict, x.sources) : undefined
    if (named !== undefined) return `: the citations agree with the verdict's document.extraction_hash; ${named}`
  }
  else if (isObj(x.action)) { input = 'the proposed action'; rest = 'its sources'; h = tryHash(() => hashOf(x.action)) }
  else if (isObj(x.documents)) { input = 'the documents'; plural = true; rest = 'the reconciliation ruleset'; h = tryHash(() => hashOf(x.documents)) }
  else return undefined
  return h === recorded
    ? `: ${input} ${plural ? 'agree' : 'agrees'} with the verdict's document.extraction_hash, so the difference is in what the verdict does not record: ${rest}`
    : `: ${input} ${plural ? 'are' : 'is'} not what it was issued on (${plural ? 'their' : 'its'} hash is not the verdict's document.extraction_hash)`
}

/**
 * A legal verdict from engine 0.6.0 records, per supplied opinion text, its key, sha256 and stated origin (`opinion_sources`). When
 * the citations agree and input_hash does not, say which text moved, against that record (2026-10-05: the reason used to say the
 * verdict does not record the opinion sources, which it does). Undefined for a verdict that records none (engines before 0.6.0).
 */
function opinionSourcesMoved(verdict: Verdict, sources: unknown): string | undefined {
  const rec = (verdict as unknown as { opinion_sources?: unknown }).opinion_sources
  if (!Array.isArray(rec) || !isObj(sources)) return undefined
  const short = (s: string): string => `${s.slice(0, 12)}…`
  const out: string[] = []
  const supplied = Object.keys(sources).filter(k => textOf(sources[k]) !== undefined)
  for (const r of rec as { key: string; sha256: string; source?: string; url?: string; retrieved_at?: string; bind?: string }[]) {
    if (!isObj(r) || typeof r.key !== 'string' || typeof r.sha256 !== 'string') continue
    const text = supplied.includes(r.key) ? textOf(sources[r.key]) : undefined
    if (text === undefined) { out.push(`the opinion text for ${r.key} is not supplied (the verdict records sha256 ${short(r.sha256)})`); continue }
    const s = sha256(text)
    if (s !== r.sha256) { out.push(`the opinion text for ${r.key} is not the one the verdict records (supplied sha256 ${short(s)}, recorded ${short(r.sha256)})`); continue }
    const o = (isObj(sources[r.key]) ? sources[r.key] : {}) as Record<string, unknown>
    for (const f of ['source', 'url', 'retrieved_at', 'bind'] as const) {
      const now = typeof o[f] === 'string' ? o[f] as string : undefined
      if (now !== r[f]) out.push(`the stated ${f} of the opinion text for ${r.key} is ${now === undefined ? 'absent' : `"${now}"`}, where the verdict records ${r[f] === undefined ? 'none' : `"${r[f]}"`}`)
    }
  }
  for (const k of supplied) if (!(rec as { key?: unknown }[]).some(r => isObj(r) && r.key === k)) out.push(`an opinion text for ${k} is supplied that the verdict does not record`)
  return out.length > 0
    ? `against the opinion texts the verdict records (opinion_sources): ${out.join('; ')}`
    : 'every opinion text\'s sha256 and stated origin agree with the verdict\'s opinion_sources, so the difference is in a field of the sources the verdict does not record'
}

// ── re-performance ────────────────────────────────────────────────────────────────────────────────────────────────

/** `pinned`: the replay FAILS because the inputs' ruleset carries remedies other than the ruleset this build pins (F9). */
type Reperformed = { result: ReperformResult; pinned?: string } | { not: string }

/**
 * The first difference between the remedies a supplied declarative ruleset declares and the ruleset this build carries under
 * the same id@version, when the two are the same ruleset once remedies are set aside; else undefined (not carried, or another
 * ruleset under that name, whose identity the input_hash already binds).
 */
export function pinnedRemedyProblem(supplied: DeclarativeRuleset): string | undefined {
  let carried: DeclarativeRuleset | undefined
  try { carried = resolveDeclarativeRuleset(`${supplied.id}@${supplied.version}`) } catch { return undefined }
  if (!carried) return undefined
  if (canonicalize(rulesetIdentity(carried)) !== canonicalize(rulesetIdentity(supplied))) return undefined
  const a = remedyTableOf(carried), b = remedyTableOf(supplied)
  if (canonicalize(a) === canonicalize(b)) return undefined
  for (const part of ['checks', 'quotes'] as const) {
    const keys = [...new Set([...Object.keys(a[part]), ...Object.keys(b[part])])].sort()
    for (const k of keys) {
      if (canonicalize(a[part][k] ?? null) === canonicalize(b[part][k] ?? null)) continue
      return `the inputs carry ruleset ${supplied.id}@${supplied.version}, which this build carries, but the remedy declared for ${part === 'checks' ? 'check' : 'quote'} ${k} is not the carried ruleset's: remedies are re-derived from the pinned ruleset, never taken from a bundle`
    }
  }
  return `the inputs carry ruleset ${supplied.id}@${supplied.version}, whose remedies are not the carried ruleset's`
}

/** Pick the engine from the verdict's ruleset and the shape of its inputs, run it, and compare. Never throws. */
function reperform(presented: Verdict, inputs: unknown, opts: ReplayOptions, legacy = false): Reperformed {
  // 2026-10-03: re-performed under the engine version the verdict names, when this build carries it.
  if (!isRetainedEngine(presented.engine_version)) {
    return { not: `the verdict was issued by engine ${presented.engine_version}; this is engine ${ENGINE_VERSION}, which re-performs engines ${ENGINE_VERSIONS.join(' and ')} only, and a check is re-performed only by the engine that made it` }
  }
  const engineVersion = presented.engine_version
  if (!isObj(inputs)) return { not: 'the inputs are not an object, so no engine takes them' }
  let x: Record<string, unknown>
  try { x = structuredClone(inputs) } catch { x = inputs } // the engines never see the caller's objects
  const producer = typeof presented.document?.producer === 'string' ? presented.document.producer : undefined
  const now = (): Date => { const d = new Date(presented.issued_at); return isNaN(d.getTime()) ? new Date(0) : d }
  const common = { now, ...(producer !== undefined ? { producer } : {}), engine: engineVersion }
  const rs = presented.ruleset
  let engine: string
  let run: () => Verdict
  const has = (...keys: string[]): boolean => keys.every(k => Object.prototype.hasOwnProperty.call(x, k))
  // The override, restated or carried in the inputs themselves (verify()/declarative inputs only; a twin's is a number).
  const tol = opts.tolerance ?? (isObj(x.tolerance) ? (x.tolerance as unknown as TolerancePolicy) : undefined)

  if (has('twin_sha256')) {
    engine = 'twin'
    if (opts.document === undefined) return { not: 'a twin verdict\'s inputs commit to the filing by its sha256, not its text: supply the iXBRL document to re-perform it' }
    const map = [FS_CORE_TWIN_MAP, FS_CORE_TWIN_MAP_V02, FS_CORE_TWIN_MAP_V021].find(m => `${m.id}@${m.version}` === x.map)
    if (!map) return { not: `no twin map ${String(x.map)} in this build` }
    const statement = (map.binding ?? 'document') === 'statement'
    if (statement && x.presentation_sha256 !== null && opts.presentation === undefined) {
      return { not: `the twin map ${String(x.map)} binds through the filing's presentation linkbase: supply it (pre / filing summary / schema) to re-perform` }
    }
    run = () => {
      const presentation = statement && opts.presentation ? parseTwinPresentation(opts.presentation, { links: (map as TwinConceptMap).links === 'strict' ? 'strict' : 'v0.2' }) : undefined
      return verifyAgainstTwin(opts.document as string, x.claims as TwinClaim[], {
        ...common, periodEnd: x.period_end as string, periodToleranceDays: x.period_tolerance_days as number, tolerance: x.tolerance as number, map,
        ...(statement ? { presentation: presentation ?? null } : {}),
      }).verdict
    }
  } else if (has('xml_sha256')) {
    engine = 'twin-einvoice'
    if (opts.document === undefined) return { not: 'an e-invoice twin verdict\'s inputs commit to the XML by its sha256, not its text: supply the XML to re-perform it' }
    run = () => verifyEinvoiceTwin(opts.document as string, x.claims as EinvoiceClaim[], {
      ...common, tolerance: x.tolerance as number, quantityTolerance: x.quantity_tolerance as number, consistency: x.consistency as boolean,
      ...(typeof x.profile === 'string' ? { profile: x.profile as EinvoiceProfile } : {}),
    }).verdict
  } else if (has('action', 'sources') && rs.id === 'action') {
    engine = 'action'
    // The exact version the verdict names (action@0.1.0 and 0.0.1 are retained); an unknown one throws, so it is not re-performed.
    run = () => verifyAction(x.action as ProposedAction, x.sources as ActionSources, { ...common, ruleset: `${rs.id}@${rs.version}` })
  } else if (has('ap_structured', 'policy')) {
    engine = 'ap-structured'
    // Structured AP input: re-validated, then re-performed under the version the verdict names; an unknown one throws.
    run = () => verifyBillMatch(x.ap_structured, { ...common, policy: x.policy as ApPolicy, ruleset: `${rs.id}@${rs.version}` }).verdict
  } else if (has('ap', 'policy')) {
    engine = 'ap'
    // The exact version the verdict names ('ap-threeway@0.1.0' is retained); an unknown one throws, so it is not re-performed.
    run = () => verifyInvoiceMatch(x.ap as ApDocuments, { ...common, policy: x.policy as ApPolicy, ruleset: `${rs.id}@${rs.version}` }).verdict
  } else if (has('citations', 'sources') && rs.id === 'legal') {
    engine = 'legal'
    // The exact version the verdict names (legal@0.0.1, the default, or the opt-in 0.1.0); an unknown one throws, so it is not re-performed.
    run = () => verifyCitations(x.citations as Citation[], x.sources as OpinionSources, { ...common, ruleset: `${rs.id}@${rs.version}` })
  } else if (has('documents', 'ruleset')) {
    engine = 'reconcile'
    run = () => reconcile(x.documents as Record<string, Record<string, unknown>>, x.ruleset as ReconciliationRuleset, { now, engine: engineVersion })
  } else if (has('extraction', 'ruleset') && isDeclarativeRuleset(x.ruleset)) {
    engine = 'declarative'
    // F9 (2026-10-03): a carried ruleset's remedies are the carried ones, whatever the bundle says.
    const pinned = pinnedRemedyProblem(x.ruleset as DeclarativeRuleset)
    if (pinned !== undefined) return { result: { engine, identical: false, first_difference: 'inputs.ruleset (remedies)' }, pinned }
    // 2026-10-03: a declarative verdict issued with source text binds it (input_hash) and is re-performed with it
    // Engine 0.3.0: an arbitration re-verdict binds its evidence overlay (input_hash) and is re-performed with it
    // Engine 0.5.0: a verdict made with the judge's choice values or archive bytes binds them and is re-performed with them
    run = () => verifyDeclarative(x.extraction as Record<string, unknown>, x.ruleset as DeclarativeRuleset, {
      ...common, ...(tol ? { tolerance: tol } : {}), ...(isObj(x.source) ? { source: x.source as { text: string } } : {}), ...(isObj(x.evidence) ? { evidence: x.evidence as unknown as EvidenceOverlay } : {}),
      ...(Object.prototype.hasOwnProperty.call(x, 'supplied_choices') ? { supplied_choices: x.supplied_choices as Record<string, SuppliedChoice> } : {}),
      ...(Object.prototype.hasOwnProperty.call(x, 'archive_files') ? { archive_files: x.archive_files as ArchiveFile[] } : {}),
    })
  } else if (has('extraction', 'references', 'source')) {
    // The exact version the verdict names, when this build retains it ('invoice@0.0.1'); else the current one (which then refuses on version).
    const builtin = RULESET_VERSIONS.find(b => b.id === rs.id && b.version === rs.version) ?? RULESETS.find(b => b.id === rs.id)
    if (!builtin) return { not: `no built-in ruleset '${rs.id}' in this build (a declarative ruleset's inputs carry the ruleset itself)` }
    engine = `verify:${builtin.id}`
    const refs = isObj(x.references) ? x.references : {}
    run = () => verify(x.extraction as Record<string, unknown>, {
      ...common, ruleset: builtin,
      references: { ...(refs.contract !== null && refs.contract !== undefined ? { contract: refs.contract as Record<string, unknown> } : {}), evidence: refs.evidence as Record<string, unknown>[], history: refs.history as Record<string, unknown>[] },
      ...(x.source !== null && x.source !== undefined ? { source: x.source as { text: string } } : {}),
      ...(tol ? { tolerance: tol } : {}),
    })
  } else {
    return { not: `no engine in this build takes inputs shaped { ${Object.keys(x).sort().join(', ')} } for ruleset ${rs.id}@${rs.version}` }
  }

  let again: Verdict
  try { again = run() } catch (e) { return { not: `the ${engine} engine could not run on these inputs (${(e as Error).message})` } }
  // A pre-2026-09-28 override verdict: its identity was checked above under the scheme it was issued with (input_hash
  // without the override); this build hashes the override, so the identity fields are carried and the body is compared.
  if (legacy) again = { ...again, input_hash: presented.input_hash, verdict_id: presented.verdict_id }
  if (again.ruleset.id !== rs.id || again.ruleset.version !== rs.version) {
    return { not: `this build's ${engine} engine is ruleset ${again.ruleset.id}@${again.ruleset.version}; the verdict is ${rs.id}@${rs.version}, and a check is re-performed only under the ruleset that made it` }
  }
  if (again.input_hash !== presented.input_hash) {
    // The engine read these inputs differently than the binding says (e.g. a twin document that is not the hashed one).
    return { result: { engine, identical: false, first_difference: 'input_hash' } }
  }
  const result = compareBodies(presented, again, engine, bindsRemedyTable(engineVersion))
  if (legacy) result.annotations = [...(result.annotations ?? []), 'input_hash', 'verdict_id']
  return { result }
}

/** Byte-compare the engine's output (issued_at and the post-engine annotations aside); name the first differing field. */
function compareBodies(presented: Verdict, again: Verdict, engine: string, remediesBound = false): ReperformResult {
  const strip = (v: Verdict): Record<string, unknown> => {
    const { issued_at: _t, ...rest } = v as unknown as Record<string, unknown>
    for (const k of ANNOTATIONS) delete rest[k]
    return rest
  }
  const a = strip(again)
  const p = strip(presented)
  // Remedies (2026-10-02) are the engine's output, so a verdict that carries them is compared on them too. A verdict that
  // carries none (issued before remedies existed) is compared on its core, and the re-derived remedies are reported.
  // Engine 0.2.0 binds its remedy table and always attaches remedies, so a missing list is a divergence there (F18).
  const notCarried = presented.remedies === undefined && again.remedies !== undefined && !remediesBound
  if (notCarried) delete a.remedies
  const annotations = notReperformedFields(presented)
  const identical = canonicalize(a) === canonicalize(p)
  const first = identical ? undefined : firstDifference(a, p, '') ?? '(canonical bytes)'
  return {
    engine, identical, ...(first !== undefined ? { first_difference: first } : {}), ...(annotations.length ? { annotations } : {}),
    ...(again.remedies !== undefined ? { remedies: again.remedies } : {}), ...(notCarried ? { remedies_not_carried: true as const } : {}),
  }
}

/** The first path where `b` (presented) differs from `a` (re-performed), walking `a`'s own field order (outcome before claims). */
function firstDifference(a: unknown, b: unknown, path: string): string | undefined {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return path || '(root)'
    const n = Math.max(a.length, b.length)
    for (let i = 0; i < n; i++) {
      if (i >= a.length || i >= b.length) return `${path}[${i}]`
      const d = firstDifference(a[i], b[i], `${path}[${i}]`)
      if (d !== undefined) return d
    }
    return undefined
  }
  if (isObj(a) && isObj(b)) {
    const keys = [...Object.keys(a), ...Object.keys(b).filter(k => !Object.prototype.hasOwnProperty.call(a, k))]
    for (const k of keys) {
      const d = firstDifference(a[k], b[k], path ? `${path}.${k}` : k)
      if (d !== undefined) return d
    }
    return undefined
  }
  return canonicalize(a) === canonicalize(b) ? undefined : path || '(root)'
}
