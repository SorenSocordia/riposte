/**
 * 2026-10-05: the shadow pilot as a controller reads it. The prereg template's numbers unquoted (and a quoted
 * number refused with its fix); no testimonial in the buyer's prereg; the report, the run record and the audit sheet in
 * words by default, --hashes-only as the opt-in; the labour cost first; `report` naming an altered entry; the signing key a
 * decision, never a default; pay applications (G702/G703) beside the bills; the near-match duplicate class; the construction
 * ERP mapping table and the generic CSV source it sits on. Every export here is synthetic.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  preregTemplate, parsePrereg, freezePrereg, PreregRefused, runShadow, ShadowRefused, KEY_CHOICE, writeSynthMonth, synthMonth, pilotCli, ledgerCli,
  openLedger, fileStore, recountFromLedger, recountFromManifest, scoreSynth, scoreTable, readPayApps, readExport, applyMapping, CSV_PRESETS,
  ERP_MAPPINGS, erpMappingFile, vendorNearMatch, AUDIT_COLUMNS, fieldWords, clearWords, PAY_APP_FIELDS, type SynthTruth,
} from '../src/index.js'

const dirs: string[] = []
const tmp = (p: string): string => { const d = mkdtempSync(join(tmpdir(), p)); dirs.push(d); return d }
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })
const T0 = () => new Date('2026-10-03T08:00:00Z')

/** A frozen prereg (hold_precision with the co-primary miss rate, or alone). */
function prereg(dir: string, o: { sample?: number; co?: boolean } = {}): string {
  const p = join(dir, 'PREREG.md')
  let text = preregTemplate({ buyer: 'Synthetic Mechanical', month: '2026-09', source: 'ramp' })
    .replace('<fill: the lowest precision that counts as a pass, e.g. 0.85>', '0.85').replace('<fill: how many would-holds a person audits, e.g. 40>', String(o.sample ?? 10))
  text = o.co === false ? text.replace(/\n {2}"co_primary": \{[^}]*\},/, '') : text.replace('<fill: the highest miss rate that counts as a pass, e.g. 0.05>', '0.05').replace('<fill: how many would-pays a person audits, e.g. 75>', '10')
  writeFileSync(p, text)
  freezePrereg(p, () => new Date('2026-10-03T07:00:00Z'))
  return p
}
const synthMonthTruth = (seed: number) => synthMonth({ month: '2026-09', bills: 300, seed }).truth.planted
function month(o: { bills?: number; seed?: number; payApps?: number } = {}): { dir: string; exportDir: string; truth: SynthTruth } {
  const dir = tmp('pilot-r3-')
  const truth = writeSynthMonth(join(dir, 'export'), join(dir, 'truth.json'), { month: '2026-09', bills: o.bills ?? 120, seed: o.seed ?? 11, ...(o.payApps ? { payApps: o.payApps } : {}) })
  return { dir, exportDir: join(dir, 'export'), truth }
}

