/**
 * The hash contract's front door (2026-10-05). A verdict is bound to its inputs by input_hash, which is sha256
 * over the canonical JSON of the inputs as PARSED (verdict/canonical.ts). Two inputs that differ must never share that hash. Two
 * kinds of input broke that before this module existed, both measured by an outside engineer:
 *
 *   - text that is not valid UTF-8. The CLI read files with readFileSync(path, 'utf8'), which replaces every invalid byte with
 *     U+FFFD before anything is hashed, so source files ending in 0xFF, in 0xFE and in the valid bytes EF BF BD (U+FFFD itself)
 *     issued the same input_hash and the same verdict_id;
 *   - a JSON number outside the double range. JSON.parse reads 1e999 as Infinity and -1e999 as -Infinity, and canonicalize writes
 *     every non-finite number as null, so an extraction with `1e999`, one with `-1e999` and one with `null` shared one input_hash,
 *     and one verdict_id named two different engine outputs.
 *
 * Neither input can be hashed faithfully, so both are REFUSED here, before hashing, with the place named: the byte offset of the
 * first invalid UTF-8 sequence, the JSON path of the first non-finite number. canonicalize itself is unchanged, so every input
 * that was accepted before hashes exactly as it did.
 *
 * A third kind (2026-10-05; a cold reader's duplicate-key envelope, cold review round 2): JSON text with the same key twice in
 * one object. JSON.parse keeps the LAST, so a file whose bytes say `"outcome":"FAIL"` and then `"outcome":"PASS"` was hashed,
 * replayed and signature-checked as PASS, while any reader that keeps the first (or rejects duplicates) saw FAIL. The signature
 * covers the parsed object, not the file, so two readers disagreed about what was attested. parseJsonStrict now refuses such
 * text, naming the JSON path of the first repeated key (duplicateKeyPath). It is the reader for every JSON input that feeds a
 * hash or a signature check: the CLI's files and inline JSON, a folder or .jsonl of bundles, the HTTP body, the MCP line.
 *
 * A fourth kind (2026-10-05; an outside engineer's invoice): a JSON number whose text names a value a double
 * cannot hold. JSON.parse reads `9007199254740993` as 9007199254740992, so a bill with that unit price and an amount of
 * 9007199254740992 passed its line check, and the verdict recorded a figure the file does not hold. parseJsonStrict now
 * refuses a number token whose exact decimal is not the decimal of the double it parses to (numberTextIsExact: `6125`, `6125.0`,
 * `6.125e3` and `-0` are exact; an integer past 2^53 that rounds, a decimal that loses digits, an underflow to 0 are not),
 * naming its path and saying "a number that cannot be represented exactly; write amounts as strings with two decimals". A
 * library caller hands over numbers already parsed, with no text to compare: from engine 0.6.0 verify() and verifyDeclarative()
 * refuse a number past 2^53 − 1 in magnitude (unsafeMagnitudePath), which may already have been rounded.
 *
 * Pure: no file system and no Node-only API (TextDecoder is in every runtime), so the evaluator and the browser playground can use
 * it. The CLI reads the bytes and hands them here (cli.ts readText / readJson).
 */

/** An input the hash contract cannot bind faithfully. `where` is a byte offset (text) or a JSON path (numbers). */
export class HashInputRefused extends Error {
  readonly where: string
  constructor(message: string, where: string) {
    super(message)
    this.name = 'HashInputRefused'
    this.where = where
  }
}

/**
 * The byte offset of the first invalid UTF-8 sequence in `bytes`, or -1 when they are valid UTF-8. Invalid means what the WHATWG
 * decoder rejects: a stray continuation byte, a lead byte without its continuations (truncated at the end too), an overlong form,
 * an encoded surrogate (U+D800..U+DFFF), or a code point above U+10FFFF.
 */
