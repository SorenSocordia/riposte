/**
 * SURFACES-3 (2026-09-28): the surfaces over the book FILE and completeness.
 *   - P-E: every CLI verb reads a book streamed (readChainFile); a torn last line reads read-only with the named error and the
 *     repair command, and refuses every append; `verify ledger repair` and `verify ledger export`.
 *   - `verify reconcile` over reconcileCompleteness (exit 0 clean · 2 exceptions · 1 refused · 3 usage).
 *   - POST /v1/reconcile (stateless and managed; the tenant scope FORCED to the caller's) and the MCP tool.
 *   - Twin 0.2.1 over HTTP / MCP: opt-in, with its measured status in every result.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFileSync, readFileSync, rmSync, existsSync, mkdtempSync, readdirSync } from 'node:fs'
import { run, type CliIO } from '../src/cli'
import { route } from '../src/http/router'
import { createService, apiKeyAuth } from '../src/http/service'
import { bodyLimitFor, resolveLimits, MiB } from '../src/http/serve'
import { TWIN_MAP_STATUS } from '../src/http/surfaces'
import { handleRequest } from '../src/mcp/server'
import { MemoryLedger, readChainFile, createLedger, makeGrant, makeKeyRegister, signDecision, type Ledger } from '../src/ledger/index'
import { makeCosign, type BookDecision } from '../src/ledger/decisions'
import { EXAMPLE_PROMOTION_POLICY, policyRef, type PromotionPolicy, type TierRequirements, type VoiceLevel } from '../src/verdict/voice'
import {
  reconcileCompleteness, readPopulationCSV, renderCompletenessReport, completenessReportIntact, type CompletenessReport,
} from '../src/reconcile/completeness/index'
import { verifyAgainstTwin, parseTwinPresentation, FS_CORE_TWIN_MAP_V021 } from '../src/twin/index'
import { MAPPING, TRUSTED, OWNER, WF, buildScenario, keyFromSeed } from './fixtures/reconcile/scenario'
import { FS, OPTS, LODGING, LODGING_PRE } from './fixtures/twin-v021'

const HERE = dirname(fileURLToPath(import.meta.url))
const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
function scratch(): string {
  const d = mkdtempSync(join(tmpdir(), 'verify-surfaces-3-'))
  dirs.push(d)
  return d
}
function cli(argv: string[]): { code: number; out: string; err: string } {
  let out = ''
  let err = ''
  const io: CliIO = { out: s => { out += s }, err: s => { err += s } }
  const code = run(argv, io)
  return { code, out, err }
}

const S = buildScenario()
const ACME = { scope: { tenant_id: 'acme' }, anchors: { trusted_keys: TRUSTED } }
const LIB = reconcileCompleteness(readPopulationCSV(S.csv), S.ledger, MAPPING, { ...ACME, extractions: S.extractions })

/** The scenario on disk: the book (a chain export), the population, the mapping, the extractions, the trusted keys. */
function files(): { d: string; book: string; csv: string; mapping: string; ext: string; keys: string } {
  const d = scratch()
  const f = { d, book: join(d, 'chain.jsonl'), csv: join(d, 'payments.csv'), mapping: join(d, 'mapping.json'), ext: join(d, 'docs.jsonl'), keys: join(d, 'trusted.json') }
  writeFileSync(f.book, S.ledger.chainJSONL())
  writeFileSync(f.csv, S.csv)
  writeFileSync(f.mapping, JSON.stringify(MAPPING))
  writeFileSync(f.ext, S.extractions.map(x => JSON.stringify(x)).join('\n') + '\n')
  writeFileSync(f.keys, JSON.stringify(TRUSTED))
  return f
}
const reconcileArgs = (f: ReturnType<typeof files>, more: string[] = []): string[] =>
  ['reconcile', '--ledger', f.book, '--population', f.csv, '--mapping', f.mapping, '--extractions', f.ext, '--tenant', 'acme', '--trusted-keys', f.keys, ...more]

// ── P-E: the book is read streamed; a torn tail; repair and export ─────────────────────────────────────────────────

