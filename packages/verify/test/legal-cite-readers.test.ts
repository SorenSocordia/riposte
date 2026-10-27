/**
 * The citation's parts in one pass (2026-10-20). Seven regular expressions read the caller's citation text and were quadratic in a
 * long run of spaces, of open parentheses, or of commas before a line break: parseReporterCite's four (binding.ts: the closing
 * parenthetical, the pin after a comma, the pin after " at ", and volume, reporter and page), the party split of partiesOf
 * (binding.ts), and in index.ts the trim before a reporter citation in citeParts and the short form AT_FORM. A 64 KB cite or case
 * name took seconds through verifyCitations, and parseReporterCite reads every key a text is filed under once per citation of the
 * brief. The doors refuse citation text over 1,024 characters (test/legal-cite-bound.test.ts); the library's verifyCitations has no
 * bound, so it is what these tests time.
 *
 * Two things are tested. Time: each shape goes through verifyCitations and must answer within BOUND_MS, the median of RUNS runs; a
 * single run over HARD_MS fails at once. Identity: each reader returns what its pattern returned (the string it leaves, or every
 * group of the match and its position, or the parties) on every string in this package's legal fixtures and worked example, on
 * hand-written edge cases, and on seeded generated probes. The replaced patterns are kept below, verbatim, as the reference. No
 * verdict changes, so no rule version changes.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as binding from '../src/legal/binding'
import * as legal from '../src/legal/index'

const PACKAGE = join(dirname(fileURLToPath(import.meta.url)), '..')

// ── the replaced patterns (src/legal/binding.ts and index.ts before 2026-10-20), the reference for identity ──
const SHIPPED_PAREN = /\([^)]*\)\s*$/
const SHIPPED_COMMA = /,.*$/
const SHIPPED_AT_PIN = /\s+at\s+\d.*$/i
const SHIPPED_CORE = /^(\d+)\s+(.+?)\s+(\d+)$/
const SHIPPED_PARTIES = /\s+(?:v|vs)\.?\s+/i
const SHIPPED_SEPARATORS = /[\s,;]+$/u
const SHIPPED_AT_FORM = /^(?:[^\d,][^,]*,\s*)?(\d{1,4})\s+(.+?)\s+at\s+(\d{1,5})(?:\s*[-–]\s*\d{1,5})?(?:\s*(?:,|&|nn?\.)\s*\d{1,5})*\s*(?:\([^)]*\))?$/iu
function shippedParseReporterCite(cite: string): { volume: string; reporter: string[]; page: string } | undefined {
  const core = cite.replace(SHIPPED_PAREN, '').replace(SHIPPED_COMMA, '').replace(SHIPPED_AT_PIN, '').trim()
  const m = SHIPPED_CORE.exec(core)
  if (!m) return undefined
  const reporter = (m[2] as string).split(/[\s.]+/).filter(Boolean)
  if (reporter.length === 0 || !reporter.some(t => /\p{L}/u.test(t))) return undefined
  return { volume: m[1] as string, reporter, page: m[3] as string }
}
const shippedParties = (caseName: string): string[] => caseName.split(SHIPPED_PARTIES).map(s => s.trim()).filter(Boolean)

// ── the readers (looked up at call time, so a missing one fails its own test) ──
type Match = string[] & { index: number }
const R = {
  paren: (s: string): string => (binding as unknown as Record<string, (s: string) => string>).withoutClosingParenthetical!(s),
  comma: (s: string): string => (binding as unknown as Record<string, (s: string) => string>).withoutPinAfterComma!(s),
  atPin: (s: string): string => (binding as unknown as Record<string, (s: string) => string>).withoutPinAfterAt!(s),
  core: (s: string): Match | null => (binding as unknown as Record<string, (s: string) => Match | null>).volumeReporterPage!(s),
  separators: (s: string): string => (legal as unknown as Record<string, (s: string) => string>).withoutClosingSeparators!(s),
  atForm: (s: string): Match | null => (legal as unknown as Record<string, (s: string) => Match | null>).shortFormParts!(s),
}

// ── time ──
const BOUND_MS = 50
const RUNS = 10
const HARD_MS = 2000
function timed(fn: () => void): { median: number; runs: number[] } {
  const runs: number[] = []
  for (let i = 0; i < RUNS; i++) {
    const t = process.hrtime.bigint()
    fn()
    const ms = Number(process.hrtime.bigint() - t) / 1e6
    runs.push(ms)
    if (ms > HARD_MS || runs.filter(x => x > BOUND_MS).length > RUNS / 2) return { median: Number.POSITIVE_INFINITY, runs }
  }
  const s = [...runs].sort((a, b) => a - b)
  return { median: (s[RUNS / 2 - 1]! + s[RUNS / 2]!) / 2, runs }
}
const N = 16_384
const QUOTE = 'the words the brief quotes from the opinion'
const TEXT = readFileSync(join(PACKAGE, 'docs/examples/legal-opinions/makarova-201-F3d-110.txt'), 'utf8')
const SOURCES = { '201 F.3d 110': TEXT }
const spaced = `1 A${' '.repeat(N - 4)}x`

describe('the citation readers answer a long citation within the bound (verifyCitations, which has no length bound)', () => {
  const rows: { name: string; citations: legal.Citation[]; sources: legal.OpinionSources }[] = [
    { name: 'a cite of a volume, a capital, 16,384 spaces, a letter (the short form; " at " pin; volume, reporter and page)', citations: [{ id: 'c1', cite: spaced, quote: QUOTE }], sources: SOURCES },
    { name: 'a cite of 16,384 open parentheses (the closing parenthetical)', citations: [{ id: 'c1', cite: `${'('.repeat(N)}x`, quote: QUOTE }], sources: SOURCES },
    { name: 'a cite of 8,192 ", " before a reporter citation (the trim before it)', citations: [{ id: 'c1', cite: `${', '.repeat(N / 2)}x 1 U.S. 1`, quote: QUOTE }], sources: SOURCES },
    { name: 'a cite of a letter, 16,384 spaces, a letter (the " at " pin)', citations: [{ id: 'c1', cite: `x${' '.repeat(N)}x`, quote: QUOTE }], sources: SOURCES },
    { name: 'a cite of 16,384 commas and a line break (the pin after a comma)', citations: [{ id: 'c1', cite: `${','.repeat(N)}\nx`, quote: QUOTE }], sources: SOURCES },
    { name: 'a case name of a volume, a capital, 16,384 spaces, a letter (the party split)', citations: [{ id: 'c1', cite: '201 F.3d 110', case_name: spaced, quote: QUOTE }], sources: SOURCES },
    { name: 'a text keyed by a volume, a capital, 16,384 spaces, a letter, read for a cite with a pin', citations: [{ id: 'c1', cite: '201 F.3d 110, 113', quote: QUOTE }], sources: { ...SOURCES, [spaced]: TEXT } },
  ]
  for (const r of rows) {
    it(`${r.name}: median of ${RUNS} under ${BOUND_MS} ms`, () => {
      const t = timed(() => { legal.verifyCitations(r.citations, r.sources) })
      expect(t.median, `runs (ms): ${t.runs.map(x => x.toFixed(1)).join(', ')}`).toBeLessThan(BOUND_MS)
    }, 120_000)
  }
})

// ── identity ──
const same = (a: RegExpExecArray | Match | null, b: RegExpExecArray | Match | null): boolean =>
  a === null || b === null ? a === b : a.length === b.length && a.index === b.index && a.every((x, i) => x === b[i])
interface Tally { compared: number; matched: number; differing: string[] }
function compare(strings: Iterable<string>): Record<string, Tally> {
  const t: Record<string, Tally> = {}
  const tally = (k: string, ok: boolean, hit: boolean, s: string): void => {
    const x = (t[k] ??= { compared: 0, matched: 0, differing: [] })
    x.compared++
    if (hit) x.matched++
    if (!ok && x.differing.length < 5) x.differing.push(JSON.stringify(s.slice(0, 160)))
  }
  for (const s of strings) {
    for (const [k, mine, re] of [['paren', R.paren, SHIPPED_PAREN], ['comma', R.comma, SHIPPED_COMMA], ['atPin', R.atPin, SHIPPED_AT_PIN], ['separators', R.separators, SHIPPED_SEPARATORS]] as const) {
      const want = s.replace(re, '')
      tally(k, mine(s) === want, want !== s, s)
    }
    const c = s.trim()
    const wantCore = SHIPPED_CORE.exec(c)
    tally('core', same(R.core(c), wantCore), wantCore !== null, c)
    const wantForm = SHIPPED_AT_FORM.exec(s)
    tally('atForm', same(R.atForm(s), wantForm), wantForm !== null, s)
    const wantCite = shippedParseReporterCite(s)
    tally('parseReporterCite', JSON.stringify(binding.parseReporterCite(s)) === JSON.stringify(wantCite), wantCite !== undefined, s)
    const wantParties = shippedParties(s)
    tally('partiesOf', JSON.stringify(binding.partiesOf(s)) === JSON.stringify(wantParties), wantParties.length > 1, s)
  }
  return t
}
/** No reader differs from its pattern, and each pattern matched at least as often as measured on 2026-10-20 (the floors), so a probe set that stops reaching a pattern fails. */
function expectNone(t: Record<string, Tally>, floors: Record<string, number>): void {
  for (const [k, x] of Object.entries(t)) expect(x.differing, `${k}: ${x.compared} compared, ${x.matched} matched`).toEqual([])
  for (const [k, f] of Object.entries(floors)) expect(t[k]!.matched, `${k} matched`).toBeGreaterThanOrEqual(f)
}