describe('the pre-registration a buyer fills in', () => {
  const t = preregTemplate({ buyer: 'Acme', month: '2026-09', source: 'ramp' })
  it('every number it asks for is written without quotes, so typing 0.85 over the blank gives a JSON number', () => {
    expect(t).toContain('"bar": <fill: the lowest precision that counts as a pass, e.g. 0.85>,')
    expect(t).toContain('"sample_size": <fill: how many would-holds a person audits, e.g. 40>')
    expect(t).not.toMatch(/"<fill: [^"]*e\.g\. \d/)
    const filled = t.replace('<fill: the lowest precision that counts as a pass, e.g. 0.85>', '0.85').replace('<fill: the highest miss rate that counts as a pass, e.g. 0.05>', '0.05').replace(/<fill: [^>]*>/g, '40')
    expect(parsePrereg(filled).primary).toEqual({ metric: 'hold_precision', bar: 0.85, confidence: 0.95, sample_size: 40 })
  })
  it('an unfilled template names every blank (not a JSON error); a number left in quotes says to remove the quotes', () => {
    expect(() => parsePrereg(t)).toThrow(/still has 4 blanks to fill: <fill: the lowest precision/)
    const quoted = t.replace('<fill: the lowest precision that counts as a pass, e.g. 0.85>', '"0.85"').replace(/<fill: [^>]*>/g, '10')
    expect(() => parsePrereg(quoted)).toThrow(PreregRefused)
    expect(() => parsePrereg(quoted)).toThrow('remove the quotes around 0.85')
    const quotedSample = t.replace('<fill: how many would-holds a person audits, e.g. 40>', '"40"').replace('<fill: the lowest precision that counts as a pass, e.g. 0.85>', '0.85').replace(/<fill: [^>]*>/g, '10')
    expect(() => parsePrereg(quotedSample)).toThrow('"primary.sample_size" is the text "40", in quotes: remove the quotes around 40')
  })
  it('holds only the buyer\'s parameters and the rules: no reviewer\'s testimonial', () => {
    expect(t).not.toMatch(/controller|reviewed the pilot|I expected/)
  })
})

describe('the signing key is a decision: no default', () => {
  const { dir, exportDir } = month({ bills: 20, seed: 13 })
  const p = prereg(dir, { sample: 3 })
  it('no --key, --key-dir or --key-here: refused before anything is written, naming the three choices', () => {
    const out = join(dir, 'run-none')
    expect(() => runShadow({ exportDir, month: '2026-09', preregPath: p, out, now: T0 })).toThrow(ShadowRefused)
    expect(() => runShadow({ exportDir, month: '2026-09', preregPath: p, out, now: T0 })).toThrow(KEY_CHOICE)
    expect(existsSync(out)).toBe(false)
    const cli = pilotCli(['shadow', '--export', exportDir, '--month', '2026-09', '--prereg', p, '--out', out, '--now', '2026-10-03T08:00:00Z'])
    expect([cli.code, cli.err]).toEqual([1, expect.stringContaining('--key-here makes a key for this run and writes its private half beside the receipts')])
    expect(existsSync(out)).toBe(false)
  })
  it('two choices at once are refused too', () => {
    const out = join(dir, 'run-two')
    expect(() => runShadow({ exportDir, month: '2026-09', preregPath: p, out, now: T0, keyHere: true, keyDir: join(dir, 'k') })).toThrow(/--key-dir and --key-here/)
    expect(existsSync(out)).toBe(false)
  })
})

