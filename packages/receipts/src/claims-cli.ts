#!/usr/bin/env node
/**
 * Bin for `riposte-claims` — see ./claims-command.ts.
 *   --hook      Claude Code Stop hook: reads the hook JSON on stdin, exits 2 to send an unbacked "done" back once, else 0
 *   --ledger f  append every checked stop to a hash-chained receipt ledger (signed if RECEIPTS_KEY points at an Ed25519 PEM)
 */
import { readFileSync } from 'node:fs'
import { claimsCli, parseClaimsArgs, stopHook } from './claims-command.js'
import { openLedger } from './ledger.js'
import { fileStore } from './file-store.js'

const argv = process.argv.slice(2)
const args = parseClaimsArgs(argv)
const read = (p: string) => readFileSync(p, 'utf8')

if (args.hook && !args.error && !args.help) {
  const d = stopHook(readFileSync(0, 'utf8'), read, { onlyContradicted: args.onlyContradicted })
  if (args.ledger && d.result?.claims.length) {
    try {
      const signingKey = process.env.RECEIPTS_KEY ? readFileSync(process.env.RECEIPTS_KEY, 'utf8') : undefined
      openLedger(fileStore(args.ledger), signingKey ? { signingKey } : {}).append('claims_check', { source: 'stop_hook', blocked: d.code === 2, ...d.result })
    } catch (e) { process.stderr.write(`riposte-claims: ledger not written: ${(e as Error).message}\n`) }
  }
  process.stderr.write(d.stderr)
  process.exitCode = d.code
} else {
  const needStdin = !args.path && !process.stdin.isTTY
  const r = claimsCli(argv, read, needStdin ? readFileSync(0, 'utf8') : undefined)
  process.stdout.write(r.out)
  process.stderr.write(r.err)
  process.exitCode = r.code
}
