/**
 * Replay a proof bundle, or a folder of them: `riposte replay` (2026-10-02).
 *
 * A BUNDLE is a verdict (or its signed envelope) together with the inputs its input_hash commits to, and any replay options:
 *   { "verdict": <verdict | envelope>, "inputs": <the bound inputs>, "options"?: { "tolerance"?, "document"? } }
 * Replaying it re-performs the check with this build's deterministic engine (no model, no network, no service) and
 * byte-compares the recomputed verdict with the presented one, remedies included (protocol/replay.ts):
 *   MATCH            re-performed and byte-identical (issued_at and post-engine annotations aside). The answer and the
 *                    remedies printed are the presented verdict's own.
 *   DIVERGED         the binding fails, the re-performed verdict differs (the first differing field is named), or a signed
 *                    envelope's signature does not verify
 *   NOT_REPERFORMED  the binding holds but nothing here re-performs it (no inputs, another engine version, a twin without
 *                    its document): nothing is said about the outcome
 *   REFUSED          not a bundle, or not a verdict; from 2026-10-19 also a bundle with a key its format does not define
 *                    (unknownKeys; allowUnknownKeys reads it as before) or a verdict whose annotation carries a member its
 *                    declared shape does not have (replay.ts annotationMemberProblem)
 * A verdict of engine 0.0.1 or 0.1.0 that carries no remedies DIVERGES at `remedies` by default (2026-10-05, miss
 * F18: a bundle is a file its holder has whole, so a deleted list is an edit). With `lenientRemedies` (a verdict issued before
 * remedies existed) it MATCHes on its core, and the remedies this build derives are reported beside it (`remedies_not_carried`).
 *
 * Pure: the caller reads the files (cli.ts, receipts' riposte-replay). A `.jsonl` text holds one bundle per line; a `.json`
 * text holds one bundle, or an array of them.
 */

import type { Remedy, Verdict } from '../verdict/schema.js'
import { answerOf, renderRemedies } from '../verdict/remedy.js'
import { verifyReplay, notReperformedFields, type ReplayOptions } from './replay.js'
import { verifyEnvelope, type SignedVerdict } from './envelope.js'
import { nonFinitePath, nonFiniteRefusal, startsWithBom, duplicateKeyPath, duplicateKeyRefusal, inexactNumberPath, inexactNumberRefusal, tooDeepOffset, tooDeepRefusal, INEXACT_NUMBER_WORDS } from './hash-input.js'
import { gateHeadline } from '../verdict/aggregation.js'
import type { TolerancePolicy } from '../tolerance.js'
import { verifyInvoiceMatch, type ApDocuments, type ApPolicy } from '../ap/index.js'
import { verifyBillMatch } from '../ap/structured.js'
import { ENGINE_VERSION } from '../version.js'
import { legalRuleNow, renderRuleNow, type RuleNow } from '../legal/replay-notice.js'
import { todayReading, renderTodayReading, type TodayReading } from './rule-now.js'
import { AP_DERIVED_KEYS, apDerivable, apDerivedKeysIn, apFieldsReason, checkApFields } from './replay-ap.js'

export interface ReplayBundle {
  verdict: Verdict | SignedVerdict
  inputs?: unknown
  options?: { tolerance?: TolerancePolicy; document?: string }
}

export type CaseResult = 'MATCH' | 'DIVERGED' | 'NOT_REPERFORMED' | 'REFUSED'

export interface CaseReplay {
  name: string
  result: CaseResult
  verdict_id?: string
  /** The verdict's answer, when it was re-performed: PASS, FAIL or INSUFFICIENT_DATA (can't tell; the older word ABSTAIN is never written since 2026-10-05). */
  answer?: 'PASS' | 'FAIL' | 'INSUFFICIENT_DATA'
  /** The remedies, when it was re-performed and has any: the presented verdict's own, or (not carried) the re-derived ones. */
  remedies?: Remedy[]
  remedies_not_carried?: true
  engine?: string
  first_difference?: string
  reason?: string
  /** Present for a signed envelope: whether its signature verifies over the presented body. */
  signature_ok?: boolean
  /** When re-performed: how many checks the verdict holds, and how many could not run (INSUFFICIENT_DATA). */
  checks?: number
  unchecked?: number
  /** For an AP bundle: the gate's decision, re-derived from the same inputs under the verdict's own engine (what the row recorded). */
  gate?: GateReading
  /** For an AP bundle of an older engine: this build's gate reading of the same inputs, present only when it reads differently. */
  gate_now?: GateNow
  /**
   * 2026-10-05 (legal): today's default legal rule's reading of the same inputs, present only when it differs (legal/replay-notice.ts).
   * 2026-10-06: the same for a declarative or built-in verdict (protocol/rule-now.ts; it carries `noun`).
   */
  rule_now?: RuleNow | TodayReading
  /**
   * Present only when the replay was asked to be strict (2026-10-05: `verify replay --strict`): why this case, though it may
   * MATCH, does not pass a strict replay (fields not re-performed, remedies re-derived, an envelope whose key is not pinned).
   */
  strict_problems?: string[]
  /** Present only for a strict replay (2026-10-05): what it says without failing on it (the issuer's producer label). */
  strict_notes?: string[]
  /** Present on a case REFUSED because its bundle carries keys the format does not define (2026-10-19): those keys, by path. */
  unknown_keys?: string[]
}

/**
 * How a replay judges what re-performance cannot (2026-10-05). Both are opt-in, so a replay without them answers exactly as
 * before. `isTrusted` pins the signing key: an envelope signed by another key, or a verdict with no signature, DIVERGES at
 * `signature`. `strict` lists, on each case, what was not re-performed (`strict_problems`).
 */
