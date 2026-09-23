#!/usr/bin/env node
/** Bin for `riposte-ledger` — see ./ledger-command.ts. */
import { readFileSync } from 'node:fs'
import { ledgerCli } from './ledger-command.js'

const r = ledgerCli(process.argv.slice(2), (p) => readFileSync(p, 'utf8'))
process.stdout.write(r.out)
process.stderr.write(r.err)
process.exitCode = r.code