describe('in words by default; --hashes-only as the opt-in', () => {
  const { dir, exportDir, truth } = month({ bills: 150, seed: 11 })
  const p = prereg(dir, { sample: 12 })
  const run = runShadow({ exportDir, month: '2026-09', preregPath: p, out: join(dir, 'words'), now: T0, keyHere: true })
  const bare = runShadow({ exportDir, month: '2026-09', preregPath: p, out: join(dir, 'bare'), now: T0, keyHere: true, hashesOnly: true })

  it('the labour cost comes first: of the bills your team paid, how many the gate would have stopped, before any precision', () => {
    const r = run.report
    expect(r.indexOf('## What it would have cost your team')).toBeGreaterThan(0)
    expect(r.indexOf('## What it would have cost your team')).toBeLessThan(r.indexOf('## The pre-registered number'))
    const paid = run.manifest.bills.filter((b) => b.buyer.decision === 'pay')
    const stopped = paid.filter((b) => b.disposition !== 'pay').length
    expect(r).toContain(`Of the ${paid.length} bills your team paid this month, the gate would have stopped ${stopped} (`)
    // one meaning (2026-10-05): each stopped paid bill is a problem paid by mistake or a good bill held up, in one place
    expect(r).toContain(`Each of the ${stopped} is one of two things: a problem your team paid by mistake, or a good bill the gate would have held up.`)
    expect(bare.report.indexOf('## What it would have cost your team')).toBeLessThan(bare.report.indexOf('## The pre-registered number'))
  })
  it('each hold names the vendor, the amount, what is wrong in words with its line, and who may clear it', () => {
    const holds = run.manifest.bills.filter((b) => b.disposition === 'hold')
    expect(holds.length).toBeGreaterThan(5)
    for (const b of holds) {
      expect(b.vendor).toBeTruthy()
      expect(b.discrepancy).toMatch(/^(line \d+ [a-z ]+|total|invoice number): /)
      expect((b.clear ?? []).join(' ')).not.toBe('')
    }
    const lineMath = holds.find((b) => b.failed.includes('AP_LINE_MATH'))!
    expect(lineMath.discrepancy).toMatch(/^line \d+ amount: .* × .* = .*, but the line says /)
    expect(lineMath.clear![0]).toMatch(/^An AP supervisor may clear it, for this one only\./)
    const row = run.report.split('\n').find((l) => l.startsWith(`| ${lineMath.ref} |`))!
    expect(row).toContain(lineMath.vendor!)
    expect(row).toContain('An AP supervisor may clear it')
    expect(run.report).not.toContain('recompute-with')
  })
  it('the audit sheet carries the vendor, the amount and the discrepancy; under --hashes-only those cells are blank', () => {
    const rows = readFileSync(join(dir, 'words', 'AUDIT-SHEET.csv'), 'utf8').trim().split('\n')
    expect(rows[0]).toBe(AUDIT_COLUMNS.join(','))
    const first = run.manifest.bills.find((b) => b.ref === run.manifest.audit.sample[0])!
    expect(rows[1]).toContain(first.vendor!)
    expect(rows[1]).toContain(String(first.amount))
    const bareRows = readFileSync(join(dir, 'bare', 'AUDIT-SHEET.csv'), 'utf8').trim().split('\n')
    expect(bareRows[0]).toBe(rows[0])
    expect(bareRows[1]!.split(',').slice(4, 8)).toEqual(['', '', '', ''])
  })
  it('--hashes-only: the record and report keep to ids, totals, rule ids and typed remedies, as before', () => {
    expect(bare.manifest.wording).toBe('hashes-only')
    expect(run.manifest.wording).toBe('words')
    const text = readFileSync(join(dir, 'bare', 'pilot-run.json'), 'utf8') + readFileSync(join(dir, 'bare', 'PILOT-REPORT.md'), 'utf8')
    const page = JSON.parse(readFileSync(join(exportDir, 'bills.json'), 'utf8'))
    for (const b of page.data.slice(0, 40)) expect(text).not.toContain(b.vendor.name)
    expect(bare.report).toContain('what would clear it (typed)')
    expect(recountFromManifest(bare.manifest)).toEqual(recountFromManifest(run.manifest))
  })
  it('the receipts hold hashes in both modes: no vendor name or line description on any receipt', () => {
    const page = JSON.parse(readFileSync(join(exportDir, 'bills.json'), 'utf8'))
    const ledger = readFileSync(join(dir, 'words', 'receipts.jsonl'), 'utf8')
    for (const b of page.data.slice(0, 40)) { expect(ledger).not.toContain(b.vendor.name); expect(ledger).not.toContain(b.inventory_line_items[0].memo) }
  })
  it('a bill the checker approves with a check that could not run goes to a person, never to the would-pay column', () => {
    for (const b of run.manifest.bills.filter((x) => x.gated)) if (b.checker_decision === 'approve' && b.status !== 'PASS') expect(b.disposition).toBe('person')
    const s = scoreSynth(run.manifest, truth)
    // 2026-10-05: a planted bill is paid only in a class whose gap the check states (a line billed again across bills)
    expect(s.wrong_pay).toBe(Object.values(s.classes).filter((c) => c.gap).reduce((n, c) => n + c.wrong_pay, 0))
  })
})

