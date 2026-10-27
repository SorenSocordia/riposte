// SARIF 2.1.0 output (src/sarif.ts, src/sarif-command.ts): valid against the OASIS schema (test/fixtures/sarif), one result
// per check that did not PASS, FAIL → error and can't tell (INSUFFICIENT_DATA) → warning, rule ids = check ids, locations from provenance, the
// verdict id and the replay command on every result, and proofs that re-perform.
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { replayBundle, verify } from 'riposte-verify'
import { globRegex, jsonPositions, locateClaim, matchFiles, pathSteps, rawOffset, regionOf, sarifCommand, toSarif } from '../src/index.js'
import { SARIF_USAGE } from '../src/sarif-command.js'
import type { SarifLog } from '../src/index.js'
import { validate } from './json-schema-lite.js'

const FIX = fileURLToPath(new URL('./fixtures/sarif/', import.meta.url))
const SCHEMA = JSON.parse(readFileSync(join(FIX, 'sarif-schema-2.1.0.json'), 'utf8'))
const dirs: string[] = []
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })))
/** A scratch repository holding the four fixtures under docs/. */
function repo(): string {
  const d = mkdtempSync(join(tmpdir(), 'riposte-sarif-'))
  dirs.push(d)
  for (const f of ['clean-invoice.json', 'invoice-over-contract.json', 'payapp-retainage.json', 'invoice-missing-totals.json']) cpSync(join(FIX, f), join(d, 'docs', f))
  return d
}
const run = (cwd: string, ...argv: string[]) => sarifCommand(argv, { cwd })
const resultsOf = (log: SarifLog) => log.runs[0].results as any[]
/** The text a region covers (single-line regions). */
const covered = (text: string, r: any) => text.split('\n')[r.startLine - 1]!.slice(r.startColumn - 1, r.endColumn - 1)

const scanUrl = new URL('../../riposte-export-scan.mjs', import.meta.url)
const scan: ((rel: string, buf: Buffer) => string[]) | undefined = existsSync(fileURLToPath(scanUrl)) ? (await import(scanUrl.href)).scanFile : undefined

describe('the validator itself (so a pass means something)', () => {
  it('accepts GitHub\'s minimal example shape and rejects broken logs', () => {
    const ok = { version: '2.1.0', runs: [{ tool: { driver: { name: 'T' } }, results: [{ message: { text: 'x' }, level: 'error' }] }] }
    expect(validate(SCHEMA, ok)).toEqual([])
    expect(validate(SCHEMA, { ...ok, version: '2.0.0' }).join()).toMatch(/version/)
    expect(validate(SCHEMA, { version: '2.1.0', runs: [{ tool: { driver: { name: 'T' } }, results: [{ message: { text: 'x' }, level: 'fatal' }] }] }).join()).toMatch(/level/)
    expect(validate(SCHEMA, { version: '2.1.0', runs: [{ tool: { driver: { name: 'T' } }, results: [{ level: 'error' }] }] }).join()).toMatch(/message/)
    expect(validate(SCHEMA, { version: '2.1.0', runs: [{ tool: { driver: {} } }] }).join()).toMatch(/name/)
    const badRegion = { version: '2.1.0', runs: [{ tool: { driver: { name: 'T' } }, results: [{ message: { text: 'x' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'a' }, region: { startLine: 0 } } }] }] }] }
    expect(validate(SCHEMA, badRegion).join()).toMatch(/minimum/)
  })
})

