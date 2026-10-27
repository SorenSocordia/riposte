/**
 * verify(extraction, options?) → Verdict
 *
 * Deterministic post-extraction verification. The caller brings ALREADY-EXTRACTED structured data (from Reducto /
 * Extend / LlamaExtract / their own LLM). We never extract. We check whether the numbers, as extracted, cohere —
 * and say so with evidence, under a named RULESET:
 *
 *   'invoice'  (default)  commercial invoice — footing, per-line math, contract / evidence / duplicate checks
 *   'pay-app'             construction pay application (AIA G702 / G703) — every footing law of the two forms,
 *                         plus continuity against the previous application when it is supplied as history
 *
 * Four honesty rules (see verdict/from-report.ts and below): could-not-compare is not FAIL; a missing reference is
 * not the extraction's fault; a verdict is NEVER issued on a field that was only guessed by fuzzy name-matching; and
 * a verdict is never issued against a reference that offers several candidates none of which matched this line.
 *
 * Determinism: no I/O, no randomness, no clock except `issued_at` (injectable). canonicalize → hash → bind → gavel → verdict.
 */

import { getOntologicalBridge, setBridgeLogger } from './binding/ontological-bridge.js'
import { getAxiomRegistry } from './kernel/axiom-registry.js'
import { getValidationGavel, setGavelLogger } from './kernel/validation-gavel.js'
import type { BindingContext, ComputationalAxiom, UniversalRole, ValidationResult } from './kernel/types.js'
import { resolveRuleset, INVOICE_RULESET } from './rulesets/index.js'
import type { Ruleset } from './rulesets/types.js'
import { verifyDeclarative, type ArchiveFile } from './declarative/evaluate.js'
import { isDeclarativeRuleset, type DeclarativeRuleset, type SuppliedChoice } from './declarative/types.js'
import { hashOf, sha256 } from './verdict/canonical.js'
import { attachRemedies, type RemedyContext, type RemedyTable } from './verdict/remedy.js'
import { attachScope } from './verdict/scope.js'
import { assertExtraction, InputRefused } from './protocol/input.js'
import { verifyInputHash } from './protocol/inputs.js'
import { verdictIdentity } from './protocol/verdict-id.js'
import { nonFinitePath, nonFiniteRefusal, unsafeMagnitudePath, unsafeMagnitudeRefusal, valueAtPath } from './protocol/hash-input.js'
import { applyTolerancePolicy, toleranceProblem, type TolerancePolicy } from './tolerance.js'
import { prepareSource, verifyQuote, verifyValueInText, type QuoteAssertion, type ValueAssertion } from './textmatch/index.js'
import {
  abstainOnGuessedOperands,
  evidenceKey,
  toClaimVerdicts,
  type ReferenceFlags,
} from './verdict/from-report.js'
import type { ClaimVerdict, Coverage, Evidence, Outcome, Verdict } from './verdict/schema.js'
import { SCHEMA_VERSION, engineFor, engineAtLeast } from './version.js'
import { cantTellInWords } from './verdict/cant-tell.js'

export type Json = Record<string, unknown>