export function invalidUtf8Offset(bytes: Uint8Array): number {
  const n = bytes.length
  let i = 0
  while (i < n) {
    const b = bytes[i] as number
    if (b < 0x80) { i++; continue }
    let need: number, min: number, max: number
    if (b >= 0xc2 && b <= 0xdf) { need = 1; min = 0x80; max = 0xbf }
    else if (b === 0xe0) { need = 2; min = 0xa0; max = 0xbf }
    else if (b === 0xed) { need = 2; min = 0x80; max = 0x9f } // no surrogates
    else if (b >= 0xe1 && b <= 0xef) { need = 2; min = 0x80; max = 0xbf }
    else if (b === 0xf0) { need = 3; min = 0x90; max = 0xbf }
    else if (b === 0xf4) { need = 3; min = 0x80; max = 0x8f } // nothing above U+10FFFF
    else if (b >= 0xf1 && b <= 0xf3) { need = 3; min = 0x80; max = 0xbf }
    else return i // 0x80..0xC1 (a stray continuation or an overlong lead) and 0xF5..0xFF never start a sequence
    if (i + need >= n) return i // truncated: the sequence runs past the end
    const second = bytes[i + 1] as number
    if (second < min || second > max) return i
    for (let k = 2; k <= need; k++) {
      const c = bytes[i + k] as number
      if (c < 0x80 || c > 0xbf) return i
    }
    i += need + 1
  }
  return -1
}

const DECODER = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

/**
 * Decode `bytes` as UTF-8, refusing anything that is not valid UTF-8 (HashInputRefused naming the byte offset). A byte-order mark
 * is KEPT as U+FEFF, exactly as readFileSync(path, 'utf8') kept it, so the text of every valid file, and its hash, is unchanged.
 * `name` is how the message names the input (a path, or "--source").
 */
