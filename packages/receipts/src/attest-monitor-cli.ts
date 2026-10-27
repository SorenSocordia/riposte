#!/usr/bin/env node
/** Bin for `riposte-attest-monitor` (the same as `riposte-attest monitor …`): see ./attest-monitor-command.ts. */
import { monitorCli } from './attest-monitor-command.js'
import { nodeMonitorIo } from './attest-monitor/node-io.js'

const r = monitorCli(process.argv.slice(2), nodeMonitorIo)
process.stdout.write(r.out)
process.stderr.write(r.err)
process.exitCode = r.code
