/**
 * Receipts MCP server — the tools a host agent (Hermes, OpenClaw, Claude Code…) calls so its actions come with receipts.
 *
 *   check_done      an agent's "done" claim vs the real state (JSON files under RECEIPTS_ROOT only)
 *   ap_gate         a model's pay/hold decision vs the deterministic AP checker — only agreement executes; a REVIEW carries
 *                   typed remedies, and a person's signed ruling on that verdict (riposte-ledger rule) is consumed here
 *                   only when its key is pinned for its role (RIPOSTE_AUTHORITIES) and it stays within the role's mandate.
 *                   Its receipt holds hashes and offsets, not the documents (2026-10-03); the proof goes back to the caller.
 *                   `store_documents: true` (or RECEIPTS_STORE_DOCUMENTS=1) stores the documents and the proof instead.
 *   model_attest   which model actually answered, reply by reply (from the host's record), vs the declared model
 *   check_claims    a session's closing claims ("tests pass", "pushed"…) vs what its own tools actually returned
 *   ledger_verify   verify the whole receipt ledger (hash chain + signatures) with no trust in us
 *   loop_round      one round of a closed loop (2026-10-03, T3): your proposal, then the gate's verdict; if it does not execute,
 *                   its typed remedies come back as your next instruction, answered with the same loop_id. At most 3 rounds,
 *                   then a person. The loop's own signed chain and every round's proof come back as one bundle (riposte-loop replay).
 * Every check_done / ap_gate / model_attest result is appended to the hash-chained ledger (RECEIPTS_LEDGER, default ./receipts.jsonl),
 * signed when RECEIPTS_KEY points at an Ed25519 private key (PEM).
 *
 * Dependency-free JSON-RPC 2.0 (same shape as verify's MCP server). `handleRequest` is pure but for the ledger store and the
 * state reader, both injectable for tests.
 */
