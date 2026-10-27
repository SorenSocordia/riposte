/**
 * The extraction contract's JSON Schema, generated per ruleset (2026-10-03).
 *
 * `extractionSchema(ruleset)` reads the ruleset's `fields` block and emits one property per field term (the role names,
 * e.g. PAYABLE, each described by its published `term`, e.g. "BT-115 Amount due for payment"), typed by field kind, each
 * with a required provenance object. Document fields go under `fields`, line fields under `lines[].fields`. Every field
 * must be accounted for: read (present), or named in `not_printed` with the labels searched. A term the ruleset does not
 * have is refused. A new declarative ruleset gets its schema for free.
 *
 * The legal ruleset is built in and has no `fields` block. Its citation parts are declared here (LEGAL_CITATION_FIELDS) and
 * get the same treatment: `quote` and `proposition` are read off the page; `cite`, `case_name` and `source_key` are keys a
 * citation resolver supplies, so they may carry `{ reader: "supplied", source }` provenance instead of a page.
 *
 * A LIST field (`each`, e.g. every VAT breakdown row's tax amount; added 2026-10-03, T2) is an array: one item per element,
 * in printed order, each item its own value and provenance ("UNREADABLE" with its readings, like any field), at least one
 * item; a list the page does not print is named in `not_printed`. A ruleset without a list field gets exactly the schema it
 * got before.
 */

import type { DeclarativeRuleset, DeclField } from '../declarative/types.js'
import { CONTRACT_VERSION, UNREADABLE, rulesetRef } from './contract.js'
import { validateSchema, type JsonSchema, type SchemaViolation } from './jsonschema.js'
import { defaultLegalRuleset } from '../legal/index.js' // 2026-10-05: a bare "legal" means the engine's default rule (defaultLegalRuleset: 0.5.2 under engine 0.6.0 from 2026-10-06, 0.0.1 before engine 0.6.0), not a fixed version

const SCHEMA_DIALECT = 'https://json-schema.org/draft/2020-12/schema'

/** The legal ruleset's citation parts (verify's `Citation`, src/legal/index.ts), as a field block. */
export const LEGAL_CITATION_FIELDS: Readonly<Record<string, { kind: 'string'; read: 'page' | 'supplied'; term: string }>> = Object.freeze({
  quote: { kind: 'string', read: 'page', term: 'the passage the filing attributes to the authority, as printed (checked verbatim against the opinion)' },
  proposition: { kind: 'string', read: 'page', term: 'what the filing says the authority stands for (recorded; not decided deterministically)' },
  cite: { kind: 'string', read: 'supplied', term: 'the reporter citation, e.g. 550 U.S. 544' },
  case_name: { kind: 'string', read: 'supplied', term: 'the case name, e.g. Bell Atlantic Corp. v. Twombly' },
  source_key: { kind: 'string', read: 'supplied', term: 'which supplied opinion text the quotation is checked against' },
})

const KIND_DEF: Record<string, string> = { amount: 'field_number', price: 'field_number', quantity: 'field_number', rate: 'field_number', identifier: 'field_text', string: 'field_text', bool: 'field_bool' }
const defFor = (f: Pick<DeclField, 'kind'>): string => KIND_DEF[f.kind ?? 'amount'] ?? 'field_number'

const unreadableNeedsReadings = {
  if: { required: ['value'], properties: { value: { const: UNREADABLE } } },
  then: { properties: { provenance: { required: ['readings'], properties: { readings: { type: 'array', minItems: 1 } } } } },
}
const fieldDef = (value: JsonSchema, provenance: JsonSchema, what: string): JsonSchema => ({
  type: 'object', required: ['value', 'provenance'], additionalProperties: false,
  properties: {
    value: { anyOf: [value, { const: UNREADABLE }], 'x-violation': { message: `must be ${what} or "${UNREADABLE}"` } },
    provenance,
  },
  ...unreadableNeedsReadings,
})

/**
 * Engine 0.4.0 (2026-10-04): archive provenance, accepted only when the ruleset lists `"provenance_kinds": ["archive"]`
 * (docs/EVIDENCE.md). Without it a schema is exactly what it was.
 */
