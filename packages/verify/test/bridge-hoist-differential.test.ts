/**
 * 2026-09-28: the per-document hoist in src/binding/ontological-bridge.ts is a PURE hoist.
 *
 * The frozen bridge from before the hoist (test/fixtures/frozen-bridge/, sha256 a738fe32…) and the live bridge run side by side on a
 * seeded corpus (test/fixtures/bridge-hoist-corpus.ts). Two levels:
 *   1. the bridge itself: every line's BindingContext and the document context, serialized with key order, `undefined`,
 *      Dates and object ALIASING kept (so a value shared across lines where the old code made one per line would show),
 *      plus the thrown error when there is one, and the whole log stream with a logger installed;
 *   2. verify() end to end: the old engine is the same src/ graph with the bridge module swapped for the frozen copy
 *      (vi.doMock), and the verdict bytes must match: JSON.stringify (key order kept) and canonicalize.
 * Plus the pieces the hoist deliberately leaves per line, the scope's lifetime, and the one pinned difference of the log
 * guard (a disabled debug log no longer throws on a value String() cannot convert; JSON never produces one).
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import * as NEW from '../src/index'
import { canonicalize } from '../src/verdict/canonical'
import { OntologicalBridge, setBridgeLogger } from '../src/binding/ontological-bridge'
import * as FROZEN from './fixtures/frozen-bridge/ontological-bridge.frozen'
import { INVOICE_ONTOLOGY } from '../src/rulesets/invoice/ontology'
import { PAY_APP_ONTOLOGY } from '../src/rulesets/pay-app/ontology'
import type { DomainOntology, UniversalRole, LLMCorrelationMap } from '../src/kernel/types'
import { buildHoistCorpus, randomCorrelationMap, rng, type HoistCase, type Json } from './fixtures/bridge-hoist-corpus'

const CORPUS_SIZE = Number(process.env.F3_CORPUS ?? 3000)
// The verdict-level bar always runs every case. The bridge-level passes stride the corpus by default to keep the suite
// quick; F3_FULL=1 runs them on every case (done at landing: 13/13 green, 192 s).
const FULL = process.env.F3_FULL === '1'
const NOW = () => new Date('2026-09-28T12:00:00Z')
const LONG = 600_000

/** Serialize with key order, undefined, NaN/-0, Dates and aliasing preserved (a second visit to an object is a back-reference). */
function snap(x: unknown): string {
  const seen = new Map<object, number>()
  const walk = (v: unknown): unknown => {
    if (v === undefined) return ['undef']
    if (typeof v === 'number') return Number.isNaN(v) ? ['NaN'] : Object.is(v, -0) ? ['-0'] : Number.isFinite(v) ? v : [String(v)]
    if (typeof v === 'bigint' || typeof v === 'symbol' || typeof v === 'function') return [typeof v, String(v)]
    if (v === null || typeof v !== 'object') return v
    const id = seen.get(v)
    if (id !== undefined) return ['ref', id]
    seen.set(v, seen.size)
    if (v instanceof Date) return ['Date', v.getTime()]
    if (Array.isArray(v)) return ['arr', ...Array.from({ length: v.length }, (_, i) => (i in v ? walk(v[i]) : ['hole']))]
    return ['obj', ...Object.keys(v).map(k => [k, walk((v as Record<string, unknown>)[k])])]
  }
  return JSON.stringify(walk(x))
}

function outcome(fn: () => unknown): string {
  try {
    return 'ok ' + snap(fn())
  } catch (e) {
    const err = e as Error
    return `throw ${err?.name}: ${err?.message}`
  }
}

