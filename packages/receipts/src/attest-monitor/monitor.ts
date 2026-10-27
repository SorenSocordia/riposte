/**
 * The model-switch monitor: a month of host records and provider usage exports → which model answered each reply, on what
 * evidence tier, every switch with its cause, and every place the provider's own records disagree with the host's.
 *
 * Switch causes are attestModels' (user_command · host_fallback · unrecorded) plus one more:
 *   alias_float  the model changed with nothing announcing it, and the declared id names a family rather than one model:
 *                a floating alias ("…-latest", a bare tier name), or an undated id whose dated snapshot changed between replies
 *                ("model-x-20250301" to "model-x-20250815" under a declared "model-x"). The provider moved what the name means.
 * A switch is announced only when the user asked for it (user_command). Flags are: silent switches, replies from a model that
 * was not declared, and provider or anchor records that disagree with the host record. Deterministic; no I/O.
 */
import { attestModels, isFloatingAlias, modelMatches, type ModelEvent, type SwitchCause } from '../model-attest.js'
import type { HostFormat, HostRecord, HostReply } from './hosts.js'
import type { ParsedExport, ExportSource, Provider } from './exports.js'
import { matchReplies, type BucketShortfall, type Corroboration, type ReplyRef, DEFAULT_WINDOW_SECONDS } from './match.js'
import { TIERS, maxTier, type EvidenceTier } from './tiers.js'
import type { CheckOutcome } from '../outcome.js'

/** 0.2.0 (2026-10-06): a run's can't tell is INSUFFICIENT_DATA, and per_declared counts it under that key (0.1.0: ABSTAIN). */
export const MONITOR_VERSION = 'riposte.attest-monitor/0.2.0'

export interface MonitorRun {
  name: string; format: HostFormat; record: HostRecord; declared: string; allowed?: string[]; file?: string; sha256?: string
  /** the provider (and account label) that served this run; without it, exports corroborate only by request id */
  provider?: Provider; account?: string
}
export interface Anchor { reply_id: string; model: string; seq: number; at: string }
export interface AnchorSet { ledger: string; ok: boolean; reason?: string; signer?: string; anchors: Map<string, Anchor> }
export interface MonitorExport { parsed: ParsedExport; file?: string; sha256?: string }
export interface MonitorInput {
  month: string; deployer?: string; runs: MonitorRun[]; exports?: MonitorExport[]; anchors?: AnchorSet[]; windowSeconds?: number
  /** an anchor written more than this long after its reply does not count as T3 (default 3600 s) */
  anchorLagSeconds?: number
}

export type MonitorSwitchCause = SwitchCause | 'alias_float'
export const SWITCH_CAUSES: readonly MonitorSwitchCause[] = ['user_command', 'host_fallback', 'unrecorded', 'alias_float']

export type Evidence =
  | { tier: 'T1'; ref: string }
  | { tier: 'T2'; source: ExportSource; method: Corroboration['method']; confidence: number; verdict: Corroboration['verdict']; billed: string[]; records: number[] }
  | { tier: 'T3'; ledger: string; seq: number; model: string; verdict: 'agree' | 'disagree' | 'late' }

export interface ReplyFinding {
  run: string
  /** index among the run's replies that recorded a model (attestModels' numbering); null for a reply that recorded none */
  reply: number | null
  line: number
  id?: string
  at?: string
  declared: string
  /** what the host recorded: the provider's model field (T1), or the model the host asked for (Codex) */
  recorded: string | null
  basis: HostReply['basis']
  /** the model the best agreeing evidence says answered */
  resolved: string | null
  tier: EvidenceTier
  evidence: Evidence[]
  /** null when nothing can be attested (a floating declared alias, or no resolved model) */
  matches_declared: boolean | null
  conflict?: string
  raise_by: string
}

export interface MonitorSwitch {
  run: string; from: string; to: string; at?: string; reply: number; cause: MonitorSwitchCause; announced: boolean; host_reason?: string
  evidence: { before: { tier: EvidenceTier; refs: string[] }; after: { tier: EvidenceTier; refs: string[] } }
}

