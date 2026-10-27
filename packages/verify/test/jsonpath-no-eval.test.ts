/**
 * The JSONPath call never evaluates an expression (2026-10-06; src/binding/jsonpath-resolver.ts). An outside engineer noted that
 * the call left the library's evaluation mode at its default, and that the library has had filter-expression code-execution
 * advisories. The call now says `eval: false`: a filter or script expression in a path is refused with an error, and plain paths
 * read as before.
 */
import { describe, it, expect } from 'vitest'
import { resolveJsonPath } from '../src/binding/jsonpath-resolver'

const doc = { items: [{ a: 1, name: 'one' }, { a: 2, name: 'two' }], totals: { total: 3 } }

describe('JSONPath: plain paths read, expressions never run', () => {
  it('plain paths and wildcards read as before', () => {
    expect(resolveJsonPath(doc, '$.totals.total')).toMatchObject({ success: true, value: 3 })
    expect(resolveJsonPath(doc, 'items[*].name', 1)).toMatchObject({ success: true, value: 'two' })
  })
  it('a filter expression is refused, not evaluated', () => {
    const r = resolveJsonPath(doc, '$.items[?(@.a > 1)].name')
    expect(r.success).toBe(false)
    expect(r.value).toBeNull()
  })
  it('an expression that would reach the process is refused, and nothing it names runs', () => {
    const g = globalThis as { __jsonpathRan?: boolean }
    delete g.__jsonpathRan
    const r = resolveJsonPath(doc, "$.items[?(@.constructor.constructor('globalThis.__jsonpathRan = true')())]")
    expect(r.success).toBe(false)
    expect(g.__jsonpathRan).toBeUndefined()
    const s = resolveJsonPath(doc, "$.items[(globalThis.__jsonpathRan = true)]")
    expect(s.success).toBe(false)
    expect(g.__jsonpathRan).toBeUndefined()
  })
})
