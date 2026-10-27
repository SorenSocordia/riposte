/**
 * POST /v1/action/check and MCP action_check carry `sources.fields` (action@0.2.0): a declared type is used, an invalid one is
 * refused (400 / a tool error), never dropped. The OpenAPI and MCP schemas state the same field. Synthetic fixtures only.
 */
import { describe, it, expect } from 'vitest'
import { actionCheckFromJson, SurfaceInputError, type ActionCheckSurface } from '../src/http/surfaces'
import { route } from '../src/http/router'
import { OPENAPI } from '../src/http/openapi'
import { handleRequest, TOOLS, type JsonRpcRequest } from '../src/mcp/server'

const NOW = { now: () => new Date('2026-09-29T12:00:00Z') }
const CALL = { tool: 'pay_invoice', arguments: { amount: '$4,250.00', reference: 'inv-a-0001' } }
const SOURCES = { records: [{ amount: 4250, reference: 'INV-A-0001' }], fields: { amount: { type: 'amount', currency: 'USD' }, reference: { type: 'identifier', case_insensitive: true } } }
type Schema = { description?: string; properties?: Record<string, Schema> }
const mcpCall = (args: unknown) => handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'action_check', arguments: args } } as JsonRpcRequest)!.result as { isError: boolean; structuredContent?: ActionCheckSurface; content: { text: string }[] }

describe('sources.fields on the action surfaces', () => {
  it('a declared type is used: the call in its declared forms PASSes, each claim naming its comparison', () => {
    const s = actionCheckFromJson({ action: CALL, sources: SOURCES, level: 'gate' }, NOW)
    expect(s).toMatchObject({ disposition: 'review', verdict: { outcome: 'PASS', ruleset: { version: '0.2.0' } } })
    expect(s.verdict.claims.map(c => c.computation!.operands.type)).toEqual(['amount:USD', 'identifier:case'])
    expect(mcpCall({ action: CALL, sources: SOURCES, level: 'gate' }).structuredContent).toMatchObject({ disposition: 'review', verdict: { outcome: 'PASS' } })
    expect(actionCheckFromJson({ action: CALL, sources: { records: SOURCES.records }, level: 'gate' }, NOW)).toMatchObject({ disposition: 'hold', verdict: { outcome: 'FAIL' } })
  })
  it('an invalid declaration is refused, never dropped', () => {
    for (const [fields, why] of [
      ['amount', /"sources\.fields" must be \{ <argument>/],
      [{ amount: { type: 'amount', currency: 'dollars' } }, /"sources\.fields" \.amount currency must be an ISO 4217 code/],
      [{ due: { type: 'date', order: 'YMD' } }, /"sources\.fields" \.due order must be "DMY" or "MDY"/],
      [{ rate: { type: 'rate' } }, /"sources\.fields" \.rate unit must be "percent" or "fraction"/],
    ] as const) {
      expect(() => actionCheckFromJson({ action: CALL, sources: { ...SOURCES, fields } })).toThrow(SurfaceInputError)
      expect(() => actionCheckFromJson({ action: CALL, sources: { ...SOURCES, fields } })).toThrow(why)
      expect(route({ method: 'POST', path: '/v1/action/check', body: { action: CALL, sources: { ...SOURCES, fields } } }).status).toBe(400)
      const m = mcpCall({ action: CALL, sources: { ...SOURCES, fields }, level: 'gate' })
      expect(m.isError).toBe(true)
      expect(m.content[0]!.text).toMatch(/sources\.fields/)
    }
  })
  it('OpenAPI and MCP state the same fields schema, and the records text names 0.2.0', () => {
    const tool = (TOOLS as readonly { name: string; inputSchema: { properties: Record<string, Schema> } }[]).find(t => t.name === 'action_check')!
    const mcp = tool.inputSchema.properties.sources!.properties!
    const http = ((OPENAPI.paths as Record<string, { post: { requestBody: { content: { 'application/json': { schema: { properties: Record<string, Schema> } } } } } }>)['/v1/action/check']!
      .post.requestBody.content['application/json'].schema.properties.sources!.properties!)
    expect(mcp.fields).toEqual(http.fields)
    expect(mcp.fields!.description).toMatch(/action@0\.2\.0/)
    expect(http.records!.description).toMatch(/or action@0\.2\.0 when a value matches only in another written form/)
  })
})
