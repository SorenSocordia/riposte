/**
 * Cross-document reconciliation — the deterministic "N-way match" generalized across document types, and a gap the
 * e-invoicing mandates leave open: no government system, clearance or post-audit, reconciles an
 * invoice against the PO / goods-receipt / contract / payment it claims to agree with. This layer does exactly that.
 *
 * A reconciliation ruleset declares COHERENCE CONTRACTS between several named documents — fields drawn from specific
 * documents, and checks (expressions) that must hold ACROSS them (e.g. invoice.payable = po.approved_amount;
 * sum-of-receipt = invoice.lines; payment.amount = invoice.payable). The output is the SAME Verdict proof object as the
 * single-document verifier — per-claim PASS / FAIL / INSUFFICIENT_DATA, per-operand provenance (which document each
 * value came from), a deterministic verdict_id (replay-verifiable via ../protocol), byte-identical replay. Honesty rules
 * hold: a missing document abstains (REFERENCE_NOT_PROVIDED), a missing field abstains (FIELD_MISSING), never a guess.
 *
 * v1 scope: document-level scalar coherence (the 3-way-match core). Per-line reconciliation (sum(receipt.lines)) is a
 * near follow-on on the same spine.
 */

import { evalExpr, referencedRoles, type Env } from '../declarative/expr.js'
import { normalizeAmount } from '../binding/forensic-normalizer.js'
import { hashOf } from '../verdict/canonical.js'
import { attachRemedies } from '../verdict/remedy.js'
import { attachScope } from '../verdict/scope.js'
import { SCHEMA_VERSION, engineAtLeast, engineFor } from '../version.js'
import { formatOfTexts, nearMissPath, strictNumberText, textValues } from '../rulesets/strict.js'
import { verdictIdentity } from '../protocol/verdict-id.js'
import type { Verdict, ClaimVerdict, Evidence, Outcome, Coverage, Insufficiency, InsufficiencyReason } from '../verdict/schema.js'

export type Json = Record<string, unknown>

export interface ReconField {
  /** Which document role this field is drawn from — must be a key in the reconciled `documents` map. */
  doc: string
  /** Candidate paths within that document, most-preferred first (dot notation + [n] indices). */
  paths: string[]
  /** Value to use when the field (or its whole document) is absent — e.g. an optional allowance = 0. */
  default?: number
}

export interface ReconCheck {
  code: string
  name?: string
  /** Left expression over field roles (roles, numbers, + - * /, parens, abs()). */
  left: string
  op: '=' | '<=' | '>=' | '!='
  /** Right expression (the expected/reference side). */
  right: string
  /** Absolute tolerance floor for this check. Default 0.01. */
  tol?: number
  /** The caller-vocabulary thing this check is about (for the verdict). */
  field?: string
}

export interface ReconciliationRuleset {
  id: string
  version: string
  domain?: string
  name?: string
  /** The document roles this reconciliation expects, e.g. ["invoice","po","receipt","payment"]. */
  documents: string[]
  /** roleName → which document + where in it. */
  fields: Record<string, ReconField>
  checks: ReconCheck[]
  /** Rounding-tolerance policy. Default { rel: 0.0003, absCap: 0 }. */
  tolerance?: { rel: number; absCap: number }
}

export interface ReconcileOptions {
  now?: () => Date
  /** The engine version to re-perform under (2026-10-03, version.ts engineFor): this build's when absent, or an earlier one it retains. For replay. */
  engine?: string
}

function getPath(obj: unknown, path: string): unknown {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)
  let cur: unknown = obj
  for (const p of parts) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[p]
  }
  return cur
}

interface Bound { status: 'ok' | 'doc_missing' | 'field_missing' | 'unparseable'; value?: number; doc: string; path?: string; original?: unknown; norms?: string[]; why?: string }

/**
 * `strict` (engine 0.6.0, 2026-10-05): a text amount must read as exactly one number
 * in its document's number format (rulesets/strict.ts: the document's `number_locale`, else what its own text values settle),
 * else it is unparseable and never falls back to the field's default; a field reported under a near-miss key (spaces or invisible
 * characters) is unparseable, naming the key, never absent. Below 0.6.0 the lenient normalizer reads as before.
 */
