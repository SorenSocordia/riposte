#!/usr/bin/env node
/**
 * Bin for `riposte-loop-run` — see ./command.ts. With any RIPOSTE_GOV_* variable set, every round is first checked by the
 * fleet's governance (../governance.ts), fresh each round, and fails closed; receipts go to RIPOSTE_GOV_RECEIPTS.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileStore, openLedger } from 'riposte-ai'
import { loopRunCli } from './command.js'
import { decideGovernance, governanceFromEnv, recordGovernance, scrubHookEnv } from '../governance.js'
import type { LoopGovernance } from './driver.js'

// 2026-10-04: drop inherited RIPOSTE_* settings this runner does not read, before anything else.
scrubHookEnv(process.env, 'loop')
const gov = governanceFromEnv(process.env)
const signingKey = (() => { try { return process.env.RECEIPTS_KEY ? readFileSync(process.env.RECEIPTS_KEY, 'utf8') : undefined } catch { return undefined } })()
const governance: LoopGovernance | undefined = gov.on
  ? (call) => recordGovernance('loop', gov, decideGovernance(gov, { tool: call.tool, call_sha256: call.proposal_sha256 }),
    (p, body) => openLedger(fileStore(p), signingKey ? { signingKey } : {}).append('action_check', body)).verdict
  : undefined

const r = await loopRunCli(process.argv.slice(2), {
  readFile: (p) => readFileSync(p, 'utf8'),
  writeFile: (p, t) => writeFileSync(p, t),
  mkdir: (p) => mkdirSync(p, { recursive: true }),
  join,
  sha256: (t) => createHash('sha256').update(t, 'utf8').digest('hex'),
  ...(governance ? { governance } : {}),
})
process.stdout.write(r.out)
process.stderr.write(r.err)
process.exitCode = r.code
