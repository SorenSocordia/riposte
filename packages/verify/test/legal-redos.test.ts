/**
 * The citation reader on a long citation (2026-10-20). legal@0.5.0 and later read the reporter citations off the citation as
 * written (citeParts), and legal@0.5.4 reads database numbers too. Both were regular expressions whose loop over capitalised words
 * let a run of capitals split every way: about 0.1 s at 22 capitals, doubling with each one more, and the database pattern polynomial
 * in a run of capitals after a four-digit year. A citation is the caller's text (the citations command, `POST
 * /v1/verify/citations`, the MCP tool `verify_citations`), so one short citation could hold a worker, or the whole MCP process, for
 * minutes or hours. The readers that replace them (reporterCitesIn, databaseCitesIn) read in one pass.
 *
 * Two things are tested. Time: each probe goes through verifyCitations, the call every door makes, and must answer within BOUND_MS,
 * the median of RUNS runs; a single run over HARD_MS fails the probe at once. Identity: the readers return what the replaced
 * patterns returned (every match, its position, its text and its three groups) on every citation in this package's legal fixtures and
 * worked example, on hand-written edge cases, and on seeded generated probes. The replaced patterns are kept below, verbatim, as the
 * reference. No verdict changes, so no rule version changes.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { databaseCitesIn, reporterCitesIn, verifyCitations } from '../src/legal/index'

const PACKAGE = join(dirname(fileURLToPath(import.meta.url)), '..')

// ── the replaced patterns (src/legal/index.ts before 2026-10-20), the reference for identity ──
const SHIPPED_REPORTER = /(?<![\p{L}\p{N}])(\d{1,4})\s+((?:[A-Z][\p{L}\p{N}.'’]*|\d{1,2}(?:d|st|nd|rd|th)\.?)(?:\s*(?:[A-Z][\p{L}\p{N}.'’]*|\d{1,2}(?:d|st|nd|rd|th)\b\.?))*)\s+(\d{1,5})(?![\p{N}])/gu
const SHIPPED_DATABASE = /(?<![\p{L}\p{N}])(\d{4})\s+(WL|(?:[A-Z][\p{L}.]*\s?){0,4}LEXIS)\s+(\d{1,8})(?![\p{N}])/gu

// ── time ──
const BOUND_MS = 50
const RUNS = 10
const HARD_MS = 2000

/** The median of RUNS timed calls; stops early (median over the bound) after a run over HARD_MS or once most runs are over BOUND_MS. */
function timed(fn: () => void, bound = BOUND_MS): { median: number; runs: number[] } {
  const runs: number[] = []
  for (let i = 0; i < RUNS; i++) {
    const t = process.hrtime.bigint()
    fn()
    const ms = Number(process.hrtime.bigint() - t) / 1e6
    runs.push(ms)
    if (ms > Math.max(HARD_MS, bound * 2) || runs.filter(x => x > bound).length > RUNS / 2) return { median: Number.POSITIVE_INFINITY, runs }
  }
  const s = [...runs].sort((a, b) => a - b)
  return { median: (s[RUNS / 2 - 1]! + s[RUNS / 2]!) / 2, runs }
}

const brief = (cite: string) => [{ id: 'c1', cite, quote: 'the words the brief quotes from the opinion' }]

describe('the citation reader answers a long citation within the bound', () => {
  // the probe of the pattern finding (2026-10-19): a volume, a run of capitals, no page
  for (const n of [16, 20, 24, 28]) {
    it(`a volume and ${n} capitals with no page after them: median of ${RUNS} under ${BOUND_MS} ms`, () => {
      const r = timed(() => { verifyCitations(brief(`1 ${'A'.repeat(n)} x`)) })
      expect(r.median, `runs (ms): ${r.runs.map(x => x.toFixed(1)).join(', ')}`).toBeLessThan(BOUND_MS)
    }, 120_000)
  }
  // the database pattern (legal@0.5.4, the default): a year, a run of capitals, a number, no LEXIS
  for (const n of [32, 64, 128, 256]) {
    it(`a year and ${n} capitals before a number, with no database named: median of ${RUNS} under ${BOUND_MS} ms`, () => {
      const r = timed(() => { verifyCitations(brief(`2024 ${'A'.repeat(n)} 5`)) })
      expect(r.median, `runs (ms): ${r.runs.map(x => x.toFixed(1)).join(', ')}`).toBeLessThan(BOUND_MS)
    }, 120_000)
  }
  // the reporter pattern again: a chain of short words, each holding a number another volume could start at
  for (const n of [1024, 4096, 16384]) {
    // the bound grows with the input: 64 KB of words took 16 ms here and over 50 ms on the Linux lane's loaded WSL (2026-10-20 run 8); the old
    // pattern took 10 s on the same input, so n / 16 ms (1,024 ms at 16,384 words) still shows the reading is linear, not the machine fast
    const bound = Math.max(BOUND_MS, n / 16)
    it(`${n} words of the form "A.1" after a volume: median of ${RUNS} under ${bound} ms`, () => {
      const r = timed(() => { verifyCitations(brief(`1 ${'A.1 '.repeat(n)}x`)) }, bound)
      expect(r.median, `runs (ms): ${r.runs.map(x => x.toFixed(1)).join(', ')}`).toBeLessThan(bound)
    }, 120_000)
  }
})