import { readFileSync } from 'node:fs'
import { resolve, relative, isAbsolute } from 'node:path'
import { splitApLayout, isApStructured, renderCaseReplay, type ApDocuments } from 'riposte-verify'
import { apGate, type ApGateDocuments } from './ap-gate.js'
import { structuredGateRequest } from './ap-request.js'
import { replayAgainstLedger } from './replay-command.js'
import type { Authorities } from './ruling.js'
import { draftResolution } from './ap-resolve.js'
import { checkDone, type DoneClaim, type StateReader } from './done.js'
import { openLedger, type Ledger, type ChainPolicy } from './ledger.js'
import { attestModels, eventsFromClaudeCodeTranscript, eventsFromReplies, type AttestPolicy, type ModelEvent } from './model-attest.js'
import { checkClaims, sessionFromClaudeCodeTranscript } from './claims.js'
import { auditTurns } from './claims-command.js'
import { stamped } from './version.js'
import { AP_POLICY, hashesOnlyBody, historyOf } from './ap-receipt.js'
import { openLoop, LOOP_ROUND_LIMIT, type LoopSession, type LoopProposal, type LoopTask, type AgentModel, type SuppliedFrom, type ApDocKey } from './loop.js'
import { resolveDeclarativeRuleset, isDeclarativeRuleset, canonicalize, type DeclarativeRuleset } from 'riposte-verify'
import { createHash } from 'node:crypto'

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
      'claim is untrue — here is what is actually there) or INSUFFICIENT_DATA (can\'t tell: could not verify — do not claim done). ' +
      'Every result is written to a tamper-evident receipt ledger.',
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
      'hold_line_math | hold_total | hold_duplicate) and the three documents. A deterministic three-way match (invoice ↔ PO ↔ goods ' +
      'receipt) recomputes it; EXECUTE only if it agrees, otherwise REVIEW (a person decides). Returns what is wrong and ' +
      'where, and the typed remedies that would lawfully clear it. The receipt stores hashes and offsets, not the documents; ' +
      'the replayable proof comes back in structuredContent.proof for you to keep (store_documents: true puts it on the ' +
      'ledger instead). Give history (invoices already booked) to run the duplicate check. A person\'s signed ruling on ' +
      'that exact verdict, already on the ledger, may resolve a REVIEW; you cannot write one. Or send structured input ' +
      '(structured: a bill, its PO and its item receipts as JSON, schema riposte.ap-input/0.1.0) instead of the texts; the ' +
      'decision may then come from structured.decision ({ action: pay | hold, reason }). A PASS with a check that could not ' +
      'run (status PASS-WITH-OPEN) never executes a payment, and a verdict with a struck load-bearing field (status OPEN: ' +
      'neither PASS nor FAIL) never executes anything.',
    inputSchema: {
      type: 'object',
      properties: {
        decision: { type: 'string', description: 'approve | hold_no_po | hold_quantity | hold_price | hold_line_math | hold_total | hold_duplicate | hold. Required with the texts; with structured input it may come from structured.decision.' },
        structured: { type: 'object', description: 'The AP input as JSON (riposte.ap-input/0.1.0: schema, bill, purchase_order, item_receipts, payment_history?, decision?). Not with the texts or history.' },
        invoice: { type: 'string' }, purchase_order: { type: 'string' }, goods_receipt: { type: 'string' },
        layout: { type: 'string', description: 'Or all three in one text with the ERP section markers.' },
        history: { type: 'array', items: { type: 'object', properties: { invoice_number: { type: 'string' }, po_number: { type: 'string' }, total: { type: 'number' }, vendor: { type: 'string' }, paid_on: { type: 'string' } }, required: ['invoice_number'] }, description: 'Invoices already booked or paid: enables the duplicate check.' },
        store_documents: { type: 'boolean', description: 'Store the documents and the proof on the ledger (default false: hashes and offsets only).' },
      },
    },
  },
  {
    name: 'replay_receipt',
    description:
      'Re-perform a receipt on this server\'s ledger, offline and without a model: the proof the receipt stores (entry), or the ' +
      'proof you kept from ap_gate (proof), which is re-performed only once it BINDS to its receipt (the verdict\'s hash, id and ' +
      'input hash, and each document\'s sha256 and length are the receipt\'s). Answers MATCH, DIVERGED (naming the field, e.g. ' +
      'documents.invoice.sha256 or verdict_sha256), NOT_REPERFORMED or REFUSED, and says when the ledger itself is not intact.',
    inputSchema: {
      type: 'object',
      properties: {
        entry: { type: ['string', 'number'], description: 'The receipt: its seq, or 8+ hex of its hash. Optional with a proof (the receipt carrying its verdict id is found).' },
        proof: { type: 'object', description: 'The proof you kept: { verdict, inputs } (ap_gate structuredContent.proof).' },
        proofs: { type: 'array', items: { type: 'object' }, description: 'Several kept proofs (at most 1000).' },
      },
    },
  },
  {
    name: 'model_attest',
    description:
      'Attest which model ACTUALLY answered, reply by reply, from what the host recorded (never from what a model says about ' +
      'itself). Give a Claude Code transcript (JSONL, path relative to the workspace root) or a list of API replies, plus the ' +
      'declared model id. PASS = every reply came from the declared model and no switch was silent; FAIL = a reply came from ' +
      'another model or the model changed with nothing announcing it; INSUFFICIENT_DATA = can\'t tell, nothing to attest (no model ' +
      'recorded, or the declared id is a floating alias like "opus"). Every switch is listed. Writes a receipt.',
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
    name: 'check_claims',
    description:
      'Check the completion claims in a session\'s final message ("all tests pass", "the build is clean", "committed", "pushed", ' +
      '"created `x`") against what the session\'s own tools actually returned. Give a Claude Code transcript (JSONL, path ' +
      'relative to the workspace root). PASS = every claim is backed by the latest relevant tool result; FAIL = a claim is ' +
      'contradicted (a failing test run, a rejected push, a different count); INSUFFICIENT_DATA = can\'t tell, a claim has no ' +
      'backing (never ran, ran before a later code edit) or there is nothing checkable. Set all_turns to audit every turn. Writes a receipt.',
    inputSchema: {
      type: 'object',
      properties: {
        transcript: { type: 'string', description: 'Claude Code session transcript (.jsonl), relative to the workspace root.' },
        all_turns: { type: 'boolean', description: 'Audit every turn-ending message instead of only the final one.' },
      },
      required: ['transcript'],
    },
  },
  {
    name: 'ledger_verify',
    description:
      'Verify the entire receipt ledger: every entry chained to the previous one, and (if signed) signed. Anyone can run ' +
      'this, with no trust in us. A chain alone cannot detect a whole-file rewrite, so pin a trust anchor: the expected ' +
      'public key, require_signed, and/or a head hash recorded earlier. Reports who signed (key fingerprints).',
    inputSchema: {
      type: 'object',
      properties: {
        public_key: { type: 'string', description: 'PEM (SPKI) of the only key allowed to have signed entries; every entry must carry its signature (an unsigned entry fails).' },
        require_signed: { type: 'boolean', description: 'Fail on any unsigned entry.' },
        head: { type: 'string', description: 'A hash recorded earlier; the chain must still contain it.' },
      },
    },
  },
  {
    name: 'loop_round',
    description:
      'One round of a closed loop with the gate. Send your proposal; the gate verdicts it. If it executes (you and the checker ' +
      'agree), the loop closes CONVERGED-PASS or CONVERGED-FAIL. If not, the verdict\'s typed remedies come back as your NEXT ' +
      'INSTRUCTION, and you answer with the same loop_id: change only what the remedies name (supply the named document, or ' +
      're-read the named field and quote it from the document), concede (decision hold, or reject), or send decline: true. ' +
      'At most 3 rounds; then the gate holds for a person. A change outside the remedies, or a changed value without a quote ' +
      'that reads as it, is refused and the loop holds. Tasks: "ap" (decision + the three texts; supplied_from names where a ' +
      'document you add came from, with the record in structured_sources; history, the invoices already booked, given when the ' +
      'loop opens: [] when none, or the duplicate check does not run and an approve cannot pay) or "declarative" (decision accept | reject, ' +
      'extraction, ruleset e.g. "peppol-en16931@0.2.0", source { text, quotes }). The loop\'s signed chain and every round\'s ' +
      'proof come back in structuredContent.bundle when it closes; replay it with riposte-loop replay.',
    inputSchema: {
      type: 'object',
      properties: {
        loop_id: { type: 'string', description: 'Omit to open a loop; then the id this tool returned.' },
        task: { type: 'string', enum: ['ap', 'declarative'], description: 'When opening: what is being proposed.' },
        item_id: { type: 'string', description: 'When opening: your id for the item (an invoice number).' },
        decision: { type: 'string', description: 'ap: approve | hold_no_po | hold_quantity | hold_price | hold_line_math | hold_total | hold_duplicate | hold. declarative: accept | reject.' },
        invoice: { type: 'string' }, purchase_order: { type: 'string' }, goods_receipt: { type: 'string', description: 'ap: the three texts ("" for one you do not have).' },
        supplied_from: { type: 'object', description: 'ap: per document you supply, { source, key, part }: the structured-source record it is a part of.' },
        structured_sources: { type: 'object', description: 'ap, when opening: the records you may supply documents from, keyed "<source>:<key>".' },
        history: { type: 'array', items: { type: 'object', properties: { invoice_number: { type: 'string' }, po_number: { type: 'string' }, total: { type: 'number' }, vendor: { type: 'string' }, paid_on: { type: 'string' } }, required: ['invoice_number'] }, description: 'ap, when opening: the invoices already booked ([] when none). Without it the duplicate check does not run, and an approve cannot pay.' },
        extraction: { type: 'object' }, ruleset: { type: ['string', 'object'] }, source: { type: 'object', description: 'declarative: { text, quotes: [{ id: <field path>, quote }] }.' },
        model: { type: 'string', description: 'The model id your host recorded for this reply (recorded as declared, T0; attest it with model_attest).' },
        decline: { type: 'boolean', description: 'Stop: you have no lawful next proposal. The loop holds for a person.' },
        reason: { type: 'string' },
      },
    },
  },
] as const

