/**
 * Engine fixes (2026-10-03), from the playground and the scorers:
 *   1. evidence at a line of a multi-line invoice binds the matching evidence line (a correctness bug)
 *   2. the misquote search is linear in the quote (a sliding window), with results identical to the old search
 *   3. a lossless packed verdict for long invoices (verdict ids and bytes untouched)
 *   4. one exported builder for the inputs a verdict's hash binds; a declarative verdict with source text replays
 *   5. span offsets are UTF-16 code units of the source text (stated in the schema doc)
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { verify, verifyCitations, prepareSource, matchQuote, route, packVerdict, unpackVerdict, verifyInputs, verifyInputHash, replayBundle, type DeclarativeRuleset } from '../src/index'
import { normalizeMapped, toOriginalSpan } from '../src/textmatch/normalize'

const NOW = () => new Date('2026-10-03T00:00:00Z')

describe('1. evidence at a line of a multi-line invoice', () => {
  const inv = { invoice_number: 'INV-1001', currency: 'USD', invoice_date: '2026-09-15', prior_invoice_ids: ['INV-0998'],
    line_items: [{ description: 'Consulting', quantity: 10, unit_price: 150, amount: 1500 }, { description: 'Travel', quantity: 1, unit_price: 250.5, amount: 250.5 }],
    totals: { subtotal: 1750.5, tax_rate: 0.0825, tax: 144.42, total: 1894.92 } }
  const contract = { financial_rules: [{ rule_name: 'Consulting', values: { rate: 150 } }, { rule_name: 'Travel', values: { rate: 250.5 } }], max_amount: 5000, effective_date: '2026-01-01', expiration_date: '2026-12-31' }
  const lines = [{ description: 'Consulting', quantity: 10 }, { description: 'Travel', quantity: 1 }]
  const claim = (v: ReturnType<typeof verify>, id: string) => v.claims.find(c => c.claim_id === id)!

  it('the playground repro: line 2 reads its own evidence line (QTY_MATCH used to abstain), and a document total is not a line amount (MATH_INT used to FAIL both lines)', () => {
    for (const evidence of [[{ line_items: lines }], [{ line_items: lines, totals: { total: 1750.5 }, date: '2026-09-15' }]]) {
      const v = verify(inv, { references: { contract, evidence }, now: NOW })
      expect(v.outcome).toBe('PASS')
      expect(claim(v, 'line[1].QTY_MATCH').outcome).toBe('PASS')
      expect(claim(v, 'line[1].QTY_MATCH').computation?.operands).toEqual({ CLAIMED_QUANTITY: 1, ACTUAL_QUANTITY: 1 })
      for (const i of [0, 1]) expect(claim(v, `line[${i}].MATH_INT`).outcome).toBe('PASS')
      expect(claim(v, 'line[0].MATH_INT').computation?.operands).toEqual({ CLAIMED_AMOUNT: 1500, VERIFIED_AMOUNT: 1500 })
    }
  })

  it('the evidence line is matched by description, not position; a quantity that really differs FAILs', () => {
    const swapped = [{ description: 'Travel', quantity: 1 }, { description: 'Consulting', quantity: 8 }]
    const v = verify(inv, { references: { contract, evidence: [{ line_items: swapped }] }, now: NOW })
    expect(claim(v, 'line[0].QTY_MATCH').outcome).toBe('FAIL')
    expect(claim(v, 'line[0].QTY_MATCH').computation?.operands).toEqual({ CLAIMED_QUANTITY: 10, ACTUAL_QUANTITY: 8 })
    expect(claim(v, 'line[1].QTY_MATCH').outcome).toBe('PASS')
  })

  it('an invoice line with no matching evidence line abstains: it is never compared with another line', () => {
    const v = verify(inv, { references: { contract, evidence: [{ line_items: [{ description: 'Consulting', quantity: 10 }, { description: 'Hotel', quantity: 3 }] }] }, now: NOW })
    expect(claim(v, 'line[0].QTY_MATCH').outcome).toBe('PASS')
    expect(claim(v, 'line[1].QTY_MATCH').outcome).toBe('INSUFFICIENT_DATA')
  })

  it('a single-line invoice is unchanged: a receipt total is still its verified amount', () => {
    const one = { invoice_number: 'INV-2', currency: 'USD', line_items: [{ description: 'Consulting', quantity: 10, unit_price: 150, amount: 1500 }], totals: { subtotal: 1500, tax: 0, total: 1500 } }
    const v = verify(one, { references: { evidence: [{ line_items: [{ description: 'Consulting', quantity: 10 }], totals: { total: 1400 } }] }, now: NOW })
    const m = claim(v, 'line[0].MATH_INT')
    expect(m.outcome).toBe('FAIL')
    expect(m.evidence.some(e => e.locator.kind === 'field' && e.locator.path === 'evidence[0].totals.total')).toBe(true)
  })
})

describe('2. the misquote search: linear, and the same answers', () => {
  /** The search as it was before 2026-10-03 (restart at every word), kept here as the reference. */
  function oldLongestRun(text: string, qWords: string[]): { len: number; pos: number; chars: number } {
    let bestLen = 0, bestPos = -1, bestChars = 0
    for (let i = 0; i < qWords.length; i++) {
      let phrase = qWords[i]!
      let pos = text.indexOf(phrase)
      if (pos < 0) continue
      let j = i
      while (j + 1 < qWords.length) { const trial = `${phrase} ${qWords[j + 1]}`; const tpos = text.indexOf(trial); if (tpos < 0) break; phrase = trial; pos = tpos; j++ }
      const len = j - i + 1
      if (len > bestLen) { bestLen = len; bestPos = pos; bestChars = phrase.length }
    }
    return { len: bestLen, pos: bestPos, chars: bestChars }
  }
  const W = 'court held that the parties agreed contract clause arbitration enforceable statute provides remedy damages plaintiff defendant appeal reversed remanded findings evidence record'.split(' ')
  let seed = 11
  const rnd = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
  const toks: string[] = []
  while (toks.join(' ').length < 119 * 1024) toks.push(W[Math.floor(rnd() * W.length)]! + (rnd() < 0.05 ? '.' : ''))
  const source = toks.join(' ')
  const nearMiss = (from: number, n: number, every: number) => toks.slice(from, from + n).map((w, k) => (k % every === every - 1 ? 'xyzzy' : w)).join(' ')

  it('on 300 random quotes (verbatim, near misses, fabrications), the span and the reason are what the old search gave', () => {
    const prepared = prepareSource(source)
    const text = normalizeMapped(source, 'legal').text
    for (let t = 0; t < 300; t++) {
      const from = Math.floor(rnd() * (toks.length - 80)), n = 3 + Math.floor(rnd() * 60), every = 2 + Math.floor(rnd() * 12)
      const q = t % 3 === 0 ? toks.slice(from, from + n).join(' ') : t % 3 === 1 ? nearMiss(from, n, every) : `xyzzy plugh ${toks[from]} frobozz`
      const r = matchQuote(prepared, q)
      if (r.reason === 'verbatim') { expect(text.includes(normalizeMapped(q, 'legal').text.trim())).toBe(true); continue }
      const old = oldLongestRun(text, normalizeMapped(q, 'legal').text.trim().match(/[^\s]+/g) ?? [])
      expect([t, r.reason]).toEqual([t, old.len >= 3 ? 'misquote_nearest' : 'not_located'])
      if (old.len >= 3) {
        const margin = Math.max(normalizeMapped(q, 'legal').text.trim().length, 40)
        let ws = Math.max(0, old.pos - margin), we = Math.min(text.length, old.pos + old.chars + margin)
        while (ws > 0 && text[ws - 1] !== ' ') ws--
        while (we < text.length && text[we] !== ' ') we++
        expect([t, r.nearest!.span]).toEqual([t, toOriginalSpan(normalizeMapped(source, 'legal'), ws, we)])
      }
    }
  })

  it('a 6,000-word near-miss quote against a 119 KB opinion, and 12 near-miss citations, finish in a bounded time', () => {
    const prepared = prepareSource(source)
    const t0 = performance.now()
    expect(matchQuote(prepared, nearMiss(100, 6000, 40)).reason).toBe('misquote_nearest')
    const one = performance.now() - t0
    const cites = Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, cite: '1 F.4th 1', quote: nearMiss(i * 1500, 300, 40) }))
    const t1 = performance.now()
    const v = verifyCitations(cites as never, { '1 F.4th 1': source } as never)
    const twelve = performance.now() - t1
    expect(v.claims.filter(c => c.outcome === 'PASS')).toEqual([]) // every quote is a near miss: none verbatim
    // measured on the development laptop: about 0.35 s and 0.2 s (before: the 6,000-word quote is quadratic, about 4 s;
    // 12 citations about 1.5 s). The bounds leave room for a slower machine.
    expect(one).toBeLessThan(2500)
    expect(twelve).toBeLessThan(2500)
  })
})