export interface ReplayCaseOptions {
  isTrusted?: (publicKeyPem: string) => boolean
  strict?: boolean
  /** 2026-10-05: accept an engine-0.0.1/0.1.0 verdict that carries no remedies (replay.ts ReplayOptions.lenientRemedies). */
  lenientRemedies?: boolean
  /**
   * 2026-10-19: read a bundle that carries keys its format does not define as before (named "carried, not checked", the exit
   * unchanged, --strict refusing them) instead of refusing it (`verify replay --allow-unknown-keys`). Without it such a case is
   * REFUSED, the keys named (unknownKeys).
   */
  allowUnknownKeys?: boolean
}

/** What the AP gate decides on a verdict's inputs: approve, a hold, or abstain (a person decides). */
export interface GateReading { decision: string; payable: boolean | null }

/**
 * What a replayed verdict means for the person acting on it (2026-10-03): how many checks could not run, and, for an AP
 * bundle, the gate's decision re-derived from the bundle's own inputs. The verdict's outcome is verify's ANY_FAIL_FAILS
 * aggregation, so an invoice the gate sends to a person (a check could not run, nothing failed) has outcome PASS; this is
 * what keeps a replay from printing that PASS bare. It reads the verdict; it changes nothing in it.
 */
export function replayReading(verdict: Verdict, inputs: unknown): { checks: number; unchecked: number; gate?: GateReading; gate_now?: GateNow; rule_now?: RuleNow | TodayReading } {
  const claims = Array.isArray(verdict?.claims) ? verdict.claims : []
  const out: { checks: number; unchecked: number; gate?: GateReading; gate_now?: GateNow; rule_now?: RuleNow | TodayReading } = { checks: claims.length, unchecked: claims.filter(c => c?.outcome === 'INSUFFICIENT_DATA').length }
  // 2026-10-05: the gate line is PINNED to the verdict's own engine, because that is the reading the row recorded and what a
  // replayer compares against (an engine-0.1.0 AP verdict with no payment history recorded EXECUTE/PAY; this build's 0.6.0 gate
  // abstains on the same inputs). This build's own reading follows as `gate_now` only when it reads differently, and is labelled.
  // `engine` undefined = this build's engine.
  let decide: ((engine: string | undefined) => GateReading) | undefined
  if (isObj(inputs) && isObj(inputs.ap_structured) && isObj(inputs.policy) && isObj(verdict?.ruleset)) {
    const ap = inputs.ap_structured, policy = inputs.policy as ApPolicy, ruleset = `${verdict.ruleset.id}@${verdict.ruleset.version}`
    decide = (engine) => { const r = verifyBillMatch(ap, { policy, ruleset, now: () => new Date(0), ...(engine !== undefined ? { engine } : {}) }); return { decision: r.decision, payable: r.payable } }
  } else if (isObj(inputs) && isObj(inputs.ap) && isObj(inputs.policy) && isObj(verdict?.ruleset)) {
    const ap = inputs.ap as unknown as ApDocuments, policy = inputs.policy as ApPolicy, ruleset = `${verdict.ruleset.id}@${verdict.ruleset.version}`
    decide = (engine) => { const r = verifyInvoiceMatch(ap, { policy, ruleset, now: () => new Date(0), ...(engine !== undefined ? { engine } : {}) }); return { decision: r.decision, payable: r.payable } }
  }
  if (decide) {
    // not an AP bundle this build reads, or an engine it does not carry: no gate line
    try { out.gate = decide(typeof verdict.engine_version === 'string' ? verdict.engine_version : undefined) } catch { /* no gate line */ }
    if (out.gate !== undefined && verdict.engine_version !== ENGINE_VERSION) {
      try {
        const now = decide(undefined)
        if (renderGate(now) !== renderGate(out.gate)) out.gate_now = { engine: ENGINE_VERSION, ...now }
      } catch { /* no second line */ }
    }
  }
  // 2026-10-05 (legal): a legal verdict under an older rule, whose inputs today's default rule reads differently, says so
  // 2026-10-06: and a declarative or built-in verdict under an older rule or engine (protocol/rule-now.ts)
  const ruleNow = legalRuleNow(verdict, inputs) ?? todayReading(verdict, inputs)
  if (ruleNow) out.rule_now = ruleNow
  return out
}

/** The lines a replay prints for `rule_now`, whichever reading made it (legal, or declarative and built-in). */
export function renderAnyRuleNow(r: RuleNow | TodayReading, recordedEngine?: string): string[] {
  return 'noun' in r ? renderTodayReading(r, recordedEngine) : renderRuleNow(r, recordedEngine)
}

/** This build's own gate reading of an older verdict's inputs, present only when it reads differently from the pinned one. */
export interface GateNow extends GateReading { engine: string }

/**
 * 2026-10-05: what a replay says, with or without --strict, about a matching verdict that carries no issued_at. A strict
 * replay also fails it (strictProblems); a plain replay used to say only "issued_at aside".
 */
export const ISSUED_AT_MISSING = 'the verdict carries no issued_at (every verdict records when it was issued; --strict fails it)'

/**
 * 2026-10-05: on a replayed AP proof the gate's decision is printed beside the verdict, so
 * the scope's closing line "This is a check, not a decision." is printed as this instead. The verdict's scope block is unchanged.
 */
export const AP_REPLAY_SCOPE = 'This re-performs the check; the APPROVE or HOLD line is the gate\'s decision on it.'

/** The labelled second line for an older verdict whose inputs this build's gate reads differently: never the only line. */
export const renderGateNow = (g: GateNow): string => `under engine ${g.engine} this would read ${renderGate(g)}`

/**
 * The answer, in the order a person acts on it: the gate's decision first (AP), then the verdict, with the checks that could
 * not run. Never a bare PASS when a check could not run:
 *   `A PERSON DECIDES (gate: a check could not decide) · verdict PASS with 1 of 6 checks unable to run`
 *   `PASS with 2 of 9 checks unable to run`            (no gate: not an AP verdict)
 *   `PASS`                                              (every check ran and passed)
 */
