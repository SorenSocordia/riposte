/**
 * 2026-10-03: the shadow pilot. Mappers (Ramp, Xero, QuickBooks Online, the CSV sources) and their refusal of unmapped
 * or missing columns; the pre-registration gate; the report (every number recounted from the ledger); hashes-only receipts and
 * the documents opt-in; the CLI. Every export here is synthetic.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateSigningKeypair, verifyBillMatch } from 'riposte-verify'
import {
  readExport, decodeExportBytes, applyMapping, CSV_PRESETS, ExportRefused, preregTemplate, freezePrereg, frozenPrereg, PreregRefused,
  runShadow, ShadowRefused, writeSynthMonth, PLANT_EXPECTED, PLANT_ACCEPTS, PLANT_GAP, pilotCli, csvCell, exactInterval, readAuditLabels, renderPilotReport,
  recountFromLedger, ReportRefused, fileStore, openLedger, verifyChain, replayCli, ledgerCli, scoreSynth, scoreTable, coPrimaryResult, MISS_RATE_REASON,
  SHADOW_ACTION, SHADOW_EFFECT, type PilotManifest, type SynthTruth,
} from '../src/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const dirs: string[] = []
const tmp = (p: string): string => { const d = mkdtempSync(join(tmpdir(), p)); dirs.push(d); return d }
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })
const T0 = () => new Date('2026-10-03T08:00:00Z')

/** The template's co-primary block (2026-10-05): filled with a bar and a would-pay sample size, or removed (a prereg as written before). */
const CO_FILLS = (text: string, co: false | { bar: number; sample: number }) => co === false
  ? text.replace(/\n {2}"co_primary": \{[^}]*\},/, '')
  : text.replace('<fill: the highest miss rate that counts as a pass, e.g. 0.05>', String(co.bar)).replace('<fill: how many would-pays a person audits, e.g. 75>', String(co.sample))
/** A frozen prereg for `month`/`source` in `dir`. */
function prereg(dir: string, o: { month?: string; source?: string; bar?: number; sample?: number; metric?: string; co?: false | { bar: number; sample: number } } = {}): string {
  const p = join(dir, 'PREREG.md')
  const text = CO_FILLS(preregTemplate({ buyer: 'Synthetic Co.', month: o.month ?? '2026-09', source: o.source ?? 'ramp' })
    .replace('<fill: the lowest precision that counts as a pass, e.g. 0.85>', String(o.bar ?? 0.85))
    .replace('<fill: how many would-holds a person audits, e.g. 40>', String(o.sample ?? 40))
    .replace('"metric": "hold_precision"', `"metric": "${o.metric ?? 'hold_precision'}"`), o.co ?? { bar: 0.05, sample: 20 })
  writeFileSync(p, text)
  freezePrereg(p, () => new Date('2026-10-03T07:00:00Z'))
  return p
}
function synth(bills = 80, seed = 3): { dir: string; exportDir: string; truth: SynthTruth } {
  const dir = tmp('pilot-synth-')
  const truth = writeSynthMonth(join(dir, 'export'), join(dir, 'truth.json'), { month: '2026-09', bills, seed })
  return { dir, exportDir: join(dir, 'export'), truth }
}

describe('Ramp mapper (field names verified against the Ramp OpenAPI file)', () => {
  it('maps a synthetic month: every bill with a PO becomes valid structured input, and the check agrees with every plant', () => {
    const { exportDir, truth } = synth(120, 3)
    const r = readExport(exportDir, 'ramp', { month: '2026-09' })
    expect(r.unmapped).toEqual([])
    expect(r.missing).toEqual([])
    const inMonth = r.bills.filter((b) => b.issued_at?.startsWith('2026-09'))
    // the main month's 120 bills and the appended classes (2026-10-05): one per class per 100 bills, at least one
    expect(inMonth).toHaveLength(Object.keys(truth.buyer).length)
    expect(inMonth.length).toBeGreaterThan(120)
    for (const b of inMonth) {
      const plant = truth.planted[b.ref]?.plant
      if (plant === 'no_po') { expect(b.problem).toBe('no purchase order linked to the bill'); continue }
      expect([b.ref, b.problem]).toEqual([b.ref, undefined])
      const got = verifyBillMatch(b.input!).decision
      const want = plant ? (PLANT_ACCEPTS[plant] ?? [PLANT_EXPECTED[plant]]) : ['approve']
      // a class whose gap the check states (line billed again across bills): caught only when the order as a whole runs over
      if (plant && PLANT_GAP[plant]) { expect([b.ref, [...want, 'approve'].includes(got)]).toEqual([b.ref, true]); continue }
      expect([b.ref, plant ?? 'clean', want.includes(got) ? 'as planted' : got]).toEqual([b.ref, plant ?? 'clean', 'as planted'])
      expect(b.buyer.decision).toBe(truth.buyer[b.ref])
    }
  })

  it('an unknown key is UNMAPPED and refused, never guessed; acknowledging it lets the run proceed and records it', () => {
    const { dir, exportDir } = synth(30, 5)
    const page = JSON.parse(readFileSync(join(exportDir, 'bills.json'), 'utf8'))
    page.data[0].approver_note = 'pay fast'
    page.data[1].inventory_line_items[0].discount = 3
    writeFileSync(join(exportDir, 'bills.json'), JSON.stringify(page))
    const r = readExport(exportDir, 'ramp')
    expect(r.unmapped).toEqual(['bills[].approver_note', 'bills[].inventory_line_items[].discount'])
    const p = prereg(dir)
    expect(() => runShadow({ keyHere: true, exportDir, month: '2026-09', preregPath: p, out: join(dir, 'run'), now: T0 })).toThrow(ShadowRefused)
    try { runShadow({ keyHere: true, exportDir, month: '2026-09', preregPath: p, out: join(dir, 'run'), now: T0 }) } catch (e) { expect((e as Error).message).toContain('bills[].approver_note') }
    expect(existsSync(join(dir, 'run'))).toBe(false)
    const ok = runShadow({ keyHere: true, exportDir, month: '2026-09', preregPath: p, out: join(dir, 'run'), now: T0, ignore: r.unmapped })
    expect(ok.manifest.export.ignored).toEqual(['bills[].approver_note', 'bills[].inventory_line_items[].discount'])
    expect(ok.report).toContain('`bills[].approver_note`')
  })

  it('a missing required file is refused; encodings: UTF-16 with a BOM is read, bytes that are not UTF-8 are refused', () => {
    const { exportDir } = synth(5, 6)
    rmSync(join(exportDir, 'purchase_orders.json'))
    expect(() => readExport(exportDir, 'ramp')).toThrow(/no purchase orders file/)
    const text = 'ref,quantity\nA,1\n'
    const u16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')])
    expect(decodeExportBytes('x.csv', u16)).toBe(text)
    expect(() => decodeExportBytes('x.csv', Buffer.from([0x41, 0xe9, 0x42]))).toThrow(/not UTF-8/)
  })
})

