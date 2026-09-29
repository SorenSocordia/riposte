/**
 * Cell provenance: an agent that reads a table says WHERE each number came from (table, row, column), and we check that
 * the cited cell holds that number. This catches misreads, dropped signs, a missed "$ in Thousands", and the wrong
 * column (with a period check). It cannot catch a real cell of the wrong concept (e.g. equity including noncontrolling
 * interests instead of the parent's). That is what the footing identities are for.
 *
 * The source is a plain-text table document:
 *
 *   TABLE: CONSOLIDATED BALANCE SHEETS - USD ($) $ in Thousands
 *   COLUMNS: Dec. 31, 2025 | Dec. 31, 2024
 *   Total assets | 8,975,275 | 9,012,114
 *   ...
 *
 * Tables are separated by a blank line. A title's `$ in Thousands` / `$ in Millions` / `$ in Billions` sets the scale of
 * its dollar cells. Parentheses mean negative.
 *
 * Every claim is a ClaimVerdict with a span locator into the document, so it replays like any other verdict:
 *   CELL_VALUE   the cited cell × scale equals the asserted value (tolerance 0.5 by default)
 *   CELL_PERIOD  the cited column names a date within `periodToleranceDays` of `periodEnd` (only when periodEnd is given)
 * A citation that points at nothing (no such table, row or column, or a non-numeric cell) ABSTAINS by default, because
 * absence proves nothing when the caller may have supplied the wrong document. With `strict: true` (the caller supplied
 * exactly the document the agent read), it FAILs.
 */

import { sha256 } from '../verdict/canonical.js'
import type { ClaimVerdict, Evidence } from '../verdict/schema.js'

export interface TextTableRow {
  label: string
  cells: string[]
  /** 1-based line number in the document */
  line: number
  /** character span of each cell in the document */
  cellSpans: { start: number; end: number }[]
}

export interface TextTable {
  title: string
  /** 1, 1e3, 1e6 or 1e9: from the title ("$ in Thousands", "(Amounts in thousands)"), else from the column headers */
  scale: number
  columns: string[]
  rows: TextTableRow[]
}

export interface CellCitation {
  id: string
  field: string
  value: number
  table: string
  row: string
  column: string
}

export interface CellCitationOptions {
  /** fiscal period end, YYYY-MM-DD; enables CELL_PERIOD */
  periodEnd?: string
  /** default 7 (52/53-week fiscal years end within a week of the nominal date) */
  periodToleranceDays?: number
  /** FAIL (instead of abstain) when a citation points at nothing; for when the document is exactly what the agent read */
  strict?: boolean
  /** absolute tolerance on the value, default 0.5 */
  tolerance?: number
  /**
   * 'displayed' (default): the value must carry the sign the table shows. 'either': the value may also be the negation
   * of the displayed figure. A line such as "Operating loss 111,439" has a defensible economic sign that differs from its
   * displayed one; the claim PASSes with that noted, and the sign is left to the footing identities.
   */
  signConvention?: 'displayed' | 'either'
}

/** Fold typography (curly quotes, dashes, non-breaking spaces) and whitespace, then lower-case: agents copy a label's
 *  words, not its glyphs. */
export const foldText = (s: string): string => s.normalize('NFKC').replace(/[‘’‚‛′]/g, "'").replace(/[“”„‟″]/g, '"')
  .replace(/[‐-―−]/g, '-').replace(/[    ]/g, ' ')
const norm = (s: string): string => foldText(s).replace(/\s+/g, ' ').trim().toLowerCase()

/**
 * Find the one candidate a citation means: an exact (folded) match, else the UNIQUE candidate that contains the cited
 * text or is contained in it ("Consolidated Balance Sheets" for "Consolidated Balance Sheets - USD ($) $ in Thousands").
 * Ambiguity is not a match.
 */
function pick<T>(cands: readonly T[], key: (t: T) => string, cited: string): T | undefined {
  const c = norm(cited)
  const exact = cands.filter((t) => norm(key(t)) === c)
  if (exact.length) return exact[0]
  if (!c) return undefined
  const contain = cands.filter((t) => { const k = norm(key(t)); return k.includes(c) || (k.length > 0 && c.includes(k)) })
  return contain.length === 1 ? contain[0] : undefined
}

/** The scale a table title declares for its dollar cells. */
export function tableScale(title: string): number {
  const unit = (w: string): number => ({ thousands: 1e3, millions: 1e6, billions: 1e9 })[w.toLowerCase() as 'thousands' | 'millions' | 'billions']
  const d = title.match(/\$\s*in\s+(thousands|millions|billions)/i)
  if (d) return unit(d[1]!)
  // a filer's own heading: "(Amounts in thousands, except …)", "(In millions)", "(dollars in thousands)", never "shares in …"
  for (const m of title.matchAll(/\bin\s+(thousands|millions|billions)\b/gi)) if (!/shares?\s*$/i.test(title.slice(Math.max(0, m.index! - 8), m.index!))) return unit(m[1]!)
  return 1
}