export interface VerifyOptions {
  /** Which ruleset to evaluate under: a built-in id, a built-in Ruleset object, or a DECLARATIVE (JSON) ruleset. Default 'invoice'. */
  ruleset?: 'invoice' | 'pay-app' | Ruleset | DeclarativeRuleset
  /** Optional reference documents. Cross-document checks run only when present. */
  references?: {
    contract?: Json
    evidence?: Json[]
    /** Prior documents of the same kind (the previous pay application; prior invoices). */
    history?: Json[]
  }
  /**
   * The source document's own text (digital-born; scanned/handwritten OCR belongs upstream and will mostly abstain).
   * Enables the source-text axis: does each quoted passage appear VERBATIM, does each extracted value appear at all.
   * `quotes` and `values` are what the caller asks us to confirm against the text.
   */
  source?: {
    text: string
    quotes?: QuoteAssertion[]
    values?: ValueAssertion[]
  }
  /** Who produced the extraction (recorded, never trusted). */
  producer?: string
  /** Rounding-tolerance override: a relative band (0.0005 = 0.05%) over each rule's absolute floor. Default: the ruleset's policy. */
  tolerance?: TolerancePolicy
  /** Injectable clock — the ONLY source of non-determinism, and it touches only `issued_at`. */
  now?: () => Date
  /**
   * The engine version to re-perform under (2026-10-03, version.ts engineFor): this build's when absent, or an earlier one it
   * retains ('0.0.1'). For replay: a verdict is re-performed under the engine it names, and the verdict made names that engine.
   */
  engine?: string
  /**
   * Engine 0.5.0 (2026-10-04), declarative rulesets only: values the judge supplies for the ruleset's choice slots
   * (slot id → { value, source }), and archive files as bytes (base64) for archive provenance whose file is not text. Both are part
   * of the input the verdict is bound to. A built-in ruleset declares no choice slots and reads neither.
   */
  supplied_choices?: Record<string, SuppliedChoice>
  archive_files?: ArchiveFile[]
}

const initialized = new Set<string>()
function init(rs: Ruleset): void {
  if (initialized.has(rs.id)) return
  getOntologicalBridge().registerOntology(rs.ontology)
  const registry = getAxiomRegistry()
  for (const a of rs.axioms) registry.register(a)
  setGavelLogger(undefined)
  setBridgeLogger(undefined)
  initialized.add(rs.id)
}

const isObj = (x: unknown): x is Json => x !== null && typeof x === 'object' && !Array.isArray(x)