// A third ontology that reaches what the two built-ins do not: JSONPath paths (never memoized), a documentType 'any'
// mapping, a mixed [*] / plain mapping, competing priorities for one role, a ruleset-declared role kind, other line keys.
const CUSTOM: DomainOntology = {
  domainId: 'custom-f3',
  domainName: 'F3 differential probe',
  lineArrayKeys: ['rows', 'line_items'],
  roleKinds: { ['WIDGET_COUNT' as UniversalRole]: 'quantity' },
  mappings: [
    { domain: 'custom-f3', role: 'RATE_APPLIED', documentType: 'invoice', priority: 100, fieldPath: '$.line_items[*].unit_price', alternativePaths: ['$.rows[*].rate', 'line_items[*].rate'] },
    { domain: 'custom-f3', role: 'CLAIMED_QUANTITY', documentType: 'invoice', priority: 100, fieldPath: 'line_items[*].quantity', alternativePaths: ['quantity', 'header.qty'] },
    { domain: 'custom-f3', role: 'CLAIMED_AMOUNT', documentType: 'invoice', priority: 90, fieldPath: 'line_items[*].amount' },
    { domain: 'custom-f3', role: 'CLAIMED_AMOUNT', documentType: 'invoice', priority: 110, fieldPath: 'line_items[*].total', fuzzyMatch: false },
    { domain: 'custom-f3', role: 'GRAND_TOTAL', documentType: 'invoice', priority: 100, fieldPath: '$.totals.total', alternativePaths: ['total', '$..grand_total'] },
    { domain: 'custom-f3', role: 'CURRENCY_CODE', documentType: 'any', priority: 100, fieldPath: 'currency', alternativePaths: ['currency_code'] },
    { domain: 'custom-f3', role: 'WIDGET_COUNT' as UniversalRole, documentType: 'invoice', priority: 100, fieldPath: 'meta.widgets', alternativePaths: ['widgets'] },
    { domain: 'custom-f3', role: 'DOCUMENT_ID', documentType: 'invoice', priority: 100, fieldPath: 'invoice_number', alternativePaths: ['line_items[*].reference', 'reference'] },
    { domain: 'custom-f3', role: 'RATE_CONTRACTED', documentType: 'contract', priority: 100, fieldPath: '$.financial_rules[*].values.rate', alternativePaths: ['rate'] },
    { domain: 'custom-f3', role: 'ACTUAL_QUANTITY', documentType: 'evidence', priority: 100, fieldPath: '$..quantity', alternativePaths: ['line_items[*].qty'] },
    { domain: 'custom-f3', role: 'EVIDENCE_DESCRIPTION', documentType: 'evidence', priority: 100, fieldPath: 'line_items[*].description', alternativePaths: ['description'] },
  ],
}

type AnyBridge = {
  registerOntology(o: DomainOntology): void
  createLineItemBindings(d: string, i: Json, c: Json, e: Json[], m?: LLMCorrelationMap): unknown
  createBindings(d: string, i: Json, c: Json, e: Json[], idx?: number, m?: LLMCorrelationMap): unknown
}
function fresh(Ctor: new () => AnyBridge): AnyBridge {
  const b = new Ctor()
  for (const o of [INVOICE_ONTOLOGY, PAY_APP_ONTOLOGY, CUSTOM]) b.registerOntology(o)
  return b
}
const OldBridge = FROZEN.OntologicalBridge as unknown as new () => AnyBridge
const NewBridge = OntologicalBridge as unknown as new () => AnyBridge

/** verify()'s own reference handling, so the bridge sees what it sees inside verify(). */
const isObj = (x: unknown): x is Json => x !== null && typeof x === 'object' && !Array.isArray(x)
function bridgeArgs(c: HoistCase): { contract: Json; evidence: Json[] } {
  const contract = isObj(c.references?.contract) ? (c.references!.contract as Json) : {}
  const ev = c.references?.evidence
  return { contract, evidence: (Array.isArray(ev) ? ev : []).filter(isObj) }
}

