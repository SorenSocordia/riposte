/**
 * A packed verdict (2026-10-03): the same verdict, smaller, for transport and storage. LOSSLESS.
 *
 * A long invoice's verdict carries one set of claims per line, and each claim repeats the same keys, rule names, abstention
 * texts, field paths and normalization names: a 1,500-line invoice gave a 4.1 MB verdict, about 27 times its input. Cutting
 * that provenance would change the verdict's bytes, and every long verdict already issued would stop replaying byte for byte.
 * Packing changes nothing: `unpackVerdict(packVerdict(v))` is `v`, key for key and byte for byte, so the verdict id, its hash
 * and its replay are untouched. Unpack before verifying, replaying or hashing. For the wire, gzip on top does the rest.
 *
 * Format `riposte.verdict-pack/1`: `{ pack, shapes, strings, verdict }`.
 *   - every object becomes an array ["\u0003<shape>", ...its values], `shapes[shape]` being its key list (in order);
 *   - every string value that occurs at least twice and is at least 6 characters long is listed once in `strings` (in order
 *     of first appearance), and each occurrence becomes "\u0001<index>";
 *   - a string that itself starts with \u0001, \u0002 or \u0003 gets a \u0002 prefix (and loses it on unpack).
 */

export const VERDICT_PACK_FORMAT = 'riposte.verdict-pack/1' as const
export interface PackedVerdict { pack: typeof VERDICT_PACK_FORMAT; shapes: string[][]; strings: string[]; verdict: unknown }

const REF = '\u0001', ESC = '\u0002', OBJ = '\u0003'
const MIN_LEN = 6
const isControl = (s: string): boolean => s.startsWith(REF) || s.startsWith(ESC) || s.startsWith(OBJ)

/** Pack any JSON value (a verdict, a verdict list, an answer that holds verdicts). Deterministic. */
export function packVerdict<T>(value: T): PackedVerdict {
  const count = new Map<string, number>()
  const order: string[] = []
  const scan = (x: unknown): void => {
    if (typeof x === 'string') {
      if (x.length < MIN_LEN) return
      const n = count.get(x)
      if (n === undefined) { count.set(x, 1); order.push(x) } else count.set(x, n + 1)
    } else if (Array.isArray(x)) for (const e of x) scan(e)
    else if (x !== null && typeof x === 'object') for (const v of Object.values(x)) scan(v)
  }
  scan(value)
  const strings = order.filter(s => count.get(s)! >= 2)
  const index = new Map(strings.map((s, i) => [s, i]))
  const shapes: string[][] = []
  const shapeIndex = new Map<string, number>()
  const enc = (x: unknown): unknown => {
    if (typeof x === 'string') {
      const i = index.get(x)
      if (i !== undefined) return `${REF}${i}`
      return isControl(x) ? `${ESC}${x}` : x
    }
    if (Array.isArray(x)) return x.map(v => (v === undefined ? null : enc(v)))
    if (x !== null && typeof x === 'object') {
      const entries = Object.entries(x).filter(([, v]) => v !== undefined)
      const keys = entries.map(([k]) => k)
      const sig = JSON.stringify(keys)
      let s = shapeIndex.get(sig)
      if (s === undefined) { s = shapes.length; shapes.push(keys); shapeIndex.set(sig, s) }
      return [`${OBJ}${s}`, ...entries.map(([, v]) => enc(v))]
    }
    return x
  }
  return { pack: VERDICT_PACK_FORMAT, shapes, strings, verdict: enc(value) }
}

/** The value packed, exactly. Refuses anything that is not a pack of this format, or a reference out of range. */
export function unpackVerdict<T = unknown>(p: unknown): T {
  const P = p as PackedVerdict
  if (p === null || typeof p !== 'object' || P.pack !== VERDICT_PACK_FORMAT || !Array.isArray(P.strings) || !P.strings.every(s => typeof s === 'string')
    || !Array.isArray(P.shapes) || !P.shapes.every(k => Array.isArray(k) && k.every(s => typeof s === 'string'))) {
    throw new TypeError(`not a packed verdict (${VERDICT_PACK_FORMAT}: { pack, shapes, strings, verdict })`)
  }
  const ref = (table: unknown[], raw: string, what: string): number => {
    const i = Number(raw)
    if (!Number.isInteger(i) || i < 0 || i >= table.length) throw new TypeError(`packed verdict: ${what} reference ${JSON.stringify(raw)} is out of range`)
    return i
  }
  const dec = (x: unknown): unknown => {
    if (typeof x === 'string') {
      if (x.startsWith(REF)) return P.strings[ref(P.strings, x.slice(1), 'string')]
      if (x.startsWith(OBJ)) throw new TypeError('packed verdict: an object marker outside an object')
      return x.startsWith(ESC) ? x.slice(1) : x
    }
    if (Array.isArray(x)) {
      const head = x[0]
      if (typeof head === 'string' && head.startsWith(OBJ)) {
        const keys = P.shapes[ref(P.shapes, head.slice(1), 'shape')]!
        if (x.length - 1 !== keys.length) throw new TypeError(`packed verdict: an object of shape ${head.slice(1)} has ${x.length - 1} values for ${keys.length} keys`)
        const o: Record<string, unknown> = {}
        keys.forEach((k, i) => { o[k] = dec(x[i + 1]) })
        return o
      }
      return x.map(dec)
    }
    if (x !== null && typeof x === 'object') throw new TypeError('packed verdict: a bare object inside the packed value')
    return x
  }
  return dec(P.verdict) as T
}
