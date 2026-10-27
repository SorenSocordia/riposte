/** The monitor's file system for the bins: real files, and ledgers opened under their single-writer lock. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { MonitorIo } from '../attest-monitor-command.js'
import { fileStore } from '../file-store.js'
import { openLedger } from '../ledger.js'

export const nodeMonitorIo: MonitorIo = {
  readFile: (p) => readFileSync(p),
  writeFile: (p, d) => writeFileSync(p, d),
  mkdir: (p) => { mkdirSync(p, { recursive: true }) },
  openLedger: (path, key) => {
    mkdirSync(dirname(path), { recursive: true })
    const store = fileStore(path, { lock: true })
    try { return { ledger: openLedger(store, key ? { signingKey: key } : {}), release: () => store.release() } } catch (e) { store.release(); throw e }
  },
}