/** Every string value and key in the legal fixtures' and worked example's JSON, every line of their texts; each also with its parentheticals read off. */
function fixtureStrings(): Set<string> {
  const out = new Set<string>()
  const add = (s: unknown): void => { if (typeof s === 'string' && s.length > 0 && s.length < 20_000) { out.add(s); out.add(s.replace(/\([^()]*\)/g, ' ')) } }
  const walk = (d: string): string[] => readdirSync(d).flatMap(n => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p] })
  const roots = [...readdirSync(join(PACKAGE, 'test/fixtures')).filter(n => n.startsWith('legal')).map(n => join(PACKAGE, 'test/fixtures', n)), join(PACKAGE, 'docs/examples')]
  for (const r of roots) {
    if (!existsSync(r)) continue
    for (const f of walk(r)) {
      const text = readFileSync(f, 'utf8')
      if (f.endsWith('.json')) {
        let v: unknown
        try { v = JSON.parse(text) } catch { continue }
        const stack = [v]
        while (stack.length) {
          const x = stack.pop()
          if (typeof x === 'string') add(x)
          else if (Array.isArray(x)) stack.push(...x)
          else if (x && typeof x === 'object') for (const [k, y] of Object.entries(x)) { add(k); stack.push(y) }
        }
      } else if (f.endsWith('.txt')) for (const l of text.split(/\r?\n/)) add(l)
    }
  }
  return out
}

