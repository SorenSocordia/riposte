/**
 * Webhooks — async delivery of a verdict event to a caller's endpoint when it records. The managed tier fires these so a
 * customer's system learns of a verdict without polling. Dependency-free: HMAC signing via node:crypto, and the
 * dispatcher is injectable (default global fetch) so it tests without a network.
 *
 * Security by default: when a target has a secret, the POST carries `x-verify-signature: sha256=<hmac>` over the exact
 * JSON body, so the receiver can verify authenticity and reject forgeries. Same convention the well-known providers use.
 */

import { createHmac } from 'node:crypto'
import type { Verdict } from '../verdict/schema.js'

export interface WebhookTarget { url: string; secret?: string }
export interface WebhookEvent { type: 'verdict.recorded'; tenant_id: string; verdict: Verdict }
/** Deliver one event to one target. Best-effort; the service does not block on it. */
export type WebhookDispatcher = (event: WebhookEvent, target: WebhookTarget) => void | Promise<unknown>

/** HMAC-SHA256 of the exact body under the target secret, prefixed `sha256=`. Deterministic. */
export function signPayload(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`
}

/** Default dispatcher: POST the event JSON to the target URL, signed when a secret is present. Uses global fetch. */
export function createFetchDispatcher(opts: { fetch?: (url: string, init?: unknown) => Promise<unknown> } = {}): WebhookDispatcher {
  return async (event: WebhookEvent, target: WebhookTarget): Promise<unknown> => {
    const f = opts.fetch ?? (globalThis as { fetch?: (url: string, init?: unknown) => Promise<unknown> }).fetch
    if (!f) throw new Error('global fetch is not available; pass a fetch to createFetchDispatcher()')
    const body = JSON.stringify(event)
    const headers: Record<string, string> = { 'content-type': 'application/json', 'x-verify-event': event.type }
    if (target.secret) headers['x-verify-signature'] = signPayload(target.secret, body)
    return f(target.url, { method: 'POST', headers, body })
  }
}
