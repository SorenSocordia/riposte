/**
 * Langfuse: a Riposte verdict as Langfuse scores on a trace, observation, session or dataset run.
 *
 * Shapes from Langfuse's public API (POST /api/public/scores, `CreateScoreRequest`: `name` and `value` required; "Must be
 * passed as string for categorical and text scores, and numeric for boolean and numeric scores. Boolean score values must
 * equal either 1 or 0") and its SDK docs (`langfuse.score.create({...})`; `id` "can be used as an idempotency key to update
 * the score subsequently"; boolean `dataType` is "required, numeric values without data type would be inferred as NUMERIC").
 *
 * Two scores per verdict:
 *   `riposte`       CATEGORICAL  "PASS" | "FAIL" | "INSUFFICIENT_DATA", with the full proof in metadata (the third category
 *                                was "ABSTAIN" before 2026-10-06)
 *   `riposte_pass`  BOOLEAN      1 on PASS, 0 on FAIL, and NOT SENT on INSUFFICIENT_DATA: a can't tell is never a 0
 * Both carry the verdict id and the replay command (in the comment and in metadata). Each score's `id` is derived from
 * the verdict, the score name and the target, so posting the same verdict again updates the same score.
 */
import { createHash } from 'node:crypto'
import { riposteMetadata, riposteRef, type RiposteProof } from './core.js'

export interface LangfuseTarget {
  traceId?: string
  observationId?: string
  sessionId?: string
  datasetRunId?: string
  environment?: string
}

/** One `CreateScoreRequest` body (the subset these adapters send). */
export interface LangfuseScoreBody {
  id: string
  traceId?: string
  observationId?: string
  sessionId?: string
  datasetRunId?: string
  environment?: string
  name: string
  value: string | number
  dataType: 'CATEGORICAL' | 'BOOLEAN'
  comment: string
  metadata: Record<string, unknown>
}

export interface LangfuseOptions {
  /** The categorical score's name; the boolean is `<name>_pass`. Default `riposte`. */
  name?: string
  /** Leave out the boolean score entirely (the categorical one always goes). */
  boolean?: boolean
}

const scoreId = (name: string, p: RiposteProof, t: LangfuseTarget) =>
  `riposte-${createHash('sha256').update([name, p.verdict_id, t.traceId ?? '', t.observationId ?? '', t.sessionId ?? '', t.datasetRunId ?? ''].join('\u0000')).digest('hex').slice(0, 32)}`

/** The score bodies for one verdict. INSUFFICIENT_DATA (can't tell) yields the categorical score only. */
export function langfuseScores(p: RiposteProof, target: LangfuseTarget, opts: LangfuseOptions = {}): LangfuseScoreBody[] {
  if (!target.traceId && !target.sessionId && !target.datasetRunId) {
    throw new Error('a Langfuse score needs a traceId, a sessionId or a datasetRunId')
  }
  const name = opts.name ?? 'riposte'
  const where = Object.fromEntries(Object.entries(target).filter(([, v]) => typeof v === 'string' && v.length > 0)) as LangfuseTarget
  const comment = `${p.summary} Verdict ${p.verdict_id}. Re-run: ${p.replay}`
  const out: LangfuseScoreBody[] = [
    { id: scoreId(name, p, target), ...where, name, value: p.answer, dataType: 'CATEGORICAL', comment, metadata: riposteMetadata(p) },
  ]
  if (opts.boolean !== false && p.answer !== 'INSUFFICIENT_DATA') {
    const bname = `${name}_pass`
    out.push({ id: scoreId(bname, p, target), ...where, name: bname, value: p.answer === 'PASS' ? 1 : 0, dataType: 'BOOLEAN', comment, metadata: riposteRef(p) })
  }
  return out
}

/** The Langfuse JS SDK client's score surface (`new LangfuseClient()` from @langfuse/client): `score.create(body)`. */
export interface LangfuseClientLike { score: { create: (body: LangfuseScoreBody) => unknown } }

export type LangfuseSink =
  | { client: LangfuseClientLike }
  | { baseUrl: string; publicKey: string; secretKey: string; fetch?: typeof fetch }

/**
 * Send the bodies: through an SDK client (remember its `flush()` in short-lived processes), or straight to the REST
 * endpoint with HTTP Basic auth (public key as user name, secret key as password). Throws on a non-2xx answer.
 */
export async function postLangfuseScores(bodies: LangfuseScoreBody[], sink: LangfuseSink): Promise<void> {
  if ('client' in sink) {
    for (const b of bodies) await sink.client.score.create(b)
    return
  }
  const f = sink.fetch ?? fetch
  const url = `${sink.baseUrl.replace(/\/+$/, '')}/api/public/scores`
  const auth = `Basic ${Buffer.from(`${sink.publicKey}:${sink.secretKey}`).toString('base64')}`
  for (const b of bodies) {
    const r = await f(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: auth }, body: JSON.stringify(b) })
    if (!r.ok) throw new Error(`Langfuse refused score ${b.name} (${b.id}): HTTP ${r.status}`)
  }
}