describe('3. a packed verdict: lossless, smaller', () => {
  const n = 1500
  const lines = Array.from({ length: n }, (_, i) => ({ description: `Item ${i} industrial fastener assortment`, quantity: 1 + (i % 7), unit_price: 10 + (i % 13), amount: (1 + (i % 7)) * (10 + (i % 13)) }))
  const sub = lines.reduce((s, l) => s + l.amount, 0)
  const inv = { invoice_number: 'INV-1', invoice_date: '2026-09-01', currency: 'USD', line_items: lines, subtotal: sub, tax: 0, total: sub }

  it('a 1,500-line invoice: the packed verdict is under half the verdict, gzip of it under the input, and it unpacks to the same bytes', () => {
    const input = JSON.stringify(inv).length
    const v = verify(inv, { now: NOW })
    const raw = JSON.stringify(v)
    const packed = JSON.stringify(packVerdict(v))
    expect(raw.length / input).toBeGreaterThan(20) // about 27x before
    expect(packed.length).toBeLessThan(raw.length / 2) // about 12x the input
    expect(gzipSync(packed).length).toBeLessThan(input)
    const back = unpackVerdict<typeof v>(JSON.parse(packed))
    expect(JSON.stringify(back)).toBe(raw)
    expect(back.verdict_id).toBe(v.verdict_id)
  })

  it('round-trips any JSON, control-character strings and undefined-free objects included; refuses a malformed pack', () => {
    const x = { a: '\u0001weird', b: ['\u0002x', '\u0003y', 'repeated value', 'repeated value'], c: { 'repeated value': [1, null, true] }, d: [{ k: 1 }, { k: 2 }], e: [] }
    expect(unpackVerdict(JSON.parse(JSON.stringify(packVerdict(x))))).toEqual(x)
    expect(() => unpackVerdict({ pack: 'riposte.verdict-pack/1', shapes: [], strings: [], verdict: '\u00019' })).toThrow(/out of range/)
    expect(() => unpackVerdict({ pack: 'other' })).toThrow(/not a packed verdict/)
  })

  it('over HTTP, "pack": true answers the packed verdict; unpacked, it is the unpacked answer', () => {
    const small = { invoice_number: 'I', line_items: lines.slice(0, 50), subtotal: lines.slice(0, 50).reduce((s, l) => s + l.amount, 0) }
    const plain = route({ method: 'POST', path: '/v1/verify', body: { extraction: small } }).json as { verdict_id: string; issued_at: string }
    const packed = route({ method: 'POST', path: '/v1/verify', body: { extraction: small, pack: true } }).json
    const back = unpackVerdict<typeof plain>(packed)
    expect(back.verdict_id).toBe(plain.verdict_id)
    expect({ ...back, issued_at: '' }).toEqual({ ...plain, issued_at: '' })
  })
})