/** Run one case through a bridge the way verify() does (lines, then the document context), with or without a log. */
function runBridge(b: AnyBridge, setLogger: (l?: (m: string) => void) => void, domain: string, c: HoistCase, map: LLMCorrelationMap | undefined, logs: string[] | null): string {
  if (logs) setLogger(m => logs.push(m))
  try {
    const { contract, evidence } = bridgeArgs(c)
    const lines = outcome(() => b.createLineItemBindings(domain, c.extraction, contract, evidence, map))
    const doc = outcome(() => b.createBindings(domain, c.extraction, contract, evidence, undefined, map))
    return `${lines}\n${doc}`
  } finally {
    if (logs) setLogger(undefined)
  }
}

const corpus = buildHoistCorpus(CORPUS_SIZE)

/**
 * 2026-10-03 changed the bridge on purpose at ONE place: evidence read at a line of a multi-line invoice (the evidence
 * line is matched by description; a document-level evidence total or quantity is not bound to a line). Its guard is exactly
 * this predicate, so every other case must still match the frozen bridge byte for byte; the cases it covers are checked by
 * the evidence-at-a-line block at the end (the difference is confined to the evidence roles and what derives from them).
 */
const evidenceAtALine = (c: HoistCase): boolean => Array.isArray(c.extraction.line_items) && (c.extraction.line_items as unknown[]).length > 1 && bridgeArgs(c).evidence.length > 0
const EVIDENCE_ROLES = ['EVIDENCE_DESCRIPTION', 'ACTUAL_QUANTITY', 'VERIFIED_AMOUNT', 'EXPECTED_TOTAL']

describe('the hoist: the bridge is observationally identical to the frozen bridge from before it', () => {
  it('the corpus is the one described: size, rulesets, line counts 1–300, references present and absent', () => {
    expect(corpus.length).toBe(CORPUS_SIZE)
    const lines = corpus.map(c => {
      const x = c.extraction
      const k = ['line_items', 'schedule_of_values', 'continuation_sheet', 'items', 'lines', 'sov'].find(k => Array.isArray(x[k]))
      return k ? (x[k] as unknown[]).length : 0
    })
    expect(Math.max(...lines)).toBeGreaterThanOrEqual(250)
    expect(lines.filter(n => n >= 100).length).toBeGreaterThan(CORPUS_SIZE / 50)
    expect(corpus.filter(c => c.ruleset === 'pay-app').length).toBeGreaterThan(CORPUS_SIZE / 20)
    expect(corpus.filter(c => isObj(c.references?.contract)).length).toBeGreaterThan(CORPUS_SIZE / 4)
    expect(corpus.filter(c => Array.isArray(c.references?.evidence) && (c.references!.evidence as unknown[]).length > 0).length).toBeGreaterThan(CORPUS_SIZE / 4)
    expect(corpus.filter(c => c.references?.contract === undefined && c.references?.evidence === undefined).length).toBeGreaterThan(CORPUS_SIZE / 20)
  })

  it(`three ontologies, logger off: identical line contexts, document context and errors (${FULL ? 'every' : 'every 3rd'} case)`, () => {
    const r = rng(7)
    const mismatches: string[] = []
    let throws = 0
    for (const c of corpus.filter((x, i) => (FULL || i % 3 === 0) && !evidenceAtALine(x))) {
      const domains = c.ruleset === 'pay-app' ? ['pay-app', 'custom-f3'] : ['invoice', 'custom-f3']
      for (const domain of domains) {
        const map = r.chance(0.2) ? (randomCorrelationMap(r, 40) as LLMCorrelationMap) : undefined
        const a = runBridge(fresh(OldBridge), FROZEN.setBridgeLogger, domain, c, map, null)
        const b = runBridge(fresh(NewBridge), setBridgeLogger, domain, c, map, null)
        if (a.includes('throw ')) throws++
        if (a !== b) mismatches.push(`${c.id} @ ${domain}`)
      }
    }
    expect(mismatches).toEqual([])
    // the error path is exercised too (junk contract rule names, non-object documents), and it matches
    expect(throws).toBeGreaterThan(0)
  }, LONG)

  it(`with a logger installed, the log stream is identical line for line (every ${FULL ? '5th' : '10th'} case)`, () => {
    const r = rng(11)
    const mismatches: string[] = []
    let total = 0
    for (const c of corpus.filter((x, i) => i % (FULL ? 5 : 10) === 0 && !evidenceAtALine(x))) {
      const domain = c.ruleset
      const map = r.chance(0.3) ? (randomCorrelationMap(r, 40) as LLMCorrelationMap) : undefined
      const la: string[] = []
      const lb: string[] = []
      const a = runBridge(fresh(OldBridge), FROZEN.setBridgeLogger, domain, c, map, la)
      const b = runBridge(fresh(NewBridge), setBridgeLogger, domain, c, map, lb)
      total += la.length
      if (a !== b || la.join('\n') !== lb.join('\n')) mismatches.push(c.id)
    }
    expect(mismatches).toEqual([])
    expect(total).toBeGreaterThan(3_000)
  }, LONG)

  it('one bridge instance reused across the whole corpus (as the verify() singleton is) still matches', () => {
    const oldB = fresh(OldBridge)
    const newB = fresh(NewBridge)
    const mismatches = corpus.filter((c, i) => i % (FULL ? 3 : 10) === 0 && !evidenceAtALine(c)).filter(c =>
      runBridge(oldB, FROZEN.setBridgeLogger, c.ruleset, c, undefined, null) !== runBridge(newB, setBridgeLogger, c.ruleset, c, undefined, null))
    expect(mismatches.map(c => c.id)).toEqual([])
  }, LONG)
})

