/**
 * Stand-in agents for the closed loop (2026-10-03, T3). DETERMINISTIC, NO MODEL: each applies a remedy mechanically, so a run
 * measures the loop and the gate, not a model. A model-backed corrector is a separate run, with its resolved model id per
 * round from the provider's own per-message record.
 *
 *   apStandIn             AP: proposes to pay; supplies a document a remedy names from the structured source (the ERP record);
 *                         concedes (hold) on a FAIL; otherwise declines. Never moves toward pay, never applies a transform,
 *                         never acts on an authority remedy.
 *   recordedThenStandIn   AP: round 1 is a recorded decision (a published model output, evidence tier T0), then apStandIn's
 *                         rules. Not "the same agent" every round, and the per-round model field says so.
 *   rereadStandIn         a declarative document: re-reads every operand a remedy names from two alternative readings of the
 *                         same page and takes a value only when both agree, quoting it; concedes (reject) when a FAIL's operands
 *                         are all confirmed; otherwise declines. Never computes a field from other fields.
 *   naiveRecompute        the CONTROL: on a FAIL, sets the stated field to the figure the rule expected and keeps its old quote.
 *                         It is what "recompute the named field from its operands" does to a printed defect; the loop's edit
 *                         discipline exists to refuse it.
 */
import { AP_DOC_KEYS, declarativeScope, flattenPaths, scopeCovers, structuredPart, type AgentModel, type ApDocKey, type ApTextProposal, type DeclarativeProposal, type LoopProposal } from 'riposte-ai'
import { canonicalize, sha256, type DeclarativeRuleset } from 'riposte-verify'
import type { LoopAgentImpl, NextContext } from './driver.js'

const same = (a: unknown, b: unknown): boolean => canonicalize(a) === canonicalize(b)
const program = (id: string, sha?: string): AgentModel => ({ model: null, evidence_tier: 'none', program: id, ...(sha ? { program_sha256: sha } : {}) })

// ------------------------------------------------------------------------------------------------------------------ AP

export const AP_STANDIN_ID = 't3-standin-ap@1'

/** The one structured-source key that appears verbatim in the invoice text, or undefined (none, or several). */
export function erpKeyFor(invoice: string, erp: Readonly<Record<string, string>>): string | undefined {
  const hits = Object.keys(erp).filter((k) => k.length >= 3 && invoice.includes(k))
  return hits.length === 1 ? hits[0] : undefined
}

/** The AP stand-in's next proposal after an instruction (rules 1-3 of the prereg), or null to decline. */
export function apStandInNext(ctx: NextContext, erp: Readonly<Record<string, string>>, source = 'erp'): ApTextProposal | null {
  const prev = ctx.previous as ApTextProposal
  const key = erpKeyFor(prev.documents.invoice, erp)
  const record = key !== undefined ? erp[key] : undefined
  // 1. a remedy names, as its operand source, a document the proposal lacks, and the record has it: supply that document only
  const named = [...new Set(ctx.instruction.remedies.map((r) => r.operand?.source).filter((s): s is ApDocKey => (AP_DOC_KEYS as readonly string[]).includes(String(s))))]
  const supply = named.filter((k) => prev.documents[k] === '' && record !== undefined && Boolean(structuredPart(record, k)))
  if (supply.length && record !== undefined && key !== undefined) {
    const next: ApTextProposal = { ...prev, documents: { ...prev.documents }, supplied_from: { ...(prev.supplied_from ?? {}) } }
    for (const k of supply) {
      next.documents[k] = structuredPart(record, k)!
      next.supplied_from![k] = { source, key, record_sha256: sha256(record), part: k }
    }
    return next
  }
  // 2. the verdict FAILs: concede, hold
  if (ctx.instruction.outcome === 'FAIL' && prev.decision !== 'hold') return { ...prev, decision: 'hold' }
  // 3. nothing lawful to do
  return null
}

export function apStandIn(invoiceText: string, erp: Readonly<Record<string, string>>, opts: { source?: string; programSha256?: string } = {}): LoopAgentImpl {
  const source = opts.source ?? 'erp'
  return {
    id: AP_STANDIN_ID,
    first() {
      const key = erpKeyFor(invoiceText, erp)
      const record = key !== undefined ? erp[key] : undefined
      const po = record !== undefined ? structuredPart(record, 'purchase_order') : undefined
      return {
        kind: 'ap-text', decision: 'approve', documents: { invoice: invoiceText, purchase_order: po ?? '', goods_receipt: '' },
        ...(po && key !== undefined ? { supplied_from: { purchase_order: { source, key, record_sha256: sha256(record!), part: 'purchase_order' } } } : {}),
      }
    },
    next: (ctx) => apStandInNext(ctx, erp, source),
    model: () => program(AP_STANDIN_ID, opts.programSha256),
  }
}

export function recordedThenStandIn(documents: Record<ApDocKey, string>, decision: string, declared: { model: string; note: string }, opts: { programSha256?: string } = {}): LoopAgentImpl {
  return {
    id: `recorded:${declared.model}+${AP_STANDIN_ID}`,
    first: () => ({ kind: 'ap-text', decision, documents: { ...documents } }),
    next: (ctx) => apStandInNext(ctx, {}),
    model: (round) => round === 1 ? { model: declared.model, evidence_tier: 'T0', note: declared.note } : program(AP_STANDIN_ID, opts.programSha256),
  }
}

// ------------------------------------------------------------------------------------------------------- declarative

export const REREAD_STANDIN_ID = 't3-standin-peppol@1'
export const NAIVE_RECOMPUTE_ID = 't3-naive-recompute@1'