function bindField(documents: Record<string, Json>, spec: ReconField, strict = false): Bound {
  const source = documents[spec.doc]
  if (source === undefined) {
    if (spec.default !== undefined) return { status: 'ok', value: spec.default, doc: spec.doc, path: `default(${spec.default})` }
    return { status: 'doc_missing', doc: spec.doc }
  }
  let resolvedButBad = false
  let why: string | undefined
  for (const p of spec.paths) {
    const raw = getPath(source, p)
    if (raw === undefined || raw === null || raw === '') continue
    const norm = normalizeAmount(raw)
    if (strict && typeof raw === 'string' && raw.trim() !== '') {
      const format = formatOfTexts(textValues(source), source.number_locale)
      const s = strictNumberText(raw, 'amount', format)
      if (!s.ok) { resolvedButBad = true; why ??= `${p} is ${JSON.stringify(raw)}, which does not read as one number (${s.why}): not read, never guessed`; continue }
      const value = s.value === null ? null : Math.round(s.value * 100) / 100
      if (value !== null && !(norm && norm.success !== false && norm.normalized === value)) return { status: 'ok', value, doc: spec.doc, path: p, original: raw, norms: [`strict_reading_${format.tag ?? 'plain'}`] }
    }
    if (norm && norm.success !== false) return { status: 'ok', value: norm.normalized, doc: spec.doc, path: p, original: raw, norms: norm.transformations }
    resolvedButBad = true
  }
  if (strict && !resolvedButBad) {
    for (const p of spec.paths) {
      const k = nearMissPath(source, p)
      if (k !== undefined) { resolvedButBad = true; why = `${p} was reported under the key path ${JSON.stringify(k)}, which differs from it only by spaces or invisible characters: not read`; break }
    }
  }
  if (strict && resolvedButBad) return { status: 'unparseable', doc: spec.doc, ...(why !== undefined ? { why } : {}) }
  if (spec.default !== undefined) return { status: 'ok', value: spec.default, doc: spec.doc, path: `default(${spec.default})` }
  return { status: resolvedButBad ? 'unparseable' : 'field_missing', doc: spec.doc }
}

const OP_LABEL: Record<ReconCheck['op'], string> = { '=': '=', '<=': '≤', '>=': '≥', '!=': '≠' }

