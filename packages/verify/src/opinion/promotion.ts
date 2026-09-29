/**
 * The voice opinion: Riposte asking for a raise, or saying (urgently) that the record no longer supports what a person
 * granted. The courtroom format, with every premise checked by its own code.
 *
 * Given the book of record (a chain snapshot), a declared promotion policy, and either a proposal (promotion or demotion)
 * or the workflow's declaration, it recomputes everything from the ledger (the calibration, the bounds, the ladder) and
 * argues whichever question the evidence poses: PROMOTE (should it climb one rung?), RETAIN (does the record still support
 * autonomy?), or DEMOTE (should it step down one rung? urgent). Either way it only PROPOSES: the rung changes only by a
 * person's decision (design ruling, 2026-09-28). A supplied proposal must be exactly what the evidence produces, or
 * the opinion is withheld. Pure and deterministic; no clock, no model, no network.
 *
 * THE BOOK OF RECORD (2026-09-28): a person's decisions are signed events on the chain (ledger/decisions.ts). Whenever the
 * verified book holds a GRANT or DECLINE for the workflow (or the caller asks by workflow_id alone), the opinion reads the
 * rung from the book: it cites the GRANT in force as the decision its ruling would amend (P8), and a declaration or proposal
 * that disagrees with the book is WITHHELD (a flag never overrides a signed grant). A person's standing DECLINE of the
 * proposal the evidence raises is quoted (P9) and the ruling is DECLINED: shown as declined, never as a fresh ask, until the
 * evidence it saw changes. With no decision for the workflow on the book, the rung is the caller's declaration, and P8 says
 * so. With a tenant scope, everything the opinion reads is that tenant's (see snapshot.ts).
 *
 * D-ANCHOR (2026-09-28): only an ANCHORED signer's decision is read as the book's. An unanchored GRANT or DECLINE is on the
 * book and has no effect: the rung falls back to the last anchored grant (else the caller's declaration, else record), and
 * P8 names each such decision with its notice. Anchors: `trusted_keys` / `root_keys`, or a snapshotOfLedger snapshot (it
 * carries its ledger's own). An UNEVIDENCED demotion (granted above the record, nothing gone wrong) is argued as a standing
 * notice, never as urgent.
 */

import { hashOf } from '../verdict/canonical.js'
import { rateInterval } from '../verdict/bounds.js'
import type { Verdict } from '../verdict/schema.js'
import {
  assessVoice, workflowCalibration, lintPolicy, policyRef, levelRank, VOICE_LADDER, pct,
  consecutiveErrorsToBreach, errorsInHorizonToBreach, cleanReviewsToClear,
  type PromotionPolicy, type VoiceProposal, type WorkflowDeclaration, type WorkflowCalibrationOptions,
  type RungAssessment, type VoiceLevel, type Rung, type TierRequirements, type WorkflowCalibration, type VoiceAssessment,
  type PolicyRef,
} from '../verdict/voice.js'
import { grantInForce, isAnchored, noEffect, type DecisionEntry, type GrantDecision, type TrustedKeys } from '../ledger/decisions.js'
import type { RootKeys } from '../ledger/registry.js'
import type { LedgerRecord } from '../ledger/types.js'
import { recordFacts } from '../ledger/disk.js'
import { disputeCommand } from '../verdict/notices.js'
import { openSnapshot, type LedgerSnapshot, type SnapshotView } from './snapshot.js'
import { chainPremise, decisionRef, evidenceSet, finalizeOpinion, replayPremise, short, sourceHashOf } from './common.js'
import type {
  Authority, CitedCell, DeclinedBy, DissentPoint, Opinion, OpinionScope, OverturnCondition, Precedent, PrecedentEntry, Premise,
  Reading, Ruling,
} from './types.js'

export interface PromotionOpinionInput {
  /** The book of record. Supply the chain (snapshotOfLedger / snapshotFromChainJSONL) or every premise on it is unverified. */
  snapshot: LedgerSnapshot
  policy: PromotionPolicy
  /** The proposal to argue (a promotion, or an urgent demotion). Its workflow, tier, bounds and `from` define the question. */
  proposal?: VoiceProposal
  /** Or the workflow's declaration: argue whatever the evidence poses (promote / not yet / retain / demote). */
  declaration?: WorkflowDeclaration
  /** Or read the rung from the book of record: the workflow alone (its GRANT in force sets rung, tier, bounds and policy). */
  workflow_id?: string
  /** With `workflow_id`, while nothing is granted on the book: the tier the evidence is measured against. */
  consequence_tier?: string
  /** How records map to workflows, and the evidence window (must match how the proposal was computed). */
  calibration?: WorkflowCalibrationOptions
  /** Read one tenant's records and decisions only (a shared book). */
  scope?: OpinionScope
  /** Anchor decision signers to people on read. */
  trusted_keys?: TrustedKeys
  /** The registry's root key(s): the key registry on the book anchors every signer once it is in force. */
  root_keys?: RootKeys
}

/** Where the rung came from, and the premise (P8) that says so. */
interface RungRead {
  decl: WorkflowDeclaration
  a: VoiceAssessment
  source: 'BOOK' | 'DECLARED'
  grant?: DecisionEntry<GrantDecision>
  premise: Omit<Premise, 'id'>
}

const RUNG_CHECK = 'readDecisionBook + grantInForce (ledger/decisions): the latest anchored, fully signed GRANT for the workflow on the verified book, its Ed25519 signature(s) re-verified'

/**
 * Read the rung. From the book when the verified book holds a GRANT or DECLINE for the workflow, or when the caller named
 * only the workflow; otherwise from the caller's declaration (the flag path, unchanged). A declaration or proposal that
 * disagrees with the book fails P8 (WITHHELD), and nothing here throws on a disagreement: the opinion states it.
 */
