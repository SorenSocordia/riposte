/**
 * The closed loop (2026-10-03, T3): an agent proposes, the gate issues a verdict with typed remedies, the remedies go back to
 * the SAME agent as its next instruction, the corrected proposal is verdicted again, and after a bounded number of rounds the
 * gate holds for a person. Every round is a signed, hash-chained row; the whole loop is one replayable bundle.
 *
 *   const loop = openLoop({ kind: 'ap-text', item_id: 'INV-1', input_sha256 }, { id: 'my-agent' })
 *   let r = loop.submit(proposal, { model: 'claude-…', evidence_tier: 'T1' })
 *   while (!r.closed) r = loop.submit(fix(r.instruction!), …)   // or loop.decline('nothing I can do')
 *   const bundle = loop.bundle()                                  // verifyLoopBundle(bundle, { replayRound }) re-checks it
 *
 * THE ROUND CONTRACT (riposte-loop/v1), rows on the loop's own chain:
 *   loop.open            task, input hash, ruleset id@version (+ sha256 for a declarative one), the agent, round limit
 *   loop.proposal        round n: the proposal's sha256, its decision, the agent's model AS RESOLVED for that round (with its
 *                        evidence tier), and from round 2 the edit discipline's finding
 *   loop.verdict         round n: the verify bundle's sha256, verdict id, outcome, gate status, action/effect, remedy ids
 *   loop.remedy_returned round n: the instruction handed back (its sha256 and remedy ids); it embeds the verdict's remedies
 *                        byte for byte, and verifyLoopBundle checks that it does
 *   loop.close           CONVERGED-PASS | CONVERGED-FAIL | HELD-FOR-HUMAN, rounds used, why
 * The bundle carries the chain, every round's proposal, verify bundle ({ verdict, inputs }) and instruction, and its top hash
 * is the chain head, which commits (through the rows) to every proposal and verify bundle by sha256.
 *
 * THE EDIT DISCIPLINE (the loop's own check, between rounds). A remedy is an instruction to re-read or supply an operand, so:
 *   scope       a value may change only inside the scope of the previous verdict's operand remedies (recompute-with and
 *               missing-operand naming a field of the document): the fields bound to every operand role of every claim the
 *               remedy answers, plus its own operand path. AP: the document a remedy names as its operand source.
 *   provenance  a changed declarative value carries a quote that is found verbatim in the source text and reads as the value;
 *               a supplied AP document names its structured source and hashes to it.
 *   append-only the source text may only grow (the earlier text stays its prefix): an agent cannot re-read the page by
 *               rewriting what it was read as.
 * A proposal that breaks it is refused, never gated, and the loop holds for a person naming the field. Without it, an agent
 * told to "re-read BT-115" could set BT-115 to the figure the rule expects and keep its old quote: verify checks that a quote
 * is on the page, not that it is the value (measured in the T3 run's control arm).
 *
 * REMEDIES ARE RE-DERIVED, NEVER TAKEN FROM A BUNDLE (2026-10-04; RT1 F9). The remedies an agent is handed
 * are an instruction, so their text must come from the ruleset the loop pinned at loop.open, not from whatever a verdict
 * carries. After the gate issues a round's verdict, the loop re-performs it with verify's own replay (verifyReplay, engine
 * 0.2.0 on), a declarative round under the PINNED ruleset, and hands the agent the re-performed verdict's remedies. The
 * loop.verdict row records their sha256 (`remedies_sha256`, `remedies_source: "rederived"`). A verdict that does not
 * re-perform, or whose own remedies are not the re-derived ones (a doctored remedy table under a carried ruleset's name, say), is
 * REFUSED for the round: nothing executes, nothing is handed back, the loop holds for a person, and the row says why
 * (`remedies_refused`). verifyLoopBundle re-derives the same way. A loop that works like this says so on loop.open
 * (`remedies: "rederived"`); a bundle written before it still replays, and its instructions are still checked against the
 * re-derived remedies.
 *
 * WHAT IT DOES NOT PROVE. It does not attest the model: the per-round model field is what the caller says it resolved, with
 * the evidence tier the caller states (attest it with model_attest over the host's own record). It trusts the reader that
 * produced the source text; binding a source page to a re-performable reading of the document is the extraction contract's
 * job. A remedy never changes a verdict here either: each round is a new verdict, the old ones stay on the chain. A custom
 * ruleset this build does not carry by name is pinned only by loop.open's sha256: the re-derivation then proves the remedies
 * are that ruleset's, and only a pinned signing key proves the loop opened with it.
 */
import { randomBytes } from 'node:crypto'
import { apGate } from './ap-gate.js'
import { AP_POLICY, historyOf, sha256Hex } from './ap-receipt.js'
import { AP_GATE_DECISIONS } from './ap-request.js'
import { openLedger, memoryStore, verifyChain, type LedgerEntry, type ChainPolicy, type Ledger } from './ledger.js'
import { AP_RULESET, canonicalize, gateStatusOpen, splitApLayout, verifyDeclarative, verifyReplay, type DeclarativeRuleset, type GateStatusOpen, type PriorInvoice, type Remedy, type Verdict } from 'riposte-verify'

export const LOOP_PROTOCOL = 'riposte-loop/v1'
export const LOOP_ROUND_LIMIT = 3
/** loop.open's mark for a loop that hands the agent re-derived remedies, and the loop.verdict rows' `remedies_source` */
export const REMEDIES_REDERIVED = 'rederived'
export const LOOP_ROW_KINDS = ['loop.open', 'loop.proposal', 'loop.verdict', 'loop.remedy_returned', 'loop.close'] as const
export type LoopRowKind = typeof LOOP_ROW_KINDS[number]

export type LoopOutcome = 'CONVERGED-PASS' | 'CONVERGED-FAIL' | 'HELD-FOR-HUMAN'
export type ApDocKey = 'invoice' | 'purchase_order' | 'goods_receipt'
export const AP_DOC_KEYS: readonly ApDocKey[] = ['invoice', 'purchase_order', 'goods_receipt']

/** Where a supplied AP document came from: a named part of a structured-source record the bundle carries. */
export interface SuppliedFrom { source: string; key: string; record_sha256: string; part: ApDocKey }

export interface ApTextProposal {
  kind: 'ap-text'
  /** approve | hold_no_po | hold_quantity | hold_price | hold_line_math | hold_total | hold_duplicate | hold */
  decision: string
  documents: Record<ApDocKey, string>
  supplied_from?: Partial<Record<ApDocKey, SuppliedFrom>>
}
export interface DeclarativeProposal {
  kind: 'declarative'
  decision: 'accept' | 'reject'
  extraction: Record<string, unknown>
  source?: { text: string; quotes?: { id: string; quote: string }[] }
}
export type LoopProposal = ApTextProposal | DeclarativeProposal