describe('riposte-pilot report on an altered ledger names the entry, as riposte-ledger verify does', () => {
  it('one receipt flipped from WOULD_HOLD to WOULD_PAY: both tools say "BROKEN at entry N: entry N was altered"', () => {
    const { dir, exportDir } = month({ bills: 40, seed: 12 })
    const p = prereg(dir, { sample: 3 })
    runShadow({ exportDir, month: '2026-09', preregPath: p, out: join(dir, 'run'), now: T0, keyHere: true })
    cpSync(join(dir, 'run'), join(dir, 'tampered'), { recursive: true })
    const f = join(dir, 'tampered', 'receipts.jsonl')
    const lines = readFileSync(f, 'utf8').split('\n')
    const i = lines.findIndex((l) => l.includes('"effect":"WOULD_HOLD"'))
    expect(i).toBeGreaterThan(0)
    lines[i] = lines[i]!.replace('"effect":"WOULD_HOLD"', '"effect":"WOULD_PAY"')
    writeFileSync(f, lines.join('\n'))
    const v = ledgerCli(['verify', f], (x) => readFileSync(x, 'utf8'))
    expect(v.err).toContain(`BROKEN at entry ${i}: entry ${i} was altered after it was written`)
    const r = pilotCli(['report', '--out', join(dir, 'tampered'), '--prereg', p])
    expect(r.code).toBe(1)
    expect(r.err).toContain(`BROKEN at entry ${i}: entry ${i} was altered after it was written`)
    expect(pilotCli(['report', '--out', join(dir, 'run'), '--prereg', p]).code).toBe(0)
  })
})