function readRung(
  view: SnapshotView, input: PromotionOpinionInput, wf: string, asked: WorkflowDeclaration | undefined,
  cal: WorkflowCalibration, policy: PromotionPolicy, pref: PolicyRef,
): RungRead {
  const { events, payloads } = input.snapshot
  const onBook = view.content_verified && view.source === 'chain' && !!events && !!payloads
  const onBookForWf = onBook ? view.decisions.filter(e => e.signed.decision.kind !== 'POLICY_REVISION' && e.signed.decision.workflow_id === wf) : []
  // D-ANCHOR: only an anchored decision is the book's. An unanchored one is named here, with its notice, and has no effect.
  // D-DUAL: so is a GRANT still pending signatures (read under this policy's tier when the grant was made under it).
  const reading = { policies: [policy], governing_policy: policy } // D-GOVERNING-POLICY
  const forWf = onBookForWf.filter(isAnchored)
  const inert = onBook ? noEffect({ decisions: view.decisions, canaries: [] }, { workflow_id: wf, ...reading }) : []
  const inertText = inert.length ? ` ${inert.map(n => n.notice).join('; ')}.` : ''
  const anchoredWord = inert.some(n => n.pending) ? 'in-force ' : inert.length ? 'anchored ' : ''
  const headRef = view.chain ? [{ kind: 'ledger_head' as const, head: view.chain.head, length: view.chain.length }] : []

  if (!onBook || (forWf.length === 0 && asked)) {
    let decl: WorkflowDeclaration
    if (asked) decl = asked
    else {
      if (input.consequence_tier === undefined) {
        throw new Error(`the rung of ${wf} is to be read from the book of record, but ${view.source === 'chain' ? 'the book does not verify' : 'no chain was supplied'} and no consequence_tier was declared: nothing can be assessed`)
      }
      decl = { workflow_id: wf, consequence_tier: input.consequence_tier, granted: 'record' }
    }
    const a = assessVoice(cal, decl, policy)
    const supplied = decl.grant ? ` A grant record (${decl.grant.signer_id}, ${decl.grant.signed_at}) was supplied with it, not read from a signed decision on the book.` : ''
    return {
      decl, a, source: 'DECLARED',
      premise: !asked
        ? {
          statement: `The rung of \`${wf}\` could not be read from the book of record: ${view.source === 'chain' ? 'the book does not verify' : 'no chain was supplied'}.`,
          check: RUNG_CHECK, refs: headRef, verified: false, detail: 'no verified book to read the rung from',
        }
        : {
          statement: `No ${anchoredWord}signed GRANT or DECLINE for \`${wf}\` is on the book of record: the rung \`${decl.granted}\` is the caller's declaration, not read from a person's signed decision.${decl.granted !== 'record' ? ` Signed onto the book as a GRANT, it becomes the book's.` : ''}${supplied}${inertText}`,
          check: RUNG_CHECK, refs: headRef, verified: view.content_verified,
          detail: view.content_verified ? 'declared, not signed: the absence of a GRANT read from the verified book' : 'the book did not verify: the rung\'s source cannot be read',
        },
    }
  }

  const g = grantInForce(view.decisions, wf, reading)
  const gd = g?.signed.decision
  const tier = gd ? gd.consequence_tier : (asked?.consequence_tier ?? input.consequence_tier)
  if (tier === undefined) {
    throw new Error(`no ${anchoredWord}GRANT for workflow ${wf} is on the book, and no consequence_tier was declared: nothing is granted (the rung is record), but the burden of proof needs a declared tier to measure against.${inertText}`)
  }
  const mismatches: string[] = []
  let decl: WorkflowDeclaration
  let a: VoiceAssessment
  if (gd && gd.policy.hash !== pref.hash) {
    // Settings are fixed at grant: the grant cannot be assessed under another policy. Argue its rung under the supplied
    // policy for the record, and withhold.
    mismatches.push(`the grant was made under policy ${gd.policy.policy_id}@${gd.policy.version} (\`${short(gd.policy.hash)}\`), not ${pref.policy_id}@${pref.version} (\`${short(pref.hash)}\`): settings are fixed at grant time`)
    decl = { workflow_id: wf, consequence_tier: tier, granted: gd.level, ...(gd.bounds !== undefined ? { bounds: gd.bounds } : {}) }
    a = assessVoice(cal, decl, policy)
  } else {
    a = assessVoice(cal, {
      workflow_id: wf, book: { events: events!, payloads: payloads! },
      ...(gd ? {} : { consequence_tier: tier }),
      ...(input.trusted_keys ? { trusted_keys: input.trusted_keys } : {}),
      ...(input.root_keys?.length ? { root_keys: input.root_keys } : {}),
    }, policy)
    decl = {
      workflow_id: wf, consequence_tier: a.consequence_tier, granted: a.granted,
      ...(a.bounds !== undefined ? { bounds: a.bounds } : {}), ...(a.grant ? { grant: a.grant } : {}),
    }
  }
  if (asked) {
    const says = input.proposal ? 'the proposal runs from' : 'the declaration says'
    if (asked.granted !== decl.granted) mismatches.push(`${says} \`${asked.granted}\`, but the book says \`${decl.granted}\``)
    if (asked.consequence_tier !== decl.consequence_tier) mismatches.push(`${input.proposal ? 'the proposal is at' : 'the declaration says'} tier '${asked.consequence_tier}', but the book says '${decl.consequence_tier}'`)
    if ((asked.bounds ?? null) !== (decl.bounds ?? null)) mismatches.push(`bounds ${JSON.stringify(asked.bounds ?? null)}, but the book says ${JSON.stringify(decl.bounds ?? null)}`)
    if (asked.grant && (!gd || asked.grant.signer_id !== gd.signer_id || asked.grant.signed_at !== gd.signed_at || asked.grant.level !== gd.level)) {
      mismatches.push(`a grant record (${asked.grant.signer_id}, ${asked.grant.signed_at}) that the book does not hold`)
    }
  }
  const later = a.book?.superseded_by?.length
    ? ` A later version of this policy is on the book (${a.book.superseded_by.map(s => `${s.policy.policy_id}@${s.policy.version}`).join(', ')}); the grant stands under its own version until a person re-grants.`
    : ''
  // The GRANT read here is anchored and fully signed by construction (grantInForce honors nothing else).
  const cosigned = a.book?.grant?.cosigned_by?.length ? ` and co-signed by ${a.book.grant.cosigned_by.map(c => `${c.signer_id} (seq ${c.seq})`).join(', ')} (dual authorization)` : ''
  const read = g && gd
    ? `The rung is read from the book of record: GRANT \`${g.decision_id}\` (seq ${g.seq}) sets \`${wf}\` at \`${gd.level}\`${gd.bounds !== undefined ? ` within "${gd.bounds}"` : ''}, signed by ${gd.signer_id} at ${gd.signed_at}${cosigned}, under policy ${gd.policy.policy_id}@${gd.policy.version} at tier '${gd.consequence_tier}'. A ruling here would amend that grant, and only a person's new signed GRANT does.${later}${inertText}`
    : `No ${anchoredWord}GRANT for \`${wf}\` is on the book of record: nothing is granted, so the rung is \`record\` (the day-1 default), measured against tier '${tier}'.${inertText}`
  return {
    decl, a, source: 'BOOK', ...(g ? { grant: g } : {}),
    premise: {
      statement: mismatches.length ? `The book of record governs the rung, and this opinion was asked under other settings: ${mismatches.join('; ')}. A flag never overrides a person's signed grant. ${read}` : read,
      check: RUNG_CHECK,
      refs: g ? [decisionRef('GRANT', g)] : headRef,
      verified: mismatches.length === 0,
      detail: mismatches.length ? mismatches.join('; ') : g ? `GRANT \`${short(g.decision_id)}\` read from the verified book` : 'no GRANT on the verified book: the rung is record',
    },
  }
}

const METRIC_LABEL: Record<RungAssessment['metric'], string> = { false_flag_rate: 'false-flag rate', false_pass_rate: 'false-PASS rate' }
const NOUN: Record<RungAssessment['metric'], string> = { false_flag_rate: 'reviewed FAIL verdicts', false_pass_rate: 'reviewed PASS verdicts' }
const per = (x: number, base: number): string => `${Number((x * base).toPrecision(3))}`

function behaviour(level: VoiceLevel, bounds?: string): string {
  switch (level) {
    case 'record': return 'logs every verdict and surfaces each FAIL or ABSTAIN as a notice with its evidence and a dispute path; nothing is held'
    case 'advise': return 'surfaces each FAIL or ABSTAIN, and COUNSEL (strong advisories included), prominently in-flow to the person and the agent; nothing is held'
    case 'gate': return 'holds each FAIL or ABSTAIN action until a person resolves it; PASSes still get human review'
    case 'autonomy': return `lets PASSes proceed unreviewed${bounds ? ` within "${bounds}"` : ' within the declared bounds'}; each FAIL or ABSTAIN is still held until a person resolves it`
  }
}

const below = (r: VoiceLevel): VoiceLevel => VOICE_LADDER[Math.max(0, levelRank(r) - 1)] as VoiceLevel

