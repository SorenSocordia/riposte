/**
 * What a replay says when today's default rule reads an older verdict's inputs differently, for the declarative rulesets
 * (peppol-en16931) and the built-in ones (invoice, pay-app) (2026-10-06). The legal rule has its own reading
 * (legal/replay-notice.ts legalRuleNow), and an AP proof its gate line (replay-case.ts gate_now); this is the same idea for the
 * rest.
 *
 * An outside engineer took a shipped e-invoice extraction, changed the currency the totals are stated in to USD on a EUR
 * invoice, and issued it under the still-selectable peppol-en16931@0.1.0 (whose own documentation says it certified 11 of 20
 * planted defects): PASS-WITH-OPEN. Its replay printed "outcome VERIFIED ... byte-identical", exit 0, with no warning, though
 * today's default peppol-en16931@0.3.0 FAILs the same inputs on the currency. The replay contract is unchanged: the verdict is
 * still re-performed under the rule it names and compared byte for byte. Beside it the replay now says, in a labelled line, what
 * today's default rule and engine read on the same inputs, when that differs; the JSON carries it as `rule_now`.
 *
 * Pure: no I/O, no clock (today's reading is made with issued_at at the epoch, and only its outcomes are read).
 */

import type { ClaimVerdict, Verdict } from '../verdict/schema.js'
import { recordedGateStatus, type RecordedGateStatus } from '../verdict/aggregation.js'
import { ENGINE_VERSION } from '../version.js'
import { verify } from '../verify.js'
import { verifyDeclarative, type ArchiveFile } from '../declarative/evaluate.js'
import { isDeclarativeRuleset, type DeclarativeRuleset, type SuppliedChoice } from '../declarative/types.js'
import type { EvidenceOverlay } from '../declarative/evidence.js'
import { resolveDeclarativeRuleset } from '../rulesets/declarative.js'
import { RULESETS } from '../rulesets/index.js'
import type { TolerancePolicy } from '../tolerance.js'

/** Today's default rule's reading of a verdict's inputs, present only where it differs from the recorded one. */
export interface TodayReading {
  /** today's default rule for the verdict's ruleset id ("peppol-en16931@0.3.0") and this build's engine */
  ruleset: string
  engine: string
  /** what the verdict is about, in the words a line uses: "invoice", "pay application", "document" */
  noun: string
  /** the verdict's gate under today's rule, and as recorded */
  gate: RecordedGateStatus
  gate_recorded: RecordedGateStatus
  /**
   * every check that reads differently: what it recorded (null: the recorded rule has no such check), what today's rule
   * answers, the reason of a can't tell, and a short label for the check ("currency")
   */
  claims: { claim_id: string; was: ClaimVerdict['outcome'] | null; now: ClaimVerdict['outcome']; reason?: string; why?: string }[]
  /** how many checks the verdict holds */
  of: number
}

const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x)

/** A check's short label from its rule id: a leading code with digits and a trailing INT dropped ("R051_CURRENCY" → "currency"). */
export function checkLabel(ruleId: string | undefined): string | undefined {
  if (!ruleId) return undefined
  const words = ruleId.split('_').filter(Boolean)
  if (words.length > 1 && /\d/.test(words[0]!)) words.shift()
  if (words.length > 1 && words[words.length - 1] === 'INT') words.pop()
  const label = words.join(' ').toLowerCase()
  return label === '' ? undefined : label
}

const NOUNS: Readonly<Record<string, string>> = { invoice: 'invoice', 'e-invoice': 'invoice', 'pay-app': 'pay application', payapp: 'pay application' }

/** Today's default verdict on the same inputs, with the rule and engine it names; undefined when nothing here reads them. */
function todaysVerdict(verdict: Verdict, inputs: Record<string, unknown>): Verdict | undefined {
  const rs = verdict.ruleset
  const now = (): Date => new Date(0)
  const tol = isObj(inputs.tolerance) ? (inputs.tolerance as unknown as TolerancePolicy) : undefined
  if (isObj(inputs.extraction) && isDeclarativeRuleset(inputs.ruleset)) {
    // a carried declarative ruleset (by its id): today's default version for this engine; a ruleset this build does not carry has none
    let today: DeclarativeRuleset | undefined
    try { today = resolveDeclarativeRuleset(rs.id, ENGINE_VERSION) } catch { return undefined }
    if (!today || (today.version === rs.version && verdict.engine_version === ENGINE_VERSION)) return undefined
    return verifyDeclarative(structuredClone(inputs.extraction) as Record<string, unknown>, today, {
      now, engine: ENGINE_VERSION, ...(tol ? { tolerance: tol } : {}), ...(isObj(inputs.source) ? { source: inputs.source as { text: string } } : {}),
      ...(isObj(inputs.evidence) ? { evidence: inputs.evidence as unknown as EvidenceOverlay } : {}),
      ...(Object.prototype.hasOwnProperty.call(inputs, 'supplied_choices') ? { supplied_choices: inputs.supplied_choices as Record<string, SuppliedChoice> } : {}),
      ...(Object.prototype.hasOwnProperty.call(inputs, 'archive_files') ? { archive_files: inputs.archive_files as ArchiveFile[] } : {}),
    })
  }
  if (isObj(inputs.extraction) && 'references' in inputs && 'source' in inputs) {
    const today = RULESETS.find(b => b.id === rs.id)
    if (!today || (today.version === rs.version && verdict.engine_version === ENGINE_VERSION)) return undefined
    const refs = isObj(inputs.references) ? inputs.references : {}
    return verify(structuredClone(inputs.extraction) as Record<string, unknown>, {
      now, engine: ENGINE_VERSION, ruleset: today,
      references: { ...(isObj(refs.contract) ? { contract: refs.contract } : {}), evidence: (Array.isArray(refs.evidence) ? refs.evidence : []) as Record<string, unknown>[], history: (Array.isArray(refs.history) ? refs.history : []) as Record<string, unknown>[] },
      ...(isObj(inputs.source) ? { source: inputs.source as { text: string } } : {}),
      ...(tol ? { tolerance: tol } : {}),
    })
  }
  return undefined
}