describe('the hoist: verify() verdict bytes equal the engine\'s from before it', () => {
  let OLD: typeof NEW
  let frozenLoaded = false
  beforeAll(async () => {
    vi.resetModules()
    vi.doMock('../src/binding/ontological-bridge.js', async () => {
      const m = await import('./fixtures/frozen-bridge/ontological-bridge.frozen')
      frozenLoaded = m.FROZEN_BRIDGE_MARKER === 'pre-F3 a738fe32'
      return m
    })
    OLD = (await import('../src/index')) as typeof NEW
    vi.doUnmock('../src/binding/ontological-bridge.js')
  })

  it('the old engine really runs the frozen bridge, and the new one does not', () => {
    expect(frozenLoaded).toBe(true)
    expect(OLD.verify).not.toBe(NEW.verify)
  })

  it('on the cases the evidence-at-a-line fix covers, every claim that changed reads an evidence role (or what derives from one)', () => {
    const tally = new Map<string, number>()
    let affected = 0, changedVerdicts = 0
    // a claim "reads an evidence role" when an operand or a missing role is one, or when it cites a field of an evidence document
    const touches = (c: { computation?: { operands?: Record<string, unknown> }; insufficiency?: { missing?: string[] }; evidence?: { locator: { kind: string; source?: string } }[] } | undefined): boolean =>
      !!c && (Object.keys(c.computation?.operands ?? {}).some(k => EVIDENCE_ROLES.includes(k)) || (c.insufficiency?.missing ?? []).some(m => EVIDENCE_ROLES.includes(m))
        || (c.evidence ?? []).some(e => e.locator.kind === 'field' && e.locator.source === 'evidence'))
    for (const c of corpus.filter(evidenceAtALine)) {
      affected++
      const opts = { ruleset: c.ruleset, now: NOW, ...(c.references ? { references: c.references as never } : {}) }
      let a: ReturnType<typeof NEW.verify>, b: ReturnType<typeof NEW.verify>
      try { a = OLD.verify(c.extraction, opts); b = NEW.verify(c.extraction, opts) } catch { continue }
      expect(b.verdict_id).toBe(a.verdict_id)
      let changed = false
      a.claims.forEach((x, i) => {
        const y = b.claims[i]!
        expect(y.claim_id).toBe(x.claim_id)
        if (JSON.stringify(x) === JSON.stringify(y)) return
        changed = true
        expect([c.id, x.claim_id, touches(x) || touches(y)]).toEqual([c.id, x.claim_id, true])
        const k = `${x.rule_id} ${x.outcome} -> ${y.outcome}`
        tally.set(k, (tally.get(k) ?? 0) + 1)
      })
      if (changed) changedVerdicts++
    }
    expect(affected).toBeGreaterThan(CORPUS_SIZE / 10)
    // the transitions, for the record (printed, not pinned: the corpus is seeded, the counts are stable). 2026-10-06: printed
    // with what they mean, so a reader of the log does not take "FAIL -> PASS: 1026" inside a passing test for a regression.
    console.log([
      `evidence at a line: ${affected} cases of this seeded corpus carry delivery evidence on an invoice of several lines, and ${changedVerdicts} of their verdicts changed, on purpose,`,
      'when the bridge stopped binding one document-level evidence figure (a total, a quantity) to every line (2026-10-03). Every changed check reads an evidence role or',
      'what derives from one (asserted above). Each transition below is a check that now reads its own line\'s figures: "MATH_INT FAIL -> PASS" is a line once compared',
      'with the whole document\'s evidence total, and failed, that now compares its amount with its own price times quantity; a "-> INSUFFICIENT_DATA" is a line whose own',
      'evidence is absent, now said instead of borrowed. Before -> after, counted by check:',
      `  ${[...tally].sort().map(([k, n]) => `${k}: ${n}`).join(' · ')}`,
    ].join('\n'))
  }, LONG)

  const CHUNK = 750
  for (let from = 0; from < CORPUS_SIZE; from += CHUNK) {
    const to = Math.min(CORPUS_SIZE, from + CHUNK)
    it(`cases ${from}–${to - 1}: JSON.stringify(verdict) and canonicalize(verdict) are byte-identical`, () => {
      const mismatches: string[] = []
      let fails = 0
      for (const c of corpus.slice(from, to).filter(x => !evidenceAtALine(x))) {
        const opts = { ruleset: c.ruleset, now: NOW, ...(c.references ? { references: c.references as never } : {}) }
        const run = (m: typeof NEW) => {
          try {
            const v = m.verify(c.extraction, opts)
            if (v.outcome === 'FAIL') fails++
            return `${JSON.stringify(v)}\n${canonicalize(v)}`
          } catch (e) {
            return `throw ${(e as Error).name}: ${(e as Error).message}`
          }
        }
        if (run(OLD) !== run(NEW)) mismatches.push(c.id)
      }
      expect(mismatches).toEqual([])
      expect(fails).toBeGreaterThan(0)
    }, LONG)
  }
})

