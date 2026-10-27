/**
 * The prereg's recorded sha256 chain, read the way runs record it, and verified against the file.
 *
 * A chain source is one of:
 *   <file>              a hash list: sha256sum lines (`<hex> *name`, `<hex>  name`), with any of the forms runs use beside
 *                       them: `# comment` lines (the note of the next record), bare timestamp lines (`hashed 2026-…Z`, the
 *                       time of the records above them), `amendment1  <hex>  <time>` rows, `v0  <time>  sha256 <hex>  name`
 *                       rows. A record names the document after its hash; a record that names none belongs to the sidecar's
 *                       own document (`PREREG.sha256` → `PREREG.md`), and is ignored in a list that is not a sidecar.
 *   <file>#<json.path>  one hash stored in a JSON file at that path (a run output's `prereg_sha256`)
 *   <file>:<line>       one hash written on that line of a text file (a hash the prereg records about its own frozen text)
 * The default source is the sidecar beside the prereg (`<stem>.sha256`). The documents a chain is read for default to the
 * prereg's own file name; a run that froze snapshots (`PREREG-v0.frozen.md`, `PREREG-final.frozen.md`) names them.
 *
 * Verification refuses (BenchRefused), and nothing is emitted, when:
 *   no-recorded-hash   no full 64-hex record for the document exists in the sources;
 *   prereg-changed     the prereg's sha256 equals none of its recorded hashes (it was edited after its last record);
 *   snapshot-changed   a recorded document other than the prereg itself exists on disk and differs from its last record.
 * Abbreviated hashes (`4c493f6c…6194`) are never accepted: a record is the whole hash.
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { PreregHash, PreregRef } from './table.js'

export class BenchRefused extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'BenchRefused'
  }
}

export interface ChainRecord {
  sha256: string
  /** The document the record names (its base name), or null when it names none. */
  doc: string | null
  recorded_in: string
  at?: string
  note?: string
  /** Whether the record belongs to the source's own document when it names none (a sidecar, or a scoped source). */
  scoped: boolean
  /** The directory a named document resolves in. */
  dir: string
}

const HEX = /(?<![0-9a-f])[0-9a-f]{64}(?![0-9a-f])/i
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z?/
const FILEISH = /^[^\s()]*[^\s()/\\]\.[A-Za-z0-9]{1,8}$/

export const sha256Bytes = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex')
export const sha256File = (p: string): string => sha256Bytes(readFileSync(p))
/** A path as written in a table: relative to `cwd`, with forward slashes. */
export const displayPath = (p: string, cwd: string): string => {
  const r = relative(cwd, resolve(cwd, p))
  return (r === '' ? '.' : r).split(sep).join('/')
}

/**
 * The records in one hash list's text. In a sidecar (`sidecar: true`) a record that names no document belongs to the
 * sidecar's own document; elsewhere it is kept with `doc: null` and `scoped: false`, and the chain ignores it.
 */
export function parseChainText(text: string, opts: { source: string; dir: string; sidecar: boolean }): ChainRecord[] {
  const out: ChainRecord[] = []
  let pending: string | undefined
  let blockStart = 0
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('#')) {
      // a comment is the note of the record after it (a trailing one, of the last record: see below)
      pending = line.replace(/^#+\s*/, '').trim()
      continue
    }
    const h = line.match(HEX)
    if (!h) {
      const t = line.match(ISO)
      if (t) { for (let i = blockStart; i < out.length; i++) if (!out[i]!.at) out[i]!.at = t[0]; blockStart = out.length }
      continue
    }
    const sha = h[0].toLowerCase()
    const before = line.slice(0, h.index).trim()
    const afterTokens = line.slice((h.index ?? 0) + h[0].length).trim().split(/\s+/).filter(Boolean)
    // the document a record names: the first file-like token after the hash (`*PREREG.md`, `path/to/PREREG.md`)
    let doc: string | null = null
    let rest = afterTokens
    const fileAt = afterTokens.findIndex(t => { const c = t.replace(/^\*/, '').replace(/[,;]$/, ''); return FILEISH.test(c) && !ISO.test(c) })
    if (fileAt >= 0) {
      doc = basename(afterTokens[fileAt]!.replace(/^\*/, '').replace(/[,;]$/, '').replace(/\\/g, '/'))
      rest = [...afterTokens.slice(0, fileAt), ...afterTokens.slice(fileAt + 1)]
    }
    const at = line.match(ISO)?.[0]
    const noteText = [before, ...rest].join(' ').replace(ISO, '').replace(/\bsha256\b/gi, '').replace(/,\s*\)/g, ')').replace(/\(\s*\)/g, '')
      .replace(/\s+/g, ' ').replace(/^[\s,;:-]+|[\s,;:-]+$/g, '').trim()
    const rec: ChainRecord = { sha256: sha, doc, recorded_in: opts.source, scoped: opts.sidecar, dir: opts.dir }
    if (at) rec.at = at
    const note = noteText || pending
    if (note) rec.note = note
    pending = undefined
    out.push(rec)
  }
  if (pending !== undefined && out.length) {
    const last = out[out.length - 1]!
    if (!last.note) last.note = pending
    const t = pending.match(ISO)
    if (!last.at && t) last.at = t[0]
  }
  return out
}