// ── identity ──
type Row = [number, string, string, string, string]
const viaShipped = (re: RegExp, s: string): Row[] => [...s.matchAll(re)].map(m => [m.index, m[0], m[1] as string, m[2] as string, m[3] as string])
const viaReader = (f: (s: string) => readonly (readonly string[] & { index: number })[], s: string): Row[] => f(s).map(m => [m.index, m[0] as string, m[1] as string, m[2] as string, m[3] as string])

/** Compares both readers with both patterns on every probe; returns the counts and the first differences. */
function compare(probes: readonly string[]): { probes: number; reporter: number; database: number; groups: number; differing: { which: string; probe: string; shipped: Row[]; reader: Row[] }[] } {
  let reporter = 0
  let database = 0
  const differing: { which: string; probe: string; shipped: Row[]; reader: Row[] }[] = []
  for (const p of probes) {
    for (const [which, re, f] of [['reporter', SHIPPED_REPORTER, reporterCitesIn], ['database', SHIPPED_DATABASE, databaseCitesIn]] as const) {
      const a = viaShipped(re, p)
      const b = viaReader(f, p)
      if (which === 'reporter') reporter += a.length
      else database += a.length
      if (JSON.stringify(a) !== JSON.stringify(b) && differing.length < 5) differing.push({ which, probe: p, shipped: a, reader: b })
    }
  }
  return { probes: probes.length, reporter, database, groups: 3 * (reporter + database), differing }
}

/** Every `cite` string in a JSON value. */
function citesIn(v: unknown, out: string[]): string[] {
  if (Array.isArray(v)) v.forEach(x => citesIn(x, out))
  else if (v !== null && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (k === 'cite' && typeof x === 'string') out.push(x); else citesIn(x, out) }
  return out
}

function fixtureCites(): string[] {
  const files: string[] = []
  const walk = (d: string): void => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.json')) files.push(p) } }
  const fixtures = join(PACKAGE, 'test', 'fixtures')
  for (const e of readdirSync(fixtures, { withFileTypes: true })) if (e.isDirectory() && e.name.startsWith('legal')) walk(join(fixtures, e.name))
  const example = join(PACKAGE, 'docs', 'examples', 'legal-citations.json')
  if (existsSync(example)) files.push(example)
  const cites: string[] = []
  for (const f of files) {
    let v: unknown
    try { v = JSON.parse(readFileSync(f, 'utf8')) } catch { continue }
    citesIn(v, cites)
  }
  // each as written, and as the reader is handed it (parentheticals read off)
  return [...new Set(cites.flatMap(c => [c, c.replace(/\([^()]*\)/g, ' ')]))]
}

const EDGES = [
  '477 U.S. 242', '477 U.S. 242, 248 (1986)', 'Anderson v. Liberty Lobby, Inc., 477 U.S. 242, 248', '912 F.3d 455, 458', '5 U.S. 137',
  '1 F 2d 3', '1 F 2d', '1 F 2d 3d', '1 A.12 B 3', '1 2d 3', '1 2d3d 4', '1 2d.X 4', '1 2d. 4', '1 F 2dx 4', '1 F 2d_ 4', '1 F 2d’ 4',
  '1 F 234d 5', '12345 F 6', '1 F 123456', '1 F 12a', '1 F 12.5', '1 F 12²', '1 F 12٣', '1 F 12\u{1D7CE}', 'a1 F 2', '\u{1D400}1 F 2',
  '\u{1D7CE}1 F 2', '\uD8001 F 2', '٣1 F 2', '.1 F 2', '1 F 2', '1﻿F﻿2', '1\tF\n2', '1 F  ,  2', '1 F, 2', '1 F . 2',
  '1 é 2', '1 Éé 2', '1 F é 2', '1 F É 2', '1 F’s 2', "1 F'x 2", '1 A B C D E F G 9', '1 A B c D 9', '1 A 2 B 3', '1 A 2 B 3 C 4',
  '2024 WL 1188234', '2024 U.S. Dist. LEXIS 48213', '2024 LEXIS 5', '2024 WLEXIS 5', '2024 LEXIS LEXIS 5', '2024 A B C D LEXIS 5',
  '2024 A B C D E LEXIS 5', '2024 A  B LEXIS 5', '2024 U.S.LEXIS 5', '2024 foo LEXIS 5', '2024 Wl 5', '2024 WL 123456789', '2024 WL 12٣',
  '20245 WL 5', '202 WL 5', 'x2024 WL 5', '2024 WL5', '2024 LEXIS 5', '2024 Ω LEXIS 5', '2024 U.S. App. LEXIS 1, at *3',
  'Calloway Precision, Inc. v. Northgate Components Corp., 2025 WL 1188234, at *3', '2025 WL 1188234 477 U.S. 242',
]

