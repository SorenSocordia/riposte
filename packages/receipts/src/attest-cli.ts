#!/usr/bin/env node
/** Bin for `riposte-attest` — see ./attest-command.ts. */
import { readFileSync } from 'node:fs'
import { attestCli, parseAttestArgs } from './attest-command.js'

const argv = process.argv.slice(2)
const needStdin = !parseAttestArgs(argv).path && !process.stdin.isTTY
const r = attestCli(argv, (p) => readFileSync(p, 'utf8'), needStdin ? readFileSync(0, 'utf8') : undefined)
process.stdout.write(r.out)
process.stderr.write(r.err)
process.exitCode = r.code
