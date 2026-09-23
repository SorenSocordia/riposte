#!/usr/bin/env node
/**
 * stdio transport for the Receipts MCP server.
 *   RECEIPTS_ROOT   workspace the agent's state files live in (default: cwd) — check_done / model_attest read ONLY inside it
 *   RECEIPTS_LEDGER ledger file (default: <root>/receipts.jsonl)
 *   RECEIPTS_KEY    optional path to an Ed25519 private key (PEM) — entries get signed
 */
import { createInterface } from 'node:readline'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { handleRequest, openLedger, rootedJsonReader, rootedTextReader } from './mcp.js'
import { fileStore } from './file-store.js'

const root = process.env.RECEIPTS_ROOT ?? process.cwd()
const ledgerPath = process.env.RECEIPTS_LEDGER ?? join(root, 'receipts.jsonl')
const signingKey = process.env.RECEIPTS_KEY ? readFileSync(process.env.RECEIPTS_KEY, 'utf8') : undefined
const deps = { ledger: openLedger(fileStore(ledgerPath), signingKey ? { signingKey } : {}), read: rootedJsonReader(root), readText: rootedTextReader(root) }

const rl = createInterface({ input: process.stdin })
rl.on('line', (line) => {
  if (!line.trim()) return
  let res
  try { res = handleRequest(JSON.parse(line), deps) } catch { res = { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } } }
  if (res) process.stdout.write(JSON.stringify(res) + '\n')
})