export function reconcile(documents: Record<string, Json>, ruleset: ReconciliationRuleset, options: ReconcileOptions = {}): Verdict {
  const policy = ruleset.tolerance ?? { rel: 0.0003, absCap: 0 }
  const claims: ClaimVerdict[] = []
  const strict = engineAtLeast(engineFor(options.engine), '0.6.0') // engine 0.6.0: bindField reads strictly

  for (const chk of ruleset.checks) {
    const roles = [...new Set([...referencedRoles(chk.left), ...referencedRoles(chk.right)])].filter(r => r in ruleset.fields)
    const bounds = new Map(roles.map(r => [r, bindField(documents, ruleset.fields[r]!, strict)]))
    const base = { claim_id: `recon.${chk.code}`, kind: 'CROSS_REFERENCE' as const, tier: 'DETERMINISTIC' as const, field: chk.field ?? chk.code.toLowerCase(), rule_id: chk.code, rule_name: chk.name ?? chk.code }

    // Insufficiency: a whole document absent = REFERENCE_NOT_PROVIDED; a field absent in a provided doc = FIELD_MISSING; unparseable = UNPARSEABLE.
    const insuff = ((): Insufficiency | null => {
      for (const r of roles) {
        const b = bounds.get(r)!
        if (b.status === 'doc_missing') return { reason: 'REFERENCE_NOT_PROVIDED', detail: `document "${b.doc}" (needed for ${r}) was not supplied`, missing: [r] }
      }
      for (const r of roles) {
        const b = bounds.get(r)!
        if (b.status === 'unparseable') return { reason: 'UNPARSEABLE', detail: `${r} in "${b.doc}" is present but not a number${b.why !== undefined ? `: ${b.why}` : ''}`, missing: [r] }
        if (b.status === 'field_missing') return { reason: 'FIELD_MISSING', detail: `${r} not found in document "${b.doc}"`, missing: [r] }
      }
      return null
    })()
    if (insuff) { claims.push({ ...base, outcome: 'INSUFFICIENT_DATA', asserted: null, evidence: [], insufficiency: insuff, locked: false, explanation: `${chk.code}: ${insuff.detail}` }); continue }

    const vars: Record<string, number | undefined> = {}
    for (const r of roles) vars[r] = bounds.get(r)!.value
    const env: Env = { vars, sum: () => undefined }
    let left: number | undefined, right: number | undefined
    try { left = evalExpr(chk.left, env); right = evalExpr(chk.right, env) }
    catch (e) { claims.push({ ...base, outcome: 'INSUFFICIENT_DATA', asserted: null, evidence: [], insufficiency: { reason: 'OUT_OF_RULESET_SCOPE', detail: `expression error: ${(e as Error).message}` }, locked: false, explanation: `${chk.code}: bad expression` }); continue }
    if (left === undefined || right === undefined) { claims.push({ ...base, outcome: 'INSUFFICIENT_DATA', asserted: null, evidence: [], insufficiency: { reason: 'FIELD_MISSING', detail: `a value needed by ${chk.code} was absent`, missing: roles }, locked: false, explanation: `${chk.code}: operand absent` }); continue }

    const tolAbs = Math.max(chk.tol ?? 0.01, policy.absCap, policy.rel * Math.max(Math.abs(left), Math.abs(right)))
    const diff = left - right
    const pass = chk.op === '=' ? Math.abs(diff) <= tolAbs
      : chk.op === '!=' ? Math.abs(diff) > tolAbs
      : chk.op === '<=' ? left <= right + tolAbs
      : left >= right - tolAbs
    const evidence: Evidence[] = roles.map(r => {
      const b = bounds.get(r)!
      const computed = (b.path ?? '').startsWith('default(')
      const e: Evidence = { locator: { kind: 'field', source: computed ? 'computed' : 'evidence', path: `${b.doc}.${b.path ?? ''}` }, value: b.value ?? null, confidence: computed ? 100 : 100, role: 'OPERAND' }
      if (b.original !== undefined && String(b.original) !== String(b.value)) e.original = b.original as Evidence['original']
      if (b.norms && b.norms.length) e.normalizations = b.norms
      return e
    })
    claims.push({
      ...base,
      outcome: pass ? 'PASS' : 'FAIL',
      asserted: left,
      computation: { formula: `${chk.left} ${OP_LABEL[chk.op]} ${chk.right}`, operands: Object.fromEntries(roles.map(r => [r, vars[r] ?? null])), result: right, tolerance: { abs: tolAbs } },
      evidence,
      ...(pass ? {} : { variance: Number(diff.toFixed(4)) }),
      locked: pass,
      explanation: pass ? `${chk.code}: coheres (${left} ${OP_LABEL[chk.op]} ${right})` : `${chk.code}: cross-document mismatch — ${chk.left} = ${left} but expected ${right} (Δ ${Number(diff.toFixed(4))})`,
    })
  }

  const outcome: Outcome = claims.some(c => c.outcome === 'FAIL') ? 'FAIL' : claims.some(c => c.outcome === 'PASS') ? 'PASS' : 'INSUFFICIENT_DATA'
  const coverage: Coverage = {
    claims_total: claims.length,
    claims_checked: claims.filter(c => c.outcome === 'PASS' || c.outcome === 'FAIL').length,
    claims_pass: claims.filter(c => c.outcome === 'PASS').length,
    claims_fail: claims.filter(c => c.outcome === 'FAIL').length,
    claims_insufficient: claims.filter(c => c.outcome === 'INSUFFICIENT_DATA').length,
  }
  const input_hash = hashOf({ documents, ruleset })
  const engine_version = engineFor(options.engine)
  // Engine 0.2.0: the id also binds the remedy table; a reconciliation ruleset declares none, so it is the empty table.
  const { verdict_id, remedy_table_hash } = verdictIdentity(input_hash, ruleset, engine_version, {})
  const issued_at = (options.now ?? (() => new Date()))().toISOString()

  const verdict: Verdict = {
    schema_version: SCHEMA_VERSION, verdict_id, issued_at, engine_version,
    ruleset: { id: ruleset.id, version: ruleset.version, domain: ruleset.domain ?? ruleset.id },
    input_hash, ...(remedy_table_hash !== undefined ? { remedy_table_hash } : {}), replayable: true,
    document: { extraction_hash: hashOf(documents), line_items: 0 },
    references: { contract: false, evidence: Object.keys(documents).length, history: 0, source: false },
    outcome, aggregation: 'ANY_FAIL_FAILS', claims, coverage,
  }
  // Typed remedies (verdict/remedy.ts): a reconciliation ruleset declares none, so each can't-tell names what its
  // insufficiency implies and a FAIL says `none` (the finding stands). Outside the hashed core.
  return attachScope(attachRemedies(verdict, { document: 'documents' }))
}
