/**
 * A shadow-pilot export from a cold review (2026-10-12; test/fixtures/pilot-merged-numbers/README.md): six bills in eight rows,
 * two of them under one invoice number on two dates and two spellings of the vendor. Without a `ref` column the rows were
 * merged into one bill without a word, the merged bill was reported as a total mismatch, and the report counted 4 bills paid
 * where the export marks 5. Rows under one invoice number are one bill only when their date and vendor agree; otherwise they
 * are separate bills, the reading says so, and the duplicate is reported as a duplicate.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readExport } from '../src/pilot/mappers.js'
import { runShadow } from '../src/pilot/shadow.js'
import { pilotCli } from '../src/pilot-command.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const FX = join(HERE, 'fixtures', 'pilot-merged-numbers')
const SCRATCH = join(HERE, '..', 'tmp', 'vitest')
const made: string[] = []
const tmp = (p: string): string => { mkdirSync(SCRATCH, { recursive: true }); const d = mkdtempSync(join(SCRATCH, p)); made.push(d); return d }
afterAll(() => { for (const d of made) rmSync(d, { recursive: true, force: true }) })
const mapping = JSON.parse(readFileSync(join(FX, 'mapping.json'), 'utf8')) as unknown
const mapping2 = JSON.parse(readFileSync(join(FX, 'mapping2.json'), 'utf8')) as unknown
const T0 = (): Date => new Date('2026-10-12T22:18:22Z')

describe('rows under one invoice number are one bill only when their date and vendor agree', () => {
  it('without ref: 8 rows read as 6 bills, and the reading says which number spans two dates and two vendor names', () => {
    const r = readExport(join(FX, 'export'), 'generic-csv', { mapping, month: '2026-09' })
    expect(r.bills.length).toBe(6)
    const note = r.notes.find((n) => n.startsWith('8 rows, 6 bills;'))
    expect(note).toBeDefined()
    expect(note).toContain('GCS-20417 has rows on two dates under two vendor names')
    expect(note).toContain('read as separate bills')
    const gcs = r.bills.filter((b) => b.invoice_number === 'GCS-20417')
    expect(gcs.map((b) => [b.issued_at, b.vendor])).toEqual([['2026-09-04', 'Gulf Coast Supply'], ['2026-09-18', 'Gulf Coast Supply Co.']])
    expect(new Set(r.bills.map((b) => b.ref)).size).toBe(6)
  })
  it('the map dry run prints the warning and counts six bills', () => {
    const out = pilotCli(['map', '--export', join(FX, 'export'), '--source', 'generic-csv', '--mapping', join(FX, 'mapping.json'), '--month', '2026-09'])
    expect(out.code).toBe(0)
    expect(JSON.parse(out.out).bills).toBe(6)
    expect(out.err).toContain('8 rows, 6 bills; GCS-20417 has rows on two dates under two vendor names')
  })
  it('with ref: the same six bills, and no warning', () => {
    const r = readExport(join(FX, 'export2'), 'generic-csv', { mapping: mapping2, month: '2026-09' })
    expect(r.bills.length).toBe(6)
    expect(r.notes.some((n) => /rows, \d+ bills;/.test(n))).toBe(false)
  })
  it('the run: the paid count is the export\'s five, and the second GCS-20417 is held as a duplicate, never a total mismatch', () => {
    const d = tmp('merged-numbers-')
    const r = runShadow({ keyHere: true, source: 'generic-csv', mapping, exportDir: join(FX, 'export'), month: '2026-09', preregPath: join(FX, 'PREREG.md'), out: join(d, 'run'), now: T0 })
    expect(r.manifest.bills.length).toBe(6)
    const report = readFileSync(join(d, 'run', 'PILOT-REPORT.md'), 'utf8')
    expect(report).toContain('Of the 5 bills your team paid this month')
    expect(report).not.toContain('10,489.60')
    const second = report.split('\n').find((l) => l.startsWith('| GCS-20417 (2026-09-18, Gulf Coast Supply Co.) |'))
    expect(second).toBeDefined()
    expect(second).toContain('duplicate payment')
  })
})
