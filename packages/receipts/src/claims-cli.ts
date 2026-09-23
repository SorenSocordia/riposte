#!/usr/bin/env node
/** Bin for `riposte-claims` — see ./claims-command.ts. */
import { readFileSync } from 'node:fs'
import { claimsCli, parseClaimsArgs } from './claims-command.js'

const argv = process.argv.slice(2)
const needStdin = !parseClaimsArgs(argv).path && !process.stdin.isTTY
const r = claimsCli(argv, (p) => readFileSync(p, 'utf8'), needStdin ? readFileSync(0, 'utf8') : undefined)
process.stdout.write(r.out)
process.stderr.write(r.err)
process.exitCode = r.code