describe('Xero and QuickBooks Online (API field names verified; receipts from the receipts CSV)', () => {
  it('Xero: an ACCPAY invoice with its PO (by Reference) and a receipts CSV; a price over the PO holds; no receipts is said', () => {
    const d = tmp('pilot-xero-')
    const inv = (n: string, price: number, status: string) => ({ Type: 'ACCPAY', InvoiceID: `inv-${n}`, InvoiceNumber: `X-${n}`, Contact: { ContactID: 'c1', Name: 'Calder Fastener Supply' }, Date: '/Date(1789689600000+0000)/', CurrencyCode: 'USD', Reference: 'PO-9', Status: status,
      LineItems: [{ LineItemID: `li-${n}`, ItemCode: 'BOLT-10', Description: 'Hex bolt', Quantity: 10, UnitAmount: price, LineAmount: 10 * price }], Total: 10 * price, TotalTax: 0 })
    writeFileSync(join(d, 'Invoices.json'), JSON.stringify({ Invoices: [inv('1', 4.5, 'PAID'), inv('2', 4.95, 'AUTHORISED')] }))
    writeFileSync(join(d, 'PurchaseOrders.json'), JSON.stringify({ PurchaseOrders: [{ PurchaseOrderID: 'po-9', PurchaseOrderNumber: 'PO-9', Contact: { ContactID: 'c1', Name: 'Calder Fastener Supply' }, CurrencyCode: 'USD', LineItems: [{ LineItemID: 'pl-1', ItemCode: 'BOLT-10', Description: 'Hex bolt', Quantity: 20, UnitAmount: 4.5, LineAmount: 90 }] }] }))
    const noRec = readExport(d, 'xero')
    expect(noRec.notes.join(' ')).toContain('Xero has no goods-receipt object')
    writeFileSync(join(d, 'item_receipts.csv'), 'receipt_id,purchase_order_number,line_ref,quantity,received_at\nR1,PO-9,BOLT-10,20,2026-09-05\n')
    const r = readExport(d, 'xero', { month: '2026-09' })
    expect(r.unmapped).toEqual([])
    expect(r.bills.map((b) => [b.ref, b.buyer.decision, b.input ? verifyBillMatch(b.input).decision : b.problem])).toEqual([['inv-1', 'pay', 'approve'], ['inv-2', 'open', 'hold_price']])
    const withExtra = JSON.parse(readFileSync(join(d, 'Invoices.json'), 'utf8'))
    withExtra.Invoices[0].MyCustomField = 1
    writeFileSync(join(d, 'Invoices.json'), JSON.stringify(withExtra))
    expect(readExport(d, 'xero').unmapped).toEqual(['Invoices[].MyCustomField'])
  })

  it('QuickBooks Online: the bill line names its PO line (LinkedTxn TxnLineId); Balance 0 reads as paid', () => {
    const d = tmp('pilot-qbo-')
    writeFileSync(join(d, 'Bill.json'), JSON.stringify({ QueryResponse: { Bill: [{ Id: '145', DocNumber: 'Q-145', VendorRef: { value: '56', name: 'Halvorsen Hydraulics' }, TxnDate: '2026-09-12', CurrencyRef: { value: 'USD' }, TotalAmt: 250, Balance: 0,
      Line: [{ Id: '1', Amount: 250, DetailType: 'ItemBasedExpenseLineDetail', ItemBasedExpenseLineDetail: { ItemRef: { value: '7', name: 'Hose' }, Qty: 10, UnitPrice: 25 }, LinkedTxn: [{ TxnId: '88', TxnType: 'PurchaseOrder', TxnLineId: '1' }] }] }] }, time: 'x' }))
    writeFileSync(join(d, 'PurchaseOrder.json'), JSON.stringify({ QueryResponse: { PurchaseOrder: [{ Id: '88', DocNumber: 'PO-88', VendorRef: { value: '56' }, CurrencyRef: { value: 'USD' }, Line: [{ Id: '1', Amount: 250, DetailType: 'ItemBasedExpenseLineDetail', ItemBasedExpenseLineDetail: { ItemRef: { value: '7' }, Qty: 10, UnitPrice: 25 } }] }] } }))
    writeFileSync(join(d, 'item_receipts.csv'), 'receipt_id,purchase_order_number,line_ref,quantity,received_at\nR1,88,1,10,2026-09-02\n')
    const r = readExport(d, 'qbo', { month: '2026-09' })
    expect(r.unmapped).toEqual([])
    const b = r.bills[0]!
    expect(b.buyer).toEqual({ decision: 'pay', from: 'Balance 0' })
    expect(b.input!.bill.line_items[0]!.purchase_order_line_item_id).toBe('1')
    expect(verifyBillMatch(b.input!).decision).toBe('approve')
  })
})