/** One alternative reading of the same page: its text, the values it read (flattened paths), and a quote per value. */
export interface Reading { name: string; text: string; values: Record<string, unknown>; quotes: Record<string, string> }

const UNKNOWN = (v: unknown): boolean => v === undefined || v === null || v === '' || (typeof v === 'string' && v.trim().toUpperCase() === 'UNREADABLE')

/** Set a flattened path (`a`, `lines[2].x`, `vat_breakdown[0].tax_amount`) on an object, creating what is missing. */
export function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.match(/[^.[\]]+|\[\d+\]/g) ?? []
  let cur: Record<string, unknown> | unknown[] = obj
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!
    const key: string | number = p.startsWith('[') ? Number(p.slice(1, -1)) : p
    const last = i === parts.length - 1
    if (last) { (cur as Record<string | number, unknown>)[key] = value; return }
    const nextIsIndex = parts[i + 1]!.startsWith('[')
    let child = (cur as Record<string | number, unknown>)[key]
    if (child === undefined || child === null || typeof child !== 'object') {
      child = nextIsIndex ? [] : {}
      ;(cur as Record<string | number, unknown>)[key] = child
    }
    cur = child as Record<string, unknown> | unknown[]
  }
}

/** The concrete paths a set of remedies targets: every path in the scope they open that exists in the proposal or a reading. */
export function rereadTargets(rs: DeclarativeRuleset, remedies: NextContext['instruction']['remedies'], known: Iterable<string>): string[] {
  const scope = declarativeScope(rs, remedies)
  return [...new Set(known)].filter((p) => scopeCovers(p, scope)).sort()
}

export function rereadStandIn(round1: DeclarativeProposal, readings: readonly [Reading, Reading], rs: DeclarativeRuleset, opts: { programSha256?: string } = {}): LoopAgentImpl {
  const [r2, r3] = readings
  return {
    id: REREAD_STANDIN_ID,
    first: () => structuredClone(round1),
    next(ctx) {
      const prev = ctx.previous as DeclarativeProposal
      const flat = flattenPaths(prev.extraction)
      const known = [...flat.keys(), ...Object.keys(r2.values), ...Object.keys(r3.values)]
      const operandRemedies = ctx.instruction.remedies.filter((r) => (r.kind === 'recompute-with' || r.kind === 'missing-operand') && r.operand?.role)
      const targets = rereadTargets(rs, operandRemedies, known)
      const next: DeclarativeProposal = structuredClone(prev)
      const quotes = new Map((prev.source?.quotes ?? []).map((q) => [q.id, q.quote]))
      const confirmed = new Set<string>()
      let changed = false
      for (const t of targets) {
        const a = r2.values[t], b = r3.values[t]
        if (UNKNOWN(a) || UNKNOWN(b) || !same(a, b)) continue // not read by both, or they disagree: leave it
        const cur = flat.get(t)
        if (!UNKNOWN(cur) && same(cur, a)) { confirmed.add(t); continue }
        const q = r2.quotes[t]
        if (q === undefined) continue // a value the reading cannot quote is not taken
        setPath(next.extraction, t, a)
        quotes.set(t, q)
        changed = true
      }
      if (changed) {
        let text = prev.source?.text ?? ''
        for (const r of [r2, r3]) if (!text.includes(`\f${r.text}`)) text += `\f${r.text}`
        next.source = { text, quotes: [...quotes].map(([id, quote]) => ({ id, quote })) }
        next.decision = 'accept'
        return same(next, prev) ? null : next
      }
      if (ctx.instruction.outcome === 'FAIL' && prev.decision !== 'reject') {
        // concede only when every operand of every failing claim was re-read by both readings and confirmed
        const failing = new Set(ctx.gate.bundle.verdict.claims.filter((c) => c.outcome === 'FAIL').map((c) => c.claim_id))
        const failRemedies = operandRemedies.filter((r) => r.claims.some((c) => failing.has(c)))
        const failTargets = rereadTargets(rs, failRemedies, known)
        if (failing.size && failTargets.length && failTargets.every((t) => confirmed.has(t))) return { ...prev, decision: 'reject' }
      }
      return null
    },
    model: () => program(REREAD_STANDIN_ID, opts.programSha256),
  }
}

/** The control (see the header). On a FAIL, each failing claim's stated operand becomes the rule's expected figure. */
export function naiveRecompute(round1: DeclarativeProposal, opts: { programSha256?: string } = {}): LoopAgentImpl {
  return {
    id: NAIVE_RECOMPUTE_ID,
    first: () => structuredClone(round1),
    next(ctx) {
      if (ctx.instruction.outcome !== 'FAIL') return null
      const prev = ctx.previous as DeclarativeProposal
      const next: DeclarativeProposal = structuredClone(prev)
      let changed = false
      for (const c of ctx.gate.bundle.verdict.claims) {
        if (c.outcome !== 'FAIL') continue
        const stated = c.evidence?.find((e) => e.locator?.kind === 'field' && e.locator.source !== 'computed')
        const path = stated && stated.locator.kind === 'field' ? stated.locator.path : undefined
        const want = c.computation?.result
        if (!path || want === undefined || want === null) continue
        setPath(next.extraction, path, want)
        changed = true
      }
      return changed && !same(next, prev) ? next : null
    },
    model: () => program(NAIVE_RECOMPUTE_ID, opts.programSha256),
  }
}

/** For tests and runs: does a proposal carry a value at a path? */
export const valueAt = (p: LoopProposal, path: string): unknown => (p.kind === 'declarative' ? flattenPaths(p.extraction).get(path) : undefined)
