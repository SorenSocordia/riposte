/**
 * Declarative rulesets (the "day-1 tunable" arms): teach the engine a NEW document type as JSON — no engine code — and
 * get the same proof object. Also the mechanism that completes multilingual TAM: caller-declared field aliases work for
 * any language. And the honesty rules still hold: missing → abstain, broken → FAIL on the right number.
 */
import { describe, it, expect } from 'vitest'
import { verify, verifyDeclarative, evalExpr, type DeclarativeRuleset, type Verdict } from '../src/index'

const NOW = () => new Date('2026-09-22T00:00:00Z')
const claim = (v: Verdict, id: string) => {
  const c = v.claims.find(x => x.claim_id === id)
  if (!c) throw new Error(`claim ${id} not found; have ${v.claims.map(x => x.claim_id).join(', ')}`)
  return c
}

// A document type the built-in engine has never seen — a purchase order — defined entirely as data.
const PO: DeclarativeRuleset = {
  id: 'purchase-order', version: '0.0.1', domain: 'purchase-order',
  lineArrayKeys: ['items', 'line_items'],
  fields: {
    LINE_QTY: { paths: ['qty', 'quantity'], kind: 'quantity', line: true },
    LINE_PRICE: { paths: ['unit_price', 'price'], kind: 'amount', line: true },
    LINE_AMOUNT: { paths: ['amount', 'total'], kind: 'amount', line: true },
    SUBTOTAL: { paths: ['subtotal', 'totals.subtotal'] },
    TAX: { paths: ['tax', 'totals.tax'] },
    TOTAL: { paths: ['total', 'totals.total', 'amount_due'] },
  },
  computed: {
    LINE_SUM: 'sum(LINE_AMOUNT)',
    EXPECTED_TOTAL: 'SUBTOTAL + TAX',
  },
  checks: [
    { code: 'SUM_INT', field: 'subtotal', left: 'LINE_SUM', op: '=', right: 'SUBTOTAL' },
    { code: 'TOTAL_INT', field: 'total', left: 'TOTAL', op: '=', right: 'EXPECTED_TOTAL' },
    { code: 'MATH_INT', field: 'amount', scope: 'line', left: 'LINE_AMOUNT', op: '=', right: 'LINE_QTY * LINE_PRICE' },
  ],
}

const cleanPO = { items: [{ desc: 'A', qty: 2, unit_price: 50, amount: 100 }, { desc: 'B', qty: 1, unit_price: 250, amount: 250 }], subtotal: 350, tax: 35, total: 385 }

describe('expression evaluator (safe, no eval)', () => {
  const env = { vars: { A: 10, B: 4, C: undefined as number | undefined }, sum: (r: string) => (r === 'L' ? 30 : undefined) }
  it('arithmetic + precedence + parens', () => {
    expect(evalExpr('A + B * 2', env)).toBe(18)
    expect(evalExpr('(A + B) * 2', env)).toBe(28)
    expect(evalExpr('A - B - 1', env)).toBe(5)
    expect(evalExpr('abs(B - A)', env)).toBe(6)
  })
  it('sum() and missing operands', () => {
    expect(evalExpr('sum(L) + A', env)).toBe(40)
    expect(evalExpr('A + C', env)).toBeUndefined()   // C missing → whole expression unknown
    expect(evalExpr('sum(X)', env)).toBeUndefined()  // unknown line role
  })
  it('rejects unsafe input', () => {
    expect(() => evalExpr('A; drop', env)).toThrow()
  })
})