describe('P-E: every verb reads the book streamed', () => {
  it('no one-string read of a book is left in the CLI', () => {
    const src = readFileSync(join(HERE, '..', 'src', 'cli.ts'), 'utf8')
    expect(src).not.toMatch(/parseChainJSONL\(|snapshotFromChainJSONL\(/)
    expect(src).toMatch(/readChainFile\(path/)
  })
})

describe('a torn last line (a crash mid-append)', () => {
  const TORN = '{"seq":99,"type":"RECORD","payload":{"verdict":{"verd'
  function tornBook(): ReturnType<typeof files> & { before: Buffer } {
    const f = files()
    writeFileSync(f.book, `${S.ledger.chainJSONL()}\n${TORN}`)
    return { ...f, before: readFileSync(f.book) }
  }
  const policy = (d: string): string => { const p = join(d, 'policy.json'); writeFileSync(p, JSON.stringify(EXAMPLE_PROMOTION_POLICY)); return p }
  const keyFile = (d: string): string => { const p = join(d, 'owner.pem'); writeFileSync(p, OWNER.privateKeyPem); return p }
  const grant = (f: ReturnType<typeof files>): string[] =>
    ['grant', '--ledger', f.book, '--key', keyFile(f.d), '--signer', 'owner', '--workflow', WF, '--level', 'record', '--tier', 'moderate', '--policy', policy(f.d), '--trusted-keys', f.keys, '--signed-at', '2026-09-20T00:00:00Z']

  it('a read verb reads the whole events before it, says so with the repair command, and changes nothing', () => {
    const f = tornBook()
    const r = cli(['report', '--ledger', f.book, '--trusted-keys', f.keys])
    expect(r.code).toBe(0)
    expect(r.err).toMatch(/verify report: note: the book at .* ends in a torn line \(line \d+, 53 bytes at byte \d+, after event seq \d+\)/)
    expect(r.err).toContain(`verify ledger repair ${f.book}`)
    expect(readFileSync(f.book).equals(f.before)).toBe(true)
  })

  it('a verb that appends is REFUSED (exit 1) with the named error and the repair command; the book is byte-identical', () => {
    const f = tornBook()
    const r = cli(grant(f))
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/REFUSED: the book at .* ends in a torn line/)
    expect(r.err).toContain('Nothing was dropped')
    expect(r.err).toContain(`verify ledger repair ${f.book}`)
    expect(readFileSync(f.book).equals(f.before)).toBe(true)
  })

  it('verify ledger repair backs up, truncates, prints exactly what it removed, and the book takes appends again', () => {
    const f = tornBook()
    const r = cli(['ledger', 'repair', f.book])
    expect(r.code).toBe(0)
    const rep = JSON.parse(r.out) as { repaired: boolean; backup: string; log: string; removed: { bytes: number; base64: string; line: number }; events_kept: number }
    expect(rep.repaired).toBe(true)
    expect(Buffer.from(rep.removed.base64, 'base64').toString('utf8')).toBe(TORN)
    expect(rep.removed.bytes).toBe(Buffer.byteLength(TORN))
    expect(readFileSync(rep.backup).equals(f.before)).toBe(true)
    expect(existsSync(rep.log)).toBe(true)
    expect(r.err).toContain(`removed, as text: ${JSON.stringify(TORN)}`)
    expect(readFileSync(f.book, 'utf8')).toBe(`${S.ledger.chainJSONL()}\n`)
    expect(rep.events_kept).toBe(S.ledger.events().length)
    // Whole now: a second repair touches nothing, and the append goes through.
    const again = cli(['ledger', 'repair', f.book])
    expect(again.code).toBe(0)
    expect(JSON.parse(again.out)).toMatchObject({ repaired: false })
    expect(again.err).toMatch(/nothing to repair/)
    expect(cli(grant(f)).code).toBe(0)
    expect(readChainFile(f.book).events.length).toBe(S.ledger.events().length + 1)
  })

  it('corruption before the last line is refused everywhere (exit 1), and repair writes nothing, not even a backup', () => {
    const f = files()
    const lines = S.ledger.chainJSONL().split('\n')
    lines.splice(3, 0, '{"not json')
    writeFileSync(f.book, lines.join('\n'))
    const before = readFileSync(f.book)
    const rep = cli(['ledger', 'repair', f.book])
    expect(rep.code).toBe(1)
    expect(rep.err).toMatch(/REFUSED: the book at .* is corrupt: line 4/)
    expect(readdirSync(f.d).some(n => n.endsWith('.bak'))).toBe(false)
    const report = cli(['report', '--ledger', f.book])
    expect(report.code).toBe(1)
    expect(report.err).toMatch(/is corrupt/)
    expect(cli(reconcileArgs(f)).code).toBe(1)
    expect(readFileSync(f.book).equals(before)).toBe(true)
  })
})

describe('verify ledger export', () => {
  it('writes the chain export (the bytes chainJSONL gives), streamed, and never over a file', () => {
    const f = files()
    writeFileSync(f.book, `${S.ledger.chainJSONL()}\n`) // a live book file ends in a newline; the export does not
    const out = join(f.d, 'export.jsonl')
    const r = cli(['ledger', 'export', f.book, '--out', out])
    expect(r.code).toBe(0)
    expect(readFileSync(out, 'utf8')).toBe(S.ledger.chainJSONL())
    expect(JSON.parse(r.out)).toMatchObject({ out, events: S.ledger.events().length, head: S.ledger.chainHead() })
    expect(r.err).toMatch(/not verified here/)
    writeFileSync(out, 'mine')
    const again = cli(['ledger', 'export', '--ledger', f.book, '--out', out])
    expect(again.code).toBe(1)
    expect(again.err).toMatch(/already exists: an export is never written over a file/)
    expect(readFileSync(out, 'utf8')).toBe('mine')
  })

  it('usage: --out required; the book named once; an unknown sub-verb; a missing book', () => {
    const f = files()
    expect(cli(['ledger', 'export', f.book]).code).toBe(3)
    expect(cli(['ledger', 'export', f.book, '--ledger', f.book, '--out', join(f.d, 'x')]).code).toBe(3)
    expect(cli(['ledger', 'verify', f.book]).code).toBe(3)
    expect(cli(['ledger', 'repair', join(f.d, 'nope.jsonl')]).code).toBe(3)
    expect(cli(['ledger', 'repair', f.book, '--out', 'x']).code).toBe(3)
  })
})

// ── verify reconcile ─────────────────────────────────────────────────────────────────────────────────────────────────

describe('verify reconcile', () => {
  it('prints the library\'s report byte for byte and exits 2 on exceptions, naming the override first', () => {
    const f = files()
    const r = cli(reconcileArgs(f))
    expect(r.code).toBe(2)
    const got = JSON.parse(r.out) as CompletenessReport
    expect(got).toEqual(LIB)
    expect(got.report_hash).toBe(LIB.report_hash)
    expect(completenessReportIntact(got)).toBe(true)
    expect(r.err).toMatch(/EXCEPTIONS a person must look at: PAID_DESPITE_HOLD 2, MISMATCHED 2, BYPASSED 3, AMBIGUOUS 2, CHECKED_AFTER_PAYMENT 1/)
  })

  it('--md prints the Markdown an auditor reads; JSON and Markdown are one or the other', () => {
    const f = files()
    const r = cli(reconcileArgs(f, ['--md']))
    expect(r.code).toBe(2)
    expect(r.out).toBe(renderCompletenessReport(LIB))
    expect(cli(reconcileArgs(f, ['--md', '--json'])).code).toBe(3)
  })

  it('exit 0 when every row is MATCHED', () => {
    const f = files()
    const lines = S.csv.split('\r\n')
    const matched = [lines[0]!, ...Object.entries(S.expected).filter(([, c]) => c === 'MATCHED').map(([row]) => lines[Number(row)]!)]
    writeFileSync(f.csv, matched.join('\r\n') + '\r\n')
    const r = cli(reconcileArgs(f))
    expect(r.code).toBe(0)
    expect((JSON.parse(r.out) as CompletenessReport).clean).toBe(true)
    expect(r.err).toMatch(/clean: 5 row\(s\), every one MATCHED/)
  })

  it('without anchors a GRANT sets no rung, and that is said', () => {
    const f = files()
    const r = cli(['reconcile', '--ledger', f.book, '--population', f.csv, '--mapping', f.mapping, '--extractions', f.ext, '--tenant', 'acme'])
    expect(r.code).toBe(2)
    expect(r.err).toMatch(/GRANT\(s\) on the book are not anchored and set no rung/)
    expect((JSON.parse(r.out) as CompletenessReport).population.by_class.PAID_DESPITE_HOLD).toBe(0)
  })

  it('refusals exit 1 (a book that does not verify; a mapping the engine will not read); usage exits 3', () => {
    const f = files()
    const bad = join(f.d, 'bad-mapping.json')
    writeFileSync(bad, JSON.stringify({ ...MAPPING, population: { columns: { ...MAPPING.population.columns, amount: 'Nope' } } }))
    const r = cli(reconcileArgs({ ...f, mapping: bad }))
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/REFUSED: mapping: population\.columns\.amount names column "Nope"/)
    const lines = S.ledger.chainJSONL().split('\n')
    const ev = JSON.parse(lines[2]!) as { payload: { recorded_at: string } }
    ev.payload.recorded_at = '2026-09-03T12:00:01.000Z'
    lines[2] = JSON.stringify(ev)
    writeFileSync(f.book, lines.join('\n'))
    const broken = cli(reconcileArgs(f))
    expect(broken.code).toBe(1)
    expect(broken.err).toMatch(/REFUSED: the book does not verify at event 2/)
    const plain = join(f.d, 'payments.txt')
    writeFileSync(plain, S.csv)
    expect(cli(['reconcile', '--ledger', f.book, '--population', plain, '--mapping', f.mapping]).code).toBe(3)
    expect(cli(['reconcile', '--ledger', f.book, '--population', f.csv]).code).toBe(3)
    expect(cli(reconcileArgs(f, ['--delimiter', 'x'])).code).toBe(3)
    expect(cli(reconcileArgs(f, ['--rungs', '{"acme/invoice@0.0.1":"boss"}'])).code).toBe(3)
  })
})

// ── POST /v1/reconcile and the MCP tool ─────────────────────────────────────────────────────────────────────────────

const population = { format: 'csv', text: S.csv }
const body = { population, mapping: MAPPING, extractions: S.extractions }

describe('POST /v1/reconcile (stateless) and reconcile_completeness (MCP)', () => {
  it('stateless: the chain export as "ledger", the same report as the library, byte for byte', () => {
    const r = route({ method: 'POST', path: '/v1/reconcile', body: { ...body, ledger: S.ledger.chainJSONL(), tenant_id: 'acme', trusted_keys: TRUSTED } })
    expect(r.status).toBe(200)
    const { report, markdown } = r.json as { report: CompletenessReport; markdown: string }
    expect(report).toEqual(LIB)
    expect(markdown).toBe(renderCompletenessReport(LIB))
    // The export's own bytes as base64 bind the same sha256.
    const b64 = route({ method: 'POST', path: '/v1/reconcile', body: { ...body, population: { format: 'csv', base64: Buffer.from(S.csv).toString('base64') }, ledger: S.ledger.chainJSONL(), tenant_id: 'acme', trusted_keys: TRUSTED } })
    expect((b64.json as { report: CompletenessReport }).report.report_hash).toBe(LIB.report_hash)
  })

  it('bad input is a 400 that says what is wrong', () => {
    const bad = (b: unknown): string => {
      const r = route({ method: 'POST', path: '/v1/reconcile', body: b })
      expect(r.status).toBe(400)
      return (r.json as { error: string }).error
    }
    expect(bad({ ...body })).toMatch(/"ledger" is required/)
    expect(bad({ ...body, ledger: S.ledger.chainJSONL(), population: { format: 'xlsx', text: 'x' } })).toMatch(/"population.format" must be "csv" or "jsonl"/)
    expect(bad({ ...body, ledger: S.ledger.chainJSONL(), population: { format: 'csv', text: 'a,b\n1' } })).toMatch(/population refused/)
    expect(bad({ ...body, ledger: S.ledger.chainJSONL(), mapping: { ...MAPPING, key: [] } })).toMatch(/reconciliation refused/)
    expect(bad({ ...body, ledger: S.ledger.chainJSONL(), rungs: { [WF]: 'boss' } })).toMatch(/"rungs\.acme\/invoice@0\.0\.1" must be one of/)
  })

  it('the MCP tool returns the Markdown as text and the report as structured content', () => {
    const res = handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'reconcile_completeness', arguments: { ...body, ledger: S.ledger.chainJSONL(), tenant_id: 'acme', trusted_keys: TRUSTED } } })
    const out = res!.result as { content: { text: string }[]; structuredContent: CompletenessReport; isError: boolean }
    expect(out.isError).toBe(false)
    expect(out.structuredContent.report_hash).toBe(LIB.report_hash)
    expect(out.content[0]!.text).toBe(renderCompletenessReport(LIB))
    const list = handleRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list' })!.result as { tools: { name: string }[] }
    expect(list.tools.map(t => t.name)).toContain('reconcile_completeness')
  })

  it('the transport takes a 32 MiB body on this route', () => {
    expect(bodyLimitFor(resolveLimits(), '/v1/reconcile')).toBe(32 * MiB)
  })
})

