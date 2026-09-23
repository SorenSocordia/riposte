/**
 * Deterministic option-order schedules. A flip probe is only evidence if anyone can re-run it and get the same
 * orders — so no Math.random: a seeded PRNG keyed by (seed, question name), identity first, reversal second.
 */
import { createHash } from 'node:crypto'

function seed32(text: string): number {
  return createHash('sha256').update(text, 'utf8').digest().readUInt32LE(0)
}

/** mulberry32 — tiny, fast, deterministic. */
function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * `count` orderings of `keys`: [identity, reversed, ...seeded shuffles], de-duplicated where the option count makes
 * duplicates unavoidable (e.g. 2 options have only 2 orders). Same inputs -> same schedule, always.
 */
export function orderSchedule(keys: string[], count: number, seed: string): string[][] {
  const out: string[][] = []
  const seen = new Set<string>()
  const push = (o: string[]): void => {
    const k = o.join('\u0000')
    if (!seen.has(k)) { seen.add(k); out.push(o) }
  }
  push([...keys])
  if (count > 1) push([...keys].reverse())
  const rand = prng(seed32(`${seed}\u0000${keys.join('\u0000')}`))
  let guard = 0
  while (out.length < count && guard++ < count * 20) {
    const o = [...keys]
    for (let i = o.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[o[i], o[j]] = [o[j] as string, o[i] as string]
    }
    push(o)
  }
  return out
}

/** Rebuild a criteria object with its keys in `order` (JS objects preserve string-key insertion order). */
export function reorder<T>(criteria: Record<string, T>, order: string[]): Record<string, T> {
  const out: Record<string, T> = {}
  for (const k of order) out[k] = criteria[k] as T
  return out
}