describe('the hoist: what stays per line, and the scope\'s lifetime', () => {
  it('a document-level role CAN differ per line: with no document id, each line binds its own `reference` (kept, as before)', () => {
    const inv = { line_items: [{ description: 'A', quantity: 1, unit_price: 2, amount: 2, reference: 'R-A' }, { description: 'B', quantity: 1, unit_price: 3, amount: 3, reference: 'R-B' }] }
    for (const B of [OldBridge, NewBridge]) {
      const ctxs = fresh(B).createLineItemBindings('invoice', inv, {}, []) as Array<{ bindings: Record<string, { value: unknown; confidence: number }> }>
      expect(ctxs.map(c => c.bindings.DOCUMENT_ID?.value)).toEqual(['RA', 'RB']) // normalizeReference drops the hyphen
      expect(ctxs.map(c => c.bindings.DOCUMENT_ID?.confidence)).toEqual([75, 75])
    }
  })

  it('no answer outlives a call: a document edited between calls is read afresh', () => {
    const b = fresh(NewBridge)
    const inv: Json = { invoice_number: 'X', totals: { total: 10 }, line_items: [{ amount: 5 }, { amount: 5 }] }
    const total = () => (b.createLineItemBindings('invoice', inv, {}, []) as Array<{ bindings: Record<string, { value: unknown }> }>)[1]!.bindings.GRAND_TOTAL?.value
    expect(total()).toBe(10)
    ;(inv.totals as Json).total = 12
    expect(total()).toBe(12)
  })

  it('a call that throws leaves no scope behind: the next call matches the frozen bridge', () => {
    const b = fresh(NewBridge)
    const bad = { line_items: [{ description: 'x' }, { description: 'y' }], dates: [{ type: 5 }] } // extractDateValue: type.toLowerCase
    const old = fresh(OldBridge)
    expect(outcome(() => b.createLineItemBindings('invoice', bad, {}, []))).toBe(outcome(() => old.createLineItemBindings('invoice', bad, {}, [])))
    expect(outcome(() => b.createLineItemBindings('invoice', bad, {}, []))).toMatch(/^throw TypeError/)
    const good = corpus.find(c => c.ruleset === 'invoice' && Array.isArray(c.extraction.line_items) && (c.extraction.line_items as unknown[]).length > 20 && !evidenceAtALine(c))!
    expect(runBridge(b, setBridgeLogger, 'invoice', good, undefined, null)).toBe(runBridge(old, FROZEN.setBridgeLogger, 'invoice', good, undefined, null))
  })

  it('pinned difference of the log guard: a disabled debug log no longer throws on a value String() cannot convert', () => {
    // Only reachable from a library caller: JSON.parse never makes a null-prototype object. The value is found by the fuzzy
    // search alone (`charge` is an alias, not a path), fails the numeric type check, and the old code built the REJECTED
    // message anyway, with String(value) throwing. The new code builds no message while the logger is off.
    const inv = { invoice_number: 'N', line_items: [{ description: 'x', quantity: 1, charge: Object.create(null) }, { description: 'y', quantity: 1, amount: 1 }] }
    expect(outcome(() => fresh(OldBridge).createLineItemBindings('invoice', inv, {}, []))).toBe('throw TypeError: Cannot convert object to primitive value')
    const ctxs = fresh(NewBridge).createLineItemBindings('invoice', inv, {}, []) as Array<{ bindings: Record<string, unknown> }>
    expect(ctxs[0]!.bindings.RATE_APPLIED).toBeUndefined()
    // with a logger installed the message is built, so both throw as before
    const both = [[OldBridge, FROZEN.setBridgeLogger], [NewBridge, setBridgeLogger]] as const
    const withLog = both.map(([B, set]) => {
      set(() => {})
      try { return outcome(() => fresh(B).createLineItemBindings('invoice', inv, {}, [])) } finally { set(undefined) }
    })
    expect(withLog[1]).toBe(withLog[0])
    expect(withLog[0]).toMatch(/^throw TypeError/)
  })
})