export function verify(extraction: Json, options: VerifyOptions = {}): Verdict {
  // Refuse what no verdict can be bound to (null, undefined, a function/symbol/bigint) rather than crash or collide.
  assertExtraction(extraction)
  // The hash contract at the library's own door (2026-10-05): what the CLI refuses when it reads a file is refused
  // here too, so a library, HTTP or MCP caller cannot issue two verdicts under one id (assertHashableInputs, below).
  assertHashableInputs(extraction, options)
  const engine_version = engineFor(options.engine)
  // A declarative (JSON) ruleset takes a separate, enum-free evaluation path — same proof object out.
  if (isDeclarativeRuleset(options.ruleset)) {
    return verifyDeclarative(extraction, options.ruleset, {
      ...(options.now ? { now: options.now } : {}),
      ...(options.producer !== undefined ? { producer: options.producer } : {}),
      ...(options.tolerance ? { tolerance: options.tolerance } : {}),
      // 2026-10-03: the source-text axis runs for a declarative ruleset too (its `quotes`, and the caller's quotes/values).
      ...(options.source !== undefined ? { source: options.source } : {}),
      // Engine 0.5.0: the judge's choice values and archive bytes, when given
      ...(options.supplied_choices !== undefined ? { supplied_choices: options.supplied_choices } : {}),
      ...(options.archive_files !== undefined ? { archive_files: options.archive_files } : {}),
      engine: engine_version,
    })
  }
  const rs = resolveRuleset(options.ruleset as 'invoice' | 'pay-app' | Ruleset | undefined)
  init(rs)
  const bridge = getOntologicalBridge()
  const registry = getAxiomRegistry()
  const gavel = getValidationGavel()

  // References are the caller's; only real objects count. A null/junk reference is "not provided", never a crash.
  const contractGiven = isObj(options.references?.contract)
  const contract: Json = contractGiven ? (options.references?.contract as Json) : {}
  const rawEvidence = options.references?.evidence
  const evidence: Json[] = (Array.isArray(rawEvidence) ? rawEvidence : []).filter(isObj)
  const rawHistory = options.references?.history
  const history: Json[] = (Array.isArray(rawHistory) ? rawHistory : []).filter(isObj)
  const refs: ReferenceFlags = { contract: contractGiven, evidence: evidence.length > 0, history: history.length > 0 }

  // Source text axis (optional): does each quoted passage appear verbatim, does each extracted value appear at all.
  const sourceGiven = typeof options.source?.text === 'string' && options.source.text.length > 0

  // Hash what the caller actually sent (junk included) — two different inputs must never share a hash.
  // A tolerance override can change the outcome, so the input it is bound to includes it; absent, the ruleset's own policy
  // is named by its version (D-TOL-ID). One builder (protocol/inputs.ts, 2026-10-03) makes this hash and a replay bundle's inputs.
  const input_hash = verifyInputHash(extraction, options)
  const extraction_hash = hashOf(extraction)

  const axiomsFor = (codes: readonly string[]): ComputationalAxiom[] =>
    codes.map(c => registry.getByCode(c)).filter((a): a is ComputationalAxiom => a !== undefined)
  const lineAxioms = axiomsFor(rs.lineCodes)
  const docAxioms = axiomsFor(rs.documentCodes)

  // ------------------------------------------------------------------ bind
  const lineKeys = rs.ontology.lineArrayKeys ?? ['line_items']
  const lineKey = lineKeys.find(k => Array.isArray(extraction[k]))
  const lineCount = lineKey !== undefined ? (extraction[lineKey] as unknown[]).length : 0
  const lineCtxs: BindingContext[] = lineCount > 0 ? bridge.createLineItemBindings(rs.domain, extraction, contract, evidence) : []
  const docCtx = bridge.createBindings(rs.domain, extraction, contract, evidence, undefined)

  // Computed roles (with provenance) and the reasons for anything that could not be computed.
  const { docAbsence, lineAbsence, attach, claims: rulesetClaims } = rs.compute({
    extraction, references: { contract: contractGiven ? contract : null, evidence, history }, docCtx, lineCtxs,
    // Engine 0.6.0 (2026-10-05): the built-in rulesets read strictly from 0.6.0 (rulesets/strict.ts)
    engine: engine_version,
  })

  // ------------------------------------------------------------------ judge
  const common = { registry, refs, kindByCode: rs.kindByCode, fieldByCode: rs.fieldByCode, referenceRoles: rs.referenceRoles }
  const claims: ClaimVerdict[] = []

  const docResults: ValidationResult[] = docAxioms.map(a => gavel.validateAxiom(a, docCtx))
  claims.push(...toClaimVerdicts(docResults, docCtx, { ...common, claimPrefix: 'document', absence: docAbsence }))

  lineCtxs.forEach((ctx, i) => {
    const results: ValidationResult[] = lineAxioms.map(a => gavel.validateAxiom(a, ctx))
    claims.push(...toClaimVerdicts(results, ctx, { ...common, claimPrefix: `line[${i}]`, absence: lineAbsence[i] ?? {} }))
  })

  // Ruleset-produced claims that are not gavel predicates (e.g. exact + near duplicate detection).
  if (rulesetClaims) claims.push(...rulesetClaims)

  // The operands behind computed roles belong on the receipt too, each with its own provenance.
  // Indexed once: a find() per attachment was O(claims × attachments), ~11% of a 300-line verify (a perf finding, 2026-09-28).
  const claimById = indexClaims(claims)
  for (const [claimId, extra] of Object.entries(attach)) attachEvidence(claimById.get(claimId), extra)

  // Rounding-tolerance policy — a penny (or a sub-0.05% rounding drift) is not an error. Runs before the honesty passes so
  // a within-tolerance PASS that rests on a guessed operand still abstains below.
  const policy: TolerancePolicy = options.tolerance ?? rs.defaultTolerance ?? { rel: 0, absCap: 0 }
  applyTolerancePolicy(claims, policy)

  // Honesty rule 3 — after every operand is on the receipt: no verdict on a guessed field.
  abstainOnGuessedOperands(claims)
  // Honesty rule 4 — no verdict against a reference that offers several candidates none of which matched this line.
  abstainOnAmbiguousReference(rs, claims, lineCtxs, contract, contractGiven)
  // A ruleset may reword a still-FAILed claim in its own words (pay-app, engine 0.6.0); never an outcome, a value or an id.
  rs.finish?.(claims, { engine: engine_version })
  // Engine 0.6.0: a check that could not run never reads "… VIOLATED"; it says can't tell, in words (verdict/cant-tell.ts)
  if (engineAtLeast(engine_version, '0.6.0')) cantTellInWords(claims)

  // Source-text axis — independent of the numeric gavel; span evidence at confidence 100 (verbatim or nothing).
  if (sourceGiven) {
    const text = options.source!.text
    const prepared = prepareSource(text)
    const sourceHash = sha256(text)
    const idOf = (raw: string): string => (raw.startsWith('source.') ? raw : `source.${raw}`)
    for (const q of options.source!.quotes ?? []) claims.push(verifyQuote({ ...q, id: idOf(q.id) }, prepared, sourceHash))
    for (const v of options.source!.values ?? []) claims.push(verifyValueInText({ ...v, id: idOf(v.id) }, prepared, sourceHash))
  }

  // ------------------------------------------------------------------ aggregate
  const coverage = coverageOf(claims)
  const outcome: Outcome =
    coverage.claims_fail > 0 ? 'FAIL'
    : coverage.claims_checked === 0 ? 'INSUFFICIENT_DATA'
    : 'PASS'

  // Engine 0.2.0: the id also binds the ruleset's remedy table (protocol/verdict-id.ts verdictIdentity).
  // 2026-10-05: a ruleset may answer each engine from its own table (Ruleset.remedyByCodeFor); the id binds the one used.
  const remedyTable = rs.remedyByCodeFor?.(engine_version) ?? rs.remedyByCode ?? {}
  const { verdict_id, remedy_table_hash } = verdictIdentity(input_hash, rs, engine_version, remedyTable)
  const issued_at = (options.now ?? (() => new Date()))().toISOString()

  const verdict: Verdict = {
    schema_version: SCHEMA_VERSION,
    verdict_id,
    issued_at,
    engine_version,
    ruleset: { id: rs.id, version: rs.version, domain: rs.domain },
    input_hash,
    ...(remedy_table_hash !== undefined ? { remedy_table_hash } : {}),
    replayable: true,
    document: {
      extraction_hash,
      ...(options.producer !== undefined ? { producer: options.producer } : {}),
      line_items: lineCount,
    },
    references: { contract: refs.contract, evidence: evidence.length, history: history.length, source: sourceGiven },
    outcome,
    aggregation: 'ANY_FAIL_FAILS',
    claims,
    coverage,
  }
  // Typed remedies for every non-PASS claim (verdict/remedy.ts), declared by the ruleset next to its laws. Outside the
  // hashed core: verdict_id above derives exactly as before.
  return attachScope(attachRemedies(verdict, remedyContextFor(rs, remedyTable)))
}

