#!/usr/bin/env node
/** Bin for `riposte-score`: see ./score-command.ts. Only I/O lives here. */
import { readFileSync } from 'node:fs'
import { SCORE_USAGE, scoreCommand } from './score-command.js'

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write(SCORE_USAGE)
} else {
  const r = scoreCommand(readFileSync(0, 'utf8'))
  if (r.stdout) process.stdout.write(r.stdout)
  if (r.stderr) process.stderr.write(r.stderr)
  process.exitCode = r.code
}
