/**
 * Two different inputs must never share a hash. A "__proto__" key is data (PERF lane finding, fixed 2026-09-28): before
 * the fix, canonicalize(JSON.parse('{"__proto__":{"x":1}}')) === canonicalize({}) and the two shared an input_hash.
 */
import { describe, it, expect } from 'vitest'
import { canonicalize, hashOf } from '../src/verdict/canonical'

describe('canonicalize treats "__proto__" as an ordinary key', () => {
  it('no collision with the empty object, at the top level or nested', () => {
    const proto = JSON.parse('{"__proto__": {"x": 1}}')
    expect(canonicalize(proto)).toBe('{"__proto__":{"x":1}}')
    expect(hashOf(proto)).not.toBe(hashOf({}))
    const nested = JSON.parse('{"a": {"__proto__": {"amount": 500}}}')
    expect(hashOf(nested)).not.toBe(hashOf({ a: {} }))
  })
  it('keeps key order sorted and leaves ordinary inputs byte-identical', () => {
    expect(canonicalize(JSON.parse('{"b": 1, "__proto__": 2, "a": 3}'))).toBe('{"__proto__":2,"a":3,"b":1}')
    expect(canonicalize({ b: 1, a: [1, undefined, { d: undefined, c: 2 }] })).toBe('{"a":[1,null,{"c":2}],"b":1}')
  })
  it('does not pollute prototypes', () => {
    canonicalize(JSON.parse('{"__proto__": {"polluted": true}}'))
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})
