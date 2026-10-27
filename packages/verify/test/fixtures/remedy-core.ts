/**
 * The core a frozen golden was taken on (2026-10-02). Typed remedies are additive and sit outside the verdict's hashed core
 * (src/verdict/remedy.ts): every verdict-shaped object (a `verdict_id` and `claims`) loses its `remedies` key, and nothing
 * else changes, so a golden frozen before remedies existed still pins every other byte. The goldens' hashes are NOT re-pinned:
 * they hold on the core, which is the proof that remedies changed nothing but themselves.
 */
const isPlain = (x: unknown): x is Record<string, unknown> => {
  if (x === null || typeof x !== 'object' || Array.isArray(x)) return false
  const p = Object.getPrototypeOf(x)
  return p === Object.prototype || p === null
}

export function coreOf<T>(x: T): T {
  if (Array.isArray(x)) return x.map(coreOf) as unknown as T
  if (!isPlain(x)) return x
  const isVerdict = typeof x.verdict_id === 'string' && Array.isArray(x.claims)
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(x)) {
    if (isVerdict && k === 'remedies') continue
    out[k] = coreOf(v)
  }
  return out as T
}
