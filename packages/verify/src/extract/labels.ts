/**
 * The generic field reader of the extraction contract (2026-10-03): document fields found by their printed LABEL.
 *
 * A ruleset field with `labels` (Peppol 0.2.0's lists: BT names plus common printed phrasings) is looked for row by row,
 * top to bottom. A label matches when:
 *   - it HEADS a row segment: it starts the row, or the word before it ends more than 15 pt to its left (a second column);
 *   - it is MAXIMAL: the next word, if it sits close (< 8 pt) and is a lower-case word, would continue a longer label, so it is
 *     not a match ("VAT total in accounting currency" is not "VAT total");
 *   - its words equal the row's words, case folded, a trailing colon ignored; a label word of 5 or more characters may differ
 *     by one edit on OCR (a misread letter).
 * Longer labels are tried first. The value is read off the same row, right of the label:
 *   - a number kind: the last token holding a digit, read strictly (./canonical.ts); a currency code or unambiguous symbol on
 *     the row is recorded beside it;
 *   - an identifier or string: the run of words after the label, up to a gap wider than 30 pt.
 * Nothing is repaired, nothing is taken from another row, and a field no label finds is reported not found (ABSENT), with
 * the labels searched.
 */

import type { DeclarativeRuleset, DeclField } from '../declarative/types.js'
import { canonicalText, readByKind, readCurrencyMark } from './canonical.js'
import { rowText, type Row, type Word } from './readers.js'

/** One reader's reading of one field. */
export interface FieldReading {
  status: 'value' | 'unparseable' | 'not_found'
  value?: number | string | boolean
  /** the exact string read */
  raw?: string
  page?: number
  line?: number
  line_text?: string
  /** the label that matched */
  label?: string
  /** a currency mark printed on the same row (number kinds) */
  currency?: string
  note?: string
  reader: string
}

const norm = (s: string): string => s.toLowerCase().replace(/:$/, '')
function lev(a: string, b: string): number {
  if (a === b) return 0
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0]![j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
  }
  return d[a.length]![b.length]!
}
/** A label word equals a page word: case folded, trailing colon ignored; on OCR, one edit allowed for words of 5+ characters. */
export function wordMatch(labelWord: string, pageWord: string, ocr: boolean): boolean {
  const a = norm(labelWord), b = norm(pageWord)
  return a === b || (ocr && a.length >= 5 && lev(a, b) <= 1)
}

/** Where `label` heads a segment of `row`, maximal; undefined when it does not. */
export function findLabel(row: readonly Word[], label: string, ocr: boolean): { start: number; end: number } | undefined {
  const lw = label.split(/\s+/).filter(Boolean)
  for (let i = 0; i + lw.length <= row.length; i++) {
    if (!lw.every((w, j) => wordMatch(w, (row[i + j] as Word).t, ocr))) continue
    if (i > 0 && (row[i] as Word).x0 - (row[i - 1] as Word).x1 <= 15) continue // must head its row segment
    const last = row[i + lw.length - 1] as Word
    const nx = row[i + lw.length]
    if (nx && nx.x0 - last.x1 < 8 && /^\p{Ll}+$/u.test(nx.t) && !last.t.endsWith(':')) continue // a longer label continues
    return { start: i, end: i + lw.length - 1 }
  }
  return undefined
}

/** The words right of index `end`, stopping at a gap wider than `gap` points (the first gap may be up to 160 pt). */
export function valueRun(row: readonly Word[], end: number, gap = 30): Word[] {
  const out: Word[] = []
  let prev = row[end] as Word
  for (let k = end + 1; k < row.length; k++) {
    const w = row[k] as Word
    if (w.x0 - prev.x1 > (out.length ? gap : 160)) break
    out.push(w); prev = w
  }
  return out
}

export interface LabelReadOptions {
  reader: string
  /** OCR words (one edit allowed in long label words) */
  ocr: boolean
  /** the document's decimal separator as this reader sees it */
  decimal: '.' | ',' | null
}

/** Read one labelled document field off the rows. */
export function readLabelled(rows: readonly Row[], f: DeclField, o: LabelReadOptions): FieldReading {
  const labels = [...(f.labels ?? [])].sort((a, b) => b.split(/\s+/).length - a.split(/\s+/).length || b.length - a.length)
  for (const r of rows) {
    for (const label of labels) {
      const m = findLabel(r.words, label, o.ocr)
      if (!m) continue
      const at = { page: r.page, line: r.line, line_text: rowText(r), label, reader: o.reader }
      const kind = f.kind ?? 'amount'
      if (kind === 'identifier' || kind === 'string') {
        let end = m.end
        if (!(r.words[end] as Word).t.endsWith(':') && r.words[end + 1]?.t === ':') end++
        const run = valueRun(r.words, end)
        if (!run.length) return { status: 'unparseable', ...at, raw: '', note: 'label found, no value beside it' }
        const raw = run.map(w => w.t).join(' ')
        const value = canonicalText(raw)
        return value ? { status: 'value', value, raw, ...at } : { status: 'unparseable', raw, ...at, note: 'blank value' }
      }
      if (kind === 'bool') {
        const run = valueRun(r.words, m.end)
        const raw = run.map(w => w.t).join(' ')
        const v = /^(yes|true)$/i.test(raw) ? true : /^(no|false)$/i.test(raw) ? false : undefined
        return v === undefined ? { status: 'unparseable', raw, ...at, note: 'not yes/no/true/false' } : { status: 'value', value: v, raw, ...at }
      }
      const right = r.words.slice(m.end + 1).filter(w => w.x0 > (r.words[m.end] as Word).x1)
      const cur = right.map(w => readCurrencyMark(w.t)).find((c): c is string => c !== null)
      const cand = right.filter(w => /\d/.test(w.t))
      const last = cand[cand.length - 1]
      if (!last) return { status: 'unparseable', raw: '', ...at, ...(cur ? { currency: cur } : {}), note: 'label found, no number beside it' }
      const v = readByKind(kind, last.t, o.decimal)
      if (v === null) return { status: 'unparseable', raw: last.t, ...at, ...(cur ? { currency: cur } : {}), note: o.decimal ? 'does not read strictly as a number' : 'the decimal separator is undetermined' }
      return { status: 'value', value: v, raw: last.t, ...at, ...(cur ? { currency: cur } : {}) }
    }
  }
  return { status: 'not_found', reader: o.reader, note: `no row is headed by ${labels.length ? labels.map(l => `"${l}"`).join(', ') : 'a label (the field declares none)'}` }
}

/** Every labelled document field of a ruleset, read off the rows. Fields without labels are left to a layout reader. */
export function readLabelledFields(rows: readonly Row[], ruleset: DeclarativeRuleset, o: LabelReadOptions): Map<string, FieldReading> {
  const out = new Map<string, FieldReading>()
  for (const [role, f] of Object.entries(ruleset.fields)) if (!f.line && f.labels?.length) out.set(role, readLabelled(rows, f, o))
  return out
}
