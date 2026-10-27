/**
 * The dispute opinion: a person (or an agent) contests one claim of a recorded verdict. Riposte answers in the courtroom
 * format, separating what it can settle from what it cannot:
 *
 *   FACT  the recomputation, the bound operands, the aggregation. Deterministic; it replays; it is never re-ruled.
 *   LAW   whether the rule is the right rule for this document. That is a person's to rule, and a signed ruling becomes
 *         precedent for the rule.
 *
 * Proposed dispositions: UPHOLD (the finding stands; nothing in the record argues otherwise), REFER (the FACT replays, but
 * the rule's precedent puts it on the review queue, so the LAW question goes to a person; or the finding is judgement-tier,
 * an advisory that never held the action), or WITHHELD (a premise failed its check). An abstention is always upheld: a
 * ruling cannot manufacture data. Reachable from any single FAIL: every notice carries its own dispute path. Pure and
 * deterministic.
 *
 * TENANT SCOPE (2026-09-28): with `scope: { tenant_id }` the precedent, the prior ruling and the disputed verdict are
 * read from that tenant's records only (see snapshot.ts). Another tenant's reviews, reviewer ids and notes are never
 * cited, so a hosted, shared book can serve disputes. The subject records the resolved precedent rule, so a person's
 * signed ruling on this opinion can later be checked against the book alone (ruling.ts, statute.ts).
 */

import { verifyReplay } from '../protocol/replay.js'
import { disputeCommand } from '../verdict/notices.js'
import { MIN_VERDICT_CONFIDENCE } from '../verdict/from-report.js'
import { rateInterval, type BoundMethod } from '../verdict/bounds.js'
import { pct } from '../verdict/voice.js'
import type { ClaimVerdict, Outcome, Value, Verdict } from '../verdict/schema.js'
import { aggregateOutcome } from '../verdict/aggregation.js'
import type { LedgerRecord } from '../ledger/types.js'
import { recordFacts } from '../ledger/disk.js'
import type { TrustedKeys } from '../ledger/decisions.js'
import type { RootKeys } from '../ledger/registry.js'
import { openSnapshot, type LedgerSnapshot, type SnapshotView } from './snapshot.js'
import { chainPremise, finalizeOpinion, replayPremise, short, sourceHashOf } from './common.js'
import type { Authority, CitedCell, DissentPoint, Opinion, OpinionScope, OverturnCondition, Precedent, Premise, Reading, Ruling } from './types.js'

export interface DisputeOpinionInput {
  /** The book of record. The disputed verdict must be on it. */
  snapshot: LedgerSnapshot
  verdict_id: string
  /** The contested claim. Default: the first claim whose outcome drove the verdict's outcome (a FAIL on a FAIL verdict, a PASS on a PASS verdict, an abstention on an abstained one). */
  claim_id?: string
  /** The original inputs, if at hand: the opinion then also verifies the verdict is FOR these inputs (input binding). */
  inputs?: unknown
  /** When a rule's precedent puts it on the review queue (as ruleCalibration: default ≥ 5 reviewed and ≥ 20% overturned). */
  precedent?: { min_reviewed?: number; flag_threshold?: number }
  /** Confidence and method for the precedent's interval. Default 0.95, 'wilson'. */
  confidence?: number
  method?: BoundMethod
  /** The declared consequence of the workflow the verdict belongs to, if any. */
  consequence?: { tier: string; description?: string }
  /** Read one tenant's records only (a shared book): its precedent, its prior ruling, its verdict. */
  scope?: OpinionScope
  /** Anchor decision signers to people on read (a book with a decision signed by another key does not verify). */
  trusted_keys?: TrustedKeys
  /** The registry's root key(s): the key registry on the book anchors every signer once it is in force. */
  root_keys?: RootKeys
}

/** The arguments of a dispute opinion over an already-opened view (the book is read once for many opinions). */
export type DisputeOnView = Omit<DisputeOpinionInput, 'snapshot' | 'scope' | 'trusted_keys' | 'root_keys'>

const fmt = (v: Value | undefined): string => (v === undefined ? '—' : JSON.stringify(v))
/** Normalizations that changed something (the binder logs `already_number` / `already_iso` for no-ops). */
const realNorms = (e: { normalizations?: string[] }): string[] => (e.normalizations ?? []).filter(n => !n.startsWith('already_'))

