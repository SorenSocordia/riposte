/**
 * What a replay of a legal verdict tells the relying party about the rule version (cold-review round 5, 2026-10-05).
 *
 * A legal verdict names its rule ("legal@0.0.1") and replays under it, byte for byte, which is the replay contract. A cold reader
 * (an AI agent in an engineer's role) found the gap beside it: an issuer can pick the oldest rule that passes. A quotation cut after "Unless …," PASSes under
 * legal@0.0.1 and is held under today's default, and `replay --strict` on the 0.0.1 bundle printed "VERIFIED … re-performed with
 * legal (engine 0.6.0)", exit 0, with no hint. Three things answer it, all outside the hashed verdict:
 *   - the VERIFIED line names the rule version (cli.ts, the replay command's own line: "(ruleset legal@0.0.1, engine 0.6.0)");
 *   - when today's default rule reads the same inputs differently, a second line says how (legalRuleNow, renderRuleNow), as the AP
 *     replay's "under engine 0.6.0 this would read …" line does, and the JSON carries it as `rule_now`;
 *   - `--require-ruleset legal@>=0.4.0` (any ruleset id: `peppol-en16931@>=0.2.0`) fails, exit 1, a replay whose verdict names that
 *     ruleset at an older version (parseRulesetRequirement, rulesetRequirementProblem).
 * The re-performance itself is unchanged: the verdict is still re-performed under the rule it names, and compared byte for byte.
 *
 * Pure: no I/O, no clock (today's reading is made with issued_at fixed at the epoch, and only its outcomes are read).
 */

import type { ClaimVerdict, Verdict } from '../verdict/schema.js'
import { recordedGateStatus, type RecordedGateStatus } from '../verdict/aggregation.js'
import { ENGINE_VERSION } from '../version.js'
import { defaultLegalRuleset, verifyCitations, type Citation, type OpinionSources } from './index.js'

/** Today's default rule's reading of a legal verdict's inputs, present only where it differs from the recorded one. */
export interface RuleNow {
  /** today's default rule ("legal@0.5.0") and this build's engine */
  ruleset: string
  engine: string
  /** the verdict's gate under today's rule, and as recorded (PASS, PASS_WITH_OPEN, FAIL, INSUFFICIENT_DATA) */
  gate: RecordedGateStatus
  gate_recorded: RecordedGateStatus
  /** every claim that reads differently: what it recorded, what today's rule answers, the reason and a short why */
  claims: { claim_id: string; was: ClaimVerdict['outcome']; now: ClaimVerdict['outcome']; reason?: string; why?: string }[]
  /** how many claims the verdict holds */
  of: number
}

const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x)

/** A short why for a claim's answer: an insufficiency's own label ("elided condition", "whose words"), else its explanation's first clause. */
function whyOf(c: ClaimVerdict): string | undefined {
  if (c.outcome === 'PASS') return undefined
  const label = /^([a-z][a-z ]{2,40}):/.exec(c.insufficiency?.detail ?? '')?.[1]
  if (label !== undefined) return label
  const differs = c.computation?.operands.differs
  if (c.outcome === 'FAIL' && typeof differs === 'string') return differs.length > 120 ? `${differs.slice(0, 117)}…` : differs
  const e = c.explanation.replace(/^[^:]{1,200}:\s+/, '').split(/;\s/)[0] ?? ''
  return e.length === 0 ? undefined : e.length > 120 ? `${e.slice(0, 117)}…` : e
}

/**
 * Today's default legal rule's reading of a legal verdict's inputs, when it differs from the verdict's own (claim by claim: the
 * outcome or the insufficiency reason); undefined when the verdict is not legal, already names today's default under this engine,
 * its inputs are not a legal bundle's, or every claim reads the same.
 */
