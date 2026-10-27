#!/usr/bin/env node
/**
 * Bin for `riposte-ledger` — see ./ledger-command.ts. `rule` appends through the receipts file store, under its
 * single-writer lock (2026-10-03, FIX-R): never a raw append that another writer could race. `case` (2026-10-04) is
 * ./case-command.ts: arbitration case rows on the ledger, under a witnessed head. Every other command reads its files as UTF-8,
 * refusing bytes that are not (2026-10-19; readLedgerText): a replaced byte would make two files read the same, and the head
 * record's byte count is compared with the file's length.
 */
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ledgerCli, readLedgerText } from './ledger-command.js'
import { caseCli } from './case-command.js'
import { fileStore, lockHolder } from './file-store.js'

const argv = process.argv.slice(2)
const r = argv[0] === 'case'
  ? await caseCli(argv.slice(1), {
    readFile: (p) => readFileSync(p, 'utf8'),
    writeNewFile: (p, text) => writeFileSync(p, text, { flag: 'wx' }),
    isDir: (p) => { try { return statSync(p).isDirectory() } catch { return false } },
    join,
    openStore: (p) => fileStore(p),
  })
  : ledgerCli(argv, (p) => readLedgerText(readFileSync(p), p), {
    openStore: (p) => fileStore(p),
    lockHolder: (p) => lockHolder(p),
  })
process.stdout.write(r.out)
process.stderr.write(r.err)
process.exitCode = r.code