/**
 * Refuse, before anything is hashed, an input verify() could not bind faithfully (2026-10-05; a cold
 * reader's Collisions A and B in cold review round 2, both reached through the library and HTTP, never through the CLI):
 *   - a tolerance override whose shape the engine and its identity would read differently (tolerance.ts toleranceProblem: a
 *     string `roundingCap.perLine` hashed like the array of its characters, and one verdict_id named a PASS and a FAIL);
 *   - a non-finite number (Infinity, -Infinity, NaN) anywhere in what input_hash covers: the extraction, the references, the
 *     source, the tolerance, the judge's choice values and the archive files. canonicalize writes each as null, so `total: null`
 *     (PASS) and `total: Infinity` (FAIL) shared one input_hash and one verdict_id. JSON cannot carry these values (the CLI,
 *     HTTP and MCP readers refuse `1e999`), so only an in-memory caller ever passed one.
 * Both throw InputRefused (the CLI's exit 3, HTTP's 400). Every engine version: no verdict that a replay can confirm was ever
 * issued on such an input, because the hash could not tell it from its null twin. Every input accepted before is unchanged.
 */
export function assertHashableInputs(extraction: unknown, options: VerifyOptions = {}): void {
  if (options.tolerance !== undefined) {
    const problem = toleranceProblem(options.tolerance)
    if (problem) throw new InputRefused('tolerance', `verify: ${problem}`)
  }
  const parts: [string, string, unknown][] = [
    ['extraction', 'the extraction', extraction],
    ['references', 'references.contract', options.references?.contract],
    ['references', 'references.evidence', options.references?.evidence],
    ['references', 'references.history', options.references?.history],
    ['source', 'source', options.source],
    ['tolerance', 'tolerance', options.tolerance],
    ['supplied_choices', 'supplied_choices', options.supplied_choices],
    ['archive_files', 'archive_files', options.archive_files],
  ]
  for (const [input, name, value] of parts) {
    if (value === undefined) continue
    const at = nonFinitePath(value)
    if (at !== undefined) throw new InputRefused(input, `verify: ${nonFiniteRefusal(name, at).message}`)
  }
  // Engine 0.6.0 (2026-10-05): a number past 2^53 − 1 in magnitude may already have been rounded when it was
  // parsed (9007199254740993 reads as 9007199254740992), and the library has no text to compare it with, so it is refused. The
  // text readers (CLI, HTTP, MCP) also refuse any number token that does not read back as written (hash-input.ts
  // parseJsonStrict). Under an earlier engine the input is read as it always was, so an earlier verdict re-performs byte for byte.
  let engine: ReturnType<typeof engineFor> | undefined
  try { engine = engineFor(options.engine) } catch { engine = undefined } // an unknown engine is refused by verify() itself
  if (engine !== undefined && engineAtLeast(engine, '0.6.0')) {
    for (const [input, name, value] of parts) {
      if (value === undefined) continue
      const at = unsafeMagnitudePath(value)
      if (at !== undefined) throw new InputRefused(input, `verify: ${unsafeMagnitudeRefusal(name, at, valueAtPath(value, at)).message}`)
    }
  }
}

