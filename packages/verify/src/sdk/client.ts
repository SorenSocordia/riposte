/**
 * Typed SDK client — the adoption surface. `import { createClient }` and every HTTP endpoint is a typed method that
 * returns the real Verdict / result shapes. The transport is injectable: it defaults to global `fetch` against a
 * baseUrl, but a caller (or a test) can pass any `(req) => Promise<{status, json}>` — including one backed by the
 * in-process router/service, which is how we prove the client's request/response shapes match the server exactly.
 *
 * Dependency-free: no HTTP library, no codegen runtime. Non-2xx responses throw a `VerifyError` carrying status + body.
 */

import type { Verdict } from '../verdict/schema.js'
import type { LintResult } from '../declarative/lint.js'
import type { RulesetMeasurement, LabeledCase } from '../declarative/measure.js'
import type { DeclarativeRuleset } from '../declarative/types.js'
import type { LedgerStats } from '../ledger/types.js'
import type { CalibrationReport } from '../ledger/calibration.js'
import type { BatchItem, BatchResult } from '../index.js'

export interface TransportRequest { method: string; path: string; body?: unknown; headers: Record<string, string | undefined> }
export interface TransportResponse { status: number; json: unknown }
export type Transport = (req: TransportRequest) => Promise<TransportResponse>

export class VerifyError extends Error {
  constructor(public readonly status: number, public readonly body: unknown) {
    super(`verify API error ${status}: ${typeof (body as { error?: unknown })?.error === 'string' ? (body as { error: string }).error : JSON.stringify(body)}`)
    this.name = 'VerifyError'
  }
}

export interface ClientOptions {
  /** Base URL for the default fetch transport (ignored when a custom transport is supplied). */
  baseUrl?: string
  /** Sent as the `x-api-key` header on every request (managed tier). */
  apiKey?: string
  /** Override the transport — defaults to global fetch. Inject the in-process handler for tests/embedding. */
  transport?: Transport
}

function fetchTransport(baseUrl: string): Transport {
  return async (req: TransportRequest): Promise<TransportResponse> => {
    const f = (globalThis as { fetch?: (url: string, init?: unknown) => Promise<{ status: number; json(): Promise<unknown> }> }).fetch
    if (!f) throw new Error('global fetch is not available in this runtime; pass a `transport` to createClient()')
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers[k] = v
    const r = await f(baseUrl.replace(/\/+$/, '') + req.path, {
      method: req.method,
      headers,
      body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
    })
    return { status: r.status, json: await r.json().catch(() => null) }
  }
}

export interface VerifyClient {
  health(): Promise<{ status: string; engine_version: string }>
  verify(extraction: Record<string, unknown>, options?: Record<string, unknown>): Promise<Verdict>
  verifyDeclared(extraction: Record<string, unknown>, ruleset: DeclarativeRuleset): Promise<Verdict>
  verifyBatch(items: BatchItem[]): Promise<BatchResult>
  verifyAction(action: Record<string, unknown>, sources?: Record<string, unknown>): Promise<Verdict>
  verifyCitations(citations: unknown[], sources?: Record<string, unknown>): Promise<Verdict>
  lintRuleset(ruleset: unknown): Promise<LintResult>
  measureRuleset(ruleset: DeclarativeRuleset, cases: LabeledCase[]): Promise<RulesetMeasurement>
  ledgerStats(): Promise<LedgerStats>
  ledgerReport(): Promise<{ tenant_id: string; markdown: string }>
  ledgerCalibration(): Promise<CalibrationReport>
}

export function createClient(opts: ClientOptions = {}): VerifyClient {
  const transport = opts.transport ?? fetchTransport(opts.baseUrl ?? 'http://localhost:8080')
  const headers = (): Record<string, string | undefined> => ({ 'content-type': 'application/json', ...(opts.apiKey ? { 'x-api-key': opts.apiKey } : {}) })

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await transport({ method, path, body, headers: headers() })
    if (res.status < 200 || res.status >= 300) throw new VerifyError(res.status, res.json)
    return res.json as T
  }

  return {
    health: () => call('GET', '/v1/health'),
    verify: (extraction, options) => call('POST', '/v1/verify', { extraction, ...(options ?? {}) }),
    verifyDeclared: (extraction, ruleset) => call('POST', '/v1/verify/declared', { extraction, ruleset }),
    verifyBatch: (items) => call('POST', '/v1/verify/batch', { items }),
    verifyAction: (action, sources) => call('POST', '/v1/verify/action', { action, ...(sources ? { sources } : {}) }),
    verifyCitations: (citations, sources) => call('POST', '/v1/verify/citations', { citations, ...(sources ? { sources } : {}) }),
    lintRuleset: (ruleset) => call('POST', '/v1/ruleset/lint', { ruleset }),
    measureRuleset: (ruleset, cases) => call('POST', '/v1/ruleset/measure', { ruleset, cases }),
    ledgerStats: () => call('GET', '/v1/ledger/stats'),
    ledgerReport: () => call('GET', '/v1/ledger/report'),
    ledgerCalibration: () => call('GET', '/v1/ledger/calibration'),
  }
}