describe('4. the inputs a verdict\'s hash binds: one exported builder', () => {
  const doc = { invoice_number: 'INV-9', line_items: [{ description: 'Widget', quantity: 2, unit_price: 5, amount: 10 }], subtotal: 10, tax: 0, total: 10 }
  const rs: DeclarativeRuleset = { id: 'foot', version: '1.0.0', fields: { TOTAL: { paths: ['total'] }, LINE: { paths: ['amount'], line: true } }, checks: [{ code: 'FOOT', left: 'TOTAL', op: '=', right: 'sum(LINE)', remedy: { kind: 'recompute-with', operand: { source: 'doc', path: 'total' }, detail: 'Total {asserted}.' } }], quotes: [{ id: 'title', quote: 'INVOICE' }] }
  const cases: [string, Parameters<typeof verify>[1]][] = [
    ['invoice, nothing else', {}],
    ['invoice, contract and evidence', { references: { contract: { financial_rules: [{ rule_name: 'Widget', values: { rate: 5 } }] }, evidence: [{ line_items: [{ description: 'Widget', quantity: 2 }] }] } }],
    ['invoice, junk references', { references: { contract: null as never, evidence: 'x' as never } }],
    ['invoice, source text', { source: { text: 'INVOICE INV-9 total 10' } }],
    ['invoice, tolerance override', { tolerance: { rel: 0.01, absCap: 0 } }],
    ['pay-app', { ruleset: 'pay-app' }],
    ['declarative', { ruleset: rs }],
    ['declarative, source text and tolerance', { ruleset: rs, source: { text: 'INVOICE INV-9' }, tolerance: { rel: 0.001, absCap: 0 } }],
  ]
  for (const [name, opts] of cases) {
    it(`${name}: verifyInputHash is the verdict's input_hash, and { verdict, inputs: verifyInputs } replays MATCH`, () => {
      const v = verify(doc, { ...opts, now: NOW })
      expect(verifyInputHash(doc, opts)).toBe(v.input_hash)
      const r = replayBundle({ verdict: v, inputs: verifyInputs(doc, opts) })
      expect([r.result, r.reason]).toEqual(['MATCH', undefined])
    })
  }
})

