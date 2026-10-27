/**
 * The parties file of an arbitration case (engine 0.3.0, 2026-10-03; docs/EVIDENCE.md): who may move, by which key, and
 * which systems of record count as E0.
 *
 *   {
 *     "format": "verify-parties/1",
 *     "parties": [ { "id": "buyer-ap", "role": "filer", "public_key": "-----BEGIN PUBLIC KEY-----…" },
 *                  { "id": "vendor", "role": "counterparty", "public_key": "…" },
 *                  { "id": "controller", "role": "operator", "public_key": "…", "held": false } ],
 *     "sources": [ { "id": "bank:acme-operating", "tier": "E0", "public_key": "…", "label": "operating account statements" } ],
 *     "clock": { "ordinary_days": 5, "suspect_days": 2 },
 *     "readers": { "tesseract": "…", "pdftoppm": "…" }
 *   }
 *
 * A move names its signer by key fingerprint only; the public key comes from here, never from the move, so a key that is not
 * enrolled is refused by lookup before any signature is checked (the governance pattern). A held party moves nothing. A source is
 * a system of record's signing key: a statement it signs is E0; nothing else is.
 */

import { keyFingerprint, legacyKeyFingerprint } from '../ledger/registry.js'
import type { OcrSetting } from '../extract/readers.js'

export const PARTIES_FORMAT = 'verify-parties/1'
export type PartyRole = 'filer' | 'counterparty' | 'operator'
export const PARTY_ROLES: readonly PartyRole[] = ['filer', 'counterparty', 'operator']

export interface Party { id: string; role: PartyRole; public_key: string; held?: boolean }
export interface Source { id: string; tier: 'E0'; public_key: string; label?: string }
/** Working days (Monday to Friday, UTC) a case stays open: an ordinary case, and one with a suspect field. */
export interface CaseClock { ordinary_days: number; suspect_days: number }
/** Where the readers that re-read a PDF live, and their settings (the extraction contract's reference extractor). */
export interface CaseReaders { tesseract?: string; pdftoppm?: string; work_dir?: string; ocr_a?: OcrSetting; ocr_a_scan?: OcrSetting; ocr_b?: OcrSetting }
export interface PartiesFile { format: typeof PARTIES_FORMAT; parties: Party[]; sources?: Source[]; clock?: Partial<CaseClock>; readers?: CaseReaders }

export const DEFAULT_CLOCK: CaseClock = { ordinary_days: 5, suspect_days: 2 }

const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x)
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,95}$/

/** Problems with a parties file (empty = well formed). Every key must be an Ed25519 public key; ids and fingerprints unique. */
export function partiesProblems(x: unknown): string[] {
  if (!isObj(x)) return ['the parties file is not a JSON object']
  const out: string[] = []
  if (x.format !== PARTIES_FORMAT) out.push(`format must be "${PARTIES_FORMAT}"`)
  for (const k of Object.keys(x)) if (!['format', 'parties', 'sources', 'clock', 'readers'].includes(k)) out.push(`unknown key "${k}"`)
  const seenId = new Set<string>(), seenFp = new Set<string>()
  const key = (where: string, pem: unknown): void => {
    const fp = typeof pem === 'string' ? keyFingerprint(pem) : undefined
    if (fp === undefined) { out.push(`${where}: public_key must be an Ed25519 public key (PEM)`); return }
    if (seenFp.has(fp)) out.push(`${where}: the same key is enrolled twice`)
    seenFp.add(fp)
  }
  if (!Array.isArray(x.parties) || !x.parties.length) out.push('parties: a non-empty list')
  else x.parties.forEach((p, i) => {
    const w = `parties[${i}]`
    if (!isObj(p)) { out.push(`${w}: not an object`); return }
    if (typeof p.id !== 'string' || !ID.test(p.id)) out.push(`${w}: id must be a short name`)
    else if (seenId.has(p.id)) out.push(`${w}: id "${p.id}" is used twice`)
    else seenId.add(p.id)
    if (!PARTY_ROLES.includes(p.role as PartyRole)) out.push(`${w}: role must be one of ${PARTY_ROLES.join(', ')}`)
    if (p.held !== undefined && typeof p.held !== 'boolean') out.push(`${w}: held must be true or false`)
    key(w, p.public_key)
  })
  if (x.sources !== undefined) {
    if (!Array.isArray(x.sources)) out.push('sources: a list')
    else x.sources.forEach((s, i) => {
      const w = `sources[${i}]`
      if (!isObj(s)) { out.push(`${w}: not an object`); return }
      if (typeof s.id !== 'string' || !ID.test(s.id)) out.push(`${w}: id must be a short name`)
      else if (seenId.has(s.id)) out.push(`${w}: id "${s.id}" is used twice`)
      else seenId.add(s.id)
      if (s.tier !== 'E0') out.push(`${w}: tier must be "E0" (a source is a system of record's signing key)`)
      key(w, s.public_key)
    })
  }
  if (x.clock !== undefined) {
    if (!isObj(x.clock)) out.push('clock: an object { ordinary_days, suspect_days }')
    else for (const k of ['ordinary_days', 'suspect_days'] as const) {
      const v = x.clock[k]
      if (v !== undefined && !(Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 60)) out.push(`clock.${k}: a whole number of working days, 1 to 60`)
    }
  }
  if (x.readers !== undefined && !isObj(x.readers)) out.push('readers: an object')
  return out
}

/** The parties file, checked; throws on a malformed one (the case refuses to open on it). */
export function readParties(x: unknown): PartiesFile {
  const p = partiesProblems(x)
  if (p.length) throw new Error(`parties file refused: ${p.join('; ')}`)
  return x as PartiesFile
}

export const clockOf = (pf: PartiesFile): CaseClock => ({ ...DEFAULT_CLOCK, ...(pf.clock ?? {}) })

/**
 * The enrolled party a key fingerprint names, or undefined. A move written before 2026-10-05 names its signer in the older
 * fingerprint form (registry.ts legacyKeyFingerprint), so either form is read; a new move is written with keyFingerprint.
 */
export function partyByFingerprint(pf: PartiesFile, fp: string): Party | undefined {
  return pf.parties.find(p => keyFingerprint(p.public_key) === fp) ?? pf.parties.find(p => legacyKeyFingerprint(p.public_key) === fp)
}

/** The enrolled source with this id, or undefined. */
export function sourceById(pf: PartiesFile, id: string): Source | undefined {
  return (pf.sources ?? []).find(s => s.id === id)
}

export { keyFingerprint }