describe('POST /v1/reconcile (managed tier): the caller\'s own book, the scope forced to the caller\'s tenant', () => {
  const svc = createService({ ledger: S.ledger, authenticate: apiKeyAuth({ ka: 'acme', kg: 'globex' }) })
  const post = (b: unknown, key = 'ka') => svc.handle({ method: 'POST', path: '/v1/reconcile', body: b, headers: { 'x-api-key': key } })

  it('reads the tier\'s ledger with its own anchors: the same classes and exceptions as the library under them', () => {
    const r = post(body)
    expect(r.status).toBe(200)
    const j = r.json as { tenant_id: string; report: CompletenessReport; markdown: string }
    expect(j.tenant_id).toBe('acme')
    expect(j.report.population).toEqual(LIB.population)
    expect(j.report.exceptions).toEqual(LIB.exceptions)
    expect(j.report.coverage).toEqual(LIB.coverage)
    expect(j.report.binds.book).toEqual(LIB.binds.book)
    expect(j.report.scope).toEqual({ tenant_id: 'acme' })
    expect(completenessReportIntact(j.report)).toBe(true)
    expect(j.markdown).toBe(renderCompletenessReport(j.report))
  })

  it('a shared book: another tenant is never named, counted or listed (the summary is the caller\'s slice)', () => {
    const j = post(body).json as { report: CompletenessReport }
    expect(LIB.book.tenants).toEqual(['acme']) // P-S3-R1: the engine's own summary is the tenant's slice
    expect(j.report.book.tenants).toEqual(['acme'])
    expect(j.report.book.records).toBe(LIB.book.records)
    expect(j.report.book.out_of_scope).toBe(0)
    const text = JSON.stringify(post(body).json)
    expect(text).not.toContain('globex')
    expect(text).not.toContain(S.verdicts.X1!.verdict_id)
  })

  it('the body never widens the scope: another tenant, its workflow, a chain export or anchors are refused', () => {
    expect(post({ ...body, tenant_id: 'globex' }).status).toBe(404)
    expect(post({ ...body, tenant_id: 'acme' }).status).toBe(200)
    expect(post({ ...body, workflows: ['globex/invoice@0.0.1'] }).status).toBe(404)
    expect(post({ ...body, ledger: S.ledger.chainJSONL() }).status).toBe(400)
    expect(post({ ...body, trusted_keys: TRUSTED }).status).toBe(400)
    expect(post('not an object').status).toBe(400)
    // globex's call over the same payments: globex's records only. The one row it matches is its own X1; nothing of acme's.
    const g = post(body, 'kg').json as { tenant_id: string; report: CompletenessReport }
    expect(g.tenant_id).toBe('globex')
    expect(g.report.population.by_class.MATCHED).toBe(1)
    expect(g.report.book.tenants).toEqual(['globex'])
    expect(JSON.stringify(g)).not.toContain(S.verdicts.A1!.verdict_id)
    expect(post(body, 'nope').status).toBe(401)
  })

  it('a book that does not verify reconciles nothing (409)', () => {
    const snap = S.ledger.snapshot()
    const payloads = [...snap.payloads]
    payloads[2] = { ...(payloads[2] as Record<string, unknown>), recorded_at: '2026-09-03T12:00:01.000Z' }
    const tampered = createService({ ledger: new MemoryLedger({ seed: { events: [...snap.events], payloads } }) })
    const r = tampered.handle({ method: 'POST', path: '/v1/reconcile', body })
    expect(r.status).toBe(409)
    expect((r.json as { error: string }).error).toMatch(/does not verify/)
  })
})