function jsonAt(o: unknown, path: string): unknown {
  let cur = o
  for (const k of path.split('.').filter(Boolean)) {
    if (typeof cur !== 'object' || cur === null) return undefined
    cur = (cur as Record<string, unknown>)[k]
  }
  return cur
}

/** The records one chain source holds. `cwd` resolves the source; `display` is how the source is written in the table. */
export function readChainSource(spec: string, cwd: string): ChainRecord[] {
  const hashAt = spec.lastIndexOf('#')
  const lineAt = spec.match(/:(\d+)$/)
  if (hashAt > 0 && !lineAt) {
    const file = spec.slice(0, hashAt), path = spec.slice(hashAt + 1)
    const abs = resolve(cwd, file)
    if (!existsSync(abs)) throw new BenchRefused('no-recorded-hash', `chain source ${displayPath(file, cwd)} does not exist`)
    let parsed: unknown
    try { parsed = JSON.parse(readFileSync(abs, 'utf8')) } catch (e) { throw new BenchRefused('no-recorded-hash', `chain source ${displayPath(file, cwd)} is not JSON: ${(e as Error).message}`) }
    const v = jsonAt(parsed, path)
    if (typeof v !== 'string' || !/^[0-9a-f]{64}$/i.test(v)) throw new BenchRefused('no-recorded-hash', `chain source ${displayPath(file, cwd)}#${path} holds no full sha256`)
    return [{ sha256: v.toLowerCase(), doc: null, recorded_in: `${displayPath(file, cwd)}#${path}`, scoped: true, dir: dirname(abs) }]
  }
  if (lineAt) {
    const file = spec.slice(0, lineAt.index), n = Number(lineAt[1])
    const abs = resolve(cwd, file)
    if (!existsSync(abs)) throw new BenchRefused('no-recorded-hash', `chain source ${displayPath(file, cwd)} does not exist`)
    const line = readFileSync(abs, 'utf8').split(/\r?\n/)[n - 1] ?? ''
    const all = line.match(new RegExp(HEX.source, 'gi')) ?? []
    if (all.length !== 1) throw new BenchRefused('no-recorded-hash', `chain source ${displayPath(file, cwd)}:${n} holds ${all.length ? 'more than one' : 'no'} full sha256`)
    const rec: ChainRecord = { sha256: all[0]!.toLowerCase(), doc: null, recorded_in: `${displayPath(file, cwd)}:${n}`, scoped: true, dir: dirname(abs) }
    const at = line.match(ISO)?.[0]
    if (at) rec.at = at
    return [rec]
  }
  const abs = resolve(cwd, spec)
  if (!existsSync(abs)) throw new BenchRefused('no-recorded-hash', `chain source ${displayPath(spec, cwd)} does not exist`)
  return parseChainText(readFileSync(abs, 'utf8'), { source: displayPath(spec, cwd), dir: dirname(abs), sidecar: extname(abs).toLowerCase() === '.sha256' })
}

/** The sidecar a prereg's chain defaults to: `<stem>.sha256` beside it. */
export const defaultSidecar = (prereg: string): string => join(dirname(prereg), `${basename(prereg, extname(prereg))}.sha256`)

