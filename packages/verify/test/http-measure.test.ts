/**
 * HTTP surface for the accuracy harness — POST /v1/ruleset/measure runs a declarative ruleset over a labeled set and
 * returns a measured DeclaredAccuracy. Tests the pure router (serve.ts is a thin wrapper).
 */
import { describe, it, expect } from 'vitest'
import { route } from '../src/http/router'
import { OPENAPI } from '../src/http/openapi'
import type { DeclarativeRuleset } from '../src/declarative/types'

const ruleset: DeclarativeRuleset = {
  id: 'test-total', version: '1.0.0', domain: 'test',
  fields: { SUB: { paths: ['subtotal'] }, TAX: { paths: ['tax'] }, TOTAL: { paths: ['total'] } },
  checks: [{ code: 'TOTAL_INT', left: 'TOTAL', op: '=', right: 'SUB + TAX', field: 'total' }],
}
const cases = [
  { extraction: { subtotal: 100, tax: 10, total: 110 }, label: 'CLEAN' },
  { extraction: { subtotal: 100, tax: 10, total: 999 }, label: 'ERROR' },
]

describe('POST /v1/ruleset/measure', () => {
  it('returns a measured accuracy on a labeled set', () => {
    const res = route({ method: 'POST', path: '/v1/ruleset/measure', body: { ruleset, cases } })
    expect(res.status).toBe(200)
    const json = res.json as { accuracy: { measured_on: string; fp_rate: number }; metrics: { tp: number } }
    expect(json.accuracy.measured_on).toMatch(/^[0-9a-f]{64}$/)
    expect(json.metrics.tp).toBe(1)
  })

  it('rejects a request with no cases array', () => {
    const res = route({ method: 'POST', path: '/v1/ruleset/measure', body: { ruleset } })
    expect(res.status).toBe(400)
  })

  it('rejects a non-declarative ruleset', () => {
    const res = route({ method: 'POST', path: '/v1/ruleset/measure', body: { ruleset: { nope: true }, cases } })
    expect(res.status).toBe(400)
  })

  it('is advertised in the OpenAPI spec', () => {
    expect(Object.keys(OPENAPI.paths)).toContain('/v1/ruleset/measure')
  })
})