/** A table cell as a number: "$ 36,533", "(1,234)", "$ (0.5)", "12.5". Blank, dashes and text are null. */
export function parseCellNumber(cell: string): number | null {
  let s = cell.normalize('NFKC').replace(/\s+/g, '')
  if (!s) return null
  let neg = false
  s = s.replace(/^\$/, '')
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1).replace(/^\$/, '') }
  if (s.startsWith('-') || s.startsWith('−')) { neg = !neg; s = s.slice(1) }
  if (!/^\d{1,3}(,\d{3})*(\.\d+)?$|^\d+(\.\d+)?$/.test(s)) return null
  const n = Number(s.replace(/,/g, ''))
  return neg ? -n : n
}

/** Parse a table document (see the header comment) into tables, with line numbers and cell spans. */
export function parseTableText(text: string): TextTable[] {
  const out: TextTable[] = []
  let cur: TextTable | null = null
  let offset = 0
  const lines = text.split('\n')
  lines.forEach((raw, i) => {
    const line = raw.replace(/\r$/, '')
    const start = offset
    offset += raw.length + 1
    if (line.startsWith('TABLE: ')) { cur = { title: line.slice(7).trim(), scale: tableScale(line), columns: [], rows: [] }; out.push(cur); return }
    if (!cur || !line.trim()) return
    const t: TextTable = cur
    if (line.startsWith('COLUMNS: ')) {
      t.columns = line.slice(9).split(' | ').map((c) => c.trim())
      // some filers print the unit in the column headers ("December 31, 2024 (in thousands, except per share amount)")
      if (t.scale === 1) t.scale = tableScale(t.columns.join(' '))
      return
    }
    const parts = line.split(' | ')
    const cellSpans: { start: number; end: number }[] = []
    let p = parts[0]!.length + 3
    for (const c of parts.slice(1)) { cellSpans.push({ start: start + p, end: start + p + c.length }); p += c.length + 3 }
    t.rows.push({ label: parts[0]!.trim(), cells: parts.slice(1).map((c) => c.trim()), line: i + 1, cellSpans })
  })
  return out
}

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }

/** The last date a column header names ("12 Months Ended Dec. 31, 2025" → 2025-12-31), or null. */
export function headerDate(header: string): Date | null {
  const all = [...header.matchAll(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),\s*(\d{4})\b/g)]
  for (const m of all.reverse()) {
    const mo = MONTHS[m[1]!.toLowerCase().slice(0, 3)]
    if (mo !== undefined) return new Date(Date.UTC(Number(m[3]), mo, Number(m[2])))
  }
  return null
}

function spanEvidence(sourceHash: string, span: { start: number; end: number }, line: number, value: number | string): Evidence {
  return { locator: { kind: 'span', source_hash: sourceHash, start: span.start, end: span.end, line }, value, confidence: 100, role: 'REFERENCE' }
}