describe('pay applications (G702/G703) beside the bills', () => {
  const { dir, exportDir, truth } = month({ bills: 60, seed: 11, payApps: 8 })
  const p = prereg(dir, { sample: 5 })
  const run = runShadow({ exportDir, month: '2026-09', preregPath: p, out: join(dir, 'run'), now: T0, keyHere: true })
  const entries = openLedger(fileStore(join(dir, 'run', 'receipts.jsonl'))).entries()

  it('synth writes last month\'s and this month\'s application per contract, decisions.csv, and a truth label for each', () => {
    const files = readdirSync(join(exportDir, 'pay_applications'))
    // 8 contracts, one appended on 2026-10-05 (retainage withheld under the stated rate) and three on 2026-10-06 (a scheduled value
    // raised with no change order; a new change-order line; stored materials written as the form says), two applications each
    expect(files.filter((f) => f.endsWith('.json'))).toHaveLength(24)
    expect(files).toContain('decisions.csv')
    expect(Object.keys(truth.pay_apps!)).toHaveLength(12)
    const doc = JSON.parse(readFileSync(join(exportDir, 'pay_applications', files.find((f) => f.endsWith('.json'))!), 'utf8'))
    expect(Object.keys(doc).sort()).toEqual([...PAY_APP_FIELDS.application].sort())
  })
  it('each of this month\'s applications gets a pay_app_check receipt, hashes only; the recount covers them', () => {
    const checks = entries.filter((e) => e.kind === 'pay_app_check')
    expect(checks).toHaveLength(12)
    for (const e of checks) expect(e.body).toMatchObject({ stored: 'hashes', executed: false, mode: 'shadow', checker: { id: 'riposte.receipts.pay-app' }, shadow: { pilot: true, document: 'pay_application' } })
    const text = readFileSync(join(dir, 'run', 'receipts.jsonl'), 'utf8')
    expect(text).not.toContain('(synthetic)')
    expect(recountFromLedger(entries)).toEqual(recountFromManifest(run.manifest))
    expect(recountFromLedger(entries).pay_apps.applications).toBe(12)
    expect(recountFromLedger(entries).bills).toBe(Object.keys(truth.buyer).length)
  })
  it('every planted error is held, every clean application would pay, each with its previous application found', () => {
    for (const a of run.manifest.pay_apps!) {
      const t = truth.pay_apps![a.ref]!
      expect([a.ref, t.plant ?? 'clean', a.disposition]).toEqual([a.ref, t.plant ?? 'clean', t.expected])
      expect(a.previous).toBe(t.previous)
      expect(a.buyer.decision).toBe(t.buyer)
    }
    const s = scoreSynth(run.manifest, truth)
    expect(s.pay_apps!.wrong_pay).toBe(0)
    expect(s.pay_apps!.clean_stopped).toBe(0)
    // 2026-10-06: the good applications are the clean ones and the two legitimate classes, which must pay
    expect(scoreTable(s)).toMatch(/pay applications: 0 of \d+ good applications \(\d+ clean, 2 of the legitimate classes\) would have gone to a person or been held/)
  })
  it('the report has a pay-application section in words, outside the pre-registered numbers', () => {
    expect(run.report).toContain('## Pay applications (G702/G703)')
    expect(run.report).toContain('are not part of the pre-registered numbers')
    const held = run.manifest.pay_apps!.find((a) => a.disposition === 'hold')!
    expect(run.report.split('\n').find((l) => l.startsWith(`| ${held.ref} |`))).toContain(held.discrepancy!)
  })
  it('without last month\'s application the continuity checks cannot run, and it goes to a person, saying so', () => {
    const d2 = tmp('pilot-r3-nopre-')
    cpSync(exportDir, join(d2, 'export'), { recursive: true })
    const cur = Object.entries(truth.pay_apps!).find(([, t]) => t.plant === null)!
    rmSync(join(d2, 'export', 'pay_applications', cur[1].previous))
    const r = runShadow({ exportDir: join(d2, 'export'), month: '2026-09', preregPath: prereg(d2, { sample: 3 }), out: join(d2, 'run'), now: T0, keyHere: true })
    const a = r.manifest.pay_apps!.find((x) => x.ref === cur[0])!
    expect([a.disposition, a.previous]).toEqual(['person', null])
    expect(a.why).toMatch(/no previous application of this contract in the export, so the continuity checks could not run/)
  })
  it('a key the pay-application shape does not have is refused until acknowledged, like any export column', () => {
    const d3 = tmp('pilot-r3-unk-')
    cpSync(exportDir, join(d3, 'export'), { recursive: true })
    const name = Object.keys(truth.pay_apps!)[0]!
    const fp = join(d3, 'export', 'pay_applications', name)
    writeFileSync(fp, JSON.stringify({ ...JSON.parse(readFileSync(fp, 'utf8')), lien_waiver: 'attached' }))
    expect(readPayApps(join(d3, 'export')).unmapped).toEqual(['pay_applications[].lien_waiver'])
    const p3 = prereg(d3, { sample: 3 })
    expect(() => runShadow({ exportDir: join(d3, 'export'), month: '2026-09', preregPath: p3, out: join(d3, 'run'), now: T0, keyHere: true })).toThrow(/pay_applications\[\]\.lien_waiver/)
    const ok = runShadow({ exportDir: join(d3, 'export'), month: '2026-09', preregPath: p3, out: join(d3, 'run'), now: T0, keyHere: true, ignore: ['pay_applications[].lien_waiver'] })
    expect(ok.manifest.export.ignored).toContain('pay_applications[].lien_waiver')
  })
})