// ── twin 0.2.1 over HTTP / MCP ───────────────────────────────────────────────────────────────────────────────────────

describe('twin 0.2.1 over HTTP and MCP: opt-in, with its measured status', () => {
  const claims = [{ id: 'e', field: 'ending_cash', value: 10_361_842 }, { id: 'x', field: 'ending_cash', value: 10_340_792 }]
  const args = { html: LODGING, period_end: OPTS.periodEnd, claims, pre: LODGING_PRE, filing_summary: FS }
  const lib = verifyAgainstTwin(LODGING, claims, { periodEnd: OPTS.periodEnd, map: FS_CORE_TWIN_MAP_V021, presentation: parseTwinPresentation({ pre: LODGING_PRE, filingSummary: FS }, { links: 'strict' }) })

  it('ruleset 0.2.1 reads the linkbase strictly, equals the library, and states its held-out FAIL', () => {
    const r = route({ method: 'POST', path: '/v1/twin', body: { ...args, ruleset: '0.2.1' } })
    expect(r.status).toBe(200)
    const j = r.json as typeof lib & { map_status: unknown }
    expect(j.map_status).toEqual(TWIN_MAP_STATUS['0.2.1'])
    expect(j.map_status).toMatchObject({ map_version: '0.2.1', offered: 'opt-in', measured: 'held-out prereg FAIL (2026-09-28)' })
    expect(j.judgments).toEqual(lib.judgments)
    expect(j.verdict.verdict_id).toBe(lib.verdict.verdict_id)
    expect(j.verdict.ruleset).toEqual({ id: 'twin-xbrl-fs-core', version: '0.2.1', domain: 'financial-statements' })
    // AMBIGUOUS_LINE (the roll could not choose between face lines) is the insufficiency AMBIGUOUS_REFERENCE.
    expect(j.verdict.claims[1]!.insufficiency).toMatchObject({ reason: 'AMBIGUOUS_REFERENCE' })
    expect(j.verdict.claims[1]!.insufficiency!.detail).toMatch(/^AMBIGUOUS_LINE: /)
  })

  it('map_version 0.2.1 over MCP says the same; 0.1 stays the default and 0.2 selectable, neither with a status', () => {
    const res = handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'verify_twin', arguments: { ...args, map_version: '0.2.1' } } })
    const sc = (res!.result as { structuredContent: { map_status?: unknown } }).structuredContent
    expect(sc.map_status).toEqual(TWIN_MAP_STATUS['0.2.1'])
    const v01 = route({ method: 'POST', path: '/v1/twin', body: { html: LODGING, period_end: OPTS.periodEnd, claims } }).json as { map_status?: unknown; verdict: { ruleset: { version: string } } }
    expect(v01.map_status).toBeUndefined()
    expect(v01.verdict.ruleset.version).toBe('0.1.0')
    const v02 = route({ method: 'POST', path: '/v1/twin', body: { ...args, ruleset: '0.2' } }).json as { map_status?: unknown; verdict: { ruleset: { version: string } } }
    expect(v02.map_status).toBeUndefined()
    expect(v02.verdict.ruleset.version).toBe('0.2.0')
    expect(route({ method: 'POST', path: '/v1/twin', body: { ...args, ruleset: '0.2.1', map_version: '0.2.0' } }).status).toBe(400)
  })
})

