// SPDX-License-Identifier: Apache-2.0
// The Python replay behind a Node command line: `node conformance/engine_py/shim.mjs replay <file> [flags]` runs
// `python cli.py replay <file> [flags]` with the same arguments and the same working folder, passes its stdout and stderr
// through unchanged (the child writes to this process's own streams), and exits with its exit code. A harness that spawns
// `process.execPath [cli, 'replay', file, ...args]` (whetstone/run.mjs, the two-engines bench) can point at this file to run the
// Python engine instead of the Node one. prototype; no measured accuracy.
//
// Which Python: RIPOSTE_PYTHON when it is set (a command name or a path), else `python` on Windows and `python3` elsewhere,
// falling back to the other name when the first is not installed. Exit 3 with one line when no Python 3 can be started.
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CLI = join(dirname(fileURLToPath(import.meta.url)), 'cli.py')
const names = process.env.RIPOSTE_PYTHON ? [process.env.RIPOSTE_PYTHON] : process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python']

for (const py of names) {
  const r = spawnSync(py, [CLI, ...process.argv.slice(2)], { stdio: 'inherit', windowsHide: true })
  if (r.error && r.error.code === 'ENOENT') continue
  if (r.error) {
    process.stderr.write(`shim: could not run ${py} on ${CLI}: ${r.error.message}\n`)
    process.exit(3)
  }
  // 9009 is what Windows answers for a command name with nothing behind it (the store alias); try the next name
  if (process.platform === 'win32' && r.status === 9009) continue
  process.exit(r.status ?? 1)
}
process.stderr.write(`shim: no Python 3 found (tried ${names.join(', ')}); set RIPOSTE_PYTHON to its path\n`)
process.exit(3)