export function renderAnswer(answer: 'PASS' | 'FAIL' | 'INSUFFICIENT_DATA', r: { checks?: number; unchecked?: number; gate?: GateReading }): string {
  // Only a PASS needs the count: a FAIL already says do not act, and INSUFFICIENT_DATA says a check could not run.
  const unable = answer === 'PASS' && r.unchecked ? ` with ${r.unchecked} of ${r.checks ?? '?'} check${r.checks === 1 ? '' : 's'} unable to run` : ''
  if (r.gate) return `${renderGate(r.gate)} · verdict ${answer}${unable}`
  return `${answer}${unable}`
}

export interface ReplaySummary {
  total: number
  matched: number
  diverged: number
  not_reperformed: number
  refused: number
  cases: CaseReplay[]
  /**
   * 2026-10-05: for each case that MATCHed, the fields of its verdict that were not re-performed (annotations and
   * document.producer; replay.ts notReperformedFields), by case name. Present only when some case carries one. It sits beside the
   * cases, not in them, so every case reads exactly as it did.
   */
  fields_not_reperformed?: Record<string, string[]>
  /** Present only for a strict replay: how many cases have strict problems. */
  strict_failed?: number
  /**
   * 2026-10-13: for each case whose bundle carries keys outside the verdict and its inputs (carriedKeys), those keys, by case
   * name. Present only when some case carries one. It sits beside the cases, not in them, so every case reads exactly as it did.
   */
  carried_not_checked?: Record<string, string[]>
  /** The allowed caller keys (`id`, `note`) each bundle carries at its top level, by case name; present only when some case carries one. */
  carried_allowed?: Record<string, string[]>
  /** Present only when the replay was told to carry unknown keys instead of refusing them (2026-10-19: allowUnknownKeys). */
  allow_unknown_keys?: 'stated'
}

const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x)
const isEnvelope = (x: unknown): x is SignedVerdict => isObj(x) && isObj(x.verdict) && typeof x.signature === 'string' && typeof x.public_key === 'string'

/** Is `x` a bundle ({ verdict, inputs?, options? }; any other key is carried, not checked: carriedKeys) rather than a bare verdict or envelope? */
export function isReplayBundle(x: unknown): x is ReplayBundle {
  if (!isObj(x) || !isObj(x.verdict)) return false
  return !isEnvelope(x) // an envelope also has `verdict`; it is a verdict to replay, not a bundle
}

// ── keys outside the verdict body (2026-10-13) ──────────────────────────────────────────────────────────────────────────
// A cold reader found that a key beside the verdict and its inputs ({ verdict, inputs, extra } in a bundle; a key beside
// verdict, alg, public_key and signature in a signed envelope) replayed VERIFIED, exit 0, under --strict, in folder mode, with
// --trusted-key and over POST /v1/replay, and nothing named it. A replay compares the verdict and binds its inputs; it reads
// nothing else. So every replay names such keys ("carried, not checked: <keys>"), and --strict refuses them.

/** The members of a signed envelope (envelope.ts). */
const ENVELOPE_KEYS: ReadonlySet<string> = new Set(['verdict', 'alg', 'public_key', 'signature'])
/** The members of a replay bundle; `options` holds the two the replay reads. */
const BUNDLE_KEYS: ReadonlySet<string> = new Set(['verdict', 'inputs', 'options'])
/** The members `verify ap` writes around the verdict (cli.ts runApStructured and the emailed-bill path): its own output. */
const AP_OUTPUT_KEYS: ReadonlySet<string> = new Set(['verdict', 'decision', 'payable', 'grounding', 'reasons', 'not_checked', 'proof', 'read', 'exit', 'allow_open'])
/** The members of an emailed-bill result's `read` (cli.ts apTextReplay reads each). */
const AP_READ_KEYS: ReadonlySet<string> = new Set(['form', 'text_sha256', 'history_sha256', 'policy', 'invoice_sha256', 'po_sha256', 'receipt_sha256'])

/**
 * The two caller keys a bundle may carry at its top level (ruled 2026-10-13): named on every replay as allowed, never checked,
 * and not refused by --strict. Only there: beside a signed envelope's members, inside `options` or beside `ap`'s output they are
 * outside keys like any other.
 */
export const ALLOWED_CALLER_KEYS: ReadonlySet<string> = new Set(['id', 'note'])

/** The words a replay names carried keys with, on the line under its first. */
export const CARRIED_WORDS = 'carried, not checked'
/** The line (without its "verify replay: " lead) that names the keys a file carries outside the verdict and its inputs. */
export const carriedLine = (keys: readonly string[]): string =>
  `${CARRIED_WORDS}: ${keys.join(', ')} (outside the verdict and its inputs: a replay compares neither; --strict refuses them)`
/** The line (without its "verify replay: " lead) that names the allowed caller keys a bundle carries. */
export const allowedLine = (keys: readonly string[]): string =>
  `carried (allowed): ${keys.join(', ')} (the caller keys a bundle may carry beside its verdict: not checked, and --strict allows them)`
/** The words --strict refuses carried keys with. */
export const OUTSIDE_STRICT_WORDS = 'outside keys under --strict'
const outsideKeysProblem = (keys: readonly string[]): string =>
  `${OUTSIDE_STRICT_WORDS}: ${keys.join(', ')} (carried beside the verdict, not checked: remove them, or replay without --strict)`

/** The output of `verify ap`: a proof member (structured input), or an ap-threeway verdict beside its decision (an emailed bill). */
function isApOutput(x: Record<string, unknown>): boolean {
  if (x.inputs !== undefined) return false
  if (isObj(x.proof) && isObj(x.proof.verdict)) return true
  return isObj(x.verdict) && isObj(x.verdict.ruleset) && x.verdict.ruleset.id === 'ap-threeway' && typeof x.decision === 'string'
}