export interface LoopTask {
  kind: 'ap-text' | 'declarative'
  item_id: string
  /** sha256 of what the agent was given (the invoice text, the PDF's bytes…): the loop's input */
  input_sha256: string
  description?: string
  /** declarative: the ruleset the gate applies (carried whole in the bundle, so a replay needs nothing else) */
  ruleset?: DeclarativeRuleset
  /**
   * ap-text (2026-10-05, engine 0.6.0): the invoices already booked, as whoever opens the loop knows them (the
   * books, never the agent: an agent that could say "nothing is booked" could pass the duplicate check). [] means the books
   * are known and empty, so the duplicate check runs. Absent, the check does not run, and under engine 0.6.0 an approve
   * reads PASS-WITH-OPEN and never pays. Recorded on loop.open, so a replay re-derives the gate with the same books.
   */
  history?: PriorInvoice[]
}

/** The documents the AP gate checks for an ap-text proposal: its three texts, plus the task's books when it carries them. */
export function apDocsOf(task: LoopTask, p: ApTextProposal): { invoice: string; purchase_order: string; goods_receipt: string; history?: PriorInvoice[] } {
  return { invoice: p.documents.invoice, purchase_order: p.documents.purchase_order, goods_receipt: p.documents.goods_receipt, ...(task.history !== undefined ? { history: task.history } : {}) }
}

/** The agent's model for one round, as resolved (never a guess): null for a program with no model. */
export interface AgentModel {
  model: string | null
  /** none (no model) · T0 declared only · T1 the provider's per-message model field · T2 provider export · T3 signed anchor */
  evidence_tier: 'none' | 'T0' | 'T1' | 'T2' | 'T3'
  /** the program that produced the proposal (a stand-in's id@version), and its source's sha256 */
  program?: string
  program_sha256?: string
  /** the reply that carried it (the provider's message id), when there is one */
  message_id?: string
  note?: string
}
export interface LoopAgent { id: string; description?: string }

export type GateEffect = 'PAY' | 'HOLD' | 'ACCEPT' | 'REJECT' | 'HUMAN_REVIEW'
export interface VerifyBundle { verdict: Verdict; inputs: unknown }
export interface LoopGateResult {
  bundle: VerifyBundle
  /** the gate reading with OPEN (verify's gateStatusOpen, 2026-10-04): OPEN never executes */
  status: GateStatusOpen
  action: 'EXECUTE' | 'REVIEW'
  effect: GateEffect
  reason: string
  /** in a loop session's results: the remedies re-derived from the pinned ruleset (rederiveRemedies), never the verdict's text */
  remedies: Remedy[]
}

/** What re-deriving one round's remedies found (rederiveRemedies). */
export interface RemedyDerivation {
  /** the remedies re-derived from the pinned ruleset: what the agent is handed ([] when the round is refused before re-deriving) */
  remedies: Remedy[]
  /** sha256 of the canonical JSON of `remedies` */
  remedies_sha256: string
  /** present when the round is refused: the verdict did not re-perform, or its remedies are not the re-derived ones */
  refused?: string
}

export interface Discipline {
  ok: boolean
  /** every path whose value changed (declarative: flattened extraction paths; AP: document keys) */
  changed: string[]
  /** changed paths no operand remedy of the previous verdict reaches */
  out_of_scope: string[]
  /** changed values without a quote on the page that reads as them (or a supplied document without its source) */
  unproven: { path: string; reason: string }[]
  /** the source text did not keep the previous round's text as its prefix */
  source_rewritten?: boolean
  /** the scope the previous verdict's remedies opened (sorted) */
  scope: string[]
}

export interface LoopInstruction {
  protocol: typeof LOOP_PROTOCOL
  loop_id: string
  /** the round whose verdict produced this instruction; the agent's answer is round + 1 */
  round: number
  rounds_left: number
  verdict_id: string
  outcome: string
  status: GateStatusOpen
  reason: string
  /** the remedies re-derived from the pinned ruleset, which equal the verdict's own byte for byte ([] when it carries none) */
  remedies: Remedy[]
  /** the same, in words: what the agent reads */
  text: string
}

export interface LoopRound {
  round: number
  proposal: LoopProposal
  agent: AgentModel
  discipline?: Discipline
  verify_bundle?: VerifyBundle
  instruction?: LoopInstruction
}

export interface LoopBundle {
  protocol: typeof LOOP_PROTOCOL
  loop_id: string
  task: LoopTask
  agent: LoopAgent
  round_limit: number
  discipline: boolean
  chain: LedgerEntry[]
  rounds: LoopRound[]
  /** structured-source records the agent supplied documents from (key: `<source>:<key>`) */
  structured_sources?: Record<string, string>
  /** the chain head: commits to every row, and through them to every proposal and verify bundle */
  top_hash: string
}

export interface LoopClose { outcome: LoopOutcome; rounds_used: number; reason: string; final_verdict_id: string | null }
export interface RoundResult {
  round: number
  /** the edit discipline refused this proposal (it was not gated) */
  refused?: Discipline
  /** the round's verdict was refused: its remedies do not re-derive from the pinned ruleset (nothing executed or handed back) */
  remedies_refused?: string
  gate?: LoopGateResult
  instruction?: LoopInstruction
  closed?: LoopClose
}

export interface LoopOptions {
  signingKey?: string
  now?: () => Date
  roundLimit?: number
  /** the edit discipline (default on). Off exists to measure what it holds back; a bundle records which. */
  discipline?: boolean
  loopId?: string
  structuredSources?: Record<string, string>
}