describe('riposte-sarif over the four fixtures', () => {
  const cwd = repo()
  const r = run(cwd, '--files', 'docs/**/*.json', '--summary', join(cwd, 'summary.md'), '--github-output', join(cwd, 'gh-output.txt'), '--category', 'riposte-verify')
  const log = JSON.parse(readFileSync(join(cwd, 'riposte.sarif'), 'utf8')) as SarifLog
  const results = resultsOf(log)

  it('writes a SARIF 2.1.0 log that validates against the OASIS schema', () => {
    expect(r.stderr).toMatch(/4 file\(s\): 1 PASS · 2 FAIL · 1 INSUFFICIENT_DATA · 0 not checked/)
    expect(r.stderr).not.toContain('ABSTAIN')
    expect(validate(SCHEMA, log)).toEqual([])
    expect([log.$schema, log.version, log.runs.length]).toEqual(['https://json.schemastore.org/sarif-2.1.0.json', '2.1.0', 1])
    expect(log.runs[0].automationDetails).toEqual({ id: 'riposte-verify/' })
    expect(log.runs[0].originalUriBaseIds['%SRCROOT%'].uri).toMatch(/^file:\/\/\/.*\/$/)
  })

  it('one result per check that did not PASS: FAIL → error, INSUFFICIENT_DATA → warning; rule ids are the check ids', () => {
    for (const f of ['clean-invoice.json', 'invoice-over-contract.json', 'payapp-retainage.json', 'invoice-missing-totals.json']) {
      const doc = JSON.parse(readFileSync(join(FIX, f), 'utf8'))
      const v = verify(doc.extraction ?? doc, { ruleset: doc.ruleset ?? 'invoice', ...(doc.references ? { references: doc.references } : {}) })
      const mine = results.filter((x) => x.locations[0].physicalLocation.artifactLocation.uri === `docs/${f}`)
      const want = v.claims.filter((c) => c.outcome !== 'PASS').map((c) => [c.rule_id, c.outcome === 'FAIL' ? 'error' : 'warning', c.claim_id])
      expect(mine.map((x) => [x.ruleId, x.level, x.properties.riposte.claim_id])).toEqual(want)
      for (const x of mine) {
        expect(x.properties.riposte.verdict_id).toBe(v.verdict_id)
        expect(x.properties.riposte.answer).toBe(x.level === 'error' ? 'FAIL' : 'INSUFFICIENT_DATA')
        expect(x.properties.riposte.replay).toBe(`riposte-verify replay riposte-proofs/${v.verdict_id}.json`)
        expect(x.message.text).toContain(`Verdict ${v.verdict_id}; re-run: riposte-verify replay riposte-proofs/${v.verdict_id}.json`)
      }
    }
    expect(results.filter((x) => x.properties.riposte.answer === 'INSUFFICIENT_DATA').every((x) => x.level === 'warning')).toBe(true)
    expect(results.some((x) => x.properties.riposte.answer === 'INSUFFICIENT_DATA' && x.level === 'error')).toBe(false)
    // the word ABSTAIN is retired from everything the Action writes
    expect(JSON.stringify(log)).not.toContain('ABSTAIN')
    const rules = log.runs[0].tool.driver.rules as any[]
    for (const x of results) expect(rules[x.ruleIndex].id).toBe(x.ruleId)
    for (const rule of rules) expect([rule.shortDescription.text, rule.fullDescription.text, rule.help.text].every((t: string) => t.length > 0 && t.length <= 1024)).toBe(true)
  })

  it('locations come from provenance: the FAIL points at the billed unit price, line and column', () => {
    const rate = results.find((x) => x.ruleId === 'RATE_SUP' && x.level === 'error')!
    const text = readFileSync(join(cwd, 'docs', 'invoice-over-contract.json'), 'utf8')
    const region = rate.locations[0].physicalLocation.region
    expect(covered(text, region)).toBe('"unit_price": 165')
    expect(rate.properties.riposte.located).toBe('field')
    expect(rate.relatedLocations.map((l: any) => l.message.text)).toContain('contract: rates[*].rate')
    expect(covered(text, rate.relatedLocations.find((l: any) => l.message.text === 'contract: rates[*].rate').physicalLocation.region)).toBe('"rate": 150')
    for (const x of results) {
      const g = x.locations[0].physicalLocation.region
      expect(g.startLine >= 1 && g.startColumn >= 1 && g.endLine >= g.startLine).toBe(true)
      expect(x.locations[0].physicalLocation.artifactLocation.uriBaseId).toBe('%SRCROOT%')
    }
  })

  it('a missing field has no line: the nearest existing parent, else the document, and the result says which', () => {
    const abstain = results.filter((x) => x.locations[0].physicalLocation.artifactLocation.uri === 'docs/invoice-missing-totals.json')
    expect(new Set(abstain.map((x) => x.properties.riposte.located))).toEqual(new Set(['field', 'ancestor', 'document']))
    const text = readFileSync(join(cwd, 'docs', 'invoice-missing-totals.json'), 'utf8')
    const tax = abstain.find((x) => x.ruleId === 'TAX_INT')!
    expect(covered(text, tax.locations[0].physicalLocation.region)).toBe('"tax_rate": 0.0825')
  })

  it('every proof re-performs: the bundle the replay command names MATCHes', () => {
    const ids = new Set(results.map((x) => x.properties.riposte.verdict_id))
    expect(ids.size).toBe(3)
    for (const id of ids) {
      const bundle = JSON.parse(readFileSync(join(cwd, 'riposte-proofs', `${id}.json`), 'utf8'))
      expect((replayBundle(bundle) as { result: string }).result).toBe('MATCH')
    }
    expect(existsSync(join(cwd, 'riposte-proofs'))).toBe(true)
  })

  it('fingerprints are stable across runs, and differ per finding', () => {
    const again = resultsOf(run(cwd, '--files', 'docs/**/*.json', '--out', 'again.sarif').log!)
    expect(again.map((x) => x.partialFingerprints)).toEqual(results.map((x) => x.partialFingerprints))
    expect(new Set(results.map((x) => x.partialFingerprints['riposteFinding/v1'])).size).toBe(results.length)
  })

  it('CI outputs: the job summary and the step outputs', () => {
    const out = readFileSync(join(cwd, 'gh-output.txt'), 'utf8')
    expect(out).toBe('sarif-file=riposte.sarif\nproof-dir=riposte-proofs\nfiles=4\npass=1\nfail=2\ninsufficient-data=1\nrefused=0\noutcome=FAIL\n')
    const md = readFileSync(join(cwd, 'summary.md'), 'utf8')
    expect(md).toMatch(/\| 4 \| 1 \| 2 \| 1 \| 0 \|/)
    expect(md).toContain('INSUFFICIENT_DATA (can\'t tell)')
    expect(md).not.toContain('ABSTAIN')
    expect(md).toContain('**FAIL** `RATE_SUP` docs/invoice-over-contract.json:')
  })

  it.skipIf(!scan)('the SARIF and the summary carry no house term (the export scan)', () => {
    // originalUriBaseIds holds the runner's own folder (here a temp folder under this machine's user profile): environment, not content
    const authored = JSON.parse(readFileSync(join(cwd, 'riposte.sarif'), 'utf8'))
    expect(Object.keys(authored.runs[0].originalUriBaseIds)).toEqual(['%SRCROOT%'])
    delete authored.runs[0].originalUriBaseIds
    expect(scan!('emitted/riposte.sarif', Buffer.from(JSON.stringify(authored, null, 2)))).toEqual([])
    expect(scan!('emitted/summary.md', readFileSync(join(cwd, 'summary.md')))).toEqual([])
  })
})