describe('5. span offsets are UTF-16 code units of the source text', () => {
  it('after non-ASCII and astral characters the offsets are JavaScript string indices, not bytes or code points', () => {
    const source = 'Café ☕ 😀 — The court held that the clause is enforceable.'
    const r = matchQuote(prepareSource(source), 'The court held that the clause is enforceable')
    expect(r.found).toBe(true)
    expect(r.span!.start).toBe(source.indexOf('The court'))
    expect(source.slice(r.span!.start, r.span!.end)).toBe('The court held that the clause is enforceable')
    expect(Buffer.byteLength(source.slice(0, r.span!.start), 'utf8')).not.toBe(r.span!.start) // a byte offset would differ
    expect([...source.slice(0, r.span!.start)].length).not.toBe(r.span!.start) // so would a code-point offset
  })
  it('the schema doc says so', () => {
    const doc = readFileSync(join(__dirname, '..', 'docs', 'VERDICT-SCHEMA-v0.md'), 'utf8')
    expect(doc).toContain('Span offsets are UTF-16 code units')
  })
})

describe('6. from the e-invoice PDF run: a declarative verdict issued with --source replays from the CLI; an unreadable operand\'s remedy names it', () => {
  const rs: DeclarativeRuleset = {
    id: 'mini-einvoice', version: '1.0.0',
    fields: { TOTAL: { paths: ['total'] }, NET: { paths: ['net'] }, ALLOWANCE: { paths: ['allowance_total_amount', 'allowance'], default: 0 }, LINE: { paths: ['amount'], line: true } },
    checks: [{ code: 'NET_INT', left: 'NET', op: '=', right: 'sum(LINE) - ALLOWANCE', field: 'net' }, { code: 'LINE_POS', scope: 'line', left: 'LINE', op: '>=', right: '0' }],
    quotes: [{ id: 'title', quote: 'Commercial invoice' }],
  }
  const doc = { net: 90, total: 90, allowance_total_amount: 10, line_items: [{ amount: 60 }, { amount: 40 }] }
  const text = 'Commercial invoice No. 7. Net 90.00'

  it('`verify replay --extraction --ruleset --source [--quotes]` re-performs it (it used to refuse --source for a declarative ruleset)', async () => {
    const { mkdtempSync, writeFileSync: wf } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { run } = await import('../src/cli')
    const dir = mkdtempSync(join(tmpdir(), 'r3c-replay-'))
    const p = (n: string) => join(dir, n)
    wf(p('doc.json'), JSON.stringify(doc)); wf(p('rs.json'), JSON.stringify(rs)); wf(p('src.txt'), text)
    wf(p('q.json'), JSON.stringify([{ id: 'net', quote: 'Net 90.00' }]))
    let out = ''
    const io = { out: (s: string) => { out += s }, err: () => {} }
    expect(run([p('doc.json'), '--ruleset', p('rs.json'), '--source', p('src.txt'), '--quotes', p('q.json')], io)).toBe(0)
    wf(p('verdict.json'), out)
    let rOut = '', rErr = ''
    const code = run(['replay', p('verdict.json'), '--extraction', p('doc.json'), '--ruleset', p('rs.json'), '--source', p('src.txt'), '--quotes', p('q.json')], { out: s => { rOut += s }, err: s => { rErr += s } })
    expect([code, JSON.parse(rOut).status]).toEqual([0, 'REPERFORMED'])
    // without the quotes it was issued with, the inputs are not the verdict's. Since 2026-10-04 the replay
    // names --quotes in one line before any hash is compared (exit 3, a usage error); it used to be exit 1, a failed binding
    rOut = ''
    let qErr = ''
    expect(run(['replay', p('verdict.json'), '--extraction', p('doc.json'), '--ruleset', p('rs.json'), '--source', p('src.txt')], { out: s => { rOut += s }, err: s => { qErr += s } })).toBe(3)
    expect(qErr).toBe('verify replay: this verdict was issued with page text, quotes and an external extraction under ruleset mini-einvoice@1.0.0: pass --extraction <file>, --ruleset <the file of mini-einvoice@1.0.0>, --source <file> and --quotes <file>; this call leaves out --quotes\n')
    expect(rOut).toBe('')
    // contract / evidence / history are still not part of a declarative verdict
    expect(run(['replay', p('verdict.json'), '--extraction', p('doc.json'), '--ruleset', p('rs.json'), '--contract', p('doc.json')], { out: () => {}, err: s => { rErr = s } })).toBe(3)
    expect(rErr).toContain('{ extraction, ruleset, source? } only')
  })

  it('an UNPARSEABLE operand\'s remedy names the operand and where it was read, not the check\'s field', () => {
    // Engine 0.0.1, the earlier wording for a ruleset without distinguish_unreadable (a change on 2026-10-03 made that reading the default
    // from engine 0.1.0: the remedy is then missing-operand with the value as reported; test/engine-defaults.test.ts)
    const v = verify({ ...doc, allowance_total_amount: 'UNREADABLE' }, { ruleset: rs, now: NOW, engine: '0.0.1' })
    const c = v.claims.find(x => x.claim_id === 'document.NET_INT')!
    expect(c.insufficiency).toMatchObject({ reason: 'UNPARSEABLE', missing: ['ALLOWANCE'] })
    const r = v.remedies!.find(x => x.claims.includes('document.NET_INT'))!
    expect(r.operand).toEqual({ source: 'mini-einvoice', role: 'ALLOWANCE', path: 'allowance_total_amount' })
    expect(r.detail.startsWith('re-read ALLOWANCE (allowance_total_amount) as a value the rule can compare')).toBe(true)
    // a line operand names its own line
    const l = verify({ ...doc, line_items: [{ amount: 60 }, { amount: 'n/a' }] }, { ruleset: rs, now: NOW, engine: '0.0.1' })
    expect(l.remedies!.find(x => x.claims.includes('line[1].LINE_POS'))!.operand).toEqual({ source: 'mini-einvoice', role: 'LINE', path: 'line_items[1].amount' })
  })
})

