/**
 * MCP server — expose the verifier as a tool any agent (Claude, Cursor, a customer's own) can call before it acts.
 *
 * This is the "agent pre-action verification layer" made concrete: an agent about to post a payment or file a brief
 * calls `verify_document` and gets back a PASS / FAIL / can't-tell proof object it can gate the action on.
 *
 * Dependency-free by design — a minimal, compliant JSON-RPC 2.0 handler over newline-delimited stdio. No SDK, so the
 * package keeps a single runtime dependency. Swap in the official MCP SDK later
 * without changing `verify()` or the tool contracts.
 *
 * `handleRequest` is pure w.r.t. I/O (it only calls `verify`, which is itself pure but for an injectable clock), so it
 * is unit-tested directly; `stdio.ts` is the thin transport around it.
 */

import { verify, type VerifyOptions } from '../index.js'
import { verifyAction, type ActionSources, type ProposedAction } from '../action/index.js'
import { verifyCitations, type Citation, type OpinionSources } from '../legal/index.js'
import { verifyInvoiceMatch, splitApLayout, type ApDocuments } from '../ap/index.js'
import { verifyDeclarative } from '../declarative/evaluate.js'
import { isDeclarativeRuleset, type DeclarativeRuleset } from '../declarative/types.js'
import { verifyAgainstSource } from '../textmatch/index.js'
import { mineRules, caseTableFromRows } from '../mine/index.js'
import type { MineOptions, MineSchema } from '../mine/types.js'
import { ENGINE_VERSION } from '../version.js'

export const PROTOCOL_VERSION = '2025-06-18'
export const SERVER_INFO = { name: 'verify', version: ENGINE_VERSION } as const

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: string | number | null
  method: string
  params?: unknown
}
export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

