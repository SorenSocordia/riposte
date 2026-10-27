/**
 * A small JSON Schema (draft 2020-12) validator for the subset the extraction-contract schemas use (./schema.ts):
 * type, const, enum, required, properties, additionalProperties, items, minItems, minLength, pattern, minimum, anyOf,
 * allOf, if/then, and local $ref ("#/$defs/…"). Unknown keywords are annotations and are ignored, as the spec says,
 * except `x-violation`, which this validator reads to word a failed `anyOf` ({ pointer, message }).
 *
 * Violations come out in a fixed order (the schema's own order: properties as listed, then allOf), so "the first violation"
 * is deterministic. It is no general-purpose validator; the generated schemas are also ordinary JSON Schema, so any
 * draft 2020-12 validator gives the same accept/refuse answer on them.
 */

export type JsonSchema = Record<string, unknown>
export interface SchemaViolation {
  /** JSON Pointer (RFC 6901) into the instance */
  pointer: string
  /** the keyword that failed (required, type, const, additionalProperties, x-violation, …) */
  keyword: string
  message: string
}

const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x)
const esc = (k: string): string => k.replace(/~/g, '~0').replace(/\//g, '~1')
const show = (x: unknown): string => { const s = JSON.stringify(x); return s === undefined ? String(x) : s.length > 40 ? `${s.slice(0, 37)}...` : s }

function typeOf(x: unknown): string {
  if (x === null) return 'null'
  if (Array.isArray(x)) return 'array'
  if (typeof x === 'number') return Number.isInteger(x) ? 'integer' : 'number'
  return typeof x
}
function typeOk(x: unknown, t: string): boolean {
  const a = typeOf(x)
  return a === t || (t === 'number' && a === 'integer')
}

export function validateSchema(instance: unknown, schema: JsonSchema, root: JsonSchema = schema, pointer = ''): SchemaViolation[] {
  const out: SchemaViolation[] = []
  const ref = schema.$ref
  if (typeof ref === 'string') {
    const m = /^#\/\$defs\/(.+)$/.exec(ref)
    const target = m ? (root.$defs as Record<string, JsonSchema> | undefined)?.[m[1] as string] : undefined
    if (!target) return [{ pointer, keyword: '$ref', message: `unresolved reference ${ref}` }]
    out.push(...validateSchema(instance, target, root, pointer))
  }
  if ('const' in schema && JSON.stringify(instance) !== JSON.stringify(schema.const)) {
    out.push({ pointer, keyword: 'const', message: `must be ${show(schema.const)}, not ${show(instance)}` })
    return out
  }
  if (Array.isArray(schema.enum) && !schema.enum.some(e => JSON.stringify(e) === JSON.stringify(instance))) {
    out.push({ pointer, keyword: 'enum', message: `must be one of ${schema.enum.map(show).join(', ')}, not ${show(instance)}` })
    return out
  }
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type as string[] : [schema.type as string]
    if (!types.some(t => typeOk(instance, t))) {
      out.push({ pointer, keyword: 'type', message: `must be ${types.join(' or ')}, not ${typeOf(instance)}${instance === undefined ? '' : ` (${show(instance)})`}` })
      return out
    }
  }
  if (typeof instance === 'string') {
    if (typeof schema.minLength === 'number' && instance.length < schema.minLength) out.push({ pointer, keyword: 'minLength', message: `must have at least ${schema.minLength} character(s)` })
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern, 'u').test(instance)) out.push({ pointer, keyword: 'pattern', message: `must match ${schema.pattern}, not ${show(instance)}` })
  }
  if (typeof instance === 'number' && typeof schema.minimum === 'number' && instance < schema.minimum) {
    out.push({ pointer, keyword: 'minimum', message: `must be at least ${schema.minimum}, not ${instance}` })
  }
  if (Array.isArray(instance)) {
    if (typeof schema.minItems === 'number' && instance.length < schema.minItems) out.push({ pointer, keyword: 'minItems', message: `must have at least ${schema.minItems} item(s), not ${instance.length}` })
    if (isObj(schema.items)) instance.forEach((x, i) => out.push(...validateSchema(x, schema.items as JsonSchema, root, `${pointer}/${i}`)))
  }
  if (isObj(instance)) {
    for (const k of Array.isArray(schema.required) ? schema.required as string[] : []) {
      if (!(k in instance)) out.push({ pointer: `${pointer}/${esc(k)}`, keyword: 'required', message: `is required and missing` })
    }
    const props = isObj(schema.properties) ? schema.properties as Record<string, JsonSchema> : {}
    for (const [k, s] of Object.entries(props)) if (k in instance) out.push(...validateSchema(instance[k], s, root, `${pointer}/${esc(k)}`))
    const extra = Object.keys(instance).filter(k => !(k in props))
    if (schema.additionalProperties === false) {
      for (const k of extra) out.push({ pointer: `${pointer}/${esc(k)}`, keyword: 'additionalProperties', message: `is not a term this schema allows` })
    } else if (isObj(schema.additionalProperties)) {
      for (const k of extra) out.push(...validateSchema(instance[k], schema.additionalProperties as JsonSchema, root, `${pointer}/${esc(k)}`))
    }
  }
  if (Array.isArray(schema.allOf)) for (const s of schema.allOf as JsonSchema[]) out.push(...validateSchema(instance, s, root, pointer))
  if (Array.isArray(schema.anyOf)) {
    const alts = schema.anyOf as JsonSchema[]
    const results = alts.map(s => validateSchema(instance, s, root, pointer))
    if (!results.some(r => r.length === 0)) {
      const xv = isObj(schema['x-violation']) ? schema['x-violation'] as { pointer?: string; message?: string } : undefined
      if (xv) out.push({ pointer: `${pointer}${xv.pointer ?? ''}`, keyword: 'x-violation', message: xv.message ?? 'no alternative holds' })
      else out.push({ pointer, keyword: 'anyOf', message: `no alternative holds: ${results.map(r => r[0]?.message ?? '?').join(' | ')}` })
    }
  }
  if (isObj(schema.if) && isObj(schema.then) && validateSchema(instance, schema.if as JsonSchema, root, pointer).length === 0) {
    out.push(...validateSchema(instance, schema.then as JsonSchema, root, pointer))
  }
  return out
}
