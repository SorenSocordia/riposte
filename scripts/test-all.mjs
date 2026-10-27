// Run every package's tests, one package after another, and say how each one ended (2026-10-06). The root `npm test` used to
// chain the packages with `&&`, so when one package failed the packages after it never ran, and the log did not say they were
// skipped. Now every package runs whatever the others do, a closing block names each package's result, and the exit code is
// non-zero when any package failed.
//   npm test                     (from the repository root; runs this)
//   node scripts/test-all.mjs    (the same)
import { spawnSync } from 'node:child_process'

const PACKAGES = ['riposte-verify', 'riposte-ai', 'riposte-adapters']

// Under `npm test`, npm names its own entry point; run it with this node, so no shell is needed on any platform.
const npmCli = process.env.npm_execpath
const results = []
for (const name of PACKAGES) {
  const started = Date.now()
  const r = npmCli
    ? spawnSync(process.execPath, [npmCli, 'test', '-w', name], { stdio: 'inherit' })
    : spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['test', '-w', name], { stdio: 'inherit', shell: process.platform === 'win32' })
  const code = r.status ?? 1
  results.push({ name, code, seconds: Math.round((Date.now() - started) / 1000), error: r.error?.message })
}

const failed = results.filter((r) => r.code !== 0)
console.log('\nnpm test, every package:')
for (const r of results) {
  console.log(`  ${r.name.padEnd(17)} ${r.code === 0 ? 'passed' : `FAILED (exit ${r.code})`} in ${r.seconds} s${r.error ? ` (${r.error})` : ''}`)
}
console.log(failed.length ? `${failed.length} of ${results.length} packages failed: ${failed.map((r) => r.name).join(', ')}` : `all ${results.length} packages passed`)
process.exitCode = failed.length ? 1 : 0
