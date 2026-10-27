/**
 * The suite's scratch folder (vitest.config.ts `globalSetup`): <package>/tmp/vitest/run-<pid>, the folder every worker's TMPDIR,
 * TMP and TEMP point at, so os.tmpdir() resolves inside the package. Created before the first test file runs and removed when the
 * run ends, with whatever a test left in it. The folder name carries the run's process id, so a second run started at the same
 * time has its own folder and this teardown never touches it.
 */
import { mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRATCH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'tmp', 'vitest', `run-${process.pid}`)

export function setup(): () => void {
  mkdirSync(SCRATCH, { recursive: true })
  return () => { rmSync(SCRATCH, { recursive: true, force: true }) }
}