function riskOf(r: RungAssessment, cal: WorkflowCalibration): string {
  const obs = r.point === null ? 'no observed rate yet' : `${r.errors}/${r.n}`
  if (r.metric === 'false_pass_rate') {
    const passShare = cal.records === 0 ? '0' : pct(cal.by_outcome.PASS / cal.records)
    return `At the observed rate (${obs}) about ${per(r.point ?? 0, 1000)} of every 1,000 PASSes would be wrong and unreviewed; the data cannot rule out ${per(r.upper, 1000)} (the upper bound). Review is removed from the PASS share of volume: ${cal.by_outcome.PASS} of ${cal.records} verdict(s) on record (${passShare}).`
  }
  return `At the observed false-flag rate (${obs}) about ${per(r.point ?? 0, 100)} of every 100 flags are false alarms${r.rung === 'gate' ? ' that hold legitimate work' : ''}; the data cannot rule out ${per(r.upper, 100)}.`
}

function tierAt(policy: PromotionPolicy, name: string): { tier: TierRequirements; index: number } {
  const index = policy.tiers.findIndex(t => t.tier === name)
  return { tier: policy.tiers[index] as TierRequirements, index }
}

export function promotionOpinion(input: PromotionOpinionInput): Opinion {
  const { policy, proposal } = input
  const lint = lintPolicy(policy)
  if (!lint.ok) throw new Error(`invalid promotion policy: ${lint.errors.join('; ')}`)
  const asked: WorkflowDeclaration | undefined = input.declaration
    ?? (proposal
      ? { workflow_id: proposal.workflow_id, consequence_tier: proposal.consequence_tier, granted: proposal.from, ...(proposal.bounds !== undefined ? { bounds: proposal.bounds } : {}) }
      : undefined)
  const wf = asked?.workflow_id ?? input.workflow_id
  if (!wf) throw new Error('promotionOpinion needs a proposal, a declaration, or a workflow_id (the rung read from the book of record)')
  if (asked && input.workflow_id !== undefined && input.workflow_id !== asked.workflow_id) {
    throw new Error(`workflow_id ${input.workflow_id} disagrees with the ${proposal && !input.declaration ? 'proposal' : 'declaration'} (${asked.workflow_id}): one question per opinion`)
  }

  const view = openSnapshot(input.snapshot, {
    ...(input.scope ? { scope: input.scope } : {}), ...(input.trusted_keys ? { trusted_keys: input.trusted_keys } : {}), ...(input.root_keys?.length ? { root_keys: input.root_keys } : {}),
  })
  if (!view.ownsWorkflow(wf)) {
    throw new Error(`workflow ${wf} is not tenant ${view.scope?.tenant_id}'s: an opinion scoped to a tenant reads only that tenant's workflows`)
  }
  const cal = workflowCalibration(view.records, wf, input.calibration ?? {})
  const pref = policyRef(policy)
  const rung = readRung(view, input, wf, asked, cal, policy, pref)
  const { decl, a } = rung
  const { tier, index: tierIndex } = tierAt(policy, decl.consequence_tier)
  // P-K (ledger-disk): index the records, not their verdicts. A disk-backed book reads each verdict on demand, and holding
  // every one is the whole book in the heap; only the replayed ids' verdicts are read. The later record still wins.
  // P-J: each record's verdict id from the index (a disk-backed book: no parse). `firstById` answers as `.find` did.
  const idOf = (r: LedgerRecord): string => (recordFacts(r) ?? r.verdict).verdict_id
  const recordById = new Map<string, LedgerRecord>(view.records.map(r => [idOf(r), r]))
  const firstById = new Map<string, LedgerRecord>()
  for (const r of view.records) { const id = idOf(r); if (!firstById.has(id)) firstById.set(id, r) }
  const verdictsOf = (ids: readonly string[]): Map<string, Verdict> =>
    new Map(ids.flatMap(id => { const r = recordById.get(id); return r ? [[id, r.verdict] as [string, Verdict]] : [] }))
  /** A person's signed decline that holds back the proposal the evidence raises (read from the book). */
  const standing = a.book?.declined
  const lapsed = a.book?.decline_lapsed
  /** D-UNEVIDENCED: granted above what the record supports, and nothing has gone wrong. A standing notice, never urgent. */
  const unevidenced = a.proposal?.kind === 'DEMOTION_PROPOSAL' && a.proposal.basis === 'unevidenced'
  /**
   * FS4: a failure-basis demotion proposal is argued as DEMOTE even while the pooled record still clears the rung (post-grant
   * surveillance: a miss since the grant fires it). A demotion a person declined is argued the same way. `surveilled` marks
   * the case where the pooled bars still clear, so the text rests on the failing cases, not on a bar.
   */
  const failureDemotion = (a.proposal?.kind === 'DEMOTION_PROPOSAL' && a.proposal.basis === 'failure') || standing?.proposal_kind === 'DEMOTION_PROPOSAL'
  const demotionReasons = a.proposal?.kind === 'DEMOTION_PROPOSAL' ? a.proposal.reasons : undefined

  // ── the question ─────────────────────────────────────────────────────────────────────────────────────────────────
  const question_kind: 'PROMOTE' | 'RETAIN' | 'DEMOTE' = levelRank(a.earned) < levelRank(decl.granted) || failureDemotion ? 'DEMOTE' : decl.granted === 'autonomy' ? 'RETAIN' : 'PROMOTE'
  const surveilled = question_kind === 'DEMOTE' && levelRank(a.earned) >= levelRank(decl.granted)
  const toLevel: VoiceLevel = question_kind === 'PROMOTE' ? VOICE_LADDER[levelRank(decl.granted) + 1] as VoiceLevel : question_kind === 'DEMOTE' ? below(decl.granted) : decl.granted
  const focus: Rung = (question_kind === 'PROMOTE' ? VOICE_LADDER[levelRank(decl.granted) + 1] : decl.granted) as Rung
  const deps = a.rungs.filter(r => levelRank(r.rung) <= levelRank(focus))
  const focusRung = deps[deps.length - 1] as RungAssessment
  const bind = deps.find(r => !r.cleared) ?? focusRung
  const inBounds = decl.bounds ? ` within "${decl.bounds}"` : ''
  const byWhom = standing ? `${standing.signer_id}, ${standing.signed_at}` : ''
  const title = standing
    ? (question_kind === 'DEMOTE'
      ? `Kept at ${decl.granted} by a person: \`${wf}\` (the step down to ${toLevel} was declined)`
      : `Not now, by a person: promote \`${wf}\` from ${decl.granted} to ${focus}`)
    : question_kind === 'PROMOTE' ? `Promote \`${wf}\` from ${decl.granted} to ${focus}?`
    : question_kind === 'RETAIN' ? `Retain autonomy for \`${wf}\`?`
    : unevidenced ? `Granted above the evidence: should \`${wf}\` step down from ${decl.granted} to ${toLevel}?`
    : `URGENT: step \`${wf}\` down from ${decl.granted} to ${toLevel}?`
  const question = question_kind === 'PROMOTE'
    ? `Should workflow \`${wf}\` (consequence tier '${tier.tier}') be promoted from \`${decl.granted}\` to \`${focus}\`${inBounds}?${standing ? ` A person has already declined this promotion (${byWhom}); does that decline still stand?` : ''}`
    : question_kind === 'RETAIN'
      ? `Does the record of workflow \`${wf}\` (tier '${tier.tier}') still support \`autonomy\`${inBounds}?`
      : standing
        ? `The record of workflow \`${wf}\` (tier '${tier.tier}') no longer supports \`${decl.granted}\`, which a person granted, and a person has already declined stepping it down to \`${toLevel}\` (${byWhom}). Does that decline still stand?`
        : unevidenced
          ? `A person granted workflow \`${wf}\` (tier '${tier.tier}') \`${decl.granted}\`, and the record does not yet support it; nothing has gone wrong (no failing case). Should it step down to \`${toLevel}\`, or should the record be left to catch up? Until a person decides, it stays at \`${decl.granted}\`.`
          : surveilled
            ? `A failing case has turned up since a person granted workflow \`${wf}\` (tier '${tier.tier}') \`${decl.granted}\`, though the pooled record still clears its bars. Should it step down to \`${toLevel}\`? Until a person decides, it stays at \`${decl.granted}\`.`
            : `The record of workflow \`${wf}\` (tier '${tier.tier}') no longer supports \`${decl.granted}\`, which a person granted. Should it step down to \`${toLevel}\`? Until a person decides, it stays at \`${decl.granted}\`.`

  // ── premises ─────────────────────────────────────────────────────────────────────────────────────────────────────
  const premises: Premise[] = []
  premises.push(chainPremise('P1', view))
  const evidenceIds = [...cal.evidence.reviewed_pass, ...cal.evidence.reviewed_fail]
  premises.push(replayPremise('P2', 'reviewed evidence', evidenceIds, verdictsOf(evidenceIds)))

  const calRefs = [
    { kind: 'calibration' as const, workflow_id: wf, hash: cal.calibration_hash },
    ...(cal.evidence.reviewed_pass.length ? [evidenceSet('reviewed PASS', cal.evidence.reviewed_pass)] : []),
    ...(cal.evidence.reviewed_fail.length ? [evidenceSet('reviewed FAIL', cal.evidence.reviewed_fail)] : []),
  ]
  const calMatches = !proposal || proposal.calibration_hash === cal.calibration_hash
  premises.push({
    id: 'P3',
    statement: `Recounted from the ledger, workflow \`${wf}\` holds ${cal.records} verdict(s) (${cal.by_outcome.PASS} PASS · ${cal.by_outcome.FAIL} FAIL · ${cal.by_outcome.INSUFFICIENT_DATA} can't-tell); reviewed: ${cal.reviewed.PASS} PASS (${cal.overturned.PASS} overturned), ${cal.reviewed.FAIL} FAIL (${cal.overturned.FAIL} overturned). Versions: ${cal.versions.join('; ') || 'none yet'}.${cal.excluded.length ? ` ${cal.excluded.length} record(s) excluded (${[...new Set(cal.excluded.map(e => e.why))].join('; ')}).` : ''}`,
    check: 'workflowCalibration (verdict/voice) over the records rebuilt from the chain',
    refs: calRefs,
    verified: calMatches,
    detail: calMatches ? `calibration \`${short(cal.calibration_hash)}\`${proposal ? ' matches the proposal' : ''}` : `the proposal cites calibration ${short(proposal!.calibration_hash)} but the ledger recounts to ${short(cal.calibration_hash)}`,
  })

  const counterIds = [...new Set(deps.flatMap(r => r.counter_cases))].sort()
  const counterBad = counterIds.filter(id => {
    const rec = firstById.get(id)
    return !(view.source === 'chain' && view.eventsFor(id).review && rec?.review?.decision === 'OVERTURNED')
  })
  premises.push({
    id: 'P4',
    statement: counterIds.length
      ? `Each of the ${counterIds.length} counter-case(s) is on the ledger with a person's OVERTURNED review event.`
      : `No counter-case is on record: no ${deps.map(r => r.metric === 'false_pass_rate' ? 'PASS' : 'FAIL').filter((x, i, s) => s.indexOf(x) === i).join(' or ')} verdict in the evidence was overturned. An absence is only as good as the ledger it is read from.`,
    check: 'the ledger\'s REVIEW events (openSnapshot.eventsFor)',
    refs: counterIds.length ? counterIds.map(id => view.refOf(id)) : (view.chain ? [{ kind: 'ledger_head' as const, head: view.chain.head, length: view.chain.length }] : []),
    verified: counterIds.length ? counterBad.length === 0 : view.content_verified,
    detail: counterIds.length
      ? (counterBad.length === 0 ? `${counterIds.length} review event(s) found` : `${counterBad.length} counter-case(s) lack a verifiable OVERTURNED review event: ${counterBad.map(x => short(x)).join(', ')}`)
      : (view.content_verified ? 'absence read from a content-verified chain' : 'absence read from an unverified record set'),
  })

  const policyMatches = !proposal || proposal.policy.hash === pref.hash
  premises.push({
    id: 'P5',
    statement: `The policy is \`${pref.policy_id}@${pref.version}\` (method ${policy.method}); it lints clean, including the rule that the burden of proof never decreases as consequence rises. The workflow is declared tier '${tier.tier}'.`,
    check: 'lintPolicy + hashOf (verdict/voice)',
    refs: [{ kind: 'policy', ...pref }],
    verified: policyMatches,
    detail: policyMatches ? `policy \`${short(pref.hash)}\`${proposal ? ' matches the proposal' : ''}` : `the proposal cites policy ${short(proposal!.policy.hash)} but the declared policy hashes to ${short(pref.hash)}`,
  })

  const boundLines: string[] = []
  let boundsOk = true
  for (const r of deps) {
    // FO2: the bound is recomputed at the sidedness the assessment states, and printed from that field.
    const again = rateInterval(r.errors, r.n, r.confidence, r.method, r.sidedness)
    if (again.upper !== r.upper || again.lower !== r.lower) boundsOk = false
    boundLines.push(`${r.rung}: ${r.errors}/${r.n} → ${pct(r.confidence)} ${r.sidedness} ${r.method} bounds [${pct(r.lower)}, ${pct(r.upper)}], upper against bar ${pct(r.bar.max_error)} with n ≥ ${r.bar.min_n}: ${r.cleared ? 'clears' : 'does not clear'}`)
  }
  if (proposal) {
    const top = Math.max(levelRank(proposal.from), levelRank(proposal.to)) // a proposal carries every rung up to the higher of from/to
    const mine = a.rungs.filter(r => levelRank(r.rung) <= top)
    if (hashOf(mine) !== hashOf(proposal.rungs)) boundsOk = false
  }
  premises.push({
    id: 'P6',
    statement: `The bounds recompute. ${boundLines.join('; ')}.`,
    check: 'rateInterval (verdict/bounds), recomputed independently of the assessment',
    refs: [{ kind: 'calibration', workflow_id: wf, hash: cal.calibration_hash }, { kind: 'policy', ...pref }],
    verified: boundsOk,
    detail: boundsOk ? `${deps.length} rung(s) recomputed` : 'a recomputed bound differs from the one presented (the proposal was altered, or computed on other evidence)',
  })

  // A proposal must match its OWN id (not edited after it was minted) AND be exactly what this evidence produces (the one a
  // person's standing decline holds back counts: it is what the evidence raises, answered already).
  const proposalIntact = !proposal || (() => { const { proposal_id, ...body } = proposal; return hashOf(body).slice(0, 32) === proposal_id })()
  const raised = a.proposal?.proposal_id ?? standing?.suppressed_proposal_id
  const proposalMatches = proposalIntact && (!proposal || raised === proposal.proposal_id)
  const producedText = a.proposal
    ? ` The evidence produces ${a.proposal.kind === 'DEMOTION_PROPOSAL' ? (unevidenced ? 'a standing (unevidenced, not urgent) demotion' : 'an URGENT demotion') : 'a promotion'} proposal \`${a.proposal.proposal_id}\` (${a.proposal.from} → ${a.proposal.to}).`
    : standing
      ? ` The evidence raises ${standing.proposal_kind === 'DEMOTION_PROPOSAL' ? 'a demotion' : 'a promotion'} proposal \`${standing.suppressed_proposal_id}\`, which a person's standing decline holds back (P9).`
      : ' The evidence produces no proposal.'
  // D-NO-FLIPFLOP: after a person's step down on a failure, a return is argued from the window since the step down, alone.
  const fw = a.fresh_window
  const windowText = fw
    ? ` A person stepped \`${wf}\` down from \`${fw.from}\` after a failing case (GRANT \`${short(fw.since.decision_id)}\`, seq ${fw.since.seq}), so a return is argued from the ${fw.records} verdict(s) recorded since, alone${fw.rung ? `: ${fw.rung.rung} on that window: ${fw.rung.reason}` : ''}. The pooled record is shown; it cannot carry the return by itself.`
    : ''
  premises.push({
    id: 'P7',
    statement: `The effective rung is \`${a.level}\`, a person's decision, which the assessment never changes; on this evidence the ladder supports \`${a.earned}\`.${a.blockers.length ? ` Blocked: ${a.blockers.join('; ')}.` : ''}${producedText}${windowText}`,
    check: 'assessVoice (verdict/voice): cumulative support, one rung at a time either way, the rung itself never changed',
    refs: [{ kind: 'calibration', workflow_id: wf, hash: cal.calibration_hash }, { kind: 'policy', ...pref }],
    verified: proposalMatches,
    detail: proposalMatches ? (proposal ? `proposal \`${short(proposal.proposal_id)}\` re-derived exactly` : 'assessment recomputed')
      : !proposalIntact ? `the proposal \`${short(proposal!.proposal_id)}\` does not match its own id (edited after it was minted)`
      : `the proposal \`${short(proposal!.proposal_id)}\` is not what this evidence produces (${raised ? `it produces \`${short(raised)}\`` : 'it produces no proposal'})`,
  })

  // P8: where the rung came from (a person's signed GRANT on the book, or the caller's declaration).
  premises.push({ id: 'P8', ...rung.premise })

  // P9: a person's DECLINE of the proposal the evidence raises, standing or lapsed (read from the book).
  const declineCite = standing ?? lapsed
  if (declineCite) {
    const what = declineCite.proposal_kind === 'DEMOTION_PROPOSAL' ? 'demotion' : 'promotion'
    premises.push({
      id: 'P9',
      statement: standing
        ? `A person has already answered this proposal: DECLINE \`${standing.decision_id}\` (seq ${standing.seq}) by ${standing.signer_id} at ${standing.signed_at}: "${standing.reason}". It stands until ${standing.re_raise_when} (so far: ${standing.why}), so the ${what} is shown as declined, not asked again.`
        : `A person declined an earlier ${what} (DECLINE \`${declineCite.decision_id}\`, seq ${declineCite.seq}, by ${declineCite.signer_id} at ${declineCite.signed_at}: "${declineCite.reason}"). It no longer stands: ${declineCite.why}. The proposal is raised again.`,
      check: 'declinesFor (ledger/decisions) + declineStanding (verdict/voice): a signed decline binds to the grant in force and stands until the evidence it saw changes',
      refs: [decisionRef('DECLINE', declineCite)],
      verified: true,
      detail: standing ? `decline \`${short(standing.decision_id)}\` stands` : `decline \`${short(declineCite.decision_id)}\` lapsed on new evidence`,
    })
  }

  // ── readings, with cited cells, and their footing consequences ───────────────────────────────────────────────────
  const cells = (r: RungAssessment): CitedCell[] => [
    { cell: `${r.rung}: ${NOUN[r.metric]} (n)`, value: r.n, premise: 'P3' },
    { cell: `${r.rung}: overturned (counter-cases)`, value: r.errors, premise: 'P4' },
    { cell: `${r.rung}: observed ${METRIC_LABEL[r.metric]}`, value: r.point, premise: 'P3' },
    { cell: `${r.rung}: ${pct(r.confidence)} ${r.method} upper bound`, value: r.upper, premise: 'P6' },
    { cell: `${r.rung}: bar (max upper bound)`, value: r.bar.max_error, premise: 'P5' },
    { cell: `${r.rung}: minimum n`, value: r.bar.min_n, premise: 'P5' },
  ]
  const allCells = deps.flatMap(cells)
  const upLevel: VoiceLevel = question_kind === 'DEMOTE' ? decl.granted : focus
  const downLevel: VoiceLevel = question_kind === 'PROMOTE' ? decl.granted : below(decl.granted)
  const readings: Reading[] = [
    {
      id: 'A',
      label: question_kind === 'PROMOTE' ? `Promote to ${focus}` : `Keep ${upLevel}`,
      statement: question_kind === 'DEMOTE'
        ? `A person keeps \`${upLevel}\`: they may dispute the failing cases (each is listed under Precedent with its dispute path), or accept the exposure knowingly. ${surveilled ? `The pooled record still clears its bars, but a failing case since the grant counts against it${demotionReasons ? ` (${demotionReasons.join('; ')})` : ''}.` : `As it stands the record does not support it (${bind.rung}: ${bind.reason}).`}`
        : `The record shows the ${deps.map(r => METRIC_LABEL[r.metric]).filter((x, i, s) => s.indexOf(x) === i).join(' and ')} low enough, on enough reviews, for the workflow to hold \`${upLevel}\`: it ${behaviour(upLevel, decl.bounds)}.`,
      cells: allCells,
      consequence: `The workflow ${behaviour(upLevel, decl.bounds)}. ${riskOf(focusRung, cal)}`,
    },
    {
      id: 'B',
      label: question_kind === 'PROMOTE' ? `Stay at ${decl.granted}` : `Step down to ${downLevel}`,
      statement: surveilled
        ? `The pooled record clears every declared bar, but a failing case since the grant counts against \`${upLevel}\`${demotionReasons ? ` (${demotionReasons.join('; ')})` : ''}; the workflow should hold \`${downLevel}\` until a person has weighed it.`
        : bind.cleared
        ? `Though the record clears every declared bar, it is not enough to justify \`${upLevel}\`: a person may want more evidence than the policy asks for at this tier. The workflow should hold \`${downLevel}\`.`
        : `The record does not justify \`${upLevel}\` (${bind.rung}: ${bind.reason}); the workflow should hold \`${downLevel}\`.`,
      cells: [...allCells, { cell: 'binding constraint', value: bind.cleared ? 'none: every bar clears' : `${bind.rung}: ${bind.reason}`, premise: 'P6' }],
      consequence: question_kind === 'PROMOTE'
        ? `The workflow keeps its current behaviour: it ${behaviour(downLevel, decl.bounds)}. No new exposure; no review work is removed.`
        : `The workflow ${behaviour(downLevel, decl.bounds)}. The exposure measured above ends; the review work it had removed returns.`,
    },
  ]

  // ── authorities ──────────────────────────────────────────────────────────────────────────────────────────────────
  const authorities: Authority[] = [
    { source: 'promotion policy', cite: `${pref.policy_id}@${pref.version} · tier ${tier.tier}`, quote: `tier '${tier.tier}': ${tier.description}` },
    ...deps.map(r => ({
      source: 'promotion policy',
      cite: `${pref.policy_id}@${pref.version} · tier ${tier.tier} · ${r.rung}`,
      quote: `${r.rung}: n ≥ ${r.bar.min_n} ${NOUN[r.metric]}, and the ${pct(r.confidence)} ${r.sidedness} ${r.method} upper bound on the ${METRIC_LABEL[r.metric]} ≤ ${pct(r.bar.max_error)}.`,
    })),
    { source: 'Riposte earned-voice doctrine', cite: 'VERDICT-SCHEMA v0.1 §earned voice', quote: 'Riposte proposes; a person decides. The rung changes only by a person\'s decision, one rung at a time, in either direction.' },
    { source: 'Riposte earned-voice doctrine', cite: 'VERDICT-SCHEMA v0.1 §earned voice (stable settings)', quote: 'The settings a workflow was granted under are fixed. The policy is versioned, nothing tunes it, and a change is a person\'s recorded revision.' },
    { source: 'Riposte earned-voice doctrine', cite: 'VERDICT-SCHEMA v0.1 §per-action handling', quote: 'Every FAIL is shown to the person with its evidence and a dispute path, at every rung. Whether it also holds the action is the rung\'s: surfaced at record and advise, held at gate and autonomy.' },
    { source: 'Riposte earned-voice doctrine', cite: 'VERDICT-SCHEMA v0.1 §earned voice (the declared_accuracy precedent)', quote: 'A ruleset or engine version change changes behaviour; the old record no longer describes it. Each version earns its own record.' },
  ]

  // ── precedent: the people's rulings in this workflow ─────────────────────────────────────────────────────────────
  const entries: PrecedentEntry[] = counterIds.map(id => {
    const rec = firstById.get(id)!
    return {
      verdict_id: id,
      outcome: (recordFacts(rec) ?? rec.verdict).outcome,
      decision: rec.review?.decision ?? 'OVERTURNED',
      ...(rec.review ? { reviewer_id: rec.review.reviewer_id, decided_at: rec.review.decided_at } : {}),
      ...(rec.review?.note !== undefined ? { note: rec.review.note } : {}),
      ref: view.refOf(id),
      dispute: disputeCommand(id),
    }
  })
  const overturnedRules = cal.rules.filter(r => r.overturned > 0).map(r => `\`${r.rule_id}\` ${r.overturned}/${r.reviewed}`)
  const precedent: Precedent = {
    summary: `${cal.reviewed.PASS + cal.reviewed.FAIL + cal.reviewed.INSUFFICIENT_DATA} human review(s) on record in this workflow: ${cal.reviewed.PASS} of PASS verdicts (${cal.overturned.PASS} overturned), ${cal.reviewed.FAIL} of FAIL verdicts (${cal.overturned.FAIL} overturned). ${counterIds.length ? `The adverse precedent (every overturned verdict the ${focus} question turns on) is listed, each with its own dispute path.` : 'No adverse precedent: no overturned verdict bears on this question.'}${overturnedRules.length ? ` Rules reviewers overturned: ${overturnedRules.join(', ')}.` : ''}`,
    entries,
  }

  // ── the ruling ───────────────────────────────────────────────────────────────────────────────────────────────────
  const scope = `Workflow \`${wf}\` only (${cal.versions.join('; ') || 'no verdicts yet'}), consequence tier '${tier.tier}', policy ${pref.policy_id}@${pref.version}${decl.bounds ? `, within "${decl.bounds}"` : ''}. It does not extend to other workflows, versions, tiers or bounds.`
  const g = rung.grant
  const cite = (e: { decision_id: string; seq: number; entry_hash: string }) => ({ decision_id: e.decision_id, seq: e.seq, entry_hash: e.entry_hash })
  const supersedes = g ? ` and superseding GRANT \`${short(g.decision_id)}\` (seq ${g.seq})` : ''
  let ruling: Ruling
  if (standing) {
    const declined: DeclinedBy = {
      ...cite(standing), signer_id: standing.signer_id, signed_at: standing.signed_at, reason: standing.reason,
      proposal_kind: standing.proposal_kind, why: standing.why, re_raise_when: standing.re_raise_when,
    }
    ruling = {
      disposition: 'DECLINED', favors: question_kind === 'DEMOTE' ? 'A' : 'B', status: 'PROPOSED', scope, declined,
      statement: question_kind === 'DEMOTE'
        ? `Kept on the record: ${standing.signer_id} kept \`${wf}\` at \`${decl.granted}\` at ${standing.signed_at} ("${standing.reason}"), declining the step down to \`${toLevel}\`. The decline stands until ${standing.re_raise_when} (so far: ${standing.why}). ${surveilled ? `The pooled record still clears its bars; the failing case(s) that person weighed stand against \`${decl.granted}\`` : `The record still does not support \`${decl.granted}\` (${bind.rung}: ${bind.reason})`}; keeping it is that person's decision.`
        : `Not now, on the record: ${standing.signer_id} declined promoting \`${wf}\` from \`${decl.granted}\` to \`${focus}\` at ${standing.signed_at} ("${standing.reason}"). The decline stands until ${standing.re_raise_when} (so far: ${standing.why}).`,
      takes_effect: `nothing changes: a person already answered this proposal. The workflow stays at \`${decl.granted}\`: it ${behaviour(decl.granted, decl.bounds)}.`,
    }
  } else if (question_kind === 'DEMOTE') {
    const reasons = a.proposal && a.proposal.kind === 'DEMOTION_PROPOSAL' ? a.proposal.reasons : [`${bind.rung}: ${bind.reason}`]
    const further = levelRank(a.earned) < levelRank(toLevel) ? ` The evidence supports only \`${a.earned}\`; one rung is proposed at a time, and a person may decide a larger step.` : ''
    ruling = {
      disposition: 'PROPOSE_DEMOTION', favors: 'B', status: 'PROPOSED', ...(unevidenced ? {} : { urgent: true as const }), scope,
      statement: unevidenced
        ? `A standing notice, not an alarm: \`${wf}\` is granted \`${decl.granted}\` above what the record supports, and nothing has gone wrong. ${reasons.join('; ')}. A person may step it down to \`${toLevel}\`, or let the record catch up.${further}`
        : `Proposed, urgent: step \`${wf}\` down from \`${decl.granted}\` to \`${toLevel}\`. ${reasons.join('; ')}.${further}`,
      takes_effect: `only on a person's decision. Until then the workflow stays at \`${decl.granted}\`: it ${behaviour(decl.granted, decl.bounds)}. Every FAIL stays visible and disputable.${rung.source === 'BOOK' ? ` A person's signed GRANT of \`${toLevel}\` would take effect${supersedes}; a signed DECLINE ("keep it") is recorded and not asked again until a new failing case.` : ''}`,
    }
  } else if (question_kind === 'RETAIN') {
    const keep = a.earned === 'autonomy'
    ruling = {
      disposition: 'RETAIN', favors: keep ? 'A' : 'B', status: 'PROPOSED', scope,
      statement: `Retain: \`${wf}\` keeps \`autonomy\`. ${focusRung.reason}.`,
      takes_effect: 'nothing changes',
    }
  } else if (a.proposal) {
    ruling = {
      disposition: 'PROPOSE_PROMOTION', favors: 'A', status: 'PROPOSED', scope,
      statement: `Proposed: promote \`${wf}\` from \`${decl.granted}\` to \`${focus}\`${inBounds}. ${focusRung.reason}.${levelRank(a.earned) > levelRank(focus) ? ` The evidence also clears \`${a.earned}\`; one rung is proposed at a time.` : ''}${fw?.rung ? ` Argued from the window since the step down (GRANT \`${short(fw.since.decision_id)}\`, seq ${fw.since.seq}) alone: ${fw.rung.reason}.` : ''}`,
      takes_effect: rung.source === 'BOOK'
        ? `only on a person's signature: a new signed GRANT of \`${focus}\` on the book, answering proposal \`${short(a.proposal.proposal_id)}\`${supersedes}. Declining costs nothing, and a signed decline is not asked again until a fresh sample accrues.`
        : 'only on a person\'s signature. Declining costs nothing.',
    }
  } else {
    ruling = {
      disposition: 'NOT_YET', favors: 'B', status: 'PROPOSED', scope,
      statement: `Not yet: \`${wf}\` stays at \`${decl.granted}\`. ${a.blockers.length ? `${a.blockers.join('; ')}.` : fw?.rung && !fw.rung.cleared
        ? `A person stepped it down from \`${fw.from}\` after a failing case (GRANT \`${short(fw.since.decision_id)}\`, seq ${fw.since.seq}); a return needs evidence recorded since: ${fw.rung.rung} on that window alone: ${fw.rung.reason}. The pooled record clears it, and cannot carry the return by itself.`
        : `${bind.rung}: ${bind.reason}.`}`,
      takes_effect: 'nothing changes',
    }
  }
  const notes: string[] = []
  if (decl.grant) {
    const gr = decl.grant
    notes.push(g
      ? `\`${decl.granted}\` was granted by ${gr.signer_id} at ${gr.signed_at}, under policy ${gr.policy.policy_id}@${gr.policy.version} at tier '${gr.consequence_tier}' (GRANT \`${short(g.decision_id)}\`, seq ${g.seq} on the book of record). A ruling here amends that grant, and only a person's new signed GRANT does. Those settings stay fixed; changing them is a person's recorded revision.`
      : `\`${decl.granted}\` was granted by ${gr.signer_id} at ${gr.signed_at}, under policy ${gr.policy.policy_id}@${gr.policy.version} at tier '${gr.consequence_tier}'. Those settings stay fixed; changing them is a person's recorded revision.`)
  }
  if (lapsed) notes.push(`A person declined an earlier proposal (${lapsed.signer_id}, ${lapsed.signed_at}: "${lapsed.reason}"); it lapsed: ${lapsed.why}. This asks again on changed evidence.`)
  if (notes.length) ruling.note = notes.join(' ')

  const favorsAuthority = ruling.favors === 'A'
  const dissent = buildDissent(favorsAuthority, deps, bind, cal, decl, policy, tierIndex, surveilled)
  const overturn = buildOverturn(question_kind, ruling.disposition, deps, decl, policy, tierIndex, cal, ruling.declined)

  const raisedId = a.proposal?.proposal_id ?? standing?.suppressed_proposal_id
  return finalizeOpinion({
    subject: {
      kind: 'PROMOTION', question_kind, workflow_id: wf, granted: decl.granted, earned: a.earned, focus, to: toLevel,
      ...(raisedId ? { proposal_id: raisedId } : {}),
      rung_source: rung.source,
      ...(g ? { amends: cite(g) } : {}),
      ...(standing ? { declined: cite(standing) } : {}),
      ...(view.scope ? { tenant_id: view.scope.tenant_id } : {}),
    },
    title, question, readings, authorities, precedent, ruling, dissent, overturn, premises,
  }, sourceHashOf(view))
}

