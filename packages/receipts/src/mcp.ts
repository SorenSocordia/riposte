/**
 * Receipts MCP server — the tools a host agent (Hermes, OpenClaw, Claude Code…) calls so its actions come with receipts.
 *
 *   check_done      an agent's "done" claim vs the real state (JSON files under RECEIPTS_ROOT only)
 *   ap_gate         a model's pay/hold decision vs the deterministic AP checker — only agreement executes
 *   model_attest    which model actually answered, reply by reply (from the host's record), vs the declared model
 *   ledger_verify   verify the whole receipt ledger (hash chain + signatures) with no trust in us
 * Every check_done / ap_gate / model_attest result is appended to the hash-chained ledger (RECEIPTS_LEDGER, default ./receipts.jsonl),
 * signed when RECEIPTS_KEY points at an Ed25519 private key (PEM).
 *
 * Dependency-free JSON-RPC 2.0 (same shape as verify's MCP server). `handleRequest` is pure but for the ledger store and the
 * state reader, both injectable for tests.
 */
import { readFileSync } from 'node:fs'
import { resolve, relative, isAbsolute } from 'node:path'
import { splitApLayout, type ApDocuments } from 'riposte-verify'
import { apGate } from './ap-gate.js'
import { checkDone, type DoneClaim, type StateReader } from './done.js'
import { openLedger, type Ledger } from './ledger.js'
import { attestModels, eventsFromClaudeCodeTranscript, eventsFromReplies, type AttestPolicy, type ModelEvent } from './model-attest.js'

export const PROTOCOL_VERSION = '2025-06-18'
export const SERVER_INFO = { name: 'receipts', version: '0.0.1' } as const

export interface JsonRpcRequest { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: unknown }
export interface JsonRpcResponse { jsonrpc: '2.0'; id: string | number | null; result?: unknown; error?: { code: number; message: string } }

export const TOOLS = [
  {
    name: 'check_done',
    description:
      'Call this BEFORE telling the user a task is done. State the claim in your own words and what should now be true ' +
      '(file/record + JSON path + expected value). Receipts reads the REAL state and returns PASS (verified), FAIL (the ' +
      'claim is untrue — here is what is actually there) or ABSTAIN (could not verify — do not claim done). Every result ' +
      'is written to a tamper-evident receipt ledger.',
    inputSchema: {
      type: 'object',
      properties: {
        claim: { type: 'string', description: 'What you are about to tell the user you did.' },
        expectations: {
          type: 'array',
          items: { type: 'object', properties: {
            source: { type: 'string', description: 'JSON file path, relative to the workspace root.' },
            path: { type: 'string', description: 'Dotted path inside the JSON ("" = whole file).' },
            equals: { description: 'The value that should now be there.' },
            exists: { type: 'boolean', description: 'Or: whether the path should exist.' },
          }, required: ['source', 'path'] },
        },
      },
      required: ['claim', 'expectations'],
    },
  },
  {
    name: 'ap_gate',
    description:
      'Before paying or holding an invoice: give your decision (approve | hold_no_po | hold_quantity | hold_price | ' +
      'hold_total | hold_duplicate) and the three documents. A deterministic three-way match (invoice ↔ PO ↔ goods ' +
      'receipt) recomputes it; EXECUTE only if it agrees, otherwise REVIEW (a person decides). Returns what is wrong and ' +
      'where, and writes a receipt.',
    inputSchema: {
      type: 'object',
      properties: {
        decision: { type: 'string' },
        invoice: { type: 'string' }, purchase_order: { type: 'string' }, goods_receipt: { type: 'string' },
        layout: { type: 'string', description: 'Or all three in one text with the ERP section markers.' },
      },
      required: ['decision'],
    },
  },
  {
    name: 'model_attest',
    description:
      'Attest which model ACTUALLY answered, reply by reply, from what the host recorded (never from what a model says about ' +
      'itself). Give a Claude Code transcript (JSONL, path relative to the workspace root) or a list of API replies, plus the ' +
      'declared model id. PASS = every reply came from the declared model and no switch was silent; FAIL = a reply came from ' +
      'another model or the model changed with nothing announcing it; ABSTAIN = nothing to attest (no model recorded, or the ' +
      'declared id is a floating alias like "opus"). Every switch is listed. Writes a receipt.',
    inputSchema: {
      type: 'object',
      properties: {
        transcript: { type: 'string', description: 'Claude Code session transcript (.jsonl), relative to the workspace root.' },
        replies: { type: 'array', items: { type: 'object', properties: { model: { type: 'string' }, created_at: { type: 'string' }, id: { type: 'string' } } }, description: 'Or: API replies in order, each with the `model` the provider returned.' },
        declared: { type: 'string', description: 'The exact model id the run was declared to use.' },
        allowed: { type: 'array', items: { type: 'string' }, description: 'Or: every acceptable exact model id.' },
        fail_on_silent_switch: { type: 'boolean', description: 'FAIL on an unannounced model change (default true).' },
      },
    },
  },
  {
    name: 'ledger_verify',
    description: 'Verify the entire receipt ledger: every entry chained to the previous one and (if signed) signed by the key holder. Anyone can run this — no trust in us required.',
    inputSchema: { type: 'object', properties: {} },
  },
] as const

