/**
 * Two readers, one value (extraction contract, 2026-10-03). Each field is read by two readers; the contract value is
 * decided here, field by field, and nothing breaks a tie:
 *
 *   reader 1            reader 2             contract value
 *   value v             value v (agrees)     v, with both readings recorded
 *   value v             value w ≠ v          UNREADABLE, both readings kept
 *   value               unparseable          UNREADABLE, both readings kept
 *   value               not found            UNREADABLE, both readings kept (printed, per one reader)
 *   unparseable         unparseable          UNREADABLE, both readings kept
 *   not found           not found            ABSENT: not_printed, with the labels searched
 *
 * Numbers agree when both read strictly and are equal; strings when equal after canonicalization (./canonical.ts).
 * Line items are aligned by their printed line id when both readers read the same ids, each once, else by position; a
 * line one reader has and the other does not has every field UNREADABLE. VAT-style table rows align by position.
 */

import type { DeclarativeRuleset, DeclField } from '../declarative/types.js'
import { canonicalText } from './canonical.js'
import { CONTRACT_VERSION, UNREADABLE, rulesetRef, type ContractEnvelope, type ContractField, type ContractLine, type NotPrinted, type Reading } from './contract.js'
import type { FieldReading } from './labels.js'

/** One line item as one reader read it: its printed id (for alignment) and its line fields. */
export interface LineReading {
  id?: string
  fields: Map<string, FieldReading>
}

export function toReading(r: FieldReading | undefined, reader: string): Reading {
  if (!r) return { reader, raw: null, note: 'not read by this reader' }
  return {
    reader: r.reader, raw: r.status === 'not_found' ? null : (r.raw ?? null),
    ...(r.page !== undefined ? { page: r.page } : {}), ...(r.line !== undefined ? { line: r.line } : {}),
    ...(r.line_text !== undefined ? { line_text: r.line_text } : {}),
    ...(r.status !== 'value' ? { note: r.note ?? (r.status === 'not_found' ? 'not found' : 'unparseable') } : {}),
  }
}

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
/** Do two value readings agree? Numbers: equal. Strings: equal after canonicalization, and not blank. Booleans: equal. */
export function readingsAgree(a: FieldReading, b: FieldReading): boolean {
  if (a.status !== 'value' || b.status !== 'value') return false
  if (isNum(a.value) && isNum(b.value)) return Math.abs(a.value - b.value) < 1e-9
  if (typeof a.value === 'string' && typeof b.value === 'string') { const x = canonicalText(a.value); return x !== '' && x === canonicalText(b.value) }
  if (typeof a.value === 'boolean' && typeof b.value === 'boolean') return a.value === b.value
  return false
}

export interface Decided { field?: ContractField; not_printed?: NotPrinted }

/** The contract value of one field from its two readings (see the table above). */
export function decideField(f: Pick<DeclField, 'labels'>, a: FieldReading | undefined, b: FieldReading | undefined, names: [string, string], tier?: 'E1' | 'E2' | 'E3'): Decided {
  const sa = a?.status ?? 'not_found', sb = b?.status ?? 'not_found'
  if (sa === 'not_found' && sb === 'not_found') {
    return { not_printed: { labels_searched: [...(f.labels ?? [])], ...(a?.note || b?.note ? { note: a?.note ?? b?.note } : {}) } }
  }
  const readings = [toReading(a, names[0]), toReading(b, names[1])]
  const reader = `${a?.reader ?? names[0]}+${b?.reader ?? names[1]}`
  const where = a?.page !== undefined ? a : b!
  const base = {
    page: where.page ?? 1, line: where.line ?? 1, raw: a?.status === 'not_found' ? '' : (a?.raw ?? ''), reader,
    ...(where.line_text !== undefined ? { line_text: where.line_text } : {}), readings,
    ...(tier !== undefined ? { tier } : {}),
  }
  if (a && b && readingsAgree(a, b)) return { field: { value: a.value as number | string | boolean, provenance: base } }
  return { field: { value: UNREADABLE, provenance: base } }
}

