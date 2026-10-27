/**
 * The engine's MCP server bounds verify_invoice_match's `price_tolerance` by the operator's policy (2026-10-19), exactly as the
 * gate server bounds its verify (packages/gate-server, since 2026-10-14): a caller may lower it, never raise it; above the
 * operator's bar the call is refused by name, `policy_exceeds_operator`, in the gate server's words. A cold review (2026-10-13)
 * found the gate APPROVED a bill whose unit prices were 95% over its PO when the agent passed `price_tolerance: 1`; this server
 * took the caller's value the same way, with no bound at all (it is the same probe here, on the engine's own clean bill).
 * Within the bound the verdict is byte for byte what it was.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { PassThrough } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { canonicalize } from '../src/verdict/canonical'
import { verifyInvoiceMatch, type ApDocuments } from '../src/ap/index'
import { verifyBillMatch, validateApInput, apInputDocuments } from '../src/ap/structured'
import { handleRequest, configFor, readPolicy, policyDigest, listedToolsFor, DEFAULT_CONFIG, type JsonRpcRequest, type OperatorConfig } from '../src/mcp/server'
import { configure, serve, startLine, USAGE } from '../src/mcp/stdio'

type Res = { content: { type: string; text: string }[]; structuredContent: Record<string, any>; isError: boolean }
let n = 0
const call = (args: unknown, config?: OperatorConfig): Res => {
  const r = handleRequest({ jsonrpc: '2.0', id: ++n, method: 'tools/call', params: { name: 'verify_invoice_match', arguments: args } } as JsonRpcRequest, config)
  if (!r || r.error) throw new Error(`no tool result: ${JSON.stringify(r)}`)
  return r.result as Res
}
const first = (r: Res): string => r.content[0]!.text.split('\n')[0]!
const d8 = (policy: unknown): string => createHash('sha256').update(canonicalize(policy), 'utf8').digest('hex').slice(0, 8)
const DEFAULT_POLICY = { price_tolerance: 0.02, total_tolerance: 0.005 }
const clean = (): Record<string, any> => JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/ap-outside-review/01-clean.json', import.meta.url)), 'utf8'))

/** The cold reviewer's probe, step for step: every unit price up by `pct`, each amount and the bill total to match. */
function inflated(pct: number): Record<string, any> {
  const b = clean()
  let total = 0
  for (const li of b.bill.line_items) {
    const up = (Number(li.unit_price) * (1 + pct)).toFixed(2)
    li.unit_price = up
    li.amount = (Number(up) * li.quantity).toFixed(2)
    total += Number(li.amount)
  }
  b.bill.amount = total.toFixed(2)
  return b
}

// a text bill: the tape billed 2.5% over its PO price (14.61 against 14.25), held at the default 2%
const textBill = (): ApDocuments => ({
  invoice: 'INVOICE MESSAGE\nINVOICE NM-84665   DATE 2026-09-28\nCUST PO: PO-48825\n1   CORD EXT 50FT 12AWG | 5 | 47.30 | 236.50\n2   Floor marking tape, yellow | 10 | 14.61 | 146.10\n3   48 inch wire shelving unit | 24 | 96.50 | 2,316.00\nTOTAL DUE USD | 2,698.60\nNorthfield Material Handling\n',
  purchase_order: 'PURCHASE ORDER (ERP)\nPO-48825 | Vendor: Northfield Material Handling | Freight: not allowed\n1. Extension cord 50 ft, 12 AWG | qty 5 | unit USD 47.30\n2. Floor marking tape, yellow | qty 10 | unit USD 14.25\n3. Wire shelving unit 48 in | qty 24 | unit USD 96.50\n',
  goods_receipt: 'GOODS RECEIPT (ERP) for PO-48825\n1. Extension cord 50 ft, 12 AWG | received 5\n2. Floor marking tape, yellow | received 10\n3. Wire shelving unit 48 in | received 24\n',
})

