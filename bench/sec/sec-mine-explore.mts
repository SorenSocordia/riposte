/**
 * EXPLORATORY, post hoc (after the frozen SEC-MINE verdict was recorded). Question: in ENTER, do the non-LAF filers
 * with float >= $700M fall under 12b-2's LAF condition (iv)? That condition excludes an issuer "eligible to use the
 * requirements for smaller reporting companies under the revenue test". Revenue for that test is "as of the most recently
 * completed fiscal year for which audited financial statements are available" (SRC (3)(i)(B)). At the June 30, 2025
 * determination that is FY2024, so revenue is read here from the FY2024 10-K (FSDS 2025q1 NUM).
 */
import { createReadStream, readFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const HERE = dirname(fileURLToPath(import.meta.url))
const rows = readFileSync(join(HERE, 'sec-mine-cases-ENTER.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
const sub = readFileSync(join(HERE, 'data', '2025q1', 'sub.txt'), 'utf8').split(/\r?\n/)
const cols = sub[0]!.split('\t')
const prior = new Map<string, string>() // cik -> FY2024 10-K adsh (latest accepted)
const acc = new Map<string, string>()
for (const l of sub.slice(1)) {
  if (!l) continue
  const r = Object.fromEntries(cols.map((c, i) => [c, l.split('\t')[i] ?? '']))
  if (r.form !== '10-K' || r.fye !== '1231' || r.period !== '20241231') continue
  const cik = String(Number(r.cik))
  if (!acc.has(cik) || r.accepted! > acc.get(cik)!) { acc.set(cik, r.accepted!); prior.set(cik, r.adsh!) }
}
const cikOf = (link: string): string => link.split('/')[6]!
const want = new Map(rows.map((r) => [prior.get(cikOf(r.link)), r]))
const rev24 = new Map<string, Record<string, number>>()
const rl = createInterface({ input: createReadStream(join(HERE, 'data', '2025q1', 'num.txt'), 'utf8'), crlfDelay: Infinity })
let nc: string[] | null = null
for await (const line of rl) {
  if (!nc) { nc = line.split('\t'); continue }
  const v = line.split('\t')
  if (!want.has(v[0]!)) continue
  const r = Object.fromEntries(nc.map((c, i) => [c, v[i] ?? '']))
  if (!['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax'].includes(r.tag!) || r.ddate !== '20241231' || r.qtrs !== '4' || r.uom !== 'USD' || r.coreg !== '' || (r.segments ?? '') !== '' || r.value === '') continue
  const m = rev24.get(r.adsh!) ?? {}; rev24.set(r.adsh!, m); if (m[r.tag!] === undefined) m[r.tag!] = Number(r.value)
}
const out = rows.map((r) => { const m = rev24.get(prior.get(cikOf(r.link)) ?? '') ?? {}; return { ...r, rev_fy2024: m.Revenues ?? m.RevenueFromContractWithCustomerExcludingAssessedTax ?? null } })
writeFileSync(join(HERE, 'sec-mine-explore-ENTER.jsonl'), out.map((o) => JSON.stringify(o)).join('\n') + '\n')
const hi = out.filter((r) => r.fields.float >= 700e6)
const t = (f: (r: typeof out[number]) => boolean) => { const s = hi.filter(f); return `${s.length} (LAF ${s.filter((r) => r.label === '1-LAF').length}, non ${s.filter((r) => r.label !== '1-LAF').length})` }
console.log('float >= 700M, FY2024 revenue < 100M :', t((r) => r.rev_fy2024 !== null && r.rev_fy2024 < 100e6))
console.log('float >= 700M, FY2024 revenue >= 100M:', t((r) => r.rev_fy2024 !== null && r.rev_fy2024 >= 100e6))
console.log('float >= 700M, FY2024 revenue missing :', t((r) => r.rev_fy2024 === null))
// the statutory rule with condition (iv) approximated as "FY2024 revenue < 100M ⇒ not LAF" (missing revenue: condition not applied)
const law = (r: typeof out[number]) => r.fields.float >= 700e6 && !(r.rev_fy2024 !== null && r.rev_fy2024 < 100e6)
const dis = out.filter((r) => law(r) !== (r.label === '1-LAF'))
console.log(`float-only statute disagreements: ${out.filter((r) => (r.fields.float >= 700e6) !== (r.label === '1-LAF')).length}; with condition (iv): ${dis.length} of ${out.length}`)
for (const r of dis) console.log('  ', (r.fields.float / 1e6).toFixed(1).padStart(8), r.label, r.rev_fy2024 === null ? 'rev24 ?' : `rev24 ${(r.rev_fy2024 / 1e6).toFixed(0)}M`, r.name.slice(0, 40))