export interface LoopSession {
  readonly loop_id: string
  readonly closed: LoopClose | undefined
  readonly round: number
  submit(proposal: LoopProposal, agent: AgentModel): RoundResult
  /** the agent has no further proposal: the loop holds for a person */
  decline(reason: string, agent?: AgentModel): LoopClose
  bundle(): LoopBundle
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
export const canonicalSha256 = (x: unknown): string => sha256Hex(canonicalize(x))
/** A remedy's id: the first 16 hex of the sha256 of its canonical JSON (content-addressed, so identical remedies share it). */
export const remedyId = (r: Remedy): string => canonicalSha256(r).slice(0, 16)

// ----------------------------------------------------------------------------------------------------------- the gates

/** The gate on one proposal: the AP three-way match (receipts' apGate), or a declarative ruleset read at the gate. */
export function loopGate(task: LoopTask, p: LoopProposal, now?: () => Date): LoopGateResult {
  if (p.kind === 'ap-text') {
    if (task.kind !== 'ap-text') throw new Error(`the task is ${task.kind}; this proposal is ap-text`)
    const docs = apDocsOf(task, p)
    const g = apGate(p.decision, docs, now ? { now } : {})
    return {
      bundle: { verdict: g.check.verdict, inputs: { ap: docs, policy: AP_POLICY } },
      status: g.status, action: g.action, effect: g.effect, reason: g.reason, remedies: g.check.verdict.remedies ?? [],
    }
  }
  if (task.kind !== 'declarative' || !task.ruleset) throw new Error('a declarative proposal needs a declarative task with its ruleset')
  const v = verifyDeclarative(p.extraction, task.ruleset, { ...(p.source ? { source: p.source } : {}), ...(now ? { now } : {}) })
  const inputs = { extraction: p.extraction, ruleset: task.ruleset, ...(p.source ? { source: p.source } : {}) }
  return { bundle: { verdict: v, inputs }, ...declarativeReading(v, p.decision), remedies: v.remedies ?? [] }
}

/**
 * The gate reading of a declarative verdict for a decision: accept executes only on PASS, reject only on FAIL. It reads OPEN
 * (verify's gateStatusOpen, 2026-10-04): a verdict with a struck load-bearing field is OPEN, never PASS and never FAIL, so it
 * executes neither decision. Readings of every verdict without a struck field are what they were (gateStatus).
 */
export function declarativeReading(v: Verdict, decision: string): { status: GateStatusOpen; action: 'EXECUTE' | 'REVIEW'; effect: GateEffect; reason: string } {
  const status = gateStatusOpen(v)
  if (decision === 'accept' && status === 'PASS') return { status, action: 'EXECUTE', effect: 'ACCEPT', reason: 'every check passed: the proposal is accepted' }
  if (decision === 'reject' && status === 'FAIL') return { status, action: 'EXECUTE', effect: 'REJECT', reason: 'the agent and the verdict agree: the document fails, and it is rejected' }
  const open = v.claims.filter((c) => c.outcome !== 'PASS').map((c) => `${c.claim_id} ${c.outcome === 'INSUFFICIENT_DATA' ? `could not run (${c.insufficiency?.reason ?? 'insufficient data'})` : 'FAIL'}`)
  const why = status === 'OPEN' ? `the verdict is OPEN: ${openReason(v)}`
    : status === 'PASS' ? 'every check passed, but the agent proposed to reject'
      : status === 'FAIL' ? `the verdict FAILs (${open.join('; ')})`
        : status === 'PASS-WITH-OPEN' ? `every check that ran passed, but ${open.length} could not run (${open.join('; ')})`
          : `the verdict could not decide (${open.join('; ')})`
  return { status, action: 'REVIEW', effect: 'HUMAN_REVIEW', reason: `not executed: the agent proposed "${decision}"; ${why}` }
}

/** "PAYABLE (suspect) is struck, and 2 checks wait on it": the struck load-bearing fields of an OPEN verdict, in words. */
export function openReason(v: Pick<Verdict, 'struck' | 'would_unlock'>): string {
  const struck = (v.struck ?? []).map((s) => `${s.field} (${s.reason})`)
  const waiting = new Set((v.would_unlock ?? []).flatMap((w) => w.claims))
  const fields = struck.length ? struck : (v.would_unlock ?? []).filter((w) => w.claims.length).map((w) => w.field)
  return `${fields.join(', ') || 'a load-bearing field'} ${fields.length === 1 ? 'is' : 'are'} struck, and ${waiting.size} check${waiting.size === 1 ? ' waits' : 's wait'} on ${fields.length === 1 ? 'it' : 'them'}; it resolves by evidence, never by a typed value`
}

/**
 * Re-derive one round's remedies from the PINNED ruleset (see the header): verify's own replay re-performs the round's
 * verdict, a declarative one under `task.ruleset` (the ruleset loop.open pinned by sha256; a round whose inputs carry any
 * other ruleset is refused), and the re-performed verdict's remedies are the ones the agent may be handed. Refused, with the
 * reason: a verdict that does not re-perform (verify names why, e.g. a remedy that is not the carried ruleset's), or one whose
 * own remedies are not the re-derived ones. Pure but for verify's engine; never throws.
 */
export function rederiveRemedies(task: LoopTask, vb: VerifyBundle): RemedyDerivation {
  const refuse = (why: string, remedies: Remedy[] = []): RemedyDerivation => ({ remedies, remedies_sha256: canonicalSha256(remedies), refused: why })
  try {
    if (!isObj(vb) || !isObj(vb.verdict) || !isObj(vb.inputs)) return refuse('the round carries no verify bundle { verdict, inputs } to re-derive from')
    let inputs = vb.inputs as Record<string, unknown>
    if (task.kind === 'declarative') {
      if (!task.ruleset) return refuse('a declarative loop has no pinned ruleset to re-derive from')
      if (canonicalSha256(inputs.ruleset) !== canonicalSha256(task.ruleset)) return refuse(`the round's inputs carry a ruleset other than the one the loop pinned (${task.ruleset.id}@${task.ruleset.version}, sha256 ${canonicalSha256(task.ruleset).slice(0, 16)}…)`)
      inputs = { ...inputs, ruleset: task.ruleset }
    }
    const r = verifyReplay(vb.verdict, inputs)
    const rederived = r.reperformed?.remedies ?? []
    if (r.status !== 'REPERFORMED') {
      const why = r.reason ?? r.not_reperformed ?? `verify replay: ${r.status}`
      return refuse(r.status === 'STRUCTURE_ONLY' ? `the remedies cannot be re-derived: ${why}` : `the verdict does not re-perform under the pinned ruleset: ${why}`, rederived)
    }
    const carried = vb.verdict.remedies ?? []
    if (canonicalize(carried) !== canonicalize(rederived)) return refuse('the verdict\'s remedies are not the ones re-derived from the pinned ruleset (it carries none, or other ones)', rederived)
    return { remedies: structuredClone(rederived), remedies_sha256: canonicalSha256(rederived) }
  } catch (e) {
    return refuse(`the remedies could not be re-derived (${(e as Error).message})`)
  }
}

// ------------------------------------------------------------------------------------------------- the edit discipline

/** Flatten an extraction to `a.b`, `lines[0].x` paths → leaf values (strings, numbers, booleans, null). */
export function flattenPaths(x: unknown, prefix = '', out: Map<string, unknown> = new Map()): Map<string, unknown> {
  if (Array.isArray(x)) {
    if (!x.length && prefix) out.set(prefix, '[]')
    x.forEach((v, i) => flattenPaths(v, `${prefix}[${i}]`, out))
  } else if (isObj(x)) {
    const keys = Object.keys(x)
    if (!keys.length && prefix) out.set(prefix, '{}')
    for (const k of keys) flattenPaths(x[k], prefix ? `${prefix}.${k}` : k, out)
  } else if (prefix) out.set(prefix, x)
  return out
}

const ROLE_RE = /[A-Za-z_][A-Za-z0-9_]*/g
/** The field roles an expression names (identifiers that are fields of the ruleset), with whether each sits inside sum(). */
function rolesOf(expr: unknown, fields: Record<string, unknown>): { role: string; summed: boolean }[] {
  if (typeof expr !== 'string') return []
  const out: { role: string; summed: boolean }[] = []
  for (const m of expr.matchAll(ROLE_RE)) {
    const role = m[0]
    if (!Object.prototype.hasOwnProperty.call(fields, role)) continue
    const before = expr.slice(0, m.index).replace(/\s+/g, '')
    out.push({ role, summed: /sum\($/.test(before) })
  }
  return out
}

/** Every path a field role may be written under (a line role at line i, or at every line as `[*]`). */
function pathsOfRole(rs: DeclarativeRuleset, role: string, line: number | '*' | null): string[] {
  const f = (rs.fields as Record<string, { paths?: string[]; line?: boolean }>)[role]
  if (!f || !Array.isArray(f.paths)) return []
  if (!f.line) return [...f.paths]
  const keys = (rs as { lineArrayKeys?: string[] }).lineArrayKeys ?? ['lines', 'line_items']
  const at = line === null ? '*' : line
  return keys.flatMap((k) => f.paths!.map((p) => `${k}[${at}].${p}`))
}

/** The scope a verdict's operand remedies open over a declarative document (see the header). */
export function declarativeScope(rs: DeclarativeRuleset, remedies: readonly Remedy[]): string[] {
  const fields = rs.fields as Record<string, unknown>
  const checks = (rs as { checks?: { code: string; left?: unknown; right?: unknown; alternatives?: { left?: unknown; right?: unknown }[] }[] }).checks ?? []
  const scope = new Set<string>()
  for (const r of remedies) {
    if (r.kind !== 'recompute-with' && r.kind !== 'missing-operand') continue
    const role = r.operand?.role
    if (!role || !Object.prototype.hasOwnProperty.call(fields, role)) continue // e.g. "a corrected invoice from the seller"
    if (r.operand?.path) scope.add(r.operand.path)
    for (const claim of r.claims) {
      const m = /^(?:document|line\[(\d+)\])\.(.+)$/.exec(claim)
      if (!m) continue
      const line = m[1] !== undefined ? Number(m[1]) : null
      const check = checks.find((c) => c.code === m[2])
      if (!check) continue
      const exprs = [check.left, check.right, ...(check.alternatives ?? []).flatMap((a) => [a.left, a.right])]
      for (const e of exprs) {
        for (const { role: rr, summed } of rolesOf(e, fields)) {
          const isLine = Boolean((fields[rr] as { line?: boolean }).line)
          for (const p of pathsOfRole(rs, rr, isLine ? (summed || line === null ? '*' : line) : null)) scope.add(p)
        }
      }
      // the remedy's own role, at this claim's line
      for (const p of pathsOfRole(rs, role, (fields[role] as { line?: boolean }).line ? (line ?? '*') : null)) scope.add(p)
    }
  }
  return [...scope].sort()
}

/** Does a scope (declarativeScope) reach this concrete path? `lines[*].x` reaches every line's x. */
export const scopeCovers = (path: string, scope: readonly string[]): boolean =>
  scope.some((s) => s === path || (s.includes('[*]') && new RegExp(`^${s.replace(/[.+?^${}()|\\]/g, '\\$&').replace(/\[\*\]/g, '\\[\\d+\\]').replace(/\[(\d+)\]/g, '\\[$1\\]')}$`).test(path)))

/** Does `quote` read as `value`? A number: some token parses strictly to it, either decimal convention. A string: contained. */
export function quoteReadsAs(quote: string, value: unknown): boolean {
  if (typeof value === 'string') return value.length > 0 && quote.includes(value)
  if (typeof value !== 'number' || !Number.isFinite(value)) return false
  for (const raw of quote.split(/\s+/)) {
    const t = raw.replace(/^[A-Z]{3}/, '').replace(/%$/, '')
    const reads: number[] = []
    if (/^-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(t)) reads.push(Number(t.replace(/,/g, '')))
    if (/^-?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?$/.test(t)) reads.push(Number(t.replace(/\./g, '').replace(',', '.')))
    if (reads.some((n) => Number.isFinite(n) && Math.abs(n - value) < 1e-9)) return true
  }
  return false
}

/** The edit discipline between two consecutive proposals (see the header). Pure: a replay re-derives it. */
export function editDiscipline(task: LoopTask, prev: LoopProposal, next: LoopProposal, prevRemedies: readonly Remedy[], structuredSources: Record<string, string> = {}): Discipline {
  if (prev.kind !== next.kind) return { ok: false, changed: ['kind'], out_of_scope: ['kind'], unproven: [], scope: [] }
  if (next.kind === 'ap-text' && prev.kind === 'ap-text') {
    const scope = [...new Set(prevRemedies.map((r) => r.operand?.source).filter((s): s is ApDocKey => (AP_DOC_KEYS as readonly string[]).includes(String(s))))].sort()
    const changed = AP_DOC_KEYS.filter((k) => prev.documents[k] !== next.documents[k])
    const out_of_scope = changed.filter((k) => !scope.includes(k))
    const unproven = changed.map((k) => ({ path: k, reason: suppliedProblem(next, k, structuredSources) })).filter((u): u is { path: ApDocKey; reason: string } => u.reason !== undefined)
    return { ok: !out_of_scope.length && !unproven.length, changed, out_of_scope, unproven, scope }
  }
  if (next.kind !== 'declarative' || prev.kind !== 'declarative' || !task.ruleset) return { ok: false, changed: [], out_of_scope: [], unproven: [{ path: 'task', reason: 'a declarative proposal needs the task\'s ruleset' }], scope: [] }
  const scope = declarativeScope(task.ruleset, prevRemedies)
  const a = flattenPaths(prev.extraction), b = flattenPaths(next.extraction)
  const changed = [...new Set([...a.keys(), ...b.keys()])].filter((k) => canonicalize(a.get(k) ?? null) !== canonicalize(b.get(k) ?? null) || a.has(k) !== b.has(k)).sort()
  const out_of_scope = changed.filter((k) => !scopeCovers(k, scope))
  const text = next.source?.text ?? ''
  const quotes = new Map((next.source?.quotes ?? []).map((q) => [q.id, q.quote]))
  const unproven: { path: string; reason: string }[] = []
  for (const k of changed) {
    if (!b.has(k) || b.get(k) === null || b.get(k) === undefined) continue // moving toward unknown needs no quote
    const q = quotes.get(k)
    if (q === undefined) { unproven.push({ path: k, reason: 'changed without a quote' }); continue }
    if (!text.includes(q)) { unproven.push({ path: k, reason: `its quote "${q}" is not in the source text` }); continue }
    if (!quoteReadsAs(q, b.get(k))) unproven.push({ path: k, reason: `its quote "${q}" does not read as ${JSON.stringify(b.get(k))}` })
  }
  const before = prev.source?.text ?? ''
  const source_rewritten = !text.startsWith(before)
  return { ok: !out_of_scope.length && !unproven.length && !source_rewritten, changed, out_of_scope, unproven, ...(source_rewritten ? { source_rewritten } : {}), scope }
}

function suppliedProblem(p: ApTextProposal, k: ApDocKey, sources: Record<string, string>): string | undefined {
  const s = p.supplied_from?.[k]
  if (!s) return 'supplied without naming its source'
  const record = sources[`${s.source}:${s.key}`]
  if (record === undefined) return `its source record ${s.source}:${s.key} is not carried`
  if (sha256Hex(record) !== s.record_sha256) return `its source record ${s.source}:${s.key} does not hash to ${s.record_sha256.slice(0, 16)}…`
  if (structuredPart(record, s.part) !== p.documents[k]) return `it is not the ${s.part} part of ${s.source}:${s.key}`
  return undefined
}

/** A part of an ERP-style record (the purchase order or the goods receipt, by verify's section markers). */
export function structuredPart(record: string, part: ApDocKey): string | undefined {
  const s = splitApLayout(record)
  return s ? s[part] : undefined
}

// ------------------------------------------------------------------------------------------------ the instruction

const remedyLine = (r: Remedy, i: number): string => {
  const what = r.kind === 'authority' ? `authority: ${r.authority}` : r.kind === 'transform' ? `transform: ${r.transform}`
    : r.operand ? `${r.operand.source}${r.operand.role ? ` ${r.operand.role}` : ''}${r.operand.path ? ` (${r.operand.path})` : ''}` : ''
  return `${i + 1}. [${r.kind}]${what ? ` ${what}` : ''} -> clears ${r.clears.join(', ') || '(nothing)'}: ${r.detail}`
}

/** The instruction handed back to the agent after a verdict that did not execute its proposal. Deterministic. */
export function renderInstruction(loopId: string, round: number, limit: number, g: LoopGateResult): LoopInstruction {
  const v = g.bundle.verdict
  const rounds_left = limit - round
  const lines = [
    `Round ${round} of ${limit}: not executed. ${g.reason}.`,
    `Verdict ${v.verdict_id}: ${v.outcome} (gate: ${g.status}).`,
    g.remedies.length ? 'What would lawfully answer it (the verdict\'s typed remedies):' : 'The verdict carries no remedies: nothing you can supply changes it.',
    ...g.remedies.map(remedyLine),
    `Next: send a corrected proposal (only what these remedies name may change; every changed value must be quoted from the document), concede (decision hold or reject), or stop. ${rounds_left} round${rounds_left === 1 ? '' : 's'} left; after that the gate holds for a person.`,
  ]
  return { protocol: LOOP_PROTOCOL, loop_id: loopId, round, rounds_left, verdict_id: v.verdict_id, outcome: v.outcome, status: g.status, reason: g.reason, remedies: structuredClone(g.remedies), text: lines.join('\n') }
}

// ------------------------------------------------------------------------------------------------ the session

function rulesetRef(task: LoopTask): { id: string; version: string; sha256?: string } {
  if (task.kind === 'declarative' && task.ruleset) return { id: task.ruleset.id, version: task.ruleset.version, sha256: canonicalSha256(task.ruleset) }
  return { id: AP_RULESET.id, version: AP_RULESET.version }
}

function proposalProblem(task: LoopTask, p: LoopProposal): string | undefined {
  if (!isObj(p) || (p.kind !== 'ap-text' && p.kind !== 'declarative')) return 'a proposal is { kind: "ap-text" | "declarative", … }'
  if (p.kind !== task.kind) return `the task is ${task.kind}; this proposal is ${p.kind}`
  if (p.kind === 'ap-text') {
    if (!(AP_GATE_DECISIONS as readonly string[]).includes(p.decision)) return `decision must be one of ${AP_GATE_DECISIONS.join(', ')}`
    if (!isObj(p.documents) || AP_DOC_KEYS.some((k) => typeof p.documents[k] !== 'string')) return 'documents are { invoice, purchase_order, goods_receipt } texts ("" for one not supplied)'
    return undefined
  }
  if (p.decision !== 'accept' && p.decision !== 'reject') return 'decision must be accept or reject'
  if (!isObj(p.extraction)) return 'extraction must be an object'
  if (p.source !== undefined && (!isObj(p.source) || typeof p.source.text !== 'string')) return 'source is { text, quotes? }'
  return undefined
}

export function openLoop(task: LoopTask, agent: LoopAgent, opts: LoopOptions = {}): LoopSession {
  const loop_id = opts.loopId ?? randomBytes(8).toString('hex')
  const limit = opts.roundLimit ?? LOOP_ROUND_LIMIT
  if (!Number.isInteger(limit) || limit < 1) throw new Error('the round limit is a whole number of rounds, at least 1')
  if (task.history !== undefined) {
    if (task.kind !== 'ap-text') throw new Error('history (the invoices already booked) belongs to an ap-text task')
    const h = historyOf(task.history)
    if (typeof h === 'string') throw new Error(`the task's ${h}`)
  }
  const discipline = opts.discipline !== false
  const sources = { ...(opts.structuredSources ?? {}) }
  const ledger: Ledger = openLedger(memoryStore(), { ...(opts.signingKey ? { signingKey: opts.signingKey } : {}), ...(opts.now ? { now: opts.now } : {}) })
  const row = (kind: LoopRowKind, body: Record<string, unknown>): LedgerEntry => ledger.append(kind, { protocol: LOOP_PROTOCOL, loop_id, ...body })
  const { ruleset: _ruleset, ...taskRef } = task
  row('loop.open', { task: taskRef, ruleset: rulesetRef(task), agent, round_limit: limit, discipline, remedies: REMEDIES_REDERIVED })
  const rounds: LoopRound[] = []
  let closed: LoopClose | undefined
  let lastGate: LoopGateResult | undefined

  const close = (outcome: LoopOutcome, reason: string): LoopClose => {
    const final = lastGate ? lastGate.bundle.verdict.verdict_id : null
    closed = { outcome, rounds_used: rounds.filter((r) => r.verify_bundle).length, reason, final_verdict_id: final }
    row('loop.close', { ...closed })
    return closed
  }

  return {
    loop_id,
    get closed() { return closed },
    get round() { return rounds.length },
    submit(proposal, model) {
      if (closed) throw new Error(`loop ${loop_id} is closed (${closed.outcome})`)
      const problem = proposalProblem(task, proposal)
      if (problem) throw new Error(`not a proposal: ${problem}`)
      const round = rounds.length + 1
      const p = structuredClone(proposal)
      const prev = rounds[rounds.length - 1]
      const d = prev && discipline ? editDiscipline(task, prev.proposal, p, lastGate?.remedies ?? [], sources) : undefined
      const r: LoopRound = { round, proposal: p, agent: model, ...(d ? { discipline: d } : {}) }
      rounds.push(r)
      row('loop.proposal', { round, proposal_sha256: canonicalSha256(p), decision: p.decision, agent: model, ...(d ? { discipline: d } : {}) })
      if (d && !d.ok) {
        const parts = [
          ...(d.out_of_scope.length ? [`changed outside the remedies' scope: ${d.out_of_scope.join(', ')}`] : []),
          ...d.unproven.map((u) => `${u.path}: ${u.reason}`),
          ...(d.source_rewritten ? ['the source text was rewritten, not extended'] : []),
        ]
        return { round, refused: d, closed: close('HELD-FOR-HUMAN', `round ${round} refused by the edit discipline (${parts.join('; ')}); not gated`) }
      }
      const issued = loopGate(task, p, opts.now)
      // the remedies this loop uses from here on (the instruction, the next round's scope) are re-derived, never the verdict's text
      const derived = rederiveRemedies(task, issued.bundle)
      const g: LoopGateResult = { ...issued, remedies: derived.remedies }
      lastGate = g
      r.verify_bundle = g.bundle
      const v = g.bundle.verdict
      row('loop.verdict', {
        round, verify_bundle_sha256: canonicalSha256(g.bundle), verdict_id: v.verdict_id, input_hash: v.input_hash, ruleset: v.ruleset, engine_version: v.engine_version,
        outcome: v.outcome, status: g.status, action: g.action, effect: g.effect, reason: g.reason, remedy_ids: (v.remedies ?? []).map(remedyId),
        remedies_source: REMEDIES_REDERIVED, remedies_sha256: derived.remedies_sha256, ...(derived.refused ? { remedies_refused: derived.refused } : {}),
      })
      if (derived.refused) {
        return { round, gate: g, remedies_refused: derived.refused, closed: close('HELD-FOR-HUMAN', `round ${round}: the verdict was refused, because its remedies do not re-derive from the pinned ruleset (${derived.refused}); nothing was executed and nothing was handed back`) }
      }
      if (g.action === 'EXECUTE') {
        const pass = g.effect === 'PAY' || g.effect === 'ACCEPT'
        return { round, gate: g, closed: close(pass ? 'CONVERGED-PASS' : 'CONVERGED-FAIL', `round ${round}: the gate executed the agent's ${p.decision} (${g.effect}): ${g.reason}`) }
      }
      if (round >= limit) return { round, gate: g, closed: close('HELD-FOR-HUMAN', `round limit ${limit} reached without agreement: the gate holds for a person (${g.reason})`) }
      const ins = renderInstruction(loop_id, round, limit, g)
      r.instruction = ins
      row('loop.remedy_returned', { round, instruction_sha256: canonicalSha256(ins), remedy_ids: ins.remedies.map(remedyId), rounds_left: ins.rounds_left })
      return { round, gate: g, instruction: ins }
    },
    decline(reason, model) {
      if (closed) throw new Error(`loop ${loop_id} is closed (${closed.outcome})`)
      return close('HELD-FOR-HUMAN', `the agent declined after round ${rounds.length}${model ? ` (${model.program ?? model.model ?? 'agent'})` : ''}: ${reason}`)
    },
    bundle() {
      // a JSON copy: nothing in the bundle shares an object with the session, or with another part of the bundle (as in a file)
      const chain = JSON.parse(JSON.stringify(ledger.entries())) as LedgerEntry[]
      return {
        protocol: LOOP_PROTOCOL, loop_id, task: JSON.parse(JSON.stringify(task)) as LoopTask, agent, round_limit: limit, discipline, chain, rounds: JSON.parse(JSON.stringify(rounds)) as LoopRound[],
        ...(Object.keys(sources).length ? { structured_sources: { ...sources } } : {}), top_hash: chain[chain.length - 1]!.hash,
      }
    },
  }
}

// ------------------------------------------------------------------------------------------------ verifying a bundle

/** What re-performing one round's verify bundle answered (the verify CLI, or the library in-process). */
export interface RoundReplay { result: 'MATCH' | 'DIVERGED' | 'NOT_REPERFORMED' | 'REFUSED'; detail?: string }
export interface LoopProblem { round: number | null; field: string; reason: string }
export interface LoopCheck {
  ok: boolean
  loop_id: string | null
  outcome: LoopOutcome | null
  rounds_used: number | null
  chain: { ok: boolean; length: number; signed: number; unsigned: number; signers: string[]; reason?: string }
  /** per round: verify's replay, and the refusal when the round's remedies did not re-derive and the row refused them */
  rounds: { round: number; replay?: RoundReplay; remedies_refused?: string; problems: LoopProblem[] }[]
  problems: LoopProblem[]
}

const sameJson = (a: unknown, b: unknown): boolean => { try { return canonicalize(a) === canonicalize(b) } catch { return false } }

/**
 * Re-check a loop bundle with no trust in whoever produced it: the chain (order, links, hashes, signatures; with `policy`,
 * whose key), the row grammar, every row against the bundle's content by sha256, every returned instruction against its
 * verdict's remedies byte for byte, the gate reading, the edit discipline, the close, and the top hash. With `replayRound`,
 * every round's verify bundle is re-performed too (riposte-loop replay hands it to `verify replay`). Every problem is named by
 * round. Never throws on a bad bundle.
 */
export async function verifyLoopBundle(b: unknown, opts: { policy?: ChainPolicy; replayRound?: (bundle: VerifyBundle, round: number) => RoundReplay | Promise<RoundReplay> } = {}): Promise<LoopCheck> {
  const problems: LoopProblem[] = []
  const no = (round: number | null, field: string, reason: string): void => { problems.push({ round, field, reason }) }
  const empty = { ok: false, length: 0, signed: 0, unsigned: 0, signers: [] as string[] }
  if (!isObj(b) || b.protocol !== LOOP_PROTOCOL || !Array.isArray(b.chain) || !Array.isArray(b.rounds) || !isObj(b.task)) {
    return { ok: false, loop_id: null, outcome: null, rounds_used: null, chain: { ...empty, reason: 'not a loop bundle' }, rounds: [], problems: [{ round: null, field: 'protocol', reason: `not a ${LOOP_PROTOCOL} bundle` }] }
  }
  const bundle = b as unknown as LoopBundle
  const chainCheck = verifyChain(bundle.chain, opts.policy ?? {})
  const chain = { ok: chainCheck.ok, length: chainCheck.length, signed: chainCheck.signed, unsigned: chainCheck.unsigned, signers: chainCheck.signers, ...(chainCheck.reason ? { reason: chainCheck.reason } : {}) }
  if (!chainCheck.ok) no(null, 'chain', chainCheck.reason ?? 'the chain does not verify')
  const head = bundle.chain.length ? bundle.chain[bundle.chain.length - 1]!.hash : ''
  if (bundle.top_hash !== head) no(null, 'top_hash', `the top hash ${String(bundle.top_hash).slice(0, 16)}… is not the chain head ${head.slice(0, 16)}…`)

  const body = (e: LedgerEntry): Record<string, unknown> => (isObj(e.body) ? e.body : {})
  for (const e of bundle.chain) {
    if (!(LOOP_ROW_KINDS as readonly string[]).includes(e.kind)) no(null, `chain[${e.seq}].kind`, `${e.kind} is not a loop row`)
    else if (body(e).loop_id !== bundle.loop_id || body(e).protocol !== LOOP_PROTOCOL) no(null, `chain[${e.seq}].loop_id`, 'the row belongs to another loop')
  }
  const rows = bundle.chain.filter((e) => (LOOP_ROW_KINDS as readonly string[]).includes(e.kind))
  const open = rows[0]
  if (!open || open.kind !== 'loop.open') no(null, 'chain[0]', 'the chain does not start with loop.open')
  else {
    const o = body(open)
    const { ruleset: _r, ...taskRef } = bundle.task
    if (!sameJson(o.task, taskRef)) no(null, 'loop.open.task', 'the open row\'s task is not the bundle\'s task')
    if (o.round_limit !== bundle.round_limit) no(null, 'loop.open.round_limit', 'the open row\'s round limit is not the bundle\'s')
    if (o.discipline !== bundle.discipline) no(null, 'loop.open.discipline', 'the open row\'s discipline is not the bundle\'s')
    if (bundle.task.kind === 'declarative' && bundle.task.ruleset && isObj(o.ruleset) && o.ruleset.sha256 !== canonicalSha256(bundle.task.ruleset)) no(null, 'loop.open.ruleset', 'the ruleset carried is not the one the loop opened with')
  }
  const closeRow = rows[rows.length - 1]
  if (!closeRow || closeRow.kind !== 'loop.close') no(null, 'loop.close', 'the chain does not end with loop.close')
  // a loop that hands back re-derived remedies says so on loop.open; then every verdict row must carry their sha256
  const rederivedLoop = open?.kind === 'loop.open' && body(open).remedies === REMEDIES_REDERIVED

  const roundChecks: LoopCheck['rounds'] = []
  const sources = bundle.structured_sources ?? {}
  let verdictRows = 0
  let lastGate: { remedies: Remedy[]; action?: string; effect?: string; verdict_id?: string; refused?: boolean } | undefined
  let prevDerived: Remedy[] = []
  for (let i = 0; i < bundle.rounds.length; i++) {
    const r = bundle.rounds[i]!
    const n = i + 1
    const rp: LoopProblem[] = []
    const rno = (field: string, reason: string): void => { rp.push({ round: n, field, reason }) }
    if (r.round !== n) rno('round', `round ${r.round} is out of order (expected ${n})`)
    const rr = rows.filter((e) => body(e).round === n)
    const prop = rr.find((e) => e.kind === 'loop.proposal')
    const ver = rr.find((e) => e.kind === 'loop.verdict')
    const ret = rr.find((e) => e.kind === 'loop.remedy_returned')
    if (!prop) rno('loop.proposal', 'no proposal row for this round')
    else {
      if (body(prop).proposal_sha256 !== canonicalSha256(r.proposal)) rno('proposal', 'the proposal is not the one the row recorded (sha256 differs)')
      if (!sameJson(body(prop).agent, r.agent)) rno('agent', 'the agent model is not the one the row recorded')
      if (n > 1 && bundle.discipline) {
        const prev = bundle.rounds[i - 1]!
        // the scope comes from the remedies the previous round handed back: re-derived, never the verdict's text
        const d = editDiscipline(bundle.task, prev.proposal, r.proposal, prevDerived, sources)
        if (!sameJson(body(prop).discipline, d)) rno('discipline', 'the edit discipline re-derives differently than the row recorded')
        if (!d.ok && (ver || i < bundle.rounds.length - 1)) rno('discipline', 'a proposal the discipline refuses was gated or followed by another round')
      }
    }
    let replay: RoundReplay | undefined
    let derived: RemedyDerivation | undefined
    if (r.verify_bundle) {
      verdictRows++
      const v = r.verify_bundle.verdict
      // the remedies re-derived from the pinned ruleset (in-process, verify's own replay), whatever the bundle says
      derived = rederiveRemedies(bundle.task, r.verify_bundle)
      prevDerived = derived.remedies
      if (!ver) rno('loop.verdict', 'a verify bundle with no verdict row')
      else {
        const vb = body(ver)
        if (vb.verify_bundle_sha256 !== canonicalSha256(r.verify_bundle)) rno('verify_bundle', 'the verify bundle is not the one the row recorded (sha256 differs)')
        if (vb.verdict_id !== v.verdict_id) rno('verdict_id', 'the verdict id is not the row\'s')
        const remedies = v.remedies ?? []
        if (!sameJson(vb.remedy_ids, remedies.map(remedyId))) rno('remedy_ids', 'the verdict\'s remedies are not the ones the row recorded')
        const rowRefused = typeof vb.remedies_refused === 'string'
        if (vb.remedies_sha256 !== undefined || rederivedLoop) {
          if (vb.remedies_source !== REMEDIES_REDERIVED) rno('remedies_source', `the row says the remedies came from ${JSON.stringify(vb.remedies_source)}, not "${REMEDIES_REDERIVED}"`)
          if (vb.remedies_sha256 !== derived.remedies_sha256) rno('remedies_sha256', vb.remedies_sha256 === undefined ? 'the loop hands back re-derived remedies, and this verdict row records no remedies_sha256' : 'the remedies re-derived from the pinned ruleset are not the ones the row recorded (sha256 differs)')
        }
        if (rowRefused && !derived.refused) rno('remedies_refused', 'the row refused this verdict\'s remedies, and they re-derive from the pinned ruleset')
        if (derived.refused && !rowRefused) rno('remedies', `the round's remedies do not re-derive from the pinned ruleset: ${derived.refused}`)
        if (rowRefused && (r.instruction || i < bundle.rounds.length - 1)) rno('remedies_refused', 'a round whose verdict was refused handed back an instruction or was followed by another round')
        // the gate reading re-derived from the verdict and the proposal's decision, under the engine and ruleset the round's
        // verdict row names (else the bundle's verdict), never this build's default (2026-10-05: a 0.5.0 row re-derived
        // under 0.6.0 read the duplicate check as open and diverged)
        let reading: { status: string; action: string; effect: string } | undefined
        const engine = typeof vb.engine_version === 'string' ? vb.engine_version : v.engine_version
        if (r.proposal.kind === 'declarative') reading = declarativeReading(v, r.proposal.decision)
        else {
          try {
            const p = r.proposal
            const g = apGate(p.decision, apDocsOf(bundle.task, p), { now: () => new Date(v.issued_at), engine, ruleset: { id: v.ruleset.id, version: v.ruleset.version } })
            reading = { status: g.status, action: g.action, effect: g.effect }
          } catch (e) { rno('gate', `the AP gate could not be re-derived under engine ${engine} (${(e as Error).message})`) }
        }
        if (reading && (reading.status !== vb.status || reading.action !== vb.action || reading.effect !== vb.effect)) rno('gate', `the gate reading re-derives under engine ${engine} as ${reading.status}/${reading.action}/${reading.effect}; the row says ${String(vb.status)}/${String(vb.action)}/${String(vb.effect)}`)
        lastGate = { remedies, action: String(vb.action), effect: String(vb.effect), verdict_id: v.verdict_id, refused: rowRefused }
      }
      if (opts.replayRound) {
        try { replay = await opts.replayRound(r.verify_bundle, n) } catch (e) { replay = { result: 'REFUSED', detail: (e as Error).message } }
        // a verdict the loop refused (its remedies do not re-derive, and the re-derivation here agrees) is expected not to
        // replay: verify refuses it for the same reason. Any other round must MATCH.
        const expectedRefusal = derived.refused !== undefined && ver !== undefined && typeof body(ver).remedies_refused === 'string'
        if (replay.result !== 'MATCH' && !expectedRefusal) rno('verify_bundle', `verify replay: ${replay.result}${replay.detail ? ` (${replay.detail})` : ''}`)
      }
    } else if (ver) rno('verify_bundle', 'a verdict row with no verify bundle')
    if (r.instruction) {
      if (!ret) rno('loop.remedy_returned', 'an instruction with no remedy_returned row')
      else if (body(ret).instruction_sha256 !== canonicalSha256(r.instruction)) rno('instruction', 'the instruction is not the one the row recorded (sha256 differs)')
      const remedies = r.verify_bundle?.verdict.remedies ?? []
      if (canonicalize(r.instruction.remedies) !== canonicalize(remedies)) rno('instruction.remedies', 'the remedies handed back are not byte-identical to the round\'s verdict remedies')
      if (derived && canonicalize(r.instruction.remedies) !== canonicalize(derived.remedies)) rno('instruction.remedies', 'the remedies handed back are not the ones re-derived from the pinned ruleset')
      if (r.verify_bundle && r.instruction.verdict_id !== r.verify_bundle.verdict.verdict_id) rno('instruction.verdict_id', 'the instruction names another verdict')
      if (r.verify_bundle) {
        const expect = renderInstruction(bundle.loop_id, n, bundle.round_limit, { bundle: r.verify_bundle, remedies, status: r.instruction.status, action: 'REVIEW', effect: 'HUMAN_REVIEW', reason: r.instruction.reason })
        if (expect.text !== r.instruction.text) rno('instruction.text', 'the instruction text does not render from its verdict')
      }
      if (ret && !sameJson(body(ret).remedy_ids, r.instruction.remedies.map(remedyId))) rno('remedy_ids', 'the remedy_returned row names other remedies')
    } else if (ret) rno('instruction', 'a remedy_returned row with no instruction')
    if (r.proposal.kind === 'ap-text') {
      for (const k of AP_DOC_KEYS) {
        if (!r.proposal.supplied_from?.[k]) continue
        const why = suppliedProblem(r.proposal, k, sources)
        if (why) rno(`documents.${k}`, why)
      }
    }
    const refusedHere = derived?.refused !== undefined && ver !== undefined && typeof body(ver).remedies_refused === 'string' ? { remedies_refused: String(body(ver).remedies_refused) } : {}
    roundChecks.push({ round: n, ...(replay ? { replay } : {}), ...refusedHere, problems: rp })
    problems.push(...rp)
  }
  const extraRounds = rows.filter((e) => typeof body(e).round === 'number' && (body(e).round as number) > bundle.rounds.length)
  if (extraRounds.length) no(null, 'rounds', `the chain records round ${String(body(extraRounds[0]!).round)} that the bundle does not carry`)
  if (verdictRows > bundle.round_limit) no(null, 'round_limit', `${verdictRows} verdicts exceed the round limit ${bundle.round_limit}`)
  let outcome: LoopOutcome | null = null
  let rounds_used: number | null = null
  if (closeRow && closeRow.kind === 'loop.close') {
    const c = body(closeRow)
    outcome = c.outcome as LoopOutcome
    rounds_used = typeof c.rounds_used === 'number' ? c.rounds_used : null
    if (rounds_used !== verdictRows) no(null, 'loop.close.rounds_used', `the close says ${String(c.rounds_used)} rounds; the bundle carries ${verdictRows} verdicts`)
    const executed = lastGate?.action === 'EXECUTE' && !lastGate.refused
    const expect: LoopOutcome = executed ? (lastGate!.effect === 'PAY' || lastGate!.effect === 'ACCEPT' ? 'CONVERGED-PASS' : 'CONVERGED-FAIL') : 'HELD-FOR-HUMAN'
    if (outcome !== expect) no(null, 'loop.close.outcome', `the close says ${String(outcome)}; the last verdict's gate reading gives ${expect}`)
    if (c.final_verdict_id !== (lastGate?.verdict_id ?? null)) no(null, 'loop.close.final_verdict_id', 'the close names another verdict')
  }
  return { ok: problems.length === 0, loop_id: typeof bundle.loop_id === 'string' ? bundle.loop_id : null, outcome, rounds_used, chain, rounds: roundChecks, problems }
}