describe('exit codes and --fail-on', () => {
  it('insufficient-data (the default since 2026-10-05): exit 1 on a FAIL and on can\'t tell, as the command-line checks fail closed', () => {
    const cwd = repo()
    expect(run(cwd, '--files', 'docs/*.json').code).toBe(1)
    const cant = run(cwd, '--files', 'docs/invoice-missing-totals.json')
    expect(cant.code).toBe(1)
    expect(cant.stderr).toContain("failing (--fail-on insufficient-data: can't tell fails the step by default; --fail-on fail passes it)")
    expect(run(cwd, '--files', 'docs/clean-invoice.json').code).toBe(0)
    expect(SARIF_USAGE).toContain('insufficient-data (default)')
    expect(SARIF_USAGE).not.toContain('ABSTAIN')
  })
  it('fail: exit 1 only when a check FAILs, so can\'t tell passes; abstain, the older name, is read as insufficient-data; none: never', () => {
    const cwd = repo()
    expect(run(cwd, '--files', 'docs/invoice-missing-totals.json', '--fail-on', 'fail').code).toBe(0)
    expect(run(cwd, '--files', 'docs/invoice-missing-totals.json', '--fail-on', 'abstain').code).toBe(1)
    expect(run(cwd, '--files', 'docs/clean-invoice.json', '--fail-on', 'abstain').code).toBe(0)
    expect(run(cwd, '--files', 'docs/*.json', '--fail-on', 'none').code).toBe(0)
  })
  it('a PASS with a check that could not run fails the default step, and the outcome says PASS-WITH-OPEN', () => {
    const cwd = repo()
    // the clean invoice without its delivery evidence: every check that runs holds, the quantity-received check cannot run
    const doc = JSON.parse(readFileSync(join(cwd, 'docs', 'clean-invoice.json'), 'utf8'))
    delete doc.references.evidence
    writeFileSync(join(cwd, 'docs', 'open.json'), JSON.stringify(doc))
    const gh = join(cwd, 'open-output.txt')
    const r = run(cwd, '--files', 'docs/open.json', '--github-output', gh)
    expect(readFileSync(gh, 'utf8')).toMatch(/\npass=1\nfail=0\ninsufficient-data=0\nrefused=0\noutcome=PASS-WITH-OPEN\n$/)
    expect(r.code).toBe(1)
    expect(r.stderr).toMatch(/1 PASS \(1 PASS-WITH-OPEN: a check could not run\)/)
    expect(r.stderr).toContain("can't tell fails the step by default; --fail-on fail passes it")
    expect(run(cwd, '--files', 'docs/open.json', '--fail-on', 'fail').code).toBe(0)
  })
  it('a file that is not JSON is not checked: a tool notification, not a result; it fails the job unless fail-on is fail or none', () => {
    const cwd = repo()
    writeFileSync(join(cwd, 'docs', 'broken.json'), '{ "invoice_number": ')
    const r = run(cwd, '--files', 'docs/broken.json\ndocs/clean-invoice.json', '--fail-on', 'fail')
    expect(r.code).toBe(0)
    expect(run(cwd, '--files', 'docs/broken.json\ndocs/clean-invoice.json').code).toBe(1) // not checked fails the default
    const log = r.log!
    expect(validate(SCHEMA, log)).toEqual([])
    expect(resultsOf(log)).toEqual([])
    expect(log.runs[0].invocations[0].toolExecutionNotifications[0].message.text).toMatch(/^docs\/broken\.json: not checked: not JSON/)
    expect(log.runs[0].properties.riposte.refused).toBe(1)
    expect(run(cwd, '--files', 'docs/broken.json', '--fail-on', 'abstain').code).toBe(1)
  })
  it('usage: no pattern, nothing matched, a missing literal file, a bad --fail-on or ruleset → exit 3', () => {
    const cwd = repo()
    expect(run(cwd).code).toBe(3)
    expect(run(cwd, '--files', 'nowhere/**/*.json').code).toBe(3)
    expect(run(cwd, '--files', 'docs/missing.json').code).toBe(3)
    expect(run(cwd, '--files', 'docs/*.json', '--fail-on', 'sometimes').code).toBe(3)
    expect(run(cwd, '--files', 'docs/*.json', '--ruleset', 'ap-threeway').code).toBe(3)
    expect(run(cwd, '--help').code).toBe(0)
  })
  it('--root makes locations relative to the repository root when run from a subfolder', () => {
    const cwd = repo()
    const r = sarifCommand(['--files', '*.json', '--root', '..', '--out', '../out.sarif'], { cwd: join(cwd, 'docs') })
    expect(resultsOf(r.log!).every((x) => x.locations[0].physicalLocation.artifactLocation.uri.startsWith('docs/'))).toBe(true)
  })
})