export interface RunResult {
  name: string; format: HostFormat; declared: string; expected: string[]; file?: string; sha256?: string
  outcome: CheckOutcome
  reasons: string[]
  replies: number
  replies_outside_month: number
  by_tier: Record<EvidenceTier, number>
  switches: MonitorSwitch[]
  violations: ReplyFinding[]
  contradictions: ReplyFinding[]
  /** buckets where the provider billed this run's model for fewer tokens than the host recorded (shared with any other run in the bucket) */
  bucket_shortfalls: BucketShortfall[]
  flags: number
  rejected_lines: number
  findings: ReplyFinding[]
}

export interface DeclaredSummary {
  declared: string
  runs: number
  replies: number
  by_tier: Record<EvidenceTier, number>
  corroborated: { T2: number; T3: number }
  contradicted: number
  /** buckets where the provider billed this declared model's runs short */
  bucket_shortfalls: number
  switches: Record<MonitorSwitchCause, number>
  silent_switches: MonitorSwitch[]
  violations: number
  coverage: { any_evidence: number; t2: number; t3: number; of: number }
  outcomes: Record<CheckOutcome, number>
}

export interface MonitorResult {
  monitor_version: typeof MONITOR_VERSION
  month: string
  deployer: string | null
  runs: RunResult[]
  per_declared: DeclaredSummary[]
  exports: { source: ExportSource; file?: string; sha256?: string; rows: number; matched_replies: number; methods: Record<string, number>; acknowledged: string[]; notes: string[]; doc: string; assumed: string[] }[]
  anchors: { ledger: string; ok: boolean; reason?: string; signer?: string; anchors: number }[]
  totals: { runs: number; replies: number; flags: number; silent_switches: number; violations: number; contradictions: number; bucket_shortfalls: number; by_tier: Record<EvidenceTier, number>; coverage_any: number }
  cannot_prove: string[]
  window_seconds: number
}

const PLACEHOLDER = /^<.*>$/
const usableModel = (m: string | null): m is string => typeof m === 'string' && m.trim() !== '' && !PLACEHOLDER.test(m.trim())
const zeroTiers = (): Record<EvidenceTier, number> => ({ T0: 0, T1: 0, T2: 0, T3: 0 })
const inMonth = (at: string | undefined, month: string): boolean | null => (at ? at.startsWith(month) : null)

/** Is this switch the declared name floating (rather than a change of model)? */
export function isAliasFloat(declared: readonly string[], from: string, to: string): boolean {
  if (declared.some(isFloatingAlias)) return true
  return declared.some((d) => d !== from && d !== to && modelMatches(d, from) && modelMatches(d, to))
}

