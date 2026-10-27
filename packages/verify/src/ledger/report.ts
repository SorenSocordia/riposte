/**
 * Tenant "book of record" report — the compliance artifact, composed from everything the ledger holds.
 *
 * This is the single document a regulated buyer or an auditor actually asks for: how many verdicts,
 * how often a human overturned us (the honest real-world accuracy), which rules the field distrusts (per-rule
 * calibration), what Riposte is asking a person to decide (the opinions section), and a tamper-evidence attestation with
 * the anchor hash to notarize. It composes existing pieces (stats + ruleCalibration + assessVoice + promotionOpinion +
 * actionNotice + the hash chain); it invents no number and is honest when a section is empty. Deterministic given the
 * ledger's contents and the options (the only clock is the optional `as_of` line and the `period` the caller supplies).
 *
 * THE OPINIONS SECTION is the day-1 "audit report" of Audit → Advise → Autonomy: "what Riposte is asking for this month".
 *   - the open proposals: an URGENT demotion (something went wrong under what a person granted) or a promotion (the record
 *     supports one rung more), each with the one-line ruling of its courtroom opinion and the path to read and dispute it;
 *   - the standing notices (D-UNEVIDENCED): a rung granted above what the record yet supports, with nothing gone wrong. Not
 *     an ask and not an alarm: listed apart from the asks, and the rung stays as a person set it;
 *   - what a person declined (D-DECLINED-COPY): "Kept at <rung> by <person>, <date>; stands until …" for a kept rung, "Not
 *     now: <person>, <date>; re-raises when …" for a declined promotion. A declined proposal is never listed as an ask;
 *   - the FAIL / INSUFFICIENT_DATA notices by rung: surfaced at record and advise, held at gate and autonomy, each with its dispute
 *     path. Every FAIL is visible and disputable at every rung.
 * Riposte proposes; a person decides. Nothing here changes a rung.
 *
 * BOOK FIRST (2026-09-28): given `voice.book`, each workflow's rung is READ FROM THE BOOK OF RECORD, the GRANT in force (a
 * person's signed decision), and assessVoice reads and re-verifies it: granted workflows with no verdicts yet are listed, a
 * person's standing DECLINE holds its proposal back and the section says so in words ("declined by X at T; re-raises when
 * …"). Declarations then cover only workflows with no GRANT (books that predate signed grants) and never override one. A
 * book that does not verify grants nothing: no rung is read from it, no declaration stands in for one, nothing is proposed.
 *
 * D-ANCHOR (2026-09-28): only an anchored signer's decision moves a rung. An unanchored GRANT or DECLINE is on the book and
 * has no effect; the section says so, one "⚠ <notice>" line each (`grants.no_effect`), so a rung that reads `record` says why.
 * D-DUAL (2026-09-28): a GRANT still waiting for its co-signature(s) is PENDING and said the same way, one line each.
 */

import type { Ledger, LedgerRecord } from './types.js'
import { ruleCalibration, renderCalibration, type CalibrationOptions } from './calibration.js'
import { recordFacts, type VerdictFacts } from './disk.js'
import { grantInForce, readDecisionBook, governedNoEffect, isAnchored, successionNotice, type DecisionBook, type DecisionEntry, type GrantDecision, type NoEffect, type TrustedKeys } from './decisions.js'
import type { RootKeys } from './registry.js'
import {
  assessVoice, workflowCalibration, workflowCalibrations, defaultWorkflowOf, lintPolicy, policyRef, levelRank, VOICE_LADDER, EXAMPLE_PROMOTION_POLICY,
  type PolicyRef, type PromotionPolicy, type VoiceLevel, type WorkflowDeclaration, type WorkflowCalibrationOptions,
  type BookDeclaration, type ChainExport, type DeclineCitation, type StandingDecline,
} from '../verdict/voice.js'
import { actionNotice } from '../verdict/notices.js'
import { promotionOpinion, openSnapshot, snapshotOfLedger } from '../opinion/index.js'

/** A workflow's declared settings (consequence tier, the rung a person granted, bounds, the grant); the id is the key. */
export type WorkflowSettings = Omit<WorkflowDeclaration, 'workflow_id'>

/** A workflow's settings READ FROM THE BOOK (a BookDeclaration without its id): assessVoice reads the GRANT in force itself. */
export type BookSettings = Omit<BookDeclaration, 'workflow_id'>

/** True when the settings are read from the book of record (they carry the book), not declared. */
export function isBookSettings(s: WorkflowSettings | BookSettings | undefined): s is BookSettings {
  return !!s && typeof s === 'object' && (s as { book?: unknown }).book !== undefined
}

/**
 * Read a book of record's decisions (verified in full): a Ledger (its own anchors by default) or a chain export (no anchors
 * of its own: without trusted_keys / root_keys its decisions are unanchored and, D-ANCHOR, move nothing).
 */
export function readVoiceBook(book: Ledger | ChainExport, trusted_keys?: TrustedKeys, root_keys?: RootKeys): DecisionBook {
  const opts = { ...(trusted_keys ? { trusted_keys } : {}), ...(root_keys?.length ? { root_keys } : {}) }
  if (book && typeof (book as Ledger).decisionBook === 'function') return (book as Ledger).decisionBook(opts)
  const c = book as ChainExport
  if (!c || !Array.isArray(c.events) || !Array.isArray(c.payloads)) throw new Error('book must be a Ledger or a chain export { events, payloads }')
  return readDecisionBook(c.events, c.payloads, opts)
}

/** Why a book that does not verify grants nothing, in words. */
export function bookRefusal(db: DecisionBook): string {
  const at = db.check.brokenAt !== undefined ? ` at event ${db.check.brokenAt}` : ''
  return `the book of record does not verify${at} (${db.check.reason ?? 'unknown'}): a tampered, mis-signed or unanchored book grants nothing, so no rung is read from it`
}

