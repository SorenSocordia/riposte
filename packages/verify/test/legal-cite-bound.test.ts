/**
 * The citation length bound at the doors (2026-10-20). A citation's text is the caller's, and five patterns that read it are
 * quadratic in a long run of spaces or open parentheses: a 64 KB cite costs seconds on its own, and a long text key is read again
 * for every citation of the brief. The doors that take citations from a caller (`POST /v1/verify/citations`, the MCP tool
 * `verify_citations`, the `citations` command) refuse a cite, case name, source key or text key longer than the bound before any
 * pattern runs and before anything is hashed: the HTTP route answers 400, the MCP tool a tool error, the command exit 3, each naming
 * the bound and the length. It is never a verdict. At the bound and under it, every door answers exactly as before (the library's
 * verifyCitations, which has no bound, is the reference).
 *
 * Time: each refusal is the median of RUNS calls under BOUND_MS; a single call over HARD_MS fails at once.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { route } from '../src/http/router'
import { serve, type createHttpServer } from '../src/http/serve'
import { handleRequest, type JsonRpcRequest } from '../src/mcp/server'
import { runCitations } from '../src/legal/cli-citations'
import { verifyCitations, type Citation, type OpinionSources } from '../src/legal/index'

const PACKAGE = join(dirname(fileURLToPath(import.meta.url)), '..')

/** The documented bound (docs/LEGAL.md, "How to run it"), in characters as JavaScript counts a string. */
const BOUND = 1024
/** A string of exactly n characters in the shape that costs most: a volume, a capital, a run of spaces, a letter. */
const spaced = (n: number): string => `1 A${' '.repeat(n - 4)}x`
const QUOTE = 'the words the brief quotes from the opinion'
const CITE = '201 F.3d 110'
const TEXT = readFileSync(join(PACKAGE, 'docs/examples/legal-opinions/makarova-201-F3d-110.txt'), 'utf8')
const SOURCES: OpinionSources = { [CITE]: TEXT }

// ── time ──
const BOUND_MS = 50
const RUNS = 10
const HARD_MS = 2000
function timed(fn: () => void): { median: number; runs: number[] } {
  const runs: number[] = []
  for (let i = 0; i < RUNS; i++) {
    const t = process.hrtime.bigint()
    fn()
    const ms = Number(process.hrtime.bigint() - t) / 1e6
    runs.push(ms)
    if (ms > HARD_MS || runs.filter(x => x > BOUND_MS).length > RUNS / 2) return { median: Number.POSITIVE_INFINITY, runs }
  }
  const s = [...runs].sort((a, b) => a - b)
  return { median: (s[RUNS / 2 - 1]! + s[RUNS / 2]!) / 2, runs }
}
async function timedAsync(fn: () => Promise<void>): Promise<{ median: number; runs: number[] }> {
  const runs: number[] = []
  for (let i = 0; i < RUNS; i++) {
    const t = process.hrtime.bigint()
    await fn()
    const ms = Number(process.hrtime.bigint() - t) / 1e6
    runs.push(ms)
    if (ms > HARD_MS || runs.filter(x => x > BOUND_MS).length > RUNS / 2) return { median: Number.POSITIVE_INFINITY, runs }
  }
  const s = [...runs].sort((a, b) => a - b)
  return { median: (s[RUNS / 2 - 1]! + s[RUNS / 2]!) / 2, runs }
}
const shown = (r: { runs: number[] }): string => `runs (ms): ${r.runs.map(x => x.toFixed(2)).join(', ')}`

/** A verdict without its clock: the only field two issues of the same inputs may differ in. */
const unclocked = (v: unknown): unknown => ({ ...(v as Record<string, unknown>), issued_at: 'fixed' })

/** The over-bound cases: each field the bound covers, one character over, in the costly shape. */
const OVER: { name: string; citations: Citation[]; sources: OpinionSources; words: RegExp }[] = [
  { name: 'a cite', citations: [{ id: 'c1', cite: spaced(BOUND + 1), quote: QUOTE }], sources: SOURCES, words: /cite of citation 0 \("c1"\) is 1025 characters/ },
  { name: 'a case name', citations: [{ id: 'c1', cite: CITE, case_name: spaced(BOUND + 1), quote: QUOTE }], sources: SOURCES, words: /case_name of citation 0 \("c1"\) is 1025 characters/ },
  { name: 'a source key', citations: [{ id: 'c1', cite: CITE, source_key: spaced(BOUND + 1), quote: QUOTE }], sources: SOURCES, words: /source_key of citation 0 \("c1"\) is 1025 characters/ },
  { name: 'a key of the texts', citations: [{ id: 'c1', cite: `${CITE}, 113`, quote: QUOTE }], sources: { ...SOURCES, [spaced(BOUND + 1)]: TEXT }, words: /a key of .* is 1025 characters/ },
]
/** The words every refusal carries: what was refused, the bound, and that nothing was checked. */
const REFUSAL = /citation text too long: .* read up to 1024 characters\. Nothing was checked; this is not a verdict/
/** The attack: a 64 KB cite, about ten seconds through the patterns. */
const ATTACK: Citation[] = [{ id: 'c1', cite: spaced(64 * 1024), quote: QUOTE }]