function reassess(cal: WorkflowCalibration, decl: WorkflowDeclaration, policy: PromotionPolicy, tier: string): VoiceAssessment {
  const { grant: _fixedAtGrant, ...rest } = decl
  return assessVoice(cal, { ...rest, consequence_tier: tier }, policy)
}

function buildDissent(
  favorsAuthority: boolean, deps: RungAssessment[], bind: RungAssessment, cal: WorkflowCalibration,
  decl: WorkflowDeclaration, policy: PromotionPolicy, tierIndex: number, surveilled = false,
): DissentPoint[] {
  const out: DissentPoint[] = []
  const tier = policy.tiers[tierIndex] as TierRequirements
  const focus = deps[deps.length - 1] as RungAssessment
  const r = favorsAuthority ? focus : bind
  const noun = NOUN[r.metric]
  const lvl = focus.rung
  if (favorsAuthority) {
    const margin = r.n - r.bar.min_n
    out.push({ topic: 'sample_size', premise: 'P3', argument: `n = ${r.n} ${noun} against a minimum of ${r.bar.min_n} (margin ${margin}).${margin < r.bar.min_n * 0.1 ? ' The record only just clears the minimum.' : ''} A sample of ${r.n} cannot tell a rate of ${pct(r.point ?? 0)} from one as high as ${pct(r.upper)}.` })
    out.push({ topic: 'confidence_interval', premise: 'P6', argument: `The ${pct(r.confidence)} ${r.sidedness} ${r.method} bounds on the ${METRIC_LABEL[r.metric]} are [${pct(r.lower)}, ${pct(r.upper)}] around the observed ${pct(r.point ?? 0)}. Headroom under the bar of ${pct(r.bar.max_error)} is ${pct(Math.max(0, r.bar.max_error - r.upper))}. The true rate can sit anywhere between them, and the ruling rests on the top edge.` })
    const own = focus.counter_cases
    const flagCases = [...new Set(deps.filter(d => d.metric === 'false_flag_rate' && d.metric !== focus.metric).flatMap(d => d.counter_cases))]
    const list = (ids: readonly string[]): string => ids.slice(0, 8).map(x => `\`${short(x)}\``).join(', ') + (ids.length > 8 ? ', …' : '')
    const ownText = own.length
      ? `${own.length} counter-case(s) bear directly on ${lvl} (${list(own)}). ${focus.metric === 'false_pass_rate' ? `Each is a PASS a person overturned: under ${lvl}, an unreviewed wrong action.` : `Each is a FAIL a person overturned: a false alarm${lvl === 'gate' ? ' that would hold legitimate work' : ''}.`}`
      : `No counter-case bears directly on ${lvl}. That is absence of evidence in ${r.n} review(s), not evidence of absence: the bound still allows up to ${pct(r.upper)}.`
    const flagText = flagCases.length ? ` Beneath it, ${flagCases.length} FAIL verdict(s) a person overturned (${list(flagCases)}) are false alarms on the rungs ${lvl} stands on.` : ''
    out.push({ topic: 'counter_cases', premise: 'P4', argument: ownText + flagText })
    const next = policy.tiers[tierIndex + 1]
    if (next) {
      const alt = reassess(cal, decl, policy, next.tier)
      const clears = levelRank(alt.earned) >= levelRank(lvl)
      const ar = alt.rungs.find(x => x.rung === lvl)!
      out.push({ topic: 'consequence_tier', premise: 'P5', argument: `The workflow is declared tier '${tier.tier}' (${tier.description}); the bar is only as right as that declaration. If its real consequence is tier '${next.tier}' (${next.description}), ${lvl} needs n ≥ ${ar.bar.min_n} and an upper bound ≤ ${pct(ar.bar.max_error)} at ${pct(ar.confidence)}: this record ${clears ? 'still clears it' : `does not (${ar.reason})`}.` })
    } else {
      out.push({ topic: 'consequence_tier', premise: 'P5', argument: `The workflow is declared tier '${tier.tier}' (${tier.description}), the highest the policy declares. If its real consequence is worse than any declared tier, no bar in this policy is strict enough.` })
    }
  } else {
    if (surveilled && r.cleared) {
      out.push({ topic: 'sample_size', premise: 'P3', argument: `The pooled record clears its bar (n = ${r.n} ≥ ${r.bar.min_n}; upper bound ${pct(r.upper)} ≤ ${pct(r.bar.max_error)}): the proposal rests on the failing case(s) found since the grant, not on the pooled rate.` })
    } else if (r.n < r.bar.min_n) {
      const c = cleanReviewsToClear(r.errors, r.n, r.bar, r.confidence, r.method)
      out.push({ topic: 'sample_size', premise: 'P3', argument: `The shortfall is volume, not error: n = ${r.n} of the ${r.bar.min_n} required${c !== null ? `; ${c} more reviewed ${r.metric === 'false_pass_rate' ? 'PASSes' : 'FAILs'} with no overturn would clear ${r.rung}` : ''}.` })
    } else {
      out.push({ topic: 'sample_size', premise: 'P3', argument: `The sample already meets its minimum (n = ${r.n} ≥ ${r.bar.min_n}); what holds it back is the bound, which is conservative by design.` })
    }
    out.push({ topic: 'confidence_interval', premise: 'P6', argument: `The observed ${METRIC_LABEL[r.metric]} is ${r.point === null ? 'not yet measured' : pct(r.point)}${r.point !== null && r.point <= r.bar.max_error ? ', already at or under the bar' : ''}; its ${pct(r.confidence)} ${r.sidedness} bounds [${pct(r.lower)}, ${pct(r.upper)}] ${r.lower <= r.bar.max_error ? `include rates under the bar of ${pct(r.bar.max_error)}: the data is consistent with a workflow that meets it` : `lie wholly above the bar of ${pct(r.bar.max_error)}`}.` })
    out.push({ topic: 'counter_cases', premise: 'P4', argument: r.counter_cases.length ? `Only ${r.counter_cases.length} counter-case(s) (${r.counter_cases.map(x => `\`${short(x)}\``).join(', ')}) stand against it. Each may carry its own explanation in its review note, and each can be disputed on its own (its dispute path is under Precedent).` : 'Not one counter-case is on record against it.' })
    const prev = policy.tiers[tierIndex - 1]
    if (prev) {
      const alt = reassess(cal, decl, policy, prev.tier)
      const target = focus.rung
      const clears = levelRank(alt.earned) >= levelRank(target)
      out.push({ topic: 'consequence_tier', premise: 'P5', argument: `If the workflow's real consequence is tier '${prev.tier}' (${prev.description}) rather than '${tier.tier}', the bar is lower, and this record ${clears ? `already earns \`${target}\` under it` : `still does not earn \`${target}\` under it`}.` })
    } else {
      out.push({ topic: 'consequence_tier', premise: 'P5', argument: `Tier '${tier.tier}' is already the lowest the policy declares; the bar cannot be argued down by re-declaring consequence.` })
    }
  }
  const outcome = r.metric === 'false_pass_rate' ? 'PASS' : 'FAIL'
  const total = cal.by_outcome[outcome], rev = cal.reviewed[outcome]
  out.push({ topic: 'selection', premise: 'P3', argument: `${rev} of ${total} ${outcome} verdict(s) were reviewed (${total ? pct(rev / total) : '0%'}). If reviewers chose what to review rather than sampling at random, the rate is biased in a direction nobody measured.` })
  out.push({ topic: 'reviewer', argument: 'Every rate here takes a person\'s review as ground truth. A mistaken review moves the rate, and Riposte cannot check a person\'s judgement.' })
  if (cal.window.first_recorded_at) out.push({ topic: 'window', premise: 'P3', argument: `The evidence runs from ${cal.window.first_recorded_at} to ${cal.window.last_recorded_at}. A change in the agent, the documents or the counterparties since then is not in it.` })
  return out
}