/**
 * The keys a replay file carries outside the verdict and its inputs, as paths from the file's top (2026-10-13): beside a signed
 * envelope's four members; beside a bundle's verdict, inputs and options (and an options key the replay does not read, or an
 * envelope's extra key when the bundle's verdict is one, `verdict.<key>`); beside the members `verify ap` writes, and its `read`
 * member when the replay was not given the files to compare it with (`readUsed`). A bare verdict carries none: every key of it is
 * compared. The allowed caller keys at a bundle's top level are not among them (allowedKeys). Empty when there are none, or `x`
 * is none of these.
 * 2026-10-19: `apChecked`, the replay compared the AP gate's derived fields a bundle states beside an AP verdict (replay-ap.ts),
 * so those fields are checked, not carried. Beside the output of `verify ap` they were never carried: they are its own members.
 */
export function carriedKeys(x: unknown, opts: { readUsed?: boolean; apChecked?: boolean } = {}): string[] {
  if (!isObj(x)) return []
  const extra = (o: Record<string, unknown>, known: ReadonlySet<string>, prefix = ''): string[] => Object.keys(o).filter(k => !known.has(k)).map(k => `${prefix}${k}`)
  if (isEnvelope(x)) return extra(x, ENVELOPE_KEYS)
  if (isApOutput(x)) {
    // ruled 2026-10-13: `read` is checked only when the replay re-hashed the files it records; otherwise it is carried
    const read = x.read !== undefined && !opts.readUsed
    return [
      ...extra(x, AP_OUTPUT_KEYS),
      ...(isObj(x.proof) ? extra(x.proof, new Set(['verdict', 'inputs']), 'proof.') : []),
      ...(read ? ['read'] : isObj(x.read) ? extra(x.read, AP_READ_KEYS, 'read.') : []),
    ]
  }
  if (!isReplayBundle(x)) return []
  const out = extra(x, new Set([...BUNDLE_KEYS, ...ALLOWED_CALLER_KEYS, ...(opts.apChecked && apDerivable(x) ? AP_DERIVED_KEYS : [])]))
  if (x.options !== undefined) {
    if (!isObj(x.options)) out.push('options')
    else for (const [k, v] of Object.entries(x.options)) {
      if (!(k === 'tolerance' && isObj(v)) && !(k === 'document' && typeof v === 'string')) out.push(`options.${k}`)
    }
  }
  if (isEnvelope(x.verdict)) out.push(...extra(x.verdict as unknown as Record<string, unknown>, ENVELOPE_KEYS, 'verdict.'))
  return out
}

/** The allowed caller keys (`id`, `note`) a bundle carries at its top level, in the file's order; empty for anything but a bundle. */
export function allowedKeys(x: unknown): string[] {
  if (!isObj(x) || isEnvelope(x) || isApOutput(x) || !isReplayBundle(x)) return []
  return Object.keys(x).filter(k => ALLOWED_CALLER_KEYS.has(k))
}

// ── fail closed on keys the format does not define (2026-10-19) ───────────────────────────────────────────────────────────
// A cold reader (platform engineer's role) found the safe answer behind a flag: a bundle or a signed envelope carrying a key
// its format does not define replayed with exit 0, the key named "carried, not checked", and only --strict refused it. Ruled
// the same evening: a replay reads nothing it does not check, so by default it refuses such a file (exit 3), naming each key;
// `verify replay --allow-unknown-keys` (allowUnknownKeys) keeps the old reading and says it was given. What the format defines:
// a bundle's verdict, inputs and options (tolerance, document), the caller keys id and note at its top level, and, beside an AP
// verdict whose inputs the gate reads, the gate's fields the replay compares (replay-ap.ts); a signed envelope's four members.
// The output of `verify ap` is not a bundle: a key it never writes already fails its replay by name (replay-ap.ts).

/** The keys a bundle or a signed envelope carries that its format does not define, by path; empty for anything else. */
export function unknownKeys(x: unknown): { kind: 'bundle' | 'signed envelope'; keys: string[] } {
  if (!isObj(x)) return { kind: 'bundle', keys: [] }
  if (isEnvelope(x)) return { kind: 'signed envelope', keys: carriedKeys(x) }
  if (isApOutput(x) || !isReplayBundle(x)) return { kind: 'bundle', keys: [] }
  return { kind: 'bundle', keys: carriedKeys(x, { apChecked: true }) }
}

/** The words a replay refuses unknown keys with (without the "verify replay: input refused: " lead). */
export const UNKNOWN_KEYS_WORDS = 'its format does not define'
export function unknownKeysReason(kind: 'bundle' | 'signed envelope', keys: readonly string[]): string {
  const one = keys.length === 1
  const shape = kind === 'bundle'
    ? 'a bundle is { verdict, inputs, options? } with the caller keys id and note, and beside an AP verdict the gate\'s fields, which a replay compares'
    : 'a signed envelope is { verdict, alg, public_key, signature }'
  return `the ${kind} carries ${one ? 'a key' : 'keys'} ${UNKNOWN_KEYS_WORDS}: ${keys.join(', ')} (${shape}; a replay checks nothing else, so it refuses what it would not check: remove ${one ? 'it' : 'them'}, or replay with --allow-unknown-keys to have ${one ? 'it' : 'them'} named and carried, not checked)`
}

/** The line (without its "verify replay: " lead) a replay prints when --allow-unknown-keys was given, whatever it found. */
export const ALLOW_UNKNOWN_KEYS_LINE = '--allow-unknown-keys was given: a key a bundle or a signed envelope does not define is named and carried, not checked, instead of refused (the caller\'s stated choice; --strict still refuses it)'

/**
 * A replay's exit, from its counts (2026-10-13): 3 when any case was refused (a case that cannot be read is never hidden by a
 * sibling's exit), else 1 when any diverged or failed --strict (or `failed` more, the caller's own failures), else 2 when any
 * was not re-performed, else 0. The command line's folder mode and POST /v1/replay's x-verify-exit both read it.
 */