/** Hand-written edge cases: the corners each reader turns on. */
const EDGES = [
  '', ' ', '1', '1 2', '1  2', '1   2', '1 x 2', '1 \n x 2', '1 x \n 2', '1 x  2', ' 1 U.S. 1 ', '477 U.S. 242, 248 (1986)', '477 U.S. 242 (1986) ', '477 U.S. 242 ( 1986 ) \n',
  '477 U.S. at 248', '477 U.S. AT 248', 'Anderson, 477 U.S. at 248', 'Anderson,477 U.S. at 248', 'Anderson, 477 U.S. at 248-49', 'Anderson, 477 U.S. at 248 – 49', 'Anderson, 477 U.S. at 248, 250 & 252 n.4',
  'Anderson, 477 U.S. at 248 nn. 4', 'Anderson, 477 U.S. at 248 Nn.4', 'Anderson, 477 U.S. at 248 (plurality)', 'Anderson, 477 U.S. at 248 (a) (b)', 'Anderson, 477 U.S. at 248 (a', 'Anderson, 477 U.S. at 123456',
  '12345 U.S. at 1', '1234 U.S. at 12345', '1 at 5', '1  at 5', '1   at 5', '1 U.S.\nat 5', '1 U.S. at\n5', '1 U.S. at 5\n', '1 U.S. at 5  ', ',1 U.S. at 5', ' 1 U.S. at 5', '(x), 1 U.S. at 5',
  '😀, 1 U.S. at 5', '\uD800, 1 U.S. at 5', '1 😀 at 5', '1 x at 5 at 6', '1 x at 5, at 6', '1 x at 5 (at 6)', 'x at 5', 'a, b, 1 x at 5',
  '201 F.3d 110, 113', '201 F.3d 110,\n113', '201 F.3d 110 at 113', '201 F.3d 110 AT 113 x', '201 F.3d 110 at 113\nx', 'a ,b\n,c', ',,,\n,x', '(a))', '(a) )', ')', '(', '()', '( ) ', 'x (y (z)', 'x (y) (z)',
  'A v. B', 'A v B', 'A vs. B', 'A VS B', 'A v.B', 'A v. B v. C', 'A  v.  B', 'A\nv.\nB', 'A v.. B', 'A vs.. B', 'v. B', 'A v. ', 'A vſ B', 'In re A', ' v. ', 'A  v.　B', 'A v. B, C v D',
  'x , ; ', 'x,;', 'x ,; \n', '; ;', '﻿1 U.S. 1﻿',
]