/** Where a workflow's rung comes from, BOOK FIRST (see readRung). */
export interface RungRead {
  /**
   * grant        a person's signed GRANT in force on the book (rung, tier, bounds and policy are the grant's)
   * none         nothing granted: the rung is record (measured at a declared tier, if one is declared)
   * declaration  no GRANT on the book, and a declared rung above record (a book that predates signed grants)
   * unread       the book does not verify: it grants nothing, and no declaration stands in for a grant it may hold
   */
  from: 'grant' | 'none' | 'declaration' | 'unread'
  /** What to assess under: the book (BookSettings) or the declaration. Absent: nothing to weigh (no tier), or unread. */
  settings?: WorkflowSettings | BookSettings
  /** The rung it runs at (record when nothing is granted, or when the book is unread). */
  granted: VoiceLevel
  consequence_tier?: string
  /** The GRANT in force, when the rung is read from one. */
  grant?: DecisionEntry<GrantDecision>
  /** Why no rung could be read (from = unread). */
  problem?: string
}

/**
 * A workflow's rung and settings, BOOK FIRST. The GRANT in force on a verified book governs (assessVoice then reads it
 * itself). Without one: a declaration at `record` (no bounds, no grant record) is measured on the book at its tier, so a
 * person's signed decline of a record-level proposal still holds it back; a declaration above `record` is the flag path,
 * for books that predate signed grants. A declaration never overrides a GRANT. A book that does not verify grants nothing.
 */
export function readRung(db: DecisionBook, book: Ledger | ChainExport, workflow_id: string, declared: WorkflowSettings | undefined, trusted_keys?: TrustedKeys, policy?: PromotionPolicy): RungRead {
  if (!db.ok) return { from: 'unread', granted: 'record', problem: bookRefusal(db) }
  const anchors = trusted_keys ? { trusted_keys } : {}
  // D-DUAL: with the deployment's policy, a GRANT that under-states its tier's grant_signatures is pending too, as every
  // policy-aware reader reads it (without it, the count the grant states governs).
  const g = grantInForce(db.decisions, workflow_id, policy ? { policies: [policy], governing_policy: policy } : {}) // D-GOVERNING-POLICY
  if (g) {
    const gd = g.signed.decision
    return { from: 'grant', settings: { book, ...anchors }, granted: gd.level, consequence_tier: gd.consequence_tier, grant: g }
  }
  if (!declared) return { from: 'none', granted: 'record' }
  if (declared.granted === 'record' && declared.bounds === undefined && declared.grant === undefined) {
    return { from: 'none', settings: { book, consequence_tier: declared.consequence_tier, ...anchors }, granted: 'record', consequence_tier: declared.consequence_tier }
  }
  return { from: 'declaration', settings: declared, granted: declared.granted, consequence_tier: declared.consequence_tier }
}

/** A declaration the GRANT in force overrides (the book governs; a declaration never overrides a person's signed grant). */
export interface OverriddenDeclaration {
  workflow_id: string
  /** What the declaration states (only the fields it states). */
  declared: { granted?: string; consequence_tier?: string }
  grant: { decision_id: string; level: VoiceLevel; consequence_tier: string }
}

/**
 * The declarations that disagree with the GRANT in force on the book, each with what it states and what the grant says.
 * Compares only the fields a declaration states (a rung, a tier). Pure; the book's decisions in, sorted by workflow id.
 */
export function declarationsOverridden(
  decisions: readonly DecisionEntry[], declarations: readonly { workflow_id: string; granted?: unknown; consequence_tier?: unknown }[],
): OverriddenDeclaration[] {
  const out: OverriddenDeclaration[] = []
  for (const d of declarations) {
    const e = grantInForce(decisions, d.workflow_id)
    if (!e) continue
    const g = e.signed.decision
    const rung = d.granted !== undefined && d.granted !== g.level
    const tier = d.consequence_tier !== undefined && d.consequence_tier !== g.consequence_tier
    if (!rung && !tier) continue
    out.push({
      workflow_id: d.workflow_id,
      declared: { ...(d.granted !== undefined ? { granted: String(d.granted) } : {}), ...(d.consequence_tier !== undefined ? { consequence_tier: String(d.consequence_tier) } : {}) },
      grant: { decision_id: e.decision_id, level: g.level, consequence_tier: g.consequence_tier },
    })
  }
  return out.sort((x, y) => x.workflow_id.localeCompare(y.workflow_id))
}

export interface ReportPeriod {
  /** Inclusive lower bound on recorded_at (ISO-8601). */
  since?: string
  /** Exclusive upper bound on recorded_at (ISO-8601). */
  until?: string
  /** How the report names it, e.g. "2026-09". */
  label?: string
}

export interface TenantReportOptions {
  /** Restrict to one tenant. Omit for an all-tenants report. */
  tenant_id?: string
  /** An "as of" timestamp to stamp on the report (ISO-8601). Purely cosmetic; kept out of the deterministic body. */
  as_of?: string
  /** Thresholds for the per-rule calibration section. */
  calibration?: CalibrationOptions
  /**
   * Earned voice: the declared promotion policy and each workflow's declared settings. Without a policy nothing is
   * proposed; a workflow without settings is at `record` (nothing granted). An array also lists declared workflows that
   * have no verdicts yet (a person may have granted a rung the record cannot yet support).
   */
  voice?: {
    policy?: PromotionPolicy
    /**
     * THE BOOK OF RECORD the rungs are read from (usually the report's own ledger): each workflow's GRANT in force sets its
     * rung, tier, bounds and policy version (see readRung), granted workflows with no verdicts yet are listed, and a
     * person's standing DECLINE is said in words. `declarations` then cover only workflows with no GRANT and never override
     * one. A book that does not verify grants nothing, and nothing is proposed from it.
     */
    book?: Ledger | ChainExport
    /** Anchor the book's signers to people on read (signer_id → public key). A Ledger's own anchors are its default. */
    trusted_keys?: TrustedKeys
    declarations?: readonly WorkflowDeclaration[] | ((workflow_id: string) => WorkflowSettings | undefined)
  }
  /** The reporting window for the FAIL / INSUFFICIENT_DATA notices (e.g. this month). Omit for the whole record. */
  period?: ReportPeriod
  /** Open notices listed per workflow before "… N more" (default 10). */
  max_notices?: number
}

