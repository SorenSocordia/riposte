/**
 * Population readers: the customer's system-of-record export (the AP payment register, a GL payments extract) as rows.
 *
 * The population is the customer's information (company-produced information, in AS 1105's words). These readers read it
 * exactly and bind the report to its bytes (sha256 over the bytes as given). They do not repair it: a malformed row is
 * REFUSED with its row and line number, never skipped and never guessed at, because a reconciliation that silently drops a
 * row has already failed the only question it exists to answer.
 *
 *   CSV    RFC 4180: a header record, then records of exactly as many fields; fields optionally enclosed in double quotes; a
 *          quote inside a quoted field is doubled (""); quoted fields may hold delimiters, CR and LF. CRLF or LF line breaks.
 *          A UTF-8 byte-order mark is accepted. Refused: an unterminated quote, a character after a closing quote, a quote
 *          inside an unquoted field, a bare CR outside quotes, a record with the wrong number of fields, a duplicate or empty
 *          header name, invalid UTF-8. Trailing blank lines at the end of the file are allowed; blank lines inside it are not.
 *   JSONL  one JSON object per line (CRLF tolerated). Refused: a line that is not JSON, or not an object; a blank line
 *          inside the file.
 */

import { hashOf } from '../../verdict/canonical.js'
import { createHash } from 'node:crypto'

export interface PopulationRow {
  /** 1-based position among the data records (the CSV header is not a row). */
  row: number
  /** 1-based physical line where the record starts (a quoted field can span lines). */
  line: number
  /** Column → value. CSV values are text; JSONL values are whatever the JSON holds. */
  values: Record<string, unknown>
}

export interface Population {
  population_version: 'population-v0'
  format: 'csv' | 'jsonl' | 'rows'
  /** sha256 (hex) of the exact bytes read. Absent for rows built in memory (rows_hash still binds them). */
  sha256?: string
  bytes?: number
  /** The CSV header, in order. */
  columns?: string[]
  rows: PopulationRow[]
}

/** A population the reader will not read, with where. */
export class PopulationRefused extends Error {
  readonly row?: number
  readonly line?: number
  constructor(message: string, where: { row?: number; line?: number } = {}) {
    super(message)
    this.name = 'PopulationRefused'
    if (where.row !== undefined) this.row = where.row
    if (where.line !== undefined) this.line = where.line
  }
}

export type CsvDelimiter = ',' | ';' | '\t' | '|'

const BOM = '\uFEFF'

/** Decode bytes as strict UTF-8 (the BOM is dropped); text passes through (a leading BOM is dropped). Hash the exact input. */
function decode(input: string | Uint8Array): { text: string; sha256: string; bytes: number } {
  if (typeof input === 'string') {
    const buf = Buffer.from(input, 'utf8')
    return { text: input.startsWith(BOM) ? input.slice(1) : input, sha256: createHash('sha256').update(buf).digest('hex'), bytes: buf.length }
  }
  let text: string
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(input) } catch { throw new PopulationRefused('the population is not valid UTF-8') }
  return { text, sha256: createHash('sha256').update(input).digest('hex'), bytes: input.byteLength }
}

/**
 * Parse RFC 4180 records. Returns each record's fields and the line it starts on. Throws PopulationRefused with the record
 * number (0 = the header) and line on any malformation.
 */
function parseCsvRecords(text: string, delim: CsvDelimiter): { fields: string[]; line: number }[] {
  const out: { fields: string[]; line: number }[] = []
  const n = text.length
  let i = 0
  let line = 1
  const refuse = (why: string, startLine: number): never => {
    const rec = out.length
    throw new PopulationRefused(`${rec === 0 ? 'the header' : `row ${rec}`} (line ${startLine}): ${why}`, { row: rec, line: startLine })
  }
  while (i < n) {
    const recLine = line
    // A blank line: allowed only if everything after it is blank too (trailing newlines at end of file).
    if (text[i] === '\n' || (text[i] === '\r' && text[i + 1] === '\n')) {
      if (/^[\r\n]*$/.test(text.slice(i))) break
      refuse('a blank line inside the file (a record with no fields); remove it or quote an empty field', recLine)
    }
    const fields: string[] = []
    for (;;) {
      let field = ''
      if (text[i] === '"') {
        const openLine = line
        i++
        for (;;) {
          if (i >= n) refuse(`a quoted field opened on line ${openLine} is never closed`, recLine)
          const ch = text[i]!
          if (ch === '"') {
            if (text[i + 1] === '"') { field += '"'; i += 2; continue }
            i++
            break
          }
          if (ch === '\n') line++
          field += ch
          i++
        }
        if (i < n && text[i] !== delim && text[i] !== '\n' && !(text[i] === '\r' && text[i + 1] === '\n')) {
          refuse(`unexpected ${JSON.stringify(text[i])} after a closing quote (a quoted field must end at a delimiter or line break)`, recLine)
        }
      } else {
        const start = i
        while (i < n && text[i] !== delim && text[i] !== '\n' && text[i] !== '\r') {
          if (text[i] === '"') refuse('a double quote inside an unquoted field (quote the field and double the quote)', recLine)
          i++
        }
        if (text[i] === '\r' && text[i + 1] !== '\n') refuse('a bare carriage return outside quotes', recLine)
        field = text.slice(start, i)
      }
      fields.push(field)
      if (i >= n) break
      if (text[i] === delim) { i++; continue }
      // line break
      i += text[i] === '\r' ? 2 : 1
      line++
      break
    }
    out.push({ fields, line: recLine })
  }
  return out
}

