/**
 * Manual-review assist for the rows audit-v02.mts left UNEXPLAINED (held-out 2025q1, v0.2 FAILs). Copy of
 * audit-assist.mts in intent; everything it prints is EVIDENCE for the hand labels, never a classification, except (a).
 *
 *   npx tsx bench/sec/audit-assist-v02.mts
 *
 * Differences from audit-assist.mts, and why:
 *  (a) ROUNDING. audit-assist.mts's rule is kept VERBATIM (unit ∈ {1e6, 1e3} dividing every non-zero frozen-map field;
 *      |gap| ≤ 3 units → T3, "rounding, not in the pre-registered taxonomy → false alarm"). Under v0.2 it should not
 *      fire: v0.2's tolerance already allows U × n with n ≥ 3 for every audited check. It is kept so that the procedure
 *      is the same; if it fires, the row is printed with a note, because the unit here ignores v0.2's `tags.` operands.
 *      Rows whose |gap| is within 10 × v0.2's unit are listed as "near-rounding" evidence only.
 *  (b) ±gap matches among the filing's same-context facts: same context rule as audit-assist.mts (BS checks and XSTMT:
 *      instants at period; everything else incl. CF_ENDING_CASH: annual flows at period). Match tolerance = the row's
 *      v0.2 tolerance (audit-assist.mts used v0.1's max(2, 0.0003 × |left|)); a wider band only adds candidates.
 *  (c) EXTRA EVIDENCE (new, evidence only): matches in the other context; two-line sums in the same context; the other
 *      v0.2 forms of the check evaluated on the same filing; and the filing's own presented statement(s) from FSDS
 *      pre.txt (audit-pre-2025q1-v02.tsv, the sampled filings' rows streamed out of the official 2025q1.zip) with each
 *      line's value at the period, plus custom-tag labels from tag.txt.
 * Writes audit-assist-2025q1-v02.txt (the evidence) and rewrites audit-results-2025q1-v02.jsonl only if (a) fires.
 */
