/**
 * 2026-10-05 (a cold reader in the controller's role): 34 of 300 receipts said WOULD_REVIEW at the top level ("send it to a person") while
 * the report counted their disposition as held or paid. The disposition the report counts is now the record: it is each
 * receipt's first field, `action`/`effect` are its WOULD_ words, and the live gate's reading of the buyer's decision is kept,
 * named, as `shadow.on_buyer_decision`. The report refuses receipts that say two things. And the audit sheet says a failed
 * total in words: "lines add to 20,961.36; the bill says 21,078.97; over by 117.61". Every export here is synthetic.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  preregTemplate, freezePrereg, runShadow, writeSynthMonth, openLedger, fileStore, receiptsThatDisagree, renderPilotReport,
  frozenPrereg, totalWords, shadowWords, ReportRefused, ledgerCli, type LedgerEntry,
} from '../src/index.js'

const dirs: string[] = []
const tmp = (p: string): string => { const d = mkdtempSync(join(tmpdir(), p)); dirs.push(d); return d }
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })
const T0 = () => new Date('2026-10-03T08:00:00Z')

function prereg(dir: string): string {
  const p = join(dir, 'PREREG.md')
  const text = preregTemplate({ buyer: 'Synthetic Mechanical', month: '2026-09', source: 'ramp' })
    .replace('<fill: the lowest precision that counts as a pass, e.g. 0.85>', '0.85').replace('<fill: how many would-holds a person audits, e.g. 40>', '20')
    .replace('<fill: the highest miss rate that counts as a pass, e.g. 0.05>', '0.05').replace('<fill: how many would-pays a person audits, e.g. 75>', '10')
  writeFileSync(p, text)
  freezePrereg(p, () => new Date('2026-10-03T07:00:00Z'))
  return p
}

const EFFECT = { pay: 'WOULD_PAY', hold: 'WOULD_HOLD', person: 'WOULD_REVIEW' } as const

describe('the receipt says first what the report counts', () => {
  const dir = tmp('pilot-r4-')
  const exportDir = join(dir, 'export')
  writeSynthMonth(exportDir, join(dir, 'truth.json'), { month: '2026-09', bills: 300, seed: 11, payApps: 8 })
  const p = prereg(dir)
  const run = runShadow({ keyHere: true, exportDir, month: '2026-09', preregPath: p, out: join(dir, 'run'), now: T0 })
  const entries = openLedger(fileStore(join(dir, 'run', 'receipts.jsonl'))).entries()
  const records = [...run.manifest.bills, ...(run.manifest.pay_apps ?? [])]

  it('every bill and pay-application receipt: the first field is the disposition the report counts, and effect is its word', () => {
    expect(records.length).toBeGreaterThanOrEqual(300)
    let n = 0
    for (const rec of records) {
      const b = entries[rec.seq]!.body as Record<string, any>
      expect(Object.keys(b)[0], `entry ${rec.seq}`).toBe('disposition')
      expect([b.disposition, b.shadow.disposition, b.effect], `entry ${rec.seq}`).toEqual([rec.disposition, rec.disposition, EFFECT[rec.disposition]])
      expect(b.action).toBe(rec.disposition === 'person' ? 'WOULD_REVIEW' : 'WOULD_EXECUTE')
      expect([b.executed, b.mode]).toEqual([false, 'shadow'])
      n++
    }
    expect(n).toBe(records.length)
    expect(receiptsThatDisagree(entries)).toEqual([])
  })

  it('the live gate\'s reading of the buyer\'s decision is kept, named, as shadow.on_buyer_decision; `would` is gone', () => {
    const gates = entries.filter((e) => e.kind === 'ap_gate').map((e) => e.body as Record<string, any>)
    expect(gates.length).toBeGreaterThan(250)
    for (const b of gates) {
      expect(b.shadow).not.toHaveProperty('would')
      expect(['WOULD_EXECUTE', 'WOULD_REVIEW']).toContain(b.shadow.on_buyer_decision.action)
      expect(b.shadow.on_buyer_decision.words).toMatch(/live gate would have/)
    }
    // the class the controller found: the live gate would have sent the buyer's decision to a person, the checker holds or pays
    const split = gates.filter((b) => b.shadow.on_buyer_decision.action === 'WOULD_REVIEW' && b.disposition !== 'person')
    expect(split.length).toBeGreaterThan(0)
    for (const b of split) {
      expect(b.effect).toBe(EFFECT[b.disposition as 'pay' | 'hold'])
      expect(b.shadow.on_buyer_decision.words).toMatch(/^the buyer's decision \((approve|hold)[^)]*\) is not the checker's \((approve|hold_[a-z_]+)\), so the live gate would have sent it to a person$/)
    }
    // the text never says EXECUTE or PAY or REVIEW as a live word
    expect(readFileSync(join(dir, 'run', 'receipts.jsonl'), 'utf8')).not.toMatch(/"action":"(EXECUTE|REVIEW)"|"effect":"(PAY|HOLD|HUMAN_REVIEW)"/)
  })

  it('a bill that could not be checked says so first, too', () => {
    const notes = entries.filter((e) => e.kind === 'note' && (e.body as Record<string, unknown>).event === 'pilot.not_checked')
    for (const e of notes) expect(Object.keys(e.body as object).slice(0, 3)).toEqual(['disposition', 'action', 'effect'])
    expect(shadowWords('person')).toEqual({ disposition: 'person', action: 'WOULD_REVIEW', effect: 'WOULD_REVIEW' })
  })

  it('the report refuses receipts whose first field says another disposition than their shadow block', () => {
    const i = entries.findIndex((e) => e.kind === 'ap_gate' && (e.body as Record<string, unknown>).disposition === 'hold')
    const edited: LedgerEntry[] = entries.map((e, j) => (j === i ? { ...e, body: { ...(e.body as object), disposition: 'pay', effect: 'WOULD_PAY' } } : e))
    expect(receiptsThatDisagree(edited)).toEqual([entries[i]!.seq])
    expect(() => renderPilotReport({ manifest: run.manifest, prereg: frozenPrereg(p), ledger: { entries: edited, chainOk: true } })).toThrow(ReportRefused)
    expect(() => renderPilotReport({ manifest: run.manifest, prereg: frozenPrereg(p), ledger: { entries: edited, chainOk: true } })).toThrow(/say one disposition in their first field and another in their shadow block/)
    // receipts written before (no top-level disposition) are recounted from the shadow block, as before
    const old = entries.map((e) => { const { disposition: _d, ...rest } = e.body as Record<string, unknown>; return { ...e, body: rest } })
    expect(receiptsThatDisagree(old)).toEqual([])
  })

  it('the report names the head to record; the run\'s ledger refuses a receipt cut from its end', () => {
    expect(run.report).toContain(`Record this run's head, \`${run.manifest.ledger.head}\`, somewhere you control`)
    expect(run.report).toContain('A key does not catch receipts cut from the end')
    const L = join(dir, 'run', 'receipts.jsonl')
    const read = (f: string): string => readFileSync(f, 'utf8')
    expect(ledgerCli(['verify', L, '--key', join(dir, 'run', 'run-key.pub.pem'), '--head', run.manifest.ledger.head], read).code).toBe(0)
    const cut = join(dir, 'cut.jsonl')
    const lines = read(L).split('\n').filter(Boolean)
    writeFileSync(cut, `${lines.slice(0, -1).join('\n')}\n`)
    writeFileSync(`${cut}.head.json`, read(`${L}.head.json`))
    const r = ledgerCli(['verify', cut, '--key', join(dir, 'run', 'run-key.pub.pem')], read)
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/^BROKEN at the tail: the file has \d+ entries; its head record \(cut\.jsonl\.head\.json\) says \d+/)
  })

  it('the audit sheet says a failed total in words, never the same number twice', () => {
    const sheet = readFileSync(join(dir, 'run', 'AUDIT-SHEET.csv'), 'utf8')
    expect(sheet).not.toContain('Does not add up')
    const totals = run.manifest.bills.filter((b) => b.failed.includes('AP_TOTAL_SUM'))
    for (const b of totals) expect(b.discrepancy).toMatch(/total: lines add to [\d,]+\.\d\d(, and with [^;]+ to [\d,]+\.\d\d)?; the bill says [\d,]+\.\d\d; (over|under) by [\d,]+\.\d\d/)
  })
})

describe('totalWords', () => {
  const claim = (o: { asserted: number; lines: number; freight?: number; allowed?: boolean | null; tax?: number; excluded?: number }) => ({
    rule_id: 'AP_TOTAL_SUM', outcome: 'FAIL', asserted: o.asserted,
    computation: { operands: { lines: o.lines, freight: o.freight ?? 0, freight_allowed: o.allowed ?? null, ...(o.tax !== undefined ? { tax: o.tax } : {}) }, result: Math.round((o.lines + (o.freight ?? 0) + (o.tax ?? 0)) * 100) / 100 },
    evidence: o.excluded !== undefined ? [{ role: 'OPERAND', value: o.asserted }, { role: 'CONTEXT', value: o.excluded }] : [{ role: 'OPERAND', value: o.asserted }],
  })
  it('the controller\'s row', () => {
    expect(totalWords(claim({ asserted: 21078.97, lines: 20961.36 }))).toBe('lines add to 20,961.36; the bill says 21,078.97; over by 117.61')
  })
  it('under, freight the PO allows, tax, and freight it does not allow', () => {
    expect(totalWords(claim({ asserted: 900, lines: 1000 }))).toBe('lines add to 1,000.00; the bill says 900.00; under by 100.00')
    expect(totalWords(claim({ asserted: 1150, lines: 1000, freight: 50, allowed: true, tax: 80 }))).toBe('lines add to 1,000.00, and with freight 50.00 (the PO allows it) and tax 80.00 to 1,130.00; the bill says 1,150.00; over by 20.00')
    expect(totalWords(claim({ asserted: 1050, lines: 1000, allowed: false, excluded: 50 }))).toBe('lines add to 1,000.00 (freight 50.00 is left out: the PO does not allow freight); the bill says 1,050.00; over by 50.00')
  })
  it('any other claim, a PASS, or a claim without its numbers: undefined (the engine\'s explanation stands)', () => {
    expect(totalWords({ ...claim({ asserted: 1, lines: 2 }), rule_id: 'AP_PRICE_PO' })).toBeUndefined()
    expect(totalWords({ ...claim({ asserted: 1, lines: 2 }), outcome: 'PASS' })).toBeUndefined()
    expect(totalWords({ rule_id: 'AP_TOTAL_SUM', outcome: 'FAIL' })).toBeUndefined()
  })
})
