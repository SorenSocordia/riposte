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
import { verifyDeclarative } from '../declarative/evaluate.js'
import { isDeclarativeRuleset } from '../declarative/types.js'
import { lintRuleset } from '../declarative/lint.js'
import { measureRuleset, type LabeledCase } from '../declarative/measure.js'
import { verifyAgainstSource } from '../textmatch/index.js'
import { mineRules, caseTableFromRows } from '../mine/index.js'
import type { MineOptions, MineSchema } from '../mine/types.js'
import { ENGINE_VERSION } from '../version.js'
import { OPENAPI } from './openapi.js'
import { opinionFromJson, twinFromJson, actionCheckFromJson, reconcileFromJson, SurfaceInputError } from './surfaces.js'
import { successionFromJson } from './succession.js'

export interface HttpRequest { method: string; path: string; body?: unknown; headers?: Record<string, string | undefined> }
export interface HttpResponse { status: number; json: unknown }

const ok = (json: unknown): HttpResponse => ({ status: 200, json })
const bad = (message: string): HttpResponse => ({ status: 400, json: { error: message } })
const notFound = (): HttpResponse => ({ status: 404, json: { error: 'not found' } })
const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x)

export function route(req: HttpRequest): HttpResponse {
  const path = req.path.replace(/\/+$/, '') || '/'

  if (req.method === 'GET' && (path === '/v1/health' || path === '/health')) return ok({ status: 'ok', engine_version: ENGINE_VERSION })
  if (req.method === 'GET' && (path === '/v1/openapi.json' || path === '/openapi.json')) return ok(OPENAPI)
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
        const { extraction, ...opts } = b
        return ok(verify(extraction, opts as Parameters<typeof verify>[1]))
      }
      case '/v1/verify/declared': {
        if (!isObj(b.extraction)) return bad('"extraction" object is required')
        if (!isDeclarativeRuleset(b.ruleset)) return bad('a valid declarative "ruleset" (fields + checks) is required')
        return ok(verifyDeclarative(b.extraction, b.ruleset))
      }
      case '/v1/ruleset/lint':
        return ok(lintRuleset(b.ruleset ?? b))
      case '/v1/ruleset/measure': {
        if (!isDeclarativeRuleset(b.ruleset)) return bad('a valid declarative "ruleset" (fields + checks) is required')
        if (!Array.isArray(b.cases)) return bad('a "cases" array of { extraction, label } is required')
        return ok(measureRuleset(b.ruleset, b.cases as LabeledCase[]))
      }
      case '/v1/verify/batch': {
        if (!Array.isArray(b.items)) return bad('"items" array is required')
        return ok(verifyBatch(b.items as BatchItem[]))
      }


      case '/v1/verify/action': {
        if (!isObj(b.action)) return bad('"action" object is required')
        return ok(verifyAction(b.action as unknown as Parameters<typeof verifyAction>[0], isObj(b.sources) ? (b.sources as Parameters<typeof verifyAction>[1]) : {}))
      }
      case '/v1/action/check':
        return ok(actionCheckFromJson(b))
      case '/v1/verify/citations': {
        if (!Array.isArray(b.citations)) return bad('"citations" array is required')
        return ok(verifyCitations(b.citations as unknown as Parameters<typeof verifyCitations>[0], isObj(b.sources) ? (b.sources as Parameters<typeof verifyCitations>[1]) : {}))
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
      default:
        return notFound()
    }
  } catch (e) {
    if (e instanceof SurfaceInputError) return bad(e.message)
    return bad(`verification error: ${(e as Error).message}`)
  }
}
