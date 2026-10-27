// The eval-platform scorers (src/scorers): Langfuse score bodies, Braintrust scores, and the riposte-score command the Python
// Inspect scorer calls. Each adapter on a PASS, a FAIL and an INSUFFICIENT_DATA fixture (test/fixtures/sarif/README.md). No network:
// Langfuse sends go to a stub client and a stub fetch.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { replayBundle } from 'riposte-verify'
import {
  braintrustScore, checkOutput, extractionFromOutput, langfuseScores, postLangfuseScores, riposteBraintrustScorer, scoreCommand,
  type CheckResult, type RiposteProof,
} from '../src/index.js'
import { scoreAnswer } from '../src/scorers/core.js'

const fx = (f: string) => JSON.parse(readFileSync(new URL(`./fixtures/sarif/${f}`, import.meta.url), 'utf8'))
const asRequest = (doc: any) => (doc.extraction
  ? { output: doc.extraction, ...(doc.references ? { references: doc.references } : {}), ...(doc.ruleset ? { ruleset: doc.ruleset } : {}) }
  : { output: doc })
const proofOfFixture = (f: string): RiposteProof => {
  const r = checkOutput(asRequest(fx(f)))
  if (r.kind !== 'verdict') throw new Error(`${f}: refused`)
  return r.proof
}
const PASS = proofOfFixture('clean-invoice.json')
const FAIL = proofOfFixture('invoice-over-contract.json')
const FAIL_PAYAPP = proofOfFixture('payapp-retainage.json')
const CANT_TELL = proofOfFixture('invoice-missing-totals.json')

// The vocabulary scan the public export applies (lab only: the scan module is not exported, so this skips there).
const scanUrl = new URL('../../riposte-export-scan.mjs', import.meta.url)
const scan: ((rel: string, buf: Buffer) => string[]) | undefined = existsSync(fileURLToPath(scanUrl))
  ? (await import(scanUrl.href)).scanFile : undefined
const noHouseTerms = (label: string, obj: unknown) => expect(scan!(`emitted/${label}.json`, Buffer.from(JSON.stringify(obj, null, 2)))).toEqual([])