export function decodeUtf8Strict(bytes: Uint8Array, name: string): string {
  const at = invalidUtf8Offset(bytes)
  if (at >= 0) {
    const shown = Array.from(bytes.subarray(at, Math.min(at + 4, bytes.length)), b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')
    throw new HashInputRefused(
      `${name} is not valid UTF-8: the bytes at offset ${at} (${shown}) are not a UTF-8 character. A text input is hashed as UTF-8, and decoding ` +
      'would replace those bytes with U+FFFD, so two different files would share one input_hash. Re-save the file as UTF-8 (or fix the byte), then run it again',
      `byte ${at}`,
    )
  }
  return DECODER.decode(bytes)
}

/** True when the text starts with a UTF-8 byte-order mark (decoded: U+FEFF). */
export const startsWithBom = (text: string): boolean => text.charCodeAt(0) === 0xfeff

/** A JSON path segment: `.key` for an identifier, `["key"]` otherwise, `[i]` for an array index. */
function pathStep(path: string, key: string | number): string {
  if (typeof key === 'number') return `${path}[${key}]`
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`
}

/**
 * The JSON path (`$.lines[2].amount`) of the first number in `value` that is not finite (Infinity, -Infinity, NaN), or undefined.
 * Walks plain objects and arrays in their own key order; a value seen twice (a cycle, a shared object) is walked once.
 */
export function nonFinitePath(value: unknown, root = '$'): string | undefined {
  return firstNumberPath(value, n => !Number.isFinite(n), root)
}

/**
 * The JSON path of the first number in `value` whose magnitude is past 2^53 − 1 (Number.MAX_SAFE_INTEGER), or undefined
 * (2026-10-05). Past it a double cannot hold every whole number: 9007199254740993 parses to 9007199254740992.
 * A caller of the library hands over numbers already parsed, so the text they came from cannot be compared (inexactNumberPath
 * does that for text); a number this large may already have been rounded, and is refused (verify.ts assertHashableInputs).
 */
export function unsafeMagnitudePath(value: unknown, root = '$'): string | undefined {
  return firstNumberPath(value, n => Number.isFinite(n) && Math.abs(n) > Number.MAX_SAFE_INTEGER, root)
}

/** The path of the first number in `value` for which `bad` holds (plain objects and arrays, own key order, each value once). */
function firstNumberPath(value: unknown, bad: (n: number) => boolean, root: string): string | undefined {
  const seen = new Set<object>()
  const walk = (v: unknown, path: string): string | undefined => {
    if (typeof v === 'number') return bad(v) ? path : undefined
    if (v === null || typeof v !== 'object') return undefined
    if (seen.has(v)) return undefined
    seen.add(v)
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) { const p = walk(v[i], pathStep(path, i)); if (p !== undefined) return p }
      return undefined
    }
    if (v instanceof Date) return undefined
    for (const k of Object.keys(v)) { const p = walk((v as Record<string, unknown>)[k], pathStep(path, k)); if (p !== undefined) return p }
    return undefined
  }
  return walk(value, root)
}

/** The refusal for a non-finite number at `path` of the input `name` (one wording, for the CLI and the library). */
export function nonFiniteRefusal(name: string, path: string, value?: unknown): HashInputRefused {
  const shown = typeof value === 'number' ? ` (${String(value)})` : ''
  return new HashInputRefused(
    `${name}: the number at ${path} is not finite${shown}: JSON reads a number past the double range (1e999) as Infinity, and the hash ` +
    'writes every non-finite number as null, so it could not be told from null or from its negative. Write it as a finite number, ' +
    'or as a string the ruleset reads, then run it again',
    path,
  )
}

/** The value at a path nonFinitePath or unsafeMagnitudePath returned (for the message only). */
export const valueAtPath = (value: unknown, path: string): unknown => valueAt(value, path)

function valueAt(value: unknown, path: string): unknown {
  const steps = [...path.slice(1).matchAll(/\.([A-Za-z_$][\w$]*)|\[(\d+)\]|\[("(?:[^"\\]|\\.)*")\]/g)]
  let cur: unknown = value
  for (const m of steps) {
    const key = m[1] ?? (m[2] !== undefined ? Number(m[2]) : JSON.parse(m[3] as string) as string)
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string | number, unknown>)[key]
  }
  return cur
}

/** Throw HashInputRefused when `value` holds a non-finite number; `name` names the input in the message. */
export function assertFiniteNumbers(value: unknown, name: string): void {
  const p = nonFinitePath(value)
  if (p !== undefined) throw nonFiniteRefusal(name, p, valueAt(value, p))
}

/** The words every refusal of an inexact number carries (one wording, for the CLI, the library, HTTP and MCP). */
export const INEXACT_NUMBER_WORDS = 'a number that cannot be represented exactly; write amounts as strings with two decimals'

/** The refusal for a parsed number at `path` whose magnitude is past 2^53 − 1 (unsafeMagnitudePath). */
export function unsafeMagnitudeRefusal(name: string, path: string, value?: unknown): HashInputRefused {
  const shown = typeof value === 'number' ? ` (${String(value)})` : ''
  return new HashInputRefused(
    `${name}: the number at ${path}${shown} is ${INEXACT_NUMBER_WORDS}. Past 9007199254740991 (2^53 - 1) a double cannot hold every ` +
    'whole number, so this one may already have been rounded when it was parsed, and the hash and every check would read the rounded ' +
    'figure. Then run it again',
    path,
  )
}

/** Throw HashInputRefused when `value` holds a number past 2^53 − 1 in magnitude; `name` names the input in the message. */
export function assertSafeMagnitudes(value: unknown, name: string): void {
  const p = unsafeMagnitudePath(value)
  if (p !== undefined) throw unsafeMagnitudeRefusal(name, p, valueAt(value, p))
}

/** A JSON number token: sign, integer digits, fraction digits, exponent. Leading zeros are tolerated here (JSON.parse has refused them). */
const NUMBER_TOKEN = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/

/**
 * The exact decimal a number's text names, reduced: its sign, its significant digits (no leading or trailing zeros) and the
 * power of ten of the last digit. `'zero'` for any spelling of zero, either sign; undefined when the text is not a number token.
 */
function reducedDecimal(text: string): { neg: boolean; digits: string; exp: number } | 'zero' | undefined {
  const m = NUMBER_TOKEN.exec(text)
  if (!m) return undefined
  const frac = m[3] ?? ''
  let digits = `${m[2]}${frac}`.replace(/^0+/, '')
  if (digits === '') return 'zero'
  let exp = (m[4] === undefined ? 0 : Number(m[4])) - frac.length
  const zeros = /0+$/.exec(digits)
  if (zeros) { exp += zeros[0].length; digits = digits.slice(0, digits.length - zeros[0].length) }
  return { neg: m[1] === '-', digits, exp }
}

/**
 * True when the decimal a number's text names is exactly the number it parses to (2026-10-05). The parsed
 * double is compared through its canonical rendering, the shortest text that reads back as it (String(x), which is what the
 * hash writes): the two must name the same decimal. So `6125`, `6125.0`, `6.125e3` and `0.1` are exact (they name the decimal
 * the hash writes), and `-0` is exact (zero, either sign). `9007199254740993` (it reads as 9007199254740992),
 * `0.10000000000000001` (it reads as 0.1) and `1e-400` (it reads as 0) are not. Text that is not a number token, and a number
 * past the double range (1e999: nonFinitePath refuses it with its own words), are left to those readers: true here.
 */
export function numberTextIsExact(text: string): boolean {
  const a = reducedDecimal(text)
  if (a === undefined) return true
  const x = Number(text)
  if (!Number.isFinite(x)) return true
  const b = reducedDecimal(String(x))
  if (a === 'zero' || b === 'zero') return a === b
  return b !== undefined && a.neg === b.neg && a.digits === b.digits && a.exp === b.exp
}

/** A long number token, shortened for a message. */
const shortToken = (t: string): string => (t.length > 40 ? `${t.slice(0, 32)}…(${t.length} characters)` : t)

/** The refusal for a number token at `path` of the input `name` that does not read back as written (inexactNumberPath). */
export function inexactNumberRefusal(name: string, hit: { path: string; token: string }): HashInputRefused {
  const reads = String(Number(hit.token))
  return new HashInputRefused(
    `${name}: the number at ${hit.path} (${shortToken(hit.token)}) is ${INEXACT_NUMBER_WORDS}. JSON numbers are read as doubles, and ` +
    `this one reads as ${reads}, so the hash and every check would see ${reads}, not what was written. Then run it again`,
    hit.path,
  )
}

/**
 * The first key that appears twice in one object of the JSON `text`, with its JSON path (`$.verdict.outcome`), or undefined when
 * no object repeats a key. Keys are compared as JSON reads them (`"a"` and `"a"` are the same key). One pass, no recursion
 * (so nesting depth costs no stack), and a path is built only for the key it reports. Meant for text JSON.parse accepted: on
 * text it is not, it returns undefined at the first thing it cannot read, and the caller's JSON.parse names the error.
 */
export function duplicateKeyPath(text: string): { path: string; key: string } | undefined {
  const hit = scanJsonText(text, 'duplicate')
  return hit === undefined ? undefined : { path: hit.path, key: hit.found }
}

/**
 * The first number token in the JSON `text` that does not read back as written (numberTextIsExact), with its JSON path and
 * its text, or undefined (2026-10-05: `"unit_price": 9007199254740993` was read as 9007199254740992, and a
 * line check passed on a figure the file does not hold). The same single pass as duplicateKeyPath; meant for text JSON.parse
 * accepted.
 */
export function inexactNumberPath(text: string): { path: string; token: string } | undefined {
  const hit = scanJsonText(text, 'inexact')
  return hit === undefined ? undefined : { path: hit.path, token: hit.found }
}

/**
 * One pass over JSON text, no recursion: `duplicate` reports the first key repeated in one object (found = the key), `inexact`
 * the first number token that does not read back as written (found = the token). A path is built only for what it reports.
 */
function scanJsonText(text: string, mode: 'duplicate' | 'inexact'): { path: string; found: string } | undefined {
  const n = text.length
  let i = 0
  // one frame per open container: its own place in its parent (a key or an index) and, for an object, the keys read so far
  const stack: { obj: boolean; seg: string | number | null; keys: Set<string> | null; key: string; count: number }[] = []
  const ws = (): void => { while (i < n) { const c = text.charCodeAt(i); if (c === 32 || c === 10 || c === 13 || c === 9) i++; else break } }
  /** The index of the quote that closes the string opening at i, or -1. */
  const stringEnd = (): number => {
    let j = i + 1
    for (;;) {
      const q = text.indexOf('"', j)
      if (q < 0) return -1
      let b = q - 1, slashes = 0
      while (b > i && text.charCodeAt(b) === 92) { slashes++; b-- }
      if (slashes % 2 === 0) return q
      j = q + 1
    }
  }
  const pathTo = (key: string | number): string => {
    let p = '$'
    for (let k = 1; k < stack.length; k++) p = pathStep(p, stack[k]!.seg as string | number)
    return pathStep(p, key)
  }
  let state: 'value' | 'key' | 'after' = 'value'
  for (;;) {
    if (state === 'value') {
      ws()
      const c = text.charCodeAt(i)
      if (c === 123 || c === 91) { // { or [
        const top = stack[stack.length - 1]
        const seg = top === undefined ? null : top.obj ? top.key : top.count
        i++; ws()
        if (text.charCodeAt(i) === (c === 123 ? 125 : 93)) { i++; state = 'after'; continue } // {} or []
        stack.push({ obj: c === 123, seg, keys: c === 123 && mode === 'duplicate' ? new Set() : null, key: '', count: 0 })
        state = c === 123 ? 'key' : 'value'
        continue
      }
      if (c === 34) { const e = stringEnd(); if (e < 0) return undefined; i = e + 1; state = 'after'; continue }
      if (i >= n) return undefined
      const start = i
      while (i < n) { const d = text.charCodeAt(i); if (d === 44 || d === 93 || d === 125 || d === 32 || d === 10 || d === 13 || d === 9) break; i++ }
      if (mode === 'inexact' && (c === 45 || (c >= 48 && c <= 57))) { // - or a digit: a number token
        const token = text.slice(start, i)
        if (!numberTextIsExact(token)) {
          const top = stack[stack.length - 1]
          return { path: top === undefined ? '$' : pathTo(top.obj ? top.key : top.count), found: token }
        }
      }
      state = 'after'
      continue
    }
    if (state === 'key') {
      ws()
      if (text.charCodeAt(i) !== 34) return undefined
      const e = stringEnd()
      if (e < 0) return undefined
      // 2026-10-06: an escape is looked for inside this key only. The search used to run back from the key's end to the start
      // of the text, once per key, so a 20 MB body of small objects took minutes to read.
      const raw = text.slice(i + 1, e)
      let key: string
      if (raw.includes('\\')) { try { key = JSON.parse(text.slice(i, e + 1)) as string } catch { return undefined } } else key = raw
      i = e + 1
      const top = stack[stack.length - 1]!
      if (mode === 'duplicate') {
        if (top.keys!.has(key)) return { path: pathTo(key), found: key }
        top.keys!.add(key)
      }
      top.key = key
      ws()
      if (text.charCodeAt(i) !== 58) return undefined // :
      i++
      state = 'value'
      continue
    }
    ws()
    const top = stack[stack.length - 1]
    if (top === undefined) return undefined
    const c = text.charCodeAt(i)
    if (c === 44) { i++; if (top.obj) state = 'key'; else { top.count++; state = 'value' } continue } // ,
    if ((c === 125 && top.obj) || (c === 93 && !top.obj)) { i++; stack.pop(); continue }
    return undefined
  }
}

/** The refusal for a key repeated at `path` of the input `name` (one wording, for the CLI, HTTP and MCP). */
export function duplicateKeyRefusal(name: string, d: { path: string; key: string }): HashInputRefused {
  return new HashInputRefused(
    `${name}: the key ${JSON.stringify(d.key)} appears twice in one object (at ${d.path}). JSON keeps only the last of them, so a reader ` +
    'that keeps the first would see a different document than the one hashed and signature-checked here. Keep one of them, then run it again',
    d.path,
  )
}

/**
 * How many levels of objects and arrays a JSON input may nest (2026-10-06). The deepest document, verdict, bundle or ruleset
 * this engine reads nests well under 64. Past this limit the input is refused before it is parsed, with its own words, instead
 * of overflowing the stack of whichever reader walks it first ("Maximum call stack size exceeded" on the command line, "invalid
 * JSON body" over HTTP for valid JSON).
 */
export const MAX_JSON_DEPTH = 256

/** The words every refusal of a too-deep input carries (one wording, for the CLI, HTTP and MCP). */
export const TOO_DEEP_WORDS = `nesting too deep, limit ${MAX_JSON_DEPTH}`

/**
 * The character offset at which an object or array opens more than `limit` levels down in the JSON `text`, or -1. One pass, no
 * recursion; brackets inside strings are not counted. Meant for any text: it reads only brackets, quotes and backslashes.
 */
export function tooDeepOffset(text: string, limit = MAX_JSON_DEPTH): number {
  let depth = 0
  let inString = false
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (inString) {
      if (c === 92) i++ // a backslash: the next character is escaped
      else if (c === 34) inString = false
      continue
    }
    if (c === 34) inString = true
    else if (c === 123 || c === 91) { if (++depth > limit) return i } // { [
    else if (c === 125 || c === 93) depth-- // } ]
  }
  return -1
}

/** The refusal for an input that nests past MAX_JSON_DEPTH, the 257th level opening at character `at`. */
export function tooDeepRefusal(name: string, at: number): HashInputRefused {
  return new HashInputRefused(
    `${name}: ${TOO_DEEP_WORDS}: an object or array opens more than ${MAX_JSON_DEPTH} levels down (at character ${at}). No document, ` +
    'verdict or ruleset this engine reads nests that deep. Flatten it, then run it again',
    `character ${at}`,
  )
}

/**
 * Parse JSON text read under the hash contract: a leading byte-order mark is refused with its own message (JSON.parse would say
 * "Unexpected token"), nesting past MAX_JSON_DEPTH is refused before parsing (2026-10-06), a key repeated in one object is refused
 * with its path (duplicateKeyPath), a number that parses to a non-finite value is refused with its path, and (2026-10-05) a number
 * whose text does not read back as written is refused with its path (inexactNumberPath). `name` names the file (or "the request
 * body", "the request line").
 */
export function parseJsonStrict(text: string, name: string): unknown {
  if (startsWithBom(text)) throw new HashInputRefused(`${name}: file starts with a UTF-8 byte-order mark; remove it (save the file as UTF-8 without BOM)`, 'byte 0')
  const deep = tooDeepOffset(text)
  if (deep >= 0) throw tooDeepRefusal(name, deep)
  let x: unknown
  try { x = JSON.parse(text) } catch (e) { throw new Error(`${name}: not valid JSON: ${(e as Error).message}`) }
  const dup = duplicateKeyPath(text)
  if (dup !== undefined) throw duplicateKeyRefusal(name, dup)
  assertFiniteNumbers(x, name)
  const inexact = inexactNumberPath(text)
  if (inexact !== undefined) throw inexactNumberRefusal(name, inexact)
  return x
}