export function replayExit(s: Pick<ReplaySummary, 'diverged' | 'not_reperformed' | 'refused' | 'strict_failed'>, failed = 0): 0 | 1 | 2 | 3 {
  if (s.refused > 0) return 3
  if (s.diverged > 0 || (s.strict_failed ?? 0) > 0 || failed > 0) return 1
  return s.not_reperformed > 0 ? 2 : 0
}

/**
 * The HTTP status a replay answers with, from its exit (2026-10-19; a cold reader's finding: a DIVERGED replay answered 200, with
 * `x-verify-exit: 1` the only sign, so a proxy or a client that reads only the status took a forgery for a success):
 *   409  exit 1, a case diverged or failed. The presented verdict conflicts with the one re-performed from its own inputs: the
 *        request was read and run, and what it presents does not verify. 409 is what this server already answers when a book
 *        of record does not verify; 422 says the request itself could not be processed, which is not what happened.
 *   422  exit 3, a case was refused (not a bundle, not a verdict, refused before hashing): the body was valid JSON, but a case in
 *        it is not one a replay can read. A refused case wins the exit (replayExit), so it must not answer 200 either, or a
 *        batch with one diverged and one unreadable case would read as success.
 *   200  exit 0 (every case matched) and exit 2 (none diverged, some were not re-performed): nothing presented was found false.
 * The `x-verify-exit` header is set in every case; a request that names no bundle stays 400.
 */
export function replayStatus(exit: 0 | 1 | 2 | 3): 200 | 409 | 422 {
  return exit === 1 ? 409 : exit === 3 ? 422 : 200
}

/** What a replay advises for a number that cannot be represented exactly (2026-10-13; the advice the command line gives elsewhere,
 * "write amounts as strings", changes the input, so a replay of the verdict could never match). */
export const REPLAY_INEXACT_WORDS = 'a number that cannot be represented exactly; re-issue the verdict with the amount as a string; a replay of the existing verdict cannot change its input'

/** A refusal's words as a replay says them: the inexact-number advice swapped for the one true of a replay; any other unchanged. */
export function replayAdvice(message: string): string {
  if (!message.includes(INEXACT_NUMBER_WORDS)) return message
  return message.replace(INEXACT_NUMBER_WORDS, REPLAY_INEXACT_WORDS).replace(/\. Then run it again$/, '')
}

/** Replay one bundle. Never throws. `opts` (2026-10-05) pins a key and asks for a strict replay; without it, nothing changes. */
export function replayBundle(b: unknown, name = 'case', caseOpts: ReplayCaseOptions = {}): CaseReplay {
  // A file that did not read as JSON (or that the hash contract refuses: a byte-order mark, a number past the double range) is
  // refused with its own reason, not as "not a replay bundle".
  if (isObj(b) && typeof b.__unparseable === 'string' && Object.keys(b).length === 1) return { name, result: 'REFUSED', reason: b.__unparseable }
  if (!isReplayBundle(b)) return { name, result: 'REFUSED', reason: 'not a replay bundle: { "verdict": <verdict or envelope>, "inputs": <inputs>, "options"? }' }
  const env = isEnvelope(b.verdict) ? b.verdict : undefined
  const verdict = (env ? env.verdict : b.verdict) as Verdict
  // 2026-10-19: a key the bundle format does not define is refused, named, unless the caller states otherwise (allowUnknownKeys)
  if (!caseOpts.allowUnknownKeys) {
    const unknown = unknownKeys(b)
    if (unknown.keys.length) return { name, result: 'REFUSED', ...(typeof verdict?.verdict_id === 'string' ? { verdict_id: verdict.verdict_id } : {}), reason: unknownKeysReason(unknown.kind, unknown.keys), unknown_keys: unknown.keys }
  }
  const opts: ReplayOptions = caseOpts.lenientRemedies ? { lenientRemedies: true } : {}
  if (isObj(b.options)) {
    if (isObj(b.options.tolerance)) opts.tolerance = b.options.tolerance as unknown as TolerancePolicy
    if (typeof b.options.document === 'string') opts.document = b.options.document
  }
  let r
  try { r = verifyReplay(verdict, b.inputs, opts) } catch (e) { return { name, result: 'REFUSED', reason: `could not replay: ${(e as Error).message}` } }
  const base: CaseReplay = { name, result: 'REFUSED', ...(typeof verdict?.verdict_id === 'string' ? { verdict_id: verdict.verdict_id } : {}) }
  if (r.refused) return { ...base, result: 'REFUSED', reason: r.reason ?? 'not a verdict' }
  if (env) {
    const ec = verifyEnvelope(env)
    base.signature_ok = ec.signature_ok
    if (!ec.signature_ok) return { ...base, result: 'DIVERGED', first_difference: 'signature', reason: ec.reason ?? 'the envelope\'s signature does not verify' }
  }
  // 2026-10-05: a pinned key. A valid signature by another key proves only that the holder of THAT key issued the verdict.
  if (caseOpts.isTrusted) {
    if (!env) return { ...base, result: 'DIVERGED', first_difference: 'signature', reason: 'the verdict is not signed, and --trusted-key requires a signature by the trusted key' }
    if (!caseOpts.isTrusted(env.public_key)) return { ...base, result: 'DIVERGED', first_difference: 'signature', reason: 'the envelope is signed by a key that is not the trusted key: its signature verifies, but it proves only that the holder of that other key issued the verdict' }
  }
  if (r.reperformed) base.engine = r.reperformed.engine
  if (r.status === 'FAILED') {
    return { ...base, result: 'DIVERGED', ...(r.reperformed?.first_difference ? { first_difference: r.reperformed.first_difference } : { first_difference: r.id_ok ? (/^replay refuses: /.test(r.reason ?? '') ? 'algorithms' : 'input_hash') : 'verdict_id' }), reason: r.reason ?? 'the verdict does not replay' }
  }
  if (r.status !== 'REPERFORMED') return { ...base, result: 'NOT_REPERFORMED', reason: r.not_reperformed ?? 'not re-performed' }
  const remedies = r.reperformed?.remedies
  const reading = replayReading(verdict, b.inputs)
  // 2026-10-19: a bundle that states the AP gate's derived fields (decision, payable, grounding, reasons, not_checked) beside an
  // AP verdict has them derived again from the re-performed verdict and compared; one that differs DIVERGES, named (replay-ap.ts)
  const apStated = apDerivedKeysIn(b).length > 0 && apDerivable(b)
  if (apStated) {
    const ap = checkApFields(b as unknown as Record<string, unknown>, verdict, b.inputs, { whole: false })
    if (ap && !ap.ok) return { ...base, result: 'DIVERGED', first_difference: ap.differences[0]!.field, reason: apFieldsReason(ap) }
  }
  // 2026-10-13: --strict refuses keys the bundle carries outside the verdict and its inputs (carriedKeys)
  const strict = caseOpts.strict ? strictProblems(verdict, r.reperformed?.remedies_not_carried === true, env !== undefined && !caseOpts.isTrusted, carriedKeys(b, { apChecked: apStated })) : undefined
  const notes = caseOpts.strict ? strictNotes(verdict, env !== undefined && caseOpts.isTrusted !== undefined) : undefined
  return {
    ...base, result: 'MATCH', answer: answerOf(verdict.outcome),
    ...(remedies ? { remedies } : {}), ...(r.reperformed?.remedies_not_carried ? { remedies_not_carried: true as const } : {}),
    checks: reading.checks, unchecked: reading.unchecked, ...(reading.gate ? { gate: reading.gate } : {}), ...(reading.gate_now ? { gate_now: reading.gate_now } : {}), ...(reading.rule_now ? { rule_now: reading.rule_now } : {}),
    ...(strict ? { strict_problems: strict } : {}),
    ...(notes?.length ? { strict_notes: notes } : {}),
  }
}

