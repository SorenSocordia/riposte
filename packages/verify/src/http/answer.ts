/**
 * What the transport does with a request once its body has arrived (2026-10-06): read the body under the hash contract, route
 * it, and turn a refusal or a throw into an answer. Shared by the transport's own thread (serve.ts nodeHandler, for a dispatcher
 * a caller supplies) and by the check worker (./check-worker.ts, for `verify serve`), so both answer the same body the same way.
 * Pure: no node:http, no file system.
 */

import type { HttpRequest, HttpResponse } from './router.js'
import { decodeUtf8Strict, parseJsonStrict, HashInputRefused, INEXACT_NUMBER_WORDS, TOO_DEEP_WORDS } from '../protocol/hash-input.js'
import { replayAdvice } from '../protocol/replay-case.js'

/**
 * The words for a body sent as UTF-16 (2026-10-13; a cold reader sent one with charset=utf-16 and got "invalid JSON body",
 * the encoding never named). `what` says how it shows: a UTF-16 byte-order mark, or NUL characters between the others.
 */
const utf16Words = (what: string): string => `the request body ${what}, as UTF-16 text does: send UTF-8 (this server reads a body as UTF-8 JSON only; re-encode it and send it again)`

/** A request as the transport hands it on: everything but the body, which comes as bytes (or none). */
export interface RequestMeta { method: string; path: string; headers: Record<string, string | undefined> }

/** Adds `code` to a body when the server answers with stable codes (TransportOptions.errorCodes); else the body as is. */
export type Coder = <T extends object>(code: string, body: T) => T

export const coderFor = (errorCodes: boolean | undefined): Coder => <T extends object>(code: string, body: T): T => (errorCodes ? { ...body, code } : body)

/**
 * The code for a body the hash contract refused (2026-10-05, 2026-10-06): `body.invalid_json` (the parser's own words are not
 * echoed), `body.duplicate_key`, `body.non_finite_number`, `body.inexact_number`, `body.too_deep`.
 */
function refusalCode(e: unknown): string {
  if (!(e instanceof HashInputRefused)) return 'body.invalid_json'
  const m = e.message
  return / appears twice /.test(m) ? 'body.duplicate_key' : / is not finite/.test(m) ? 'body.non_finite_number'
    : m.includes(INEXACT_NUMBER_WORDS) ? 'body.inexact_number' : m.includes(TOO_DEEP_WORDS) ? 'body.too_deep' : 'body.invalid_json'
}

/**
 * Answer one request whose body (possibly empty) has arrived: decode it as strict UTF-8, parse it under the hash contract
 * (a 400 naming where, never a verdict), dispatch it, and answer a throw from the dispatcher with a 500 for this request only.
 */
export function answerBody(bytes: Uint8Array | undefined, meta: RequestMeta, dispatch: (req: HttpRequest) => HttpResponse, coded: Coder): HttpResponse {
  let body: unknown
  if (bytes !== undefined && bytes.length > 0) {
    let raw: string
    // 2026-10-13: a UTF-16 body is named as one, by its byte-order mark, before the UTF-8 decoder names its first bad byte
    if (bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))) {
      return { status: 400, json: coded('body.invalid_utf8', { error: utf16Words(`starts with a UTF-16 byte-order mark (${bytes[0] === 0xff ? 'FF FE' : 'FE FF'})`) }) }
    }
    try { raw = decodeUtf8Strict(bytes, 'the request body') } catch (e) { return { status: 400, json: coded('body.invalid_utf8', { error: (e as Error).message }) } }
    // a NUL is never valid in JSON text (inside a string it must be written \u0000), and UTF-16 read as UTF-8 is full of them
    if (raw.includes('\u0000')) return { status: 400, json: coded('body.invalid_utf8', { error: utf16Words('holds NUL characters') }) }
    try { body = parseJsonStrict(raw, 'the request body') } catch (e) {
      // 2026-10-13: on POST /v1/replay a refusal says what is true of a replay (re-issue the verdict; replay-case.ts replayAdvice)
      const words = e instanceof HashInputRefused ? (meta.path.replace(/\/+$/, '') === '/v1/replay' ? replayAdvice(e.message) : e.message) : 'invalid JSON body'
      return { status: 400, json: coded(refusalCode(e), { error: words }) }
    }
  }
  try {
    return dispatch({ method: meta.method, path: meta.path, body, headers: meta.headers } satisfies HttpRequest)
  } catch {
    // A crash in the router or the service answers this request only; the process and every other request stay up.
    return { status: 500, json: coded('internal', { error: 'internal error' }) }
  }
}