/** The UTC calendar month containing `d`: [first of the month, first of the next), labelled YYYY-MM. */
export function monthPeriod(d: Date): Required<ReportPeriod> {
  const y = d.getUTCFullYear(), m = d.getUTCMonth()
  const first = (yy: number, mm: number): string => new Date(Date.UTC(yy, mm, 1)).toISOString()
  return { since: first(y, m), until: first(y, m + 1), label: `${y}-${String(m + 1).padStart(2, '0')}` }
}

// ── the opinions section, as data ────────────────────────────────────────────────────────────────────────────────────

export interface WorkflowVoiceRow {
  workflow_id: string
  /** The rung a person granted (record when nothing is declared). The effective rung, always. */
  granted: VoiceLevel
  declared: boolean
  consequence_tier?: string
  /** What the evidence supports, when it was weighed. */
  earned?: VoiceLevel
  /** Verdicts on record for this workflow. */
  records: number
  /** Why it could not be weighed (settings the policy refuses), if so. */
  problem?: string
  /** Where the rung was read, when the report reads a book (see RungRead.from). Absent on the declarations-only path. */
  rung_from?: RungRead['from']
  /** The GRANT in force the rung was read from: a person's signed decision on the book. */
  grant?: { decision_id: string; seq: number; entry_hash: string; signer_id: string; signed_at: string; anchored: boolean; succession?: string }
}

/** A proposal a person declined, held back (not re-asked) until the evidence the person saw changes. */
export interface DeclinedProposal {
  workflow_id: string
  kind: 'PROMOTION_PROPOSAL' | 'DEMOTION_PROPOSAL'
  consequence_tier: string
  /** The rung it runs at (kept) and the rung the held-back proposal would move it to. */
  from: VoiceLevel
  to: VoiceLevel
  /** The person's standing DECLINE: who, when, why, the proposal it holds back, and what would re-raise it. */
  decline: StandingDecline
  /** The courtroom opinion on the workflow read from the book (its disposition is DECLINED when every premise verifies). */
  opinion_id: string
  disposition: string
  verified: boolean
  /** How to read that opinion: `verify opinion --from-book`. */
  opinion_command: string
}

export interface OpenProposal {
  kind: 'PROMOTION_PROPOSAL' | 'DEMOTION_PROPOSAL'
  urgent: boolean
  workflow_id: string
  consequence_tier: string
  from: VoiceLevel
  to: VoiceLevel
  proposal_id: string
  /** The courtroom opinion on it: its id, its disposition, its one-line ruling, and whether every premise verified. */
  opinion_id: string
  disposition: string
  ruling: string
  verified: boolean
  /** How to read the full opinion (and so dispute it). For a rung read from the book: `verify opinion --from-book`. */
  opinion_command: string
  /** A demotion's failing cases, each with its own dispute path. */
  failing_cases: { verdict_id: string; dispute: string }[]
  /**
   * A demotion's basis (DECISION D-UNEVIDENCED): 'failure' (evidence OF failure: URGENT) or 'unevidenced' (granted above
   * what the book supports, and nothing has gone wrong: a standing notice, never urgent). `urgent` mirrors the proposal.
   */
  basis?: 'failure' | 'unevidenced'
  /** Where the rung was read, when the report reads a book (a book-read rung is decided with verify grant / verify decline). */
  rung_from?: RungRead['from']
  /** A person's earlier "no" that no longer stands because the evidence changed: why it is asked again. */
  decline_lapsed?: DeclineCitation
}

export interface NoticeRow {
  verdict_id: string
  outcome: 'FAIL' | 'INSUFFICIENT_DATA'
  recorded_at: string
  /** At this rung: HOLD (until a person resolves it) or SURFACE (shown, not held). */
  action: 'HOLD' | 'SURFACE'
  /** The first finding, in words; `findings` counts them all. */
  finding: string
  findings: number
  /** Dispute the whole verdict. */
  dispute: string
}

export interface WorkflowNotices {
  workflow_id: string
  fail: number
  /** can't tell (INSUFFICIENT_DATA) verdicts; this field was `abstain` before 2026-10-06 */
  insufficient_data: number
  /** Reviewed by a person already (resolved). */
  resolved: number
  /** Awaiting a person, in recorded order. */
  open: NoticeRow[]
}

export interface RungNotices { level: VoiceLevel; workflows: WorkflowNotices[] }

export interface TenantOpinions {
  period: ReportPeriod
  /** The book the section was read from: records are rebuilt from the chain and its content re-hashed. */
  book: { content_verified: boolean; length: number; head: string | null; reason?: string }
  policy: PolicyRef | null
  /** Why the policy cannot be used (it does not lint), if so. */
  policy_problem?: string
  workflows: WorkflowVoiceRow[]
  /** What Riposte is asking a person to decide: urgent (failure-basis) demotions first, then promotions; each by workflow id. */
  asking: OpenProposal[]
  /**
   * Standing notices, not asks (DECISION D-UNEVIDENCED): unevidenced demotions, a rung granted above what the record yet
   * supports with nothing gone wrong. Never urgent; the rung stays as a person set it. By workflow id.
   */
  standing: OpenProposal[]
  /** What a person declined and Riposte is NOT asking again (until the evidence changes): urgent demotions first, by workflow. */
  declined: DeclinedProposal[]
  /** FAIL / INSUFFICIENT_DATA notices in the period, by the rung each workflow runs at (ladder order; rungs with none omitted). */
  notices: RungNotices[]
  /** Notices of workflows whose rung could not be read (the book did not verify): whether they are held cannot be shown. */
  notices_unread?: WorkflowNotices[]
  /**
   * Present when the rungs are read from a book: whether it verified, its unanchored signers, the decisions that have no effect
   * because their signer is not anchored (D-ANCHOR; the tenant's own and the deployment-wide ones), and the declarations the
   * book overrides.
   */
  grants?: { verified: boolean; reason?: string; unanchored_signers: string[]; no_effect: NoEffect[]; overridden: OverriddenDeclaration[] }
}

