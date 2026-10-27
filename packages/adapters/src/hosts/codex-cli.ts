#!/usr/bin/env node
/**
 * Bin for the Codex port: `riposte-codex --hook [--ledger <file>]`, registered on Codex's Stop event (and, for governance,
 * on PreToolUse). See ./codex.ts. Exit 0 lets the turn end; exit 2 (an enforcing mode, once) continues it with the reason on
 * stderr; our own errors exit 0 in record-only and 1 (non-blocking) otherwise. Stop never writes stdout; a governance
 * PreToolUse deny is the only stdout this bin writes.
 */
import { readFileSync } from 'node:fs'
import { codexStopHook } from './codex.js'
import { defaultLedger, governanceReceiptWriter, ledgerOpener, parseHostArgs, readStdin } from './bin-io.js'
import { scrubHookEnv } from '../governance.js'

// 2026-10-04: drop inherited RIPOSTE_* settings this hook does not read, before anything else.
scrubHookEnv(process.env, 'codex')
const USAGE = 'riposte-codex --hook [--ledger <file>]   (Codex Stop hook JSON on stdin)\n'
const args = parseHostArgs(process.argv.slice(2))
if (args.help || args.error || !args.hook) {
  process.stderr.write(`${args.error ? `${args.error}\n` : ''}${USAGE}`)
  process.exitCode = args.help ? 0 : 3
} else {
  const r = codexStopHook(readStdin(), {
    env: process.env, readFile: (p) => readFileSync(p, 'utf8'), ...(args.ledger ? { ledgerArg: args.ledger } : {}),
    defaultLedger: defaultLedger(), openLedger: ledgerOpener(process.env), writeReceipt: governanceReceiptWriter(process.env),
  })
  if (r.stdout) process.stdout.write(r.stdout)
  if (r.stderr) process.stderr.write(r.stderr)
  process.exitCode = r.code
}
