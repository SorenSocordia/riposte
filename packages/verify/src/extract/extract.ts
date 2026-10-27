/**
 * The reference extractor of the extraction contract (2026-10-03): a PDF in, a contract envelope out.
 *
 * Each page is read by two readers. A page whose text layer carries `minTextWords` words or more (default 20) is
 * born-digital: its readers are the text layer and OCR-A. A page with fewer is a scan: OCR-A and OCR-B, with the page
 * turned upright once (Tesseract's orientation detection) and the same turn applied to both. Each reader's words become
 * rows; labelled document fields are read by ./labels.ts, and anything layout-specific (line-item tables, breakdown
 * rows) by a LayoutReader the caller supplies. ./agree.ts decides each field from its two readings.
 *
 * Besides the envelope it returns what verify's source-text axis takes: the first reader's text (canonical, line by line,
 * pages split by form feeds) and the raw strings of the agreed fields, so `verify --source --quotes` checks that every
 * value handed over is printed verbatim.
 */

import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DeclarativeRuleset } from '../declarative/types.js'
import { buildEnvelope, type LineReading } from './agree.js'
import { canonicalLines, canonicalText, detectDecimal } from './canonical.js'
import { UNREADABLE, type ContractEnvelope, type Provenance } from './contract.js'
import { readLabelledFields, type FieldReading } from './labels.js'
import { ocrPage, readTextLayer, rowText, toRows, type OcrSetting, type PageRead, type Row, type Tools } from './readers.js'

export const DEFAULT_OCR_A: OcrSetting = { name: 'ocr-a', dpi: 300, psm: 6 }

/** What a layout reader gets: one reader's rows, and what the generic reader already read off them. */
export interface LayoutContext {
  reader: string
  ocr: boolean
  decimal: '.' | ',' | null
  ruleset: DeclarativeRuleset
  labelled: Map<string, FieldReading>
  pages: PageRead[]
}
/** A layout-specific reader: line items and unlabelled document fields (a table's rows, the totals' currency). */
export type LayoutReader = (rows: Row[], ctx: LayoutContext) => { fields?: Map<string, FieldReading>; lines?: LineReading[] }

export interface ExtractOptions {
  tools?: Tools
  ocrA?: OcrSetting
  /** the second OCR setting, for scans */
  ocrB?: OcrSetting
  /** OCR-A as applied to a scan (its preprocessing may differ from a born-digital page's: a stamp sits on a scan); default ocrA */
  ocrAScan?: OcrSetting
  layout?: LayoutReader
  /** a page with at least this many text-layer words is born-digital (default 20) */
  minTextWords?: number
  /** the text-layer reader's name in provenance (default "pdf-text-layer") */
  textLayerName?: string
}

export interface ExtractResult {
  envelope: ContractEnvelope
  /** the first reader's text, canonical line by line, pages split by "\f": verify's --source */
  sourceText: string
  /** the agreed fields' raw strings (canonical), for verify's --quotes */
  quotes: { id: string; quote: string }[]
  routes: ('born-digital' | 'scan')[]
  readers: [string, string]
  decimals: ['.' | ',' | null, '.' | ',' | null]
  rotations: number[]
  /** both readers' raw readings, for audit */
  readings: { reader1: Record<string, FieldReading>; reader2: Record<string, FieldReading> }
  notes: string[]
}

