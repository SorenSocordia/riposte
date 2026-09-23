/**
 * The `/v1/systemone` wire shape — TypeSafe's System One API, also served by the Apache-2.0 open reproductions
 * (Kev, laya, litjev, simple-jev). Typed questions over one shared `state`; typed answers with probabilities.
 *
 * Receipts never trains on or benchmarks a provider it may not; the transport is injectable so the same code runs
 * against a local open model, a hosted API the caller is licensed to use, or a test double.
 */

export interface ChoiceQuestion {
  type: 'choice'
  instructions: string
  /** option key -> optional description. KEY ORDER IS PART OF THE PROMPT — which is exactly what the flip probe tests. */
  criteria: Record<string, string | null>
}
export interface NoulQuestion {
  type: 'noul'
  instructions: string
}
export interface ScoreQuestion {
  type: 'score'
  instructions: string
  /** ordered scale labels, low -> high */
  criteria: string[]
}
export type Question = ChoiceQuestion | NoulQuestion | ScoreQuestion

export interface SystemOneRequest {
  state: string
  model?: string
  questions: Record<string, Question>
}

export interface ChoiceAnswer {
  type: 'choice'
  choice: string
  confidence?: number
  probabilities: Record<string, number>
}
export interface NoulAnswer {
  type: 'noul'
  /** P(yes) */
  noul: number
}
export interface ScoreAnswer {
  type: 'score'
  score: number
  confidence?: number
  probabilities?: Record<string, number>
  legend?: Record<string, string>
}
export type Answer = ChoiceAnswer | NoulAnswer | ScoreAnswer

export interface SystemOneResponse {
  model: string
  answers: Record<string, Answer>
  usage?: { input_tokens?: number; output_tokens?: number }
  latency_ms?: number
}

/** Anything that turns a request into a response. HTTP, in-process, or a test double. */
export type Transport = (req: SystemOneRequest) => Promise<SystemOneResponse>

export interface HttpTransportOptions {
  apiKey?: string
  /** Injectable for tests and non-Node runtimes. Defaults to global fetch. */
  fetchImpl?: typeof fetch
  /** Path appended to baseUrl. Defaults to '/v1/systemone'. */
  path?: string
}

/** A transport for any `/v1/systemone`-compatible server (e.g. `python -m kev.serve --port 8009`). */
export function httpTransport(baseUrl: string, opts: HttpTransportOptions = {}): Transport {
  const f = opts.fetchImpl ?? fetch
  const url = baseUrl.replace(/\/$/, '') + (opts.path ?? '/v1/systemone')
  return async (req) => {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (opts.apiKey) headers.authorization = `Bearer ${opts.apiKey}`
    const res = await f(url, { method: 'POST', headers, body: JSON.stringify(req) })
    if (!res.ok) throw new Error(`systemone ${res.status}: ${(await res.text()).slice(0, 300)}`)
    return (await res.json()) as SystemOneResponse
  }
}

/** Confidence of the decided answer: P(chosen) for choice, max(p, 1-p) for noul, reported confidence for score. */
export function decisionConfidence(a: Answer): number | undefined {
  if (a.type === 'choice') return a.probabilities[a.choice] ?? a.confidence
  if (a.type === 'noul') return Math.max(a.noul, 1 - a.noul)
  return a.confidence
}