export function runMonitor(input: MonitorInput): MonitorResult {
  if (!/^\d{4}-\d{2}$/.test(input.month)) throw new Error(`month must be YYYY-MM (got ${JSON.stringify(input.month)})`)
  const windowSeconds = input.windowSeconds ?? DEFAULT_WINDOW_SECONDS
  const exportsIn = input.exports ?? []
  const anchors = input.anchors ?? []
  const lagMs = (input.anchorLagSeconds ?? 3600) * 1000

  // 1. the month's replies of every run, keyed for matching across runs
  const perRun = input.runs.map((run) => {
    const keep: HostReply[] = []
    let outside = 0
    const events: ModelEvent[] = []
    let ri = 0
    for (const e of run.record.events) {
      if (e.type !== 'reply') { events.push(e); continue }
      const rep = run.record.replies[ri++]!
      if (inMonth(rep.at, input.month) === false) { outside++; continue }
      keep.push(rep)
      events.push(e)
    }
    return { run, replies: keep, outside, events }
  })
  const refs: ReplyRef[] = perRun.flatMap(({ run, replies }) => replies.filter((r) => usableModel(r.model)).map((r) => ({
    key: `${run.name}#${r.index}`, ...(run.provider ? { provider: run.provider } : {}), ...(run.account ? { account: run.account } : {}), ...(r.id ? { id: r.id } : {}), ...(r.request_id ? { request_id: r.request_id } : {}), ...(r.at ? { at: r.at } : {}), model: r.model, ...(r.tokens ? { tokens: r.tokens } : {}),
  })))
  const { byReply: corr, shortfalls } = matchReplies(refs, exportsIn.map((e) => e.parsed), { windowSeconds })

  // 2. per run: attestation, findings, switches
  const runs: RunResult[] = perRun.map(({ run, replies, outside, events }) => {
    const expected = run.allowed?.length ? run.allowed : [run.declared]
    const alias = expected.some(isFloatingAlias)
    const att = attestModels(events, { allowed: expected })
    const findings: ReplyFinding[] = []
    let usable = 0
    for (const rep of replies) {
      const ok = usableModel(rep.model)
      const idx = ok ? usable++ : null
      const ev: Evidence[] = []
      if (ok && rep.basis === 'provider_field') ev.push({ tier: 'T1', ref: `${run.name}:${rep.line}` })
      for (const c of ok ? corr.get(`${run.name}#${rep.index}`) ?? [] : []) ev.push({ tier: 'T2', source: c.source, method: c.method, confidence: c.confidence, verdict: c.verdict, billed: c.billed, records: c.records })
      for (const a of anchors) {
        const hit = a.ok && rep.id ? a.anchors.get(rep.id) : undefined
        if (!hit) continue
        const late = rep.at ? Date.parse(hit.at) - Date.parse(rep.at) > lagMs : true
        ev.push({ tier: 'T3', ledger: a.ledger, seq: hit.seq, model: hit.model, verdict: !ok || hit.model !== rep.model ? 'disagree' : late ? 'late' : 'agree' })
      }
      const agreeing = ev.filter((e) => e.tier === 'T1' || e.verdict === 'agree')
      const tier = maxTier(agreeing.map((e) => e.tier))
      const t2disagree = ev.filter((e): e is Extract<Evidence, { tier: 'T2' }> => e.tier === 'T2' && e.verdict === 'disagree')
      const t3disagree = ev.filter((e): e is Extract<Evidence, { tier: 'T3' }> => e.tier === 'T3' && e.verdict === 'disagree')
      let resolved: string | null = null
      if (ok && rep.basis === 'provider_field') resolved = rep.model
      else if (ok && agreeing.some((e) => e.tier === 'T2')) resolved = rep.model
      else if (ok && t2disagree.length) {
        const billed = [...new Set(t2disagree.flatMap((e) => e.billed))]
        resolved = billed.length === 1 ? billed[0]! : null
      }
      const conflicts: string[] = []
      if (t2disagree.length) conflicts.push(`${t2disagree.map((e) => `${e.source} (${e.method}, confidence ${e.confidence}) bills ${e.billed.join(', ')}`).join('; ')}, not ${rep.model}`)
      if (t3disagree.length) conflicts.push(`the signed anchor at ${t3disagree.map((e) => `${e.ledger} seq ${e.seq}`).join(', ')} recorded ${t3disagree.map((e) => e.model).join(', ')}: the host record changed after it was anchored`)
      // the model compared with the declaration: the resolved one, or (Codex, no corroboration) the one the host asked for
      const subject = resolved ?? (ok && rep.basis === 'host_requested' ? rep.model : null)
      const matches = alias || !subject ? null : expected.some((x) => modelMatches(x, subject, rep.at)) // a dated snapshot is judged against the reply's own time (RT1 F11)
      findings.push({
        run: run.name, reply: idx, line: rep.line, ...(rep.id ? { id: rep.id } : {}), ...(rep.at ? { at: rep.at } : {}), declared: expected.join(' | '),
        recorded: rep.model, basis: rep.basis, resolved, tier, evidence: ev, matches_declared: matches, ...(conflicts.length ? { conflict: conflicts.join(' · ') } : {}),
        raise_by: TIERS[tier].raise_by,
      })
    }
    const byIdx = new Map(findings.filter((f) => f.reply !== null).map((f) => [f.reply!, f]))
    const refsOf = (f: ReplyFinding | undefined) => (f ? f.evidence.filter((e) => e.tier === 'T1' || e.verdict === 'agree').map((e) => (e.tier === 'T1' ? e.ref : e.tier === 'T2' ? `${e.source} #${e.records.join(',')} (${e.method})` : `${e.ledger} seq ${e.seq}`)) : [])
    const switches: MonitorSwitch[] = att.switches.map((s) => {
      const cause: MonitorSwitchCause = s.cause === 'unrecorded' && isAliasFloat(expected, s.from, s.to) ? 'alias_float' : s.cause
      const before = byIdx.get(s.reply - 1), after = byIdx.get(s.reply)
      return { run: run.name, from: s.from, to: s.to, ...(s.at ? { at: s.at } : {}), reply: s.reply, cause, announced: s.announced, ...(s.host_reason ? { host_reason: s.host_reason } : {}),
        evidence: { before: { tier: before?.tier ?? 'T0', refs: refsOf(before) }, after: { tier: after?.tier ?? 'T0', refs: refsOf(after) } } }
    })
    const violations = alias ? [] : findings.filter((f) => f.matches_declared === false)
    const contradictions = findings.filter((f) => f.conflict)
    const mine = shortfalls.filter((s) => s.replies.some((k) => k.startsWith(`${run.name}#`)))
    const silent = switches.filter((s) => !s.announced)
    const flags = silent.length + violations.length + contradictions.length + mine.length
    const by_tier = zeroTiers()
    for (const f of findings) by_tier[f.tier]++
    const reasons: string[] = []
    let outcome: RunResult['outcome']
    if (alias) {
      outcome = 'INSUFFICIENT_DATA'
      reasons.push(`declared ${expected.join(' | ')} is a floating alias: nothing can be attested against it. Pin an exact model id.`)
    } else if (flags) outcome = 'FAIL'
    else if (!findings.some((f) => f.tier !== 'T0' && f.resolved)) {
      outcome = 'INSUFFICIENT_DATA'
      reasons.push(findings.length ? 'no reply has evidence of which model answered (T0 only)' : 'no replies in this month')
    } else outcome = 'PASS'
    if (violations.length) reasons.push(`${violations.length} of ${findings.length} replies came from ${[...new Set(violations.map((v) => v.resolved ?? v.recorded))].join(', ')}, not ${expected.join(' | ')}`)
    for (const c of SWITCH_CAUSES) {
      const k = silent.filter((s) => s.cause === c).length
      if (k) reasons.push(`${k} silent switch${k > 1 ? 'es' : ''} (${c})`)
    }
    if (contradictions.length) reasons.push(`${contradictions.length} repl${contradictions.length > 1 ? 'ies' : 'y'} where the provider's or the anchor's record disagrees with the host's`)
    if (mine.length) reasons.push(`${mine.length} bucket${mine.length > 1 ? 's' : ''} where the provider billed fewer tokens on the recorded model than the host recorded`)
    if (outcome === 'PASS') reasons.push(`every reply came from ${expected.join(' | ')}; ${switches.length ? 'every switch was announced' : 'no switch'}`)
    return {
      name: run.name, format: run.format, declared: expected.join(' | '), expected, ...(run.file ? { file: run.file } : {}), ...(run.sha256 ? { sha256: run.sha256 } : {}),
      outcome, reasons, replies: findings.length, replies_outside_month: outside, by_tier, switches, violations, contradictions, bucket_shortfalls: mine, flags, rejected_lines: run.record.rejected.length, findings,
    }
  })

  // 3. per declared model
  const decl = new Map<string, DeclaredSummary>()
  for (const r of runs) {
    let d = decl.get(r.declared)
    if (!d) {
      d = { declared: r.declared, runs: 0, replies: 0, by_tier: zeroTiers(), corroborated: { T2: 0, T3: 0 }, contradicted: 0, bucket_shortfalls: 0, switches: { user_command: 0, host_fallback: 0, unrecorded: 0, alias_float: 0 }, silent_switches: [], violations: 0, coverage: { any_evidence: 0, t2: 0, t3: 0, of: 0 }, outcomes: { PASS: 0, FAIL: 0, INSUFFICIENT_DATA: 0 } }
      decl.set(r.declared, d)
    }
    d.runs++
    d.replies += r.replies
    d.outcomes[r.outcome]++
    for (const t of Object.keys(r.by_tier) as EvidenceTier[]) d.by_tier[t] += r.by_tier[t]
    for (const f of r.findings) {
      const t2 = f.evidence.some((e) => e.tier === 'T2' && e.verdict === 'agree'), t3 = f.evidence.some((e) => e.tier === 'T3' && e.verdict === 'agree')
      if (t2) d.corroborated.T2++
      if (t3) d.corroborated.T3++
      if (f.tier !== 'T0') d.coverage.any_evidence++
      if (t2) d.coverage.t2++
      if (t3) d.coverage.t3++
    }
    d.coverage.of += r.replies
    d.contradicted += r.contradictions.length
    d.bucket_shortfalls += r.bucket_shortfalls.length
    d.violations += r.violations.length
    for (const s of r.switches) { d.switches[s.cause]++; if (!s.announced) d.silent_switches.push(s) }
  }
  const per_declared = [...decl.values()].sort((a, b) => a.declared.localeCompare(b.declared))

  // 4. exports and anchors, as used
  const exportsOut = exportsIn.map((e) => {
    const methods: Record<string, number> = {}
    let matched = 0
    for (const r of runs) for (const f of r.findings) {
      const hits = f.evidence.filter((x): x is Extract<Evidence, { tier: 'T2' }> => x.tier === 'T2' && x.source === e.parsed.source)
      if (hits.length) matched++
      for (const h of hits) methods[h.method] = (methods[h.method] ?? 0) + 1
    }
    return { source: e.parsed.source, ...(e.file ? { file: e.file } : {}), ...(e.sha256 ? { sha256: e.sha256 } : {}), rows: e.parsed.rows.length, matched_replies: matched, methods, acknowledged: e.parsed.acknowledged, notes: e.parsed.notes, doc: e.parsed.schema.doc, assumed: e.parsed.schema.assumed }
  })
  const anchorsOut = anchors.map((a) => ({ ledger: a.ledger, ok: a.ok, ...(a.reason ? { reason: a.reason } : {}), ...(a.signer ? { signer: a.signer } : {}), anchors: a.anchors.size }))

  const by_tier = zeroTiers()
  for (const r of runs) for (const t of Object.keys(r.by_tier) as EvidenceTier[]) by_tier[t] += r.by_tier[t]
  const replies = runs.reduce((a, r) => a + r.replies, 0)
  const totals = {
    runs: runs.length, replies, flags: runs.reduce((a, r) => a + r.flags, 0),
    silent_switches: runs.reduce((a, r) => a + r.switches.filter((s) => !s.announced).length, 0),
    violations: runs.reduce((a, r) => a + r.violations.length, 0), contradictions: runs.reduce((a, r) => a + r.contradictions.length, 0), bucket_shortfalls: shortfalls.length,
    by_tier, coverage_any: replies - by_tier.T0,
  }
  return { monitor_version: MONITOR_VERSION, month: input.month, deployer: input.deployer ?? null, runs, per_declared, exports: exportsOut, anchors: anchorsOut, totals, cannot_prove: cannotProve(runs, exportsOut), window_seconds: windowSeconds }
}

