/**
 * MCP server (leg 1.6): the verifier as an agent-callable tool. We test the JSON-RPC handler directly — the transport
 * (stdio.ts) is a thin readline wrapper around it.
 */
import { describe, it, expect } from 'vitest'
import { handleRequest, TOOLS, PROTOCOL_VERSION, type JsonRpcRequest } from '../src/mcp/server'
import { clean, broken } from './fixtures/invoices'
import { cleanApp, prevApp } from './fixtures/pay-apps'

const call = (method: string, params?: unknown, id: number | string | null = 1): ReturnType<typeof handleRequest> =>
  handleRequest({ jsonrpc: '2.0', id, method, params } as JsonRpcRequest)

describe('MCP protocol surface', () => {
  it('initialize returns the protocol version, capabilities and server info', () => {
    const r = call('initialize')!
    expect(r.error).toBeUndefined()
    const res = r.result as Record<string, unknown>
    expect(res.protocolVersion).toBe(PROTOCOL_VERSION)
    expect((res.serverInfo as Record<string, unknown>).name).toBe('verify')
    expect(res.capabilities).toMatchObject({ tools: {} })
  })

  it('tools/list advertises verify_document, verify_quotes and verify_action with input schemas', () => {
    const res = call('tools/list')!.result as { tools: typeof TOOLS }
    const names = res.tools.map(t => t.name)
    expect(names).toContain('verify_document')
    expect(names).toContain('verify_quotes')
    expect(names).toContain('verify_action')
    expect(names).toContain('verify_citations')
    expect(names).toContain('verify_declared')
    for (const t of res.tools) expect(t.inputSchema.type).toBe('object')
  })

  it('verify_action grounds a proposed action: an account not in the allow-list FAILs', () => {
    const res = call('tools/call', {
      name: 'verify_action',
      arguments: { action: { tool: 'transfer', arguments: { to_account: '110-999-9999' } }, sources: { allowed: { to_account: ['110-111-1111'] } } },
    })!.result as { structuredContent: Record<string, unknown> }
    expect(res.structuredContent.outcome).toBe('FAIL')
    expect((res.structuredContent.ruleset as Record<string, unknown>).id).toBe('action')
  })

  it('a notification (no id) and notifications/* get no reply', () => {
    expect(handleRequest({ jsonrpc: '2.0', method: 'notifications/initialized' } as JsonRpcRequest)).toBeNull()
    expect(call('notifications/initialized', undefined, undefined as unknown as null)).toBeNull()
  })

  it('an unknown method is a JSON-RPC method-not-found error', () => {
    const r = call('does/not/exist')!
    expect(r.error?.code).toBe(-32601)
  })
})

describe('tools/call verify_document', () => {
  it('runs the invoice ruleset and returns the verdict as structured content', () => {
    const r = call('tools/call', { name: 'verify_document', arguments: { extraction: clean } })!
    const res = r.result as { isError: boolean; structuredContent: Record<string, unknown>; content: { type: string; text: string }[] }
    expect(res.isError).toBe(false)
    expect(res.structuredContent.outcome).toBe('PASS')
    expect(res.structuredContent.ruleset).toMatchObject({ id: 'invoice' })
    // the text rendering parses back to the same verdict
    expect((JSON.parse(res.content[0]!.text) as Record<string, unknown>).verdict_id).toBe(res.structuredContent.verdict_id)
  })

  it('a broken invoice comes back FAIL', () => {
    const res = call('tools/call', { name: 'verify_document', arguments: { extraction: broken } })!.result as { structuredContent: Record<string, unknown> }
    expect(res.structuredContent.outcome).toBe('FAIL')
  })

  it('routes the pay-app ruleset and history through', () => {
    const res = call('tools/call', {
      name: 'verify_document',
      arguments: { extraction: cleanApp, ruleset: 'pay-app', references: { history: [prevApp] } },
    })!.result as { structuredContent: Record<string, unknown> }
    expect((res.structuredContent.ruleset as Record<string, unknown>).id).toBe('pay-app')
    expect((res.structuredContent.references as Record<string, unknown>).history).toBe(1)
    expect(res.structuredContent.outcome).toBe('PASS')
  })

  it('missing extraction is a tool error (isError), not a crash', () => {
    const res = call('tools/call', { name: 'verify_document', arguments: {} })!.result as { isError: boolean }
    expect(res.isError).toBe(true)
  })

  it('an unknown tool name is a tool error', () => {
    const res = call('tools/call', { name: 'verify_everything', arguments: {} })!.result as { isError: boolean }
    expect(res.isError).toBe(true)
  })

  it('invalid params (no name) is a JSON-RPC invalid-params error', () => {
    expect(call('tools/call', { arguments: {} })!.error?.code).toBe(-32602)
  })
})

describe('stdio transport (end to end, in-process)', () => {
  it('reads newline-delimited requests and writes newline-delimited responses; parse errors are reported', async () => {
    const { serve } = await import('../src/mcp/stdio')
    const { PassThrough } = await import('node:stream')
    const input = new PassThrough()
    const output = new PassThrough()
    const lines: string[] = []
    output.on('data', d => { for (const l of String(d).split('\n')) if (l.trim()) lines.push(l) })
    serve(input, output)
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' })}\n`)
    input.write('this is not json\n')
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'verify_document', arguments: { extraction: clean } } })}\n`)
    input.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`) // no reply
    await new Promise(r => setTimeout(r, 30))
    const parsed = lines.map(l => JSON.parse(l) as Record<string, unknown>)
    expect(parsed.find(p => p.id === 1)?.result).toBeDefined()
    expect((parsed.find(p => (p.error as Record<string, unknown> | undefined)?.code === -32700)?.error as Record<string, unknown>).code).toBe(-32700)
    const verdictResp = parsed.find(p => p.id === 2)?.result as { structuredContent: Record<string, unknown> }
    expect(verdictResp.structuredContent.outcome).toBe('PASS')
    // the notification produced no line with a null id error
    expect(parsed.some(p => p.id === null && p.result)).toBe(false)
  })
})

describe('tools/call verify_quotes', () => {
  it('verbatim quote PASSes, misquote FAILs with the source\'s words', () => {
    const source = 'The court holds the lease is terminated as of the date of breach.'
    const res = call('tools/call', {
      name: 'verify_quotes',
      arguments: { source_text: source, quotes: [
        { id: 'a', quote: 'the lease is terminated as of the date of breach' },
        { id: 'b', quote: 'the lease is RESCINDED as of the date of breach' },
      ] },
    })!.result as { structuredContent: { claims: { claim_id: string; outcome: string }[] } }
    const byId = Object.fromEntries(res.structuredContent.claims.map(c => [c.claim_id, c.outcome]))
    expect(byId['a']).toBe('PASS')
    expect(byId['b']).toBe('FAIL')
  })
})
