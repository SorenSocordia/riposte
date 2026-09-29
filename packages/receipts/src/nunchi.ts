/**
 * Nunchi: the delivery layer. The verdict never flexes; the delivery does.
 *
 * Riposte's findings reach a person or an agent through this module. It decides four things and nothing else:
 *
 *   timing    WHEN to speak: at the "done" claim or before the action, never mid-flow. A mid-flow finding waits for the
 *             next boundary. A HOLD is never deferred (a hold is pre-action by definition), and neither is anything at
 *             the top consequence tier. At the `record` rung nothing is said in-flow at all: the finding goes on the record.
 *   weight    HOW LOUD: emphasis scales with the declared consequence tier (a scratch notebook vs a production payment).
 *   audience  IN WHAT FORMAT: a solo developer's terminal, a pull request, or an auditor's record. Same notice, three forms.
 *   floor     THE VALUES FLOOR: at the top consequence tier the tact drops. Plain words, no softening, spoken now.
 *
 * What it may NOT do, and what the tests hold it to:
 *   - change a fact. The facts (outcome, action, rung, every finding with its evidence and dispute path) are extracted once
 *     from the notice, hashed, and rendered verbatim in every register. The same verdict yields the same facts, and the same
 *     facts hash, whatever the moment, tier or audience.
 *   - change what happens to the action. HOLD / SURFACE / PROCEED is the rung's handling (verify's actionNotice), decided
 *     before delivery. Nunchi only says it.
 *
 * Pure and deterministic: no clock, no randomness, no I/O.
 */
import { hashOf } from 'riposte-verify'
import type { ClaimsResult } from './claims.js'
import type { DoneResult } from './done.js'

export type Moment = 'pre-action' | 'done-claim' | 'mid-flow'
export type Audience = 'solo' | 'pr' | 'auditor'
export type Weight = 'light' | 'standard' | 'heavy' | 'floor'
export const MOMENTS: readonly Moment[] = ['pre-action', 'done-claim', 'mid-flow']
export const AUDIENCES: readonly Audience[] = ['solo', 'pr', 'auditor']

/**
 * The consequence tiers of verify's EXAMPLE_PROMOTION_POLICY, in ascending order (a test keeps the two in step). A
 * deployment passes its own policy's tier names; these are the default only.
 */
export const DEFAULT_TIERS: readonly string[] = ['low', 'moderate', 'high', 'severe']

/**
 * The words tact is made of. Used in the frame of a message below the floor, never at it, and never to an auditor.
 * Exported so the floor test can prove their absence.
 */
export const SOFTENERS: readonly string[] = ['heads-up', 'worth a look', 'please', 'might', 'perhaps', 'consider', 'just', 'maybe', 'when you get a chance']

// ── the facts ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** One finding, as facts. Every string here is rendered verbatim in every register. */
export interface DeliveryFinding {
  /** the claim id (verdict findings), `kind#n` (closing claims) or `source:path` (done checks) */
  id: string
  status: 'FAIL' | 'ABSTAIN'
  field: string
  /** what is wrong or could not be checked, in the checker's own words */
  statement: string
  /** asserted vs expected, when the check computed an expected value */
  values?: string
  /** the cells or tool results the finding rests on, one line each */
  evidence: string[]
  /** the dispute path for this single finding, when there is one */
  dispute?: string
}

export interface DeliveryFacts {
  facts_version: 'nunchi-facts-v0'
  source: 'action_notice' | 'claims' | 'done'
  /** what was checked, e.g. `tool mcp__bank__transfer` */
  subject: string
  verdict_id?: string
  outcome: 'PASS' | 'FAIL' | 'ABSTAIN'
  /** what happens to the action. The rung's handling, decided before delivery; never changed by it. */
  action: 'HOLD' | 'SURFACE' | 'PROCEED'
  /** the rung the action ran under (action notices) */
  level?: string
  /** where a PASS goes at this rung (action notices) */
  pass_handling?: 'UNCHANGED' | 'HUMAN_REVIEW' | 'ACT_WITHIN_BOUNDS'
  /** whether the rung delivers in-flow (to the person and the agent) or as a notice on the record */
  in_flow: boolean
  findings: DeliveryFinding[]
  /** judgement-tier advisories on the verdict (COUNSEL): counted, never held */
  advisories?: number
  /** the dispute path for the whole verdict */
  dispute?: string
}