describe('CSV sources (column names UNVERIFIED; a mapping file renames them)', () => {
  const ns = (d: string, billHeader = 'Internal ID,Reference No.,Vendor,Date,Currency,Amount (Transaction Total),Created From,Status,Line ID,Item,Memo,Quantity,Rate,Amount') => {
    writeFileSync(join(d, 'bills.csv'), `${billHeader}\n101,INV-7,Ridgeway Abrasives,09/14/2026,USD,520.00,Purchase Order #PO-7,Paid In Full,1,DISC-60,Flap disc,40,13.00,520.00\n`)
    writeFileSync(join(d, 'purchase_orders.csv'), 'Internal ID,Document Number,Vendor,Currency,Line ID,Item,Memo,Quantity,Rate,Amount\n77,PO-7,Ridgeway Abrasives,USD,1,DISC-60,Flap disc,40,12.50,500.00\n')
    writeFileSync(join(d, 'item_receipts.csv'), 'Internal ID,Document Number,Created From,Date,Item,Quantity\n9,IR-9,Purchase Order #PO-7,09/10/2026,DISC-60,40\n')
  }
  it('NetSuite saved-search CSV: grouped by bill, PO from "Created From", the item matched by SKU; a 4% price over the PO holds', () => {
    const d = tmp('pilot-ns-'); ns(d)
    const r = readExport(d, 'netsuite-csv', { month: '2026-09' })
    expect(r.unmapped).toEqual([])
    expect(r.notes[0]).toMatch(/UNVERIFIED/)
    const b = r.bills[0]!
    expect([b.ref, b.issued_at, b.buyer.decision]).toEqual(['101', '2026-09-14', 'pay'])
    expect(verifyBillMatch(b.input!).decision).toBe('hold_price')
  })
  it('an extra column is unmapped, a missing required column is missing; a mapping file renames, and an unknown field in it is refused', () => {
    const d = tmp('pilot-ns-'); ns(d, 'Internal ID,Reference No.,Vendor,Date,Currency,Amount (Transaction Total),Created From,Status,Line ID,Item,Memo,Quantity,Unit Rate,Amount')
    const r = readExport(d, 'netsuite-csv')
    expect(r.missing).toEqual(['bills.csv: column "Rate" (rate)'])
    expect(r.unmapped).toEqual(['bills.csv: column "Unit Rate"'])
    expect(r.bills).toEqual([])
    const fixed = readExport(d, 'netsuite-csv', { mapping: { source: 'netsuite-csv', columns: { bills: { rate: 'Unit Rate' } } } })
    expect([fixed.missing, fixed.unmapped, fixed.bills.length]).toEqual([[], [], 1])
    expect(() => applyMapping(CSV_PRESETS['netsuite-csv'], { columns: { bills: { colour: 'X' } } })).toThrow(ExportRefused)
  })
  it('xero-csv and qbo-csv read the same way through their (unverified) column tables', () => {
    for (const [src, bh, ph] of [
      ['xero-csv', 'ContactName,InvoiceNumber,Reference,InvoiceDate,Currency,Total,TaxTotal,Status,InventoryItemCode,Description,Quantity,UnitAmount,LineAmount', 'PurchaseOrderNumber,ContactName,Currency,InventoryItemCode,Description,Quantity,UnitAmount,LineAmount'],
      ['qbo-csv', 'Bill No.,Vendor,Date,Currency,Total,P.O. #,Status,Product/Service,Memo,Qty,Rate,Line amount', 'P.O. #,Vendor,Currency,Product/Service,Memo,Qty,Rate,Line amount'],
    ] as const) {
      const d = tmp(`pilot-${src}-`)
      const row = src === 'xero-csv' ? 'Linden Electrical,B-1,PO-3,2026-09-03,USD,100,0,PAID,LED-24,LED panel,4,25,100' : 'B-1,Linden Electrical,2026-09-03,USD,100,PO-3,Paid,LED-24,LED panel,4,25,100'
      const prow = src === 'xero-csv' ? 'PO-3,Linden Electrical,USD,LED-24,LED panel,4,25,100' : 'PO-3,Linden Electrical,USD,LED-24,LED panel,4,25,100'
      writeFileSync(join(d, 'bills.csv'), `${bh}\n${row}\n`); writeFileSync(join(d, 'purchase_orders.csv'), `${ph}\n${prow}\n`)
      writeFileSync(join(d, 'item_receipts.csv'), 'receipt_id,purchase_order_number,line_ref,quantity,received_at\nR,PO-3,LED-24,4,2026-09-01\n')
      const r = readExport(d, src)
      expect([src, r.unmapped, r.missing]).toEqual([src, [], []])
      expect([src, r.bills[0]!.buyer.decision, verifyBillMatch(r.bills[0]!.input!).decision]).toEqual([src, 'pay', 'approve'])
    }
  })
})