const ARCHIVE_PROVENANCE: JsonSchema = {
  type: 'object', required: ['kind', 'url', 'retrieved_at', 'sha256', 'reader', 'raw'], additionalProperties: false,
  description: 'a value read from a file an archive serves: its url (and member), when it was retrieved, the sha256 of the bytes read, the checksum the archive publishes when it publishes one, the reader and the cell read; the engine reads it as E1, never E0',
  properties: {
    kind: { const: 'archive' }, url: { type: 'string', minLength: 1 }, retrieved_at: { type: 'string', minLength: 1 },
    sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' }, member: { type: 'string', minLength: 1 },
    container_sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    archive_checksum: {
      type: 'object', required: ['algorithm', 'value'], additionalProperties: false,
      properties: { algorithm: { enum: ['md5', 'sha1', 'sha256', 'sha512'] }, value: { type: 'string', pattern: '^[0-9a-fA-F]+$' }, published_at: { type: 'string' } },
    },
    reader: { type: 'string', minLength: 1 }, raw: { type: 'string' }, locator: { type: 'string' },
    readings: { type: 'array', items: { $ref: '#/$defs/reading' } },
    tier: { enum: ['E1', 'E2', 'E3'] },
  },
}

/**
 * Engine 0.5.0 (2026-10-04): a value's own quality flag, accepted in provenance only when the ruleset declares a flags choice
 * (docs/CHOICES.md). The scheme says what the flag means; the provenance's `meaning` is the extractor's note and is not used.
 */
const QC_PROVENANCE: JsonSchema = {
  type: 'object', required: ['scheme', 'flag'], additionalProperties: false,
  description: 'the value\'s own quality flag, in a scheme this build carries (src/schemes): read through the ruleset\'s flags choice',
  properties: { scheme: { type: 'string', minLength: 1 }, flag: { anyOf: [{ type: 'integer', minimum: 0, maximum: 9 }, { type: 'string', minLength: 1, maxLength: 1 }] }, meaning: { type: 'string' } },
}

/** Engine 0.5.0: a claim document's fill for one choice slot: stated with a quoted span, or marked silent. */
const CHOICE_FILL: JsonSchema = {
  anyOf: [
    {
      type: 'object', required: ['value', 'stated', 'span'], additionalProperties: false,
      properties: {
        value: { anyOf: [{ type: 'number' }, { type: 'string', minLength: 1 }, { type: 'object' }] }, stated: { const: true },
        span: {
          type: 'object', required: ['quote'], additionalProperties: false,
          properties: { page: { type: 'integer', minimum: 1 }, section: { type: 'string', minLength: 1 }, quote: { type: 'string', minLength: 1 } },
          anyOf: [{ required: ['page'] }, { required: ['section'] }],
        },
      },
    },
    { type: 'object', required: ['unstated'], additionalProperties: false, properties: { unstated: { const: true } } },
  ],
  'x-violation': { message: 'must be { value, stated: true, span: { page or section, quote } } (stated by the document) or { unstated: true }' },
}

