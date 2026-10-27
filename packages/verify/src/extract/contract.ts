/**
 * The extraction contract (version 0.1, 2026-10-03): the shape an extractor hands verify when the ruleset asks for it.
 *
 * An envelope names the ruleset it was read for and fills that ruleset's OWN field terms (the role names of its `fields`
 * block: PAYABLE, TAX_EXCL, ...), never free-form keys. Every value carries its provenance: the page, the line, the exact
 * string read (`raw`) and the reader that read it. A value two readers disagreed on is the marker "UNREADABLE", with both
 * readings kept. A field the page does not print is ABSENT: its key is omitted and `not_printed` names the labels searched.
 *
 *   {
 *     "extraction_contract": "0.1",
 *     "ruleset": "peppol-en16931@0.2.0",
 *     "document": { "sha256": "…", "pages": 1, "route": "born-digital", "readers": ["pdf-text-layer", "ocr-a"] },
 *     "fields": { "PAYABLE": { "value": 8350, "provenance": { "page": 1, "line": 31, "raw": "8,350.00", "reader": "pdf-text-layer+ocr-a", "readings": [ … ] } } },
 *     "not_printed": { "PREPAID": { "labels_searched": ["Paid amount", "Prepaid amount", "Amount paid"] } },
 *     "lines": [ { "fields": { "LINE_EXT": { … }, "QTY": { … } }, "not_printed": { "BASE_QTY": { "labels_searched": [] } } } ]
 *   }
 *
 * `lowerContract` turns an envelope into the extraction shape the ruleset's checks read (each field at its first path), so
 * the evaluator itself is unchanged. A list field (`each`; 2026-10-03, T2) is an array of such fields, lowered to the list's
 * first array path with each item's value at the field's first path inside its element (`vat_breakdown[i].tax_amount`). The generated JSON Schema (./schema.ts) is the contract's one source of truth;
 * `validateContract` checks an envelope against it.
 */

import type { DeclarativeRuleset } from '../declarative/types.js'

export const CONTRACT_VERSION = '0.1'
/** The marker for a value that was seen and could not be read (two readers disagreed, or it did not parse). */
export const UNREADABLE = 'UNREADABLE'

/** One reader's reading of one field: what it read, where, or why it read nothing. */
export interface Reading {
  reader: string
  /** the exact string the reader read; null when it found no value */
  raw: string | null
  page?: number
  line?: number
  /** the whole printed line as this reader saw it */
  line_text?: string
  /** why a reading is not a value: "label not found", "does not parse strictly", … */
  note?: string
}

/** Where a value was read: mandatory under the contract. */
export interface Provenance {
  /** 1-based page */
  page: number
  /** 1-based line within the page, in the first reader's reading order */
  line: number
  /** the exact string read (by the first reader; "" when it read nothing) */
  raw: string
  /** the reader, or both readers joined by "+" when two read it */
  reader: string
  /** the whole printed line, as the first reader saw it */
  line_text?: string
  /** every reader's reading (two for a value two readers agreed on; required for an UNREADABLE value) */
  readings?: Reading[]
  /**
   * The evidence tier the reading supports (engine 0.3.0; docs/EVIDENCE.md): E1 a structured document's own field, E2 a PDF
   * text layer (confirmed by the second reader), E3 OCR. Optional; the engine also infers a tier from `reader` and uses the worse
   * of the two, so a tier is never raised by stating it. An extractor may not state E0 (the engine's own, from a signed source)
   * or E4 (an assertion is not a reading).
   */
  tier?: 'E1' | 'E2' | 'E3'
}

/** A value the page does not print but the caller supplies (a legal citation's resolver keys). The only page-less provenance. */
export interface SuppliedProvenance {
  reader: 'supplied'
  /** where the value came from, e.g. "citation resolver" */
  source: string
  raw?: string
}

/**
 * A value read from a file an archive serves (engine 0.4.0, 2026-10-04; docs/EVIDENCE.md "Archive provenance"): the
 * archive's URL (and the member, for a file inside a container), when it was retrieved, the sha256 of the content read, the
 * archive's own published checksum when it publishes one, the reader and the cell read. The engine reads it as E1, never E0, and
 * states `checksum_verified` only from bytes it hashed itself. Accepted by the generated schema only when the ruleset lists
 * `"provenance_kinds": ["archive"]`.
 */
export interface ArchiveProvenance {
  kind: 'archive'
  url: string
  /** ISO-8601 time the file was retrieved */
  retrieved_at: string
  /** sha256 of the bytes read (the member's, for a file inside a container) */
  sha256: string
  /** the file inside a container (a zip member), when the url names the container */
  member?: string
  /** sha256 of the container the url serves, when the value was read from a member */
  container_sha256?: string
  /** the checksum the archive itself publishes for the file (MAST's md5, Zenodo's per-file md5, a release's MD5SUM line) */
  archive_checksum?: { algorithm: 'md5' | 'sha1' | 'sha256' | 'sha512'; value: string; published_at?: string }
  /** how the file was read (its declared format, or a stated narrowing of it) */
  reader: string
  /** the exact cell text read */
  raw: string
  /** where in the file: a line and column, a header keyword */
  locator?: string
  /** readers' readings, as for page provenance (required for an UNREADABLE value) */
  readings?: Reading[]
  /** optional, as for page provenance; the engine uses the worse of this and E1 */
  tier?: 'E1' | 'E2' | 'E3'
}