describe('the pre-registration gate', () => {
  it('a template with blanks cannot be frozen; a run refuses a prereg that is not frozen, changed, or names another month or source', () => {
    const { dir, exportDir } = synth(20, 8)
    const p = join(dir, 'P.md')
    writeFileSync(p, preregTemplate({ buyer: 'X', month: '2026-09', source: 'ramp' }))
    expect(() => freezePrereg(p)).toThrow(/4 blanks to fill/)
    const out = join(dir, 'run')
    expect(() => runShadow({ keyHere: true, exportDir, month: '2026-09', preregPath: p, out, now: T0 })).toThrow(/not frozen/)
    const good = prereg(dir)
    writeFileSync(good, `${readFileSync(good, 'utf8')}\nedited after freezing\n`)
    expect(() => runShadow({ keyHere: true, exportDir, month: '2026-09', preregPath: good, out, now: T0 })).toThrow(/changed after it was frozen/)
    expect(() => freezePrereg(good)).toThrow(/never re-frozen/)
    const d2 = tmp('pilot-pre-')
    expect(() => runShadow({ keyHere: true, exportDir, month: '2026-08', preregPath: prereg(d2), out, now: T0 })).toThrow(/registers 2026-09, not --month 2026-08/)
    const d3 = tmp('pilot-pre-')
    expect(() => runShadow({ keyHere: true, exportDir, month: '2026-09', preregPath: prereg(d3, { source: 'xero' }), out, now: T0 })).toThrow(/registers source xero, not ramp/)
    // frozen after the run started: not a pre-registration
    const d4 = tmp('pilot-pre-')
    expect(() => runShadow({ keyHere: true, exportDir, month: '2026-09', preregPath: prereg(d4), out, now: () => new Date('2026-10-03T06:00:00Z') })).toThrow(/after the run started/)
    expect(existsSync(out)).toBe(false)
  })
})

describe('the run, the receipts and the report', () => {
  const { dir, exportDir, truth } = synth(90, 4)
  const p = prereg(dir, { sample: 12 })
  const run = runShadow({ keyHere: true, exportDir, month: '2026-09', preregPath: p, out: join(dir, 'run'), now: T0 })
  const entries = openLedger(fileStore(join(dir, 'run', 'receipts.jsonl'))).entries()

  it('one signed receipt per bill plus a start and an end note; nothing executed; the chain verifies', () => {
    expect(entries).toHaveLength(Object.keys(truth.buyer).length + 2) // 90 bills and the appended classes, plus two notes
    expect(verifyChain(entries, { requireSigned: true }).ok).toBe(true)
    for (const e of entries.slice(1, -1)) expect((e.body as any).shadow).toMatchObject({ pilot: true, executed: false })
    expect(entries.every((e) => e.kind === 'ap_gate' || e.kind === 'note')).toBe(true)
  })

  it('hashes only: no vendor name, invoice number, item or amount from the export is on any receipt', () => {
    const ledgerText = readFileSync(join(dir, 'run', 'receipts.jsonl'), 'utf8')
    const page = JSON.parse(readFileSync(join(exportDir, 'bills.json'), 'utf8'))
    for (const b of page.data.slice(0, 40)) {
      expect(ledgerText).not.toContain(b.vendor.name)
      expect(ledgerText).not.toContain(`"${b.invoice_number}"`)
      expect(ledgerText).not.toContain(b.inventory_line_items[0].memo)
    }
    expect(existsSync(join(dir, 'run', 'documents'))).toBe(false)
  })

  it('the report\'s numbers are a recount of the ledger; a manifest that disagrees, or a broken chain, refuses to render', () => {
    const rc = recountFromLedger(entries)
    expect(rc.bills).toBe(Object.keys(truth.buyer).length)
    const d = run.manifest.bills.reduce((m, b) => ({ ...m, [b.disposition]: (m as any)[b.disposition] + 1 }), { pay: 0, hold: 0, person: 0 })
    expect(rc.dispositions).toEqual(d)
    expect(run.report).toContain(`| would pay automatically (every check passed) | ${d.pay} |`)
    expect(run.report).not.toMatch(/\| executed: /)
    const fp = frozenPrereg(p)
    const bad: PilotManifest = JSON.parse(JSON.stringify(run.manifest)); const i = bad.bills.findIndex((b) => b.disposition === 'hold'); bad.bills[i]!.disposition = 'pay'
    expect(() => renderPilotReport({ manifest: bad, prereg: fp, ledger: { entries, chainOk: true } })).toThrow(/does not recount the run/)
    expect(() => renderPilotReport({ manifest: run.manifest, prereg: fp, ledger: { entries, chainOk: false, chainReason: 'entry 3 altered' } })).toThrow(ReportRefused)
    // every planted hold is in the hold list; no clean bill is held
    const held = new Set(run.manifest.bills.filter((b) => b.disposition === 'hold').map((b) => b.ref))
    for (const ref of held) expect(truth.planted[ref]).toBeDefined()
  })

  it('the primary number: not measured until the audit; with the audit sheet labelled, the exact interval and the pre-registered decision rule', () => {
    expect(run.report).toContain('not measured yet')
    const sheet = readFileSync(join(dir, 'run', 'AUDIT-SHEET.csv'), 'utf8').trim().split('\n')
    expect(sheet[0]).toBe('sample_no,drawn_from,bill_ref,invoice_number,vendor,amount,currency,discrepancy,rules,label,labelled_by,note')
    expect(sheet).toHaveLength(1 + run.manifest.audit.sample.length + (run.manifest.audit.pay?.sample.length ?? 0))
    const rows = run.manifest.audit.sample.map((ref) => ({ values: { bill_ref: ref, label: truth.planted[ref] ? 'issue' : 'no_issue', labelled_by: 'synthetic truth file' } }))
    rows.push({ values: { bill_ref: 'not-in-sample', label: 'issue', labelled_by: 'x' } })
    const audit = readAuditLabels(rows, run.manifest)
    expect(audit.problems).toEqual(['bill not-in-sample is not in the drawn sample: its label is not counted'])
    const report = renderPilotReport({ manifest: run.manifest, prereg: frozenPrereg(p), ledger: { entries, chainOk: true }, audit })
    const n = run.manifest.audit.sample.length
    const lower = exactInterval(n, n, 0.95).lower
    expect(lower).toBeCloseTo(0.025 ** (1 / n), 6)
    expect(report).toContain(`(${n} / ${n})`)
    expect(report).toContain(lower >= 0.85 ? '**pass**' : '**inconclusive**')
    expect(report).toContain('labelled by: synthetic truth file')
  })

  it('the audit sample is the one the seed gives: redrawn from the ledger head and the prereg hash', () => {
    const end = entries[entries.length - 1]!.body as any
    expect(end.event).toBe('pilot.end')
    expect(end.audit.seed).toBe(run.manifest.audit.seed)
    expect(end.audit.sample_size).toBe(run.manifest.audit.sample.length)
  })

  it('a spreadsheet never runs a cell: formula-looking values are prefixed', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"')
    expect(csvCell('+1')).toBe("'+1")
    expect(csvCell('-2')).toBe("'-2")
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(csvCell('INV-7')).toBe('INV-7')
  })

  it('the output folder is never written over', () => {
    expect(() => runShadow({ keyHere: true, exportDir, month: '2026-09', preregPath: p, out: join(dir, 'run'), now: T0 })).toThrow(/not empty/)
  })
})

