/**
 * The managed/hosted tier — a STATEFUL service composed AROUND the pure `route()` core, never inside it.
 *
 * The router stays a pure function (testable without a port, deterministic). Everything the hosted product needs that
 * the core deliberately refuses to hold — tenant identity, rate limiting, and a system-of-record — is injected here as
 * interfaces and layered on top:
 *
 *     authenticate → rate-limit → pure route() → auto-record the verdict into the ledger
 *
 * Each concern is an interface with a dependency-free reference implementation, so OSS runs out of the box and a real
 * deployment swaps a DB-backed ledger / a key store / a distributed limiter behind the same shapes. The core's
 * determinism and the dependency-free border are untouched. A happy side effect: once verdicts auto-record, the honesty
 * machinery (overturn rate, per-rule calibration, book-of-record) goes LIVE — served by the stateful reads below.
 */

import { route, type HttpRequest, type HttpResponse } from './router.js'
import type { Ledger } from '../ledger/types.js'
import type { Verdict } from '../verdict/schema.js'
import { renderTenantReport } from '../ledger/report.js'
import { ruleCalibration } from '../ledger/calibration.js'
import type { WebhookTarget, WebhookDispatcher } from './webhooks.js'

export interface AuthResult { tenant_id: string }
/** Resolve a request to a tenant, or null to reject (401). */
export type Authenticator = (req: HttpRequest) => AuthResult | null
/** Decide whether a tenant may proceed; retry_after_seconds populates the 429. */
export interface RateLimiter { check(tenant_id: string): { ok: boolean; retry_after_seconds?: number } }

export interface ServiceOptions {
  /** The book of record. When present, verdicts auto-record and the /v1/ledger/* reads are served. */
  ledger?: Ledger
  /** Resolve tenant from the request (e.g. an API key). Omit for a single-tenant ('default') OSS deployment. */
  authenticate?: Authenticator
  rateLimiter?: RateLimiter
  /** Auto-record verdict-bearing responses. Defaults to true when a ledger is present. */
  record?: boolean
  /** Fire a `verdict.recorded` webhook per recorded verdict. `resolve` maps a tenant to its targets. Best-effort. */
  webhooks?: { resolve: (tenant_id: string) => WebhookTarget[]; dispatch: WebhookDispatcher }
}

export interface Service { handle(req: HttpRequest): HttpResponse }

const json = (status: number, body: unknown): HttpResponse => ({ status, json: body })
const isVerdict = (x: unknown): x is Verdict => !!x && typeof x === 'object' && typeof (x as { verdict_id?: unknown }).verdict_id === 'string'
const isPublicPath = (method: string, path: string): boolean => method === 'GET' && /^\/(v1\/)?(health|openapi\.json)$/.test(path)

export function createService(opts: ServiceOptions = {}): Service {
  const ledger = opts.ledger
  const record = opts.record ?? !!ledger

  return {
    handle(req: HttpRequest): HttpResponse {
      const path = req.path.replace(/\/+$/, '') || '/'
      const pub = isPublicPath(req.method, path)

      let tenant = 'default'
      if (opts.authenticate && !pub) {
        const a = opts.authenticate(req)
        if (!a) return json(401, { error: 'unauthorized' })
        tenant = a.tenant_id
      }

      if (opts.rateLimiter && !pub) {
        const rl = opts.rateLimiter.check(tenant)
        if (!rl.ok) return json(429, { error: 'rate limit exceeded', ...(rl.retry_after_seconds !== undefined ? { retry_after_seconds: rl.retry_after_seconds } : {}) })
      }

      // Stateful reads — only meaningful with a ledger; these are the hosted product's dashboards, in JSON.
      if (ledger && req.method === 'GET') {
        if (path === '/v1/ledger/stats') return json(200, ledger.stats(tenant))
        if (path === '/v1/ledger/report') return json(200, { tenant_id: tenant, markdown: renderTenantReport(ledger, { tenant_id: tenant }) })
        if (path === '/v1/ledger/calibration') return json(200, ruleCalibration(ledger.query({ tenant_id: tenant, reviewed: true })))
      }

      const res = route(req)

      if (record && ledger && res.status === 200) {
        if (isVerdict(res.json)) {
          recordAndNotify(res.json, tenant)
        } else if (res.json && typeof res.json === 'object' && Array.isArray((res.json as { results?: unknown }).results)) {
          for (const v of (res.json as { results: unknown[] }).results) if (isVerdict(v)) recordAndNotify(v, tenant)
        }
      }
      return res
    },
  }

  function recordAndNotify(verdict: Verdict, tenant_id: string): void {
    ledger!.record(verdict, { tenant_id })
    if (opts.webhooks) {
      for (const target of opts.webhooks.resolve(tenant_id)) {
        // Best-effort: never let a webhook failure affect the verdict response.
        try { void opts.webhooks.dispatch({ type: 'verdict.recorded', tenant_id, verdict }, target) } catch { /* swallow */ }
      }
    }
  }
}

/** Reference API-key authenticator: maps an `x-api-key` header value to a tenant. Swap for a key store in production. */
export function apiKeyAuth(keyToTenant: Record<string, string>): Authenticator {
  return (req: HttpRequest): AuthResult | null => {
    const key = req.headers?.['x-api-key']
    if (typeof key === 'string' && Object.prototype.hasOwnProperty.call(keyToTenant, key)) return { tenant_id: keyToTenant[key]! }
    return null
  }
}

/** Reference fixed-window rate limiter. Deterministic given an injected clock; per-tenant counters reset each window. */
export function fixedWindowRateLimiter(opts: { limit: number; windowMs: number; now?: () => number }): RateLimiter {
  const now = opts.now ?? (() => Date.now())
  const buckets = new Map<string, { count: number; resetAt: number }>()
  return {
    check(tenant_id: string) {
      const t = now()
      let b = buckets.get(tenant_id)
      if (!b || t >= b.resetAt) { b = { count: 0, resetAt: t + opts.windowMs }; buckets.set(tenant_id, b) }
      if (b.count >= opts.limit) return { ok: false, retry_after_seconds: Math.ceil((b.resetAt - t) / 1000) }
      b.count++
      return { ok: true }
    },
  }
}
