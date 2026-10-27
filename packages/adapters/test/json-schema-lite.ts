// A JSON Schema (draft-04) validator for exactly the keywords the SARIF 2.1.0 schema uses: type, $ref (local), properties,
// required, additionalProperties, items, minItems, uniqueItems, minimum, maximum, pattern, enum, anyOf, oneOf, and the
// formats uri, uri-reference and date-time. Annotations (description, default, title) are ignored. Any other keyword makes
// it throw, so it can never pass a document by silently skipping a rule. Test-only; not a test file itself. The Python
// suite validates the same output with the `jsonschema` package (python/tests/test_sarif_schema.py).
/* eslint-disable @typescript-eslint/no-explicit-any */
const ANNOTATIONS = new Set(['description', 'default', 'title', '$schema', 'id', 'definitions'])
const KNOWN = new Set(['type', '$ref', 'properties', 'required', 'additionalProperties', 'items', 'minItems', 'uniqueItems',
  'minimum', 'maximum', 'pattern', 'enum', 'anyOf', 'oneOf', 'format', ...ANNOTATIONS])

const typeOf = (v: unknown): string => v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v
const isType = (v: unknown, t: string) => t === 'number' ? typeof v === 'number' : t === 'integer' ? Number.isInteger(v) : typeOf(v) === t
const FORMATS: Record<string, (s: string) => boolean> = {
  uri: (s) => /^[a-zA-Z][a-zA-Z0-9+.-]*:[^\s]*$/.test(s),
  'uri-reference': (s) => !/\s/.test(s),
  'date-time': (s) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(s) && !Number.isNaN(Date.parse(s)),
}
const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x))

export function validate(schema: any, doc: unknown): string[] {
  const root = schema
  const errors: string[] = []
  const resolveRef = (ref: string) => {
    if (!ref.startsWith('#/')) throw new Error(`non-local $ref ${ref}`)
    return ref.slice(2).split('/').reduce((o: any, k) => o?.[k.replace(/~1/g, '/').replace(/~0/g, '~')], root)
  }
  const check = (s: any, v: unknown, at: string, out: string[]): void => {
    for (const k of Object.keys(s)) if (!KNOWN.has(k)) throw new Error(`json-schema-lite: unsupported keyword ${k} at ${at}`)
    if (s.$ref) { check(resolveRef(s.$ref), v, at, out); return }
    if (s.type !== undefined) {
      const ts: string[] = Array.isArray(s.type) ? s.type : [s.type]
      if (!ts.some((t) => isType(v, t))) { out.push(`${at}: expected ${ts.join('|')}, got ${typeOf(v)}`); return }
    }
    if (s.enum && !s.enum.some((e: unknown) => canon(e) === canon(v))) out.push(`${at}: ${JSON.stringify(v)} not in ${JSON.stringify(s.enum)}`)
    if (typeof v === 'number') {
      if (s.minimum !== undefined && v < s.minimum) out.push(`${at}: ${v} < minimum ${s.minimum}`)
      if (s.maximum !== undefined && v > s.maximum) out.push(`${at}: ${v} > maximum ${s.maximum}`)
    }
    if (typeof v === 'string') {
      if (s.pattern && !new RegExp(s.pattern, 'u').test(v)) out.push(`${at}: ${JSON.stringify(v)} does not match ${s.pattern}`)
      if (s.format) {
        const f = FORMATS[s.format]
        if (!f) throw new Error(`json-schema-lite: unsupported format ${s.format}`)
        if (!f(v)) out.push(`${at}: ${JSON.stringify(v)} is not a ${s.format}`)
      }
    }
    if (Array.isArray(v)) {
      if (s.minItems !== undefined && v.length < s.minItems) out.push(`${at}: ${v.length} items < minItems ${s.minItems}`)
      if (s.uniqueItems && new Set(v.map(canon)).size !== v.length) out.push(`${at}: items are not unique`)
      if (s.items) v.forEach((x, i) => check(s.items, x, `${at}[${i}]`, out))
    }
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      const o = v as Record<string, unknown>
      for (const r of s.required ?? []) if (!(r in o)) out.push(`${at}: missing required ${r}`)
      for (const [k, x] of Object.entries(o)) {
        if (s.properties && k in s.properties) check(s.properties[k], x, `${at}.${k}`, out)
        else if (s.additionalProperties === false) out.push(`${at}: unexpected property ${k}`)
        else if (s.additionalProperties && typeof s.additionalProperties === 'object') check(s.additionalProperties, x, `${at}.${k}`, out)
      }
    }
    if (s.anyOf && !s.anyOf.some((sub: any) => { const e: string[] = []; check(sub, v, at, e); return !e.length })) out.push(`${at}: matches none of anyOf`)
    if (s.oneOf) {
      const n = s.oneOf.filter((sub: any) => { const e: string[] = []; check(sub, v, at, e); return !e.length }).length
      if (n !== 1) out.push(`${at}: matches ${n} of oneOf (exactly 1 required)`)
    }
  }
  check(schema, doc, '$', errors)
  return errors
}
