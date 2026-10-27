/**
 * The engine reads the evidence itself (engine 0.3.0, 2026-10-03; docs/EVIDENCE.md). A party files a document; the engine
 * extracts the one field the move is about, with its provenance and its tier. A value a party typed is never read as evidence.
 *
 *   a PDF          the extraction contract's reference extractor (src/extract): two readers per page, agreement or UNREADABLE.
 *                  A born-digital page (text layer, confirmed by OCR) is E2; a scan (two OCR settings) is E3.
 *   a UBL XML      the e-invoice map, by the field's published term (BT-115 …): E1, a structured document read as structured.
 *   a statement    `verify-source-statement/1`, signed by a source key enrolled in the parties file: E0, the value at the
 *                  move's locator. An unsigned or unenrolled statement is refused: a JSON of values is an assertion.
 * Anything else (a JSON of values, an extraction envelope, which is someone's reading) is refused: `not-a-document`.
 */

import { createHash, createPrivateKey, createPublicKey, sign as edSign, verify as edVerify } from 'node:crypto'
import { canonicalize } from '../verdict/canonical.js'
import type { DeclarativeRuleset } from '../declarative/types.js'
import { worseTier, inferTier } from '../declarative/evidence.js'
import type { EvidenceItem } from '../declarative/evidence.js'
import type { EvidenceTier } from '../verdict/schema.js'
import { extractContract, DEFAULT_OCR_A } from '../extract/extract.js'
import { UNREADABLE, type Provenance } from '../extract/contract.js'
import type { OcrSetting } from '../extract/readers.js'
import { parseXml } from '../twin-einvoice/xml.js'
import { detectProfile, bindField as bindEinvoiceField, mapFor } from '../twin-einvoice/bind.js'
import { sourceById, type CaseReaders, type PartiesFile } from './parties.js'
import type { MoveRefusal } from './moves.js'

export const STATEMENT_FORMAT = 'verify-source-statement/1'
const STATEMENT_DOMAIN = 'verify-source-statement/1\n'

/** A system of record's statement: what it says, signed by its own key (enrolled as a source). */
export interface SourceStatement { format: typeof STATEMENT_FORMAT; source: string; issued_at: string; body: Record<string, unknown>; sig: string }

const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x)

const statementBytes = (s: Omit<SourceStatement, 'sig'> | SourceStatement): Buffer => {
  const { sig: _s, ...rest } = s as SourceStatement
  return Buffer.from(STATEMENT_DOMAIN + canonicalize(rest), 'utf8')
}

/** Sign a statement with a source's private key (a system of record does this; tests and tabletops stand in for one). */
export function signStatement(s: Omit<SourceStatement, 'sig'>, privateKeyPem: string): SourceStatement {
  return { ...s, sig: edSign(null, statementBytes(s), createPrivateKey(privateKeyPem)).toString('base64') }
}

/** The OCR-B setting the extraction contract froze for scans (T1): 300 dpi, psm 4, colour dropout. */
export const DEFAULT_OCR_B: OcrSetting = { name: 'ocr-b', dpi: 300, psm: 4, dropout: true }

export type DocumentKind = 'pdf' | 'xml' | 'json' | 'unknown'
/** What the bytes are, by their own content (a declared media type is never trusted). */
export function sniff(bytes: Uint8Array): DocumentKind {
  const head = Buffer.from(bytes.subarray(0, 64)).toString('latin1').replace(/^﻿/, '').trimStart()
  if (head.startsWith('%PDF-')) return 'pdf'
  if (head.startsWith('<')) return 'xml'
  if (head.startsWith('{')) return 'json'
  return 'unknown'
}

export type ReadOk = { ok: true; item: Omit<EvidenceItem, 'kind' | 'move_id'>; kind: DocumentKind; note?: string }
export type ReadResult = ReadOk | ({ ok: false } & MoveRefusal)