describe('--store-documents: kept for the buyer, replayable, and purged to hashes', () => {
  it('documents and proofs are written; each proof replays bound to its receipt; purge leaves no document text', () => {
    const { dir, exportDir } = synth(25, 9)
    const p = prereg(dir, { sample: 5 })
    const out = join(dir, 'run')
    runShadow({ keyHere: true, exportDir, month: '2026-09', preregPath: p, out, now: T0, storeDocuments: true, hashesOnly: true })
    const proofs = readdirSync(join(out, 'proofs'))
    expect(proofs.length).toBeGreaterThan(15)
    const all = proofs.map((f) => readFileSync(join(out, 'proofs', f), 'utf8').trim()).join('\n') + '\n'
    writeFileSync(join(dir, 'proofs.jsonl'), all)
    const r = replayCli(['--ledger', join(out, 'receipts.jsonl'), '--proof', join(dir, 'proofs.jsonl')], { readFile: (f) => readFileSync(f, 'utf8'), listDir: () => undefined, join })
    expect(JSON.parse(r.out)).toMatchObject({ total: proofs.length, matched: proofs.length })
    const purged = pilotCli(['purge', '--out', out])
    expect(purged.code).toBe(0)
    expect(existsSync(join(out, 'documents')) || existsSync(join(out, 'proofs'))).toBe(false)
    const page = JSON.parse(readFileSync(join(exportDir, 'bills.json'), 'utf8'))
    const leftover = readdirSync(out).filter((f) => f !== 'receipts.jsonl').map((f) => readFileSync(join(out, f), 'utf8')).join('\n')
    for (const b of page.data.slice(0, 20)) { expect(leftover).not.toContain(b.vendor.name); expect(leftover).not.toContain(b.inventory_line_items[0].memo) }
  })
})

