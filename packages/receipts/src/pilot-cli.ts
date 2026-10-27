#!/usr/bin/env node
/** Bin for `riposte-pilot`: see ./pilot-command.ts. Offline; never calls a payment API. */
import { pilotCli } from './pilot-command.js'

const r = pilotCli(process.argv.slice(2))
process.stdout.write(r.out)
process.stderr.write(r.err)
process.exitCode = r.code