export interface ServerDeps {
  ledger: Ledger
  read: StateReader
  /** role → pinned public key(s): whose signed rulings ap_gate may consume (absent: every ruling is refused) */
  authorities?: Authorities
  /** raw text under the workspace root (for transcripts); absent → tools that need it return a tool error */
  readText?: (source: string) => string
  /** store ap_gate documents and proofs on the ledger for every call (RECEIPTS_STORE_DOCUMENTS=1); default: hashes only */
  storeDocuments?: boolean
  /** the clock a verdict is issued by (default: now); injectable for tests */
  now?: () => Date
  /** loop_round: the open loops of this session (created on first use), and the key that signs their chains */
  loops?: Map<string, LoopSession>
  loopSigningKey?: string
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
    const entry = deps.ledger.append('done_check', stamped('done_check', r))
    return toolResult({ ...r, receipt: { seq: entry.seq, hash: entry.hash, signed: Boolean(entry.signature) } })
  }
  if (name === 'ap_gate') {
    if (args.store_documents !== undefined && typeof args.store_documents !== 'boolean') throw new Error('ap_gate: store_documents is true or false')
    let docs: ApGateDocuments
    let decision: string
    if (args.structured !== undefined) {
      // 2026-10-03: structured input, the hosted gate's rules (./ap-request.ts). A refusal names each field.
      const s = structuredGateRequest(args)
      if (!s.ok) return { content: [{ type: 'text', text: `ap_gate: ${s.code}: ${s.message}` }], structuredContent: { error: { code: s.code, message: s.message, ...(s.errors ? { errors: s.errors } : {}) } }, isError: true }
      docs = s.docs
      decision = s.decision
    } else {
      if (typeof args.decision !== 'string') throw new Error('ap_gate requires "decision"')
      const read: ApDocuments | null = typeof args.layout === 'string' ? splitApLayout(args.layout)
        : (typeof args.invoice === 'string' && typeof args.purchase_order === 'string' && typeof args.goods_receipt === 'string')
          ? { invoice: args.invoice, purchase_order: args.purchase_order, goods_receipt: args.goods_receipt } : null
      if (!read) throw new Error('ap_gate requires {invoice, purchase_order, goods_receipt}, {layout}, or {structured}')
      const history = args.history !== undefined ? historyOf(args.history) : undefined
      if (typeof history === 'string') throw new Error(`ap_gate: ${history}`)
      docs = history ? { ...read, history } : read
      decision = args.decision
    }
    const structured = isApStructured(docs)
    // Rulings are read from the ledger (written by a person with riposte-ledger rule, never by a tool); each is spent once.
    const entries = deps.ledger.entries()
    const rulings = entries.filter((e) => e.kind === 'ruling').map((e) => e.body)
    const consumed = new Set<string>()
    for (const e of entries) {
      const r = e.kind === 'ap_gate' && isObj(e.body) && isObj(e.body.ruling) ? e.body.ruling.consumed : undefined
      if (Array.isArray(r)) for (const id of r) if (typeof id === 'string') consumed.add(id)
    }
    const g = apGate(decision, docs, { rulings, consumed, ...(deps.authorities ? { authorities: deps.authorities } : {}), ...(deps.now ? { now: deps.now } : {}) })
    // the generative half: when the checker holds, draft what a controller would send (every number a recorded fact)
    const draft = g.check.decision !== 'approve' ? draftResolution(g.check, structured ? undefined : (docs as ApDocuments)) : undefined
    const summary = {
      action: g.action, effect: g.effect, model_decision: g.model_decision, checker_decision: g.checker_decision, status: g.status, reason: g.reason,
      grounding: g.check.grounding, verdict_id: g.check.verdict.verdict_id,
      ...(g.remedies ? { remedies: g.remedies } : {}), ...(g.ruling ? { ruling: g.ruling } : {}), ...(g.refusal ? { refusal: g.refusal } : {}),
      ...(draft ? { resolution: { kind: draft.kind, subject: draft.subject, body: draft.body, ...(draft.short_pay ? { short_pay: draft.short_pay } : {}), facts: draft.facts } } : {}),
    }
    const proof = { verdict: g.check.verdict, inputs: structured ? { ap_structured: docs, policy: AP_POLICY } : { ap: docs, policy: AP_POLICY } }
    if (args.store_documents === true || deps.storeDocuments === true) {
      // The opt-in: the receipt carries the proof (the verdict and the inputs it is bound to), so `riposte-replay --ledger …
      // --entry <seq>` re-performs it from the ledger alone, and the answer stays compact.
      const entry = deps.ledger.append('ap_gate', stamped('ap_gate', { ...summary, proof }))
      return toolResult({ ...summary, receipt: { seq: entry.seq, hash: entry.hash, signed: Boolean(entry.signature), stored: 'documents' } })
    }
    // The default (2026-10-03): hashes and offsets on the ledger, like the hosted gate; the proof comes back to the caller,
    // in structuredContent only (the text view says where it is), and replays with `riposte-replay --ledger … --proof`.
    const entry = deps.ledger.append('ap_gate', hashesOnlyBody(g, docs))
    const answer = { ...summary, receipt: { seq: entry.seq, hash: entry.hash, signed: Boolean(entry.signature), stored: 'hashes' } }
    return {
      content: [{ type: 'text', text: `${JSON.stringify(answer, null, 2)}\n(the replayable proof is in structuredContent.proof: keep it; the ledger stores hashes and offsets only)` }],
      structuredContent: { ...answer, proof }, isError: false,
    }
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
    const entry = deps.ledger.append('model_attest', stamped('model_attest', { source, ...a }))
    return toolResult({ ...a, receipt: { seq: entry.seq, hash: entry.hash, signed: Boolean(entry.signature) } })
  }
  if (name === 'check_claims') {
    if (typeof args.transcript !== 'string') throw new Error('check_claims requires "transcript"')
    if (!deps.readText) throw new Error('this server cannot read transcripts (no text reader configured)')
    const text = deps.readText(args.transcript)
    const source = `transcript:${args.transcript}`
    if (args.all_turns === true) {
      const a = auditTurns(text)
      const entry = deps.ledger.append('claims_check', stamped('claims_check', { source, all_turns: true, ...a }))
      return toolResult({ ...a, receipt: { seq: entry.seq, hash: entry.hash, signed: Boolean(entry.signature) } })
    }
    const r = checkClaims(sessionFromClaudeCodeTranscript(text))
    const entry = deps.ledger.append('claims_check', stamped('claims_check', { source, ...r }))
    return toolResult({ ...r, receipt: { seq: entry.seq, hash: entry.hash, signed: Boolean(entry.signature) } })
  }
  if (name === 'replay_receipt') {
    // 2026-10-03: riposte-replay --ledger over MCP, against this server's own ledger. A proof is re-performed only once it
    // binds to its receipt (verdict hash, verdict id, input hash, each document's sha256 and length).
    if (args.entry !== undefined && typeof args.entry !== 'string' && typeof args.entry !== 'number') throw new Error('replay_receipt: "entry" is a seq or 8+ hex of the entry hash')
    if (args.proof !== undefined && args.proofs !== undefined) throw new Error('replay_receipt: give "proof" or "proofs", not both')
    if (args.proofs !== undefined && (!Array.isArray(args.proofs) || args.proofs.length === 0 || args.proofs.length > 1000)) throw new Error('replay_receipt: "proofs" is an array of 1 to 1000 proofs')
    const proofs = args.proof !== undefined ? [{ name: 'proof', bundle: args.proof }] : Array.isArray(args.proofs) ? args.proofs.map((b, i) => ({ name: `proof[${i}]`, bundle: b })) : undefined
    if (args.entry === undefined && !proofs) throw new Error('replay_receipt: give "entry" (a receipt that stores its proof), "proof", or both')
    const r = replayAgainstLedger(deps.ledger.entries(), { ...(args.entry !== undefined ? { entry: String(args.entry) } : {}), ...(proofs ? { proofs } : {}) }, 'ledger')
    if (r.refused !== undefined) return { content: [{ type: 'text', text: `replay_receipt: ${r.refused}` }], structuredContent: { refused: r.refused, warnings: r.warnings }, isError: true }
    const lines = r.summary.cases.map((c) => renderCaseReplay(c))
    const answer = { ...r.summary, ...(r.bindings ? { bindings: r.bindings } : {}), intact: r.intact, warnings: r.warnings, lines }
    const tail = `replay: ${r.summary.total} case(s): ${r.summary.matched} match · ${r.summary.diverged} diverged · ${r.summary.not_reperformed} not re-performed · ${r.summary.refused} refused${r.intact ? '' : ' (the ledger is not intact: see warnings)'}`
    return { content: [{ type: 'text', text: `${lines.join('\n')}\n${tail}` }], structuredContent: answer, isError: r.summary.diverged > 0 || r.summary.refused > 0 || !r.intact }
  }
  if (name === 'loop_round') return loopRound(args, deps)
  if (name === 'ledger_verify') {
    const policy: ChainPolicy = {}
    if (typeof args.public_key === 'string') policy.publicKey = args.public_key
    if (args.require_signed === true) policy.requireSigned = true
    if (typeof args.head === 'string') policy.head = args.head
    return toolResult(deps.ledger.verify(policy))
  }
  throw new Error(`unknown tool: ${name}`)
}

