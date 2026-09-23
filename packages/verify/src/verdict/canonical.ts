/**
 * Canonicalization + hashing — the determinism contract's mechanics.
 *
 * canonicalize() produces a byte-stable JSON string for any input:
 *  - object keys sorted recursively; arrays keep order
 *  - `undefined` properties dropped; `undefined` array elements become null
 *  - Date → ISO-8601 string (invalid Date → null)
 *  - non-finite numbers → null; bigint → decimal string
 * Two inputs that differ only in key order or in `undefined` vs absent hash identically.
 */

import { createHash } from 'node:crypto'

export function canonicalize(value: unknown): string {
  return JSON.stringify(normalize(value))
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export function hashOf(value: unknown): string {
  return sha256(canonicalize(value))
}

function normalize(v: unknown): unknown {
  if (v === undefined || v === null) return v === undefined ? undefined : null
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString()
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'bigint') return v.toString()
  if (typeof v === 'string' || typeof v === 'boolean') return v
  if (Array.isArray(v)) {
    return v.map(x => {
      const n = normalize(x)
      return n === undefined ? null : n
    })
  }
  if (typeof v === 'object') {
    const src = v as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(src).sort()) {
      const n = normalize(src[k])
      if (n !== undefined) out[k] = n
    }
    return out
  }
  // functions, symbols: not data
  return null
}