describe('the near-match duplicate: a typo or a d/b/a vendor record, planted, labelled and scored', () => {
  it('the names: one edit for a typo ("Summit" → "Sumit"), the first word and initials for a d/b/a', () => {
    expect(vendorNearMatch('Summit Electrical Supply', 0.1)).toEqual({ kind: 'typo', name: 'Sumit Electrical Supply' })
    expect(vendorNearMatch('Northfield Material Handling', 0.9)).toEqual({ kind: 'dba', name: 'Northfield d/b/a NMH' })
    expect(vendorNearMatch('Okafor Packaging Co.', 0.9)).toEqual({ kind: 'dba', name: 'Okafor d/b/a OP' })
    expect(vendorNearMatch('Brightwater Industrial', 0.2).name).toBe('Brightwatre Industrial')
    expect(vendorNearMatch('Summit Electrical Supply', 0.5)).toEqual({ kind: 'abbreviation', name: 'Summit Elec. Supply' })
    expect(vendorNearMatch('Pemberton Lab Glass', 0.5)).toEqual({ kind: 'abbreviation', name: 'Pemberton Lab Gl.' })
  })
  it('half of them bill their own PO and total (the case that used to be paid); score counts each kind apart', () => {
    const near = [1, 2, 3, 4, 5, 6].flatMap((seed) => Object.values(synthMonthTruth(seed)).filter((t) => t.near))
    expect(new Set(near.map((t) => t.near!.kind))).toEqual(new Set(['typo', 'abbreviation', 'dba']))
    expect(near.some((t) => t.near!.other_po)).toBe(true)
    expect(near.some((t) => !t.near!.other_po)).toBe(true)
    const { dir, exportDir, truth } = month({ bills: 300, seed: 4 })
    const run = runShadow({ exportDir, month: '2026-09', preregPath: prereg(dir, { co: false }), out: join(dir, 'run'), now: T0, keyHere: true })
    const c = scoreSynth(run.manifest, truth).classes.duplicate_near_match!
    expect(Object.values(c.kinds!).reduce((n, k) => n + k.planted, 0)).toBe(c.planted)
    // an other-PO repeat is otherwise clean against its own PO: only the duplicate check can stop it
    for (const [ref, t] of Object.entries(truth.planted).filter(([, x]) => x.near?.other_po)) {
      const b = run.manifest.bills.find((x) => x.ref === ref)!
      expect(b.failed.filter((r) => r !== 'AP_DUPLICATE')).toEqual([])
    }
  })
  it('seed 7 plants "Northfield d/b/a NMH", labelled hold_duplicate (or a person), clearable by the controller; score reports the rung', () => {
    const { dir, exportDir, truth } = month({ bills: 300, seed: 7 })
    const near = Object.entries(truth.planted).filter(([, t]) => t.plant === 'duplicate_near_match')
    expect(near.map(([, t]) => t.near!.near_vendor.name)).toContain('Northfield d/b/a NMH')
    for (const [, t] of near) expect(t).toMatchObject({ expected: 'hold_duplicate', accepts: ['hold_duplicate', 'abstain'], clear_by: 'ap-controller' })
    const run = runShadow({ exportDir, month: '2026-09', preregPath: prereg(dir, { co: false }), out: join(dir, 'run'), now: T0, keyHere: true })
    const s = scoreSynth(run.manifest, truth)
    const c = s.classes.duplicate_near_match!
    expect(c.planted).toBe(near.length)
    expect(c.pay + c.hold + c.person).toBe(c.planted)
    expect(c.clear_by).toBe('ap-controller')
    expect(Object.values(c.authorities!).reduce((x, y) => x + y, 0)).toBe(c.planted)
    // what the check does with them TODAY is reported (the bar is that the class exists and is scored); paying one is the failure
    console.log(`[score, seed 7, verify ${run.manifest.engine.verify}]\n${scoreTable(s)}${JSON.stringify(c.bills)}`)
    expect(scoreTable(s).split('\n')[0]).toMatch(/^labour: \d+ of \d+ clean bills would have gone to a person or been held/)
  })
})