/** Read a CSV population (RFC 4180, header required). Delimiter default ','; declare ';', tab or '|' when the export uses one. */
export function readPopulationCSV(input: string | Uint8Array, opts: { delimiter?: CsvDelimiter } = {}): Population {
  const delim = opts.delimiter ?? ','
  if (![',', ';', '\t', '|'].includes(delim)) throw new PopulationRefused(`delimiter must be one of , ; tab | (got ${JSON.stringify(delim)})`)
  const { text, sha256: digest, bytes } = decode(input)
  const recs = parseCsvRecords(text, delim)
  if (recs.length === 0) throw new PopulationRefused('the population is empty: no header record')
  const header = recs[0]!.fields
  const seen = new Set<string>()
  header.forEach((h, j) => {
    if (h.trim() === '') throw new PopulationRefused(`the header's column ${j + 1} has no name`, { row: 0, line: 1 })
    if (seen.has(h)) throw new PopulationRefused(`the header names column ${JSON.stringify(h)} twice`, { row: 0, line: 1 })
    seen.add(h)
  })
  const rows: PopulationRow[] = []
  for (let r = 1; r < recs.length; r++) {
    const { fields, line } = recs[r]!
    if (fields.length !== header.length) {
      throw new PopulationRefused(`row ${r} (line ${line}) has ${fields.length} field${fields.length === 1 ? '' : 's'}; the header has ${header.length}`, { row: r, line })
    }
    const values: Record<string, unknown> = {}
    header.forEach((h, j) => { values[h] = fields[j] })
    rows.push({ row: r, line, values })
  }
  return { population_version: 'population-v0', format: 'csv', sha256: digest, bytes, columns: [...header], rows }
}

/** Read a JSONL population: one JSON object per line. */
export function readPopulationJSONL(input: string | Uint8Array): Population {
  const { text, sha256: digest, bytes } = decode(input)
  const lines = text.split('\n')
  // Trailing blank lines are the end of the file; a blank line before a record is refused.
  let last = lines.length - 1
  while (last >= 0 && lines[last]!.replace(/\r$/, '').trim() === '') last--
  const rows: PopulationRow[] = []
  for (let j = 0; j <= last; j++) {
    const s = lines[j]!.replace(/\r$/, '')
    const lineNo = j + 1
    const rowNo = rows.length + 1
    if (s.trim() === '') throw new PopulationRefused(`line ${lineNo}: a blank line inside the file`, { row: rowNo, line: lineNo })
    let v: unknown
    try { v = JSON.parse(s) } catch (e) { throw new PopulationRefused(`row ${rowNo} (line ${lineNo}) is not JSON: ${(e as Error).message}`, { row: rowNo, line: lineNo }) }
    if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new PopulationRefused(`row ${rowNo} (line ${lineNo}) is not a JSON object`, { row: rowNo, line: lineNo })
    rows.push({ row: rowNo, line: lineNo, values: v as Record<string, unknown> })
  }
  return { population_version: 'population-v0', format: 'jsonl', sha256: digest, bytes, rows }
}

/** Read a population by declared format. */
export function readPopulation(input: string | Uint8Array, format: 'csv' | 'jsonl', opts: { delimiter?: CsvDelimiter } = {}): Population {
  if (format === 'csv') return readPopulationCSV(input, opts)
  if (format === 'jsonl') return readPopulationJSONL(input)
  throw new PopulationRefused(`population format must be csv or jsonl (got ${JSON.stringify(format)})`)
}

/** A population from in-memory objects (an API caller's rows). Bound by rows_hash only: there are no file bytes. */
export function populationFromRows(rows: readonly Record<string, unknown>[]): Population {
  return {
    population_version: 'population-v0', format: 'rows',
    rows: rows.map((values, j) => {
      if (values === null || typeof values !== 'object' || Array.isArray(values)) throw new PopulationRefused(`row ${j + 1} is not an object`, { row: j + 1 })
      return { row: j + 1, line: j + 1, values: { ...values } }
    }),
  }
}

/** The canonical hash of the rows' values, in order: binds a report to the population's content whatever its bytes. */
export function populationRowsHash(p: Population): string {
  return hashOf(p.rows.map(r => r.values))
}