function cannotProve(runs: readonly RunResult[], exportsOut: MonitorResult['exports']): string[] {
  const out = [
    'Which weights ran. Every tier here rests on records: the host\'s, the provider\'s, or a signed ledger. None of them observes the serving hardware.',
    'That a provider told the truth. A provider that serves another model and writes the declared name in its reply and in its billing passes every check here, because T1 and T2 then agree with each other.',
    'Anything about requests the host did not record. Coverage is replies with evidence over replies recorded, not over requests made.',
  ]
  if (exportsOut.some((e) => e.methods.bucket_exact || e.methods.bucket_contained || e.methods.bucket_short || e.methods.bucket_absent)) {
    out.push('Which reply a bucket row served. A bucket match says a model was billed in that window for at least those tokens.')
    out.push('Absence outside the export\'s filter. An export limited to some API keys, projects or workspaces reads as "billed no usage" for traffic outside it.')
  }
  if (exportsOut.some((e) => e.methods.time_tokens || e.methods.time_tokens_ambiguous)) out.push('That a time-and-tokens join found the right request. Another request of the same size inside the window would match as well; those joins carry confidence 0.9 or less and name their method.')
  if (runs.some((r) => r.format === 'codex')) out.push('Which model answered a Codex reply on the host record alone. Codex records the model it asked for, so those replies rest on T0 unless an export or an anchor corroborates them.')
  if (!exportsOut.length) out.push('Anything at T2. No provider export was given.')
  return out
}