describe('construction ERP mappings and the generic CSV source', () => {
  it('all five systems are listed; none claims verification; only a system with published names read has a draft', () => {
    expect(ERP_MAPPINGS.map((e) => e.id)).toEqual(['vista', 'quickbooks-desktop', 'sage-300-cre', 'spectrum', 'foundation'])
    for (const e of ERP_MAPPINGS) expect(e.status).toContain('not verified on a real export')
    expect(ERP_MAPPINGS.filter((e) => e.mapping).map((e) => e.id)).toEqual(['vista'])
    expect(ERP_MAPPINGS.find((e) => e.id === 'vista')!.status).toBe('mapping drafted from published column names; not verified on a real export')
    for (const e of ERP_MAPPINGS.filter((x) => !x.mapping)) expect(e.status).toMatch(/no mapping drafted|not drafted/)
  })
  it('the Vista draft is a valid mapping file and reads a Vista-shaped export (synthetic) end to end', () => {
    const vista = ERP_MAPPINGS.find((e) => e.id === 'vista')!
    const m = JSON.parse(erpMappingFile(vista))
    expect(() => applyMapping(CSV_PRESETS['generic-csv'], m)).not.toThrow()
    const d = tmp('pilot-r3-vista-')
    writeFileSync(join(d, 'bills.csv'), 'KeyID,APCo,UIMth,UISeq,VendorGroup,Vendor,APRef,InvDate,InvTotal,PO,Line,POItem,Description,Units,UnitCost,GrossAmt\n900,1,2026-09-01,7,1,4410,INV-311,2026-09-14,1300,PO-77,1,1,Copper pipe 3/4 in,100,13,1300\n')
    writeFileSync(join(d, 'purchase_orders.csv'), 'KeyID,POCo,PO,Vendor,POItem,Description,CurUnits,CurUnitCost,CurCost\n501,1,PO-77,4410,1,Copper pipe 3/4 in,100,12.5,1250\n')
    writeFileSync(join(d, 'item_receipts.csv'), 'KeyID,POCo,Mth,POTrans,PO,POItem,RecvdDate,Receiver#,RecvdUnits\n77,1,2026-09-01,3,PO-77,1,2026-09-10,R-9,100\n')
    const r = readExport(d, 'generic-csv', { month: '2026-09', mapping: m })
    expect([r.unmapped, r.missing]).toEqual([[], []])
    expect(r.bills[0]!.input).toBeDefined()
    expect(r.bills[0]!.buyer.decision).toBe('open')
    const cli = pilotCli(['mappings', '--erp', 'vista', '--out', join(d, 'vista.json')])
    expect(cli.code).toBe(0)
    expect(JSON.parse(readFileSync(join(d, 'vista.json'), 'utf8'))).toEqual(m)
    expect(cli.err).toContain('not verified on a real export')
  })
  it('asking for a draft that does not exist is refused with the reason; the list prints every status', () => {
    const r = pilotCli(['mappings', '--erp', 'sage-300-cre', '--out', join(tmp('pilot-r3-m-'), 'x.json')])
    expect([r.code, r.err]).toEqual([1, expect.stringContaining('no published column list found')])
    const list = pilotCli(['mappings'])
    expect(list.code).toBe(0)
    for (const e of ERP_MAPPINGS) expect(list.err).toContain(e.status)
  })
  it('generic-csv reads this package\'s own column names', () => {
    const d = tmp('pilot-r3-generic-')
    writeFileSync(join(d, 'bills.csv'), 'invoice_number,vendor,date,total,po,status,item,quantity,rate,amount\nG-1,Ridgeway Abrasives,2026-09-03,100,PO-1,paid,DISC-60,10,10,100\n')
    writeFileSync(join(d, 'purchase_orders.csv'), 'number,vendor,item,quantity,rate,amount\nPO-1,Ridgeway Abrasives,DISC-60,10,10,100\n')
    writeFileSync(join(d, 'item_receipts.csv'), 'po,date,item,quantity\nPO-1,2026-09-01,DISC-60,10\n')
    const r = readExport(d, 'generic-csv', { month: '2026-09' })
    expect([r.unmapped, r.missing, r.bills[0]!.buyer.decision]).toEqual([[], [], 'pay'])
  })
})

describe('words helpers', () => {
  it('fields and roles in words; what would clear it, the role first', () => {
    expect(fieldWords('line[2].unit_price')).toBe('line 2 unit price')
    expect(fieldWords('current_payment_due')).toBe('current payment due')
    expect(clearWords([{ kind: 'recompute-with', detail: 'Re-read the line.' }, { kind: 'authority', authority: 'ap-controller', detail: 'The controller rules.' }]))
      .toEqual(['The controller may clear it, for this one only. The controller rules.', 'Re-read the line.'])
  })
})
