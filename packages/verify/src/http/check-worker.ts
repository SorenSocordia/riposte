/**
 * The check worker (2026-10-06): one worker thread of `verify serve`'s check pool (./budget.ts). It reads a request's body under
 * the hash contract, routes it through the pure core, and posts the answer back as JSON text. The pool stops it when the check
 * runs past its time budget, and the runtime stops it when it passes its heap budget; either way only this thread ends, and the
 * thread that answers requests stays up.
 */

import { parentPort } from 'node:worker_threads'
import { route, type HttpRequest, type HttpResponse } from './router.js'
import { answerBody, coderFor, type RequestMeta } from './answer.js'

/** What the pool sends: a body as bytes (read, then routed), or a request already read (routed only). */
export type CheckJob =
  | { id: number; kind: 'bytes'; meta: RequestMeta; bytes: Uint8Array | undefined; errorCodes: boolean }
  | { id: number; kind: 'request'; req: HttpRequest; errorCodes: boolean }

/** What the worker posts back: the answer, its body already serialized. `{ ready: true }` once, when it can take a job. */
export interface CheckAnswer { id: number; status: number; headers?: Record<string, string>; text: string }

function answer(job: CheckJob): CheckAnswer {
  const coded = coderFor(job.errorCodes)
  let r: HttpResponse
  if (job.kind === 'bytes') r = answerBody(job.bytes, job.meta, route, coded)
  else {
    try { r = route(job.req) } catch { r = { status: 500, json: coded('internal', { error: 'internal error' }) } }
  }
  let status = r.status
  let text: string
  try {
    text = JSON.stringify(r.json)
    if (typeof text !== 'string') throw new TypeError('not serializable')
  } catch {
    status = 500
    text = JSON.stringify(coded('internal', { error: 'internal error: the response could not be serialized' }))
  }
  return { id: job.id, status, ...(r.headers ? { headers: r.headers } : {}), text }
}

const port = parentPort
if (port) {
  port.on('message', (job: CheckJob) => { port.postMessage(answer(job)) })
  port.postMessage({ ready: true })
}