/**
 * Today's default reading of a verdict's inputs (the default version of its ruleset id, under this build's engine), when it
 * differs from the verdict's own: every check whose outcome or can't-tell reason differs, and every check today's rule has that
 * the recorded rule lacks and that does not pass. Undefined for a legal or AP verdict (each has its own reading), for one that
 * already names today's default under this engine, for inputs nothing here reads, and when every check reads the same.
 */
export function todayReading(verdict: Verdict, inputs: unknown): TodayReading | undefined {
  if (!isObj(verdict) || !isObj(verdict.ruleset) || typeof verdict.ruleset.id !== 'string' || !isObj(inputs)) return undefined
  if (verdict.ruleset.id === 'legal' || isObj(inputs.ap) || isObj(inputs.ap_structured)) return undefined
  let now: Verdict | undefined
  try { now = todaysVerdict(verdict, inputs) } catch { return undefined }
  if (!now) return undefined
  const recorded = Array.isArray(verdict.claims) ? verdict.claims : []
  const claims: TodayReading['claims'] = []
  for (const c of now.claims) {
    const was = recorded.find(r => r?.claim_id === c.claim_id)
    if (was && was.outcome === c.outcome && (was.insufficiency?.reason ?? '') === (c.insufficiency?.reason ?? '')) continue
    if (!was && c.outcome === 'PASS') continue // a check today's rule adds, and that holds, says nothing new
    const why = checkLabel(c.rule_id)
    claims.push({ claim_id: c.claim_id, was: was ? was.outcome : null, now: c.outcome, ...(c.insufficiency ? { reason: c.insufficiency.reason } : {}), ...(why !== undefined ? { why } : {}) })
  }
  if (claims.length === 0) return undefined
  return {
    ruleset: `${now.ruleset.id}@${now.ruleset.version}`, engine: ENGINE_VERSION, noun: NOUNS[now.ruleset.domain ?? ''] ?? NOUNS[now.ruleset.id] ?? 'document',
    gate: now.gate_status ?? recordedGateStatus(now), gate_recorded: verdict.gate_status ?? recordedGateStatus(verdict), claims, of: recorded.length,
  }
}

const gateWords = (g: string): string => g.replace(/_WITH_/g, '-WITH-')
const answerWords = (o: string, reason?: string, why?: string): string =>
  o === 'INSUFFICIENT_DATA' ? `can't tell${reason ? `: ${reason}` : ''}${why ? ` (${why})` : ''}` : `${o}${why ? ` (${why})` : ''}`

/**
 * The lines a replay prints under its headline, never the only line: the verdict's reading under today's default rule, with the
 * checks that fail under it named, then one line per check that reads differently (at most ten, then a count).
 *   under today's default peppol-en16931@0.3.0 this invoice reads FAIL (currency), not PASS-WITH-OPEN; 2 checks read differently:
 *     document.R051_CURRENCY reads FAIL (currency); the recorded rule has no such check
 */
export function renderTodayReading(r: TodayReading, recordedEngine?: string): string[] {
  const rule = `today's default ${r.ruleset}${recordedEngine !== undefined && recordedEngine !== r.engine ? ` (engine ${r.engine})` : ''}`
  const failing = r.claims.filter(c => c.now === 'FAIL').map(c => c.why ?? c.claim_id)
  const named = r.gate === 'FAIL' && failing.length ? ` (${failing.slice(0, 3).join(', ')}${failing.length > 3 ? ', …' : ''})` : ''
  const n = r.claims.length
  const head = r.gate !== r.gate_recorded
    ? `under ${rule} this ${r.noun} reads ${gateWords(r.gate)}${named}, not ${gateWords(r.gate_recorded)}; ${n} check${n === 1 ? '' : 's'} read${n === 1 ? 's' : ''} differently:`
    : `under ${rule} ${n} check${n === 1 ? '' : 's'} of this ${r.noun} read${n === 1 ? 's' : ''} differently (it still reads ${gateWords(r.gate)}):`
  const lines = r.claims.slice(0, 10).map(c => `  ${c.claim_id} reads ${answerWords(c.now, c.reason, c.why)}${c.was === null ? '; the recorded rule has no such check' : `, not ${answerWords(c.was)}`}`)
  if (n > 10) lines.push(`  and ${n - 10} more (the JSON lists every one, under rule_now)`)
  return [head, ...lines]
}