describe('verify_invoice_match: a caller\'s tolerance above the operator\'s is refused by name', () => {
  it('the cold reviewer\'s probe (unit prices +95%, price_tolerance 1) on the structured path: refused, exit 3, in the gate server\'s words', () => {
    const bill = inflated(0.95)
    // without a tolerance the engine's default holds the bill
    expect(call({ structured: bill }).structuredContent).toMatchObject({ decision: 'hold_price' })
    const r = call({ structured: bill, price_tolerance: 1 })
    expect(r.isError).toBe(true)
    expect(r.structuredContent).toMatchObject({ tool: 'verify_invoice_match', exit: 3 })
    expect(r.structuredContent.refused).toEqual({
      code: 'policy_exceeds_operator',
      message: `price_tolerance 1 > default 0.02 (policy ${d8(DEFAULT_POLICY)}; no policy pinned)`,
      asked: 1,
      policy: { digest: policyDigest(DEFAULT_POLICY), price_tolerance: 0.02, pinned: false },
    })
    expect(first(r)).toBe(`verify_invoice_match: refused (exit 3): policy_exceeds_operator: price_tolerance 1 > default 0.02 (policy ${d8(DEFAULT_POLICY)}; no policy pinned)`)
    expect(r.structuredContent.verdict).toBeUndefined()
    expect(r.structuredContent.decision).toBeUndefined()
    // +50%, the reviewer's other probe
    expect(call({ structured: inflated(0.5), price_tolerance: 1 }).structuredContent.refused.code).toBe('policy_exceeds_operator')
  })

  it('the text path is bounded the same way: 0.03 over the default 0.02 is refused; the default holds the 2.5% overcharge', () => {
    const d = textBill()
    expect(call({ ...d }).structuredContent.decision).toBe('hold_price')
    const r = call({ ...d, price_tolerance: 0.03 })
    expect(r.structuredContent.refused).toMatchObject({ code: 'policy_exceeds_operator', message: `price_tolerance 0.03 > default 0.02 (policy ${d8(DEFAULT_POLICY)}; no policy pinned)`, asked: 0.03 })
    const layout = `${d.invoice}${d.purchase_order}${d.goods_receipt}`
    expect(call({ layout, price_tolerance: 0.5 }).structuredContent.refused.code).toBe('policy_exceeds_operator')
  })

  it('a value that is not a finite number from 0 to 1 is policy_invalid, before the operator\'s bar is read (the gate server\'s order)', () => {
    for (const [v, shown] of [['0.05', '"0.05"'], [-0.01, '-0.01'], [2, '2'], [null, 'null'], [true, 'true']] as const) {
      const r = call({ structured: clean(), price_tolerance: v })
      expect(r.isError).toBe(true)
      expect(r.structuredContent.refused).toEqual({ code: 'policy_invalid', message: `price_tolerance must be a finite number from 0 to 1 (got ${shown})` })
      expect(first(r)).toBe(`verify_invoice_match: refused (exit 3): policy_invalid: price_tolerance must be a finite number from 0 to 1 (got ${shown})`)
    }
  })
})

describe('within the bound the verdict is what it was', () => {
  it('no tolerance given: the verdict id is the engine\'s with no policy given (structured and text)', () => {
    const v = validateApInput(clean())
    if (!v.ok) throw new Error('fixture does not validate')
    const direct = verifyBillMatch(apInputDocuments(v.input), {})
    expect(call({ structured: clean() }).structuredContent.verdict.verdict_id).toBe(direct.verdict.verdict_id)
    expect(call({ ...textBill() }).structuredContent.verdict.verdict_id).toBe(verifyInvoiceMatch(textBill(), {}).verdict.verdict_id)
  })

  it('a lower tolerance is read and bound into the verdict, as the engine binds it', () => {
    const r = call({ ...textBill(), price_tolerance: 0.01 })
    expect(r.isError).toBe(false)
    expect(r.structuredContent.verdict.verdict_id).toBe(verifyInvoiceMatch(textBill(), { policy: { price_tolerance: 0.01 } }).verdict.verdict_id)
    expect(call({ ...textBill(), price_tolerance: 0.02 }).structuredContent.verdict.verdict_id).toBe(verifyInvoiceMatch(textBill(), {}).verdict.verdict_id)
  })
})

