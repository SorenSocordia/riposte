#!/usr/bin/env node
/** Bin for `riposte-replay` — see ./replay-command.ts. */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { replayCli } from './replay-command.js'

const r = replayCli(process.argv.slice(2), {
  readFile: (p) => readFileSync(p, 'utf8'),
  listDir: (p) => {
    try { if (!statSync(p).isDirectory()) return undefined } catch { return undefined }
    return readdirSync(p).filter((n) => /\.jsonl?$/i.test(n))
  },
  join,
})
process.stdout.write(r.out)
process.stderr.write(r.err)
process.exitCode = r.code
