/**
 * The extraction contract for the legal citation check (2026-10-03): a quotation read off the page twice.
 *
 * Which passage is the citation's quotation is given by a POINTER (the words a reviewer or an upstream tool marked); the
 * value is what the page prints there, as each reader reads it. Each reader's words are aligned to the pointer by a
 * semi-global token alignment over canonical tokens: every pointer token is aligned, the page window is free; a match costs
 * 0, a substitution 1, a skipped token 1, except that a skipped page token that is a 1–3 digit number, or sits in the top or
 * bottom 7% of its page, costs 0 (a line number, a footnote call, a running header or footer). The first reader (the text
 * layer) LOCATES the quotation when the cost is at most max(2, 10% of the pointer's tokens) and under half of them (a short
 * pointer must match on most of its words); its reading is the window's
 * tokens without the skipped artifacts, the first and last trimmed to the pointer's token when they contain it (the quote
 * marks around a quotation). OCR then reads the window's page(s) and is aligned to the first reading the same way. The two
 * agree when their canonical tokens are identical; then the value is the first reading. Otherwise the quotation is
 * UNREADABLE, with both readings: the legal check is never handed a guess.
 *
 * Opinion texts (the reference) are not fields: they are canonicalized (./canonical.ts) and recorded with their reader and
 * sha256, not read twice.
 */

import { createHash } from 'node:crypto'
import type { Citation, OpinionSources } from '../legal/index.js'
import { canonicalLines, canonicalText } from './canonical.js'
import { CONTRACT_VERSION, UNREADABLE, type ContractField, type NotPrinted, type Provenance, type Reading } from './contract.js'
import { toRows, type PageRead } from './readers.js'

/** One canonical token of a page, with where it is printed and whether skipping it is free. */
export interface PageToken { t: string; page: number; line: number; artifact: boolean; /** the word(s) as the reader printed them */ o: string }

