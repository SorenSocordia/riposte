#!/usr/bin/env node
/**
 * stdio transport for the Receipts MCP server.
 *   RECEIPTS_ROOT        workspace the agent's state files live in (default: cwd) — check_done / model_attest read ONLY inside it
 *   RECEIPTS_LEDGER      ledger file (default: <root>/receipts.jsonl)
 *   RECEIPTS_KEY         optional path to an Ed25519 private key (PEM) — entries get signed
 *   RIPOSTE_AUTHORITIES  optional path to a JSON file { "<role>": "<public key PEM or path>" | [ … ] }: the keys pinned for each
 *                        role, whose signed rulings ap_gate may consume. Unset: every ruling is refused.
 *   RECEIPTS_STORE_DOCUMENTS  "1": every ap_gate receipt stores the documents and the proof (default: hashes and offsets only;
 *                        a call can still opt in with store_documents: true)
 */
import { createInterface } from 'node:readline'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { handleRequest, openLedger, rootedJsonReader, rootedTextReader } from './mcp.js'
import { fileStore } from './file-store.js'
import { authoritiesFromJson } from './ruling.js'
import { parseJsonStrict, HashInputRefused } from 'riposte-verify'

const root = process.env.RECEIPTS_ROOT ?? process.cwd()
const ledgerPath = process.env.RECEIPTS_LEDGER ?? join(root, 'receipts.jsonl')
const signingKey = process.env.RECEIPTS_KEY ? readFileSync(process.env.RECEIPTS_KEY, 'utf8') : undefined
const authFile = process.env.RIPOSTE_AUTHORITIES
const authorities = authFile
  ? authoritiesFromJson(JSON.parse(readFileSync(authFile, 'utf8')), (p) => readFileSync(resolve(dirname(authFile), p), 'utf8'))
  : undefined
const deps = {
  ledger: openLedger(fileStore(ledgerPath), signingKey ? { signingKey } : {}), read: rootedJsonReader(root), readText: rootedTextReader(root),
  // loop_round (T3): each loop's own chain is signed with the same key
  ...(signingKey ? { loopSigningKey: signingKey } : {}),
  ...(authorities ? { authorities } : {}),
  ...(process.env.RECEIPTS_STORE_DOCUMENTS === '1' ? { storeDocuments: true } : {}),
}

const rl = createInterface({ input: process.stdin })
rl.on('line', (line) => {
  if (!line.trim()) return
  // read under the engine's hash contract (2026-10-05): a key written twice, a number past the double range, or a number that
  // cannot be represented exactly (9007199254740993) is a parse error naming where, never a gate decision on a changed figure
  let req: unknown
  try { req = parseJsonStrict(line.trim(), 'the request line') } catch (e) {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: e instanceof HashInputRefused ? `parse error: ${e.message}` : 'parse error' } }) + '\n')
    return
  }
  let res
  try { res = handleRequest(req as Parameters<typeof handleRequest>[0], deps) } catch { res = { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } } }
  if (res) process.stdout.write(JSON.stringify(res) + '\n')
})
