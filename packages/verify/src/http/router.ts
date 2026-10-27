/**
 * HTTP router for the verifier — a pure `route(request) → response` function so it can be tested without binding a port
 * (the transport in ./serve.ts is a thin node:http wrapper). Dependency-free; JSON in, the standard Verdict proof object
 * out. This is the "run it as a service" surface for developers and on-prem deployments.
 *
 * The managed tier (auth / tenant, rate limiting, and auto-recording every verdict into the Ledger) is built AROUND this
 * pure core in ./service.ts — see createService(). This router stays pure and stateless by design.
 *
 * Three routes speak beyond the Verdict (their JSON adapters live in ./surfaces.ts, shared with the MCP server):
 *   POST /v1/opinion       the courtroom opinion over a supplied chain export: COUNSEL (generated, dismissible), never a VERDICT.
 *   POST /v1/twin          the structured-twin check: {verdict, judgments, twin}; the verdict is a standard VERDICT proof object.
 *   POST /v1/action/check  one proposed tool call at a rung: {verdict, notice, disposition}, what the hold adapters deliver
 *                          (hold / review / surface / record / proceed). Stateless: the rung is the request's (default record).
 *   POST /v1/reconcile     completeness: the book of record (a supplied chain export) against the customer's payment
 *                          population; {report, markdown}. The managed tier reconciles against the caller's own book.
 *   POST /v1/succession/replay  the replay a person reviews before carrying a grant to a new ruleset version, or `check`:
 *                          a signed succession's replay re-performed. Read-only; signing stays offline (verify succession).
 * GET /v1/voice/{workflow} and GET /v1/queue/{workflow} need a book of record and a declared policy, so only the managed
 * tier serves them.
 */

import { verify, verifyBatch, type BatchItem } from '../verify.js'
import { verifyAction } from '../action/index.js'
import { verifyCitations } from '../legal/index.js'
import { citeTooLong, citeTooLongWords } from '../legal/cite-bound.js'
import { verifyDeclarative } from '../declarative/evaluate.js'
import { isDeclarativeRulesetName, resolveDeclarativeRuleset } from '../rulesets/declarative.js'
import { isDeclarativeRuleset, type DeclarativeRuleset } from '../declarative/types.js'
import { lintRuleset } from '../declarative/lint.js'
import { measureRuleset, type LabeledCase } from '../declarative/measure.js'
import { verifyAgainstSource } from '../textmatch/index.js'
import { mineRules, caseTableFromRows } from '../mine/index.js'
import type { MineOptions, MineSchema } from '../mine/types.js'
import { ENGINE_VERSION } from '../version.js'
import { openapiFor } from './openapi.js'
import { opinionFromJson, twinFromJson, actionCheckFromJson, reconcileFromJson, SurfaceInputError } from './surfaces.js'
import { successionFromJson } from './succession.js'
import { replayRequest, replayExit, replayStatus } from '../protocol/replay-case.js'
import { packVerdict } from '../verdict/pack.js'
import { verdictExit, exitHeaders } from '../verdict/exit.js'
import type { Verdict } from '../verdict/schema.js'
import { carriedRulesetNames } from '../protocol/ruleset-names.js'

export interface HttpRequest { method: string; path: string; body?: unknown; headers?: Record<string, string | undefined> }
/**
 * A response. `headers` (2026-10-05): every route that answers with a verdict carries its exit reading
 * (verdict/exit.ts), so a caller that wires the HTTP answer to an action fails closed without parsing the body:
 *   x-verify-gate        PASS | PASS-WITH-OPEN | OPEN | HELD-SUSPECT | FAIL | INSUFFICIENT_DATA
 *   x-verify-exit        0 only on a clean PASS; 1 FAIL or HELD-SUSPECT; 2 PASS-WITH-OPEN, OPEN or INSUFFICIENT_DATA (the CLI's exit)
 *   x-verify-allow-open  "stated", when the body's "allow_open": true turned a 2 into a 0
 * The status stays 200 (a FAIL verdict was always 200: the verification ran), and the body is the verdict, byte for byte as before.
 */
export interface HttpResponse { status: number; json: unknown; headers?: Record<string, string> }

const ok = (json: unknown): HttpResponse => ({ status: 200, json })
/** A verdict answer with the exit headers. `allowOpen`: the body's "allow_open": true (the CLI's --allow-open). */
const okVerdict = (json: unknown, v: Verdict, allowOpen: boolean): HttpResponse => ({ status: 200, json, headers: exitHeaders(verdictExit(v, allowOpen)) })
/** The body's "allow_open": absent is false; anything but a boolean is a 400 (a typo must not fail open). */
function allowOpenOf(b: Record<string, unknown>): boolean | string {
  if (b.allow_open === undefined) return false
  return typeof b.allow_open === 'boolean' ? b.allow_open : '"allow_open" must be true or false'
}
const bad = (message: string): HttpResponse => ({ status: 400, json: { error: message } })
const notFound = (): HttpResponse => ({ status: 404, json: { error: 'not found' } })
const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x)