/**
 * The fields of verify's ActionNotice that delivery reads (structural, so this module does not depend on a built verify).
 * Pass `actionNotice(verdict, level)` straight in.
 */
export interface NoticeLike {
  verdict_id: string
  outcome: 'PASS' | 'FAIL' | 'INSUFFICIENT_DATA'
  level: string
  action: 'HOLD' | 'SURFACE' | 'PROCEED'
  handling: { PASS: 'UNCHANGED' | 'HUMAN_REVIEW' | 'ACT_WITHIN_BOUNDS'; delivery: 'notice' | 'in-flow' }
  findings: {
    claim_id: string
    outcome: 'FAIL' | 'INSUFFICIENT_DATA'
    field: string
    asserted: unknown
    expected?: unknown
    variance?: number
    explanation: string
    evidence: { locator: { kind: string; source?: string; path?: string; source_hash?: string; start?: number; end?: number }; value: unknown; original?: unknown; confidence: number }[]
    insufficiency?: { reason: string; detail: string }
    dispute: string
  }[]
  advisories: number
  dispute: string
}

const json = (v: unknown): string => (v === undefined ? '—' : JSON.stringify(v))

function evidenceLine(e: NoticeLike['findings'][number]['evidence'][number]): string {
  const l = e.locator
  const where = l.kind === 'field' ? `${l.source}:${l.path}` : `span ${String(l.source_hash ?? '').slice(0, 12)}…[${l.start}..${l.end}]`
  return `${where} = ${json(e.value)}${e.original !== undefined ? ` (read as ${json(e.original)})` : ''} · confidence ${e.confidence}`
}

/** The facts of one action notice (verify's actionNotice). */
export function factsFromNotice(notice: NoticeLike, subject: string): DeliveryFacts {
  return {
    facts_version: 'nunchi-facts-v0',
    source: 'action_notice',
    subject,
    verdict_id: notice.verdict_id,
    outcome: notice.outcome === 'INSUFFICIENT_DATA' ? 'ABSTAIN' : notice.outcome,
    action: notice.action,
    level: notice.level,
    pass_handling: notice.handling.PASS,
    in_flow: notice.handling.delivery === 'in-flow',
    findings: notice.findings.map((f) => ({
      id: f.claim_id,
      status: f.outcome === 'FAIL' ? 'FAIL' as const : 'ABSTAIN' as const,
      field: f.field,
      statement: f.outcome === 'INSUFFICIENT_DATA' && f.insufficiency ? `${f.insufficiency.reason}: ${f.insufficiency.detail}` : f.explanation,
      ...(f.expected !== undefined ? { values: `asserted ${json(f.asserted)} · expected ${json(f.expected)}${f.variance !== undefined ? ` · variance ${f.variance}` : ''}` } : {}),
      evidence: f.evidence.map(evidenceLine),
      dispute: f.dispute,
    })),
    advisories: notice.advisories,
    dispute: notice.dispute,
  }
}

/**
 * The facts of a turn's closing claims (checkClaims): the "done" moment. `action` is what the host did with the stop:
 * HOLD when the stop was sent back, SURFACE when it was only recorded. Default: PROCEED on PASS, else SURFACE.
 */
export function factsFromClaims(result: ClaimsResult, opts: { action?: DeliveryFacts['action']; in_flow?: boolean; subject?: string } = {}): DeliveryFacts {
  const findings: DeliveryFinding[] = []
  result.claims.forEach((c, i) => {
    if (c.status === 'SUPPORTED') return
    const ev = c.evidence
    findings.push({
      id: `${c.kind}#${i}`,
      status: c.status === 'CONTRADICTED' ? 'FAIL' : 'ABSTAIN',
      field: c.kind,
      statement: `"${c.claim}": ${c.reason}`,
      evidence: ev ? [`${ev.tool}${ev.command ? `: ${ev.command}` : ''}${ev.at ? ` @ ${ev.at}` : ''}: ${ev.excerpt}`] : [],
    })
  })
  return {
    facts_version: 'nunchi-facts-v0',
    source: 'claims',
    subject: opts.subject ?? 'closing claims',
    outcome: result.outcome,
    action: opts.action ?? (result.outcome === 'PASS' ? 'PROCEED' : 'SURFACE'),
    in_flow: opts.in_flow ?? true,
    findings,
  }
}

