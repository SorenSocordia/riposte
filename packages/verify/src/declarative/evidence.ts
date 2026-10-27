/**
 * Evidence tiers and the evidence overlay (engine 0.3.0, 2026-10-03; docs/EVIDENCE.md).
 *
 * THE LADDER (the same ladder model attestation uses, applied to what a field rests on):
 *   E0  pulled from a system of record through an authenticated channel: in this build, a statement signed by a source key
 *       enrolled in a case's parties file (src/arbitration). Nobody can claim it by saying so.
 *   E1  a structured document whose fields are machine-native (UBL XML), read by the engine itself
 *   E2  a PDF's own text layer
 *   E3  OCR of a scan or an image
 *   E4  a human's assertion ("the amount is 400.00"): never evidence on its own, never load-bearing
 * and two words that are not tiers: `unstated` (a value that carries no provenance at all: a plain extraction, the legacy input)
 * and, for a floor, `none` (nothing was computed).
 *
 * RULES
 *  - A tier is never raised by a party's say-so. An envelope's provenance may state E1, E2 or E3; the engine also infers one
 *    from the reader names and uses the WORSE of the two, recording a finding when the stated one was better. E0 is the
 *    engine's own (a verified source signature) and is never accepted from an envelope.
 *  - Corroboration raises SUPPORT, not tier: a value keeps its tier; `supported_at` is the best tier among independent sources
 *    that agree with it within tolerance.
 *  - When tiers conflict on one field, the higher tier wins for the computation and the conflict is a finding. Two different
 *    values at one tier with nothing higher: nothing ranks them, and the field is struck (reason `conflict`).
 *
 * THE OVERLAY is how an arbitration move reaches a verdict: the evidence the engine READ from a filed document or a signed
 * source (never a value a party typed), per field path. It is part of the verdict's input (input_hash), so a re-verdict replays
 * from { extraction, ruleset, source?, evidence }. A case's replay (src/arbitration) re-derives the overlay from the signed moves
 * and the documents; an overlay presented without its case is an unverified input, like any extraction.
 */

import type { EvidenceFloor, EvidenceTier } from '../verdict/schema.js'

/** One piece of evidence the engine read for one field: from a CORRECT (a document) or a CORROBORATE (a source). */
export interface EvidenceItem {
  /** the value as the engine read it (a number for an amount, price or quantity; text for an identifier or string) */
  value: number | string
  /** E0-E3 only: an E4 value never enters an overlay */
  tier: 'E0' | 'E1' | 'E2' | 'E3'
  kind: 'correct' | 'corroborate'
  /** who the evidence comes from, for independence: `document:<sha256>`, or a source id such as `bank:acme-operating` */
  source_id: string
  /** the move that filed it */
  move_id: string
  document_sha256?: string
  /** how it was read: the readers ("pdf-text-layer+ocr-a"), the XPath, or the statement locator */
  reader?: string
  page?: number
  line?: number
  /** the exact string read */
  raw?: string
  locator?: string
}

/** A field or the whole document withdrawn by a STRIKE. */
export interface EvidenceStrike {
  /** the field's path in the extraction (absent when the whole document is struck) */
  path?: string
  document?: true
  move_id: string
  reason: string
}

export interface EvidenceOverlay {
  /** extraction path → the evidence read for it, in filing order */
  fields?: Record<string, EvidenceItem[]>
  struck?: EvidenceStrike[]
}

export const TIERS: readonly EvidenceTier[] = ['E0', 'E1', 'E2', 'E3', 'E4']
const RANK: Record<string, number> = { E0: 0, E1: 1, E2: 2, E3: 3, unstated: 4, E4: 5, none: -1 }

/** Lower is stronger: E0 < E1 < E2 < E3 < unstated < E4. */
export function tierRank(t: EvidenceTier | 'unstated'): number {
  return RANK[t] ?? 5
}

/** The stronger of two tiers. */
export const betterTier = <T extends EvidenceTier | 'unstated'>(a: T, b: T): T => (tierRank(a) <= tierRank(b) ? a : b)
/** The weaker of two tiers. */
export const worseTier = <T extends EvidenceTier | 'unstated'>(a: T, b: T): T => (tierRank(a) >= tierRank(b) ? a : b)