/** The outcome under the rule the verdict names (verdict/aggregation.ts), never an assumed one. */
function aggregate(v: Verdict, claims: readonly Pick<ClaimVerdict, 'outcome' | 'kind'>[] = v.claims): Outcome {
  return aggregateOutcome(v.aggregation, claims)
}

function outcomeIf(v: Verdict, claim: ClaimVerdict, as: Outcome): Outcome {
  return aggregate(v, v.claims.map(c => (c === claim ? { outcome: as, kind: c.kind } : c)))
}

/** Smallest x ≥ 0 such that x more overturned reviews put the rule on the review queue. */
function overturnsToFlag(n: number, o: number, minReviewed: number, threshold: number): number {
  for (let x = 0; x < 1_000_000; x++) if (n + x >= minReviewed && (o + x) / (n + x) >= threshold) return x
  return 1_000_000
}

/** Smallest y ≥ 1 such that y more upheld reviews take the rule off the review queue. */
function upheldToUnflag(n: number, o: number, threshold: number): number {
  for (let y = 1; y < 1_000_000; y++) if (o / (n + y) < threshold) return y
  return 1_000_000
}

export function disputeOpinion(input: DisputeOpinionInput): Opinion {
  const { snapshot, scope, trusted_keys, root_keys, ...rest } = input
  return disputeOpinionOnView(openSnapshot(snapshot, { ...(scope ? { scope } : {}), ...(trusted_keys ? { trusted_keys } : {}), ...(root_keys?.length ? { root_keys } : {}) }), rest)
}