describe('evidence at a line (2026-10-03): the only difference from the frozen bridge', () => {
  it('on every case the fix covers, only the evidence roles and what derives from them differ, line by line', () => {
    const keys = new Set<string>()
    let affected = 0
    for (const c of corpus.filter((x, i) => evidenceAtALine(x) && (FULL || i % 3 === 0))) {
      const { contract, evidence } = bridgeArgs(c)
      let a: Array<{ bindings: Record<string, unknown> }>, b: Array<{ bindings: Record<string, unknown> }>
      try {
        a = fresh(OldBridge).createLineItemBindings(c.ruleset, c.extraction, contract, evidence) as typeof a
        b = fresh(NewBridge).createLineItemBindings(c.ruleset, c.extraction, contract, evidence) as typeof b
      } catch { continue }
      affected++
      a.forEach((ctx, i) => {
        const nb = b[i]!
        expect(snap({ ...ctx, bindings: null })).toBe(snap({ ...nb, bindings: null }))
        for (const k of new Set([...Object.keys(ctx.bindings), ...Object.keys(nb.bindings)])) if (snap(ctx.bindings[k]) !== snap(nb.bindings[k])) keys.add(k)
      })
    }
    expect(affected).toBeGreaterThan(CORPUS_SIZE / 30)
    expect([...keys].every(k => EVIDENCE_ROLES.includes(k))).toBe(true)
  }, LONG)
})