/**
 * What a strict replay fails on, for a verdict that re-performed byte-identical (2026-10-05; semantics fixed later that day,
 * 2026-10-05): an annotation (a post-engine field asserting something the engine did not produce: channel, ledger, declared_accuracy,
 * action_context, case), remedies that were absent and re-derived, an envelope whose key was not pinned, and an issued_at that
 * is missing (a malformed one is refused before any replay: replay.ts issuedAtProblem). Empty: the strict replay passes.
 *
 * `document.producer` is NOT a strict failure (2026-10-05: strict failed every genuine legal bundle for carrying one, and passed
 * the same bundle with it deleted). It is the issuer's label: the replay carries it into the re-run, the re-run writes it back,
 * and the body is byte-compared with it in place, so a producer that is not a string the engine writes DIVERGES. What the replay
 * cannot say is that the label is true; strictNotes says so, and a signature by a pinned key is what binds it.
 *
 * 2026-10-13: `carried`, the keys the file carries outside the verdict and its inputs (carriedKeys), fail it too: "outside keys
 * under --strict: <keys>".
 */
export function strictProblems(verdict: unknown, remediesAbsent: boolean, unpinnedEnvelope: boolean, carried: readonly string[] = []): string[] {
  const fields = notReperformedFields(verdict).filter(f => f !== 'document.producer')
  return [
    ...(fields.length ? [`not re-performed (not the engine's output): ${fields.join(', ')}`] : []),
    ...(remediesAbsent ? ['remedies absent; re-derived (the verdict carries none, so the remedies shown are this build\'s)'] : []),
    ...(unpinnedEnvelope ? ['the envelope\'s key is not pinned: pass --trusted-key <public key> to say whose signature counts'] : []),
    ...(isObj(verdict) && verdict.issued_at === undefined ? ['issued_at is missing: every verdict records when it was issued'] : []),
    ...(carried.length ? [outsideKeysProblem(carried)] : []),
  ]
}

/**
 * What a strict replay says without failing on it (2026-10-05): the issuer's label, compared as carried, bound by neither
 * input_hash nor verdict_id. `signedByPinnedKey`: the label sits inside a body a pinned key signed, so that key holder vouches for it.
 */
export function strictNotes(verdict: unknown, signedByPinnedKey: boolean): string[] {
  const doc = isObj(verdict) && isObj(verdict.document) ? verdict.document : undefined
  if (typeof doc?.producer !== 'string') return []
  return [`document.producer ${JSON.stringify(doc.producer)} is the issuer's label: compared as carried, bound by neither input_hash nor verdict_id${signedByPinnedKey ? '; it is inside the body the pinned key signed' : '; only a signature by a pinned key binds it'}`]
}

/** Replay many bundles, in order, and count. `opts` (2026-10-05) adds a pinned key and the strict reading to every case. */
export function replayBundles(items: readonly { name: string; bundle: unknown }[], opts: ReplayCaseOptions = {}): ReplaySummary {
  const cases = items.map(i => replayBundle(i.bundle, i.name, opts))
  const n = (res: CaseResult): number => cases.filter(c => c.result === res).length
  const fields: Record<string, string[]> = {}
  cases.forEach((c, i) => {
    if (c.result !== 'MATCH') return
    const f = notReperformedFields(presentedOf(items[i]!.bundle))
    if (f.length) fields[c.name] = f
  })
  // 2026-10-13: the keys each bundle carries outside the verdict and its inputs, whatever its result
  const carried: Record<string, string[]> = {}
  const allowed: Record<string, string[]> = {}
  cases.forEach((c, i) => {
    const b = items[i]!.bundle
    // 2026-10-19: the AP gate's derived fields a bundle states were compared when its verdict matched (or diverged at one of them)
    const apChecked = c.result === 'MATCH' || (c.result === 'DIVERGED' && (AP_DERIVED_KEYS as readonly string[]).includes(c.first_difference ?? ''))
    // 2026-10-19: a case refused for its unknown keys names them in its reason and `unknown_keys`; they were refused, not carried
    const k = isReplayBundle(b) && c.unknown_keys === undefined ? carriedKeys(b, { apChecked }) : []
    if (k.length) carried[c.name] = k
    const a = allowedKeys(b)
    if (a.length) allowed[c.name] = a
  })
  return {
    total: cases.length, matched: n('MATCH'), diverged: n('DIVERGED'), not_reperformed: n('NOT_REPERFORMED'), refused: n('REFUSED'), cases,
    ...(Object.keys(fields).length ? { fields_not_reperformed: fields } : {}),
    ...(opts.strict ? { strict_failed: cases.filter(c => (c.strict_problems?.length ?? 0) > 0).length } : {}),
    ...(Object.keys(carried).length ? { carried_not_checked: carried } : {}),
    ...(Object.keys(allowed).length ? { carried_allowed: allowed } : {}),
    ...(opts.allowUnknownKeys ? { allow_unknown_keys: 'stated' as const } : {}),
  }
}