export function verifyCellCitations(text: string, citations: readonly CellCitation[], opts: CellCitationOptions = {}): { source_hash: string; claims: ClaimVerdict[] } {
  const source_hash = sha256(text)
  const tables = parseTableText(text)
  const tol = opts.tolerance ?? 0.5
  const strict = opts.strict === true
  const periodEnd = opts.periodEnd ? new Date(`${opts.periodEnd}T00:00:00Z`) : null
  const periodTol = opts.periodToleranceDays ?? 7
  const claims: ClaimVerdict[] = []

  for (const c of citations) {
    const base = { claim_id: `${c.id}.value`, kind: 'CROSS_REFERENCE' as const, tier: 'DETERMINISTIC' as const, field: c.field, asserted: c.value, rule_id: 'CELL_VALUE', rule_name: 'Extracted value equals the cited table cell', locked: false }
    const nothing = (detail: string): ClaimVerdict => strict
      ? { ...base, outcome: 'FAIL', evidence: [], explanation: `${c.field}: ${detail} (the document is the one the agent read, so the citation is false).` }
      : { ...base, outcome: 'INSUFFICIENT_DATA', evidence: [], insufficiency: { reason: 'SPAN_NOT_FOUND', detail }, explanation: `${c.field}: ${detail}; abstaining.` }

    const t = pick(tables, (x) => x.title, c.table)
    let col = -1
    if (t) {
      const h = pick(t.columns.map((x, i) => ({ x, i })), (o) => o.x, c.column)
      if (h) col = h.i
      else {
        // a column cited by its date alone ("Dec. 31, 2024" for "12 Months Ended Dec. 31, 2024"), when exactly one column has that date
        const d = headerDate(c.column)
        const same = d ? t.columns.map((x, i) => ({ d: headerDate(x), i })).filter((o) => o.d && o.d.getTime() === d.getTime()) : []
        if (same.length === 1) col = same[0]!.i
      }
    }
    const rows = t ? t.rows.filter((r) => norm(r.label) === norm(c.row)) : []
    if (!t) { claims.push(nothing(`cited table "${c.table}" is not in the document`)); continue }
    if (col < 0) { claims.push(nothing(`cited column "${c.column}" is not a column of "${t.title}"`)) }
    else if (!rows.length) { claims.push(nothing(`cited row "${c.row}" is not a row of "${t.title}"`)) }
    else {
      // several rows can share a label: the citation holds if any of them holds the value
      const cands = rows.map((r) => ({ r, raw: r.cells[col] ?? '', n: parseCellNumber(r.cells[col] ?? '') }))
      const numeric = cands.filter((x) => x.n !== null)
      const hit = numeric.find((x) => Math.abs(x.n! * t.scale - c.value) <= tol)
      const flip = !hit && opts.signConvention === 'either' ? numeric.find((x) => Math.abs(-x.n! * t.scale - c.value) <= tol) : undefined
      if (hit) {
        const expected = hit.n! * t.scale
        claims.push({ ...base, outcome: 'PASS', locked: true, evidence: [spanEvidence(source_hash, hit.r.cellSpans[col]!, hit.r.line, hit.raw)],
          computation: { formula: 'value = cell × scale', operands: { cell: hit.n!, scale: t.scale }, result: expected, tolerance: { abs: tol } },
          explanation: `${c.field} = ${c.value}: the cited cell "${hit.raw}" × ${t.scale} = ${expected}.` })
      } else if (flip) {
        const expected = -flip.n! * t.scale
        claims.push({ ...base, outcome: 'PASS', locked: true, evidence: [spanEvidence(source_hash, flip.r.cellSpans[col]!, flip.r.line, flip.raw)],
          computation: { formula: 'value = −(cell × scale)', operands: { cell: flip.n!, scale: t.scale }, result: expected, tolerance: { abs: tol } },
          explanation: `${c.field} = ${c.value}: the cited cell "${flip.raw}" × ${t.scale}, with the sign reversed (signConvention 'either'; the sign is for the identities to judge).` })
      } else if (!numeric.length) {
        claims.push(nothing(`the cited cell (${JSON.stringify(cands[0]!.raw)}) is not a number`))
      } else {
        const x = numeric[0]!
        const expected = x.n! * t.scale
        claims.push({ ...base, outcome: 'FAIL', evidence: [spanEvidence(source_hash, x.r.cellSpans[col]!, x.r.line, x.raw)],
          computation: { formula: 'value = cell × scale', operands: { cell: x.n!, scale: t.scale }, result: expected, tolerance: { abs: tol } },
          variance: c.value - expected,
          explanation: `${c.field}: the cited cell "${x.raw}" in "${t.title}" × ${t.scale} = ${expected}, not ${c.value}.` })
      }
    }

    if (periodEnd && col >= 0) {
      const pbase = { claim_id: `${c.id}.period`, kind: 'CONSISTENCY' as const, tier: 'DETERMINISTIC' as const, field: c.field, asserted: c.column, rule_id: 'CELL_PERIOD', rule_name: 'Cited column is the fiscal period', locked: false }
      const d = headerDate(t.columns[col]!)
      // a header with only a year ("2024", "Fiscal 2024"): it matches if it names exactly one year, the period end's
      const years = [...new Set(t.columns[col]!.match(/\b(?:19|20)\d\d\b/g) ?? [])]
      if (!d && years.length === 1) {
        const ok = Number(years[0]) === periodEnd.getUTCFullYear()
        const ev: Evidence = { locator: { kind: 'field', source: 'evidence', path: `columns[${col}]` }, value: t.columns[col]!, confidence: 100, role: 'CONTEXT' }
        claims.push(ok
          ? { ...pbase, outcome: 'PASS', evidence: [ev], explanation: `${c.field}: column "${c.column}" names the period's year ${years[0]} (year only).` }
          : { ...pbase, outcome: 'FAIL', evidence: [ev], explanation: `${c.field}: column "${c.column}" names ${years[0]}, not the period's year ${periodEnd.getUTCFullYear()} (the wrong column).` })
      } else if (!d) {
        claims.push(strict
          ? { ...pbase, outcome: 'FAIL', evidence: [], explanation: `${c.field}: the cited column "${c.column}" names no date.` }
          : { ...pbase, outcome: 'INSUFFICIENT_DATA', evidence: [], insufficiency: { reason: 'UNPARSEABLE', detail: `column "${c.column}" names no date` }, explanation: `${c.field}: cannot read a date from the cited column; abstaining.` })
      } else {
        const days = Math.abs(d.getTime() - periodEnd.getTime()) / 86_400_000
        const ev: Evidence = { locator: { kind: 'field', source: 'evidence', path: `columns[${col}]` }, value: t.columns[col]!, confidence: 100, role: 'CONTEXT' }
        claims.push(days <= periodTol
          ? { ...pbase, outcome: 'PASS', evidence: [ev], explanation: `${c.field}: column "${c.column}" is the period ending ${opts.periodEnd}.` }
          : { ...pbase, outcome: 'FAIL', evidence: [ev], explanation: `${c.field}: column "${c.column}" is ${Math.round(days)} days from the period end ${opts.periodEnd} (the wrong column).` })
      }
    }
  }
  return { source_hash, claims }
}