function buildOverturn(
  kind: 'PROMOTE' | 'RETAIN' | 'DEMOTE', disposition: Ruling['disposition'], deps: RungAssessment[],
  decl: WorkflowDeclaration, policy: PromotionPolicy, tierIndex: number, cal: WorkflowCalibration, declined?: DeclinedBy,
): OverturnCondition[] {
  const out: OverturnCondition[] = []
  const focus = deps[deps.length - 1] as RungAssessment
  if (disposition === 'DECLINED' && declined) {
    out.push({ premise: 'P9', evidence: declined.re_raise_when, effect: 'the decline lapses and the proposal is raised again, argued in a new opinion' })
    out.push({ premise: 'P8', evidence: 'a person re-granting the workflow (at any rung)', effect: 'the decline binds to the grant in force, so it lapses with it' })
    if (kind === 'DEMOTE') out.push({ premise: 'P4', evidence: 'a successful dispute of a failing case (a person re-reviews it as UPHELD)', effect: 'it leaves the count and the bound is recomputed; if the record supports the rung again, there is nothing left to decline' })
  } else if (disposition === 'PROPOSE_PROMOTION' || disposition === 'RETAIN') {
    for (const r of [...deps].reverse()) {
      if (!r.cleared) continue
      const noun = r.metric === 'false_pass_rate' ? 'PASS verdicts' : 'FAIL verdicts'
      const falls = below(r.rung)
      const j = consecutiveErrorsToBreach(r.errors, r.n, r.bar.max_error, r.confidence, r.method)
      out.push({ premise: 'P6', evidence: `${j} more overturned ${noun} in a row (no clean review between)`, effect: `the ${r.rung} upper bound exceeds ${pct(r.bar.max_error)}: Riposte raises an urgent proposal to step down to \`${falls}\`, and a person decides` })
      const m = errorsInHorizonToBreach(r.errors, r.n, r.bar.min_n, r.bar.max_error, r.confidence, r.method)
      if (m !== null) out.push({ premise: 'P6', evidence: `${m} or more overturned among the next ${r.bar.min_n} reviewed ${noun}`, effect: `the ${r.rung} upper bound exceeds ${pct(r.bar.max_error)}: Riposte raises an urgent proposal to step down to \`${falls}\`, and a person decides` })
    }
    const next = policy.tiers[tierIndex + 1]
    if (next) {
      const alt = reassess(cal, decl, policy, next.tier)
      if (levelRank(alt.earned) < levelRank(focus.rung)) out.push({ premise: 'P5', evidence: `a person re-granting the workflow at tier '${next.tier}' (${next.description})`, effect: `this record supports only \`${alt.earned}\` under that bar` })
    }
    if (disposition === 'PROPOSE_PROMOTION') out.push({ evidence: 'a person declines to sign', effect: `the proposal lapses; the workflow stays at \`${decl.granted}\`` })
  } else {
    for (const r of deps) {
      if (r.cleared) continue
      const c = cleanReviewsToClear(r.errors, r.n, r.bar, r.confidence, r.method)
      const noun = r.metric === 'false_pass_rate' ? 'PASS verdicts' : 'FAIL verdicts'
      out.push({ premise: 'P6', evidence: c === null ? `no realistic run of clean reviews (past 10,000,000) clears ${r.rung} at this tier` : `${c} more reviewed ${noun} with no overturn`, effect: `${r.rung} clears (n ≥ ${r.bar.min_n}, upper bound ≤ ${pct(r.bar.max_error)})` })
    }
    const target = kind === 'DEMOTE' ? decl.granted : focus.rung
    const prev = policy.tiers[tierIndex - 1]
    if (prev) {
      const alt = reassess(cal, decl, policy, prev.tier)
      if (levelRank(alt.earned) >= levelRank(target)) out.push({ premise: 'P5', evidence: `a person re-granting at the lower tier '${prev.tier}' (${prev.description}), if that is its real consequence`, effect: `this record supports \`${alt.earned}\` under that bar` })
    }
    if (kind === 'DEMOTE') {
      out.push({ premise: 'P4', evidence: 'a successful dispute of a failing case (a person re-reviews it as UPHELD)', effect: 'it leaves the count and the bound is recomputed; the proposal lapses if the rung is supported again' })
      out.push({ evidence: 'a person deciding to keep the rung', effect: `the workflow stays at \`${decl.granted}\`: it is their decision. The proposal stays open, flagged, while the record does not support the rung` })
    } else {
      out.push({ evidence: `a person deciding to grant \`${focus.rung}\` anyway`, effect: 'the rung is theirs to set; while the record does not support it, Riposte shows a standing notice (not urgent), and raises an urgent proposal to step down only on a failing case' })
    }
  }
  out.push({ evidence: 'a new ruleset or engine version', effect: 'this evidence stops describing the rules; the new version starts an empty record, and its rung is a person\'s new grant' })
  out.push({ premise: 'P1', evidence: 'the ledger failing its integrity check (verifyContent)', effect: 'the evidence is void; nothing may be earned from it' })
  return out
}

