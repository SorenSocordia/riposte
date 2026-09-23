/**
 * File-backed Ledger — the book of record persisted to disk so it survives a restart, with the tamper-evident hash chain
 * preserved verbatim across reopen. Dependency-free (node:fs only): the chain is a JSONL file, one event per line, and a
 * reopened ledger rehydrates to the identical head hash (so `verifyContent()` still passes). For a single-node deployment
 * this IS the system of record; a larger deployment swaps a DB-backed `Ledger` behind the same interface.
 */

import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { MemoryLedger } from './memory.js'
import type { Ledger } from './types.js'
import type { LedgerEvent } from './chain.js'

/** Parse an exported chainJSONL (see `Ledger.chainJSONL`) into events + their verbatim payloads. */
export function parseChainJSONL(text: string): { events: LedgerEvent[]; payloads: unknown[] } {
  const events: LedgerEvent[] = []
  const payloads: unknown[] = []
  for (const line of text.split('\n')) {
    const s = line.trim()
    if (!s) continue
    const { payload, ...event } = JSON.parse(s) as LedgerEvent & { payload: unknown }
    events.push(event as LedgerEvent)
    payloads.push(payload)
  }
  return { events, payloads }
}

/**
 * Open (or create) a file-backed ledger at `path`. Existing history is loaded and its chain restored verbatim; every new
 * record/review is appended as one JSONL line as it happens.
 */
export function openFileLedger(path: string, opts: { now?: () => Date } = {}): Ledger {
  const seed = existsSync(path) ? parseChainJSONL(readFileSync(path, 'utf8')) : undefined
  const dir = dirname(path)
  if (dir && dir !== '.') mkdirSync(dir, { recursive: true })
  return new MemoryLedger({
    ...opts,
    seed,
    onAppend: (event, payload) => appendFileSync(path, JSON.stringify({ ...event, payload }) + '\n'),
  })
}