describe('the bound itself', () => {
  it('is one constant, 1024, exported where every door reads it', async () => {
    const m = await import('../src/legal/cite-bound')
    expect(m.MAX_CITE_CHARS).toBe(BOUND)
  })
  it('counts characters as JavaScript counts a string: a character outside the Basic Multilingual Plane counts two', () => {
    const cite = `${'a'.repeat(BOUND - 1)}\u{1F600}` // 1,023 + 2 code units
    const r = route({ method: 'POST', path: '/v1/verify/citations', body: { citations: [{ id: 'c1', cite, quote: QUOTE }] } })
    expect(r.status).toBe(400)
    expect((r.json as { error: string }).error).toMatch(/is 1025 characters/)
  })
})

describe('POST /v1/verify/citations refuses citation text over the bound, 400, before any pattern runs', () => {
  for (const c of OVER) {
    it(`${c.name} one character over: 400, naming the bound and the length, median under ${BOUND_MS} ms`, () => {
      let r = route({ method: 'POST', path: '/v1/verify/citations', body: { citations: c.citations, sources: c.sources } })
      expect(r.status).toBe(400)
      expect(r.headers).toBeUndefined() // a refusal carries no exit reading: no verdict was made
      expect((r.json as { error: string }).error).toMatch(c.words)
      expect((r.json as { error: string }).error).toMatch(REFUSAL)
      const t = timed(() => { r = route({ method: 'POST', path: '/v1/verify/citations', body: { citations: c.citations, sources: c.sources } }) })
      expect(t.median, shown(t)).toBeLessThan(BOUND_MS)
    }, 120_000)
  }
  it(`a 64 KB cite: refused, median under ${BOUND_MS} ms`, () => {
    const t = timed(() => {
      const r = route({ method: 'POST', path: '/v1/verify/citations', body: { citations: ATTACK } })
      expect(r.status).toBe(400)
    })
    expect(t.median, shown(t)).toBeLessThan(BOUND_MS)
  }, 120_000)
  it('a cite, case name, source key and text key each at the bound: the verdict, as the library gives it', () => {
    const citations: Citation[] = [
      { id: 'c1', cite: spaced(BOUND), quote: QUOTE },
      { id: 'c2', cite: CITE, case_name: spaced(BOUND), source_key: spaced(BOUND), quote: QUOTE },
      { id: 'c3', cite: `${CITE}, 113`, quote: QUOTE },
    ]
    const sources = { ...SOURCES, [spaced(BOUND)]: TEXT }
    const r = route({ method: 'POST', path: '/v1/verify/citations', body: { citations, sources } })
    expect(r.status).toBe(200)
    expect(unclocked(r.json)).toEqual(unclocked(verifyCitations(citations, sources)))
  }, 120_000)
})

describe('verify serve refuses it the same way, through the transport and the check worker', () => {
  const servers: ReturnType<typeof createHttpServer>[] = []
  afterEach(async () => {
    for (const s of servers.splice(0)) { s.closeAllConnections(); await new Promise<void>(r => s.close(() => r())) }
  })
  const post = (port: number, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> => new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method: 'POST', path: '/v1/verify/citations', headers: { 'content-type': 'application/json' } }, res => {
      const parts: Buffer[] = []
      res.on('data', c => parts.push(c as Buffer))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, json: JSON.parse(Buffer.concat(parts).toString('utf8')) as Record<string, unknown> }))
    })
    req.on('error', reject)
    req.end(JSON.stringify(body))
  })
  it(`a 64 KB cite: 400 with the bound named, median of ${RUNS} round trips under ${BOUND_MS} ms once a worker is up`, async () => {
    const s = serve(0, { log: { out: () => {}, err: () => {} } })
    servers.push(s)
    await new Promise<void>(r => s.on('listening', () => r()))
    const port = (s.address() as AddressInfo).port
    expect((await post(port, { citations: [{ id: 'w', cite: CITE, quote: QUOTE }], sources: SOURCES })).status).toBe(200) // a worker is up
    const first = await post(port, { citations: ATTACK })
    expect(first.status).toBe(400)
    expect(String(first.json.error)).toMatch(/cite of citation 0 \("c1"\) is 65536 characters/)
    expect(String(first.json.error)).toMatch(REFUSAL)
    const t = await timedAsync(async () => { expect((await post(port, { citations: ATTACK })).status).toBe(400) })
    expect(t.median, shown(t)).toBeLessThan(BOUND_MS)
  }, 180_000)
})