/** The facts of a "done" check (checkDone) against the real state. */
export function factsFromDone(result: DoneResult, opts: { action?: DeliveryFacts['action']; in_flow?: boolean } = {}): DeliveryFacts {
  return {
    facts_version: 'nunchi-facts-v0',
    source: 'done',
    subject: `done claim "${result.claim}"`,
    outcome: result.outcome,
    action: opts.action ?? (result.outcome === 'PASS' ? 'PROCEED' : 'SURFACE'),
    in_flow: opts.in_flow ?? true,
    findings: result.results.filter((r) => r.outcome !== 'PASS').map((r) => ({
      id: `${r.source}:${r.path}`,
      status: r.outcome === 'FAIL' ? 'FAIL' as const : 'ABSTAIN' as const,
      field: r.path,
      statement: r.detail,
      evidence: r.source in result.observed ? [`${r.source} observed ${result.observed[r.source]}`] : [],
    })),
  }
}

/** Every string the facts contribute. Each one appears verbatim in every rendering (the invariance the tests check). */
export function factTokens(f: DeliveryFacts): string[] {
  const t = [f.subject, f.outcome, f.action]
  if (f.verdict_id !== undefined) t.push(f.verdict_id)
  if (f.level !== undefined) t.push(f.level)
  if (f.pass_handling !== undefined) t.push(f.pass_handling)
  if (f.dispute !== undefined) t.push(f.dispute)
  for (const x of f.findings) {
    t.push(x.id, x.status, x.field, x.statement, ...x.evidence)
    if (x.values !== undefined) t.push(x.values)
    if (x.dispute !== undefined) t.push(x.dispute)
  }
  return t
}

// ── the delivery ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface DeliveryContext {
  moment: Moment
  /** the declared consequence tier of this workflow (a name in `tiers`) */
  tier: string
  /** the policy's tier names, ascending in consequence. Default DEFAULT_TIERS. */
  tiers?: readonly string[]
  audience?: Audience
}

export interface Delivery {
  delivery_version: 'nunchi-v0'
  /** the facts, identical in every register */
  facts: DeliveryFacts
  /** hashOf(facts): identical in every register */
  facts_hash: string
  timing: { speak: 'now' | 'at-boundary' | 'on-record'; reason: string }
  weight: Weight
  /** the values floor: the top consequence tier (or an undeclared one). Tact drops. */
  floor: boolean
  tier: { name: string; rank: number; of: number; known: boolean }
  audience: Audience
  moment: Moment
  text: string
}

/**
 * Weight from the tier's rank. The top tier is the floor. An undeclared tier is treated as the top tier: when the stakes
 * are unknown, speak plainly (DECISION: fail toward plain words, never toward softening).
 */
export function weightOf(tier: string, tiers: readonly string[] = DEFAULT_TIERS): { weight: Weight; rank: number; of: number; known: boolean } {
  const of = tiers.length
  const rank = tiers.indexOf(tier)
  if (rank < 0 || of === 0) return { weight: 'floor', rank: -1, of, known: false }
  if (rank === of - 1) return { weight: 'floor', rank, of, known: true }
  if (rank === 0) return { weight: 'light', rank, of, known: true }
  if (of >= 4 && rank === of - 2) return { weight: 'heavy', rank, of, known: true }
  return { weight: 'standard', rank, of, known: true }
}