/** The verdict a bundle presents (an envelope's body), or undefined. */
export function presentedOf(bundle: unknown): unknown {
  if (!isReplayBundle(bundle)) return undefined
  return isEnvelope(bundle.verdict) ? bundle.verdict.verdict : bundle.verdict
}

/**
 * The bundles in one file's text: a `.jsonl` (one per line, named `<file>#<line>`) or a `.json` (one bundle, or an array of
 * them, named `<file>` / `<file>[i]`). A line or file that is not JSON becomes a REFUSED case, never a throw.
 */
export function bundlesFromText(file: string, text: string): { name: string; bundle: unknown }[] {
  // 2026-10-05: each refusal says why, in one line: not JSON, a byte-order mark, a number past the double range.
  const bad = (name: string, why: string): { name: string; bundle: unknown } => ({ name, bundle: { __unparseable: why } })
  const parse = (name: string, t: string, first: boolean): { name: string; bundle: unknown } => {
    if (first && startsWithBom(t)) return bad(name, 'file starts with a UTF-8 byte-order mark; remove it (save the file as UTF-8 without BOM)')
    // 2026-10-06: nesting past the limit is refused before parsing, as parseJsonStrict refuses it (no reader overflows its stack)
    const deep = tooDeepOffset(t)
    if (deep >= 0) return bad(name, tooDeepRefusal(name, deep).message)
    let x: unknown
    try { x = JSON.parse(t) } catch (e) { return bad(name, `not JSON: ${(e as Error).message}`) }
    // 2026-10-05: a key repeated in one object is refused (JSON keeps the last; a reader that keeps the first sees another verdict)
    const dup = duplicateKeyPath(t)
    if (dup !== undefined) return bad(name, duplicateKeyRefusal(name, dup).message)
    const p = nonFinitePath(x)
    if (p !== undefined) return bad(name, nonFiniteRefusal(name, p).message)
    // 2026-10-05: a number whose text does not read back as written (9007199254740993) is refused, as parseJsonStrict refuses it
    const inexact = inexactNumberPath(t)
    if (inexact !== undefined) return bad(name, inexactNumberRefusal(name, inexact).message)
    return { name, bundle: x }
  }
  if (/\.jsonl$/i.test(file)) {
    const out: { name: string; bundle: unknown }[] = []
    text.split(/\r?\n/).forEach((line, i) => {
      if (!line.trim()) return
      out.push(parse(`${file}#${i + 1}`, line, i === 0))
    })
    return out
  }
  const one = parse(file, text, true)
  if (isObj(one.bundle) && typeof one.bundle.__unparseable === 'string') return [one]
  const x = one.bundle
  return Array.isArray(x) ? x.map((b, i) => ({ name: `${file}[${i}]`, bundle: b })) : [{ name: file, bundle: x }]
}

/**
 * What to type instead, for a case a folder replay refused because it is not a bundle (2026-10-05): a bare verdict or an
 * envelope (replay it on its own, with the flags it names), or an extraction (check it). Undefined for anything else.
 * `path` is how the caller can name the file; `flags` the inputs a bare verdict needs (cli.ts reads them off the verdict).
 */
export function notABundleHint(bundle: unknown, path: string, flags: (verdict: unknown) => string, bin = 'verify'): string | undefined {
  if (!isObj(bundle) || typeof bundle.__unparseable === 'string') return undefined
  const verdict = isEnvelope(bundle) ? bundle.verdict : bundle
  if (isObj(verdict) && typeof verdict.verdict_id === 'string' && typeof verdict.input_hash === 'string') {
    return `this is a verdict${isEnvelope(bundle) ? ' (a signed envelope)' : ''} without its inputs, not a bundle. Replay it on its own: ${bin} replay ${path} ${flags(verdict)}`
  }
  if (!('verdict' in bundle) && !('claims' in bundle)) return `this looks like an extraction, not a bundle: check it with ${bin} check ${path} --ruleset <name | file>, or give it to a verdict's replay with --extraction ${path}`
  return undefined
}

/**
 * One terminal line per case, plus its remedies indented beneath. `extra` (2026-10-05, the CLI's folder mode): the headline in
 * gate words (`PASS-WITH-OPEN: 3 of 13 checks could not run`, from the presented verdict), the fields that were not re-performed,
 * and the lines that say what to type instead. Without `extra` the line reads as before, apart from the remedies note.
 */
