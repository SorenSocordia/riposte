/**
 * The head record beside a ledger file (`<ledger>.head.json`), read by `riposte-ledger verify` and `riposte-replay --ledger`
 * (2026-10-05: a four-entry signed ledger cut to three in place verified OK with the issuer's key pinned, while
 * the record beside it still said four).
 *
 * The receipts file store (./file-store.ts) rewrites the record after every append: { count, head, bytes }. Reading it:
 *   - the file holds fewer entries than the record says → CUT (the last entries were removed, or the file was rewritten)
 *   - the entry where the record's head should be is another one → REWRITTEN
 *   - the file holds more entries, chained after the record's head → BEHIND (appended after the record was written: a
 *     process that stopped between the line and the record), which is not a failure
 *   - no record → ABSENT: said in words, because then nothing in the folder can show a cut at the tail; a failure for verify
 *     and replay (required), unless --no-sidecar says to verify without it (2026-10-05)
 *   - a record that does not parse → UNREADABLE, a failure: it cannot say where the ledger ends
 *
 * WHAT IT IS WORTH. The record is written by the same process, in the same folder, as the file. Whoever can rewrite the file
 * can rewrite the record too, or delete it. It catches a cut that left it behind; it is not an anchor. The anchor is a head
 * you recorded somewhere you control (`--head <hash>`), which catches a cut or a rewrite by anyone, the key's holder included.
 * So the record can add a refusal and never removes one: `--head` is checked whatever the record says.
 *
 * ITS BYTE COUNT (2026-10-19; a cold reviewer's file grew by 21 bytes inside a signed entry, and verify said nothing while the
 * record said 2632). Given the file's layout (ledgerLayout), the record's `bytes` must be the file's length up to the end of the
 * entry it names, as the file store checks when it opens a ledger: a difference is REWRITTEN (bytes were added to or removed
 * from the entries it covers). A record without a byte count is then UNREADABLE, as the store refuses one. A last entry with
 * no newline after it is counted with one, the newline the store wrote (verify reads that entry as whole, with a note).
 */
import { GENESIS, type LedgerEntry } from './ledger.js'

/** Where the entries of a ledger file end, in bytes: what a head record's byte count is compared with. */
export interface LedgerLayout {
  /** the byte length of the file up to the newline that ends entry `count - 1`, newline included (0 for none) */
  bytesThrough(count: number): number | undefined
  /** whether the entries' lines end in CR LF (a line-ending conversion adds one byte per line) */
  crlf: boolean
}

/**
 * The layout of a ledger file's text, read as the ledger readers read it: each non-blank line is an entry, in order. `text` must be
 * the file's exact text (the bin refuses bytes that are not UTF-8, so its length in UTF-8 is the file's length).
 */
export function ledgerLayout(text: string): LedgerLayout {
  const ends: number[] = []
  let crlf = false
  let offset = 0
  for (const line of text.split('\n')) {
    const len = Buffer.byteLength(line, 'utf8')
    if (line.trim()) {
      ends.push(offset + len + 1)
      if (line.endsWith('\r')) crlf = true
    }
    offset += len + 1
  }
  return { bytesThrough: (count) => (count === 0 ? 0 : ends[count - 1]), crlf }
}

/** Where the head record of a ledger file lives. The same name the file store writes (file-store.ts sidecarPathOf). */
export const headRecordPathOf = (ledgerPath: string): string => `${ledgerPath}.head.json`

export type HeadRecordStatus = 'agrees' | 'behind' | 'absent' | 'skipped' | 'cut' | 'rewritten' | 'unreadable'

export interface HeadRecordCheck {
  /** the record's file name, as given */
  file: string
  status: HeadRecordStatus
  /** false for cut, rewritten and unreadable, and for absent when the record is required: the ledger does not verify */
  ok: boolean
  /** what the record says, when it could be read */
  count?: number
  head?: string
  /** the byte count the record says, and the file's length up to the end of the entry it names (when the layout was given) */
  bytes?: number
  file_bytes?: number
  /** what was found, in words, and what to do about it */
  words: string
}

const ANCHOR = 'pin --head <hash>, a head you recorded somewhere you control'

/**
 * Compare a ledger's entries with its head record. `text` is the record's contents, or undefined when there is none;
 * `skipped` when the caller chose not to read it (--no-sidecar). `required` (2026-10-05; `riposte-ledger
 * verify` and `riposte-replay --ledger`): a missing record is a failure, so a file cut at the tail with its record deleted too
 * does not verify; --no-sidecar is the stated way to verify without one. Without `required` (summary) it is said in words.
 * `layout` (2026-10-19; ledgerLayout of the file's text): the record's byte count is checked too (see the head of this file).
 */
