/**
 * Rule mining on the agent and service surfaces: the MCP tool `mine_rules` and `POST /v1/mine` both call mineRules().
 * An agent can mine a ruleset from labelled decisions, then enforce it with `verify_declared`, without leaving MCP.
 */
import { describe, it, expect } from 'vitest'
import { handleRequest, type JsonRpcRequest } from '../src/mcp/server'
import { route } from '../src/http/router'
import { mineRules, caseToExtraction, type MineCase, type MineSchema } from '../src/index'

const call = (method: string, params?: unknown) => handleRequest({ jsonrpc: '2.0', id: 1, method, params } as JsonRpcRequest)!
const pad = (i: number): string => String(i).padStart(3, '0')

// the policy to recover: hold when more is billed than was received
const SCHEMA: MineSchema = { approve: 'ok', fields: {}, lines: { billed: { type: 'qty' }, received: { type: 'qty' } } }
const CASES: MineCase[] = [
  ...Array.from({ length: 30 }, (_, i): MineCase => ({ id: `A${pad(i)}`, label: 'ok', fields: {}, lines: [{ billed: 5 + (i % 4), received: 5 + (i % 4) + (i % 2) }] })),
  ...Array.from({ length: 12 }, (_, i): MineCase => ({ id: `H${pad(i)}`, label: 'hold', fields: {}, lines: [{ billed: 9 + (i % 3), received: 6 }] })),
]

describe('mine_rules (MCP)', () => {
  it('is advertised with an input schema', () => {
    const tools = (call('tools/list').result as { tools: { name: string; inputSchema: { required?: string[] } }[] }).tools
    const t = tools.find((x) => x.name === 'mine_rules')!
    expect(t).toBeDefined()
    expect(t.inputSchema.required).toEqual(['cases', 'schema'])
  })

  it('mines the rule, and the same answer as the library, byte for byte', () => {
    const res = call('tools/call', { name: 'mine_rules', arguments: { cases: CASES, schema: SCHEMA } }).result as { structuredContent: ReturnType<typeof mineRules>; isError: boolean }
    expect(res.isError).toBe(false)
    expect(res.structuredContent.report.candles.map((c) => c.id)).toEqual(['L1 billed <= received'])
    expect(JSON.stringify(res.structuredContent)).toBe(JSON.stringify(mineRules({ cases: CASES }, SCHEMA)))
  })

  it('mine → enforce, all over MCP: the compiled ruleset holds a hold and passes an approval via verify_declared', () => {
    const mined = (call('tools/call', { name: 'mine_rules', arguments: { cases: CASES, schema: SCHEMA, ruleset_id: 'billing' } }).result as { structuredContent: ReturnType<typeof mineRules> }).structuredContent
    expect(mined.compiled.ruleset.id).toBe('billing')
    const enforce = (c: MineCase) => (call('tools/call', { name: 'verify_declared', arguments: { extraction: caseToExtraction(c), ruleset: mined.compiled.ruleset } }).result as { structuredContent: { outcome: string } }).structuredContent.outcome
    expect(enforce(CASES.find((c) => c.id === 'H000')!)).toBe('FAIL')
    expect(enforce(CASES.find((c) => c.id === 'A000')!)).toBe('PASS')
  })

  it('options pass through (thresholds, approved-violation rate); bad input is a tool error, not a crash', () => {
    const t = call('tools/call', { name: 'mine_rules', arguments: { cases: [{ id: 'a', label: 'ok', fields: { x: 1 } }, { id: 'b', label: 'hold', fields: { x: 9 } }], schema: { approve: 'ok', fields: { x: { type: 'qty' } } }, thresholds: true, max_approved_violation_rate: 0.1 } }).result as { structuredContent: ReturnType<typeof mineRules> }
    expect(t.structuredContent.report.options).toMatchObject({ thresholds: true, maxApprovedViolationRate: 0.1 })
    expect([...t.structuredContent.report.candles, ...t.structuredContent.report.morgue].some((j) => j.family === 'C')).toBe(true)
    const bad = call('tools/call', { name: 'mine_rules', arguments: { cases: 'nope', schema: SCHEMA } }).result as { isError: boolean; content: { text: string }[] }
    expect(bad.isError).toBe(true)
    expect(bad.content[0]!.text).toMatch(/"cases" array/)
    const badSchema = call('tools/call', { name: 'mine_rules', arguments: { cases: CASES, schema: { approve: 'ok', fields: { 'bad name': { type: 'qty' } } } } }).result as { isError: boolean }
    expect(badSchema.isError).toBe(true)
  })
})

describe('POST /v1/mine (HTTP)', () => {
  it('returns { report, compiled }, identical to the library', () => {
    const r = route({ method: 'POST', path: '/v1/mine', body: { cases: CASES, schema: SCHEMA } })
    expect(r.status).toBe(200)
    expect(JSON.stringify(r.json)).toBe(JSON.stringify(mineRules({ cases: CASES }, SCHEMA)))
  })

  it('400 on a missing cases array or schema, and on a malformed table; documented in the OpenAPI', () => {
    expect(route({ method: 'POST', path: '/v1/mine', body: { schema: SCHEMA } }).status).toBe(400)
    expect(route({ method: 'POST', path: '/v1/mine', body: { cases: CASES } }).status).toBe(400)
    expect(route({ method: 'POST', path: '/v1/mine', body: { cases: [{ id: 'a', label: 'ok', fields: {} }, { id: 'a', label: 'ok', fields: {} }], schema: SCHEMA } }).status).toBe(400)
    const spec = route({ method: 'GET', path: '/v1/openapi.json' }).json as { paths: Record<string, unknown> }
    expect(spec.paths['/v1/mine']).toBeDefined()
  })
})