/** The shared definitions every contract schema carries (`archive`: the ruleset accepts archive provenance, engine 0.4.0; `qc`: the ruleset declares a flags choice, engine 0.5.0). */
function commonDefs(archive = false, qc = false): Record<string, JsonSchema> {
  const prov: JsonSchema = archive
    ? { anyOf: [{ $ref: '#/$defs/provenance' }, { $ref: '#/$defs/archive_provenance' }], 'x-violation': { message: 'must be a page provenance {page, line, raw, reader} or an archive provenance {kind: "archive", url, retrieved_at, sha256, reader, raw}' } }
    : { $ref: '#/$defs/provenance' }
  const withQc = (s: JsonSchema): JsonSchema => (qc ? { ...s, properties: { ...(s.properties as Record<string, JsonSchema>), qc: { $ref: '#/$defs/qc' } } } : s)
  return {
    ...(archive ? { archive_provenance: withQc(ARCHIVE_PROVENANCE) } : {}),
    ...(qc ? { qc: QC_PROVENANCE } : {}),
    provenance: withQc({
      type: 'object', required: ['page', 'line', 'raw', 'reader'], additionalProperties: false,
      description: 'where the value was read: page and line (1-based), the exact string read, and the reader (both readers joined by "+" when two agreed)',
      properties: {
        page: { type: 'integer', minimum: 1 }, line: { type: 'integer', minimum: 1 }, raw: { type: 'string' },
        reader: { type: 'string', minLength: 1 }, line_text: { type: 'string' },
        readings: { type: 'array', items: { $ref: '#/$defs/reading' } },
        tier: { enum: ['E1', 'E2', 'E3'], description: 'the evidence tier the reading supports (E1 structured, E2 PDF text layer, E3 OCR); optional; the engine uses the worse of this and what the readers support' },
      },
    }),
    reading: {
      type: 'object', required: ['reader', 'raw'], additionalProperties: false,
      description: "one reader's reading: the raw string (null when it read nothing), where, and why it is not a value",
      properties: {
        reader: { type: 'string', minLength: 1 }, raw: { type: ['string', 'null'] }, page: { type: 'integer', minimum: 1 },
        line: { type: 'integer', minimum: 1 }, line_text: { type: 'string' }, note: { type: 'string' },
      },
    },
    supplied: {
      type: 'object', required: ['reader', 'source'], additionalProperties: false,
      description: 'a value the page does not print, supplied by the caller (e.g. a citation resolver)',
      properties: { reader: { const: 'supplied' }, source: { type: 'string', minLength: 1 }, raw: { type: 'string' } },
    },
    not_printed: {
      type: 'object', required: ['labels_searched'], additionalProperties: false,
      description: 'a field the page does not print: ABSENT, never guessed',
      properties: { labels_searched: { type: 'array', items: { type: 'string' } }, note: { type: 'string' } },
    },
    field_number: fieldDef({ type: 'number' }, prov, 'a number'),
    field_text: fieldDef({ type: 'string', pattern: '\\S' }, prov, 'a non-blank string'),
    field_bool: fieldDef({ type: 'boolean' }, prov, 'true or false'),
  }
}

const accounted = (role: string, what: string, fieldsKey: string): JsonSchema => ({
  anyOf: [
    { required: [fieldsKey], properties: { [fieldsKey]: { required: [role] } } },
    { required: ['not_printed'], properties: { not_printed: { required: [role] } } },
  ],
  'x-violation': {
    pointer: `/${fieldsKey}/${role}`,
    message: `${role}${what ? ` (${what})` : ''} is neither read (under "${fieldsKey}") nor named in "not_printed" with the labels searched: the contract accounts for every field`,
  },
})

const fieldProperty = (role: string, f: DeclField): JsonSchema => ({
  $ref: `#/$defs/${defFor(f)}`,
  description: f.term ?? role,
  'x-kind': f.kind ?? 'amount',
  'x-paths': f.paths,
  ...(f.labels?.length ? { 'x-labels': f.labels } : {}),
  ...(f.default !== undefined ? { 'x-default-when-absent': f.default } : {}),
})

/** A list field (`each`): one item per element, each with its own value and provenance (2026-10-03, T2). */
const listProperty = (role: string, f: DeclField): JsonSchema => ({
  type: 'array',
  minItems: 1,
  items: { $ref: `#/$defs/${defFor(f)}` },
  description: `${f.term ?? role}: one item per element, in printed order, each with its own value and provenance`,
  'x-kind': f.kind ?? 'amount',
  'x-each': f.each,
  'x-paths': f.paths,
})

