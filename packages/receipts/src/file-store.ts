/** JSONL file storage for the receipt ledger (one entry per line; append-only). */
import { appendFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { LedgerEntry, LedgerStore } from './ledger.js'

export function fileStore(path: string): LedgerStore {
  return {
    load: () => existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as LedgerEntry) : [],
    append: (e) => { mkdirSync(dirname(path), { recursive: true }); appendFileSync(path, JSON.stringify(e) + '\n') },
  }
}