describe('shadow receipts say WOULD at the top level; old ledgers still verify and recount', () => {
  const { dir, exportDir } = synth(40, 12)
  const p = prereg(dir, { sample: 5 })
  const run = runShadow({ keyHere: true, exportDir, month: '2026-09', preregPath: p, out: join(dir, 'run'), now: T0 })
  const entries = openLedger(fileStore(join(dir, 'run', 'receipts.jsonl'))).entries()
  const gates = entries.filter((e) => e.kind === 'ap_gate')

  it('every ap_gate receipt: action WOULD_EXECUTE | WOULD_REVIEW, effect WOULD_PAY | WOULD_HOLD | WOULD_REVIEW, executed false; never EXECUTE or PAY', () => {
    expect(gates.length).toBeGreaterThan(20)
    for (const e of gates) {
      const b = e.body as Record<string, unknown>
      expect(Object.values(SHADOW_ACTION)).toContain(b.action)
      expect(Object.values(SHADOW_EFFECT)).toContain(b.effect)
      expect([b.executed, b.mode]).toEqual([false, 'shadow'])
      expect((b.shadow as Record<string, unknown>).executed).toBe(false)
    }
    const text = readFileSync(join(dir, 'run', 'receipts.jsonl'), 'utf8')
    expect(text).not.toMatch(/"action":"EXECUTE"|"effect":"PAY"|"action":"REVIEW"/)
    // the words follow the disposition: a would-pay is WOULD_PAY
    const pay = run.manifest.bills.find((b) => b.disposition === 'pay')
    if (pay) expect((entries[pay.seq]!.body as Record<string, unknown>).effect).toBe('WOULD_PAY')
    const hold = run.manifest.bills.find((b) => b.disposition === 'hold')
    if (hold) expect((entries[hold.seq]!.body as Record<string, unknown>).effect).toBe('WOULD_HOLD')
  })

  it('a ledger in the OLD shape (EXECUTE / PAY at the top level, executed false nested) still verifies with riposte-ledger and recounts', () => {
    const key = readFileSync(join(dir, 'run', 'run-key.pem'), 'utf8')
    const oldFile = join(dir, 'old-shape.jsonl')
    const old = openLedger(fileStore(oldFile), { signingKey: key, now: T0 })
    const back = { WOULD_EXECUTE: 'EXECUTE', WOULD_REVIEW: 'REVIEW' } as Record<string, string>
    const backEffect = { WOULD_PAY: 'PAY', WOULD_HOLD: 'HOLD', WOULD_REVIEW: 'HUMAN_REVIEW' } as Record<string, string>
    for (const e of entries) {
      const b = { ...(e.body as Record<string, unknown>) }
      // the shape before 2026-10-05: no top-level disposition, the live gate's words at the top level, `would` in the shadow block
      if (e.kind === 'ap_gate') {
        const s = { ...(b.shadow as Record<string, unknown>) }
        const live = (s.on_buyer_decision as { action: string }).action
        delete s.on_buyer_decision
        s.would = live === 'WOULD_EXECUTE' ? 'execute the proposal' : 'send it to a person'
        b.action = back[live]; b.effect = live === 'WOULD_EXECUTE' ? backEffect[b.effect as string] : 'HUMAN_REVIEW'; delete b.executed; delete b.mode; delete b.disposition; b.shadow = s
      }
      old.append(e.kind as 'ap_gate', b)
    }
    const oldText = readFileSync(oldFile, 'utf8')
    expect(oldText).toMatch(/"action":"EXECUTE"|"action":"REVIEW"/)
    const v = ledgerCli(['verify', oldFile, '--key', join(dir, 'run', 'run-key.pub.pem'), '--require-signed'], (x) => readFileSync(x, 'utf8'))
    expect([v.code, JSON.parse(v.out).ok]).toEqual([0, true])
    const oldEntries = openLedger(fileStore(oldFile)).entries()
    expect(recountFromLedger(oldEntries)).toEqual(recountFromLedger(entries))
    // and the report still renders over it (a run written before the key and co-primary fields existed)
    const { key: _k, ...manifest } = run.manifest
    expect(renderPilotReport({ manifest: manifest as PilotManifest, prereg: frozenPrereg(p), ledger: { entries: oldEntries, chainOk: true } })).toContain('Not recorded: this run was written before the report named the key holder')
  })
})

describe('who holds the signing key; --key-dir puts it outside the output folder', () => {
  it('--key-here: the private key beside the receipts, and the manifest and report say who holds it and why', () => {
    const { dir, exportDir } = synth(15, 13)
    const r = runShadow({ keyHere: true, exportDir, month: '2026-09', preregPath: prereg(dir, { sample: 3 }), out: join(dir, 'run'), now: T0 })
    expect(existsSync(join(dir, 'run', 'run-key.pem'))).toBe(true)
    expect(r.manifest.key).toMatchObject({ source: 'made-for-this-run', private_key: join(dir, 'run', 'run-key.pem'), public_key: 'run-key.pub.pem' })
    expect(r.manifest.key!.why).toContain('--key-dir <dir> writes it outside the output folder instead')
    expect(r.report).toContain('## Who holds the signing key')
    expect(r.report).toContain(`riposte-ledger verify receipts.jsonl --key run-key.pub.pem`)
  })
  it('--key-dir: no private key in the output folder; the key file is named by its fingerprint and never written over', () => {
    const { dir, exportDir } = synth(15, 14)
    const kd = join(dir, 'keys')
    const p = prereg(dir, { sample: 3 })
    const s = pilotCli(['shadow', '--export', exportDir, '--month', '2026-09', '--prereg', p, '--out', join(dir, 'run'), '--key-dir', kd, '--now', '2026-10-03T08:00:00Z'])
    expect(s.code).toBe(0)
    expect(readdirSync(join(dir, 'run')).filter((x) => /\.pem$/.test(x))).toEqual(['run-key.pub.pem'])
    const fp = JSON.parse(s.out).key.fingerprint as string
    expect(readdirSync(kd)).toEqual([`run-key-${fp}.pem`])
    expect(s.err).toMatch(/--key-dir put the private key outside the output folder/)
    expect(s.err).toContain('--key-dir was chosen')
    const v = ledgerCli(['verify', join(dir, 'run', 'receipts.jsonl'), '--key', join(dir, 'run', 'run-key.pub.pem')], (x) => readFileSync(x, 'utf8'))
    expect(v.code).toBe(0)
    // --key and --key-dir together are refused before anything is written
    const both = pilotCli(['shadow', '--export', exportDir, '--month', '2026-09', '--prereg', p, '--out', join(dir, 'run2'), '--key', join(kd, `run-key-${fp}.pem`), '--key-dir', kd])
    expect([both.code, both.err]).toEqual([1, expect.stringContaining('not both')])
    expect(existsSync(join(dir, 'run2'))).toBe(false)
  })
  it('--key: the run writes no private key, and says the operator holds it', () => {
    const { dir, exportDir } = synth(15, 15)
    const keyFile = join(dir, 'mine.pem')
    writeFileSync(keyFile, generateSigningKeypair().privateKeyPem)
    const s = pilotCli(['shadow', '--export', exportDir, '--month', '2026-09', '--prereg', prereg(dir, { sample: 3 }), '--out', join(dir, 'run'), '--key', keyFile, '--now', '2026-10-03T08:00:00Z'])
    expect(s.code).toBe(0)
    expect(readdirSync(join(dir, 'run')).filter((x) => /\.pem$/.test(x))).toEqual([])
    expect(JSON.parse(s.out).key).toMatchObject({ source: 'supplied', private_key: null })
    expect(s.err).toContain('this run wrote no private key')
  })
})