describe('an operator\'s pinned policy', () => {
  // built inside each test, so a build without the bound fails these tests one by one instead of failing to load the file
  const pinned05 = (): OperatorConfig => configFor(readPolicy('{ "price_tolerance": 0.05 }', 'the policy file'), 'policy.json')
  const p05 = { price_tolerance: 0.05, total_tolerance: 0.005 }

  it('pinned at 0.05: 0.05 is read, 0.06 is refused naming the pinned value, and no tolerance means the operator\'s', () => {
    const cfg = pinned05()
    expect(cfg).toMatchObject({ pinned: true, source: 'policy.json', policy: p05, policy_digest: policyDigest(p05) })
    expect(call({ ...textBill(), price_tolerance: 0.05 }, cfg).isError).toBe(false)
    const no = call({ ...textBill(), price_tolerance: 0.06 }, cfg)
    expect(no.structuredContent.refused).toEqual({ code: 'policy_exceeds_operator', message: `price_tolerance 0.06 > pinned 0.05 (policy ${d8(p05)})`, asked: 0.06, policy: { digest: policyDigest(p05), price_tolerance: 0.05, pinned: true } })
    // the 2.5% overcharge passes the price check under the operator's 5%, exactly as the engine reads 0.05
    expect(call({ ...textBill() }, cfg).structuredContent.verdict.verdict_id).toBe(verifyInvoiceMatch(textBill(), { policy: p05 }).verdict.verdict_id)
  })

  it('tools/list carries the operator\'s maximum and bar; initialize says the policy in force', () => {
    const cfg = pinned05()
    const tool = (c: OperatorConfig) => listedToolsFor(c).find((t) => t.name === 'verify_invoice_match') as unknown as { description: string; inputSchema: { properties: Record<string, any> } }
    expect(tool(cfg).inputSchema.properties.price_tolerance).toEqual({ type: 'number', minimum: 0, maximum: 0.05, description: `Max fractional unit-price overcharge, at most the operator's 0.05 (policy ${d8(p05)}); default the operator's. Above it the call is refused by name.` })
    expect(tool(cfg).description).toContain('no unit price more than 5% over the PO')
    expect(tool(DEFAULT_CONFIG).inputSchema.properties.price_tolerance.maximum).toBe(0.02)
    expect(tool(DEFAULT_CONFIG).description).toContain('no unit price more than 2% over the PO')
    const listed = handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' } as JsonRpcRequest, cfg)!.result as { tools: { name: string }[] }
    expect(listed.tools.find((t) => t.name === 'verify_invoice_match')).toEqual(tool(cfg))
    const init = (c?: OperatorConfig) => (handleRequest({ jsonrpc: '2.0', id: 2, method: 'initialize' } as JsonRpcRequest, c)!.result as { instructions: string }).instructions
    expect(init(cfg)).toBe(`verify_invoice_match: policy ${d8(p05)} price_tolerance 0.05 total_tolerance 0.005, pinned by the operator. A caller may give a lower price_tolerance, never a higher one; above it the call is refused by name.`)
    expect(init()).toBe(`verify_invoice_match: policy ${d8(DEFAULT_POLICY)} price_tolerance 0.02 total_tolerance 0.005: the server's defaults; no policy pinned. A caller may give a lower price_tolerance, never a higher one; above it the call is refused by name.`)
  })

  it('the default policy\'s digest is the one the gate server prints for the same policy', () => {
    expect(DEFAULT_CONFIG).toMatchObject({ pinned: false, policy: DEFAULT_POLICY })
    expect(DEFAULT_CONFIG.policy_digest).toBe(createHash('sha256').update('{"price_tolerance":0.02,"total_tolerance":0.005}', 'utf8').digest('hex'))
  })

  it('a policy file is read under the hash contract and names only what the server reads', () => {
    expect(readPolicy('{ "price_tolerance": 0.03, "total_tolerance": 0.01 }', 'p')).toEqual({ price_tolerance: 0.03, total_tolerance: 0.01 })
    expect(() => readPolicy('{ "price_tolerance": 0.03, "freight": "allow" }', 'p')).toThrow('p: the server does not read "freight"')
    expect(() => readPolicy('{ "total_tolerance": 0.01 }', 'p')).toThrow('p: price_tolerance is missing')
    expect(() => readPolicy('{ "price_tolerance": 1.5 }', 'p')).toThrow('p: price_tolerance must be a finite number from 0 to 1 (got 1.5)')
    expect(() => readPolicy('{ "price_tolerance": 0.01, "price_tolerance": 0.5 }', 'p')).toThrow('the key "price_tolerance" appears twice in one object')
    expect(() => readPolicy('[0.02]', 'p')).toThrow('p: a policy is an object')
  })
})

