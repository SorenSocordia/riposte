#!/usr/bin/env node
// The misses ledger's rollup: counts of its rows by status and by kind, written to packages/verify/docs/MISSES-ROLLUP.md.
//   node scripts/misses-rollup.mjs [--ledger <file>] [--held <file>] [--out <file>] [--check]
// Reads the ledger's own rows (packages/verify/docs/bench/_misses-ledger.json, the rows MISSES.md lists) and, when the tree holds
// tables back, the held list beside it (_held.json, or --held): rows of a held table are counted as usual and also in a column
// of their own. With no held list the page is what it was before the column existed.
// --check writes nothing: exit 0 when the page is current, 1 when it is not. Exit 3: a usage error or an unreadable ledger.
// The defaults are relative to the repository root (this script's folder's parent); given paths, to the current folder.
// Plain Node, no dependency.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LEDGER = 'packages/verify/docs/bench/_misses-ledger.json'
const OUT = 'packages/verify/docs/MISSES-ROLLUP.md'

// A row's kind, as the ledger writes it, to one of four groups; the first group whose test matches wins.
export const GROUPS = [
  ['engine', 'engine: a wrong answer or a defect in what the engine or a tool of this tree does',
    (k) => k === 'engine' || k === 'kill' || /wrong[- ]pass|false-(fail|pass)|abstain|near-miss|regression|compiler miss|field-miss/i.test(k)],
  ['documentation', 'documentation: a page that is wrong, missing or unclear', (k) => k === 'docs-defect'],
  ['message', 'message: a printed sentence or remedy that is wrong or misleading', (k) => k === 'message-defect' || k === 'misleading-remedy'],
  ['other', 'method, data and study rows: every other kind (a missing measurement, a data or label error, a study outcome, a scope note, a study harness defect)', () => true],
]
export const groupOf = (kind) => GROUPS.find(([, , test]) => test(kind))[0]

/** The held table ids from a held list's bytes (bench-held/1), or an empty set with none. */
export function heldOf(heldBytes) {
  if (!heldBytes) return new Set()
  const h = JSON.parse(heldBytes.toString('utf8'))
  if (h?.format !== 'bench-held/1' || !Array.isArray(h.tables) || h.tables.some((t) => typeof t?.id !== 'string')) throw new Error('the held list is not a bench-held/1 list')
  return new Set(h.tables.map((t) => t.id))
}