describe('building blocks', () => {
  it('globs: ** any depth, * one segment, {a,b}, ! excludes', () => {
    expect(globRegex('docs/**/*.json').test('docs/a.json')).toBe(true)
    expect(globRegex('docs/**/*.json').test('docs/x/y/a.json')).toBe(true)
    expect(globRegex('docs/*.json').test('docs/x/a.json')).toBe(false)
    expect(globRegex('**/*.{json,jsonc}').test('a/b.jsonc')).toBe(true)
    const cwd = repo()
    expect(matchFiles(cwd, ['docs/*.json', '!docs/clean-*']).files).toEqual(['docs/invoice-missing-totals.json', 'docs/invoice-over-contract.json', 'docs/payapp-retainage.json'])
  })
  it('paths: dotted, indexed, wildcard, bracketed keys; formulas are not paths', () => {
    expect(pathSteps('line_items[*].amount')).toEqual(['line_items', '*', 'amount'])
    expect(pathSteps('evidence[0].totals.total')).toEqual(['evidence', 0, 'totals', 'total'])
    expect(pathSteps('dates[service_date]')).toEqual(['dates', 'service_date'])
    expect(pathSteps('$.a.b')).toEqual(['a', 'b'])
    expect(pathSteps('Σ(line_items[0].amount)')).toBeUndefined()
    expect(pathSteps('SUBTOTAL × TAX_RATE')).toBeUndefined()
  })
  it('a source span maps through JSON string escapes to the exact characters in the file', () => {
    const text = JSON.stringify({ extraction: { total: 5 }, source: { text: 'Line one\nCafé "Ostrander" owes 5' } }, null, 2)
    const root = jsonPositions(text)!
    const s = root.props!.get('source')!.props!.get('text')!
    const decoded = JSON.parse(text).source.text as string
    const start = decoded.indexOf('"Ostrander"')
    const a = rawOffset(text, s, start)
    const b = rawOffset(text, s, start + '"Ostrander"'.length)
    expect(text.slice(a, b)).toBe('\\"Ostrander\\"')
    expect(regionOf('ab\ncd', 3, 5)).toEqual({ startLine: 2, startColumn: 1, endLine: 2, endColumn: 3 })
    const claim = { claim_id: 'source.q1', kind: 'QUOTE_MATCH', tier: 'DETERMINISTIC', outcome: 'FAIL', field: 'q1', asserted: null, rule_id: 'QUOTE', rule_name: 'Quote', locked: true, explanation: 'x',
      evidence: [{ locator: { kind: 'span', source_hash: 'h', start, end: start + 11 }, value: '"Ostrander"', confidence: 100, role: 'QUOTE' }] } as any
    const loc = locateClaim({ uri: 'c.json', text, layout: 'inputs', result: { kind: 'refused', reason: '' } }, root, claim)
    expect(loc.located).toBe('source')
    expect(covered(text, loc.region)).toBe('\\"Ostrander\\"')
  })
  it('toSarif on no items is still a valid, empty log', () => {
    expect(validate(SCHEMA, toSarif([]))).toEqual([])
  })
})