const SHY = String.fromCharCode(0x00ad)
const QUOTE_MARKS = /^["'(\[]+|["')\],;:.]+$/g
const strip = (t: string): string => t.replace(QUOTE_MARKS, '')
const looseEq = (p: string, t: string): boolean => p === t || (strip(p) !== '' && strip(p) === strip(t))

/**
 * A reader's pages as canonical tokens in reading order, artifacts flagged. A soft hyphen ending a word joins it to the next
 * word; a hyphen ending a row's text after a letter joins the next row's first word when it starts with a lower-case letter
 * (./canonical.ts's rule). Both joins look past artifacts between the two halves: a running header or footer (the top or
 * bottom 7% of a page) and a pleading line number (a 1–3 digit number heading its row), which are dropped.
 */
export function pageTokens(pages: readonly PageRead[]): PageToken[] {
  const raw: { t: string; page: number; line: number; row: number; i: number; zone: boolean }[] = []
  let row = 0
  for (const p of pages) {
    for (const r of toRows(p)) {
      r.words.forEach((w, i) => raw.push({ t: w.t, page: p.page, line: r.line, row, i, zone: w.yTop < 0.07 * p.height || w.yBot > 0.93 * p.height }))
      row++
    }
  }
  const skippable = (k: number): boolean => raw[k]!.zone || (raw[k]!.i === 0 && /^\d{1,3}$/.test(raw[k]!.t))
  const nextContent = (k: number): number => { for (let x = k + 1; x < raw.length; x++) if (!skippable(x)) return x; return -1 }
  const lastInRow = (k: number): boolean => { for (let x = k + 1; x < raw.length && raw[x]!.row === raw[k]!.row; x++) if (!skippable(x)) return false; return true }
  const firstInRow = (k: number): boolean => { for (let x = k - 1; x >= 0 && raw[x]!.row === raw[k]!.row; x--) if (!skippable(x)) return false; return true }
  const out: PageToken[] = []
  for (let i = 0; i < raw.length; i++) {
    const w = raw[i]!
    let t = w.t
    let j = i
    const parts = [w.t]
    for (;;) {
      const nx = nextContent(j)
      if (nx < 0) break
      if (t.endsWith(SHY)) { t = t.slice(0, -1) + raw[nx]!.t; parts.push(raw[nx]!.t); j = nx; continue }
      const folded = canonicalText(t)
      if (raw[nx]!.row !== raw[j]!.row && lastInRow(j) && firstInRow(nx) && /\p{L}-$/u.test(folded) && /^\p{Ll}/u.test(canonicalText(raw[nx]!.t))) {
        t = folded.slice(0, -1) + raw[nx]!.t; parts.push(raw[nx]!.t); j = nx; continue
      }
      break
    }
    const c = canonicalText(t.split(SHY).join(''))
    if (c !== '') for (const part of c.split(' ')) out.push({ t: part, page: w.page, line: w.line, artifact: (j === i && /^\d{1,3}$/.test(part)) || w.zone, o: parts.join(' ') })
    i = j
  }
  return out
}

export interface Alignment { start: number; end: number; cost: number; reading: string[]; skipped: number; /** the window's words as printed (artifacts left out), joined by single spaces */ raw: string }

/**
 * Align `pointer` (canonical tokens) to `tokens`: every pointer token aligned, the window free. Returns the cheapest window
 * (the earliest on a tie) and its reading, or undefined when there is nothing to align.
 */
export function alignPointer(pointer: readonly string[], tokens: readonly PageToken[]): Alignment | undefined {
  const m = pointer.length, n = tokens.length
  if (m === 0 || n === 0) return undefined
  const W = n + 1
  const D = new Float64Array((m + 1) * W)
  const B = new Uint8Array((m + 1) * W) // 1 diag, 2 up (pointer gap), 3 left (page gap)
  for (let i = 1; i <= m; i++) {
    D[i * W] = i; B[i * W] = 2
    for (let j = 1; j <= n; j++) {
      const tok = tokens[j - 1]!
      const diag = D[(i - 1) * W + j - 1]! + (looseEq(pointer[i - 1]!, tok.t) ? 0 : 1)
      const up = D[(i - 1) * W + j]! + 1
      const left = D[i * W + j - 1]! + (tok.artifact ? 0 : 1)
      let best = diag, b = 1
      if (up < best) { best = up; b = 2 }
      if (left < best) { best = left; b = 3 }
      D[i * W + j] = best; B[i * W + j] = b
    }
  }
  let bestJ = 1
  for (let j = 1; j <= n; j++) if (D[m * W + j]! < D[m * W + bestJ]!) bestJ = j
  // trace back: the window is from the first diagonal page token to bestJ
  const used: number[] = []
  let i = m, j = bestJ, skipped = 0
  while (i > 0) {
    const b = B[i * W + j]
    if (b === 1) { used.push(j - 1); i--; j-- } else if (b === 2) { i-- } else { if (!tokens[j - 1]!.artifact) used.push(j - 1); else skipped++; j-- }
  }
  used.reverse()
  if (used.length === 0) return { start: bestJ - 1, end: bestJ - 1, cost: D[m * W + bestJ]!, reading: [], skipped, raw: '' }
  const reading = used.map(k => tokens[k]!.t)
  const raw = used.filter((k, x) => x === 0 || tokens[k]!.o !== tokens[used[x - 1]!]!.o || k !== used[x - 1]! + 1).map(k => tokens[k]!.o).join(' ')
  // trim the edge tokens to the pointer's when they contain it (the quotation's own marks)
  const first = pointer[0]!, last = pointer[m - 1]!
  if (reading[0] !== first && reading[0]!.includes(first)) reading[0] = first
  const L = reading.length - 1
  if (reading[L] !== last && reading[L]!.includes(last)) reading[L] = last
  return { start: used[0]!, end: used[used.length - 1]!, cost: D[m * W + bestJ]!, reading, skipped, raw }
}

/**
 * The most a located window may cost: max(2, 10% of the pointer's tokens), and always less than half the pointer's tokens,
 * so a short pointer is never "located" on words it does not share (a 2-word pointer must match exactly).
 */
export const locatedWithin = (pointerTokens: number): number => Math.min(Math.max(2, Math.floor(0.1 * pointerTokens)), Math.ceil(pointerTokens / 2) - 1)

export interface QuotationRead {
  field: ContractField
  /** the first reader's reading, located or not */
  located: boolean
  agree: boolean
  costs: { reader1?: number; reader2?: number }
  pages: number[]
}

/**
 * Read the quotation a pointer marks: the text layer locates and reads it; OCR (one page reading per page, supplied by the
 * caller, who may cache them) reads it again. A page with fewer than `minTextWords` text-layer words is not read here (the
 * quotation reader needs a text layer): the quotation is UNREADABLE with that note.
 */
export async function readQuotationTwice(pointer: string, textLayer: readonly PageRead[], ocr: (page: number) => Promise<PageRead> | PageRead, names: [string, string], minTextWords = 20): Promise<QuotationRead> {
  const ptr = canonicalText(pointer).split(' ').filter(Boolean)
  const tl = pageTokens(textLayer)
  const a = alignPointer(ptr, tl)
  const lim = locatedWithin(ptr.length)
  const unreadable = (prov: Provenance, located: boolean, costs: QuotationRead['costs'], pages: number[]): QuotationRead =>
    ({ field: { value: UNREADABLE, provenance: prov }, located, agree: false, costs, pages })
  if (!a || a.cost > lim || a.reading.length === 0) {
    const at = a && a.reading.length ? tl[a.start]! : undefined
    const r1: Reading = { reader: names[0], raw: a && a.reading.length ? a.raw : null, ...(at ? { page: at.page, line: at.line } : {}), note: `not located: the closest window costs ${a?.cost ?? 'n/a'} (at most ${lim} allowed)` }
    return unreadable({ page: at?.page ?? 1, line: at?.line ?? 1, raw: r1.raw ?? '', reader: `${names[0]}+${names[1]}`, readings: [r1, { reader: names[1], raw: null, note: 'not read: the first reader did not locate the quotation' }] }, false, { reader1: a?.cost ?? Infinity }, at ? [at.page] : [])
  }
  const startTok = tl[a.start]!, endTok = tl[a.end]!
  const pages = [...new Set(tl.slice(a.start, a.end + 1).map(t => t.page))]
  const value = a.reading.join(' ')
  const r1: Reading = { reader: names[0], raw: a.raw, page: startTok.page, line: startTok.line }
  const prov = { page: startTok.page, line: startTok.line, raw: a.raw, reader: `${names[0]}+${names[1]}` }
  const scant = pages.filter(p => (textLayer.find(x => x.page === p)?.words.length ?? 0) < minTextWords)
  if (scant.length) return unreadable({ ...prov, readings: [r1, { reader: names[1], raw: null, note: `page ${scant.join(', ')} has no text layer to speak of: this reader needs one` }] }, true, { reader1: a.cost }, pages)
  const ocrPages: PageRead[] = []
  for (const p of pages) ocrPages.push(await ocr(p))
  const ot = pageTokens(ocrPages)
  const b = alignPointer(a.reading, ot)
  const lim2 = locatedWithin(a.reading.length)
  const r2: Reading = b && b.reading.length ? { reader: names[1], raw: b.raw, page: ot[b.start]!.page, line: ot[b.start]!.line } : { reader: names[1], raw: null, note: 'nothing to align' }
  const agree = !!b && b.cost <= lim2 && b.reading.length === a.reading.length && b.reading.every((t, k) => t === a.reading[k])
  if (!agree) {
    const note = !b ? 'nothing to align' : b.cost > lim2 ? `not located (cost ${b.cost}, at most ${lim2})` : 'reads differently'
    return unreadable({ ...prov, readings: [r1, { ...r2, note }] }, true, { reader1: a.cost, ...(b ? { reader2: b.cost } : {}) }, pages)
  }
  void endTok
  return { field: { value, provenance: { ...prov, readings: [r1, r2] } }, located: true, agree: true, costs: { reader1: a.cost, reader2: b!.cost }, pages }
}

// ── the legal envelope and its lowering ───────────────────────────────────────────────────────────────────────────────

export interface LegalContractCitation {
  id: string
  fields: Record<string, ContractField>
  not_printed?: Record<string, NotPrinted>
}
export interface LegalContractEnvelope {
  extraction_contract: typeof CONTRACT_VERSION
  ruleset: string
  document?: Record<string, unknown>
  citations: LegalContractCitation[]
  sources?: Record<string, { text: string; provenance: { reader: string; sha256: string; raw_sha256?: string; pages?: number; canonicalized?: boolean; source?: string } }>
}

const sha = (s: string): string => createHash('sha256').update(s).digest('hex')

/** A reference text under the contract: canonicalized line by line, with its reader and both hashes. */
export function contractSource(rawText: string, reader: string, source?: string): { text: string; provenance: { reader: string; sha256: string; raw_sha256: string; canonicalized: true; source?: string } } {
  const text = canonicalLines(rawText)
  return { text, provenance: { reader, sha256: sha(text), raw_sha256: sha(rawText), canonicalized: true, ...(source !== undefined ? { source } : {}) } }
}

/**
 * The citations and opinion texts the legal check reads, from a legal envelope. A citation whose quotation (or
 * proposition) is UNREADABLE is WITHHELD, with its readings: the check is never handed a guess, and the caller records the
 * citation as an abstention of the contract.
 */
export function contractToCitations(env: LegalContractEnvelope): { citations: Citation[]; sources: OpinionSources; withheld: { id: string; field: string; readings: Reading[] }[] } {
  const citations: Citation[] = []
  const withheld: { id: string; field: string; readings: Reading[] }[] = []
  for (const c of env.citations) {
    const v = (k: string): string | undefined => { const f = c.fields[k]; return f && typeof f.value === 'string' && f.value !== UNREADABLE ? f.value : undefined }
    const bad = ['quote', 'proposition'].find(k => c.fields[k]?.value === UNREADABLE)
    if (bad) { withheld.push({ id: c.id, field: bad, readings: (c.fields[bad]!.provenance as Provenance).readings ?? [] }); continue }
    const cit: Citation = { id: c.id }
    for (const k of ['cite', 'case_name', 'source_key', 'quote', 'proposition'] as const) { const x = v(k); if (x !== undefined) cit[k] = x }
    citations.push(cit)
  }
  const sources: OpinionSources = {}
  for (const [k, s] of Object.entries(env.sources ?? {})) sources[k] = s.text
  return { citations, sources, withheld }
}