export function renderCaseReplay(c: CaseReplay, extra: { verdict?: unknown; notReperformed?: readonly string[]; hint?: string; carried?: readonly string[]; allowed?: readonly string[] } = {}): string {
  const v = extra.verdict
  const gateWords = c.result === 'MATCH' && isObj(v) && Array.isArray(v.claims) && typeof v.outcome === 'string'
    ? gateHeadline(v as unknown as Parameters<typeof gateHeadline>[0]) : undefined
  const answer = c.answer ? `  ${gateWords !== undefined ? (c.gate ? `${renderGate(c.gate)} · verdict ${gateWords}` : gateWords) : renderAnswer(c.answer, c)}` : ''
  const ruleNow = c.rule_now ? renderAnyRuleNow(c.rule_now, isObj(v) && typeof v.engine_version === 'string' ? v.engine_version : undefined).map(l => `\n    ${l}`).join('') : ''
  const head = `${c.result.padEnd(15)} ${c.name}${answer}${c.verdict_id ? `  verdict ${c.verdict_id.slice(0, 12)}…` : ''}${c.gate_now ? `\n    ${renderGateNow(c.gate_now)}` : ''}${ruleNow}`
  const why = c.result === 'DIVERGED' ? `\n    diverges at \`${c.first_difference ?? '?'}\`: ${c.reason ?? ''}` : c.result !== 'MATCH' ? `\n    ${c.reason ?? ''}` : ''
  // 2026-10-13: the keys the bundle carries outside the verdict and its inputs, right under the case's own lines
  const carried = `${extra.carried?.length ? `\n    ${carriedLine(extra.carried)}` : ''}${extra.allowed?.length ? `\n    ${allowedLine(extra.allowed)}` : ''}`
  const hint = extra.hint ? `\n    ${extra.hint}` : ''
  const fields = c.result === 'MATCH' && extra.notReperformed?.length ? `\n    not re-performed (not the engine's output): ${extra.notReperformed.join(', ')}` : ''
  const rem = renderRemedies(c.remedies).map(l => `\n    remedy: ${l}`).join('')
  // 2026-10-05: a verdict with its remedies deleted is never a silent MATCH; it says so in these words. From later that day it
  // MATCHes only under lenientRemedies; by default it DIVERGES at `remedies` with the reason replay.ts gives.
  const note = c.remedies_not_carried ? '\n    remedies absent; re-derived: the verdict carries no remedies (issued before engine 0.2.0 bound them, or removed since); these are this build\'s, and its core matched' : ''
  const strict = c.strict_problems?.length ? c.strict_problems.map(p => `\n    STRICT: ${p}`).join('') : ''
  const strictNote = c.strict_notes?.length ? c.strict_notes.map(p => `\n    strict note: ${p}`).join('') : ''
  // 2026-10-05: a matching verdict with no issued_at is named without --strict too (under --strict it is a STRICT line)
  const noIssued = c.result === 'MATCH' && isObj(v) && v.issued_at === undefined && !c.strict_problems ? `\n    ${ISSUED_AT_MISSING}` : ''
  return `${head}${why}${carried}${hint}${fields}${rem}${note}${noIssued}${strict}${strictNote}`
}

/**
 * The gate's decision in words (AP), as renderAnswer writes it. An approve the gate does not pay on (payable not true: a check
 * could not run; 2026-10-05) reads "A PERSON DECIDES", never APPROVE.
 */
export function renderGate(g: GateReading): string {
  if (g.decision === 'approve' && g.payable !== true) return 'A PERSON DECIDES (gate: approve held, a check could not run)'
  // 2026-10-05: the AP decision word is A PERSON DECIDES, as `verify ap` prints it; ABSTAIN is never printed
  return g.decision === 'abstain' ? 'A PERSON DECIDES (gate: a check could not decide)' : g.decision === 'approve' ? 'APPROVE (gate: the check pays)' : `HOLD (gate: ${g.decision})`
}

/** The most bundles one HTTP or MCP replay call takes (2026-10-03). */
export const REPLAY_REQUEST_LIMIT = 1000

/**
 * A replay request over HTTP (`POST /v1/replay`) or MCP (`replay_proof`), added 2026-10-03: `{ bundle }`, `{ bundles: [...] }`
 * (each a bundle, or `{ name, bundle }`), or a bare bundle `{ verdict, inputs, options? }`. The answer is the CLI's: the summary
 * and one rendered line per case (the gate's decision first for an AP proof). Throws on a request that names no bundle.
 * 2026-10-13: the HTTP route sets x-verify-exit from the summary (replayExit), as the command line's folder mode exits.
 * 2026-10-19: and its status from the exit (replayStatus): 409 when a case diverged, 422 when one was refused, else 200. The
 * same evening: a bundle with a key its format does not define is a refused case here (422); the route has no way to allow it.
 */
export function replayRequest(b: unknown): { summary: ReplaySummary; lines: string[] } {
  if (!isObj(b)) throw new TypeError('the body must be a JSON object: { "bundle" } or { "bundles": [...] } or a bundle { "verdict", "inputs" }')
  let items: { name: string; bundle: unknown }[]
  if (Array.isArray(b.bundles)) {
    items = b.bundles.map((x, i) => (isObj(x) && typeof x.name === 'string' && 'bundle' in x ? { name: x.name, bundle: x.bundle } : { name: `bundle[${i}]`, bundle: x }))
  } else if (b.bundle !== undefined) items = [{ name: 'bundle', bundle: b.bundle }]
  else if (isObj(b.verdict)) items = [{ name: 'bundle', bundle: b }]
  else throw new TypeError('name the proof to replay: { "bundle": { "verdict", "inputs" } } or { "bundles": [...] }')
  if (items.length === 0) throw new TypeError('"bundles" is empty')
  if (items.length > REPLAY_REQUEST_LIMIT) throw new TypeError(`at most ${REPLAY_REQUEST_LIMIT} bundles per call (got ${items.length})`)
  const summary = replayBundles(items)
  // 2026-10-05: the same disclosure the CLI prints, per case: the fields that were not re-performed; 2026-10-13: the keys carried
  return { summary, lines: summary.cases.map(c => renderCaseReplay(c, { notReperformed: summary.fields_not_reperformed?.[c.name] ?? [], carried: summary.carried_not_checked?.[c.name] ?? [], allowed: summary.carried_allowed?.[c.name] ?? [] })) }
}