export function legalRuleNow(verdict: Verdict, inputs: unknown): RuleNow | undefined {
  if (!isObj(verdict) || !isObj(verdict.ruleset) || verdict.ruleset.id !== 'legal') return undefined
  const today = defaultLegalRuleset(ENGINE_VERSION)
  if (verdict.ruleset.version === today.version && verdict.engine_version === ENGINE_VERSION) return undefined
  if (!isObj(inputs) || !Array.isArray(inputs.citations) || !isObj(inputs.sources)) return undefined
  let now: Verdict
  try {
    now = verifyCitations(structuredClone(inputs.citations) as Citation[], structuredClone(inputs.sources) as OpinionSources, { engine: ENGINE_VERSION, now: () => new Date(0) })
  } catch { return undefined }
  const recorded = Array.isArray(verdict.claims) ? verdict.claims : []
  const claims: RuleNow['claims'] = []
  for (const c of now.claims) {
    const was = recorded.find(r => r?.claim_id === c.claim_id)
    if (!was) continue
    if (was.outcome === c.outcome && (was.insufficiency?.reason ?? '') === (c.insufficiency?.reason ?? '')) continue
    const why = whyOf(c)
    claims.push({ claim_id: c.claim_id, was: was.outcome, now: c.outcome, ...(c.insufficiency ? { reason: c.insufficiency.reason } : {}), ...(why !== undefined ? { why } : {}) })
  }
  if (claims.length === 0) return undefined
  return { ruleset: `${today.id}@${today.version}`, engine: ENGINE_VERSION, gate: now.gate_status ?? recordedGateStatus(now), gate_recorded: verdict.gate_status ?? recordedGateStatus(verdict), claims, of: recorded.length }
}

const answerWords = (o: string, reason?: string, why?: string): string =>
  o === 'INSUFFICIENT_DATA' ? `can't tell${reason ? `: ${reason}` : ''}${why ? ` (${why})` : ''}` : `${o}${why ? ` (${why})` : ''}`

/**
 * The lines a replay prints under its headline (never the only line): one for a one-quotation verdict, else a head line and one per
 * quotation that reads differently (at most ten, then a count).
 *   under today's default legal@0.5.0 this quotation reads can't tell: SELECTIVE_QUOTE (elided condition), not PASS
 *   under today's default legal@0.5.0 the verdict reads PASS-WITH-OPEN, not PASS; 2 of 5 quotations read differently:
 *     cite.p4n2 reads can't tell: SPAN_NOT_FOUND (whose words), not PASS
 */
export function renderRuleNow(r: RuleNow, recordedEngine?: string): string[] {
  const rule = `today's default ${r.ruleset}${recordedEngine !== undefined && recordedEngine !== r.engine ? ` (engine ${r.engine})` : ''}`
  const gate = (g: string): string => g.replace(/_WITH_/g, '-WITH-')
  if (r.of === 1 && r.claims.length === 1) {
    const c = r.claims[0]!
    return [`under ${rule} this quotation reads ${answerWords(c.now, c.reason, c.why)}, not ${answerWords(c.was)}`]
  }
  const head = r.gate !== r.gate_recorded
    ? `under ${rule} the verdict reads ${gate(r.gate)}, not ${gate(r.gate_recorded)}; ${r.claims.length} of ${r.of} quotations read differently:`
    : `under ${rule} ${r.claims.length} of ${r.of} quotations read differently (the verdict still reads ${gate(r.gate)}):`
  const lines = r.claims.slice(0, 10).map(c => `  ${c.claim_id} reads ${answerWords(c.now, c.reason, c.why)}, not ${answerWords(c.was)}`)
  if (r.claims.length > 10) lines.push(`  and ${r.claims.length - 10} more (the JSON lists every one, under rule_now)`)
  return [head, ...lines]
}

/**
 * The scope lines a replay prints under a legal verdict (2026-10-06; display only). The shared scope line states an evidence floor, which a
 * legal verdict never has: "evidence floor unstated (the values carry no provenance: the extraction is checked as given)" is invoice
 * wording, and a cold reader (an AI agent) found it printed under a legal replay. A legal verdict's scope says what it was checked
 * against instead. The verdict's own scope block (hashed) is unchanged; a verdict with no scope block gets none.
 */