/** How a built-in ruleset's claims are answered: its declared table, where each role comes from, which roles it computes. */
function remedyContextFor(rs: Ruleset, table: RemedyTable): RemedyContext {
  const sources: [string, readonly string[]][] = [['contract', rs.referenceRoles.contract], ['evidence', rs.referenceRoles.evidence], ['history', rs.referenceRoles.history]]
  return {
    declared: (rule) => table[rule],
    sourceOfRole: (role) => sources.find(([, roles]) => roles.includes(role))?.[0],
    isComputed: (role) => (rs.computedRoles as readonly string[]).includes(role),
    document: rs.id,
  }
}

export interface BatchItem { extraction: Json; options?: Omit<VerifyOptions, 'now'> }
export interface BatchResult { count: number; summary: Record<Outcome, number>; results: Verdict[] }

/** Verify many documents in one call — the real-world "run a whole book of invoices" path. Deterministic; the summary is the triage. */
export function verifyBatch(items: BatchItem[], shared: { now?: () => Date } = {}): BatchResult {
  const summary: Record<Outcome, number> = { PASS: 0, FAIL: 0, INSUFFICIENT_DATA: 0 }
  const results: Verdict[] = []
  for (const it of items) {
    const v = verify(it.extraction, { ...(it.options ?? {}), ...(shared.now ? { now: shared.now } : {}) })
    summary[v.outcome]++
    results.push(v)
  }
  return { count: items.length, summary, results }
}