/** When to speak. The order matters: a hold, then the rung's delivery mode, then the floor, then the moment. */
export function timingOf(facts: DeliveryFacts, moment: Moment, floor: boolean): Delivery['timing'] {
  if (facts.action === 'HOLD') return { speak: 'now', reason: 'a hold is spoken before the action, never deferred' }
  if (!facts.in_flow) return { speak: 'on-record', reason: `rung ${facts.level ?? 'record'} delivers as a notice on the record, not in-flow` }
  if (floor) return { speak: 'now', reason: 'top consequence tier: the tact of waiting drops' }
  if (moment === 'mid-flow') return { speak: 'at-boundary', reason: 'mid-flow: held for the next "done" claim or pre-action moment' }
  return { speak: 'now', reason: moment === 'pre-action' ? 'before the action' : 'at the "done" claim' }
}

/** The plain statement of what happened. The same words in every register; tact only ever prefixes it. */
function plainStatement(f: DeliveryFacts): string {
  const n = f.findings.length
  const count = `${n} finding${n === 1 ? '' : 's'}`
  if (f.action === 'HOLD') return `Held for a person: ${f.subject}, outcome ${f.outcome} (${count}). It stays held until a person resolves it.`
  if (f.action === 'SURFACE') {
    return f.outcome === 'FAIL'
      ? `${f.subject} failed a check, outcome ${f.outcome} (${count}). Surfaced, not held.`
      : `${f.subject} could not be checked, outcome ${f.outcome} (${count}). Not confirmed; surfaced, not held.`
  }
  const where = f.pass_handling === 'HUMAN_REVIEW' ? ' A person reviews it before it runs.' : f.pass_handling === 'ACT_WITHIN_BOUNDS' ? ' It proceeds within the declared bounds.' : ''
  return `${f.subject}: outcome ${f.outcome}, action ${f.action}.${where}${n ? ` (${count})` : ''}`
}

/** The tact that prefixes the plain statement below the floor. The floor and the auditor get none. */
function tactOf(weight: Weight, audience: Audience, f: DeliveryFacts): string {
  if (weight === 'floor' || audience === 'auditor') return ''
  if (f.action === 'PROCEED' && f.findings.length === 0) return ''
  if (weight === 'light') return 'Heads-up, when you get a chance: '
  if (weight === 'standard') return 'Worth a look: '
  return 'Please check this before relying on it: '
}

function rungLine(f: DeliveryFacts, tier: Delivery['tier']): string {
  const parts = [`outcome ${f.outcome}`, `action ${f.action}`]
  if (f.level !== undefined) parts.push(`rung ${f.level}`)
  if (f.pass_handling !== undefined) parts.push(`PASS handling ${f.pass_handling}`)
  parts.push(`tier ${tier.name}${tier.known ? ` (${tier.rank + 1} of ${tier.of})` : ' (undeclared: treated as the top tier)'}`)
  if (f.verdict_id !== undefined) parts.push(`verdict ${f.verdict_id}`)
  return parts.join(' · ')
}

function renderSolo(f: DeliveryFacts, d: Omit<Delivery, 'text'>): string {
  const head = d.weight === 'floor' ? `RIPOSTE: ${plainStatement(f)}`
    : d.weight === 'heavy' ? `RIPOSTE (high consequence): ${tactOf(d.weight, 'solo', f)}${plainStatement(f)}`
      : `riposte: ${tactOf(d.weight, 'solo', f)}${plainStatement(f)}`
  const L = [head, `  ${rungLine(f, d.tier)}`]
  for (const x of f.findings) {
    L.push(`  - ${x.status} ${x.id} on ${x.field}: ${x.statement}`)
    if (x.values !== undefined) L.push(`      ${x.values}`)
    for (const e of x.evidence) L.push(`      evidence: ${e}`)
    if (x.dispute !== undefined) L.push(`      dispute: ${x.dispute}`)
  }
  if (f.advisories) L.push(`  ${f.advisories} judgement-tier advisor${f.advisories === 1 ? 'y' : 'ies'} (COUNSEL): shown, never held.`)
  if (f.dispute !== undefined) L.push(`  dispute the whole verdict: ${f.dispute}`)
  return `${L.join('\n')}\n`
}