/** Extract one PDF under the contract for a declarative ruleset. */
export async function extractContract(pdf: Uint8Array, ruleset: DeclarativeRuleset, o: ExtractOptions = {}): Promise<ExtractResult> {
  const tools = o.tools ?? {}
  const ocrA = o.ocrA ?? DEFAULT_OCR_A
  const ocrB = o.ocrB
  const tlName = o.textLayerName ?? 'pdf-text-layer'
  const min = o.minTextWords ?? 20
  const notes: string[] = []
  const tl = await readTextLayer(pdf, tlName)
  const dir = mkdtempSync(join(tools.workDir ?? tmpdir(), 'vx-doc-'))
  const pdfPath = join(dir, 'in.pdf')
  writeFileSync(pdfPath, pdf)
  const p1: PageRead[] = [], p2: PageRead[] = []
  const routes: ('born-digital' | 'scan')[] = [], rotations: number[] = []
  try {
    for (const page of tl) {
      if (page.words.length >= min) {
        routes.push('born-digital'); rotations.push(0)
        p1.push(page)
        p2.push(ocrPage(pdfPath, page.page, ocrA, tools))
      } else {
        if (!ocrB) throw new Error('a scanned page needs a second OCR setting (ocrB): the contract reads every field twice')
        routes.push('scan')
        const a = ocrPage(pdfPath, page.page, o.ocrAScan ?? ocrA, tools, { orient: true })
        rotations.push(a.rotate ?? 0)
        if (a.osd) notes.push(`page ${page.page}: ${a.osd}`)
        if (a.dropout) notes.push(`page ${page.page}: colour dropout applied (${(o.ocrAScan ?? ocrA).name})`)
        const b = ocrPage(pdfPath, page.page, ocrB, tools, { rotate: a.rotate ?? 0 })
        if (b.dropout) notes.push(`page ${page.page}: colour dropout applied (${ocrB.name})`)
        p1.push(a); p2.push(b)
      }
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
  const allScan = routes.every(r => r === 'scan'), allBorn = routes.every(r => r === 'born-digital')
  const names: [string, string] = allBorn ? [tlName, ocrA.name] : allScan ? [ocrA.name, ocrB!.name] : [`${tlName}|${ocrA.name}`, `${ocrA.name}|${ocrB?.name ?? '-'}`]
  const read = (pages: PageRead[], ocrFlag: (p: PageRead) => boolean) => {
    const rows = pages.flatMap(toRows)
    const decimal = detectDecimal(pages.flatMap(p => p.words.map(w => w.t)))
    const ocr = pages.some(ocrFlag)
    const reader = pages[0]?.reader ?? '?'
    const labelled = readLabelledFields(rows, ruleset, { reader, ocr, decimal })
    const lay = o.layout?.(rows, { reader, ocr, decimal, ruleset, labelled, pages }) ?? {}
    const doc = new Map(labelled)
    for (const [role, r] of lay.fields ?? []) if (!doc.has(role) || doc.get(role)!.status === 'not_found') doc.set(role, r)
    return { rows, decimal, doc, lines: lay.lines }
  }
  const r1 = read(p1, p => p.reader !== tlName)
  const r2 = read(p2, () => true)
  if (!r1.decimal) notes.push(`${names[0]}: decimal separator undetermined, every amount unreadable`)
  if (!r2.decimal) notes.push(`${names[1]}: decimal separator undetermined, every amount unreadable`)
  const envelope = buildEnvelope({
    ruleset, names, doc1: r1.doc, doc2: r2.doc,
    ...(r1.lines !== undefined || r2.lines !== undefined ? { lines1: r1.lines ?? [], lines2: r2.lines ?? [] } : {}),
    document: { sha256: createHash('sha256').update(pdf).digest('hex'), pages: tl.length, route: allBorn ? 'born-digital' : allScan ? 'scan' : 'mixed', readers: names },
    // Engine 0.3.0: the tier the readings support: a born-digital page's text layer (E2); OCR of a scan, or a mixed route (E3)
    tier: allBorn ? 'E2' : 'E3',
  })
  // verify's source-text axis: the first reader's rows, canonical line by line; pages split by form feeds
  const pagesText = p1.map(p => r1.rows.filter(r => r.page === p.page).map(rowText).join('\n'))
  const sourceText = canonicalLines(pagesText.join('\f'))
  const quotes: { id: string; quote: string }[] = []
  for (const [role, f] of Object.entries(envelope.fields)) {
    if (Array.isArray(f)) continue // a list field (the reference extractor does not read lists yet)
    const raw = (f.provenance as Provenance).raw
    if (f.value !== UNREADABLE && typeof raw === 'string' && canonicalText(raw).length >= 1) quotes.push({ id: role, quote: canonicalText(raw) })
  }
  ;(envelope.lines ?? []).forEach((l, i) => {
    for (const [role, f] of Object.entries(l.fields)) {
      const raw = (f.provenance as Provenance).raw
      if (f.value !== UNREADABLE && typeof raw === 'string' && canonicalText(raw).length >= 1) quotes.push({ id: `lines[${i}].${role}`, quote: canonicalText(raw) })
    }
  })
  return {
    envelope, sourceText, quotes, routes, readers: names, decimals: [r1.decimal, r2.decimal], rotations,
    readings: { reader1: Object.fromEntries(r1.doc), reader2: Object.fromEntries(r2.doc) }, notes,
  }
}