export function checkHeadRecord(entries: readonly LedgerEntry[], file: string, text: string | undefined, opts: { skipped?: boolean; required?: boolean; layout?: LedgerLayout } = {}): HeadRecordCheck {
  if (opts.skipped) return { file, status: 'skipped', ok: true, words: `head record not read (--no-sidecar); truncation cannot be detected without an anchor: ${ANCHOR}` }
  if (text === undefined && opts.required) {
    return { file, status: 'absent', ok: false, words: `no head record found (${file}), so a cut at the end of the file, or the record deleted with it, would not show: verify against a head you recorded elsewhere (--head <hash>) as well, and pass --no-sidecar to verify without the record when this ledger never had one` }
  }
  if (text === undefined) return { file, status: 'absent', ok: true, words: `no head record found (${file}); truncation cannot be detected without an anchor: ${ANCHOR}` }
  const unreadable = (why: string): HeadRecordCheck => ({ file, status: 'unreadable', ok: false, words: `the head record ${file} ${why}, so it cannot say where the ledger ends; delete it, or pass --no-sidecar, to verify without it` })
  let x: unknown
  try { x = JSON.parse(text) } catch { return unreadable('does not parse') }
  const r = x as { count?: unknown; head?: unknown; bytes?: unknown }
  const layout = opts.layout
  const shape = layout ? '{ count, head, bytes }' : '{ count, head }'
  if (!r || typeof r !== 'object' || !Number.isSafeInteger(r.count) || (r.count as number) < 0 || typeof r.head !== 'string' || !/^[0-9a-f]{64}$/.test(r.head)) {
    return unreadable(`is not ${shape}`)
  }
  // 2026-10-19: with the file's layout, the byte count is read and checked, as the file store does
  if (layout && (!Number.isSafeInteger(r.bytes) || (r.bytes as number) < 0)) return unreadable(`is not ${shape}`)
  const bytes = layout ? r.bytes as number : undefined
  const count = r.count as number
  const head = r.head
  const said = { file, count, head, ...(bytes !== undefined ? { bytes } : {}) }
  const h16 = `${head.slice(0, 16)}…`
  if (count === 0) {
    if (head !== GENESIS) return unreadable('records no entries but a head that is not the empty chain\'s')
    if (bytes !== undefined && bytes !== 0) return unreadable(`records no entries but ${bytes} bytes`)
    const z = bytes !== undefined ? { file_bytes: 0 } : {}
    return entries.length
      ? { ...said, ...z, status: 'behind', ok: true, words: `head record ${file}: no entries; the file holds ${entries.length}, chained from the start (appended after the record was written)` }
      : { ...said, ...z, status: 'agrees', ok: true, words: `head record ${file}: no entries, as in the file` }
  }
  const n = entries.length
  if (n < count) {
    const k = count - n
    return { ...said, status: 'cut', ok: false, words: `the file has ${n} ${n === 1 ? 'entry' : 'entries'}; its head record (${file}) says ${count} (head ${h16}); the last ${k === 1 ? 'entry was' : `${k} entries were`} removed or the file was rewritten; verify against a head you recorded elsewhere (--head <hash>)` }
  }
  const atHash = entries[count - 1]?.hash // 2026-10-20: a line that is not an object (or holds no hash) is not a ledger entry
  if (atHash !== head) {
    return { ...said, status: 'rewritten', ok: false, words: `entry ${count - 1} ${typeof atHash === 'string' ? `is not the one its head record (${file}) names (the record says head ${h16}; the file has ${atHash.slice(0, 16)}… there)` : `is not a ledger entry, so it is not the one its head record (${file}) names (the record says head ${h16})`}; the file was rewritten; verify against a head you recorded elsewhere (--head <hash>)` }
  }
  // 2026-10-19: the same entry at the head, and the bytes up to it are not the bytes the record says
  const found = layout?.bytesThrough(count)
  const fb = found !== undefined ? { file_bytes: found } : {}
  if (bytes !== undefined && found !== undefined && found !== bytes) {
    return {
      ...said, ...fb, status: 'rewritten', ok: false,
      words: `the file holds ${found} bytes up to the end of entry ${count - 1}; its head record (${file}) says ${bytes} (head ${h16}, the same entry): bytes were added to or removed from the entries it covers, so the file was rewritten; verify against a head you recorded elsewhere (--head <hash>)` +
        (layout!.crlf ? '; its lines end in CR LF, and a line-ending conversion adds one byte per line' : ''),
    }
  }
  if (n > count) return { ...said, ...fb, status: 'behind', ok: true, words: `head record ${file}: ${count} entries, head ${h16}; the file holds ${n - count} more, chained after it (appended after the record was written)` }
  return { ...said, ...fb, status: 'agrees', ok: true, words: `head record ${file}: ${count} entries, head ${h16}, as in the file` }
}