import { createReadStream, readFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const V02 = JSON.parse(readFileSync(join(HERE, '..', '..', '..', 'products', 'verify', 'docs', 'examples', 'financial-statement.ruleset.v0.2.json'), 'utf8'))
const rows = readFileSync(join(HERE, 'audit-results-2025q1-v02.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
const sample = new Map(readFileSync(join(HERE, 'audit-sample-2025q1-v02.jsonl'), 'utf8').trim().split('\n').map((l) => { const s = JSON.parse(l); return [`${s.check}|${s.adsh}`, s] }))
const open = rows.filter((r) => r.class === 'UNEXPLAINED' || r.class === 'T2' || r.class_mechanical_t2 !== r.class)
const need = new Set(open.map((r) => r.adsh))
const CTX: Record<string, string> = { BS_ACCOUNTING_EQUATION: '0', BS_LIAB_AND_EQUITY_TOTAL: '0', BS_ASSET_SPLIT: '0', BS_LIABILITY_SPLIT: '0', XSTMT_CASH_ARTICULATION: '0', CF_ENDING_CASH: '4' }
type F = { tag: string; ddate: string; qtrs: string; value: number }
const facts = new Map<string, F[]>()
const rl = createInterface({ input: createReadStream(join(HERE, 'data', '2025q1', 'num.txt'), 'utf8'), crlfDelay: Infinity })
let cols: string[] | null = null
for await (const line of rl) {
  if (!cols) { cols = line.split('\t'); continue }
  const v = line.split('\t')
  if (!need.has(v[0]!)) continue
  const r = Object.fromEntries(cols.map((c, i) => [c, v[i] ?? '']))
  if (r.uom !== 'USD' || r.coreg !== '' || (r.segments ?? '') !== '' || r.value === '') continue
  const a = facts.get(r.adsh!) ?? []; facts.set(r.adsh!, a); a.push({ tag: r.tag!, ddate: r.ddate!, qtrs: r.qtrs!, value: Number(r.value) })
}
// custom-tag labels (tag.txt rows whose version is the filing's adsh)
const labels = new Map<string, string>()
{
  const tl = createInterface({ input: createReadStream(join(HERE, 'data', '2025q1', 'tag.txt'), 'utf8'), crlfDelay: Infinity })
  let tc: string[] | null = null
  for await (const line of tl) {
    if (!tc) { tc = line.split('\t'); continue }
    const v = line.split('\t')
    if (need.has(v[1]!)) labels.set(`${v[1]}|${v[0]}`, v[7] ?? '')
  }
}
// presented statements (pre.txt subset)
const preLines = readFileSync(join(HERE, 'audit-pre-2025q1-v02.tsv'), 'utf8').split('\n').filter((l) => l.trim())
const pcols = preLines[0]!.split('\t')
const pre = preLines.slice(1).map((l) => { const v = l.split('\t'); return Object.fromEntries(pcols.map((c, i) => [c, (v[i] ?? '').replace(/\r$/, '')])) })
const STMTS: Record<string, string[]> = { BS_ACCOUNTING_EQUATION: ['BS'], BS_ASSET_SPLIT: ['BS'], BS_LIABILITY_SPLIT: ['BS'], BS_LIAB_AND_EQUITY_TOTAL: ['BS'], XSTMT_CASH_ARTICULATION: ['BS', 'CF'], IS_GROSS_PROFIT: ['IS'], IS_OPERATING_INCOME: ['IS'], IS_NET_INCOME: ['IS'], IS_COMPREHENSIVE_INCOME: ['CI', 'IS'], CF_NET_CHANGE: ['CF'], CF_ENDING_CASH: ['CF'] }

// v0.2 form evaluation (same resolution + tolerance as audit-v02.mts)
const round4 = (x: number) => Math.round(x * 1e4) / 1e4
const UNITS = [1_000_000, 100_000, 1_000, 1]
const unitOf = (ops: number[]) => ops.every((x) => Number.isInteger(x)) ? UNITS.find((u) => ops.every((x) => x % u === 0))! : 0
const tolOf = (ops: number[]) => Math.max(0.01, round4(0.0003 * Math.max(...ops.map(Math.abs))), unitOf(ops) * ops.length)
function evalForm(formula: string, s: Record<string, any>): string {
  const [l, r] = formula.split(' = ')
  const res = (role: string): number | undefined => { for (const p of V02.fields[role].paths) { const v = p.startsWith('tags.') ? s.tags[p.slice(5)] : s.fields[p]; if (v !== undefined) return v } return undefined }
  const lv = res(l!.trim()); if (lv === undefined) return `${formula}: n/a (${l} absent)`
  let sum = 0; const ops = [lv]
  for (const m of (' + ' + r!).matchAll(/([+-])\s*([A-Z_]+)(\?)?/g)) {
    const v = res(m[2]!); if (v === undefined) { if (m[3]) continue; return `${formula}: n/a (${m[2]} absent)` }
    sum += (m[1] === '-' ? -1 : 1) * v; ops.push(v)
  }
  const t = tolOf(ops)
  return `${formula}: ${Math.abs(lv - sum) <= t ? 'HOLDS' : 'fails'} (gap ${lv - sum}, tol ${t})`
}
const FORMS: Record<string, string[]> = {}
for (const c of V02.checks) FORMS[c.code] = [c, ...(c.alternatives ?? [])].map((f: any) => `${f.left} = ${f.right}`)

const fmt = (x: number) => x.toLocaleString('en-US')
const out: string[] = []
let roundingFired = 0
for (const r of open) {
  const s = sample.get(`${r.check}|${r.adsh}`)!
  const all = facts.get(r.adsh) ?? []
  const lab = (tag: string) => labels.get(`${r.adsh}|${tag}`) ? ` [custom: ${labels.get(`${r.adsh}|${tag}`)}]` : ''
  out.push(`\n=== ${r.check} ${r.adsh} ${r.name}  [auto: ${r.class}${r.class_mechanical_t2 !== r.class ? `; audit.mts-identical T2 would say ${r.class_mechanical_t2}` : ''}]`)
  out.push(`    ${r.link}   period ${s.period}  v0.1 outcome ${s.v01_outcome}  prevrpt ${s.prevrpt}`)
  out.push(`    ${r.formula}: left ${fmt(r.left)}  right ${fmt(r.right)}  gap ${fmt(r.gap)}  v0.2 tol ${r.tolerance}`)
  // (a) verbatim audit-assist.mts rounding rule
  const vals = Object.values(s.fields as Record<string, number>).filter((x) => x !== 0)
  const unit = [1_000_000, 1_000].find((u) => vals.every((x) => Math.abs(x) % u === 0)) ?? 1
  if (unit > 1 && Math.abs(r.gap) <= unit * 3) {
    roundingFired++
    out.push(`    (a) VERBATIM ROUNDING RULE FIRES (unit ${unit} over frozen fields, |gap| ≤ 3 units). NOTE: v0.2 operands may include tags.* values this unit ignores.`)
    if (r.class === 'UNEXPLAINED') { r.class = 'T3'; r.why = `ROUNDING: all values are multiples of ${unit.toLocaleString()}; |gap| ${Math.abs(r.gap).toLocaleString()} ≤ 3 units (presentation rounding; not in the pre-registered taxonomy → counted as a false alarm)` }
  }
  const opsUnit = s.explanation?.match(/unit (\d+) ×/)?.[1]
  if (opsUnit && Number(opsUnit) > 0 && Math.abs(r.gap) <= Number(opsUnit) * 10) out.push(`    near-rounding evidence: |gap| = ${Math.abs(r.gap) / Number(opsUnit)} × v0.2 unit ${opsUnit}`)
  out.push(`    v0.2 explanation: ${s.explanation}`)
  // (b) ±gap matches, same context
  const q = CTX[r.check] ?? '4'
  const tol = r.tolerance
  const same = all.filter((f) => f.ddate === s.period && f.qtrs === q)
  const other = all.filter((f) => f.ddate === s.period && f.qtrs === (q === '0' ? '4' : '0'))
  const one = (fs: F[]) => fs.filter((f) => Math.abs(Math.abs(f.value) - Math.abs(r.gap)) <= tol).map((f) => `${f.tag}=${fmt(f.value)}${lab(f.tag)}`)
  out.push(`    (b) ±gap matches (qtrs ${q}): ${one(same).slice(0, 10).join(' | ') || 'none'}`)
  out.push(`    (c) ±gap matches (other context): ${one(other).slice(0, 8).join(' | ') || 'none'}`)
  // two-line sums, same context (bounded)
  const cand = same.filter((f) => f.value !== 0 && Math.abs(f.value) <= Math.abs(r.gap) * 1.5 + tol)
  const pairs: string[] = []
  for (let i = 0; i < cand.length && pairs.length < 8; i++) for (let j = i + 1; j < cand.length && pairs.length < 8; j++) for (const sj of [1, -1]) {
    const x = cand[i]!.value + sj * cand[j]!.value
    if (Math.abs(Math.abs(x) - Math.abs(r.gap)) <= tol && cand[i]!.tag !== cand[j]!.tag) pairs.push(`${cand[i]!.tag}(${fmt(cand[i]!.value)}) ${sj > 0 ? '+' : '−'} ${cand[j]!.tag}(${fmt(cand[j]!.value)})`)
  }
  out.push(`    (c) two-line sums = ±gap: ${pairs.join(' | ') || 'none'}`)
  out.push(`    (c) v0.2 forms on this filing: ${FORMS[r.check]!.map((f) => evalForm(f, s)).join(' ;; ')}`)
  out.push(`    (c) v0.2 tags reported: ${JSON.stringify(s.tags)}`)
  if (r.check === 'CF_ENDING_CASH' || r.check === 'XSTMT_CASH_ARTICULATION') {
    const cc = all.filter((f) => ['CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents', 'CashAndCashEquivalentsAtCarryingValue'].includes(f.tag) && f.qtrs === '0').sort((a, b) => a.ddate.localeCompare(b.ddate))
    out.push(`    (c) cash instants: ${cc.map((f) => `${f.tag.slice(0, 12)}@${f.ddate}=${fmt(f.value)}`).join(' | ')}   frozen beginning pick: ${s.sources?.beginning_cash} lag ${s.beginning_cash_lag_days}`)
  }
  // presented statements
  for (const st of STMTS[r.check] ?? []) {
    const lines = pre.filter((p) => p.adsh === r.adsh && p.stmt === st && p.inpth === '0').sort((a, b) => (+a.report - +b.report) || (+a.line - +b.line))
    if (!lines.length) { out.push(`    [${st}] no pre.txt lines`); continue }
    out.push(`    [${st}] presented lines (report/line  label  tag  value@period qtrs4 | qtrs0):`)
    for (const p of lines) {
      const v4 = all.find((f) => f.tag === p.tag && f.ddate === s.period && f.qtrs === '4')?.value
      const v0 = all.find((f) => f.tag === p.tag && f.ddate === s.period && f.qtrs === '0')?.value
      if (v4 === undefined && v0 === undefined && !/total|net/i.test(p.plabel ?? '')) continue
      out.push(`      ${p.report}/${p.line}${p.negating === '1' ? ' (neg)' : ''}  ${String(p.plabel).slice(0, 70)}  ${p.tag}${p.version === r.adsh ? ' [custom]' : ''}  ${v4 !== undefined ? fmt(v4) : '·'} | ${v0 !== undefined ? fmt(v0) : '·'}`)
    }
  }
}
writeFileSync(join(HERE, 'audit-assist-2025q1-v02.txt'), out.join('\n') + '\n')
if (roundingFired) writeFileSync(join(HERE, 'audit-results-2025q1-v02.jsonl'), rows.map((o) => JSON.stringify(o)).join('\n') + '\n')
console.log(`assist: ${open.length} rows (UNEXPLAINED + auto-T2 + D9 rows); verbatim rounding rule fired on ${roundingFired}; evidence → audit-assist-2025q1-v02.txt (${out.length} lines)`)