function declarativeSchema(rs: DeclarativeRuleset): JsonSchema {
  const entries = Object.entries(rs.fields)
  const doc = entries.filter(([, f]) => !f.line)
  const line = entries.filter(([, f]) => f.line)
  const ref = rulesetRef(rs)
  // engine 0.5.0: a ruleset with choice slots accepts the document's fills, and one with a flags choice accepts `qc`
  const slots = Array.isArray(rs.choices) ? rs.choices.filter(c => c !== null && typeof c === 'object' && typeof c.id === 'string') : []
  const flagsChoice = slots.some(c => c.kind === 'flags' && c.not_applicable === undefined)
  const defs = commonDefs(Array.isArray(rs.provenance_kinds) && rs.provenance_kinds.includes('archive'), flagsChoice)
  if (slots.length) defs.choice_fill = CHOICE_FILL
  defs.line = {
    type: 'object', required: ['fields'], additionalProperties: false,
    description: 'one line item: its line fields, each read or named in not_printed',
    properties: {
      fields: { type: 'object', additionalProperties: false, properties: Object.fromEntries(line.map(([r, f]) => [r, fieldProperty(r, f)])) },
      not_printed: { type: 'object', additionalProperties: false, properties: Object.fromEntries(line.map(([r]) => [r, { $ref: '#/$defs/not_printed' }])) },
    },
    ...(line.length ? { allOf: line.map(([r, f]) => accounted(r, f.term ?? '', 'fields')) } : {}),
  }
  return {
    $schema: SCHEMA_DIALECT,
    $id: `urn:verify:extraction-contract:${CONTRACT_VERSION}:${ref}`,
    title: `Extraction contract ${CONTRACT_VERSION} for ${ref}`,
    description: `What an extractor hands verify for ruleset ${ref} when the ruleset requires the contract: the ruleset's own field terms, typed by kind, each with its provenance {page, line, raw, reader}; "${UNREADABLE}" with the readings kept for a value that was seen and could not be read; every field read or named in not_printed. Generated from the ruleset's fields block.`,
    type: 'object',
    required: ['extraction_contract', 'ruleset', 'fields'],
    additionalProperties: false,
    properties: {
      extraction_contract: { const: CONTRACT_VERSION },
      ruleset: { const: ref },
      document: { type: 'object', description: 'about the document read: sha256, pages, route, readers (free-form, recorded)' },
      fields: { type: 'object', additionalProperties: false, properties: Object.fromEntries(doc.map(([r, f]) => [r, Array.isArray(f.each) ? listProperty(r, f) : fieldProperty(r, f)])) },
      not_printed: { type: 'object', additionalProperties: false, properties: Object.fromEntries(entries.filter(([, f]) => !f.line).map(([r]) => [r, { $ref: '#/$defs/not_printed' }])) },
      lines: { type: 'array', items: { $ref: '#/$defs/line' }, description: line.length ? 'the line items, in printed order' : 'this ruleset reads no line fields' },
      ...(slots.length ? { choices: { type: 'object', additionalProperties: false, description: 'the document\'s fills for the ruleset\'s choice slots (engine 0.5.0): each stated with a quoted span, or marked silent; a slot left out is supplied by the ruleset\'s default or is unstated', properties: Object.fromEntries(slots.map(c => [c.id, { $ref: '#/$defs/choice_fill' }])) } } : {}),
    },
    ...(doc.length ? { allOf: doc.map(([r, f]) => accounted(r, f.term ?? '', 'fields')) } : {}),
    $defs: defs,
  }
}