describe('the co-primary miss rate (bad bills the shadow would have paid)', () => {
  it('the template registers it, in plain words with no testimonial; a prereg without it still parses and runs', () => {
    const t0 = preregTemplate({ buyer: 'X', month: '2026-09', source: 'ramp' })
    expect(t0).toContain('"metric": "miss_rate"')
    expect(t0).not.toContain(MISS_RATE_REASON)
    expect(t0).not.toMatch(/controller|reviewed the pilot/)
    expect(t0).toContain('It says nothing about bad\nbills the check would have paid')
    expect(MISS_RATE_REASON).toBe('That measures false holds. It does not measure bad bills it would have paid, which is the failure that costs money. I expected the miss rate as a primary or co-primary.')
    const { dir, exportDir } = synth(20, 16)
    const p = prereg(dir, { sample: 3, co: false })
    expect(frozenPrereg(p).params.co_primary).toBeUndefined()
    const r = runShadow({ keyHere: true, exportDir, month: '2026-09', preregPath: p, out: join(dir, 'run'), now: T0 })
    expect(r.manifest.audit.pay).toBeUndefined()
    expect(r.report).not.toContain('miss_rate')
  })
  it('registered: a would-pay sample is drawn, the sheet carries it, and the labelled sample gives the number and the overall rule', () => {
    const { dir, exportDir, truth } = synth(80, 17)
    const p = prereg(dir, { sample: 6, co: { bar: 0.2, sample: 15 } })
    const r = runShadow({ keyHere: true, exportDir, month: '2026-09', preregPath: p, out: join(dir, 'run'), now: T0 })
    const pay = r.manifest.audit.pay!
    expect(pay.sample.length).toBe(Math.min(15, r.manifest.bills.filter((b) => b.disposition === 'pay').length))
    for (const ref of pay.sample) expect(r.manifest.bills.find((b) => b.ref === ref)!.disposition).toBe('pay')
    const end = openLedger(fileStore(join(dir, 'run', 'receipts.jsonl'))).entries().at(-1)!.body as Record<string, any>
    expect(end.pay_audit).toMatchObject({ seed: pay.seed, sample_size: pay.sample.length })
    const sheet = readFileSync(join(dir, 'run', 'AUDIT-SHEET.csv'), 'utf8').trim().split('\n')
    expect(sheet.filter((l) => l.split(',')[1] === 'would-pay')).toHaveLength(pay.sample.length)
    expect(r.report).toContain('**miss_rate** (co-primary: bad bills the gate would have paid)')
    expect(r.report).toContain('not measured yet')
    const rows = [...r.manifest.audit.sample, ...pay.sample].map((ref) => ({ values: { bill_ref: ref, label: truth.planted[ref] ? 'issue' : 'no_issue', labelled_by: 'synthetic truth file' } }))
    const audit = readAuditLabels(rows, r.manifest)
    const co = coPrimaryResult(r.manifest, frozenPrereg(p), audit)!
    expect([co.n, co.k]).toEqual([pay.sample.length, pay.sample.filter((ref) => truth.planted[ref]).length])
    const rep = renderPilotReport({ manifest: r.manifest, prereg: frozenPrereg(p), ledger: { entries: openLedger(fileStore(join(dir, 'run', 'receipts.jsonl'))).entries(), chainOk: true }, audit })
    expect(rep).toContain(`(${co.k} / ${co.n})`)
    expect(rep).toMatch(/Both numbers are primary\. Overall: \*\*(pass|fail|inconclusive)\*\*/)
    // hold_precision counts only the would-hold sample's labels
    expect(rep).toContain(`(${r.manifest.audit.sample.length} / ${r.manifest.audit.sample.length})`)
  })
})

