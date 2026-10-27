#!/usr/bin/env node
/**
 * Bin for the Cursor port: `riposte-cursor --hook [--ledger <file>]`, registered on postToolUse, postToolUseFailure,
 * afterFileEdit, afterAgentResponse, stop and sessionEnd. See ./cursor.ts. Always answers JSON on stdout.
 * The journal lives in RIPOSTE_STATE_DIR, else `cursor-journal/` beside the ledger.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { cursorHook, type CursorJournal } from './cursor.js'
import { hostConfig } from './common.js'
import { defaultLedger, governanceReceiptWriter, ledgerOpener, parseHostArgs, readStdin } from './bin-io.js'
import { scrubHookEnv } from '../governance.js'

// 2026-10-04: drop inherited RIPOSTE_* settings this hook does not read, before anything else.
scrubHookEnv(process.env, 'cursor')
const USAGE = 'riposte-cursor --hook [--ledger <file>]   (Cursor hook JSON on stdin)\n'
const args = parseHostArgs(process.argv.slice(2))
if (args.help || args.error || !args.hook) {
  process.stdout.write('{}\n')
  process.stderr.write(`${args.error ? `${args.error}\n` : ''}${USAGE}`)
  process.exitCode = args.help ? 0 : 3
} else {
  const ledger = hostConfig(process.env, args.ledger, defaultLedger()).ledger ?? defaultLedger()
  const dir = process.env.RIPOSTE_STATE_DIR?.trim() || join(dirname(ledger), 'cursor-journal')
  const journal: CursorJournal = {
    read: (name) => { const p = join(dir, name); return existsSync(p) ? readFileSync(p, 'utf8') : null },
    append: (name, line) => { mkdirSync(dir, { recursive: true }); appendFileSync(join(dir, name), `${line}\n`) },
    remove: (name) => rmSync(join(dir, name), { force: true }),
  }
  const r = cursorHook(readStdin(), {
    env: process.env, journal, ...(args.ledger ? { ledgerArg: args.ledger } : {}), defaultLedger: defaultLedger(), openLedger: ledgerOpener(process.env),
    writeReceipt: governanceReceiptWriter(process.env),
  })
  process.stdout.write(r.stdout)
  if (r.stderr) process.stderr.write(r.stderr)
  process.exitCode = r.code
}