const opinionCommand = (wf: string, s: WorkflowSettings): string =>
  `verify opinion --ledger <chain.jsonl> --policy <policy.json> --workflow ${wf} --tier ${s.consequence_tier} ${s.grant ? '--grant <grant.json>' : `--granted ${s.granted}`}${s.bounds !== undefined ? ` --bounds ${JSON.stringify(s.bounds)}` : ''}`

/**
 * A book-read rung's opinion, read from the book (`verify opinion --from-book`): the GRANT in force, a standing DECLINE, the
 * tenant scope. `verify voice --from-book` prints the assessment `verify decline` takes.
 */
const bookCommand = (wf: string, r: RungRead, tenant?: string): string =>
  `verify opinion --from-book --ledger <chain.jsonl> --policy <policy.json> --workflow ${wf}${r.from === 'none' && r.consequence_tier !== undefined ? ` --tier ${r.consequence_tier}` : ''}${tenant !== undefined ? ` --tenant ${tenant}` : ''}`

const oneRung = (from: VoiceLevel, up: boolean): VoiceLevel => VOICE_LADDER[Math.min(VOICE_LADDER.length - 1, Math.max(0, levelRank(from) + (up ? 1 : -1)))] as VoiceLevel

/** The opinions section as data: open proposals with their rulings, and the FAIL / INSUFFICIENT_DATA notices by rung. Deterministic. */
export function tenantOpinions(ledger: Ledger, opts: TenantReportOptions = {}): TenantOpinions {
  const tenant = opts.tenant_id
  const period = opts.period ?? {}
  const snapshot = snapshotOfLedger(ledger)
  const view = openSnapshot(snapshot)
  const c = view.chain
  const owned = (wf: string): boolean => tenant === undefined || wf.startsWith(`${tenant}/`)

  // The book the rungs are read from, verified in full: `voice.book`, else the report's own ledger (BOOK FIRST, always: a
  // person's signed GRANT or DECLINE on the book is never ignored). One that does not verify grants nothing.
  const bookSrc: Ledger | ChainExport = opts.voice?.book ?? ledger
  const trusted = opts.voice?.trusted_keys
  const db: DecisionBook | undefined = readVoiceBook(bookSrc, trusted)
  // A tenant report reads each opinion under the tenant's scope (a shared book): its evidence and grants are the tenant's.
  // Explicit anchors win over the ledger's own (a snapshot of a Ledger carries its own), so they are passed when given.
  const scope = { ...(tenant !== undefined ? { scope: { tenant_id: tenant } } : {}), ...(trusted ? { trusted_keys: trusted } : {}) }
  const unread = db !== undefined && !db.ok
  const book: TenantOpinions['book'] = {
    content_verified: view.content_verified && !unread, length: c?.length ?? 0, head: c?.head ?? null,
    ...(c && !c.ok ? { reason: `event ${c.brokenAt}: ${c.reason}` } : unread ? { reason: bookRefusal(db) } : {}),
  }
  const inTenant = (rec: LedgerRecord): boolean => tenant === undefined || rec.tenant_id === tenant
  const calibration: WorkflowCalibrationOptions = { workflowOf: rec => (inTenant(rec) ? defaultWorkflowOf(rec) : undefined) }

  const policy = opts.voice?.policy
  const lint = policy ? lintPolicy(policy) : undefined
  const decls = opts.voice?.declarations
  const settingsOf = (wf: string): WorkflowSettings | undefined => {
    if (typeof decls === 'function') return decls(wf)
    const d = decls?.find(x => x.workflow_id === wf)
    if (!d) return undefined
    const { workflow_id: _wf, ...s } = d
    return s
  }

  // Every workflow on the record, plus declared ones and granted ones with no verdicts yet.
  const cals = new Map(workflowCalibrations(view.records, calibration).map(cal => [cal.workflow_id, cal]))
  const ids = new Set(cals.keys())
  if (Array.isArray(decls)) for (const d of decls) if (owned(d.workflow_id)) ids.add(d.workflow_id)
  if (db?.ok) for (const e of db.decisions) if (e.signed.decision.kind === 'GRANT' && owned(e.signed.decision.workflow_id)) ids.add(e.signed.decision.workflow_id)

  const workflows: WorkflowVoiceRow[] = []
  const asking: OpenProposal[] = []
  const standingNotices: OpenProposal[] = []
  const declined: DeclinedProposal[] = []
  for (const wf of [...ids].sort()) {
    const declared = settingsOf(wf)
    const r: RungRead | undefined = db ? readRung(db, bookSrc, wf, declared, trusted, lint?.ok ? policy : undefined) : undefined
    const s = r ? r.settings : declared
    const cal = cals.get(wf)
    const tier = r ? r.consequence_tier : declared?.consequence_tier
    const row: WorkflowVoiceRow = {
      workflow_id: wf, granted: r ? r.granted : (declared?.granted ?? 'record'), declared: s !== undefined, records: cal?.records ?? 0,
      ...(tier !== undefined ? { consequence_tier: tier } : {}),
      ...(r ? { rung_from: r.from } : {}),
      ...(r?.grant ? { grant: grantCite(r.grant, db!) } : {}),
      ...(r?.problem ? { problem: r.problem } : {}),
    }
    workflows.push(row)
    if (!s || !policy || !lint?.ok || !book.content_verified) continue
    try {
      // A declared or granted workflow with no verdicts yet has an empty record (a person may have granted a rung it cannot support).
      const a = assessVoice(cal ?? workflowCalibration([], wf, calibration), { ...s, workflow_id: wf }, policy)
      row.earned = a.earned
      const standing = a.book?.declined
      if (standing && r) {
        // The opinion read from the book says the same (DECLINED, citing the DECLINE and the GRANT it holds to), so the
        // report and the opinion never disagree; its id is cited so the reader can check it.
        const op = promotionOpinion({ snapshot, policy, workflow_id: wf, ...(r.from === 'none' ? { consequence_tier: a.consequence_tier } : {}), calibration, ...scope })
        const kind = standing.proposal_kind
        declined.push({
          workflow_id: wf, kind, consequence_tier: a.consequence_tier, from: a.granted, to: oneRung(a.granted, kind === 'PROMOTION_PROPOSAL'), decline: { ...standing },
          opinion_id: op.opinion_id, disposition: op.ruling.disposition, verified: op.verified, opinion_command: bookCommand(wf, r, tenant),
        })
      }
      if (!a.proposal) continue
      const p = a.proposal
      const op = promotionOpinion({ snapshot, policy, proposal: p, calibration, ...scope })
      // D-UNEVIDENCED: a grant above the record with nothing gone wrong is a standing notice, listed apart, never an ask.
      const into = p.kind === 'DEMOTION_PROPOSAL' && p.basis === 'unevidenced' ? standingNotices : asking
      into.push({
        kind: p.kind, urgent: p.urgent, workflow_id: wf, consequence_tier: p.consequence_tier, from: p.from, to: p.to, proposal_id: p.proposal_id,
        opinion_id: op.opinion_id, disposition: op.ruling.disposition, ruling: op.ruling.statement, verified: op.verified,
        opinion_command: r && r.from !== 'declaration' ? bookCommand(wf, r, tenant) : opinionCommand(wf, s as WorkflowSettings),
        failing_cases: p.kind === 'DEMOTION_PROPOSAL' ? p.failing_cases.map(f => ({ verdict_id: f.verdict_id, dispute: f.dispute })) : [],
        ...(p.kind === 'DEMOTION_PROPOSAL' && p.basis !== undefined ? { basis: p.basis } : {}),
        ...(r ? { rung_from: r.from } : {}),
        ...(a.book?.decline_lapsed ? { decline_lapsed: { ...a.book.decline_lapsed } } : {}),
      })
    } catch (e) {
      row.problem = (e as Error).message
    }
  }
  asking.sort((x, y) => Number(y.urgent) - Number(x.urgent) || x.workflow_id.localeCompare(y.workflow_id))
  standingNotices.sort((x, y) => x.workflow_id.localeCompare(y.workflow_id))
  declined.sort((x, y) => Number(y.kind === 'DEMOTION_PROPOSAL') - Number(x.kind === 'DEMOTION_PROPOSAL') || x.workflow_id.localeCompare(y.workflow_id))

  // FAIL / INSUFFICIENT_DATA in the period, grouped by workflow, then by the rung the workflow runs at (or unread, when it cannot be).
  const levelOf = new Map(workflows.filter(w => w.rung_from !== 'unread').map(w => [w.workflow_id, w.granted]))
  const unreadIds = new Set(workflows.filter(w => w.rung_from === 'unread').map(w => w.workflow_id))
  const byWf = new Map<string, WorkflowNotices>()
  const inPeriod = (rec: LedgerRecord): boolean => (period.since === undefined || rec.recorded_at >= period.since) && (period.until === undefined || rec.recorded_at < period.until)
  // P-J: outcome and id from the index (a disk-backed book: no parse); the verdict is read in full only for a notice awaiting a person.
  const factsOf = (r: LedgerRecord): VerdictFacts => recordFacts(r) ?? r.verdict
  const recs = view.records
    .filter(r => inTenant(r) && inPeriod(r) && (factsOf(r).outcome === 'FAIL' || factsOf(r).outcome === 'INSUFFICIENT_DATA'))
    .sort((x, y) => x.recorded_at.localeCompare(y.recorded_at) || factsOf(x).verdict_id.localeCompare(factsOf(y).verdict_id))
  for (const rec of recs) {
    const wf = defaultWorkflowOf(rec)
    const level = levelOf.get(wf) ?? 'record'
    let w = byWf.get(wf)
    if (!w) { w = { workflow_id: wf, fail: 0, insufficient_data: 0, resolved: 0, open: [] }; byWf.set(wf, w) }
    const rv = factsOf(rec)
    if (rv.outcome === 'FAIL') w.fail++
    else w.insufficient_data++
    if (rec.review) { w.resolved++; continue }
    let n
    try { n = actionNotice(rec.verdict, level) } catch { continue }
    const f = n.findings[0]
    w.open.push({
      verdict_id: rv.verdict_id, outcome: rv.outcome as 'FAIL' | 'INSUFFICIENT_DATA', recorded_at: rec.recorded_at,
      action: n.action === 'HOLD' ? 'HOLD' : 'SURFACE',
      finding: f ? (f.outcome === 'FAIL' ? `${f.rule_name} on \`${f.field}\`` : `${f.rule_name} could not run (${f.insufficiency?.reason ?? 'INSUFFICIENT_DATA'})`) : 'no deterministic finding',
      findings: n.findings.length, dispute: n.dispute,
    })
  }
  const byName = (x: WorkflowNotices, y: WorkflowNotices): number => x.workflow_id.localeCompare(y.workflow_id)
  const read = [...byWf.values()].filter(w => !unreadIds.has(w.workflow_id))
  const notices: RungNotices[] = VOICE_LADDER
    .map(level => ({ level, workflows: read.filter(w => (levelOf.get(w.workflow_id) ?? 'record') === level).sort(byName) }))
    .filter(r => r.workflows.length > 0)
  const notices_unread = [...byWf.values()].filter(w => unreadIds.has(w.workflow_id)).sort(byName)

  return {
    period, book, policy: policy ? policyRef(policy) : null,
    ...(lint && !lint.ok ? { policy_problem: lint.errors.join('; ') } : {}),
    workflows, asking, standing: standingNotices, declined, notices,
    ...(notices_unread.length ? { notices_unread } : {}),
    ...(db ? {
      grants: {
        verified: db.ok, ...(db.ok ? {} : { reason: bookRefusal(db) }), unanchored_signers: [...db.unanchored],
        // D-GOVERNING-POLICY: the governed list, so a grant the declared policy does not admit is SAID (pending, or no effect, and why).
        no_effect: db.ok ? governedNoEffect(db, policy && lint?.ok ? policy : undefined).filter(n => n.workflow_id === undefined || owned(n.workflow_id)) : [],
        overridden: db.ok ? declarationsOverridden(db.decisions, workflows.flatMap(w => {
          const d = w.rung_from === 'grant' ? settingsOf(w.workflow_id) : undefined
          return d ? [{ ...d, workflow_id: w.workflow_id }] : []
        })) : [],
      },
    } : {}),
  }
}