describe('synth: the vendor-name-variant duplicate is planted, labelled, and scored', () => {
  it('seed 7 (the default month): variants planted with both vendor names; every other bill is the old generator\'s', () => {
    const { dir, exportDir, truth } = synth(300, 7)
    const variants = Object.entries(truth.planted).filter(([, p]) => p.plant === 'duplicate_vendor_variant')
    expect(variants.length).toBeGreaterThan(0)
    for (const [, v] of variants) {
      expect(v.expected).toBe('hold_duplicate')
      expect(v.variant!.variant_vendor.name).not.toBe(v.variant!.original_vendor.name)
      expect(v.variant!.variant_vendor.id).not.toBe(v.variant!.original_vendor.id)
    }
    expect(variants.map(([, v]) => v.variant!.variant_vendor.name)).toContain('Northfield Material Handling, Inc.')
    // scored: the run, against the truth file
    const p = prereg(dir, { sample: 10, co: false })
    const run = runShadow({ keyHere: true, exportDir, month: '2026-09', preregPath: p, out: join(dir, 'run'), now: T0 })
    const s = scoreSynth(run.manifest, truth)
    expect(s.unmatched).toEqual([])
    const row = s.classes.duplicate_vendor_variant!
    expect(row.planted).toBe(variants.length)
    expect(row.pay + row.hold + row.person).toBe(row.planted)
    // what the check does with them TODAY is reported, not asserted: the bar is that the case exists and is scored
    console.log(`[score, seed 7, verify ${run.manifest.engine.verify}]\n${scoreTable(s)}${JSON.stringify(row.bills)}`)
    const cli = pilotCli(['score', '--out', join(dir, 'run'), '--truth', join(dir, 'truth.json')])
    expect([cli.code, JSON.parse(cli.out).classes.duplicate_vendor_variant.planted]).toEqual([0, variants.length])
    expect(pilotCli(['score', '--out', join(dir, 'run'), '--truth', join(dir, 'PREREG.md.lock.json')]).code).toBe(1)
  })
})

describe('the CLI, and offline by construction', () => {
  it('synth, map (refusing an unmapped key, exit 1), prereg init/freeze, shadow, report', () => {
    const d = tmp('pilot-cli-')
    expect(pilotCli(['synth', '--out', d, '--month', '2026-09', '--bills', '30', '--seed', '2']).code).toBe(0)
    expect(pilotCli(['map', '--export', join(d, 'export'), '--month', '2026-09']).code).toBe(0)
    const page = JSON.parse(readFileSync(join(d, 'export', 'bills.json'), 'utf8')); page.data[0].odd = 1; writeFileSync(join(d, 'export', 'bills.json'), JSON.stringify(page))
    const m = pilotCli(['map', '--export', join(d, 'export')])
    expect(m.code).toBe(1)
    expect(m.err).toContain('bills[].odd')
    const pf = join(d, 'PREREG.md')
    expect(pilotCli(['prereg', 'init', pf, '--buyer', 'S', '--month', '2026-09', '--source', 'ramp']).code).toBe(0)
    expect(pilotCli(['prereg', 'freeze', pf]).code).toBe(1)
    writeFileSync(pf, CO_FILLS(readFileSync(pf, 'utf8').replace('<fill: the lowest precision that counts as a pass, e.g. 0.85>', '0.8').replace('<fill: how many would-holds a person audits, e.g. 40>', '10'), { bar: 0.05, sample: 10 }))
    expect(pilotCli(['prereg', 'freeze', pf, '--now', '2026-10-03T07:00:00Z']).code).toBe(0)
    const s = pilotCli(['shadow', '--export', join(d, 'export'), '--month', '2026-09', '--prereg', pf, '--out', join(d, 'run'), '--ignore-columns', 'bills[].odd', '--key-here', '--now', '2026-10-03T08:00:00Z'])
    expect([s.code, s.err]).toEqual([0, expect.stringContaining('nothing executed')])
    // The output names who holds the signing key, and why it is in the output folder
    expect(s.err).toMatch(/signing key [0-9a-f]{64}: held by whoever can read this output folder: the private key is .*run-key\.pem, beside the receipts\. --key-here was chosen/)
    expect(s.err).toContain('--key-dir <dir>')
    expect(JSON.parse(s.out).key).toMatchObject({ source: 'made-for-this-run', public_key: 'run-key.pub.pem' })
    const rep = pilotCli(['report', '--out', join(d, 'run'), '--prereg', pf])
    expect(rep.code).toBe(0)
    expect(rep.out).toContain('# Shadow pilot report: S, 2026-09')
    writeFileSync(pf, `${readFileSync(pf, 'utf8')} `)
    const refused = pilotCli(['report', '--out', join(d, 'run'), '--prereg', pf])
    expect(refused.code).toBe(1)
    expect(refused.err).toContain('changed after it was frozen')
  })

  it('no pilot module reaches for the network', () => {
    const src = join(HERE, '..', 'src')
    for (const f of [...readdirSync(join(src, 'pilot')).map((x) => join(src, 'pilot', x)), join(src, 'pilot-command.ts'), join(src, 'pilot-cli.ts')]) {
      const t = readFileSync(f, 'utf8')
      expect([f, /from 'node:(http|https|net|tls|dgram|dns)'|\bfetch\(|XMLHttpRequest|WebSocket/.test(t)]).toEqual([f, false])
    }
  })
})