export type ContractValue = number | string | boolean
export interface ContractField {
  value: ContractValue
  provenance: Provenance | SuppliedProvenance | ArchiveProvenance
}
/** A list field's value under the contract: one field per element, in printed order (2026-10-03, T2). */
export type ContractList = ContractField[]
export interface NotPrinted {
  /** the labels the extractor looked for (empty when the field has none, e.g. a table cell) */
  labels_searched: string[]
  note?: string
}
export interface ContractLine {
  fields: Record<string, ContractField>
  not_printed?: Record<string, NotPrinted>
}
export interface ContractEnvelope {
  extraction_contract: typeof CONTRACT_VERSION
  /** the ruleset the envelope was read for, as id@version */
  ruleset: string
  document?: { sha256?: string; pages?: number; route?: string; readers?: string[]; [k: string]: unknown }
  fields: Record<string, ContractField | ContractList>
  not_printed?: Record<string, NotPrinted>
  lines?: ContractLine[]
}

const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x)

/** True when `x` is shaped as a contract envelope (it says so: `extraction_contract` plus a `fields` object). Validity is ./schema.ts's question. */
export function isContractEnvelope(x: unknown): x is ContractEnvelope {
  return isObj(x) && typeof x.extraction_contract === 'string' && isObj(x.fields)
}

/** The id@version a ruleset's envelope names. */
export const rulesetRef = (rs: Pick<DeclarativeRuleset, 'id' | 'version'>): string => `${rs.id}@${rs.version}`

/** Set a dot/[n] path on an object, creating objects and arrays on the way. */
function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)
  let cur: Record<string, unknown> | unknown[] = obj
  for (let i = 0; i < parts.length; i++) {
    const k = parts[i] as string
    const last = i === parts.length - 1
    const nextIsIndex = !last && /^\d+$/.test(parts[i + 1] as string)
    const c = cur as Record<string, unknown>
    if (last) { c[k] = value; return }
    if (c[k] === undefined || c[k] === null || typeof c[k] !== 'object') c[k] = nextIsIndex ? [] : {}
    cur = c[k] as Record<string, unknown>
  }
}

export interface Lowered {
  /** the extraction the ruleset's checks read: every field at its first path, UNREADABLE kept as the marker */
  extraction: Record<string, unknown>
  /** provenance by the path the value was lowered to ("payable_amount", "lines[0].line_extension_amount") */
  provenance: Map<string, Provenance | SuppliedProvenance | ArchiveProvenance>
}

/**
 * The extraction a ruleset reads, from an envelope: each document field at its first path, each line field at its first
 * path inside the ruleset's first line-array key. An ABSENT field stays absent (verify applies a ruleset `default` only
 * to it); an UNREADABLE one is the marker, which verify reads as unreadable (engine 0.1.0). A term the ruleset does not
 * have is not lowered (validation names it).
 */
export function lowerContract(env: ContractEnvelope, ruleset: DeclarativeRuleset): Lowered {
  const extraction: Record<string, unknown> = {}
  const provenance = new Map<string, Provenance | SuppliedProvenance | ArchiveProvenance>()
  const spec = (role: string) => (Object.prototype.hasOwnProperty.call(ruleset.fields, role) ? ruleset.fields[role] : undefined)
  for (const [role, f] of Object.entries(isObj(env.fields) ? env.fields : {})) {
    const s = spec(role)
    // a list field (2026-10-03, T2): every item at the field's first path inside its element of the list's first array path
    if (s && !s.line && Array.isArray(s.each) && Array.isArray(f)) {
      const key = s.each[0], path = s.paths[0]
      if (key === undefined || path === undefined) continue
      setPath(extraction, key, f.map((item, i) => {
        const el: Record<string, unknown> = {}
        if (isObj(item) && 'value' in item) {
          setPath(el, path, item.value)
          if (isObj(item.provenance)) provenance.set(`${key}[${i}].${path}`, item.provenance as unknown as Provenance)
        }
        return el
      }))
      continue
    }
    if (!s || s.line || !isObj(f) || !('value' in f)) continue
    const path = s.paths[0]
    if (path === undefined) continue
    setPath(extraction, path, f.value)
    if (isObj(f.provenance)) provenance.set(path, f.provenance as unknown as Provenance)
  }
  if (Array.isArray(env.lines)) {
    const key = ruleset.lineArrayKeys?.[0] ?? 'line_items'
    extraction[key] = env.lines.map((line, i) => {
      const out: Record<string, unknown> = {}
      for (const [role, f] of Object.entries(isObj(line) && isObj(line.fields) ? line.fields : {})) {
        const s = spec(role)
        if (!s || !s.line || !isObj(f) || !('value' in f)) continue
        const path = s.paths[0]
        if (path === undefined) continue
        setPath(out, path, f.value)
        if (isObj(f.provenance)) provenance.set(`${key}[${i}].${path}`, f.provenance as unknown as Provenance)
      }
      return out
    })
  }
  return { extraction, provenance }
}