// ── D-DUAL on the surfaces: a pending grant moves no rung, anywhere; a second person co-signs ───────────────────────

describe('D-DUAL on the surfaces', () => {
  const ROOT = keyFromSeed('a1'.repeat(32))
  const ALICE = keyFromSeed('b1'.repeat(32))
  const BOB = keyFromSeed('b2'.repeat(32))
  const DWF = 'acme/payments@1.0.0'
  const bars = { advise: { min_n: 3, max_error: 0.5 }, gate: { min_n: 5, max_error: 0.4 }, autonomy: { min_n: 8, max_error: 0.3 } }
  const HIGH: TierRequirements = { tier: 'high', description: 'test tier', confidence: 0.9, ...bars, grant_signatures: 2 }
  const DUAL: PromotionPolicy = { policy_version: 'promotion-policy-v0', policy_id: 'dual-s3', version: '1.0.0', method: 'wilson', sidedness: 'one-sided', tiers: [HIGH] }
  let clock = Date.parse('2026-09-01T09:00:00Z')
  const tick = (): Date => new Date((clock += 60_000))
  const iso = (): string => new Date(clock).toISOString()
  const grant = (level: VoiceLevel, extra: Record<string, unknown> = {}) =>
    makeGrant({ workflow_id: DWF, level, consequence_tier: 'high', policy: policyRef(DUAL), signer_id: 'alice', signed_at: iso(), ...(level === 'autonomy' ? { bounds: 'all' } : {}), ...extra })
  /** A rooted book: alice and bob are registered grant signers; alice's gate grant is in force. */
  function book(): Ledger {
    clock = Date.parse('2026-09-01T09:00:00Z')
    const led = createLedger({ now: tick, root_keys: [ROOT.publicKeyPem] })
    for (const [id, k] of [['alice', ALICE], ['bob', BOB]] as const) {
      led.decide(signDecision(makeKeyRegister({ subject_id: id, public_key: k.publicKeyPem, roles: ['grant_signer'], signer_id: 'root', signed_at: iso() }), ROOT.privateKeyPem))
    }
    led.decide(signDecision(grant('gate'), ALICE.privateKeyPem))
    return led
  }
  const check = (svc: ReturnType<typeof createService>) =>
    svc.handle({ method: 'POST', path: '/v1/action/check', body: { action: { tool: 'noop' }, workflow_id: DWF }, headers: { 'x-api-key': 'ka' } })
  const auth = apiKeyAuth({ ka: 'acme', kg: 'globex' })

  it('GAP closed: a hand-built autonomy grant that omits its signature count moves no rung on the action check (the policy is read)', () => {
    const led = book()
    // One person, bypassing grantUnderPolicy: no `signatures` stated. The door takes it (it does not know the base policy).
    const bare = led.decide(signDecision(grant('autonomy'), ALICE.privateKeyPem))
    const svc = createService({ ledger: led, authenticate: auth, voice: { policy: DUAL } })
    const r = check(svc).json as { level: string; level_source: string; no_effect?: { decision_id: string; pending?: unknown; notice: string }[] }
    expect(r).toMatchObject({ level: 'gate', level_source: 'grant' })
    expect(r.no_effect![0]).toMatchObject({ decision_id: bare.decision_id, pending: { required: 2, signed_by: ['alice'] } })
    expect(r.no_effect![0]!.notice).toMatch(/is pending: autonomy at tier 'high' needs 2 signatures/)
    // The voice surface says the same: gate, with the pending grant in no_effect.
    const v = svc.handle({ method: 'GET', path: `/v1/voice/${encodeURIComponent(DWF)}`, headers: { 'x-api-key': 'ka' } })
    expect(v.status).toBe(200)
    expect(v.json).toMatchObject({ level: 'gate' })
    expect((v.json as { no_effect: { decision_id: string }[] }).no_effect.map(n => n.decision_id)).toContain(bare.decision_id)
    // HONEST BOUNDARY (D-DUAL-DECLARED): a deployment that declares no policy reads the count the grant states.
    expect((check(createService({ ledger: led, authenticate: auth })).json as { level: string }).level).toBe('autonomy')
  })

  it('a grant that states its count is pending without the policy too; POST /v1/grant/cosign puts it in force', () => {
    const led = book()
    const g = led.decide(signDecision(grant('autonomy', { signatures: 2 }), ALICE.privateKeyPem))
    const svc = createService({ ledger: led, authenticate: auth, voice: { policy: DUAL } })
    expect((check(svc).json as { level: string }).level).toBe('gate')
    const post = (b: unknown, key = 'ka') => svc.handle({ method: 'POST', path: '/v1/grant/cosign', body: b, headers: { 'x-api-key': key } })
    const by = (signer: string, k: { privateKeyPem: string }) => signDecision<BookDecision>(makeCosign(g, { signer_id: signer, signed_at: iso() }), k.privateKeyPem)
    const before = led.events().length
    // The door refuses a co-signature that would not count: the grant's own signer.
    expect(post(by('alice', ALICE)).status).toBe(409)
    expect(led.events().length).toBe(before)
    expect(post(by('bob', BOB), 'kg').status).toBe(404) // another tenant's grant
    expect(post({ decision: { kind: 'GRANT' } }).status).toBe(400)
    expect(route({ method: 'POST', path: '/v1/grant/cosign', body: by('bob', BOB) }).status).toBe(404) // stateless: no book
    const ok = post(by('bob', BOB))
    expect(ok.status).toBe(200)
    expect(ok.json).toMatchObject({ tenant_id: 'acme', grant: { decision_id: g.decision_id, in_force: true, signatures: { required: 2, signers: ['alice', 'bob'], complete: true } }, no_effect: [] })
    expect(led.events().at(-1)!.type).toBe('GRANT') // a co-signature rides in a GRANT event
    const after = check(svc).json as { level: string; no_effect?: unknown }
    expect(after.level).toBe('autonomy')
    expect(after.no_effect).toBeUndefined()
  })

  it('verify grant says a pending grant; verify grant --cosign adds the second signature (and refuses one that would not count)', () => {
    const d = scratch()
    const led = book()
    const p = (n: string, s: string): string => { const f = join(d, n); writeFileSync(f, s); return f }
    const bookFile = p('chain.jsonl', led.chainJSONL())
    const pol = p('dual.json', JSON.stringify(DUAL))
    const alice = p('alice.pem', ALICE.privateKeyPem)
    const bob = p('bob.pem', BOB.privateKeyPem)
    const root = p('root.pub.pem', ROOT.publicKeyPem)
    const g = cli(['grant', '--ledger', bookFile, '--key', alice, '--signer', 'alice', '--workflow', DWF, '--level', 'autonomy', '--tier', 'high', '--bounds', 'all', '--policy', pol, '--root-keys', root])
    expect(g.code).toBe(0)
    const id = (JSON.parse(g.out) as { appended: { decision_id: string } }).appended.decision_id
    expect(g.err).toMatch(/is pending: autonomy at tier 'high' needs 2 signatures/)
    expect(g.err).toContain(`verify grant --cosign ${id}`)
    const cosign = (key: string, signer: string, more: string[] = []) => cli(['grant', '--cosign', id.slice(0, 12), '--ledger', bookFile, '--key', key, '--signer', signer, '--root-keys', root, ...more])
    const before = readFileSync(bookFile)
    const own = cosign(alice, 'alice')
    expect(own.code).toBe(1)
    expect(own.err).toMatch(/REFUSED/)
    expect(readFileSync(bookFile).equals(before)).toBe(true)
    const ok = cosign(bob, 'bob', ['--policy', pol])
    expect(ok.code).toBe(0)
    expect(JSON.parse(ok.out)).toMatchObject({ grant: { decision_id: id, level: 'autonomy', in_force: true, signatures: { required: 2, signers: ['alice', 'bob'], complete: true } } })
    expect(ok.err).toMatch(/2 of 2 signature\(s\) \(alice, bob\): in force/)
    expect(readChainFile(bookFile).events.at(-1)!.type).toBe('GRANT')
    // usage and refusals
    expect(cli(['grant', '--cosign', id, '--ledger', bookFile, '--key', bob, '--signer', 'bob', '--level', 'gate']).code).toBe(3)
    expect(cli(['grant', '--cosign', 'xyz', '--ledger', bookFile, '--key', bob, '--signer', 'bob']).code).toBe(3)
    expect(cli(['grant', '--cosign', 'f'.repeat(32), '--ledger', bookFile, '--key', bob, '--signer', 'bob', '--root-keys', root]).code).toBe(1)
  })
})