describe('the shared core', () => {
  it('answers PASS, FAIL and INSUFFICIENT_DATA on the fixtures, with the verdict id and the replay command', () => {
    expect([PASS.answer, FAIL.answer, FAIL_PAYAPP.answer, CANT_TELL.answer]).toEqual(['PASS', 'FAIL', 'FAIL', 'INSUFFICIENT_DATA'])
    for (const p of [PASS, FAIL, FAIL_PAYAPP, CANT_TELL]) {
      expect(p.verdict_id).toMatch(/^[0-9a-f]{32}$/)
      expect(p.replay).toBe(`riposte-verify replay riposte-proof-${p.verdict_id}.json`)
      expect(p.proof_file).toBe(`riposte-proof-${p.verdict_id}.json`)
      expect(p.proof?.verdict.verdict_id).toBe(p.verdict_id)
    }
    expect(FAIL.findings.map((f) => [f.rule_id, f.answer])).toContainEqual(['RATE_SUP', 'FAIL'])
    expect(CANT_TELL.findings.every((f) => f.answer === 'INSUFFICIENT_DATA' && f.reason)).toBe(true)
    expect(CANT_TELL.summary).toMatch(/^INSUFFICIENT_DATA: can't tell, .*not a failure\.$/)
    expect(CANT_TELL.coverage.insufficient_data).toBeGreaterThan(0)
    expect('abstain' in CANT_TELL.coverage).toBe(false)
    expect(scoreAnswer('ABSTAIN')).toBe('INSUFFICIENT_DATA') // an older verdict's word still reads as can't tell
    expect(JSON.stringify(CANT_TELL)).not.toContain('ABSTAIN')
    expect(PASS.summary).toBe(`PASS: all ${PASS.coverage.pass} checks held.`)
  })

  it('the inline proof re-performs: the replay bundle MATCHes for every fixture', () => {
    for (const p of [PASS, FAIL, FAIL_PAYAPP, CANT_TELL]) {
      const r = replayBundle(p.proof as any) as { result: string; answer?: string }
      // the engine's replay says the verdict's own word (INSUFFICIENT_DATA since 2026-10-05); the score says it too since 2026-10-06
      expect([r.result, scoreAnswer(r.answer ?? '')]).toEqual(['MATCH', p.answer])
    }
  })

  it('reads JSON text and a fenced block; refuses what is not a document (no verdict, so no verdict id)', () => {
    const doc = fx('invoice-missing-totals.json')
    expect(extractionFromOutput(JSON.stringify(doc))).toEqual({ extraction: doc })
    expect(extractionFromOutput('```json\n' + JSON.stringify(doc) + '\n```')).toEqual({ extraction: doc })
    for (const bad of ['', 'Here is the invoice.', '42', null, 7]) {
      const r = checkOutput({ output: bad })
      expect(r.kind).toBe('refused')
    }
    expect(() => checkOutput({ output: doc, ruleset: 'ap-threeway' as any })).toThrow(/unknown ruleset/)
  })

  it('inlineProof: false leaves the bundle out; the replay command stays', () => {
    const r = checkOutput(asRequest(fx('invoice-over-contract.json')), { inlineProof: false, proofFile: (id) => `proofs/${id}.json` })
    expect(r.kind === 'verdict' && r.proof.proof).toBeUndefined()
    expect(r.kind === 'verdict' && r.proof.replay).toMatch(/^riposte-verify replay proofs\/[0-9a-f]{32}\.json$/)
  })
})

// CreateScoreRequest (Langfuse public API, docs/sources/langfuse-openapi.yml): the documented properties and enums.
const LANGFUSE_PROPS = new Set(['id', 'traceId', 'sessionId', 'observationId', 'datasetRunId', 'name', 'value', 'comment', 'metadata',
  'environment', 'queueId', 'dataType', 'configId', 'source'])
const LANGFUSE_TYPES = new Set(['NUMERIC', 'BOOLEAN', 'CATEGORICAL', 'CORRECTION', 'TEXT'])
function assertLangfuseShape(b: Record<string, unknown>) {
  for (const k of Object.keys(b)) expect(LANGFUSE_PROPS.has(k), `undocumented property ${k}`).toBe(true)
  expect(typeof b.name).toBe('string')
  expect(LANGFUSE_TYPES.has(b.dataType as string)).toBe(true)
  if (b.dataType === 'CATEGORICAL') expect(typeof b.value).toBe('string')
  if (b.dataType === 'BOOLEAN') expect([0, 1]).toContain(b.value)
  expect(typeof b.metadata).toBe('object')
}

describe('Langfuse', () => {
  const target = { traceId: 'trace-1', observationId: 'obs-1' }
  it('PASS: a categorical "PASS" and a boolean 1, both carrying the verdict id and the replay command', () => {
    const s = langfuseScores(PASS, target)
    expect(s.map((b) => [b.name, b.dataType, b.value])).toEqual([['riposte', 'CATEGORICAL', 'PASS'], ['riposte_pass', 'BOOLEAN', 1]])
    for (const b of s) {
      assertLangfuseShape(b as any)
      expect(b.comment).toContain(PASS.verdict_id)
      expect(b.comment).toContain(PASS.replay)
      expect((b.metadata as any).riposte.verdict_id).toBe(PASS.verdict_id)
      expect((b.metadata as any).riposte.replay).toBe(PASS.replay)
      expect([b.traceId, b.observationId]).toEqual(['trace-1', 'obs-1'])
    }
    expect((s[0]!.metadata as any).riposte.proof.verdict.verdict_id).toBe(PASS.verdict_id)
  })
  it('FAIL: "FAIL" and a boolean 0', () => {
    const s = langfuseScores(FAIL, target)
    expect(s.map((b) => [b.dataType, b.value])).toEqual([['CATEGORICAL', 'FAIL'], ['BOOLEAN', 0]])
    s.forEach((b) => assertLangfuseShape(b as any))
  })
  it('INSUFFICIENT_DATA: the categorical score only; no boolean, so never a 0', () => {
    const s = langfuseScores(CANT_TELL, target)
    expect(s.map((b) => [b.name, b.dataType, b.value])).toEqual([['riposte', 'CATEGORICAL', 'INSUFFICIENT_DATA']])
    assertLangfuseShape(s[0] as any)
    expect(s.some((b) => b.value === 0 || b.dataType === 'BOOLEAN')).toBe(false)
  })
  it('ids are idempotency keys: the same verdict and target give the same id, another target another', () => {
    expect(langfuseScores(FAIL, target)[0]!.id).toBe(langfuseScores(FAIL, target)[0]!.id)
    expect(langfuseScores(FAIL, { traceId: 'trace-2' })[0]!.id).not.toBe(langfuseScores(FAIL, target)[0]!.id)
    expect(langfuseScores(FAIL, target)[0]!.id).not.toBe(langfuseScores(FAIL, target)[1]!.id)
    expect(() => langfuseScores(FAIL, { observationId: 'obs-only' })).toThrow(/traceId, a sessionId or a datasetRunId/)
  })
  it('sends through an SDK client or the REST endpoint (Basic auth), and throws on a refusal', async () => {
    const bodies = langfuseScores(FAIL, target)
    const created: unknown[] = []
    await postLangfuseScores(bodies, { client: { score: { create: (b) => { created.push(b) } } } })
    expect(created).toEqual(bodies)
    const calls: { url: string; init: any }[] = []
    const fakeFetch = (async (url: string, init: any) => { calls.push({ url, init }); return { ok: true, status: 200 } }) as unknown as typeof fetch
    await postLangfuseScores(bodies, { baseUrl: 'https://langfuse.example/', publicKey: 'pk-lf-x', secretKey: 'sk-lf-y', fetch: fakeFetch })
    expect(calls.map((c) => [c.url, c.init.method])).toEqual(bodies.map(() => ['https://langfuse.example/api/public/scores', 'POST']))
    expect(calls[0]!.init.headers.authorization).toBe(`Basic ${Buffer.from('pk-lf-x:sk-lf-y').toString('base64')}`)
    expect(JSON.parse(calls[0]!.init.body)).toEqual(bodies[0])
    const refuse = (async () => ({ ok: false, status: 401 })) as unknown as typeof fetch
    await expect(postLangfuseScores(bodies, { baseUrl: 'https://langfuse.example', publicKey: 'a', secretKey: 'b', fetch: refuse })).rejects.toThrow(/HTTP 401/)
  })
})

// autoevals Score (docs/sources/autoevals-js-score.ts): { name: string; score: number | null; metadata?: Record<string, unknown> }
function assertBraintrustShape(s: Record<string, unknown>) {
  expect(Object.keys(s).sort()).toEqual(['metadata', 'name', 'score'])
  expect(typeof s.name).toBe('string')
  expect(s.score === null || (typeof s.score === 'number' && s.score >= 0 && s.score <= 1)).toBe(true)
  expect(typeof s.metadata).toBe('object')
}

describe('Braintrust', () => {
  it('PASS 1, FAIL 0, INSUFFICIENT_DATA null (skipped, never a 0), each with the verdict id and replay in metadata', () => {
    const got = [PASS, FAIL, CANT_TELL].map((p) => braintrustScore(p))
    expect(got.map((s) => s.score)).toEqual([1, 0, null])
    got.forEach((s, i) => {
      assertBraintrustShape(s as any)
      expect((s.metadata as any).riposte.verdict_id).toBe([PASS, FAIL, CANT_TELL][i]!.verdict_id)
      expect((s.metadata as any).riposte.replay).toBe([PASS, FAIL, CANT_TELL][i]!.replay)
    })
  })
  it('a refused output scores null with the reason, and no verdict id', () => {
    const s = braintrustScore({ kind: 'refused', reason: 'the output is not JSON' } satisfies CheckResult)
    assertBraintrustShape(s as any)
    expect(s.score).toBeNull()
    expect((s.metadata as any).riposte).toEqual({ answer: null, refused: 'the output is not JSON' })
  })
  it('the scorer takes Braintrust\'s { input, output, expected, metadata }: references from metadata.riposte_references', () => {
    const doc = fx('invoice-over-contract.json')
    const scorer = riposteBraintrustScorer()
    const s = scorer({ input: 'the invoice text', output: JSON.stringify(doc.extraction), expected: undefined, metadata: { riposte_references: doc.references } })
    expect(s.score).toBe(0)
    expect((s.metadata as any).riposte.verdict_id).toBe(FAIL.verdict_id)
    const noRefs = scorer({ output: doc.extraction })
    expect((noRefs.metadata as any).riposte.verdict_id).not.toBe(FAIL.verdict_id) // fewer inputs: a different check
    expect(riposteBraintrustScorer({ name: 'grounded' })({ output: 'not json' })).toEqual({ name: 'grounded', score: null, metadata: { riposte: { answer: null, refused: 'the output is not JSON' } } })
  })
})

describe('riposte-score (the command the Python scorer calls)', () => {
  it('prints the proof for a request; refused stays exit 0; an unusable request is exit 3', () => {
    const ok = scoreCommand(JSON.stringify({ ...asRequest(fx('invoice-over-contract.json')) }))
    expect(ok.code).toBe(0)
    const parsed = JSON.parse(ok.stdout)
    expect([parsed.kind, parsed.proof.answer, parsed.proof.verdict_id]).toEqual(['verdict', 'FAIL', FAIL.verdict_id])
    expect(JSON.parse(scoreCommand(JSON.stringify({ output: 'nope' })).stdout)).toEqual({ kind: 'refused', reason: 'the output is not JSON' })
    expect(scoreCommand('not json').code).toBe(3)
    expect(scoreCommand('{}').code).toBe(3)
    expect(scoreCommand(JSON.stringify({ output: {}, ruleset: 'nope' })).code).toBe(3)
    expect(JSON.parse(scoreCommand(JSON.stringify({ ...asRequest(fx('clean-invoice.json')), inline_proof: false })).stdout).proof.proof).toBeUndefined()
  })
})

describe.skipIf(!scan)('nothing emitted carries a house term (the export scan, applied to the emitted objects)', () => {
  it('Langfuse, Braintrust and riposte-score output on all three answers', () => {
    for (const [name, p] of [['pass', PASS], ['fail', FAIL], ['payapp', FAIL_PAYAPP], ['cant-tell', CANT_TELL]] as const) {
      noHouseTerms(`langfuse-${name}`, langfuseScores(p, { traceId: 't' }))
      noHouseTerms(`braintrust-${name}`, braintrustScore(p))
    }
    noHouseTerms('score-cli', JSON.parse(scoreCommand(JSON.stringify(asRequest(fx('invoice-missing-totals.json')))).stdout))
  })
})

const scoreBin = fileURLToPath(new URL('../bin/riposte-score.mjs', import.meta.url))
const dirs: string[] = []
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })))
describe.skipIf(!existsSync(scoreBin))('the built bin (bin/riposte-score.mjs)', () => {
  it('runs as a process with a scratch home and no inherited RIPOSTE_* / RECEIPTS_* variables', () => {
    const home = mkdtempSync(join(tmpdir(), 'riposte-score-'))
    dirs.push(home)
    const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('RIPOSTE_') && !k.startsWith('RECEIPTS_'))), HOME: home, USERPROFILE: home }
    const r = spawnSync(process.execPath, [scoreBin], { input: JSON.stringify(asRequest(fx('invoice-missing-totals.json'))), env, encoding: 'utf8', timeout: 30_000, windowsHide: true })
    expect(r.status).toBe(0)
    const out = JSON.parse(r.stdout)
    expect([out.kind, out.proof.answer, out.proof.verdict_id]).toEqual(['verdict', 'INSUFFICIENT_DATA', CANT_TELL.verdict_id])
    expect(pathToFileURL(scoreBin).href).toMatch(/riposte-score\.mjs$/)
  })
})