/** Align two readers' line items: by printed id when both read the same ids, each exactly once; else by position. */
export function alignLines(l1: readonly LineReading[], l2: readonly LineReading[]): [LineReading | undefined, LineReading | undefined][] {
  const ids = (ls: readonly LineReading[]): string[] | undefined => {
    const xs = ls.map(l => (l.id === undefined ? undefined : canonicalText(l.id)))
    return xs.every((x): x is string => !!x) && new Set(xs).size === xs.length ? xs : undefined
  }
  const i1 = ids(l1), i2 = ids(l2)
  // by id only when both readers read the same set of ids (a misread id must not split one line into two)
  if (i1 && i2 && i1.length === i2.length && i1.every(x => i2.includes(x))) {
    const out: [LineReading | undefined, LineReading | undefined][] = l1.map((l, k) => [l, l2[i2.indexOf(i1[k] as string)]])
    l2.forEach((l, k) => { if (!i1.includes(i2[k] as string)) out.push([undefined, l]) })
    return out
  }
  const n = Math.max(l1.length, l2.length)
  return Array.from({ length: n }, (_, k) => [l1[k], l2[k]])
}

export interface EnvelopeInput {
  ruleset: DeclarativeRuleset
  names: [string, string]
  doc1: Map<string, FieldReading>
  doc2: Map<string, FieldReading>
  lines1?: LineReading[]
  lines2?: LineReading[]
  document?: ContractEnvelope['document']
  /** the evidence tier every reading in this envelope supports (engine 0.3.0): E2 born-digital, E3 a scan or a mixed route */
  tier?: 'E1' | 'E2' | 'E3'
}

/** The contract envelope from two readers' readings: every ruleset field read (agreed or UNREADABLE) or named not_printed. */
export function buildEnvelope(x: EnvelopeInput): ContractEnvelope {
  const fields: Record<string, ContractField> = {}
  const notPrinted: Record<string, NotPrinted> = {}
  for (const [role, f] of Object.entries(x.ruleset.fields)) {
    if (f.line) continue
    const a = x.doc1.get(role), b = x.doc2.get(role)
    if (!a && !b) { notPrinted[role] = { labels_searched: [...(f.labels ?? [])], note: 'no reader looks for this field' }; continue }
    const d = decideField(f, a, b, x.names, x.tier)
    if (d.field) fields[role] = d.field; else if (d.not_printed) notPrinted[role] = d.not_printed
  }
  const lineRoles = Object.entries(x.ruleset.fields).filter(([, f]) => f.line)
  let lines: ContractLine[] | undefined
  if (x.lines1 !== undefined || x.lines2 !== undefined) {
    lines = alignLines(x.lines1 ?? [], x.lines2 ?? []).map(([p, q]) => {
      const lf: Record<string, ContractField> = {}
      const lnp: Record<string, NotPrinted> = {}
      const oneSided = !p || !q
      for (const [role, f] of lineRoles) {
        const a = p?.fields.get(role), b = q?.fields.get(role)
        if (oneSided) {
          const seen = a ?? b
          const readings = [p ? toReading(a, x.names[0]) : { reader: x.names[0], raw: null, note: 'this reader did not read the line' }, q ? toReading(b, x.names[1]) : { reader: x.names[1], raw: null, note: 'this reader did not read the line' }]
          lf[role] = { value: UNREADABLE, provenance: { page: seen?.page ?? 1, line: seen?.line ?? 1, raw: seen?.raw ?? '', reader: `${x.names[0]}+${x.names[1]}`, ...(seen?.line_text !== undefined ? { line_text: seen.line_text } : {}), readings, ...(x.tier !== undefined ? { tier: x.tier } : {}) } }
          continue
        }
        const d = decideField(f, a, b, x.names, x.tier)
        if (d.field) lf[role] = d.field; else if (d.not_printed) lnp[role] = d.not_printed
      }
      return { fields: lf, ...(Object.keys(lnp).length ? { not_printed: lnp } : {}) }
    })
  }
  return {
    extraction_contract: CONTRACT_VERSION,
    ruleset: rulesetRef(x.ruleset),
    ...(x.document ? { document: x.document } : {}),
    fields,
    ...(Object.keys(notPrinted).length ? { not_printed: notPrinted } : {}),
    ...(lines !== undefined ? { lines } : {}),
  }
}