/** A dispute opinion over an opened view (scoped or not). The statute uses it to re-derive many opinions over one book. */
export function disputeOpinionOnView(view: SnapshotView, input: DisputeOnView): Opinion {
  const rec = view.records.find(r => (recordFacts(r) ?? r.verdict).verdict_id === input.verdict_id) // P-J: no parse per record
  if (!rec) {
    throw new Error(view.scope
      ? `verdict ${input.verdict_id} is not on tenant ${view.scope.tenant_id}'s book of record; an opinion is only given on the tenant's own recorded verdict`
      : `verdict ${input.verdict_id} is not on the supplied book of record; an opinion is only given on a recorded verdict`)
  }
  const v = rec.verdict
  const claim = input.claim_id !== undefined
    ? v.claims.find(c => c.claim_id === input.claim_id)
    : (v.claims.find(c => c.outcome === v.outcome) ?? v.claims.find(c => c.outcome === 'FAIL') ?? v.claims[0])
  if (!claim) throw new Error(input.claim_id !== undefined ? `verdict ${v.verdict_id} has no claim ${input.claim_id}` : `verdict ${v.verdict_id} has no claims to dispute`)

  const minReviewed = input.precedent?.min_reviewed ?? 5
  const threshold = input.precedent?.flag_threshold ?? 0.2
  const confidence = input.confidence ?? 0.95
  const method: BoundMethod = input.method ?? 'wilson'
  const domain = v.ruleset.domain
  const verb = claim.outcome === 'FAIL' ? 'FAILed' : claim.outcome === 'PASS' ? 'PASSed' : 'abstained'
  /** A judgement-tier finding: an advisory (COUNSEL), never a VERDICT, and it never held the action. */
  const reasoned = claim.tier !== 'DETERMINISTIC'
  // P-K (ledger-disk): index the records, not their verdicts. A disk-backed book reads each verdict on demand, and holding
  // every one is the whole book in the heap; only the replayed ids' verdicts are read. The later record still wins.
  const recordById = new Map<string, LedgerRecord>(view.records.map(r => [(recordFacts(r) ?? r.verdict).verdict_id, r])) // P-J
  const verdictsOf = (ids: readonly string[]): Map<string, Verdict> =>
    new Map(ids.flatMap(id => { const r = recordById.get(id); return r ? [[id, r.verdict] as [string, Verdict]] : [] }))

  // ── precedent: reviewed verdicts where this rule reached the same outcome, and the verdict did too ─────────────────
  const prec: LedgerRecord[] = view.records
    .filter(r => r.review && r.verdict.verdict_id !== v.verdict_id && r.verdict.ruleset.domain === domain && r.verdict.outcome === claim.outcome
      && r.verdict.claims.some(c => c.rule_id === claim.rule_id && c.outcome === claim.outcome))
    .sort((x, y) => (Number(y.review!.decision === 'OVERTURNED') - Number(x.review!.decision === 'OVERTURNED'))
      || y.review!.decided_at.localeCompare(x.review!.decided_at) || x.verdict.verdict_id.localeCompare(y.verdict.verdict_id))
  const pn = prec.length
  const po = prec.filter(r => r.review!.decision === 'OVERTURNED').length
  const pu = pn - po
  const flagged = claim.outcome !== 'INSUFFICIENT_DATA' && pn >= minReviewed && po / pn >= threshold
  const piv = rateInterval(po, pn, confidence, method)
  const overturnedIds = prec.filter(r => r.review!.decision === 'OVERTURNED').map(r => r.verdict.verdict_id)

  // ── premises ─────────────────────────────────────────────────────────────────────────────────────────────────────
  const premises: Premise[] = []
  premises.push(chainPremise('P1', view))
  premises.push(replayPremise('P2', 'disputed', [v.verdict_id], verdictsOf([v.verdict_id]), { allowReasoned: reasoned }))
  let next = 3
  if (input.inputs !== undefined) {
    const rp = verifyReplay(v, input.inputs)
    premises.push({
      id: `P${next++}`,
      statement: `Verdict \`${v.verdict_id}\` is FOR the supplied inputs: its input_hash re-derives from them.`,
      check: 'verifyReplay (protocol/replay) with inputs',
      refs: [view.refOf(v.verdict_id)],
      verified: rp.ok,
      detail: rp.ok ? 'input binding verified' : (rp.reason ?? 'input binding failed'),
    })
  }
  const pClaim = `P${next++}`
  const invariantErrors: string[] = []
  if (claim.outcome === 'INSUFFICIENT_DATA') {
    if (!claim.insufficiency) invariantErrors.push('an abstention without an explained insufficiency')
  } else {
    if (claim.evidence.length === 0) invariantErrors.push(`${claim.outcome} without evidence`)
    if (claim.insufficiency) invariantErrors.push(`${claim.outcome} carrying an insufficiency`)
    if (claim.tier !== 'DETERMINISTIC' && claim.tier !== 'REASONED') invariantErrors.push(`tier ${claim.tier}`)
    const guessed = claim.evidence.filter(e => e.confidence < MIN_VERDICT_CONFIDENCE)
    if (guessed.length) invariantErrors.push(`${guessed.length} operand(s) below confidence ${MIN_VERDICT_CONFIDENCE}`)
  }
  const claimDesc = claim.outcome === 'INSUFFICIENT_DATA'
    ? `abstained: ${claim.insufficiency?.reason ?? '?'} (${claim.insufficiency?.detail ?? claim.explanation})`
    : `${claim.outcome}: ${claim.explanation}`
  premises.push({
    id: pClaim,
    statement: `Claim \`${claim.claim_id}\` (${claim.rule_name}, rule \`${claim.rule_id}\`) ${claimDesc}. Its ${claim.evidence.length} cited cell(s) are exact-path bindings${claim.outcome === 'INSUFFICIENT_DATA' ? ' (or none)' : ` at confidence ≥ ${MIN_VERDICT_CONFIDENCE}`}.`,
    check: reasoned ? 'the schema invariants (evidence on PASS/FAIL; insufficiency iff abstained; no guessed operand); REASONED tier: an advisory' : 'the schema invariants (evidence on PASS/FAIL; insufficiency iff abstained; DETERMINISTIC tier; no guessed operand)',
    refs: [view.refOf(v.verdict_id)],
    verified: invariantErrors.length === 0,
    detail: invariantErrors.length === 0 ? 'claim invariants hold' : invariantErrors.join('; '),
  })
  const pAgg = `P${next++}`
  const agg = aggregate(v)
  const cov = v.coverage
  const counts = { pass: v.claims.filter(c => c.outcome === 'PASS').length, fail: v.claims.filter(c => c.outcome === 'FAIL').length, ins: v.claims.filter(c => c.outcome === 'INSUFFICIENT_DATA').length }
  const aggOk = agg === v.outcome && cov.claims_pass === counts.pass && cov.claims_fail === counts.fail && cov.claims_insufficient === counts.ins && cov.claims_total === v.claims.length
  premises.push({
    id: pAgg,
    statement: `The document outcome ${v.outcome} follows from its ${v.claims.length} claim(s) under ${v.aggregation} (${counts.pass} PASS · ${counts.fail} FAIL · ${counts.ins} can't-tell).`,
    check: 'the aggregation rule, recomputed from the claims',
    refs: [view.refOf(v.verdict_id)],
    verified: aggOk,
    detail: aggOk ? 'aggregation and coverage recompute' : `recomputed ${agg} with ${JSON.stringify(counts)} against recorded ${v.outcome} / ${JSON.stringify(cov)}`,
  })
  const pPrec = `P${next++}`
  const precIds = prec.map(r => r.verdict.verdict_id)
  const precReplay = replayPremise(pPrec, 'precedent', precIds, verdictsOf(precIds))
  premises.push({
    id: pPrec,
    statement: `Precedent for \`${claim.rule_id}\` in '${domain}': ${pn} reviewed ${claim.outcome} verdict(s) on which it ${verb}; ${pu} upheld, ${po} overturned.${pn ? ` Each replays.` : ''}`,
    check: `${precReplay.check}, read from the ledger's REVIEW events`,
    refs: [...precReplay.refs, ...overturnedIds.map(id => view.refOf(id))],
    verified: precReplay.verified && view.content_verified,
    detail: !view.content_verified ? 'precedent read from an unverified record set' : precReplay.detail,
  })
  const pPrior = `P${next++}`
  const own = view.eventsFor(v.verdict_id).review
  premises.push({
    id: pPrior,
    statement: rec.review
      ? `A person has already ruled on this verdict: ${rec.review.decision} (${rec.review.reviewer_id}, ${rec.review.decided_at})${rec.review.note ? `: "${rec.review.note}"` : ''}.`
      : 'No person has ruled on this verdict yet.',
    check: 'the ledger\'s REVIEW events (openSnapshot.eventsFor)',
    refs: [view.refOf(v.verdict_id)],
    verified: view.content_verified && (rec.review ? own !== undefined : own === undefined),
    detail: view.content_verified ? 'read from a content-verified chain' : 'read from an unverified record set',
  })

  // ── readings ─────────────────────────────────────────────────────────────────────────────────────────────────────
  const formula = claim.computation?.formula ?? claim.rule_name
  const tol = claim.computation?.tolerance
  const tolText = tol ? ` (tolerance${tol.abs !== undefined ? ` ±${tol.abs}` : ''}${tol.rel !== undefined ? ` rel ${tol.rel}` : ''})` : ''
  const cells: CitedCell[] = [
    { cell: `${claim.field}: asserted side`, value: claim.asserted, premise: pClaim },
    ...(claim.computation ? [{ cell: 'expected side (recomputed / reference)', value: claim.computation.result, premise: pClaim }] : []),
    ...(claim.variance !== undefined ? [{ cell: 'variance (asserted − expected)', value: claim.variance, premise: pClaim }] : []),
    ...(tol?.abs !== undefined ? [{ cell: 'tolerance (abs)', value: tol.abs, premise: pClaim }] : []),
    ...claim.evidence.map(e => ({
      cell: e.locator.kind === 'field'
        ? `${e.locator.source}:${e.locator.path} (confidence ${e.confidence}${realNorms(e).length ? `; ${realNorms(e).join(', ')}` : ''})`
        : `span ${short(e.locator.source_hash)}[${e.locator.start}..${e.locator.end}] (confidence ${e.confidence})`,
      value: e.value,
      premise: pClaim,
    })),
    ...(claim.insufficiency ? [{ cell: 'insufficiency', value: `${claim.insufficiency.reason}: ${claim.insufficiency.detail}`, premise: pClaim }] : []),
  ]
  const held = v.outcome === 'FAIL' ? 'the FAIL is surfaced at record and advise, and holds the action at gate and autonomy'
    : v.outcome === 'INSUFFICIENT_DATA' ? 'the abstention is surfaced at record and advise, and holds the action at gate and autonomy'
    : 'the action goes where the rung sends a PASS'
  let readings: Reading[]
  if (reasoned) {
    readings = [
      { id: 'A', label: 'The advisory stands', statement: `The judgement-tier finding stands as advice: ${claim.explanation}`, cells, consequence: 'People and agents may proceed with the data. The advisory stays on record, shown with the evidence it rests on; it never held the action.' },
      { id: 'B', label: 'Dismiss the advisory', statement: 'The judgement is wrong, or does not matter for this document.', cells, consequence: 'It is dismissed. Nothing about the action changes, because an advisory never held it.' },
    ]
  } else if (claim.outcome === 'FAIL') {
    const alt = outcomeIf(v, claim, 'PASS')
    readings = [
      { id: 'A', label: 'The FAIL stands', statement: `The two sides of \`${formula}\` disagree for \`${claim.field}\`: ${fmt(claim.asserted)} against ${fmt(claim.computation?.result)}${claim.variance !== undefined ? ` (variance ${claim.variance})` : ''}${tolText}. The document, as extracted, is wrong here.`, cells, consequence: `The document stays ${v.outcome}; ${held}.` },
      { id: 'B', label: 'Overturn: the check is wrong here', statement: `The document is right and the check misread it: an operand was bound or normalized wrongly, or \`${claim.rule_id}\` is not the right rule for this document (a question of LAW).`, cells, consequence: `This claim would count as PASS; the document outcome would become ${alt}${alt === 'FAIL' ? ' (other claims still FAIL it)' : ''}.` },
    ]
  } else if (claim.outcome === 'PASS') {
    readings = [
      { id: 'A', label: 'The PASS stands', statement: `The two sides of \`${formula}\` agree for \`${claim.field}\`: ${fmt(claim.asserted)} against ${fmt(claim.computation?.result)}${tolText}.`, cells, consequence: `The document stays ${v.outcome}; ${held}.` },
      { id: 'B', label: 'Overturn: the check missed an error', statement: `The cited values are as bound, but the assertion is wrong in a way \`${claim.rule_id}\` does not see, or a cited value is wrong at its source.`, cells, consequence: 'This claim would count as FAIL; the document outcome would become FAIL.' },
    ]
  } else {
    const missing = claim.insufficiency?.missing?.length ? claim.insufficiency.missing.join(', ') : 'the missing input'
    readings = [
      { id: 'A', label: 'The abstention stands', statement: `The check could not run: ${claim.insufficiency?.reason ?? 'INSUFFICIENT_DATA'} (${claim.insufficiency?.detail ?? claim.explanation}).`, cells, consequence: 'A person decides this claim; nothing acts on it automatically.' },
      { id: 'B', label: 'Overturn: the data suffices', statement: `${missing} was in fact available (under another name, or in a reference not supplied), so the check should have run.`, cells, consequence: 'The rule would run on that data; no ruling can say how it comes out. Only a re-run, which is a new verdict with a new id, can.' },
    ]
  }

  // ── authorities ──────────────────────────────────────────────────────────────────────────────────────────────────
  const authorities: Authority[] = [
    { source: 'ruleset', cite: `${v.ruleset.id}@${v.ruleset.version} (${domain}) · ${claim.rule_id}`, quote: `${claim.rule_name}: ${formula}${tolText}` },
    { source: 'verdict schema', cite: 'VERDICT-SCHEMA v0 §design rules 2–3', quote: 'Three outcomes, never a fourth. PASS (the check ran and held) · FAIL (the check ran and did not hold) · INSUFFICIENT_DATA (the check could not run — the inputs did not permit a determination). … ANY_FAIL_FAILS: FAIL if any claim FAILs; else INSUFFICIENT_DATA if no claim could run; else PASS' },
    ...(claim.outcome !== 'INSUFFICIENT_DATA' ? [{ source: 'verdict schema', cite: 'VERDICT-SCHEMA v0 §honesty rules', quote: `A verdict is never issued on a guessed field. … any PASS/FAIL resting on an operand below ${MIN_VERDICT_CONFIDENCE} becomes INSUFFICIENT_DATA / AMBIGUOUS_FIELD, with the guessed operand still shown so the developer can name it properly.` }] : []),
    { source: 'Riposte earned-voice doctrine', cite: 'VERDICT-SCHEMA v0.1 §opinions', quote: 'The deterministic check settles FACT, and FACT replays. Whether a rule applies to a document is LAW, and a ruling on LAW is a person\'s. Riposte proposes; a person signs or overrules.' },
    ...(reasoned ? [{ source: 'Riposte channel doctrine', cite: 'VERDICT-SCHEMA v0.1 §typed channels', quote: 'Judgement-tier findings are COUNSEL, never VERDICT: advisories with a strength, shown with the evidence they rest on, and they never hold the action.' }] : []),
  ]

  // ── precedent ────────────────────────────────────────────────────────────────────────────────────────────────────
  const whose = view.scope ? ` (tenant \`${view.scope.tenant_id}\`'s own record)` : ''
  const precedent: Precedent = {
    summary: pn === 0
      ? `No reviewed ${claim.outcome} verdict in '${domain}'${whose} on which \`${claim.rule_id}\` ${verb}: this rule has no precedent yet.`
      : `${pn} reviewed ${claim.outcome} verdict(s) in '${domain}'${whose} on which \`${claim.rule_id}\` ${verb}: ${pu} upheld, ${po} overturned (${pct(po / pn)}; ${pct(confidence)} one-sided ${method} bounds [${pct(piv.lower)}, ${pct(piv.upper)}]). ${flagged ? `At or above the review-queue threshold (≥ ${minReviewed} reviewed, ≥ ${pct(threshold)} overturned).` : `Below the review-queue threshold (≥ ${minReviewed} reviewed, ≥ ${pct(threshold)} overturned).`} Attribution is a heuristic: a review is credited to every rule that ${verb} on the verdict, because the ledger does not record which rule a reviewer disagreed with.`,
    entries: prec.map(r => ({
      verdict_id: r.verdict.verdict_id,
      outcome: r.verdict.outcome,
      decision: r.review!.decision,
      reviewer_id: r.review!.reviewer_id,
      decided_at: r.review!.decided_at,
      ...(r.review!.note !== undefined ? { note: r.review!.note } : {}),
      ref: view.refOf(r.verdict.verdict_id),
      dispute: disputeCommand(r.verdict.verdict_id, r.verdict.claims.find(c => c.rule_id === claim.rule_id && c.outcome === claim.outcome)?.claim_id),
    })),
  }

  // ── the ruling ───────────────────────────────────────────────────────────────────────────────────────────────────
  const scope = `Claim \`${claim.claim_id}\` of verdict \`${v.verdict_id}\` only (${v.ruleset.id}@${v.ruleset.version}, engine ${v.engine_version}). FACT (the recomputation) is never re-ruled: it replays. A signed ruling on LAW here becomes precedent for \`${claim.rule_id}\` in '${domain}'${view.scope ? ` for tenant \`${view.scope.tenant_id}\`` : ''}.`
  let ruling: Ruling
  if (reasoned) {
    ruling = { disposition: 'REFER', favors: null, status: 'PROPOSED', scope, takes_effect: 'nothing changes: an advisory never holds the action', statement: 'Referred: this is a judgement-tier finding, advice and never a VERDICT. It did not hold the action. Whether to act on it or dismiss it is a person\'s decision.' }
  } else if (claim.outcome === 'INSUFFICIENT_DATA') {
    ruling = { disposition: 'UPHOLD', favors: 'A', status: 'PROPOSED', scope, takes_effect: 'nothing changes', statement: `Upheld: the abstention stands. A ruling cannot manufacture data; supply ${claim.insufficiency?.missing?.join(', ') || 'what is missing'} and re-run (a new verdict, a new id).` }
  } else if (flagged) {
    ruling = { disposition: 'REFER', favors: null, status: 'PROPOSED', scope, takes_effect: 'nothing changes until a person rules on the LAW question', statement: `Referred: the FACT stands (the recomputation replays on exact-path operands), but \`${claim.rule_id}\` is on the review queue: people overturned ${po} of ${pn} reviewed ${claim.outcome} verdict(s) it drove. Whether it is the right rule for this document is LAW, and it goes to a person.` }
  } else {
    ruling = { disposition: 'UPHOLD', favors: 'A', status: 'PROPOSED', scope, takes_effect: 'nothing changes unless a person overrules', statement: `Upheld: the ${claim.outcome} stands. It is deterministic, replays, and rests on exact-path operands; the rule's precedent (${pu} upheld, ${po} overturned of ${pn}) gives no ground to refer it.` }
  }
  if (rec.review) ruling.note = `A person has already ruled on this verdict (${rec.review.decision}, ${rec.review.reviewer_id}, ${rec.review.decided_at}). An opinion never overrules a person; their ruling stands over this proposal.`

  // ── the steelmanned dissent ──────────────────────────────────────────────────────────────────────────────────────
  const dissent: DissentPoint[] = []
  const arguesFor = ruling.disposition === 'REFER' ? 'upholding' : 'overturning'
  dissent.push({ topic: 'sample_size', premise: pPrec, argument: pn === 0 ? `There is no precedent at all for \`${claim.rule_id}\`: nothing on the record says how often people agree with it.` : `The precedent is ${pn} review(s)${pn < minReviewed ? `, under the ${minReviewed} the review queue asks for: too thin to clear the rule or to flag it` : ''}, and each is credited heuristically (a review of a verdict counts for every rule that ${verb} on it), so fewer than ${pn} of them may be rulings about \`${claim.rule_id}\` itself.` })
  dissent.push({ topic: 'confidence_interval', premise: pPrec, argument: pn === 0 ? 'With no reviews, the overturn rate could be anything from 0% to 100%.' : `The ${pct(confidence)} one-sided ${method} bounds on how often people overturn \`${claim.rule_id}\` are [${pct(piv.lower)}, ${pct(piv.upper)}]${arguesFor === 'overturning' ? `: the rule may be wrong as often as ${pct(piv.upper)} of the time` : `: it may be wrong as rarely as ${pct(piv.lower)} of the time`}.` })
  dissent.push({ topic: 'counter_cases', premise: pPrec, argument: arguesFor === 'overturning'
    ? (po ? `${po} time(s) a person overturned this rule's ${claim.outcome} (${overturnedIds.slice(0, 8).map(x => `\`${short(x)}\``).join(', ')}${overturnedIds.length > 8 ? ', …' : ''}).` : 'No person has overturned this rule yet, so there is no counter-case to point to; the dissent rests on the reading itself.')
    : `${pu} time(s) people upheld this rule's ${claim.outcome}; the overturns may share a cause (a document type the rule does not describe) that this document does not have.` })
  dissent.push({ topic: 'consequence_tier', argument: input.consequence
    ? `The workflow is declared tier '${input.consequence.tier}'${input.consequence.description ? ` (${input.consequence.description})` : ''}; ${claim.outcome === 'FAIL' ? 'a wrong FAIL holds legitimate work at that stake' : claim.outcome === 'PASS' ? 'a wrong PASS lets an error through at that stake' : 'an abstention costs a person\'s time at that stake'}.`
    : `No consequence tier is declared for this dispute; the stake visible on the verdict is ${claim.variance !== undefined ? `a variance of ${claim.variance}` : 'not stated'}.` })
  if (claim.outcome === 'FAIL') {
    if (claim.variance !== undefined && tol?.abs !== undefined) dissent.push({ topic: 'tolerance', premise: pClaim, argument: `The miss is ${Math.abs(claim.variance)} against a tolerance of ${tol.abs}${Math.abs(claim.variance) <= tol.abs * 10 ? ': close enough that a rounding convention the rule does not know could explain it' : ''}.` })
    const normed = claim.evidence.filter(e => realNorms(e).length)
    if (normed.length) dissent.push({ topic: 'normalization', premise: pClaim, argument: `${normed.length} operand(s) were normalized before comparison (${[...new Set(normed.flatMap(realNorms))].join(', ')}). A normalization is a reading, and a misreading would flip this claim.` })
    dissent.push({ topic: 'law', argument: `The recomputation is FACT, but whether \`${claim.rule_id}\` should bind this document is LAW. A document the ruleset does not describe (a credit note, a partial shipment, a negotiated exception) can fail a rule it was never meant to meet.` })
  } else if (claim.outcome === 'PASS') {
    if (cov.claims_insufficient > 0) dissent.push({ topic: 'coverage', premise: pAgg, argument: `${cov.claims_insufficient} claim(s) on this verdict could not run. A PASS covers only what ran.` })
    if (claim.variance !== undefined && claim.variance !== 0) dissent.push({ topic: 'tolerance', premise: pClaim, argument: `A variance of ${claim.variance} was absorbed by the tolerance${tolText}; a tolerance too wide for this workflow hides real errors.` })
    dissent.push({ topic: 'law', argument: `The ruleset checks only its own rules. An error it has no rule for passes \`${claim.rule_id}\` untouched.` })
  } else {
    dissent.push({ topic: 'law', argument: 'The field may be present under a name the ruleset does not know. An abstention caused by naming is a vocabulary gap, not a real absence.' })
  }

  // ── what would overturn it ───────────────────────────────────────────────────────────────────────────────────────
  const overturn: OverturnCondition[] = []
  if (claim.outcome === 'INSUFFICIENT_DATA') {
    overturn.push({ premise: pClaim, evidence: `supplying ${claim.insufficiency?.missing?.join(', ') || 'the missing input'} (or naming it as the ruleset expects)`, effect: 'the rule runs; a re-run is a new verdict with a new id, and this abstention stays on the record as what was known then' })
  } else {
    const field = claim.evidence.find(e => e.locator.kind === 'field' && e.locator.source !== 'computed') ?? claim.evidence.find(e => e.locator.kind === 'field')
    if (field && field.locator.kind === 'field') overturn.push({ premise: pClaim, evidence: `the source document showing a cited cell was bound wrongly (e.g. \`${field.locator.source}:${field.locator.path}\` is not ${fmt(field.value)})`, effect: `the operand is corrected and the claim is re-run (a new verdict); if it then ${claim.outcome === 'FAIL' ? 'holds, this FAIL was a misread' : 'fails, this PASS was a miss'}` })
    if (claim.outcome === 'FAIL' && typeof claim.asserted === 'number' && typeof claim.computation?.result === 'number') {
      overturn.push({ premise: pClaim, evidence: `a reading of the cited cells under which the expected value lands within${tol?.abs !== undefined ? ` ±${tol.abs}` : ' tolerance'} of the asserted ${claim.asserted} (the check expected ${claim.computation.result})`, effect: 'the claim holds; the FAIL was a misread' })
    }
    if (claim.outcome === 'PASS' && tol) overturn.push({ premise: pClaim, evidence: `a signed ruling that the tolerance${tolText} is too wide for this workflow`, effect: 'the rule is re-issued with a tighter tolerance (a new ruleset version) and verdicts re-run' })
    overturn.push({ evidence: `a person's signed ruling that \`${claim.rule_id}\` does not apply to this document`, effect: `the ${claim.outcome} is set aside for this document, and the ruling becomes precedent for \`${claim.rule_id}\` in '${domain}'` })
    if (ruling.disposition === 'REFER') {
      overturn.push({ premise: pPrec, evidence: `${upheldToUnflag(pn, po, threshold)} more upheld review(s) of \`${claim.rule_id}\``, effect: 'the rule leaves the review queue; a new opinion would propose UPHOLD' })
    } else {
      overturn.push({ premise: pPrec, evidence: `${overturnsToFlag(pn, po, minReviewed, threshold)} more overturned review(s) of \`${claim.rule_id}\`'s ${claim.outcome}s`, effect: 'the rule reaches the review queue; a new opinion would REFER instead of UPHOLD' })
    }
  }
  overturn.push({ premise: 'P1', evidence: 'the ledger failing its integrity check (verifyContent)', effect: 'every premise read from it is void; the opinion is withheld' })

  const title = `Dispute: \`${claim.claim_id}\` on verdict \`${short(v.verdict_id, 16)}\``
  const question = `Verdict \`${v.verdict_id}\` (${v.ruleset.id}@${v.ruleset.version}) records claim \`${claim.claim_id}\` (${claim.rule_name}) as ${claim.outcome}. It is disputed. Should the ${claim.outcome === 'INSUFFICIENT_DATA' ? 'abstention' : claim.outcome} stand?`
  return finalizeOpinion({
    subject: {
      kind: 'DISPUTE', verdict_id: v.verdict_id, claim_id: claim.claim_id, rule_id: claim.rule_id, outcome: claim.outcome, tier: reasoned ? 'REASONED' : 'DETERMINISTIC',
      ruleset: { id: v.ruleset.id, version: v.ruleset.version, domain },
      precedent_rule: { min_reviewed: minReviewed, flag_threshold: threshold, confidence, method },
      ...(input.consequence ? { consequence: { tier: input.consequence.tier, ...(input.consequence.description !== undefined ? { description: input.consequence.description } : {}) } } : {}),
      ...(input.inputs !== undefined ? { input_bound: true as const } : {}),
      ...(view.scope ? { tenant_id: view.scope.tenant_id } : {}),
    },
    title, question, readings, authorities, precedent, ruling, dissent, overturn, premises,
  }, sourceHashOf(view))
}