export interface ServerDeps {
  ledger: Ledger
  read: StateReader
  /** raw text under the workspace root (for transcripts); absent → tools that need it return a tool error */
  readText?: (source: string) => string
}

/** Resolve `source` inside `root`, refusing absolute paths and anything that escapes the root. */
function rootedPath(base: string, source: string): string {
  if (isAbsolute(source)) throw new Error('absolute paths are not allowed; use a path relative to the workspace root')
  const full = resolve(base, source)
  const rel = relative(base, full)
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('path escapes the workspace root')
  return full
}

/** A JSON reader confined to `root`: refuses absolute paths and anything that escapes the root. */
export function rootedJsonReader(root: string): StateReader {
  const base = resolve(root)
  return (source) => JSON.parse(readFileSync(rootedPath(base, source), 'utf8'))
}

/** A text reader confined to `root` (same rules as rootedJsonReader). */
export function rootedTextReader(root: string): (source: string) => string {
  const base = resolve(root)
  return (source) => readFileSync(rootedPath(base, source), 'utf8')
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const toolResult = (structured: unknown): unknown => ({ content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }], structuredContent: structured, isError: false })

function callTool(name: string, args: unknown, deps: ServerDeps): unknown {
  if (!isObj(args)) throw new Error('tool arguments must be an object')
  if (name === 'check_done') {
    if (typeof args.claim !== 'string' || !Array.isArray(args.expectations)) throw new Error('check_done requires "claim" and "expectations"')
    const r = checkDone({ claim: args.claim, expectations: args.expectations as DoneClaim['expectations'] }, deps.read)
    const entry = deps.ledger.append('done_check', r)
    return toolResult({ ...r, receipt: { seq: entry.seq, hash: entry.hash, signed: Boolean(entry.signature) } })
  }
  if (name === 'ap_gate') {
    if (typeof args.decision !== 'string') throw new Error('ap_gate requires "decision"')
    const docs: ApDocuments | null = typeof args.layout === 'string' ? splitApLayout(args.layout)
      : (typeof args.invoice === 'string' && typeof args.purchase_order === 'string' && typeof args.goods_receipt === 'string')
        ? { invoice: args.invoice, purchase_order: args.purchase_order, goods_receipt: args.goods_receipt } : null
    if (!docs) throw new Error('ap_gate requires {invoice, purchase_order, goods_receipt} or {layout}')
    const g = apGate(args.decision, docs)
    const summary = { action: g.action, effect: g.effect, model_decision: g.model_decision, checker_decision: g.checker_decision, reason: g.reason, grounding: g.check.grounding, verdict_id: g.check.verdict.verdict_id }
    const entry = deps.ledger.append('ap_gate', summary)
    return toolResult({ ...summary, receipt: { seq: entry.seq, hash: entry.hash, signed: Boolean(entry.signature) } })
  }
  if (name === 'model_attest') {
    let events: ModelEvent[]
    let source: string
    if (typeof args.transcript === 'string') {
      if (!deps.readText) throw new Error('this server cannot read transcripts (no text reader configured)')
      events = eventsFromClaudeCodeTranscript(deps.readText(args.transcript))
      source = `transcript:${args.transcript}`
    } else if (Array.isArray(args.replies)) {
      events = eventsFromReplies(args.replies as { model?: string | null; created_at?: string; id?: string }[])
      source = 'replies'
    } else throw new Error('model_attest requires "transcript" or "replies"')
    const policy: AttestPolicy = {}
    if (typeof args.declared === 'string') policy.declared = args.declared
    if (Array.isArray(args.allowed)) policy.allowed = args.allowed.filter((x): x is string => typeof x === 'string')
    if (typeof args.fail_on_silent_switch === 'boolean') policy.failOnSilentSwitch = args.fail_on_silent_switch
    const a = attestModels(events, policy)
    const entry = deps.ledger.append('model_attest', { source, ...a })
    return toolResult({ ...a, receipt: { seq: entry.seq, hash: entry.hash, signed: Boolean(entry.signature) } })
  }
  if (name === 'ledger_verify') return toolResult(deps.ledger.verify())
  throw new Error(`unknown tool: ${name}`)
}

export function handleRequest(req: JsonRpcRequest, deps: ServerDeps): JsonRpcResponse | null {
  const id = req.id ?? null
  if (req.id === undefined || req.method.startsWith('notifications/')) return null
  try {
    switch (req.method) {
      case 'initialize': return { jsonrpc: '2.0', id, result: { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO } }
      case 'tools/list': return { jsonrpc: '2.0', id, result: { tools: TOOLS } }
      case 'tools/call': {
        const p = isObj(req.params) ? req.params : {}
        return { jsonrpc: '2.0', id, result: callTool(String(p.name), p.arguments ?? {}, deps) }
      }
      case 'ping': return { jsonrpc: '2.0', id, result: {} }
      default: return { jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${req.method}` } }
    }
  } catch (e) {
    return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: (e as Error).message }], isError: true } }
  }
}

export { openLedger }