function renderPr(f: DeliveryFacts, d: Omit<Delivery, 'text'>): string {
  const h = d.weight === 'floor' ? '## Riposte: ' : d.weight === 'heavy' ? '### Riposte (high consequence): ' : d.weight === 'standard' ? '#### Riposte: ' : '##### Riposte note: '
  const L = [`${h}${tactOf(d.weight, 'pr', f)}${plainStatement(f)}`, '', `\`${rungLine(f, d.tier)}\``, '']
  if (f.findings.length) {
    L.push('| status | finding | field |', '|---|---|---|')
    for (const x of f.findings) L.push(`| ${x.status} | \`${x.id}\` | \`${x.field}\` |`)
    L.push('')
    for (const x of f.findings) {
      L.push(`- **${x.status}** \`${x.id}\`: ${x.statement}`)
      if (x.values !== undefined) L.push(`  - ${x.values}`)
      for (const e of x.evidence) L.push(`  - evidence: \`${e}\``)
      if (x.dispute !== undefined) L.push(`  - dispute: \`${x.dispute}\``)
    }
    L.push('')
  }
  if (f.advisories) L.push(`${f.advisories} judgement-tier advisor${f.advisories === 1 ? 'y' : 'ies'} (COUNSEL): shown, never held.`, '')
  if (f.dispute !== undefined) L.push(`Dispute the whole verdict: \`${f.dispute}\``, '')
  return `${L.join('\n')}`
}

function renderAuditor(f: DeliveryFacts, d: Omit<Delivery, 'text'>): string {
  const L = [
    'RIPOSTE NOTICE',
    `statement: ${plainStatement(f)}`,
    `subject: ${f.subject}`,
    `source: ${f.source}`,
    `verdict_id: ${f.verdict_id ?? '—'}`,
    `outcome: ${f.outcome}`,
    `action: ${f.action}`,
    `rung: ${f.level ?? '—'}`,
    `pass_handling: ${f.pass_handling ?? '—'}`,
    `consequence_tier: ${d.tier.name} (${d.tier.known ? `${d.tier.rank + 1} of ${d.tier.of}` : 'undeclared'})`,
    `delivery: moment ${d.moment} · speak ${d.timing.speak} · weight ${d.weight}`,
    `facts_hash: ${d.facts_hash}`,
    `findings: ${f.findings.length}`,
  ]
  f.findings.forEach((x, i) => {
    L.push(`  [${i + 1}] ${x.status} ${x.id}`, `      field: ${x.field}`, `      statement: ${x.statement}`)
    if (x.values !== undefined) L.push(`      values: ${x.values}`)
    for (const e of x.evidence) L.push(`      evidence: ${e}`)
    if (x.dispute !== undefined) L.push(`      dispute: ${x.dispute}`)
  })
  L.push(`advisories: ${f.advisories ?? 0}`)
  if (f.dispute !== undefined) L.push(`dispute_verdict: ${f.dispute}`)
  return `${L.join('\n')}\n`
}

/** Deliver one set of facts: timing, weight, audience and the floor. The facts pass through untouched. */
export function deliver(facts: DeliveryFacts, ctx: DeliveryContext): Delivery {
  if (!MOMENTS.includes(ctx.moment)) throw new RangeError(`unknown moment ${JSON.stringify(ctx.moment)} (${MOMENTS.join(' | ')})`)
  const audience = ctx.audience ?? 'solo'
  if (!AUDIENCES.includes(audience)) throw new RangeError(`unknown audience ${JSON.stringify(audience)} (${AUDIENCES.join(' | ')})`)
  const w = weightOf(ctx.tier, ctx.tiers ?? DEFAULT_TIERS)
  const floor = w.weight === 'floor'
  const base: Omit<Delivery, 'text'> = {
    delivery_version: 'nunchi-v0',
    facts,
    facts_hash: hashOf(facts),
    timing: timingOf(facts, ctx.moment, floor),
    weight: w.weight,
    floor,
    tier: { name: ctx.tier, rank: w.rank, of: w.of, known: w.known },
    audience,
    moment: ctx.moment,
  }
  const text = audience === 'pr' ? renderPr(facts, base) : audience === 'auditor' ? renderAuditor(facts, base) : renderSolo(facts, base)
  return { ...base, text }
}
