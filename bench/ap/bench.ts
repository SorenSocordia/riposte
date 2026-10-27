/**
 * Runs a checker over all 100 Distil Labs invoice cases and scores it per PREREG.md.
 *   npx tsx bench/ap/bench.ts --run 1
 * Run 1 = the blind checker, frozen before any run (threeway-v1.frozen.ts, sha256 d1ad333f…). Any other run = the disclosed
 * test-set-tuned checker (threeway.ts). Prints the scorecard and writes per-case results (with the checker's sha256) to
 * --out <file>, by default to a NEW folder reruns/run-<n>-<time>/run-<n>.jsonl. It never writes into results/: the shipped
 * results/run-<n>.jsonl is what a re-run is compared with, byte for byte, and the comparison is printed (identical / differs).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkInvoice as blindChecker } from './threeway-v1.frozen.ts'
import { checkInvoice as tunedChecker } from './threeway.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const arg = (name: string): string | undefined => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined
const RUN = arg('--run') ?? '1'
const CHECKER = RUN === '1' ? 'threeway-v1.frozen.ts' : 'threeway.ts'
const checkInvoice = RUN === '1' ? blindChecker : tunedChecker
const checkerSha = createHash('sha256').update(readFileSync(join(HERE, CHECKER))).digest('hex')
const cases = readFileSync(join(HERE, 'data', 'distil', 'invoice_cases.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))

// where the per-case rows go: never the shipped results folder
const SHIPPED_DIR = resolve(HERE, 'results')
const SHIPPED = join(SHIPPED_DIR, `run-${RUN}.jsonl`)
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
const out = resolve(arg('--out') ?? join(HERE, 'reruns', `run-${RUN}-${stamp}`, `run-${RUN}.jsonl`))
const rel = relative(SHIPPED_DIR, out)
if (rel === '' || (!rel.startsWith('..') && !rel.startsWith(sep) && !/^[A-Za-z]:/.test(rel))) {
  console.error(`refused: ${out} is inside results/, which holds the shipped results. Write elsewhere (--out); the shipped file is what a re-run is compared with.`)
  process.exit(2)
}

const numEq = (a: unknown, b: unknown): boolean => {
  if (a == null || b == null) return a == null && b == null
  const na = typeof a === 'number' ? a : Number(String(a).replace(/,/g, ''))
  const nb = typeof b === 'number' ? b : Number(String(b).replace(/,/g, ''))
  if (Number.isFinite(na) && Number.isFinite(nb) && !/^[A-Z]/i.test(String(a))) return Math.abs(na - nb) <= 0.005
  return String(a) === String(b)
}

const rows: Record<string, unknown>[] = []
let decided = 0, dec2a = 0, six2b = 0, wrong = 0
const bySeg: Record<string, { n: number; a: number; b: number; abst: number; wrong: number }> = {}
for (const c of cases) {
  const r = checkInvoice(c.input)
  const gold = {
    decision: c.decision,
    invoice_number: c.invoice?.invoice_number ?? null,
    po_number: c.invoice?.po_number ?? null,
    item: c.grounding?.item ?? null,
    invoiced: c.grounding?.invoice_value ?? null,
    expected: c.grounding?.reference_value ?? null,
  }
  const isDecided = r.outcome === 'DECIDED'
  const decOk = isDecided && r.decision === gold.decision
  const sixOk = decOk && r.invoice_number === gold.invoice_number && r.po_number === gold.po_number &&
    (r.item ?? null) === gold.item && numEq(r.invoiced, gold.invoiced) && numEq(r.expected, gold.expected)
  if (isDecided) decided++
  if (decOk) dec2a++
  if (sixOk) six2b++
  if (isDecided && !decOk) wrong++
  const seg = String(c.kind)
  bySeg[seg] ??= { n: 0, a: 0, b: 0, abst: 0, wrong: 0 }
  const s = bySeg[seg]!
  s.n++; if (decOk) s.a++; if (sixOk) s.b++; if (!isDecided) s.abst++; if (isDecided && !decOk) s.wrong++
  rows.push({ id: c.id, kind: c.kind, gold, got: { outcome: r.outcome, decision: r.decision ?? null, invoice_number: r.invoice_number ?? null, po_number: r.po_number ?? null, item: r.item ?? null, invoiced: r.invoiced ?? null, expected: r.expected ?? null }, decision_ok: decOk, six_ok: sixOk, reasons: r.reasons, trace: r.trace })
}

mkdirSync(dirname(out), { recursive: true })
const bytes = rows.map((r) => JSON.stringify({ checker_sha256: checkerSha, ...r })).join('\n') + '\n'
writeFileSync(out, bytes)

const N = cases.length
const pct = (x: number, d = N): string => `${x}/${d} (${((100 * x) / d).toFixed(1)}%)`
console.log(`RUN ${RUN} · checker ${CHECKER} sha256 ${checkerSha} · ${N} cases`)
console.log(`2a decision accuracy (full set): ${pct(dec2a)}`)
console.log(`2b six-field accuracy (full set): ${pct(six2b)}`)
console.log(`coverage (decided): ${pct(decided)}`)
console.log(`WRONG decisions: ${wrong}`)
console.log(`selective accuracy (correct / decided): ${decided ? pct(dec2a, decided) : 'n/a'}`)
console.log('by segment (n · 2a · 2b · abstain · wrong):')
for (const [k, s] of Object.entries(bySeg)) console.log(`  ${k.padEnd(14)} ${s.n} · ${s.a} · ${s.b} · ${s.abst} · ${s.wrong}`)
console.log(`per-case results -> ${out}`)

// the comparison with the shipped file (the cmp a reader would run)
if (!existsSync(SHIPPED)) console.log(`compare: there is no shipped results/run-${RUN}.jsonl to compare with`)
else {
  const shipped = readFileSync(SHIPPED, 'utf8')
  if (shipped === bytes) console.log(`compare: IDENTICAL to the shipped results/run-${RUN}.jsonl (byte for byte)`)
  else {
    const a = shipped.split('\n'), b = bytes.split('\n')
    let i = 0
    while (i < Math.max(a.length, b.length) && a[i] === b[i]) i++
    console.log(`compare: DIFFERS from the shipped results/run-${RUN}.jsonl (first differing line ${i + 1})`)
    process.exitCode = 1
  }
}
