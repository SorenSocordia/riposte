/**
 * SEC-MINE (PREREG-SEC-MINE.md + amendment A1): can the miner rediscover the 12b-2 large-accelerated-filer thresholds
 * from real filings?
 *
 *   labels   FSDS 2026q1 sub.txt: afs of each calendar-year FY2025 10-K (form 10-K, fye 1231, period 20251231)
 *   prior    FSDS 2025q1 sub.txt: afs of the same CIK's FY2024 10-K (period 20241231); ENTER = prior not LAF, STAY = prior LAF
 *   float    frames API dei:EntityPublicFloat USD CY2025Q2I, end exactly 2025-06-30, > 0
 *   revenue  FSDS 2026q1 num.txt: Revenues, else RevenueFromContractWithCustomerExcludingAssessedTax; qtrs 4, ddate 20251231,
 *            USD, no segments, no coreg (the distractor field)
 *
 * mine(…, { thresholds: true, maxApprovedViolationRate: 0.02 }), HOLD = 1-LAF. Writes sec-mine-results.json and the case
 * tables (one row per filer, with its EDGAR link). The pass bar is evaluated here, mechanically, as the prereg wrote it.
 */
import { createReadStream, readFileSync, writeFileSync, existsSync, openSync, readSync, closeSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { mine, type MineCase, type MineSchema, type MineReport } from 'riposte-verify'

const HERE = dirname(fileURLToPath(import.meta.url))
const D26 = join(HERE, 'data')
const D25 = join(HERE, 'data', '2025q1')
const FRAME = join(D26, 'frames-EntityPublicFloat-USD-CY2025Q2I.json')
for (const p of [join(D26, 'sub.txt'), join(D26, 'num.txt'), join(D25, 'sub.txt'), FRAME]) if (!existsSync(p)) throw new Error(`missing input: ${p}`)

/** sha256 of a file, read in chunks (num.txt is ~560 MB). */
function sha(p: string): string {
  const h = createHash('sha256'), fd = openSync(p, 'r'), buf = Buffer.alloc(1 << 22)
  try { for (let n; (n = readSync(fd, buf, 0, buf.length, null)) > 0;) h.update(buf.subarray(0, n)) } finally { closeSync(fd) }
  return h.digest('hex')
}

function readTsv(path: string): Record<string, string>[] {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/).filter((l) => l.length)
  const cols = lines[0]!.split('\t')
  return lines.slice(1).map((l) => { const v = l.split('\t'); return Object.fromEntries(cols.map((c, i) => [c, v[i] ?? ''])) })
}

/** One calendar-year 10-K per CIK for a period: the latest accepted. */
function tenKs(path: string, period: string): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>()
  for (const r of readTsv(path)) {
    if (r.form !== '10-K' || r.fye !== '1231' || r.period !== period) continue
    const cik = String(Number(r.cik))
    const prev = out.get(cik)
    if (!prev || r.accepted! > prev.accepted!) out.set(cik, r)
  }
  return out
}

const cur = tenKs(join(D26, 'sub.txt'), '20251231')
const prior = tenKs(join(D25, 'sub.txt'), '20241231')

const frame = JSON.parse(readFileSync(FRAME, 'utf8')) as { data: { accn: string; cik: number; end: string; val: number }[] }
const floatBy = new Map<string, { val: number; end: string; accn: string }>()
for (const d of frame.data) floatBy.set(String(d.cik), d)

// revenue: one pass over num.txt, only the population's adsh
const adshSet = new Set([...cur.values()].map((r) => r.adsh!))
const REV = ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax']
const rev = new Map<string, Record<string, number>>()
{
  const rl = createInterface({ input: createReadStream(join(D26, 'num.txt'), 'utf8'), crlfDelay: Infinity })
  let cols: string[] | null = null
  for await (const line of rl) {
    if (!cols) { cols = line.split('\t'); continue }
    const v = line.split('\t')
    if (!adshSet.has(v[0]!)) continue
    const r = Object.fromEntries(cols.map((c, i) => [c, v[i] ?? '']))
    if (!REV.includes(r.tag!) || r.ddate !== '20251231' || r.qtrs !== '4' || r.uom !== 'USD' || r.coreg !== '' || (r.segments ?? '') !== '' || r.value === '') continue
    const m = rev.get(r.adsh!) ?? {}
    rev.set(r.adsh!, m)
    if (m[r.tag!] === undefined) m[r.tag!] = Number(r.value)
  }
}

const APPROVE = ['2-ACC', '3-SRA', '4-NON', '5-SML']
const SCHEMA: MineSchema = { approve: APPROVE, fields: { float: { type: 'money' }, revenue: { type: 'money' } } }
const OPTS = { thresholds: true, maxApprovedViolationRate: 0.02 } as const