describe('a NEW document type defined as JSON', () => {
  it('a clean purchase order verifies — footing, total, and per-line math, all from data', () => {
    const v = verifyDeclarative(cleanPO, PO, { now: NOW })
    expect(v.ruleset.id).toBe('purchase-order')
    expect(claim(v, 'document.SUM_INT').outcome).toBe('PASS')
    expect(claim(v, 'document.TOTAL_INT').outcome).toBe('PASS')
    expect(claim(v, 'line[0].MATH_INT').outcome).toBe('PASS')
    expect(claim(v, 'line[1].MATH_INT').outcome).toBe('PASS')
    expect(v.outcome).toBe('PASS')
  })

  it('a wrong total FAILs on exactly that number, with a signed variance', () => {
    const v = verifyDeclarative({ ...cleanPO, total: 999 }, PO, { now: NOW })
    const c = claim(v, 'document.TOTAL_INT')
    expect(c.outcome).toBe('FAIL')
    expect(c.variance).toBe(614)          // 999 − 385
    expect(c.locked).toBe(true)
    expect(claim(v, 'document.SUM_INT').outcome).toBe('PASS')  // independent checks stay independent
    expect(v.outcome).toBe('FAIL')
  })

  it('a per-line math error FAILs only that line', () => {
    const v = verifyDeclarative({ ...cleanPO, items: [{ qty: 2, unit_price: 50, amount: 111 }, { qty: 1, unit_price: 250, amount: 250 }], subtotal: 361, total: 396, tax: 35 }, PO, { now: NOW })
    expect(claim(v, 'line[0].MATH_INT').outcome).toBe('FAIL')
    expect(claim(v, 'line[1].MATH_INT').outcome).toBe('PASS')
  })

  it('a missing field abstains (FIELD_MISSING), never guesses', () => {
    const { subtotal: _s, ...noSubtotal } = cleanPO
    const v = verifyDeclarative(noSubtotal, PO, { now: NOW })
    expect(claim(v, 'document.SUM_INT').outcome).toBe('INSUFFICIENT_DATA')
    expect(claim(v, 'document.SUM_INT').insufficiency?.reason).toBe('FIELD_MISSING')
    // EXPECTED_TOTAL needs SUBTOTAL, so TOTAL_INT abstains too rather than compare against a guess
    expect(claim(v, 'document.TOTAL_INT').outcome).toBe('INSUFFICIENT_DATA')
    expect(claim(v, 'line[0].MATH_INT').outcome).toBe('PASS')  // per-line math still runs
  })
})

describe('declarative completes multilingual TAM — caller-declared aliases, any language', () => {
  it('a Spanish purchase order with native field names verifies (no built-in aliases needed)', () => {
    const esPO: DeclarativeRuleset = {
      ...PO,
      fields: {
        LINE_QTY: { paths: ['cantidad'], kind: 'quantity', line: true },
        LINE_PRICE: { paths: ['precio'], kind: 'amount', line: true },
        LINE_AMOUNT: { paths: ['importe'], kind: 'amount', line: true },
        SUBTOTAL: { paths: ['subtotal'] }, TAX: { paths: ['impuesto'] }, TOTAL: { paths: ['total'] },
      },
    }
    const es = { items: [{ cantidad: 2, precio: 50, importe: 100 }], subtotal: 100, impuesto: 21, total: 121 }
    const v = verifyDeclarative(es, esPO, { now: NOW })
    expect(v.outcome).toBe('PASS')
    expect(claim(v, 'document.SUM_INT').outcome).toBe('PASS')
    expect(claim(v, 'document.TOTAL_INT').outcome).toBe('PASS')
  })

  it('full-width digits in a declared ruleset fold and verify', () => {
    const jp = { items: [{ cantidad: '２', precio: '５０', importe: '１００' }], subtotal: '１００', impuesto: 0, total: '１００' }
    const esPO: DeclarativeRuleset = { ...PO, fields: { LINE_QTY: { paths: ['cantidad'], kind: 'quantity', line: true }, LINE_PRICE: { paths: ['precio'], kind: 'amount', line: true }, LINE_AMOUNT: { paths: ['importe'], kind: 'amount', line: true }, SUBTOTAL: { paths: ['subtotal'] }, TAX: { paths: ['impuesto'] }, TOTAL: { paths: ['total'] } } }
    expect(verifyDeclarative(jp, esPO, { now: NOW }).outcome).toBe('PASS')
  })
})

describe('routing + determinism', () => {
  it('verify() routes a declarative ruleset object automatically', () => {
    const v = verify(cleanPO, { ruleset: PO, now: NOW })
    expect(v.ruleset.id).toBe('purchase-order')
    expect(v.outcome).toBe('PASS')
  })
  it('the ruleset + input fix the verdict id; the proof replays except issued_at', () => {
    const a = verify(cleanPO, { ruleset: PO, now: NOW })
    const b = verify(cleanPO, { ruleset: PO, now: () => new Date('2031-01-01T00:00:00Z') })
    expect(a.verdict_id).toBe(b.verdict_id)
    expect(JSON.stringify({ ...a, issued_at: '' })).toBe(JSON.stringify({ ...b, issued_at: '' }))
  })
})
