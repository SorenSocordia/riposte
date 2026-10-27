#!/usr/bin/env node
// A stand-in for the governance checker (`custody may-act ... --json`), for the adapters' own tests: the adapters must not
// depend on the checker's package. It reads what to do from the JSON file passed as --ledger:
//   { "mode": "allow" | "refuse" | "sleep" | "crash" | "garbage" | "wrong-agent" | "allow-exit1", "log"?: <file> }
// and, with "log", writes its argument vector there first.
import { readFileSync, writeFileSync } from 'node:fs'

const argv = process.argv.slice(2)
const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined }
const agent = arg('--agent')
let spec = {}
try { spec = JSON.parse(readFileSync(arg('--ledger'), 'utf8')) } catch { /* no spec: answer like a checker that cannot read its ledger */ }
if (spec.log) writeFileSync(spec.log, JSON.stringify(argv))
const out = (x) => process.stdout.write(`${JSON.stringify(x)}\n`)
switch (spec.mode) {
  case 'allow': out({ decision: 'ALLOW', agent, detail: 'no standing hold', checked: { rows: 1, inbox_items: 0, checkpoints: 0, witnessed_rows: 0 } }); process.exitCode = 0; break
  case 'allow-go': out({ decision: 'ALLOW', agent, detail: 'under a GO', checked: {}, classes: ['payments'], go: [{ class: 'payments', go_id: 'f'.repeat(64) }] }); process.exitCode = 0; break
  case 'refuse': out({ decision: 'REFUSE', agent, code: 'hold.standing', detail: 'held by a test hold', holds: [{ id: 'a'.repeat(64) }] }); process.exitCode = 1; break
  case 'sleep': setTimeout(() => out({ decision: 'ALLOW', agent }), 30_000); break
  case 'crash': process.stderr.write('the checker fell over\n'); process.exitCode = 7; break
  case 'garbage': process.stdout.write('this is not an answer\n'); process.exitCode = 0; break
  case 'wrong-agent': out({ decision: 'ALLOW', agent: 'someone-else' }); process.exitCode = 0; break
  case 'allow-exit1': out({ decision: 'ALLOW', agent }); process.exitCode = 1; break
  default: out({ decision: 'REFUSE', agent, code: 'ledger.unreadable', detail: 'the governance ledger cannot be read', holds: [] }); process.exitCode = 1
}
