/**
 * Scratch folders for tests, inside the package (`<package>/tmp/vitest/`, the folder receipts and adapters use; `tmp/` is
 * gitignored in the public tree), never the system temp directory: a reader asked to stay
 * inside one folder can run the suite and comply. Resolved from this file, so it is the same folder in a source checkout and in
 * any copy of the package. `cleanScratch()` removes the folders this test file made (call it in afterAll).
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** `<package>/tmp/vitest`: the one place these tests write. */
export const SCRATCH_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'tmp', 'vitest')

const made: string[] = []

/** A new, empty folder under SCRATCH_ROOT, named `<prefix>XXXXXX`. */
export function scratch(prefix = 'test-'): string {
  mkdirSync(SCRATCH_ROOT, { recursive: true })
  const dir = mkdtempSync(join(SCRATCH_ROOT, prefix))
  made.push(dir)
  return dir
}

/** Remove every folder scratch() made in this module instance. */
export function cleanScratch(): void {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true })
}