describe('the stdio transport takes the operator\'s policy when the process starts', () => {
  const files: Record<string, string> = { 'p05.json': '{ "price_tolerance": 0.05 }', 'bad.json': '{ "price_tolerance": 7 }' }
  const read = (p: string): Uint8Array => { const t = files[p]; if (t === undefined) throw new Error(`ENOENT: ${p}`); return Buffer.from(t, 'utf8') }

  it('--policy, the environment, --strict, --help and anything else', () => {
    expect(configure([], {}, read)).toEqual({ config: DEFAULT_CONFIG, strict: false })
    expect(configure(['--policy', 'p05.json'], {}, read)).toMatchObject({ config: { pinned: true, source: 'p05.json', policy: { price_tolerance: 0.05 } } })
    expect(configure([], { RIPOSTE_VERIFY_MCP_POLICY: 'p05.json' }, read)).toMatchObject({ config: { pinned: true, source: 'RIPOSTE_VERIFY_MCP_POLICY' } })
    expect(configure(['--policy', 'p05.json'], { RIPOSTE_VERIFY_MCP_POLICY: 'bad.json' }, read)).toMatchObject({ config: { source: 'p05.json' } }) // the flag wins
    expect(configure(['--strict'], {}, read)).toMatchObject({ error: expect.stringMatching(/^--strict needs a pinned policy/) })
    expect(configure(['--strict', '--policy', 'p05.json'], {}, read)).toMatchObject({ strict: true, config: { pinned: true } })
    expect(configure(['--policy'], {}, read)).toEqual({ error: '--policy needs a value: the policy file' })
    expect(configure(['--policy', 'bad.json'], {}, read)).toEqual({ error: 'the policy file bad.json: price_tolerance must be a finite number from 0 to 1 (got 7)' })
    expect(configure(['--policy', 'missing.json'], {}, read)).toMatchObject({ error: expect.stringMatching(/^cannot read the policy file missing\.json/) })
    expect(configure(['--port', '1'], {}, read)).toEqual({ error: 'unknown argument "--port" (it takes --policy <policy.json> and --strict only)' })
    expect(configure(['--help'], {}, read)).toEqual({ help: true })
    expect(USAGE).toContain('--policy <policy.json>')
  })

  it('the line on stderr at start says the policy in force', () => {
    const c = configure(['--policy', 'p05.json'], {}, read) as { config: OperatorConfig }
    expect(startLine(c.config)).toBe(`verify-mcp: policy ${policyDigest({ price_tolerance: 0.05, total_tolerance: 0.005 })} price_tolerance 0.05 total_tolerance 0.005 pinned from p05.json\n`)
    expect(startLine(DEFAULT_CONFIG)).toMatch(/^verify-mcp: no policy pinned: running on the defaults \(policy [0-9a-f]{64} price_tolerance 0\.02 total_tolerance 0\.005\)\. Pin one with --policy <policy\.json>\n$/)
  })

  it('over the transport, a served config bounds the call', async () => {
    const c = configure(['--policy', 'p05.json'], {}, read) as { config: OperatorConfig }
    const input = new PassThrough()
    const output = new PassThrough()
    const lines: string[] = []
    output.on('data', (d) => { for (const l of String(d).split('\n')) if (l.trim()) lines.push(l) })
    serve(input, output, c.config)
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'verify_invoice_match', arguments: { structured: clean(), price_tolerance: 0.06 } } })}\n`)
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'verify_invoice_match', arguments: { structured: clean(), price_tolerance: 0.05 } } })}\n`)
    await new Promise((r) => setTimeout(r, 50))
    const byId = Object.fromEntries(lines.map((l) => JSON.parse(l) as { id: number; result: Res }).map((x) => [x.id, x.result]))
    expect(byId[1]!.structuredContent.refused).toMatchObject({ code: 'policy_exceeds_operator', message: `price_tolerance 0.06 > pinned 0.05 (policy ${d8({ price_tolerance: 0.05, total_tolerance: 0.005 })})` })
    expect(byId[2]!.isError).toBe(false)
  })
})