describe('7. from the playground: a declarative expression is compiled once and evaluated per line', () => {
  it('on 3,000 random expressions and environments the compiled evaluator gives exactly what the old one gave, errors included', async () => {
    const { evalExpr, evalExprUncompiled } = await import('../src/declarative/expr')
    let s = 5
    const r = (): number => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff }
    const atom = (): string => {
      const x = r()
      return x < 0.3 ? ['A', 'B', 'C', 'D?'][Math.floor(r() * 4)]! : x < 0.5 ? String(Math.floor(r() * 50) / (r() < 0.3 ? 4 : 1)) : x < 0.6 ? 'sum(L)' : x < 0.7 ? `abs(${atom()} - ${atom()})` : x < 0.8 ? `(${expr(2)})` : x < 0.9 ? `-${atom()}` : '0'
    }
    const expr = (n: number): string => Array.from({ length: 1 + Math.floor(r() * n) }, atom).reduce((a, b) => `${a} ${'+-*/'[Math.floor(r() * 4)]} ${b}`)
    const junk = ['A +', '(A', 'A )', 'sum(3)', 'abs?(A)', 'sum(X?)', 'foo(A)', 'A $ B', 'A B', '']
    for (let i = 0; i < 3000; i++) {
      const e = i < junk.length ? junk[i]! : expr(8)
      const vars: Record<string, number | undefined> = { A: r() < 0.9 ? Math.floor(r() * 100) : undefined, B: Math.floor(r() * 7) - 3, C: r() < 0.5 ? 0 : 2.5, D: r() < 0.5 ? undefined : 4 }
      const env = { vars, sum: (role: string) => (role === 'L' && r() < 0.9 ? 10 : undefined) }
      let a: unknown, b: unknown
      // sum() is pure in the engine; this test's sum is random, so each side gets the same fixed value
      const fixed = env.sum('L')
      const envFixed = { vars, sum: (role: string) => (role === 'L' ? fixed : undefined) }
      try { a = evalExprUncompiled(e, envFixed) } catch (x) { a = `throw ${(x as Error).message}` }
      try { b = evalExpr(e, envFixed) } catch (x) { b = `throw ${(x as Error).message}` }
      expect([e, Object.is(a, b) || (typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b))]).toEqual([e, true])
    }
  })

  it('the playground\'s heavy request shape (line checks with long expressions) evaluates in bounded time, and packs small', () => {
    const lines = 1000, checks = 5, terms = 300
    const rs = { id: 'heavy', version: '1', fields: { Q: { paths: ['q'], line: true, kind: 'quantity' as const }, P: { paths: ['p'], line: true }, A: { paths: ['a'], line: true } },
      checks: Array.from({ length: checks }, (_, i) => ({ code: `C${i}`, scope: 'line' as const, left: 'A', op: '=' as const, right: 'Q * P' + ' + Q - Q'.repeat(terms) })) }
    const doc = { line_items: Array.from({ length: lines }, () => ({ q: 2, p: 3, a: 6 })) }
    const t0 = performance.now()
    const v = verify(doc, { ruleset: rs, now: NOW })
    const ms = performance.now() - t0
    expect(v.coverage.claims_pass).toBe(lines * checks)
    // measured: about 0.4 s here (before: about 8 s for this shape); the playground's 2,000 x 10 x 500 went from 34 s to about 2 s
    expect(ms).toBeLessThan(4000)
    expect(JSON.stringify(packVerdict(v)).length).toBeLessThan(JSON.stringify(v).length / 5) // the repeated formula is stored once
  })
})