export const isTier = (x: unknown): x is EvidenceTier => typeof x === 'string' && (TIERS as readonly string[]).includes(x)

/** A reader name that reads a structured document's own fields (no reading of a rendered page). */
const STRUCTURED = /(^|[^a-z])(xml|ubl|cii|structured|xbrl)([^a-z]|$)/i

/**
 * The tier a page reading supports, from its reader names alone (`reader` is one name, or two joined by "+"; a multi-page
 * route joins per-page names with "|"): a structured reader → E1; a text layer read first (born-digital, confirmed by the
 * second reader) → E2; anything else read off a page → E3; `supplied` (a value the page does not print) → E4.
 */
export function inferTier(reader: string | undefined): EvidenceTier {
  if (typeof reader !== 'string' || reader.trim() === '') return 'E4'
  const names = reader.split('+').map(s => s.trim())
  if (names.some(n => n === 'supplied')) return 'E4'
  if (names.every(n => STRUCTURED.test(n))) return 'E1'
  const first = names[0] ?? ''
  if (!first.includes('|') && /text-layer/i.test(first)) return 'E2'
  return 'E3'
}

/**
 * The tier an envelope field rests on, from its provenance: the worse of the stated tier (E1-E3) and the inferred one. A
 * stated tier better than the inferred one, or a stated E0, is `capped` (a finding). No provenance, `supplied`, or a stated E4:
 * E4 (struck as an unsupported assertion).
 */
export function provenanceTier(p: unknown, opts: { archive?: boolean } = {}): { tier: EvidenceTier; capped?: { stated: string; inferred: EvidenceTier } } {
  // (engine 0.4.0: `opts.archive` reads archive provenance, see archiveTier below; without it nothing here changed)
  if (p === null || typeof p !== 'object' || Array.isArray(p)) return { tier: 'E4' }
  // Engine 0.4.0: archive provenance. Read only when the caller says so (the evaluator, under engine 0.4.0).
  if (opts.archive && (p as { kind?: unknown }).kind === 'archive') return archiveTier(p)
  const pr = p as { reader?: unknown; tier?: unknown }
  const inferred = inferTier(typeof pr.reader === 'string' ? pr.reader : undefined)
  if (pr.tier === undefined) return { tier: inferred }
  if (pr.tier === 'E4') return { tier: 'E4' }
  if (!isTier(pr.tier) || pr.tier === 'E0') return { tier: inferred, capped: { stated: String(pr.tier), inferred } }
  if (tierRank(pr.tier) < tierRank(inferred)) return { tier: inferred, capped: { stated: pr.tier, inferred } }
  return { tier: pr.tier }
}

/**
 * ARCHIVE PROVENANCE (engine 0.4.0, 2026-10-04; docs/EVIDENCE.md "Archive provenance"): a value read from a file an
 * archive serves (a SPARC table, a MAST product, a Zenodo deposit).
 *   { kind: 'archive', url, retrieved_at, sha256, member?, container_sha256?, archive_checksum?: { algorithm, value, published_at? },
 *     reader, raw, locator? }
 * Its tier is E1: a machine-native table read by its declared format. NEVER E0: no archive signs its files with a key enrolled in
 * a parties file, and a checksum published over TLS is not a signature. Whether the archive's own checksum matches is a separate
 * fact the engine establishes from the bytes (`checksum_verified` in the verdict's `archives` block), never from the envelope.
 * A malformed archive provenance (no url, no retrieval time, no 64-hex sha256, no reader) is an assertion: E4. A stated tier
 * other than E1 is capped (a finding), as for any provenance.
 */
export interface ArchiveProvenanceShape {
  kind: 'archive'
  url: string
  retrieved_at: string
  sha256: string
  member?: string
  container_sha256?: string
  archive_checksum?: { algorithm: 'md5' | 'sha1' | 'sha256' | 'sha512'; value: string; published_at?: string }
  reader: string
  raw?: string
  locator?: string
  tier?: string
}