/** The GRANT a rung was read from, cited: its decision id, place on the chain, signer, and whether the signer is anchored. */
function grantCite(g: DecisionEntry<GrantDecision>, db: DecisionBook): NonNullable<WorkflowVoiceRow['grant']> {
  const d = g.signed.decision
  // D-ANCHOR: a cited grant is anchored by construction (grantInForce reads anchored grants only).
  const succession = successionNotice(g) // RULESET_SUCCESSION: what it carries, and what the replay under the new ruleset said
  return { decision_id: g.decision_id, seq: g.seq, entry_hash: g.entry_hash, signer_id: d.signer_id, signed_at: d.signed_at, anchored: isAnchored(g), ...(succession ? { succession } : {}) }
}

// ── rendering ────────────────────────────────────────────────────────────────────────────────────────────────────────

const HANDLING_WORDS: Record<VoiceLevel, string> = {
  record: 'surfaced as a notice on the record; nothing is held',
  advise: 'surfaced in-flow to the person and the agent; nothing is held',
  gate: 'HELD until a person resolves it',
  autonomy: 'HELD until a person resolves it (PASSes proceed within the declared bounds)',
}
const short = (h: string, n = 12): string => (h.length > n ? `${h.slice(0, n)}…` : h)

export function renderOpinionsSection(o: TenantOpinions, opts: { max_notices?: number } = {}): string {
  const max = opts.max_notices ?? 10
  const when = o.period.label ?? (o.period.since || o.period.until ? `${o.period.since ?? 'the start'} to ${o.period.until ?? 'now'}` : undefined)
  const L: string[] = [`## Opinions: what Riposte is asking for${when ? ` (${when})` : ''}`, '']
  L.push(
    `> Riposte proposes; a person decides. Nothing below changes a rung: a promotion waits for a person's signature, an urgent demotion for a person's decision, and every FAIL stays visible and disputable at every rung. Proposals weigh each workflow's whole record; the notices cover ${when ? (o.period.label ? `${o.period.label} (${o.period.since ?? '…'} to ${o.period.until ?? '…'})` : when) : 'the whole record'}. Each command has an HTTP twin: \`POST /v1/opinion\` with \`{ workflow_id }\` or \`{ dispute: { verdict_id } }\`.`,
    '',
  )

  if (o.workflows.length === 0) {
    L.push('No workflow has a verdict on record yet: Riposte is asking for nothing, and there is nothing to notice.', '')
    return L.join('\n')
  }

  const illustrative = o.policy !== null && o.policy.hash === policyRef(EXAMPLE_PROMOTION_POLICY).hash
  L.push(o.policy
    ? `Policy: \`${o.policy.policy_id}@${o.policy.version}\` (\`${short(o.policy.hash)}\`).${illustrative ? ' ◇ This is the illustrative example policy: not ratified, not calibrated against a real deployment. Its bars are placeholders; a deployment declares its own.' : ''}`
    : 'Policy: none declared.', '')
  L.push('| workflow | rung (a person\'s grant) | tier | verdicts | the evidence supports |', '|---|---|---|---:|---|')
  for (const w of o.workflows) {
    const rung = w.rung_from === 'unread' ? '⚠ unread (the book did not verify)' : w.declared ? w.granted : 'record (nothing granted)'
    L.push(`| \`${w.workflow_id}\` | ${rung} | ${w.consequence_tier ?? '—'} | ${w.records} | ${w.earned ?? (w.problem ? '⚠ not weighed' : '—')} |`)
  }
  L.push('')
  // Where each rung was read: a person's signed GRANT on the book is cited, so the reader can find the decision a change would amend.
  const cited = o.workflows.filter(x => x.grant)
  for (const w of cited) {
    const g = w.grant!
    L.push(`- \`${w.workflow_id}\`: the rung is read from the book of record, GRANT \`${short(g.decision_id)}\` (seq ${g.seq}) signed by ${g.signer_id} at ${g.signed_at}.`)
    if (g.succession) L.push(`  - ${g.succession}.`)
  }
  // D-ANCHOR: a decision whose signer is not anchored is on the book and moves nothing; said, so a rung reads `record` with a reason.
  for (const n of o.grants?.no_effect ?? []) L.push(`- ⚠ ${n.notice}.`)
  for (const d of o.grants?.overridden ?? []) {
    const said = [d.declared.granted !== undefined ? `\`${d.declared.granted}\`` : undefined, d.declared.consequence_tier !== undefined ? `tier '${d.declared.consequence_tier}'` : undefined].filter(Boolean).join(' at ')
    L.push(`- ◇ \`${d.workflow_id}\`: a declaration says ${said}; the GRANT in force (\`${short(d.grant.decision_id)}\`) says \`${d.grant.level}\` at tier '${d.grant.consequence_tier}'. The book governs: a declaration never overrides a person's signed grant.`)
  }
  if (cited.length || o.grants?.overridden.length || o.grants?.no_effect.length) L.push('')
  for (const w of o.workflows.filter(x => x.problem)) L.push(`- ⚠ \`${w.workflow_id}\` could not be weighed: ${w.problem}`)
  if (o.workflows.some(x => x.problem)) L.push('')

  L.push(`### Asking for (${o.asking.length})`, '')
  if (!o.policy) {
    L.push('No promotion policy is declared: Riposte weighs no evidence toward a rung change and proposes nothing. The bars are a business and risk decision, a person\'s to declare; until then every workflow stays where a person put it (`record` by default).', '')
  } else if (o.policy_problem) {
    L.push(`⚠ The declared promotion policy does not lint (${o.policy_problem}): Riposte proposes nothing under it.`, '')
  } else if (!o.book.content_verified) {
    L.push(`⚠ Withheld: the book of record did not verify (${o.book.reason ?? 'content not re-hashed'}). Riposte proposes nothing from evidence it cannot show to be the ledger's.`, '')
  } else if (o.asking.length === 0) {
    const undeclared = o.workflows.filter(w => !w.declared).length
    const why = o.declined.length
      ? `no change the record supports is open: ${o.declined.length === 1 ? 'the one it supports was' : `the ${o.declined.length} it supports were`} declined by a person (below), standing until the evidence changes.`
      : o.standing.length
        ? 'nothing has gone wrong under what a person granted, and no workflow\'s record supports a promotion.'
        : 'no workflow\'s record supports a change from what a person granted.'
    const above = o.standing.length ? ` ${o.standing.length === 1 ? 'One workflow runs' : `${o.standing.length} workflows run`} above what the record yet supports: a standing notice (below), not an ask.` : ''
    L.push(`Riposte is asking for nothing: ${why}${above}${undeclared ? ` ${undeclared} workflow(s) have no declared consequence tier, so their evidence is not weighed; declaring one is a person's call.` : ''}`, '')
  } else {
    o.asking.forEach((p, i) => renderAsk(p, i))
    L.push('')
  }

  if (o.standing.length && o.policy && !o.policy_problem && o.book.content_verified) {
    L.push(`### Granted above the evidence (${o.standing.length})`, '')
    L.push('> A standing notice, not an ask and not an alarm: a person granted these rungs before the record could show them, and nothing has gone wrong. The rung stays as a person set it; the notice clears as reviewed evidence arrives, or when a person steps the rung down.', '')
    o.standing.forEach((p, i) => renderAsk(p, i))
    L.push('')
  }

  function renderAsk(p: OpenProposal, i: number): void {
    // D-UNEVIDENCED: a grant above what the book supports, with nothing gone wrong, is a standing notice, never an alarm.
    const standing = p.kind === 'DEMOTION_PROPOSAL' && p.basis === 'unevidenced'
    const head = standing
      ? `**Granted above the evidence** \`${p.workflow_id}\` at \`${p.from}\`: the record does not yet support it, and nothing has gone wrong (a standing notice, not an alarm; the rung stays as a person set it)`
      : p.urgent ? `**URGENT · step down** \`${p.workflow_id}\`: \`${p.from}\` → \`${p.to}\`` : `**Promotion** \`${p.workflow_id}\`: \`${p.from}\` → \`${p.to}\``
    L.push(`${i + 1}. ${head} · tier '${p.consequence_tier}' · proposal \`${short(p.proposal_id)}\` · opinion \`${short(p.opinion_id)}\` (${p.disposition}, premises ${p.verified ? '✓' : '✗ withheld'})`)
    L.push(`   - Ruling: ${p.ruling}`)
    if (p.decline_lapsed) {
      const d = p.decline_lapsed
      L.push(`   - Asked again: ${d.signer_id} declined this at ${d.signed_at} ("${d.reason}"; decision \`${short(d.decision_id)}\`), and that decline no longer stands: ${d.why}.`)
    }
    if (p.failing_cases.length) {
      L.push(`   - Failing cases (${p.failing_cases.length}), each disputable on its own:`)
      for (const f of p.failing_cases.slice(0, max)) L.push(`     - \`${short(f.verdict_id, 16)}\`: \`${f.dispute}\``)
      if (p.failing_cases.length > max) L.push(`     - … ${p.failing_cases.length - max} more (every one is in the opinion)`)
    }
    if (standing) {
      L.push(`   - Nothing to decide unless a person wants to: let the record catch up, or step the rung down (\`verify grant … --level ${p.to}\`). Read it: \`${p.opinion_command}\``)
    } else if (p.rung_from !== undefined && p.rung_from !== 'declaration') {
      // A rung read from the book is decided on the book: verify grant (a person's yes) or verify decline (their no).
      L.push(`   - ${p.urgent
        ? `Read the opinion, then keep the rung (\`verify decline … --assessment <verify voice --from-book output>\`) or step it down (\`verify grant … --level ${p.to}\`); the decision is a person's`
        : `Read the opinion, then sign (\`verify grant … --level ${p.to} --answers ${p.proposal_id}\`) or decline (\`verify decline … --assessment <verify voice --from-book output>\`; declining costs nothing)`}: \`${p.opinion_command}\``)
    } else {
      L.push(`   - ${p.urgent ? 'Read the opinion; keep the rung or step it down (the decision is a person\'s)' : 'Read the opinion, then sign or decline (declining costs nothing)'}: \`${p.opinion_command}\``)
    }
  }

  if (o.declined.length) {
    L.push(`### Declined, standing until the evidence changes (${o.declined.length})`, '')
    L.push('> A person\'s signed "no" holds a proposal back until the evidence they saw changes. Riposte does not ask again before then, and the decline moves nothing: the rung stays what a person granted.', '')
    o.declined.forEach((d, i) => {
      const x = d.decline
      // D-DECLINED-COPY (design ruling, 2026-09-28): the same words the opinion uses, so the report and the opinion never disagree.
      const head = d.kind === 'DEMOTION_PROPOSAL'
        ? `\`${d.workflow_id}\`: **Kept at \`${d.from}\` by ${x.signer_id}, ${x.signed_at}**; stands until ${x.re_raise_when}`
        : `\`${d.workflow_id}\`: **Not now: ${x.signer_id}, ${x.signed_at}**; re-raises when ${x.re_raise_when}`
      L.push(`${i + 1}. ${head}`)
      L.push(`   - ${d.kind === 'DEMOTION_PROPOSAL' ? `The step down to \`${d.to}\` was declined` : `The promotion \`${d.from}\` → \`${d.to}\` was declined`} · tier '${d.consequence_tier}' · their reason: "${x.reason}" (DECLINE \`${short(x.decision_id)}\`, seq ${x.seq}; it holds back proposal \`${short(x.suppressed_proposal_id)}\`).`)
      L.push(`   - It stands: ${x.why}.`)
      L.push(`   - Opinion \`${short(d.opinion_id)}\` (${d.disposition}, premises ${d.verified ? '✓' : '✗ withheld'}): \`${d.opinion_command}\``)
    })
    L.push('')
  }

  L.push(`### FAIL / INSUFFICIENT_DATA notices, by rung${when ? ` (${when})` : ''}`, '')
  L.push("> Every FAIL and every can't tell (INSUFFICIENT_DATA) is shown with its dispute path at every rung. At `record` and `advise` it is surfaced, not held; at `gate` and `autonomy` it holds the action until a person resolves it.", '')
  if (!o.book.content_verified) L.push(`⚠ Read from a book of record that did not verify (${o.book.reason ?? 'content not re-hashed'}).`, '')
  const unreadNotices = o.notices_unread ?? []
  if (o.notices.length === 0 && unreadNotices.length === 0) {
    L.push(`No FAIL or INSUFFICIENT_DATA on record${when ? ' in the period' : ''}.`, '')
    return L.join('\n')
  }
  const listWorkflow = (w: WorkflowNotices, handled: (n: NoticeRow) => string): void => {
    L.push(`- \`${w.workflow_id}\`: ${w.fail} FAIL · ${w.insufficient_data} INSUFFICIENT_DATA; ${w.open.length} awaiting a person, ${w.resolved} resolved.`)
    for (const n of w.open.slice(0, max)) {
      L.push(`  - ${n.outcome === 'FAIL' ? '✗ FAIL' : '⚠ INSUFFICIENT_DATA'} \`${short(n.verdict_id, 16)}\` · ${n.recorded_at} · ${handled(n)} · ${n.finding}${n.findings > 1 ? ` (+${n.findings - 1} more)` : ''} · dispute: \`${n.dispute}\``)
    }
    if (w.open.length > max) L.push(`  - … ${w.open.length - max} more awaiting a person`)
  }
  for (const r of o.notices) {
    L.push(`#### \`${r.level}\`: ${HANDLING_WORDS[r.level]}`, '')
    for (const w of r.workflows) listWorkflow(w, n => (n.action === 'HOLD' ? 'HELD' : 'surfaced'))
    L.push('')
  }
  if (unreadNotices.length) {
    L.push('#### rung unread: the book of record did not verify, so whether each is held cannot be read from it', '')
    for (const w of unreadNotices) listWorkflow(w, () => 'rung unread')
    L.push('')
  }
  return L.join('\n')
}

export function renderTenantReport(ledger: Ledger, opts: TenantReportOptions = {}): string {
  const stats = ledger.stats(opts.tenant_id)
  const reviewed = ledger.query(opts.tenant_id !== undefined ? { tenant_id: opts.tenant_id, reviewed: true } : { reviewed: true })
  const cal = ruleCalibration(reviewed, opts.calibration)
  const chain = ledger.verifyContent()
  const pct = (x: number): string => `${(x * 100).toFixed(1)}%`

  const lines: string[] = []
  lines.push(`# Verification book of record${opts.tenant_id ? ` — tenant \`${opts.tenant_id}\`` : ''}`)
  if (opts.as_of) lines.push('', `_As of ${opts.as_of}._`)

  lines.push(
    '',
    '## Volume',
    '',
    `- Verdicts on record: **${stats.total}** — ${stats.by_outcome.PASS} PASS · ${stats.by_outcome.FAIL} FAIL · ${stats.by_outcome.INSUFFICIENT_DATA} can't-tell.`,
    `- Human-reviewed: **${stats.reviewed}**.`,
    '',
    '## Real-world accuracy',
    '',
    '> The number that matters most: measured on verdicts a human actually reviewed, not synthetic tests.',
    '',
    stats.reviewed > 0
      ? `- **Human-overturn rate: ${pct(stats.overturn_rate)}** — ${stats.overturned} overturned of ${stats.reviewed} reviewed (${stats.upheld} upheld).`
      : '- **Human-overturn rate: —** (no reviewed verdicts yet).',
    '',
    renderCalibration(cal),
    renderOpinionsSection(tenantOpinions(ledger, opts), opts.max_notices !== undefined ? { max_notices: opts.max_notices } : {}),
    '## Tamper-evidence',
    '',
    chain.ok
      // P-F (ledger-scale): what was verified, said from the chain alone (never a wall-clock time or whether a cached prefix
      // was reused), so the same book renders byte-identically.
      ? `- Chain intact across **${chain.length}** events. Anchor to notarize (head hash): \`${chain.head}\`.${chain.length > 0 ? ` Content verified through seq ${chain.length - 1}.` : ''}`
      : `- ⚠ **Chain integrity FAILED** at event ${chain.brokenAt}: ${chain.reason}. Head: \`${chain.head}\`.`,
    '',
  )
  return lines.join('\n')
}