describe('the MCP tool verify_citations refuses it as it refuses other unreadable input: a tool error', () => {
  const call = (args: unknown): { isError?: boolean; content: { text: string }[]; structuredContent?: unknown } =>
    (handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'verify_citations', arguments: args } } as JsonRpcRequest) as { result: { isError?: boolean; content: { text: string }[]; structuredContent?: unknown } }).result
  for (const c of OVER) {
    it(`${c.name} one character over: a tool error naming the bound and the length, median under ${BOUND_MS} ms`, () => {
      let r = call({ citations: c.citations, sources: c.sources })
      expect(r.isError).toBe(true)
      expect(r.structuredContent).toBeUndefined()
      expect(r.content[0]!.text).toMatch(/^verify error: verify_citations: citation text too long: /)
      expect(r.content[0]!.text).toMatch(c.words)
      expect(r.content[0]!.text).toMatch(REFUSAL)
      const t = timed(() => { r = call({ citations: c.citations, sources: c.sources }) })
      expect(t.median, shown(t)).toBeLessThan(BOUND_MS)
    }, 120_000)
  }
  it(`a 64 KB cite: refused, median under ${BOUND_MS} ms`, () => {
    const t = timed(() => { expect(call({ citations: ATTACK }).isError).toBe(true) })
    expect(t.median, shown(t)).toBeLessThan(BOUND_MS)
  }, 120_000)
  it('citation text at the bound: the verdict, as the library gives it', () => {
    const citations: Citation[] = [
      { id: 'c1', cite: spaced(BOUND), quote: QUOTE },
      { id: 'c2', cite: CITE, case_name: spaced(BOUND), source_key: spaced(BOUND), quote: QUOTE },
      { id: 'c3', cite: `${CITE}, 113`, quote: QUOTE },
    ]
    const sources = { ...SOURCES, [spaced(BOUND)]: TEXT }
    const r = call({ citations, sources })
    expect(r.isError).toBe(false)
    expect(unclocked(r.structuredContent)).toEqual(unclocked(verifyCitations(citations, sources)))
  }, 120_000)
})

describe('the citations command refuses it, exit 3, naming the bound', () => {
  /** A brief file and a sources folder (a manifest; `extraKey` adds a text under that key). */
  function files(citations: Citation[], extraKey?: string): { brief: string; dir: string } {
    const root = mkdtempSync(join(tmpdir(), 'cite-bound-'))
    const dir = join(root, 'opinions')
    mkdirSync(dir)
    writeFileSync(join(dir, 'makarova.txt'), TEXT)
    const manifest: Record<string, { file: string }> = { [CITE]: { file: 'makarova.txt' } }
    if (extraKey !== undefined) manifest[extraKey] = { file: 'makarova.txt' }
    writeFileSync(join(dir, 'sources.json'), JSON.stringify(manifest))
    const brief = join(root, 'brief.json')
    writeFileSync(brief, JSON.stringify({ citations }))
    return { brief, dir }
  }
  const run = (argv: string[]): { code: number; out: string; err: string } => {
    let out = '', err = ''
    const code = runCitations(argv, { out: s => { out += s }, err: s => { err += s }, now: () => new Date('2026-10-20T00:00:00.000Z') })
    return { code, out, err }
  }
  for (const c of OVER) {
    it(`${c.name} one character over: exit 3, the bound and the length named, median under ${BOUND_MS} ms`, () => {
      const extra = Object.keys(c.sources).find(k => k !== CITE)
      const f = files(c.citations, extra)
      let r = run([f.brief, '--sources', f.dir])
      expect(r.code).toBe(3)
      expect(r.out).toBe('')
      expect(r.err).toMatch(/^verify citations: citation text too long: /)
      expect(r.err).toMatch(extra === undefined ? c.words : /a key of sources\.json is 1025 characters/)
      expect(r.err).toMatch(REFUSAL)
      const t = timed(() => { r = run([f.brief, '--sources', f.dir]) })
      expect(t.median, shown(t)).toBeLessThan(BOUND_MS)
    }, 120_000)
  }
  it(`a 64 KB cite: exit 3, median under ${BOUND_MS} ms`, () => {
    const f = files(ATTACK)
    const t = timed(() => { expect(run([f.brief, '--sources', f.dir]).code).toBe(3) })
    expect(t.median, shown(t)).toBeLessThan(BOUND_MS)
  }, 120_000)
  it('citation text at the bound: the verdict, as the library gives it, and its exit', () => {
    const citations: Citation[] = [
      { id: 'c1', cite: spaced(BOUND), quote: QUOTE },
      { id: 'c2', cite: CITE, case_name: spaced(BOUND), source_key: spaced(BOUND), quote: QUOTE },
      { id: 'c3', cite: `${CITE}, 113`, quote: QUOTE },
    ]
    const f = files(citations, spaced(BOUND))
    const r = run([f.brief, '--sources', f.dir, '--json'])
    expect(r.code).toBe(2)
    const sources: OpinionSources = { [CITE]: { text: TEXT }, [spaced(BOUND)]: { text: TEXT } }
    expect(JSON.parse(r.out)).toEqual(JSON.parse(JSON.stringify(verifyCitations(citations, sources, { now: () => new Date('2026-10-20T00:00:00.000Z') }))))
  }, 120_000)
})
