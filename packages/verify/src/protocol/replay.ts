/**
 * Independent replay check — the first half of the portable trust primitive.
 *
 * A verdict's id is `sha256(input_hash : ruleset.id@version : engine_version).slice(0,32)` — the same derivation every
 * producer uses. This module re-derives it, so any third party can confirm with nothing but sha256 + canonical JSON:
 *   (1) the verdict_id is bound to its input_hash + ruleset version + engine  → the id/ruleset/engine weren't altered;
 *   (2) (when the original inputs are supplied) the input_hash matches those exact inputs → the verdict is FOR this doc.
 *
 * THE OUTCOME IS NOT IN THE ID (red-team R1, 2026-09-28). The id commits to the inputs, not the result: a self-consistent
 * verdict with its outcome flipped PASS↔FAIL keeps the genuine id. So the binding alone never says the outcome is right.
 * When the inputs are supplied, verifyReplay RE-PERFORMS the check with this build's engine for the verdict's ruleset
 * (verify / the declarative evaluator / verifyAction / the AP match / the citation check / reconcile; the twins when the
 * document itself is supplied) and byte-compares the recomputed body with the presented one (everything except
 * `issued_at` and the annotations added after the engine: `channel`, `ledger`, `declared_accuracy`, `action_context`).
 * Any difference fails, naming the first differing field.
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
 * NOT A VERDICT → A REFUSAL, NEVER A THROW (2026-09-28, N7). Given anything that is not verdict-shaped (null, an array, a
 * number, an object without its binding fields), verifyReplay answers `{ ok: false, refused: true, reason }`: nothing
 * can be derived from it, so nothing verifies. A verifier's answer to garbage is "no, and why", not a crash in the caller.
 */

import { sha256, hashOf, canonicalize } from '../verdict/canonical.js'
import type { Verdict } from '../verdict/schema.js'
import { deriveVerdictId } from './verdict-id.js'
// The engines. verify() from its own module, never the package barrel (which re-exports this one): no cycle, and a bundle
// that reaches replay (verdict/channel.ts, verdict/voice.ts) does not pull the whole package in.
import { verify } from '../verify.js'
import { verifyDeclarative } from '../declarative/evaluate.js'
import { isDeclarativeRuleset, type DeclarativeRuleset } from '../declarative/types.js'
import { RULESETS, RULESET_VERSIONS } from '../rulesets/index.js'
import { verifyAction, type ProposedAction, type ActionSources } from '../action/index.js'
import { verifyInvoiceMatch, type ApDocuments, type ApPolicy } from '../ap/index.js'
import { verifyCitations, type Citation, type OpinionSources } from '../legal/index.js'
import { reconcile, type ReconciliationRuleset } from '../reconcile/index.js'
import { verifyAgainstTwin, type TwinClaim } from '../twin/judge.js'
import { FS_CORE_TWIN_MAP, FS_CORE_TWIN_MAP_V02, FS_CORE_TWIN_MAP_V021, type TwinConceptMap } from '../twin/map.js'
import { parseTwinPresentation, type TwinPresentationInput } from '../twin/presentation.js'
import { verifyEinvoiceTwin, type EinvoiceClaim } from '../twin-einvoice/judge.js'
import type { EinvoiceProfile } from '../twin-einvoice/map.js'
import { toleranceIdentity, type TolerancePolicy } from '../tolerance.js'
import { ENGINE_VERSION } from '../version.js'

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
  expected_input_hash?: string
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
}

export interface ReperformResult {
  /** The engine that re-performed it (e.g. `verify:invoice`, `declarative`, `action`, `ap`, `legal`, `reconcile`, `twin`, `twin-einvoice`). */
  engine: string
  identical: boolean
  /** The first field where the presented verdict differs from the re-performed one (a path: `outcome`, `claims[0].outcome`). */
  first_difference?: string
  /** Fields on the presented verdict that are not the engine's output and were NOT re-performed (the book's, a stamp, a measurement). */
  annotations?: string[]
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
}

/** Fields a verdict may carry that the engine did not produce (added after it: a stamp, the book, a measurement). */
const ANNOTATIONS = ['channel', 'ledger', 'declared_accuracy', 'action_context'] as const

const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x)

/** verify()'s or the declarative evaluator's inputs: the shapes whose input_hash commits to a tolerance override. */
const takesTolerance = (x: unknown): x is Record<string, unknown> =>
  isObj(x) && Object.prototype.hasOwnProperty.call(x, 'extraction') &&
  (Object.prototype.hasOwnProperty.call(x, 'references') || isDeclarativeRuleset(x.ruleset))

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
  return missing.length ? `not a verdict: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing or not a string, so no verdict_id can be derived` : undefined
}

/** The one canonical verdict_id derivation (./verdict-id.ts), re-exported here where every caller has found it. */
export { deriveVerdictId }

export const STRUCTURE_ONLY_NOTE = 'structure verified; outcome NOT re-performed'

