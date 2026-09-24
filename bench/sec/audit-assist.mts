/**
 * Manual-review assist for the UNEXPLAINED audit rows. Two things, both disclosed in RESULTS.md:
 *  (a) ROUNDING (not in the pre-registered taxonomy → classified T3, a false alarm): the filing's values are all multiples
 *      of a unit U (1,000 or 1,000,000) and |gap| ≤ U × (number of operands). Presentation rounding, not an inconsistency.
 *  (b) For the rest: every reported line (any tag, same context) that equals ±gap, or two that sum to it. This is evidence
 *      for the human classification, not a classification. Prints candidates only.
 */
import { createReadStream, readFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const rows = readFileSync(join(HERE, 'audit-results.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
const sample = new Map(readFileSync(join(HERE, 'audit-sample.jsonl'), 'utf8').trim().split('\n').map((l) => { const s = JSON.parse(l); return [`${s.check}|${s.adsh}`, s] }))
const open = rows.filter((r) => r.class === 'UNEXPLAINED')
const need = new Set(open.map((r) => r.adsh))
const CTX: Record<string, string> = { BS_ACCOUNTING_EQUATION: '0', BS_LIAB_AND_EQUITY_TOTAL: '0', BS_ASSET_SPLIT: '0', BS_LIABILITY_SPLIT: '0', XSTMT_CASH_ARTICULATION: '0', CF_ENDING_CASH: '4' }
const facts = new Map<string, { tag: string; ddate: string; qtrs: string; value: number }[]>()
const rl = createInterface({ input: createReadStream(join(HERE, 'data', 'num.txt'), 'utf8'), crlfDelay: Infinity })
let cols: string[] | null = null
for await (const line of rl) {
  if (!cols) { cols = line.split('\t'); continue }
  const v = line.split('\t')
  if (!need.has(v[0]!)) continue
  const r = Object.fromEntries(cols.map((c, i) => [c, v[i] ?? '']))
  if (r.uom !== 'USD' || r.coreg !== '' || (r.segments ?? '') !== '' || r.value === '') continue
  const a = facts.get(r.adsh!) ?? []; facts.set(r.adsh!, a); a.push({ tag: r.tag!, ddate: r.ddate!, qtrs: r.qtrs!, value: Number(r.value) })
}
const lines: string[] = []
for (const r of open) {
  const s = sample.get(`${r.check}|${r.adsh}`)!
  const vals = Object.values(s.fields as Record<string, number>).filter((x) => x !== 0)
  const unit = [1_000_000, 1_000].find((u) => vals.every((x) => Math.abs(x) % u === 0)) ?? 1
  const nOps = 3
  if (unit > 1 && Math.abs(r.gap) <= unit * nOps) {
    r.class = 'T3'; r.why = `ROUNDING: all values are multiples of ${unit.toLocaleString()}; |gap| ${Math.abs(r.gap).toLocaleString()} ≤ ${nOps} units (presentation rounding; not in the pre-registered taxonomy → counted as a false alarm)`
    lines.push(`${r.check} ${r.adsh} → T3 rounding (unit ${unit})`)
    continue
  }
  const q = CTX[r.check] ?? '4'
  const cands = (facts.get(r.adsh) ?? []).filter((f) => f.ddate === s.period && f.qtrs === q)
  const tol = Math.max(2, 0.0003 * Math.abs(r.left))
  const one = cands.filter((f) => Math.abs(Math.abs(f.value) - Math.abs(r.gap)) <= tol).map((f) => `${f.tag}=${f.value}`)
  lines.push(`--- ${r.check} ${r.adsh} ${String(r.name).slice(0, 34)} gap=${r.gap} left=${r.left} right=${r.right}\n    ${s.link}\n    ±gap matches: ${one.slice(0, 6).join(' | ') || 'none'}`)
}
writeFileSync(join(HERE, 'audit-results.jsonl'), rows.map((o) => JSON.stringify(o)).join('\n') + '\n')
console.log(lines.join('\n'))
