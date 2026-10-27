// Raw trace dump (PREREG §7 audit protocol): case attributes + every event in FILE ORDER, with no computed operands.
//   node dump.mjs --first 1500 > results/dev-slice-dump.txt
//   node dump.mjs --sample results/audit-sample.json --which fail > results/audit-dump-fail.txt
import { readFileSync } from 'node:fs'
import { traces } from './xes.mjs'

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d }
const data = arg('--data', 'data/BPI_Challenge_2019.xes')
const first = arg('--first') ? Number(arg('--first')) : null
let wanted = null
if (arg('--sample')) {
  const s = JSON.parse(readFileSync(arg('--sample'), 'utf8'))
  const list = s[arg('--which', 'fail')]
  wanted = new Map(list.map((x, k) => [x.index, k + 1]))
}
const SHOWN = new Set(['concept:name', 'time:timestamp', 'Cumulative net worth (EUR)', 'org:resource', 'User'])
const fmt = (v) => (typeof v === 'number' ? v.toFixed(2) : String(v))
const lines = []
const maxIndex = wanted ? Math.max(...wanted.keys()) : first - 1
for await (const t of traces(data, { limit: maxIndex + 1 })) {
  if (wanted && !wanted.has(t.index)) continue
  const a = t.attrs
  const head = `=== ${wanted ? `#${wanted.get(t.index)} ` : ''}[${t.index}] case ${a['concept:name']} | cat=${a['Item Category']} | GRIV=${a['GR-Based Inv. Verif.']} GR=${a['Goods Receipt']} | type=${a['Item Type']} | doc=${a['Document Type']} | vendor=${a['Vendor']} | spend=${a['Spend area text']} / ${a['Sub spend area text']}`
  const rest = Object.keys(a).filter((k) => !['concept:name', 'Item Category', 'GR-Based Inv. Verif.', 'Goods Receipt', 'Item Type', 'Document Type', 'Vendor', 'Spend area text', 'Sub spend area text'].includes(k))
  lines.push(head, `    other: ${rest.map((k) => `${k}=${a[k]}`).join(' ; ')}`)
  t.events.forEach((e, k) => {
    const extra = Object.keys(e).filter((x) => !SHOWN.has(x)).map((x) => `${x}=${fmt(e[x])}`).join(' ')
    lines.push(`  ${String(k + 1).padStart(3, '0')} ${e['time:timestamp']} | ${e['concept:name']} | ${e['Cumulative net worth (EUR)'] === undefined ? '-' : fmt(e['Cumulative net worth (EUR)'])} | ${e['org:resource'] ?? e['User'] ?? ''}${extra ? ' | ' + extra : ''}`)
  })
}
process.stdout.write(lines.join('\n') + '\n')