export function route(req: HttpRequest): HttpResponse {
  const path = req.path.replace(/\/+$/, '') || '/'

  if (req.method === 'GET' && (path === '/v1/health' || path === '/health')) return ok({ status: 'ok', engine_version: ENGINE_VERSION })
  // 2026-10-05: the pure core describes only the routes it serves (no book-of-record routes; openapi.ts openapiFor)
  if (req.method === 'GET' && (path === '/v1/openapi.json' || path === '/openapi.json')) return ok(openapiFor())
  // A workflow's voice needs a book of record and a declared policy: state the pure core does not hold.
  if (req.method === 'GET' && /^\/v1\/voice(\/|$)/.test(path)) {
    return { status: 404, json: { error: 'GET /v1/voice/{workflow} is served by the managed tier (a ledger and a declared promotion policy: createService({ ledger, voice })). Stateless: POST /v1/opinion with your chain export, or the MCP tool voice_assess.' } }
  }
  // The reviewer's queue is drawn from a book of record: the managed tier's.
  if (req.method === 'GET' && /^\/v1\/queue(\/|$)/.test(path)) {
    return { status: 404, json: { error: 'GET /v1/queue/{workflow} is served by the managed tier (a ledger and a declared promotion policy: createService({ ledger, voice })). Offline: reviewQueue(ledger, workflow_id, policy) (src/surveillance).' } }
  }

  if (req.method !== 'POST') return notFound()
  // A co-signature is appended to a book of record: the managed tier's.
  if (path === '/v1/grant/cosign') {
    return { status: 404, json: { error: 'POST /v1/grant/cosign appends to a book of record, which the managed tier holds (createService({ ledger })). Offline: verify grant --cosign <grant_decision_id>.' } }
  }
  const b = req.body
  if (!isObj(b)) return bad('request body must be a JSON object')

  try {
    switch (path) {
      case '/v1/verify': {
        if (!isObj(b.extraction)) return bad('"extraction" object is required')
        const allowOpen = allowOpenOf(b)
        if (typeof allowOpen === 'string') return bad(allowOpen)
        // 2026-10-03: "pack": true answers the same verdict packed (verdict/pack.ts, lossless; unpackVerdict restores it)
        const { extraction, pack, allow_open: _allowOpen, ...opts } = b
        const v = verify(extraction, opts as Parameters<typeof verify>[1])
        return okVerdict(pack === true ? packVerdict(v) : v, v, allowOpen)
      }
      case '/v1/verify/declared': {
        if (!isObj(b.extraction)) return bad('"extraction" object is required')
        // 2026-10-03: "ruleset" may be a name this build carries ("peppol-en16931" = 0.2.0, "peppol-en16931@0.1.0", "e-invoice")
        const named = namedRuleset(b.ruleset)
        if (typeof named === 'string') return bad(named)
        const ruleset = named ?? b.ruleset
        if (!isDeclarativeRuleset(ruleset)) return bad('a valid declarative "ruleset" (fields + checks), or the name of one this build carries, is required')
        // 2026-10-03: the source text, when given, runs the ruleset's quotes (and the caller's quotes/values)
        const allowOpen = allowOpenOf(b)
        if (typeof allowOpen === 'string') return bad(allowOpen)
        const v = verifyDeclarative(b.extraction, ruleset, isObj(b.source) && typeof b.source.text === 'string' ? { source: b.source as { text: string } } : {})
        return okVerdict(b.pack === true ? packVerdict(v) : v, v, allowOpen)
      }
      case '/v1/ruleset/lint': {
        const named = namedRuleset(b.ruleset)
        if (typeof named === 'string') return bad(named)
        return ok(lintRuleset(named ?? b.ruleset ?? b))
      }
      case '/v1/ruleset/measure': {
        const named = namedRuleset(b.ruleset)
        if (typeof named === 'string') return bad(named)
        const ruleset = named ?? b.ruleset
        if (!isDeclarativeRuleset(ruleset)) return bad('a valid declarative "ruleset" (fields + checks), or the name of one this build carries, is required')
        if (!Array.isArray(b.cases)) return bad('a "cases" array of { extraction, label } is required')
        return ok(measureRuleset(ruleset, b.cases as LabeledCase[]))
      }
      case '/v1/verify/batch': {
        if (!Array.isArray(b.items)) return bad('"items" array is required')
        const allowOpen = allowOpenOf(b)
        if (typeof allowOpen === 'string') return bad(allowOpen)
        const r = verifyBatch(b.items as BatchItem[])
        // the batch's exit reading: the worst among its verdicts (any FAIL is 1; else any open or undecided is 2; else 0)
        const readings = r.results.map(v => verdictExit(v, allowOpen))
        const exit = readings.some(d => d.exit === 1) ? 1 : readings.some(d => d.exit === 2) ? 2 : 0
        return { status: 200, json: r, headers: { 'x-verify-gate': readings.find(d => d.exit === exit)?.gate ?? 'PASS', 'x-verify-exit': String(exit), ...(readings.some(d => d.allow_open) ? { 'x-verify-allow-open': 'stated' } : {}) } }
      }


      case '/v1/verify/action': {
        if (!isObj(b.action)) return bad('"action" object is required')
        const allowOpen = allowOpenOf(b)
        if (typeof allowOpen === 'string') return bad(allowOpen)
        const v = verifyAction(b.action as unknown as Parameters<typeof verifyAction>[0], isObj(b.sources) ? (b.sources as Parameters<typeof verifyAction>[1]) : {})
        return okVerdict(v, v, allowOpen)
      }
      case '/v1/action/check':
        return ok(actionCheckFromJson(b))
      case '/v1/verify/citations': {
        if (!Array.isArray(b.citations)) return bad('"citations" array is required')
        // Optional (2026-10-03): "legal@0.1.0" reads quotation conventions; absent = the default for the engine (legal@0.5.4 from 0.7.2, legal@0.5.3 under 0.7.1, legal@0.5.2 under 0.6.0 and 0.7.0, legal@0.0.1 before; defaultLegalRuleset). Unknown → 400.
        if (b.ruleset !== undefined && typeof b.ruleset !== 'string') return bad('"ruleset" must be a string such as "legal@0.1.0"')
        const allowOpen = allowOpenOf(b)
        if (typeof allowOpen === 'string') return bad(allowOpen)
        // 2026-10-20: a cite, case name, source key or text key over the bound (../legal/cite-bound.ts) is refused here, before any
        // pattern reads it and before anything is hashed: 400, naming the bound and the length; never a verdict
        const tooLong = citeTooLong(b.citations, isObj(b.sources) ? b.sources : undefined)
        if (tooLong) return bad(citeTooLongWords(tooLong))
        const v = verifyCitations(b.citations as unknown as Parameters<typeof verifyCitations>[0], isObj(b.sources) ? (b.sources as Parameters<typeof verifyCitations>[1]) : {}, typeof b.ruleset === 'string' ? { ruleset: b.ruleset } : {})
        return okVerdict(v, v, allowOpen)
      }
      case '/v1/verify/quotes': {
        if (typeof b.source_text !== 'string') return bad('"source_text" string is required')
        const quotes = Array.isArray(b.quotes) ? (b.quotes as Parameters<typeof verifyAgainstSource>[1]) : []
        const values = Array.isArray(b.values) ? (b.values as Parameters<typeof verifyAgainstSource>[2]) : []
        return ok(verifyAgainstSource(b.source_text, quotes, values))
      }
      case '/v1/mine': {
        if (!Array.isArray(b.cases)) return bad('a "cases" array of { id, label, fields, lines? } is required')
        if (!isObj(b.schema)) return bad('a "schema" object { approve, fields, lines? } is required')
        const opts: MineOptions = {}
        if (typeof b.max_approved_violation_rate === 'number') opts.maxApprovedViolationRate = b.max_approved_violation_rate
        if (b.thresholds === true) opts.thresholds = true
        return ok(mineRules(caseTableFromRows(b.cases), b.schema as unknown as MineSchema, opts, typeof b.ruleset_id === 'string' ? { id: b.ruleset_id } : {}))
      }
      case '/v1/opinion':
        return ok(opinionFromJson(b))
      case '/v1/twin':
        return ok(twinFromJson(b))
      case '/v1/reconcile':
        return ok(reconcileFromJson(b))
      case '/v1/succession/replay':
        return ok(successionFromJson(b))
      // 2026-10-03: re-perform proof bundles, the CLI's `verify replay` over HTTP (MATCH / DIVERGED / NOT_REPERFORMED / REFUSED).
      // 2026-10-13: x-verify-exit is the replay's exit, as `verify replay` on a folder gives it (0 every case matched, 1 one
      // diverged, 2 one was not re-performed, 3 one was refused; replay-case.ts replayExit), so a caller wired to the header fails
      // closed on a DIVERGED replay. A request that names no bundle is 400, with no exit.
      // 2026-10-19: the status follows the exit too (replay-case.ts replayStatus): 409 when a case diverged or failed, 422 when
      // one was refused, 200 otherwise, so a client or proxy that reads only the status never takes a forgery for a success.
      case '/v1/replay': {
        let r
        try { r = replayRequest(b) } catch (e) { return bad((e as Error).message) }
        const exit = replayExit(r.summary)
        return { status: replayStatus(exit), json: r, headers: { 'x-verify-exit': String(exit) } }
      }
      default:
        return notFound()
    }
  } catch (e) {
    if (e instanceof SurfaceInputError) return bad(e.message)
    return bad(`verification error: ${(e as Error).message}`)
  }
}

/**
 * A declarative ruleset named in a request body (2026-10-03): the carried ruleset when `x` is a name this build carries,
 * an error message when it is a string that is not one (or names a version this build does not carry), undefined when `x` is
 * not a string (an object, or absent).
 */
function namedRuleset(x: unknown): DeclarativeRuleset | string | undefined {
  if (typeof x !== 'string') return undefined
  if (!isDeclarativeRulesetName(x)) return `"ruleset" "${x}" is not a ruleset this build carries by name (${carriedRulesetNames().join(', ')}); pass the ruleset itself as JSON`
  try { return resolveDeclarativeRuleset(x) } catch (e) { return (e as Error).message }
}