export function render(ledgerBytes, heldBytes = null) {
  const ledger = JSON.parse(ledgerBytes.toString('utf8'))
  if (!Array.isArray(ledger.rows)) throw new Error('the ledger has no rows array')
  const held = heldOf(heldBytes)
  const inHeld = (rows) => rows.filter((r) => held.has(String(r.table))).length
  const sha = createHash('sha256').update(ledgerBytes).digest('hex')
  const count = (rows) => ({ open: rows.filter((r) => !r.fixed_by).length, fixed: rows.filter((r) => r.fixed_by).length, all: rows.length })
  const L = []
  L.push('# Misses ledger: the rollup')
  L.push('')
  L.push('Counts of the rows of the misses ledger ([`MISSES.md`](MISSES.md)) by status and by kind. It is a summary of that file\'s')
  L.push('own rows, not a measurement: it says how many rows of each kind are open or fixed, not how severe any one row is, and a')
  L.push('row that names a wrong answer counts once however many cases it covers. Generated, never typed, from the ledger the page')
  L.push(`lists (\`docs/bench/_misses-ledger.json\`, sha256 \`${sha}\`).`)
  L.push('')
  const h = held.size > 0 // the held column only when the tree holds tables back
  L.push(h ? '| kind | open | fixed | all | in a held table |' : '| kind | open | fixed | all |')
  L.push(h ? '|---|---|---|---|---|' : '|---|---|---|---|')
  for (const [id, words] of GROUPS) {
    const rows = ledger.rows.filter((r) => groupOf(String(r.kind)) === id)
    const c = count(rows)
    L.push(`| ${words} | ${c.open} | ${c.fixed} | ${c.all} |${h ? ` ${inHeld(rows)} |` : ''}`)
  }
  const all = count(ledger.rows)
  L.push(`| **every row** | **${all.open}** | **${all.fixed}** | **${all.all}** |${h ? ` **${inHeld(ledger.rows)}** |` : ''}`)
  L.push('')
  const review = ledger.rows.filter((r) => /^cold-review-r\d+$/.test(String(r.table)))
  const rc = count(review)
  L.push(`Of these, ${rc.all} rows come from the rounds of cold review (tables \`cold-review-r1\` onward): ${rc.open} open, ${rc.fixed} fixed.`)
  if (h) {
    const hc = count(ledger.rows.filter((r) => held.has(String(r.table))))
    L.push(`${hc.all} rows (${hc.open} open, ${hc.fixed} fixed) belong to tables held from this tree (\`docs/bench/_held.json\`: ${[...held].map((t) => `\`${t}\``).join(', ')}).`)
    L.push('They are counted in the columns above as well, and kept in the ledger as recorded; the tables are not published here.')
  }
  L.push('')
  L.push('**How a kind is grouped** (the ledger\'s `kind` field as written; the first rule that fits wins):')
  L.push('')
  L.push('- engine: `engine`, `kill` (a behaviour shown false), and every kind that names a wrong answer: a wrong pass, a false fail')
  L.push('  or false pass, an abstain, a near miss, a regression, a compiler miss, a field miss;')
  L.push('- documentation: `docs-defect`;')
  L.push('- message: `message-defect`, `misleading-remedy`;')
  L.push('- method, data and study rows: every other kind.')
  L.push('')
  L.push('A row is open when it records no fix and fixed when it does (the "fixed by" column of `MISSES.md`).')
  L.push('')
  L.push('Regenerate it from the repository root with `node scripts/misses-rollup.mjs`; `node scripts/misses-rollup.mjs --check`')
  L.push('exits 1 when this page no longer matches the ledger.')
  return `${L.join('\n')}\n`
}

function main(argv) {
  const opt = { ledger: LEDGER, out: OUT, held: null, check: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--check') opt.check = true
    else if ((a === '--ledger' || a === '--out' || a === '--held') && argv[i + 1] && !argv[i + 1].startsWith('--')) opt[a.slice(2)] = argv[++i]
    else { process.stderr.write(`misses-rollup: usage: node scripts/misses-rollup.mjs [--ledger <file>] [--held <file>] [--out <file>] [--check] (unknown: ${a})\n`); return 3 }
  }
  const ledgerPath = opt.ledger === LEDGER ? resolve(ROOT, LEDGER) : resolve(opt.ledger)
  const outPath = opt.out === OUT ? resolve(ROOT, OUT) : resolve(opt.out)
  // the held list beside the ledger unless --held names one (a named list must exist)
  const heldPath = opt.held ? resolve(opt.held) : resolve(dirname(ledgerPath), '_held.json')
  if (opt.held && !existsSync(heldPath)) { process.stderr.write(`misses-rollup: no held list at ${opt.held}\n`); return 3 }
  let page
  try { page = render(readFileSync(ledgerPath), existsSync(heldPath) ? readFileSync(heldPath) : null) } catch (e) { process.stderr.write(`misses-rollup: cannot read the ledger ${opt.ledger} or its held list: ${e.message}\n`); return 3 }
  if (opt.check) {
    const current = existsSync(outPath) && readFileSync(outPath, 'utf8') === page
    process.stdout.write(current ? `misses-rollup: ${opt.out} is current\n` : `misses-rollup: ${opt.out} does not match the ledger; run node scripts/misses-rollup.mjs\n`)
    return current ? 0 : 1
  }
  writeFileSync(outPath, page)
  process.stdout.write(`misses-rollup: wrote ${opt.out}\n`)
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2))
