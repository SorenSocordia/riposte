#!/usr/bin/env node
/** Bin for `riposte-sarif`: see ./sarif-command.ts. Only I/O lives here. */
import { sarifCommand } from './sarif-command.js'

const r = sarifCommand(process.argv.slice(2), { cwd: process.cwd() })
if (r.stdout) process.stdout.write(r.stdout)
if (r.stderr) process.stderr.write(r.stderr)
process.exitCode = r.code
