/**
 * The MCP action_check tool advertises `sources.records` (RELEASE-2, 2026-09-29): the same field, rule and text as
 * POST /v1/action/check (PRODUCT-FIX-1), and the same validation, since both go through actionFromJson. Synthetic data only.
 */
import { describe, it, expect } from 'vitest'
import { handleRequest, TOOLS, type JsonRpcRequest } from '../src/mcp/server'
import { OPENAPI } from '../src/http/openapi'
import type { ActionCheckSurface } from '../src/http/surfaces'

const INVOICE_A = { amount: 500, to_account: '220-000-1111', reference: 'INV-A-0001' }
const INVOICE_B = { amount: 900, to_account: '330-000-2222', reference: 'INV-B-0002' }
const RECORDS = { records: [INVOICE_A, INVOICE_B] }
const pay = (args: Record<string, unknown>) => ({ tool: 'pay_invoice', arguments: args })
const MIXED = pay({ amount: 500, to_account: '330-000-2222', reference: 'INV-A-0001' }) // A's amount and reference, B's account

type Schema = { type?: unknown; minItems?: number; items?: unknown; description?: string; properties?: Record<string, Schema> }
const call = (args: unknown) => handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'action_check', arguments: args } } as JsonRpcRequest)!.result as { isError: boolean; structuredContent?: ActionCheckSurface; content: { text: string }[] }

describe('MCP action_check: sources.records', () => {
  it('is advertised with the HTTP surface\'s schema and description, word for word', () => {
    const tool = (TOOLS as readonly { name: string; description: string; inputSchema: { properties: Record<string, Schema> } }[]).find(t => t.name === 'action_check')!
    const mcp = tool.inputSchema.properties.sources!.properties!.records!
    const http = ((OPENAPI.paths as Record<string, { post: { requestBody: { content: { 'application/json': { schema: { properties: Record<string, Schema> } } } } } }>)['/v1/action/check']!
      .post.requestBody.content['application/json'].schema.properties.sources!.properties!.records!)
    expect(mcp).toEqual(http)
    expect(mcp.description).toMatch(/mix-and-match/)
    expect(Object.keys(tool.inputSchema.properties.sources!.properties!).sort()).toEqual(['allowed', 'records', 'require', 'text'])
    expect(tool.description).toMatch(/approved records/)
  })

  it('carries records through: the mix-and-match holds at gate, the correct tuple goes to review', () => {
    const mixed = call({ action: MIXED, sources: RECORDS, level: 'gate' })
    expect(mixed.isError).toBe(false)
    expect(mixed.structuredContent).toMatchObject({ disposition: 'hold', holds: true, verdict: { outcome: 'FAIL' } })
    const right = call({ action: pay(INVOICE_B), sources: RECORDS, level: 'gate' })
    expect(right.structuredContent).toMatchObject({ disposition: 'review', verdict: { outcome: 'PASS' } })
    expect(right.structuredContent!.verdict.ruleset.version).toBe('0.1.0')
  })

  it('refuses records it cannot use, as the HTTP surface does (a tool error, never a guess)', () => {
    for (const records of [[], [{}], [{ amount: [500] }], [INVOICE_A, { amount: 900, to_account: '330-000-2222' }]]) {
      const r = call({ action: MIXED, sources: { records }, level: 'gate' })
      expect(r.isError).toBe(true)
      expect(r.content[0]!.text).toMatch(/sources\.records/)
    }
  })
})