export function legalScopeLines(v: { ruleset?: { id?: unknown; version?: unknown }; engine_version?: unknown; scope?: { ruleset: string; engine_version: string; statements?: readonly string[] } }): string[] {
  if (!v.scope) return []
  return [
    `Scope: checked against ${v.scope.ruleset} by engine ${v.scope.engine_version}; each quotation against the opinion text supplied for its cite, recorded in the verdict by its sha256.`,
    'Advisories are counsel, not verdicts.',
    'This is a check, not a decision.',
  ]
}

/** A relying party's floor on a verdict's rule: `<ruleset id>@>=<version>`, or `<ruleset id>@<version>` for that version exactly. */
export interface RulesetRequirement { id: string; op: '>=' | '='; version: string; written: string }

const VERSION = /^\d+\.\d+\.\d+$/

/** Read a `--require-ruleset` value; throws, in words, on one that is not `<id>@>=<x.y.z>` or `<id>@<x.y.z>`. */
export function parseRulesetRequirement(written: string): RulesetRequirement {
  const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)@(>=)?(.+)$/.exec(written.trim())
  // a value cut at "@" (or with no "@") is what a shell leaves when it reads ">" as a redirect: say to quote it
  const cut = /^[A-Za-z0-9][A-Za-z0-9._-]*@?$/.test(written.trim()) ? '; the shell reads ">" as a redirect, so quote the value: --require-ruleset \'legal@>=0.4.0\'' : ''
  if (!m || !VERSION.test(m[3] as string)) throw new Error(`--require-ruleset takes <ruleset>@>=<version> or <ruleset>@<version>, such as 'legal@>=0.4.0' or 'peppol-en16931@>=0.2.0' (got "${written}")${cut}`)
  return { id: m[1] as string, op: m[2] === '>=' ? '>=' : '=', version: m[3] as string, written: written.trim() }
}

/** -1, 0 or 1: x.y.z compared part by part, as numbers. */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0) ? -1 : 1
  return 0
}

/**
 * Why a verdict fails the relying party's requirements, in words, or undefined when it meets them (a requirement on another ruleset
 * id does not apply to it; a verdict whose ruleset has no x.y.z version cannot meet a requirement on its id).
 */
export function rulesetRequirementProblem(reqs: readonly RulesetRequirement[], verdict: unknown): string | undefined {
  const rs = isObj(verdict) && isObj(verdict.ruleset) ? verdict.ruleset : undefined
  if (!rs || typeof rs.id !== 'string') return undefined
  const named = `${rs.id}@${String(rs.version)}`
  for (const r of reqs.filter(q => q.id === rs.id)) {
    const v = typeof rs.version === 'string' && VERSION.test(rs.version) ? rs.version : undefined
    const ok = v !== undefined && (r.op === '>=' ? compareVersions(v, r.version) >= 0 : compareVersions(v, r.version) === 0)
    if (ok) continue
    return r.op === '>='
      ? `the verdict was issued under ${named}, older than the ${r.id}@${r.version} or later that --require-ruleset ${r.written} asks for. It re-performs under its own rule, but that rule is not one the relying party accepts`
      : `the verdict was issued under ${named}, not the ${r.id}@${r.version} that --require-ruleset ${r.written} asks for`
  }
  return undefined
}

/** Which requirements apply to no verdict of this ruleset id (said once, so a misspelt id is not silently ignored). */
export function unappliedRequirements(reqs: readonly RulesetRequirement[], verdicts: readonly unknown[]): RulesetRequirement[] {
  const ids = new Set(verdicts.map(v => (isObj(v) && isObj(v.ruleset) && typeof v.ruleset.id === 'string' ? v.ruleset.id : undefined)).filter((x): x is string => x !== undefined))
  return reqs.filter(r => !ids.has(r.id))
}
