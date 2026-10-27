#!/usr/bin/env node
/**
 * Bin for `riposte-action`: see ./cli.ts. Only I/O lives here.
 * With RIPOSTE_ACTION_HOOK unset or "off", `--hook` returns before reading stdin or any file: the mode costs one process
 * start and nothing else.
 */
import { readFileSync } from 'node:fs'
import { fileStore, openLedger } from 'riposte-ai'
import { actionCli } from './cli.js'
import { scrubHookEnv } from './governance.js'

// 2026-10-04: drop inherited RIPOSTE_* settings this hook does not read, before anything else.
scrubHookEnv(process.env, 'claude-code')
const signingKey = (() => { try { return process.env.RECEIPTS_KEY ? readFileSync(process.env.RECEIPTS_KEY, 'utf8') : undefined } catch { return undefined } })()
const r = actionCli(process.argv.slice(2), process.env, {
  stdin: () => readFileSync(0, 'utf8'),
  readFile: (p) => readFileSync(p, 'utf8'),
  openLedger: (p) => openLedger(fileStore(p), signingKey ? { signingKey } : {}),
  // governance receipts (RIPOSTE_GOV_*): one `action_check` row per decision, `source: "governance"`
  writeReceipt: (p, body) => openLedger(fileStore(p), signingKey ? { signingKey } : {}).append('action_check', body),
})
if (r.stdout) process.stdout.write(r.stdout)
if (r.stderr) process.stderr.write(r.stderr)
process.exitCode = r.code