const TOOLS = [
  {
    name: 'verify_document',
    description:
      'Deterministically verify an already-extracted document (invoice or construction pay application). Returns a ' +
      'replayable proof object: per-claim PASS / FAIL / INSUFFICIENT_DATA with the operands and their provenance. ' +
      'Never guesses — a field it cannot verify abstains with a reason. Call this before acting on extracted numbers.',
    inputSchema: {
      type: 'object',
      properties: {
        extraction: { type: 'object', description: 'The already-extracted document data (from any extractor or your own LLM).' },
        ruleset: { type: 'string', enum: ['invoice', 'pay-app'], description: 'Which ruleset to apply. Default "invoice".' },
        references: {
          type: 'object',
          description: 'Optional reference documents for cross-checks.',
          properties: {
            contract: { type: 'object' },
            evidence: { type: 'array', items: { type: 'object' } },
            history: { type: 'array', items: { type: 'object' }, description: 'Prior documents of the same kind (e.g. the previous pay application).' },
          },
        },
        source: {
          type: 'object',
          description: 'The source document text, for the "does it appear in the document" axis (digital-born text).',
          properties: {
            text: { type: 'string' },
            quotes: { type: 'array', items: { type: 'object' } },
            values: { type: 'array', items: { type: 'object' } },
          },
          required: ['text'],
        },
      },
      required: ['extraction'],
    },
  },
  {
    name: 'verify_quotes',
    description:
      'Given a source document\'s text and a list of quotations (and/or numeric values), check whether each appears ' +
      'VERBATIM in the source. A quote whose citation points at real text but whose words differ FAILs and returns the ' +
      'passage the source actually carries. Use for legal cite-checking and for confirming an extracted value is really ' +
      'in the document. Whether a source stands for a proposition is NOT decided here (that is semantic).',
    inputSchema: {
      type: 'object',
      properties: {
        source_text: { type: 'string' },
        quotes: {
          type: 'array',
          items: { type: 'object', properties: { id: { type: 'string' }, quote: { type: 'string' }, label: { type: 'string' } }, required: ['id', 'quote'] },
        },
        values: {
          type: 'array',
          items: { type: 'object', properties: { id: { type: 'string' }, value: { type: 'number' }, field: { type: 'string' } }, required: ['id', 'value', 'field'] },
        },
      },
      required: ['source_text'],
    },
  },
  {
    name: 'verify_action',
    description:
      'Before an AI agent executes a consequential action (move money, file a document, submit a claim), verify every ' +
      'value it is about to use is GROUNDED — that each amount, code, account number or id traces to an approved source ' +
      '(an allow-list of permitted values, or the source document the agent read). A schema check proves an argument is ' +
      'well-formed; this proves it was not invented. Returns PASS / FAIL / can\'t-tell with a replayable proof; execute ' +
      'only on PASS. Does NOT judge planning, permissions, or destructive-action safety.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'object',
          description: 'The proposed action.',
          properties: { tool: { type: 'string' }, arguments: { type: 'object' } },
          required: ['tool', 'arguments'],
        },
        sources: {
          type: 'object',
          description: 'What counts as an approved source for the argument values.',
          properties: {
            text: { type: 'string', description: 'The source document text the agent read.' },
            allowed: { type: 'object', description: 'Per-argument allow-lists of approved values, keyed by argument name.' },
            require: { type: 'array', items: { type: 'string' }, description: 'Which arguments must be grounded (default: all scalar arguments).' },
          },
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'verify_citations',
    description:
      'Cite-check a legal brief: for each citation, verify the quoted passage appears VERBATIM in the supplied opinion ' +
      'text. Catches the failure existence-checkers miss — a real case quoted for words it does not contain (a misquote ' +
      'FAILs and returns what the opinion actually says). Whether a case STANDS FOR a proposition is semantic and is a ' +
      'declared abstention, not a verdict. Florida and California now require this verification.',
    inputSchema: {
      type: 'object',
      properties: {
        citations: {
          type: 'array',
          items: { type: 'object', properties: { id: { type: 'string' }, cite: { type: 'string' }, case_name: { type: 'string' }, quote: { type: 'string' }, proposition: { type: 'string' }, source_key: { type: 'string' } }, required: ['id'] },
        },
        sources: { type: 'object', description: 'Opinion texts keyed by cite / case_name / source_key.' },
      },
      required: ['citations'],
    },
  },
  {
    name: 'verify_invoice_match',
    description:
      'Accounts-payable three-way match BEFORE paying: invoice (free text, as received) vs the ERP purchase order vs the ' +
      'goods receipt. Checks, in order: PO number matches; no line bills more than was received; no unit price more than ' +
      '2% over the PO; the stated total adds up (freight only if the PO allows it). Returns decision = approve | hold_no_po | ' +
      'hold_quantity | hold_price | hold_total | abstain, payable (true/false/null), the six-field grounding (what is wrong ' +
      'and where), and a replayable proof object. Deterministic — no model. ABSTAINS instead of guessing when it cannot read ' +
      'the documents unambiguously; route those to a human. Pass either {invoice, purchase_order, goods_receipt} or {layout}.',
    inputSchema: {
      type: 'object',
      properties: {
        invoice: { type: 'string', description: 'The invoice as received (email body / text).' },
        purchase_order: { type: 'string', description: 'ERP purchase order text: "PO-123 | Vendor: … | Freight: …" + numbered lines "N. item | qty Q | unit USD P".' },
        goods_receipt: { type: 'string', description: 'ERP goods receipt text: numbered lines "N. item | received R".' },
        layout: { type: 'string', description: 'Alternatively, all three in one text: INVOICE MESSAGE … PURCHASE ORDER (ERP) … GOODS RECEIPT (ERP) ….' },
        price_tolerance: { type: 'number', description: 'Max fractional unit-price overcharge (default 0.02).' },
      },
    },
  },
  {
    name: 'verify_declared',
    description:
      'Verify a document against a DECLARATIVE ruleset supplied as JSON — teach the checker a new document type (any ' +
      'language, any table that must foot) with no code: field aliases per role, computed formulas, and checks. Returns ' +
      'the same PASS / FAIL / can\'t-tell proof object. Use this to check document types the built-in rulesets don\'t cover.',
    inputSchema: {
      type: 'object',
      properties: {
        extraction: { type: 'object', description: 'The already-extracted document data.' },
        ruleset: {
          type: 'object',
          description: 'The declarative ruleset: { id, version, lineArrayKeys?, fields, computed?, checks, tolerance? }.',
          properties: {
            id: { type: 'string' }, version: { type: 'string' },
            fields: { type: 'object' }, computed: { type: 'object' }, checks: { type: 'array' },
          },
          required: ['id', 'version', 'fields', 'checks'],
        },
      },
      required: ['extraction', 'ruleset'],
    },
  },
  {
    name: 'mine_rules',
    description:
      'Propose the rules behind a set of labelled decisions (rule mining). Give it cases {id, label, fields, lines?} and a ' +
      'schema {approve, fields, lines?} that types each field and says which label means APPROVE. It returns CANDLES: ' +
      'candidate rules that explain the non-approved cases, each with its exact grounding p-value. It returns the MORGUE: ' +
      'every rejected candidate and why it died. It returns a compiled declarative ruleset that verify_declared can enforce. ' +
      'Deterministic, no model. Candles are proposals for a human to ratify, never rules on their own.',
    inputSchema: {
      type: 'object',
      properties: {
        cases: { type: 'array', items: { type: 'object', required: ['id', 'label', 'fields'], properties: { id: { type: 'string' }, label: { type: 'string' }, fields: { type: 'object' }, lines: { type: 'array', items: { type: 'object' } } } } },
        schema: { type: 'object', required: ['approve', 'fields'], properties: { approve: {}, fields: { type: 'object' }, lines: { type: 'object' } } },
        max_approved_violation_rate: { type: 'number', description: 'Tolerate this fraction of approved exceptions per rule (default 0).' },
        thresholds: { type: 'boolean', description: 'Also learn a constant per numeric document field (X <= c, X >= c). Default false.' },
        ruleset_id: { type: 'string', description: 'Id for the compiled ruleset (default "mined").' },
      },
      required: ['cases', 'schema'],
    },
  },
] as const

function ok(id: JsonRpcResponse['id'], result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result }
}
function err(id: JsonRpcResponse['id'], code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } }
}
const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x)