const sha256Of = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex')

/** loop_round (T3, 2026-10-03): open a loop, or answer its last instruction; see the tool's description and ./loop.ts. */
function loopRound(args: Record<string, unknown>, deps: ServerDeps): unknown {
  const loops = deps.loops ?? (deps.loops = new Map<string, LoopSession>())
  const model: AgentModel = typeof args.model === 'string' && args.model.trim()
    ? { model: args.model, evidence_tier: 'T0', note: 'declared by the caller; attest it with model_attest over the host\'s record' }
    : { model: null, evidence_tier: 'T0', note: 'no model declared by the caller' }
  let loop: LoopSession
  let task: LoopTask['kind']
  if (args.loop_id === undefined) {
    if (args.decline === true) throw new Error('loop_round: there is no loop to decline (no loop_id)')
    if (args.task !== 'ap' && args.task !== 'declarative') throw new Error('loop_round: to open a loop, give task "ap" or "declarative"')
    task = args.task === 'ap' ? 'ap-text' : 'declarative'
    let ruleset: DeclarativeRuleset | undefined
    if (task === 'declarative') {
      ruleset = typeof args.ruleset === 'string' ? resolveDeclarativeRuleset(args.ruleset) : isDeclarativeRuleset(args.ruleset) ? args.ruleset as DeclarativeRuleset : undefined
      if (!ruleset) throw new Error('loop_round: a declarative loop needs "ruleset": a name this build carries (e.g. "peppol-en16931@0.2.0") or the ruleset JSON')
    }
    const input = task === 'ap-text' ? String(args.invoice ?? '') : canonicalize({ extraction: args.extraction ?? null, source: args.source ?? null })
    const sources = isObj(args.structured_sources) ? Object.fromEntries(Object.entries(args.structured_sources).filter((e): e is [string, string] => typeof e[1] === 'string')) : {}
    // the books for an "ap" loop (engine 0.6.0): [] = known and empty, so the duplicate check runs; absent = not run
    const history = task === 'ap-text' && args.history !== undefined ? historyOf(args.history) : undefined
    if (typeof history === 'string') throw new Error(`loop_round: ${history}`)
    loop = openLoop({ kind: task, item_id: typeof args.item_id === 'string' ? args.item_id : 'item', input_sha256: sha256Of(input), ...(ruleset ? { ruleset } : {}), ...(history ? { history } : {}) },
      { id: 'mcp-caller', description: 'the agent calling loop_round' },
      { ...(deps.loopSigningKey ? { signingKey: deps.loopSigningKey } : {}), ...(deps.now ? { now: deps.now } : {}), structuredSources: sources })
    loops.set(loop.loop_id, loop)
  } else {
    if (typeof args.loop_id !== 'string' || !loops.has(args.loop_id)) throw new Error(`loop_round: no open loop ${String(args.loop_id)} in this session`)
    loop = loops.get(args.loop_id)!
    task = loop.bundle().task.kind
  }
  const session = loop
  const finish = (closed: NonNullable<LoopSession['closed']>, extra: Record<string, unknown> = {}): unknown => {
    const bundle = session.bundle()
    // the server's own ledger anchors the loop: one receipt with its top hash (the loop's rows live on the loop's chain)
    const entry = deps.ledger.append('loop.close', { loop_id: session.loop_id, item_id: bundle.task.item_id, outcome: closed.outcome, rounds_used: closed.rounds_used, top_hash: bundle.top_hash, reason: closed.reason })
    loops.delete(session.loop_id)
    const answer = { loop_id: session.loop_id, closed, ...extra, receipt: { seq: entry.seq, hash: entry.hash, signed: Boolean(entry.signature) } }
    return {
      content: [{ type: 'text', text: `${closed.outcome} after ${closed.rounds_used} round(s): ${closed.reason}\nloop_id: ${session.loop_id} (the loop's bundle, with every round's proof, is in structuredContent.bundle: keep it)` }],
      structuredContent: { ...answer, bundle }, isError: false,
    }
  }
  if (args.decline === true) return finish(session.decline(typeof args.reason === 'string' ? args.reason : 'the agent declined', model))
  if (typeof args.decision !== 'string') throw new Error('loop_round: give "decision" (or decline: true)')
  let proposal: LoopProposal
  if (task === 'ap-text') {
    const documents = { invoice: String(args.invoice ?? ''), purchase_order: String(args.purchase_order ?? ''), goods_receipt: String(args.goods_receipt ?? '') }
    let supplied: Partial<Record<ApDocKey, SuppliedFrom>> | undefined
    if (isObj(args.supplied_from)) {
      const known = session.bundle().structured_sources ?? {}
      supplied = {}
      for (const [k, v] of Object.entries(args.supplied_from)) {
        if (!['invoice', 'purchase_order', 'goods_receipt'].includes(k) || !isObj(v) || typeof v.source !== 'string' || typeof v.key !== 'string') throw new Error(`loop_round: supplied_from.${k} is { source, key, part? }`)
        const rec = known[`${v.source}:${v.key}`]
        supplied[k as ApDocKey] = { source: v.source, key: v.key, record_sha256: rec === undefined ? '' : sha256Of(rec), part: (typeof v.part === 'string' ? v.part : k) as ApDocKey }
      }
    }
    proposal = { kind: 'ap-text', decision: args.decision, documents, ...(supplied ? { supplied_from: supplied } : {}) }
  } else {
    if (args.decision !== 'accept' && args.decision !== 'reject') throw new Error('loop_round: a declarative decision is accept or reject')
    if (!isObj(args.extraction)) throw new Error('loop_round: give "extraction"')
    const src = isObj(args.source) && typeof args.source.text === 'string' ? { source: args.source as { text: string; quotes?: { id: string; quote: string }[] } } : {}
    proposal = { kind: 'declarative', decision: args.decision, extraction: args.extraction, ...src }
  }
  const r = session.submit(proposal, model)
  const verdict = r.gate ? { verdict_id: r.gate.bundle.verdict.verdict_id, outcome: r.gate.bundle.verdict.outcome, status: r.gate.status, action: r.gate.action, effect: r.gate.effect, reason: r.gate.reason } : undefined
  if (r.closed) return finish(r.closed, { round: r.round, ...(verdict ? { verdict } : {}), ...(r.refused ? { refused: r.refused } : {}) })
  const ins = r.instruction!
  const answer = { loop_id: session.loop_id, round: r.round, rounds_left: ins.rounds_left, verdict, instruction: ins, proof: r.gate!.bundle }
  return {
    content: [{ type: 'text', text: `${ins.text}\nloop_id: ${session.loop_id} (answer with this id; ${ins.rounds_left} of ${LOOP_ROUND_LIMIT} rounds left)` }],
    structuredContent: answer, isError: false,
  }
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