/** Seeded probes in the style of the pattern census: pieces of citations, spacing, punctuation and letters outside ASCII. */
function generated(count: number, seed: number): string[] {
  let s = seed >>> 0
  const rnd = (): number => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)] as T
  const pieces = [
    ['1', '9', '12', '477', '1234', '2024', '12345', '123456789'],
    ['A', 'F', 'U.S.', 'U. S.', 'S.', 'Ct.', 'L.', 'Ed.', 'Cal.', 'App.', 'WL', 'LEXIS', 'Dist.', "Int'l", 'Ass’n'],
    ['2d', '3d', '4th', '1st', '2nd', '3rd', '2d.', 'd', 'st', '123d', '2dx', '2d_'],
    ['x', 'v.', 'at', 'n.', 'foo', 'supra'],
    ['.', ',', ';', "'", '’', '(', ')', '-', '_', '&', '*', ':'],
    [' ', ' ', ' ', '  ', '\t', '\n', ' ', ' ', '　', '﻿'],
    [' ', ' ', ' '],
    ['é', 'É', '٣', '²', '½', '\u{1D400}', '\u{1D7CE}', '\uD800', '\uDC00', 'ß', 'Ω'],
  ]
  const space = (): string => (rnd() < 0.8 ? ' ' : pick(pieces[5] as string[]))
  const word = (): string => pick((rnd() < 0.6 ? pieces[1] : rnd() < 0.6 ? pieces[2] : rnd() < 0.5 ? pieces[3] : pieces[7]) as string[])
  // shaped like a citation: something before, a volume or year, one to four words, a page or number, something after
  const shaped = (): string => {
    let w = rnd() < 0.3 ? pick(['WL', 'LEXIS', 'U.S. Dist. LEXIS', 'App. LEXIS']) : word()
    const k = Math.floor(rnd() * 4)
    for (let i = 0; i < k; i++) w += (rnd() < 0.75 ? space() : '') + word()
    const before = rnd() < 0.3 ? pick(['Anderson v. Liberty Lobby, Inc., ', '(', 'x', 'a.', '\u{1D400}', '٣', 'See ']) : ''
    const after = rnd() < 0.5 ? pick([',', ', 248', ' (1986)', 'a', '٣', '²', '\u{1D7CE}', '.', ' n.4', ' at 5', '_', ', at *3']) : ''
    return before + pick(pieces[0] as string[]) + space() + w + space() + pick(pieces[0] as string[]) + after + (rnd() < 0.3 ? space() + shaped() : '')
  }
  const out: string[] = []
  while (out.length < count) {
    let p = ''
    if (out.length % 2 === 0) p = shaped()
    else {
      const n = 1 + Math.floor(rnd() * 24)
      for (let i = 0; i < n; i++) p += pick(pick(pieces))
    }
    if ((p.match(/[A-Z]/g) ?? []).length <= 14) out.push(p) // the replaced pattern must finish
  }
  return out
}

describe('the readers return what the replaced patterns returned', () => {
  it('every citation in the legal fixtures and the worked example, as written and with its parentheticals read off', () => {
    const r = compare(fixtureCites())
    expect(r.differing).toEqual([])
    // 2026-10-20: 219 strings, 211 reporter citations, 8 database numbers
    expect(r.probes).toBeGreaterThanOrEqual(200)
    expect(r.reporter).toBeGreaterThanOrEqual(200)
    expect(r.database).toBeGreaterThanOrEqual(5)
  })
  it('hand-written edge cases: ordinals, word boundaries, page lookahead, spacing, letters and numbers outside ASCII', () => {
    const r = compare(EDGES)
    expect(r.differing).toEqual([])
    // 2026-10-20: 68 strings, 43 reporter citations, 11 database numbers
    expect(r.reporter).toBeGreaterThanOrEqual(40)
    expect(r.database).toBeGreaterThanOrEqual(10)
  })
  it('30,000 seeded generated probes', () => {
    const r = compare(generated(30_000, 20261020))
    expect(r.differing).toEqual([])
    // 2026-10-20: 7,210 reporter citations, 465 database numbers
    expect(r.reporter).toBeGreaterThanOrEqual(7000)
    expect(r.database).toBeGreaterThanOrEqual(400)
  })
})