/** MCP tool result carrying both a text rendering and the structured verdict. */
function toolResult(structured: unknown): unknown {
  return { content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }], structuredContent: structured as Record<string, unknown>, isError: false }
}

function callTool(name: string, args: unknown): unknown {
  if (!isObj(args)) throw new Error('tool arguments must be an object')
  if (name === 'verify_document') {
    if (!isObj(args.extraction)) throw new Error('verify_document requires an "extraction" object')
    const opts: VerifyOptions = {}
    if (args.ruleset === 'invoice' || args.ruleset === 'pay-app') opts.ruleset = args.ruleset
    if (isObj(args.references)) opts.references = args.references as VerifyOptions['references']
    if (isObj(args.source)) opts.source = args.source as VerifyOptions['source']
    return toolResult(verify(args.extraction, opts))
  }
  if (name === 'verify_quotes') {
    if (typeof args.source_text !== 'string') throw new Error('verify_quotes requires "source_text"')
    const quotes = Array.isArray(args.quotes) ? (args.quotes as { id: string; quote: string; label?: string }[]) : []
    const values = Array.isArray(args.values) ? (args.values as { id: string; value: number; field: string }[]) : []
    return toolResult(verifyAgainstSource(args.source_text, quotes, values))
  }
  if (name === 'verify_action') {
    if (!isObj(args.action) || typeof (args.action as Record<string, unknown>).tool !== 'string') throw new Error('verify_action requires an "action" with a "tool" and "arguments"')
    const sources: ActionSources = isObj(args.sources) ? (args.sources as ActionSources) : {}
    return toolResult(verifyAction(args.action as unknown as ProposedAction, sources))
  }
  if (name === 'verify_citations') {
    if (!Array.isArray(args.citations)) throw new Error('verify_citations requires a "citations" array')
    const sources: OpinionSources = isObj(args.sources) ? (args.sources as OpinionSources) : {}
    return toolResult(verifyCitations(args.citations as Citation[], sources))
  }
  if (name === 'verify_invoice_match') {
    const docs: ApDocuments | null = typeof args.layout === 'string' ? splitApLayout(args.layout)
      : (typeof args.invoice === 'string' && typeof args.purchase_order === 'string' && typeof args.goods_receipt === 'string')
        ? { invoice: args.invoice, purchase_order: args.purchase_order, goods_receipt: args.goods_receipt } : null
    if (!docs) throw new Error('verify_invoice_match requires {invoice, purchase_order, goods_receipt} strings or a {layout} string with the three ERP section markers')
    const policy = typeof args.price_tolerance === 'number' ? { price_tolerance: args.price_tolerance } : undefined
    return toolResult(verifyInvoiceMatch(docs, policy ? { policy } : {}))
  }
  if (name === 'mine_rules') {
    if (!Array.isArray(args.cases)) throw new Error('mine_rules requires a "cases" array')
    if (!isObj(args.schema)) throw new Error('mine_rules requires a "schema" object')
    const opts: MineOptions = {}
    if (typeof args.max_approved_violation_rate === 'number') opts.maxApprovedViolationRate = args.max_approved_violation_rate
    if (args.thresholds === true) opts.thresholds = true
    return toolResult(mineRules(caseTableFromRows(args.cases), args.schema as unknown as MineSchema, opts, typeof args.ruleset_id === 'string' ? { id: args.ruleset_id } : {}))
  }
  if (name === 'verify_declared') {
    if (!isObj(args.extraction)) throw new Error('verify_declared requires an "extraction" object')
    if (!isDeclarativeRuleset(args.ruleset)) throw new Error('verify_declared requires a valid declarative "ruleset" (fields + checks, no compute)')
    return toolResult(verifyDeclarative(args.extraction, args.ruleset as DeclarativeRuleset))
  }
  throw new Error(`unknown tool: ${name}`)
}

/**
 * Handle one JSON-RPC message. Returns a response, or `null` for notifications (no id / notifications/*), which get no reply.
 */
export function handleRequest(req: JsonRpcRequest): JsonRpcResponse | null {
  const id = req.id ?? null
  const isNotification = req.id === undefined || req.method.startsWith('notifications/')

  try {
    switch (req.method) {
      case 'initialize':
        return ok(id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO })
      case 'tools/list':
        return ok(id, { tools: TOOLS })
      case 'tools/call': {
        const p = req.params
        if (!isObj(p) || typeof p.name !== 'string') return err(id, -32602, 'invalid params: expected { name, arguments }')
        try {
          return ok(id, callTool(p.name, p.arguments))
        } catch (e) {
          // Tool-level failures are reported as an isError tool result, not a protocol error (per MCP).
          return ok(id, { content: [{ type: 'text', text: `verify error: ${(e as Error).message}` }], isError: true })
        }
      }
      case 'ping':
        return ok(id, {})
      default:
        if (isNotification) return null
        return err(id, -32601, `method not found: ${req.method}`)
    }
  } catch (e) {
    if (isNotification) return null
    return err(id, -32603, `internal error: ${(e as Error).message}`)
  }
}

export { TOOLS }
