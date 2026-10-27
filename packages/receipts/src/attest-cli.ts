#!/usr/bin/env node
/** Bin for `riposte-attest` — see ./attest-command.ts. `riposte-attest monitor …` is the model-switch monitor (./attest-monitor-command.ts). */
import { readFileSync } from 'node:fs'
import { attestCli, parseAttestArgs } from './attest-command.js'
import { monitorCli } from './attest-monitor-command.js'
import { nodeMonitorIo } from './attest-monitor/node-io.js'

const argv = process.argv.slice(2)
const r = argv[0] === 'monitor'
  ? monitorCli(argv.slice(1), nodeMonitorIo)
  : attestCli(argv, (p) => readFileSync(p, 'utf8'), !parseAttestArgs(argv).path && !process.stdin.isTTY ? readFileSync(0, 'utf8') : undefined)
process.stdout.write(r.out)
process.stderr.write(r.err)
process.exitCode = r.code