describe('each reader returns what its pattern returned', () => {
  it('on every string in the legal fixtures and the worked example, each also with its parentheticals read off', () => {
    const strings = fixtureStrings()
    expect(strings.size).toBeGreaterThan(1000)
    expectNone(compare(strings), { paren: 300, comma: 1100, atPin: 10, separators: 290, core: 190, atForm: 2, parseReporterCite: 290, partiesOf: 450 })
  }, 120_000)
  it('on hand-written edge cases', () => {
    expectNone(compare(EDGES), { paren: 10, comma: 24, atPin: 33, separators: 14, core: 24, atForm: 24, parseReporterCite: 15, partiesOf: 9 })
  })
  it('on 30,000 seeded generated probes shaped like citations, short forms and case names', () => {
    let x = 20261020
    const rnd = (): number => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296 }
    const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)] as T
    const TOK = ['1', '9', '12', '123', '1234', '12345', '123456', ' ', ' ', '  ', '\t', '\n', '\r', ' ', ' ', '　', '﻿', 'a', 'A', 't', 'T', 'at', 'AT', ' at ', 'n', 'N', 'n.', 'nn.',
      '.', ',', ', ', ';', '&', '-', '–', '—', '(', ')', 'x', 'U.S.', 'F.3d', 'S. Ct.', '😀', '\uD800', 'v', 'V', 'v.', 'vs', 'VS.', 'ſ', 'Inc.,']
    const WS = [' ', ' ', '  ', '\t', '\n', ' ', ' ', '']
    const DIG = (): string => String(Math.floor(rnd() * 10 ** (1 + Math.floor(rnd() * 6))))
    const soup = (k: number): string => { let s = ''; const m = Math.floor(rnd() * k); for (let i = 0; i < m; i++) s += pick(TOK); return s }
    const mutate = (s: string): string => { for (let i = Math.floor(rnd() * 3); i > 0; i--) { const at = Math.floor(rnd() * (s.length + 1)); s = rnd() < 0.5 ? s.slice(0, at) + pick(TOK) + s.slice(at) : s.slice(0, at) + s.slice(at + 1) } return s }
    const gens = [
      (): string => soup(24),
      (): string => {
        let s = rnd() < 0.5 ? `${pick(['Anderson', '(x)', 'a b', 'é'])}${pick([',', ', ', ',\n'])}${pick(WS)}` : ''
        s += `${DIG()}${pick(WS.slice(0, 7))}${soup(4) || 'U.S.'}${pick(WS.slice(0, 7))}${pick(['at', 'At', 'AT'])}${pick(WS.slice(0, 7))}${DIG()}`
        if (rnd() < 0.4) s += `${pick(WS)}${pick(['-', '–'])}${pick(WS)}${DIG()}`
        for (let i = Math.floor(rnd() * 3); i > 0; i--) s += `${pick(WS)}${pick([',', '&', 'n.', 'nn.', 'n'])}${pick(WS)}${DIG()}`
        if (rnd() < 0.4) s += `${pick(WS)}(${soup(4)}${rnd() < 0.8 ? ')' : ''}`
        return rnd() < 0.5 ? mutate(s) : s
      },
      (): string => {
        let s = `${DIG()}${pick(WS.slice(0, 7))}${soup(4) || 'F.3d'}${pick(WS.slice(0, 7))}${DIG()}`
        if (rnd() < 0.4) s += `${pick([',', ', '])}${DIG()}`
        if (rnd() < 0.3) s += `${pick(WS)}${pick(['at', 'AT'])}${pick(WS)}${DIG()}${rnd() < 0.3 ? soup(2) : ''}`
        if (rnd() < 0.4) s += `${pick(WS)}(${soup(4)}${rnd() < 0.85 ? ')' : ''}${pick(WS)}`
        return rnd() < 0.5 ? mutate(s) : s
      },
      (): string => { let s = pick(['A', 'Anderson', 'In re A', 'x']); for (let i = 1 + Math.floor(rnd() * 2); i > 0; i--) s += `${pick(WS)}${pick(['v', 'V', 'vs', 'v.', 'vs.', 'v..', 'vx'])}${pick([...WS, '.'])}${pick(['B', 'Liberty Lobby, Inc.', 'v', 'ſ'])}`; return rnd() < 0.4 ? mutate(s) : s },
    ]
    const probes: string[] = []
    for (let i = 0; i < 30_000; i++) probes.push(gens[i % gens.length]!())
    expectNone(compare(probes), { paren: 4600, comma: 8552, atPin: 4810, separators: 4953, core: 3348, atForm: 2636, parseReporterCite: 4203, partiesOf: 5493 })
  }, 120_000)
})