const excluded: Record<string, number> = {}
const ex = (why: string): void => { excluded[why] = (excluded[why] ?? 0) + 1 }
const rows: { cohort: 'ENTER' | 'STAY'; c: MineCase; link: string; name: string; accn_match: boolean }[] = []
for (const [cik, s] of [...cur.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))) {
  if (!s.afs) { ex('no afs on the FY2025 10-K'); continue }
  const f = floatBy.get(cik)
  if (!f) { ex('no float in the CY2025Q2I frame'); continue }
  if (f.end !== '2025-06-30') { ex('float end date is not 2025-06-30'); continue }
  if (!(f.val > 0)) { ex('float is zero'); continue }
  const p = prior.get(cik)
  if (!p) { ex('no FY2024 10-K in FSDS 2025q1'); continue }
  if (!p.afs) { ex('no afs on the FY2024 10-K'); continue }
  const m = rev.get(s.adsh!) ?? {}
  const revenue = m.Revenues ?? m.RevenueFromContractWithCustomerExcludingAssessedTax
  const fields: Record<string, unknown> = { float: f.val, ...(revenue !== undefined ? { revenue } : {}) }
  rows.push({
    cohort: p.afs === '1-LAF' ? 'STAY' : 'ENTER',
    c: { id: s.adsh!, label: s.afs, fields },
    link: `https://www.sec.gov/Archives/edgar/data/${cik}/${s.adsh!.replace(/-/g, '')}/`,
    name: s.name!,
    accn_match: f.accn === s.adsh,
  })
}

function judge(report: MineReport, target: number): Record<string, unknown> {
  const first = report.candles[0]
  const float = [...report.candles, ...report.morgue].find((j) => j.id === 'C float <= c')
  const iv = float?.interval
  return {
    first_candle: first?.id ?? null,
    float_candle: float ? { fate: float.fate, c: float.c, interval: iv, holds: float.holds, approved: float.approved, decidable: float.decidable, decidable_holds: float.decidable_holds, p: float.p, new_holds: float.new_holds } : null,
    contains_target_literal: iv ? iv.lo! <= target && target < iv.hi! : false,
    same_partition_as_rule: iv ? iv.lo! < target && target <= iv.hi! : false,
    width: iv ? iv.hi! - iv.lo! : null,
    revenue: [...report.candles, ...report.morgue].filter((j) => j.id.startsWith('C revenue')).map((j) => ({ id: j.id, fate: j.fate, c: j.c, holds: j.holds, approved: j.approved, new_holds: j.new_holds, detail: j.detail })),
  }
}

const out: Record<string, unknown> = {
  inputs: {
    sub_2026q1_sha256: sha(join(D26, 'sub.txt')), num_2026q1_sha256: sha(join(D26, 'num.txt')), sub_2025q1_sha256: sha(join(D25, 'sub.txt')),
    frame_sha256: sha(FRAME), frame_rows: frame.data.length,
  },
  population: { fy2025_calendar_10k: cur.size, fy2024_calendar_10k: prior.size, kept: rows.length, excluded },
  options: OPTS,
}
for (const [cohort, target] of [['ENTER', 700_000_000], ['STAY', 560_000_000]] as const) {
  const set = rows.filter((r) => r.cohort === cohort)
  const report = mine({ cases: set.map((r) => r.c) }, SCHEMA, OPTS)
  const labels: Record<string, number> = {}
  for (const r of set) labels[r.c.label] = (labels[r.c.label] ?? 0) + 1
  const j = judge(report, target)
  // ENTER is the primary test (PASS / FAIL). STAY is secondary: PINS (contains, width <= 10%) / BRACKETS (contains) / MISSES.
  const firstOk = j.first_candle === 'C float <= c', contains = j.contains_target_literal === true, narrow = j.width !== null && (j.width as number) <= 0.1 * target
  const pass = cohort === 'ENTER' ? firstOk && contains && narrow : contains
  const verdict = cohort === 'ENTER' ? (pass ? 'PASS' : 'FAIL') : contains && narrow && firstOk ? 'PINS' : contains ? 'BRACKETS' : 'MISSES'
  out[cohort] = { n: set.length, labels, accn_match: set.filter((r) => r.accn_match).length, target, verdict, ...j, report }
  writeFileSync(join(HERE, `sec-mine-cases-${cohort}.jsonl`), set.map((r) => JSON.stringify({ ...r.c, name: r.name, link: r.link, accn_match: r.accn_match })).join('\n') + '\n')
  console.log(`${cohort}: n=${set.length} labels=${JSON.stringify(labels)} first=${j.first_candle} float c=${(j.float_candle as { c?: number } | null)?.c} interval=${JSON.stringify((j.float_candle as { interval?: unknown } | null)?.interval)} width=${j.width} → ${verdict}`)
}
writeFileSync(join(HERE, 'sec-mine-results.json'), JSON.stringify(out, null, 2) + '\n')
console.log('excluded', JSON.stringify(excluded))