export interface PreregOptions {
  /** Chain sources, in recording order (default: the sidecar beside the prereg). */
  chains?: string[]
  /** The document names the chain is read for (default: the prereg's own base name). */
  docs?: string[]
  /** The directory paths are resolved in and written relative to (the run's own folder). */
  cwd: string
}

/** Read and verify the prereg's chain; the reference a table carries. Throws BenchRefused on any break. */
export function verifyPrereg(preregPath: string, opts: PreregOptions): PreregRef {
  const cwd = opts.cwd
  const abs = isAbsolute(preregPath) ? preregPath : resolve(cwd, preregPath)
  const shown = displayPath(preregPath, cwd)
  if (!existsSync(abs)) throw new BenchRefused('no-prereg', `the prereg ${shown} does not exist: a number without a prereg hash is never emitted`)
  const own = basename(abs)
  const docs = opts.docs?.length ? opts.docs.map(d => basename(d)) : [own]
  const sources = opts.chains?.length ? opts.chains : [displayPath(defaultSidecar(abs), cwd)]
  if (!opts.chains?.length && !existsSync(defaultSidecar(abs))) {
    throw new BenchRefused('no-recorded-hash', `no recorded sha256 for ${shown}: there is no sidecar ${sources[0]} beside it and no other chain source was named. A number without a prereg hash is never emitted`)
  }
  const records: ChainRecord[] = []
  for (const s of sources) records.push(...readChainSource(s, cwd))
  // a record belongs to the chain when it names one of the documents, or names none and its source is scoped to the
  // prereg's document (a sidecar of the prereg, `file#path`, `file:line`)
  const chain = records.filter(r => (r.doc !== null ? docs.includes(r.doc) : r.scoped))
  // the same hash recorded twice in a row (two path spellings of one file) is one record
  const dedup: ChainRecord[] = []
  for (const r of chain) {
    const prev = dedup[dedup.length - 1]
    if (!prev || prev.sha256 !== r.sha256) { dedup.push({ ...r }); continue }
    if (!prev.note && r.note) prev.note = r.note
    if (!prev.at && r.at) prev.at = r.at
  }
  if (!dedup.length) throw new BenchRefused('no-recorded-hash', `no recorded sha256 for ${docs.join(' / ')} in ${sources.join(', ')}: a number without a prereg hash is never emitted`)
  const current = sha256File(abs)
  let at = -1
  for (let i = 0; i < dedup.length; i++) if (dedup[i]!.sha256 === current) at = i
  if (at < 0) {
    const last = dedup[dedup.length - 1]!
    throw new BenchRefused('prereg-changed', `${shown} (sha256 ${current.slice(0, 12)}…) matches none of the ${dedup.length} hash(es) recorded for it; the last record is ${last.sha256.slice(0, 12)}… in ${last.recorded_in}. It was edited after its last recorded hash`)
  }
  // a recorded document other than the prereg itself, still on disk, must match its last record
  for (const d of docs) {
    if (d === own) continue
    const forDoc = dedup.filter(r => r.doc === d)
    if (!forDoc.length) continue
    const last = forDoc[forDoc.length - 1]!
    const file = join(last.dir, d)
    if (existsSync(file)) {
      const now = sha256File(file)
      if (now !== last.sha256) throw new BenchRefused('snapshot-changed', `${displayPath(file, cwd)} (sha256 ${now.slice(0, 12)}…) differs from its last recorded hash ${last.sha256.slice(0, 12)}… in ${last.recorded_in}: a recorded document changed after its record`)
    }
  }
  const toHash = (r: ChainRecord): PreregHash => {
    const h: PreregHash = { sha256: r.sha256, recorded_in: r.recorded_in }
    if (r.doc !== null && r.doc !== own) h.doc = r.doc
    if (r.at) h.at = r.at
    if (r.note) h.note = r.note
    return h
  }
  const ref: PreregRef = { path: shown, sha256: current, frozen_sha256: dedup[0]!.sha256, amendments: dedup.slice(1, at + 1).map(toHash) }
  if (at < dedup.length - 1) ref.later = dedup.slice(at + 1).map(toHash)
  return ref
}