export function verifyReplay(verdict: Verdict, inputs?: unknown, opts: ReplayOptions = {}): ReplayCheck {
  const problem = replayInputProblem(verdict)
  if (problem) return { ok: false, id_ok: false, expected_verdict_id: '', reason: problem, refused: true, outcome_verified: false, status: 'REFUSED' }
  const expected_verdict_id = deriveVerdictId(verdict.input_hash, verdict.ruleset, verdict.engine_version)
  const id_ok = expected_verdict_id === verdict.verdict_id
  const out: ReplayCheck = { ok: id_ok, id_ok, expected_verdict_id, outcome_verified: false, status: id_ok ? 'STRUCTURE_ONLY' : 'FAILED' }
  if (!id_ok) out.reason = `verdict_id does not derive from input_hash + ruleset@version + engine_version (expected ${expected_verdict_id})`
  if (inputs === undefined) {
    if (id_ok) out.not_reperformed = `${STRUCTURE_ONLY_NOTE}: no inputs were supplied, so the check was not run again (the verdict_id binds the inputs, not the outcome)`
    return out
  }
  const bound = boundInputs(inputs, opts)
  let expected_input_hash: string
  let legacy = false
  try {
    expected_input_hash = hashOf(bound)
    // A verdict issued before 2026-09-28 did not commit to its override: it still binds to the inputs without it.
    if (bound !== inputs && expected_input_hash !== verdict.input_hash && hashOf(inputs) === verdict.input_hash) {
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
  if (id_ok && !input_ok) out.reason = `input_hash does not match the supplied inputs (expected ${expected_input_hash}) — this verdict is not for these inputs${unstated ? '. If it was issued under a rounding-tolerance override, restate it: the input identity includes the override' : ''}`
  if (!out.ok) { out.status = 'FAILED'; return out }

  // The binding holds. Now the outcome: run the check again and compare what comes out.
  const r = reperform(verdict, bound, opts, legacy)
  if ('not' in r) {
    out.not_reperformed = `${STRUCTURE_ONLY_NOTE}: ${r.not}`
    return out
  }
  out.reperformed = r.result
  if (r.result.identical) {
    out.outcome_verified = true
    out.status = 'REPERFORMED'
  } else {
    out.ok = false
    out.status = 'FAILED'
    const override = (r.result.engine.startsWith('verify:') || r.result.engine === 'declarative') && !opts.tolerance
      ? '. If it was issued under a rounding-tolerance override, restate it (a verdict issued before 2026-09-28 does not commit to it in input_hash)' : ''
    out.reason = `the re-performed verdict differs from the presented one at \`${r.result.first_difference}\`: the check run again on these inputs does not give this verdict (${r.result.engine}, engine ${ENGINE_VERSION})${override}`
  }
  return out
}

// ── re-performance ────────────────────────────────────────────────────────────────────────────────────────────────

type Reperformed = { result: ReperformResult } | { not: string }

/** Pick the engine from the verdict's ruleset and the shape of its inputs, run it, and compare. Never throws. */
function reperform(presented: Verdict, inputs: unknown, opts: ReplayOptions, legacy = false): Reperformed {
  if (presented.engine_version !== ENGINE_VERSION) {
    return { not: `the verdict was issued by engine ${presented.engine_version}; this is engine ${ENGINE_VERSION}, and a check is re-performed only by the engine that made it` }
  }
  if (!isObj(inputs)) return { not: 'the inputs are not an object, so no engine takes them' }
  let x: Record<string, unknown>
  try { x = structuredClone(inputs) } catch { x = inputs } // the engines never see the caller's objects
  const producer = typeof presented.document?.producer === 'string' ? presented.document.producer : undefined
  const now = (): Date => { const d = new Date(presented.issued_at); return isNaN(d.getTime()) ? new Date(0) : d }
  const common = { now, ...(producer !== undefined ? { producer } : {}) }
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
    run = () => verifyAction(x.action as ProposedAction, x.sources as ActionSources, common)
  } else if (has('ap', 'policy')) {
    engine = 'ap'
    run = () => verifyInvoiceMatch(x.ap as ApDocuments, { ...common, policy: x.policy as ApPolicy }).verdict
  } else if (has('citations', 'sources') && rs.id === 'legal') {
    engine = 'legal'
    run = () => verifyCitations(x.citations as Citation[], x.sources as OpinionSources, common)
  } else if (has('documents', 'ruleset')) {
    engine = 'reconcile'
    run = () => reconcile(x.documents as Record<string, Record<string, unknown>>, x.ruleset as ReconciliationRuleset, { now })
  } else if (has('extraction', 'ruleset') && isDeclarativeRuleset(x.ruleset)) {
    engine = 'declarative'
    run = () => verifyDeclarative(x.extraction as Record<string, unknown>, x.ruleset as DeclarativeRuleset, { ...common, ...(tol ? { tolerance: tol } : {}) })
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
  const result = compareBodies(presented, again, engine)
  if (legacy) result.annotations = [...(result.annotations ?? []), 'input_hash', 'verdict_id']
  return { result }
}

/** Byte-compare the engine's output (issued_at and the post-engine annotations aside); name the first differing field. */
function compareBodies(presented: Verdict, again: Verdict, engine: string): ReperformResult {
  const strip = (v: Verdict): Record<string, unknown> => {
    const { issued_at: _t, ...rest } = v as unknown as Record<string, unknown>
    for (const k of ANNOTATIONS) delete rest[k]
    return rest
  }
  const a = strip(again)
  const p = strip(presented)
  const annotations = [
    ...ANNOTATIONS.filter(k => (presented as unknown as Record<string, unknown>)[k] !== undefined),
    ...(typeof presented.document?.producer === 'string' ? ['document.producer'] : []),
  ]
  const identical = canonicalize(a) === canonicalize(p)
  const first = identical ? undefined : firstDifference(a, p, '') ?? '(canonical bytes)'
  return { engine, identical, ...(first !== undefined ? { first_difference: first } : {}), ...(annotations.length ? { annotations } : {}) }
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