/** Why an archive provenance is malformed (empty = well formed). */
export function archiveProvenanceProblems(p: unknown): string[] {
  if (p === null || typeof p !== 'object' || Array.isArray(p)) return ['not an object']
  const a = p as Record<string, unknown>
  const out: string[] = []
  if (typeof a.url !== 'string' || !a.url.trim()) out.push('no url')
  if (typeof a.retrieved_at !== 'string' || !a.retrieved_at.trim()) out.push('no retrieved_at')
  if (typeof a.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(a.sha256)) out.push('no 64-hex sha256 of the content')
  if (typeof a.reader !== 'string' || !a.reader.trim()) out.push('no reader')
  if (a.archive_checksum !== undefined) {
    const c = a.archive_checksum as Record<string, unknown> | null
    if (!c || typeof c !== 'object' || !['md5', 'sha1', 'sha256', 'sha512'].includes(String(c.algorithm)) || typeof c.value !== 'string' || !/^[0-9a-fA-F]+$/.test(c.value)) out.push('archive_checksum must be { algorithm: md5 | sha1 | sha256 | sha512, value: hex, published_at? }')
  }
  return out
}

function archiveTier(p: unknown): { tier: EvidenceTier; capped?: { stated: string; inferred: EvidenceTier } } {
  if (archiveProvenanceProblems(p).length) return { tier: 'E4' }
  const stated = (p as { tier?: unknown }).tier
  if (stated === undefined || stated === 'E1') return { tier: 'E1' }
  if (stated === 'E4') return { tier: 'E4' }
  // the worse of the stated and the inferred tier: a stated E2 or E3 stands; a stated E0 (or anything else) is capped at E1
  if (stated === 'E2' || stated === 'E3') return { tier: stated }
  return { tier: 'E1', capped: { stated: String(stated), inferred: 'E1' } }
}

/** The floor of a set of effective tiers: the worst; `none` when the set is empty. */
export function floorOf(tiers: readonly (EvidenceTier | 'unstated')[]): EvidenceFloor {
  if (!tiers.length) return 'none'
  return tiers.reduce((a, b) => worseTier(a, b))
}

/** Problems with an overlay's shape (empty = well formed). The evaluator refuses a malformed overlay rather than guess. */
export function overlayProblems(x: unknown): string[] {
  if (x === null || typeof x !== 'object' || Array.isArray(x)) return ['the evidence overlay is not an object']
  const o = x as Record<string, unknown>
  const out: string[] = []
  for (const k of Object.keys(o)) if (k !== 'fields' && k !== 'struck') out.push(`unknown overlay key "${k}"`)
  if (o.fields !== undefined) {
    if (o.fields === null || typeof o.fields !== 'object' || Array.isArray(o.fields)) out.push('fields must be an object: path → [evidence items]')
    else for (const [path, items] of Object.entries(o.fields as Record<string, unknown>)) {
      if (!Array.isArray(items) || !items.length) { out.push(`fields.${path}: a non-empty list of evidence items`); continue }
      items.forEach((it, i) => {
        const e = it as Record<string, unknown>
        const at = `fields.${path}[${i}]`
        if (!e || typeof e !== 'object') { out.push(`${at}: not an object`); return }
        if (!(typeof e.value === 'number' && Number.isFinite(e.value)) && typeof e.value !== 'string') out.push(`${at}: value must be a number or a string`)
        if (e.tier !== 'E0' && e.tier !== 'E1' && e.tier !== 'E2' && e.tier !== 'E3') out.push(`${at}: tier must be E0, E1, E2 or E3 (an E4 value never enters an overlay)`)
        if (e.kind !== 'correct' && e.kind !== 'corroborate') out.push(`${at}: kind must be correct or corroborate`)
        if (typeof e.source_id !== 'string' || !e.source_id) out.push(`${at}: source_id is required`)
        if (typeof e.move_id !== 'string' || !e.move_id) out.push(`${at}: move_id is required`)
      })
    }
  }
  if (o.struck !== undefined) {
    if (!Array.isArray(o.struck)) out.push('struck must be a list')
    else (o.struck as unknown[]).forEach((s, i) => {
      const e = s as Record<string, unknown>
      if (!e || typeof e !== 'object') { out.push(`struck[${i}]: not an object`); return }
      if (e.document !== true && (typeof e.path !== 'string' || !e.path)) out.push(`struck[${i}]: names a path, or document: true`)
      if (typeof e.move_id !== 'string' || !e.move_id) out.push(`struck[${i}]: move_id is required`)
      if (typeof e.reason !== 'string' || !e.reason.trim()) out.push(`struck[${i}]: reason is required`)
    })
  }
  return out
}