/** Everything in a verdict that must be byte-identical across replays of the same input (drops `issued_at`). */
export function replayView(v: Verdict): Omit<Verdict, 'issued_at'> {
  const { issued_at: _drop, ...rest } = v
  return rest
}

// ---------------------------------------------------------------------------------------------
// honesty rule 4 — ambiguous references
// ---------------------------------------------------------------------------------------------

/**
 * How many candidate values a contract offers for a role, judging by the ontology's array-rooted paths
 * (e.g. `rates[*].rate`, `financial_rules[*].values.rate`, `price_list[*].unit_price`). Exact-path binding would
 * silently take the FIRST — which is a hallucinated verdict waiting to happen when there are several.
 */
export function referenceMultiplicity(contract: Json, role: UniversalRole, ruleset: Ruleset = INVOICE_RULESET): number {
  const roots = new Set<string>()
  for (const m of ruleset.ontology.mappings) {
    if (m.role !== role || m.documentType !== 'contract') continue
    for (const p of [m.fieldPath, ...(m.alternativePaths ?? [])]) {
      const i = p.indexOf('[*]')
      if (i > 0) roots.add(p.slice(0, i))
    }
  }
  let max = 0
  for (const root of roots) {
    if (root.includes('.')) continue // v0: top-level array roots only
    const v = contract[root]
    if (Array.isArray(v)) max = Math.max(max, v.filter(x => x !== null && x !== undefined).length)
  }
  return max
}

function abstainOnAmbiguousReference(rs: Ruleset, claims: ClaimVerdict[], lineCtxs: BindingContext[], contract: Json, contractGiven: boolean): void {
  if (!contractGiven) return
  const claimById = indexClaims(claims)
  for (const [code, role] of rs.ambiguityGuards) {
    const n = referenceMultiplicity(contract, role, rs)
    if (n <= 1) continue
    lineCtxs.forEach((ctx, i) => {
      // The bridge only marks contract correlation reliable when a rule was matched to THIS line (keyword/category
      // match ≥ 70 against financial_rules). Anything else means "we don't know which candidate applies".
      if (ctx.correlationInfo?.contract?.isReliable === true) return
      const c = claimById.get(`line[${i}].${code}`)
      if (!c || c.outcome === 'INSUFFICIENT_DATA') return
      c.outcome = 'INSUFFICIENT_DATA'
      c.locked = false
      delete c.computation
      delete c.variance
      c.insufficiency = {
        reason: 'AMBIGUOUS_REFERENCE',
        detail: `the contract lists ${n} candidate values for ${role} and no rule could be matched to this line; supply financial_rules[] with a rule_name/description matching the line description, or a single-valued reference`,
        missing: [role],
      }
      c.explanation = `Abstained: ${c.explanation}`
    })
  }
}

// ---------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------

/** Claims by id, the first occurrence winning (exactly what `claims.find` returned). */
function indexClaims(claims: ClaimVerdict[]): Map<string, ClaimVerdict> {
  const byId = new Map<string, ClaimVerdict>()
  for (const c of claims) if (!byId.has(c.claim_id)) byId.set(c.claim_id, c)
  return byId
}

function attachEvidence(claim: ClaimVerdict | undefined, extra: Evidence[]): void {
  if (!claim) return
  const seen = new Set(claim.evidence.map(evidenceKey))
  for (const e of extra) {
    const k = evidenceKey(e)
    if (seen.has(k)) continue
    seen.add(k)
    claim.evidence.push(e)
  }
}

function coverageOf(claims: ClaimVerdict[]): Coverage {
  let pass = 0, fail = 0, insufficient = 0
  for (const c of claims) {
    if (c.outcome === 'PASS') pass++
    else if (c.outcome === 'FAIL') fail++
    else insufficient++
  }
  return {
    claims_total: claims.length,
    claims_checked: pass + fail,
    claims_pass: pass,
    claims_fail: fail,
    claims_insufficient: insufficient,
  }
}
