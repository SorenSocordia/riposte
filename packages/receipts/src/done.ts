/**
 * The "done" check — an agent's claim of completion, verified against the ACTUAL state it claims to have changed.
 *
 * The season's most-cited agent failure is a confident "done" with nothing behind it (fast-jev-compaction issue #65: nine
 * consecutive fabricated "work done" reports after one compaction; Superpowers' "verification-before-completion" is a
 * prompt, i.e. advisory). This makes the check mechanical: the agent states what should now be true, we read the real state
 * (a file, a form store, a record — through a reader the host supplies), and compare deterministically.
 *
 *   PASS    — every expectation holds in the real state
 *   FAIL    — at least one expectation is demonstrably false (the claim was untrue) → HOLD, tell the agent what's actually there
 *   ABSTAIN — the state could not be read, or an expectation is unverifiable → a person looks; the claim is NOT accepted
 *
 * Never accepts a claim it could not check. Deterministic; the only I/O is the host-supplied reader.
 */
import { canonicalize, hashOf } from 'riposte-verify'

export interface Expectation {
  /** where to look: a key the reader understands (a file path, a record id, a form name…) */
  source: string
  /** dotted path inside that source's JSON, e.g. "payments.INV-1042.amount" ("" = the whole value) */
  path: string
  /** what the agent says is now there */
  equals?: unknown
  /** or: that the path exists at all */
  exists?: boolean
  /** numeric tolerance for `equals` on numbers (default 0.005) */
  tolerance?: number
}

export interface DoneClaim {
  /** the agent's own words, recorded verbatim ("Saved the payment for INV-1042") */
  claim: string
  expectations: Expectation[]
}

/** Host-supplied: return the parsed JSON at `source`, or throw if it cannot be read. */
export type StateReader = (source: string) => unknown

export type DoneOutcome = 'PASS' | 'FAIL' | 'ABSTAIN'

export interface ExpectationResult {
  source: string
  path: string
  outcome: DoneOutcome
  expected?: unknown
  actual?: unknown
  detail: string
}

export interface DoneResult {
  outcome: DoneOutcome
  claim: string
  results: ExpectationResult[]
  /** hash of the actual state observed per source — the evidence, replayable against a snapshot */
  observed: Record<string, string>
  /** what to tell the agent (and the user) */
  message: string
}

function getPath(obj: unknown, path: string): { found: boolean; value?: unknown } {
  if (path === '') return { found: true, value: obj }
  let cur: unknown = obj
  for (const key of path.split('.')) {
    if (cur === null || typeof cur !== 'object' || !(key in (cur as Record<string, unknown>))) return { found: false }
    cur = (cur as Record<string, unknown>)[key]
  }
  return { found: true, value: cur }
}

export function checkDone(claim: DoneClaim, read: StateReader): DoneResult {
  const cache = new Map<string, { ok: true; value: unknown } | { ok: false; error: string }>()
  const load = (src: string): { ok: true; value: unknown } | { ok: false; error: string } => {
    if (!cache.has(src)) {
      try { cache.set(src, { ok: true, value: read(src) }) } catch (e) { cache.set(src, { ok: false, error: (e as Error).message }) }
    }
    return cache.get(src)!
  }
  const results: ExpectationResult[] = []
  if (!claim.expectations.length) {
    return { outcome: 'ABSTAIN', claim: claim.claim, results, observed: {}, message: `"${claim.claim}" came with nothing checkable — not accepted as done; state what should now be true.` }
  }
  for (const e of claim.expectations) {
    const st = load(e.source)
    if (!st.ok) { results.push({ source: e.source, path: e.path, outcome: 'ABSTAIN', detail: `could not read ${e.source}: ${st.error}` }); continue }
    const got = getPath(st.value, e.path)
    if (e.exists !== undefined && e.equals === undefined) {
      const ok = got.found === e.exists
      results.push({ source: e.source, path: e.path, outcome: ok ? 'PASS' : 'FAIL', expected: e.exists ? 'present' : 'absent', actual: got.found ? 'present' : 'absent',
        detail: ok ? `${e.path} is ${got.found ? 'present' : 'absent'} as claimed` : `${e.path} is ${got.found ? 'present' : 'absent'}, but the claim says ${e.exists ? 'present' : 'absent'}` })
      continue
    }
    if (e.equals === undefined) { results.push({ source: e.source, path: e.path, outcome: 'ABSTAIN', detail: 'expectation states neither `equals` nor `exists` — unverifiable' }); continue }
    if (!got.found) { results.push({ source: e.source, path: e.path, outcome: 'FAIL', expected: e.equals, actual: undefined, detail: `${e.path} does not exist in ${e.source} — nothing was saved there` }); continue }
    const tol = e.tolerance ?? 0.005
    const ok = typeof e.equals === 'number' && typeof got.value === 'number' ? Math.abs(got.value - e.equals) <= tol : canonicalize(got.value) === canonicalize(e.equals)
    results.push({ source: e.source, path: e.path, outcome: ok ? 'PASS' : 'FAIL', expected: e.equals, actual: got.value,
      detail: ok ? `${e.path} = ${canonicalize(got.value)} as claimed` : `${e.path} is ${canonicalize(got.value)}, not ${canonicalize(e.equals)}` })
  }
  const observed: Record<string, string> = {}
  for (const [src, st] of cache) observed[src] = st.ok ? hashOf(st.value) : `unreadable: ${st.error}`
  const outcome: DoneOutcome = results.some((r) => r.outcome === 'FAIL') ? 'FAIL' : results.some((r) => r.outcome === 'ABSTAIN') ? 'ABSTAIN' : 'PASS'
  const fails = results.filter((r) => r.outcome === 'FAIL')
  const message = outcome === 'PASS'
    ? `Verified: "${claim.claim}" — ${results.length} expectation(s) hold in the real state.`
    : outcome === 'FAIL'
      ? `Not done: "${claim.claim}" is contradicted by the actual state — ${fails.map((f) => f.detail).join('; ')}.`
      : `Could not verify "${claim.claim}" — ${results.filter((r) => r.outcome === 'ABSTAIN').map((r) => r.detail).join('; ')}. Not accepted as done.`
  return { outcome, claim: claim.claim, results, observed, message }
}