function legalSchema(version: string): JsonSchema {
  const ref = `legal@${version}`
  const defs = commonDefs()
  defs.field_text_supplied = fieldDef({ type: 'string', pattern: '\\S' }, { anyOf: [{ $ref: '#/$defs/provenance' }, { $ref: '#/$defs/supplied' }], 'x-violation': { message: 'must be a page provenance {page, line, raw, reader} or {reader: "supplied", source}' } }, 'a non-blank string')
  const parts = Object.entries(LEGAL_CITATION_FIELDS)
  defs.citation = {
    type: 'object', required: ['id', 'fields'], additionalProperties: false,
    properties: {
      id: { type: 'string', minLength: 1 },
      fields: {
        type: 'object', additionalProperties: false,
        properties: Object.fromEntries(parts.map(([k, p]) => [k, { $ref: p.read === 'page' ? '#/$defs/field_text' : '#/$defs/field_text_supplied', description: p.term }])),
      },
      not_printed: { type: 'object', additionalProperties: false, properties: Object.fromEntries(parts.map(([k]) => [k, { $ref: '#/$defs/not_printed' }])) },
    },
    allOf: parts.filter(([, p]) => p.read === 'page').map(([k, p]) => accounted(k, p.term, 'fields')),
  }
  defs.source_text = {
    type: 'object', required: ['text', 'provenance'], additionalProperties: false,
    description: 'a reference text (an opinion): canonicalized as the contract says, with the reader that produced it and its sha256',
    properties: {
      text: { type: 'string' },
      provenance: {
        type: 'object', required: ['reader', 'sha256'], additionalProperties: false,
        properties: {
          reader: { type: 'string', minLength: 1 }, sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
          raw_sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' }, pages: { type: 'integer', minimum: 1 },
          canonicalized: { type: 'boolean' }, source: { type: 'string' },
        },
      },
    },
  }
  return {
    $schema: SCHEMA_DIALECT,
    $id: `urn:verify:extraction-contract:${CONTRACT_VERSION}:${ref}`,
    title: `Extraction contract ${CONTRACT_VERSION} for ${ref}`,
    description: `What an extractor hands the legal citation check: per citation, the quotation (or proposition) read off the page with its provenance, "${UNREADABLE}" with the readings kept when it could not be read, and the resolver's keys (cite, case_name, source_key); reference texts with their reader and sha256.`,
    type: 'object',
    required: ['extraction_contract', 'ruleset', 'citations'],
    additionalProperties: false,
    properties: {
      extraction_contract: { const: CONTRACT_VERSION },
      ruleset: { const: ref },
      document: { type: 'object' },
      citations: { type: 'array', items: { $ref: '#/$defs/citation' } },
      sources: { type: 'object', additionalProperties: { $ref: '#/$defs/source_text' } },
    },
    $defs: defs,
  }
}

/** A ruleset the contract covers: a declarative ruleset, or the built-in legal ruleset by name ('legal', 'legal@<version>'). */
export type ContractRuleset = DeclarativeRuleset | string

/** The legal version a name means, or undefined when the name is not the legal ruleset's. */
export function legalVersionOf(name: string): string | undefined {
  const [id, version] = name.split('@') as [string, string | undefined]
  if (id !== 'legal') return undefined
  return version ?? defaultLegalRuleset().version
}

/** The JSON Schema an extraction for `ruleset` must satisfy under the contract. */
export function extractionSchema(ruleset: ContractRuleset): JsonSchema {
  if (typeof ruleset === 'string') {
    const v = legalVersionOf(ruleset)
    if (v === undefined) throw new Error(`no extraction contract for "${ruleset}": pass a declarative ruleset, or "legal" / "legal@<version>"`)
    return legalSchema(v)
  }
  return declarativeSchema(ruleset)
}

/** One way an envelope breaks its contract: a typed code, where (a JSON Pointer), and what is wrong. */
export interface ContractViolation {
  code: 'contract.not_envelope' | 'contract.version' | 'contract.ruleset' | 'contract.unknown_term' | 'contract.provenance' | 'contract.unaccounted' | 'contract.missing' | 'contract.invalid_value'
  pointer: string
  message: string
}

function codeOf(v: SchemaViolation): ContractViolation['code'] {
  if (v.pointer === '/extraction_contract') return v.keyword === 'required' ? 'contract.not_envelope' : 'contract.version'
  if (v.pointer === '/ruleset') return 'contract.ruleset'
  if (v.keyword === 'additionalProperties') return 'contract.unknown_term'
  if (v.keyword === 'x-violation' && v.message.includes('neither read')) return 'contract.unaccounted'
  if (/\/provenance(\/|$)/.test(v.pointer)) return 'contract.provenance'
  if (v.keyword === 'required') return 'contract.missing'
  return 'contract.invalid_value'
}

/** Every violation of the contract, first one first (the schema's own order). An empty list means the envelope satisfies it. */
export function validateContract(x: unknown, ruleset: ContractRuleset): ContractViolation[] {
  if (x === null || typeof x !== 'object' || Array.isArray(x) || typeof (x as { extraction_contract?: unknown }).extraction_contract !== 'string') {
    return [{ code: 'contract.not_envelope', pointer: '', message: `the extraction is not an extraction-contract envelope (it has no "extraction_contract": "${CONTRACT_VERSION}"): the ruleset requires one, with every field's provenance` }]
  }
  const schema = extractionSchema(ruleset)
  return validateSchema(x, schema).map(v => ({ code: codeOf(v), pointer: v.pointer, message: v.message }))
}
