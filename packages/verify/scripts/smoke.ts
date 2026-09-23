import { verify, replayView } from '../src/index'

const clean = {
  invoice_number: 'INV-1001', currency: 'USD', invoice_date: '2026-09-15',
  line_items: [
    { description: 'Consulting', quantity: 10, unit_price: 150, amount: 1500 },
    { description: 'Travel', quantity: 1, unit_price: 250.5, amount: 250.5 },
  ],
  totals: { subtotal: 1750.5, tax_rate: 0.0825, tax: 144.42, total: 1894.92 },
}
const broken = {
  invoice_number: 'INV-1002', currency: 'USD', invoice_date: '2026-09-15',
  line_items: [
    { description: 'Consulting', quantity: 10, unit_price: 150, amount: 1500 },
    { description: 'Travel', quantity: 1, unit_price: 250.5, amount: 275 },
  ],
  totals: { subtotal: 1750.5, tax_rate: 0.0825, tax: 150, total: 1900.5 },
}
const eu = {
  invoice_number: 'INV-EU-7', currency: 'EUR',
  line_items: [{ description: 'Widget', quantity: '2', unit_price: '625,00 €', amount: '1.250,00 €' }],
  totals: { subtotal: '1.250,00', tax_rate: '19%', tax: '237,50', total: '1.487,50' },
}

const fixedNow = () => new Date('2026-09-22T00:00:00Z')
function run(label: string, ex: Record<string, unknown>) {
  const v = verify(ex, { now: fixedNow, producer: 'smoke' })
  console.log(`\n=== ${label}: ${v.outcome}   checked ${v.coverage.claims_checked}/${v.coverage.claims_total} · fail ${v.coverage.claims_fail} · insufficient ${v.coverage.claims_insufficient}   id=${v.verdict_id}`)
  for (const c of v.claims) {
    const tail = c.outcome === 'INSUFFICIENT_DATA' ? `[${c.insufficiency?.reason}] ${c.insufficiency?.detail}`
      : c.outcome === 'FAIL' ? `variance=${c.variance}  ${c.explanation}`
      : `${c.computation?.formula}`
    console.log(`  ${c.outcome.padEnd(17)} ${c.claim_id.padEnd(20)} ${c.locked ? 'LOCKED' : '      '}  ${tail}`)
  }
  return v
}
const a = run('CLEAN', clean)
run('BROKEN', broken)
run('EU-FORMATTED', eu)

const r1 = JSON.stringify(replayView(verify(clean, { now: fixedNow })))
const r2 = JSON.stringify(replayView(verify(JSON.parse(JSON.stringify(clean)), { now: fixedNow })))
const shuffled = Object.fromEntries(Object.entries(clean).reverse())
const r3 = JSON.stringify(replayView(verify(shuffled, { now: fixedNow })))
console.log(`\nREPLAY byte-identical: ${r1 === r2}`)
console.log(`KEY-ORDER independent: ${r1 === r3}`)
console.log(`\n--- CLEAN, first claim as a proof object:\n${JSON.stringify(a.claims[0], null, 2)}`)