const refuse = (code: MoveRefusal['code'], detail: string): ReadResult => ({ ok: false, code, detail })

/** The value at a dot/[n] path. */
function at(obj: unknown, path: string): unknown {
  let cur: unknown = obj
  for (const p of path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)) {
    if (!isObj(cur) && !Array.isArray(cur)) return undefined
    cur = (cur as Record<string, unknown>)[p]
  }
  return cur
}

export interface ReadOptions {
  ruleset: DeclarativeRuleset
  /** the field the move is about (a role in the ruleset) */
  role: string
  /** a statement's locator (`lines[0].amount`) */
  locator?: string
  parties: PartiesFile
  /** a party's declared source id for a document (independence); a statement's own `source` overrides it */
  source_id?: string
}

/** Read one field from one filed document. */
export async function readEvidence(bytes: Uint8Array, o: ReadOptions): Promise<ReadResult> {
  const kind = sniff(bytes)
  const document_sha256 = sha256Bytes(bytes)
  const spec = Object.prototype.hasOwnProperty.call(o.ruleset.fields, o.role) ? o.ruleset.fields[o.role] : undefined
  if (!spec) return refuse('field-unknown', `${o.role} is not a field of ${o.ruleset.id}@${o.ruleset.version}`)
  const numeric = spec.kind === undefined || spec.kind === 'amount' || spec.kind === 'price' || spec.kind === 'quantity' || spec.kind === 'rate'
  if (kind === 'json') {
    let doc: unknown
    try { doc = JSON.parse(Buffer.from(bytes).toString('utf8')) } catch { return refuse('not-a-document', 'the file is not valid JSON') }
    if (!isObj(doc) || doc.format !== STATEMENT_FORMAT) {
      return refuse('not-a-document', isObj(doc) && typeof doc.extraction_contract === 'string'
        ? 'an extraction envelope is a reading of a document, not the document: file the document itself, and the engine reads it'
        : `a JSON of values is an assertion, not evidence: the engine reads only a PDF, a UBL XML, or a statement signed by an enrolled source (${STATEMENT_FORMAT})`)
    }
    const st = doc as unknown as SourceStatement
    if (typeof st.source !== 'string' || !isObj(st.body) || typeof st.sig !== 'string') return refuse('not-a-document', 'a statement is { format, source, issued_at, body, sig }')
    const src = sourceById(o.parties, st.source)
    if (!src) return refuse('unauthenticated-source', `the statement names source "${st.source}", which the parties file does not enroll: an unenrolled statement is an assertion`)
    let good = false
    try { good = edVerify(null, statementBytes(st), createPublicKey(src.public_key), Buffer.from(st.sig, 'base64')) } catch { good = false }
    if (!good) return refuse('unauthenticated-source', `the statement's signature does not verify against source "${st.source}"'s enrolled key`)
    if (o.locator === undefined) return refuse('shape', 'a statement is read at a locator (evidence.locator, e.g. "lines[0].amount")')
    const v = at(st.body, o.locator)
    const value = numeric ? (typeof v === 'number' && Number.isFinite(v) ? v : undefined) : typeof v === 'string' && v.trim() ? v : undefined
    if (value === undefined) return refuse('evidence-unreadable', `the statement holds no ${numeric ? 'number' : 'text'} at ${o.locator}`)
    return { ok: true, kind, item: { value, tier: 'E0', source_id: st.source, document_sha256, reader: `statement:${st.source}`, raw: JSON.stringify(v), locator: o.locator } }
  }
  if (kind === 'xml') {
    let root
    try { root = parseXml(Buffer.from(bytes).toString('utf8')) } catch (e) { return refuse('not-a-document', `the XML does not parse: ${(e as Error).message}`) }
    const det = detectProfile(root)
    if (!det.profile) return refuse('not-a-document', `not a structured e-invoice this build reads: ${det.detail}`)
    const term = typeof spec.term_key === 'string' ? spec.term_key : (spec.term ?? '').match(/^(BT-\d+)/)?.[1]
    if (!term) return refuse('field-unknown', `${o.role} names no published term (BT-…), so it cannot be read from a structured e-invoice`)
    const map = mapFor(det.profile)
    const fm = map.fields.find(f => f.scope === 'document' && f.term === term)
    if (!fm) return refuse('field-unknown', `the ${det.profile} map has no document field ${term}`)
    const r = bindEinvoiceField(map, root, fm, { scope: 'document', index: 0 })
    if (!r.ok) return refuse('evidence-unreadable', `${term}: ${r.detail}`)
    const value = r.binding.value
    if (value === null || (numeric && typeof value !== 'number')) return refuse('evidence-unreadable', `${term} at ${r.binding.xpath} reads ${JSON.stringify(r.binding.raw)}`)
    return { ok: true, kind, item: { value: value as number | string, tier: 'E1', source_id: o.source_id ?? `document:${document_sha256}`, document_sha256, reader: `ubl:${det.profile}`, raw: r.binding.raw, locator: r.binding.xpath } }
  }
  if (kind === 'pdf') {
    if (spec.line || Array.isArray(spec.each)) return refuse('field-unknown', `${o.role} is a line or list field; this build re-reads document fields from a PDF`)
    const rd: CaseReaders = o.parties.readers ?? {}
    let res
    try {
      res = await extractContract(new Uint8Array(bytes), o.ruleset, {
        tools: { ...(rd.tesseract ? { tesseract: rd.tesseract } : {}), ...(rd.pdftoppm ? { pdftoppm: rd.pdftoppm } : {}), ...(rd.work_dir ? { workDir: rd.work_dir } : {}) },
        ocrA: rd.ocr_a ?? DEFAULT_OCR_A, ...(rd.ocr_a_scan ? { ocrAScan: rd.ocr_a_scan } : {}), ocrB: rd.ocr_b ?? DEFAULT_OCR_B,
      })
    } catch (e) { return refuse('evidence-unreadable', `the PDF could not be read: ${(e as Error).message}`) }
    const f = res.envelope.fields[o.role]
    if (f === undefined || Array.isArray(f)) {
      const np = res.envelope.not_printed?.[o.role]
      return refuse('evidence-unreadable', `the engine read the document and found no ${o.role}${np ? ` (labels searched: ${np.labels_searched.join(', ') || 'none'})` : ''}`)
    }
    const p = f.provenance as Provenance
    if (f.value === UNREADABLE) {
      const rs = (p.readings ?? []).map(r => `${r.reader}: ${r.raw === null ? 'nothing' : JSON.stringify(r.raw)}`).join('; ')
      return refuse('evidence-unreadable', `the engine read ${o.role} twice and the readings disagree or do not parse (${rs}): the document does not settle it`)
    }
    if (numeric && typeof f.value !== 'number') return refuse('evidence-unreadable', `${o.role} read as ${JSON.stringify(f.value)}, not a number`)
    const route = res.envelope.document?.route
    const byRoute: EvidenceTier = route === 'born-digital' ? 'E2' : 'E3'
    const tier = worseTier(byRoute, inferTier(p.reader)) as 'E1' | 'E2' | 'E3'
    return {
      ok: true, kind,
      item: { value: f.value as number | string, tier: tier === 'E1' ? 'E2' : tier, source_id: o.source_id ?? `document:${document_sha256}`, document_sha256, reader: p.reader, page: p.page, line: p.line, raw: p.raw },
      note: `read by ${p.reader} (${route ?? 'unknown route'})`,
    }
  }
  return refuse('not-a-document', 'the file is not a PDF, a UBL XML, or a signed source statement')
}

/** A document's identity: the sha256 of its raw bytes. */
export function sha256Bytes(b: Uint8Array): string {
  return createHash('sha256').update(b).digest('hex')
}
