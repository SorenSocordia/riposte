/**
 * JSON adapters for the earned-voice, opinion and structured-twin surfaces, shared by the HTTP router / managed service
 * and the MCP server. They turn JSON arguments into exactly the calls the CLI makes (`verify voice`, `verify opinion`,
 * `verify twin`) and add no logic of their own: the rung, the proposal, the opinion and the twin verdict are what
 * src/verdict/voice.ts, src/opinion/ and src/twin/ produce. Pure and deterministic (a twin verdict's `issued_at` is its
 * only clock, as everywhere).
 *
 * Two laws carried through unchanged:
 *   - the rung is ALWAYS what a person granted. A surface reports it and any open proposal; nothing here changes it.
 *   - an opinion is COUNSEL: generated, dismissible, never a VERDICT. It proposes; a person decides.
 *
 * BOOK FIRST (2026-09-28): a surface given the book (BookSettings, or `from_book` on voice_assess) reads the rung from the
 * GRANT in force, a person's signed decision, and never from a flag; a book that does not verify grants nothing and is
 * refused. D-ANCHOR: only an anchored signer's decision moves a rung. A chain export carries no anchors of its own, so the
 * surfaces that take one (voice_assess, opinion_render, POST /v1/opinion) accept `trusted_keys` / `root_keys`, and an
 * unanchored decision is said out loud (`no_effect`, and the note), never silently read as record.
 *
 * The action check (`action_check` / POST /v1/action/check) returns what one proposed tool call gets at a rung: the
 * verify_action verdict, its notice, and the disposition the hold adapters deliver.
 */

import {
  assessVoice, workflowCalibration, lintPolicy, policyRef, VOICE_LADDER, ACTION_HANDLING,
  type ActionHandling, type Grant, type PolicyRef, type PromotionPolicy, type VoiceAssessment, type VoiceLevel, type VoiceProposal,
  type WorkflowCalibrationOptions, type WorkflowDeclaration, type BookDeclaration,
} from '../verdict/voice.js'
import { actionNotice, renderActionNotice, type ActionNotice } from '../verdict/notices.js'
import { verifyAction, type ActionSources, type ProposedAction } from '../action/index.js'
import { fieldsProblem } from '../action/equivalence.js'
import { hashOf } from '../verdict/canonical.js'
import type { Verdict } from '../verdict/schema.js'
import {
  promotionOpinion, disputeOpinion, renderOpinion, snapshotFromChainJSONL, openSnapshot,
  type LedgerSnapshot, type Opinion, type SnapshotView, type OpinionScope,
} from '../opinion/index.js'
import {
  verifyAgainstTwin, parseTwinPresentation, FS_CORE_TWIN_MAP, FS_CORE_TWIN_MAP_V02, FS_CORE_TWIN_MAP_V021,
  type TwinClaim, type TwinOptions, type TwinResult,
} from '../twin/index.js'
import {
  reconcileCompleteness, renderCompletenessReport, readPopulation, populationFromRows, PopulationRefused, CompletenessRefused,
  type CompletenessMapping, type CompletenessOptions, type CompletenessReport, type Population, type CsvDelimiter, type BookChain,
} from '../reconcile/completeness/index.js'
import type { LedgerEvent } from '../ledger/chain.js'
import { grantInForce, type DecisionEntry, type GrantDecision, type NoEffect, type TrustedKeys } from '../ledger/decisions.js'
import { governedRead, governing } from './dual.js'
import type { RootKeys } from '../ledger/registry.js'
import { isBookSettings, readVoiceBook, bookRefusal, type BookSettings } from '../ledger/report.js'
import type { EvidenceCitation } from '../surveillance/evidence.js'
import { reviewQueue, type QueueItem } from '../surveillance/plan.js'
import type { Ledger } from '../ledger/types.js'

export { isBookSettings, type BookSettings }

/** A caller's input is wrong or incomplete (HTTP 400; an MCP tool error). Anything else is an internal error. */
export class SurfaceInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SurfaceInputError'
  }
}

const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x)
const optString = (a: Record<string, unknown>, key: string): string | undefined => {
  const v = a[key]
  if (v === undefined) return undefined
  if (typeof v !== 'string') throw new SurfaceInputError(`"${key}" must be a string`)
  return v
}

/** The keys that declare a workflow's settings (a person's decisions). */
export const DECLARATION_KEYS = ['consequence_tier', 'granted', 'grant', 'bounds'] as const

/** A workflow's settings without its id (the id is the key they are looked up by). */
export type WorkflowSettings = Omit<WorkflowDeclaration, 'workflow_id'>

// ── the book of record ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The book of record from JSON: the chain export as a string (`ledger.chainJSONL()`, one event per line with its payload),
 * or `{ events, payloads }`. Only a chain is accepted: records without one cannot be shown to be the ledger's, and every
 * premise resting on them would be unverified.
 */
export function snapshotFromJson(x: unknown, key = 'ledger'): LedgerSnapshot {
  if (typeof x === 'string') {
    try {
      return snapshotFromChainJSONL(x)
    } catch (e) {
      throw new SurfaceInputError(`"${key}" is not a chain export (one JSON event per line, each with its payload): ${(e as Error).message}`)
    }
  }
  if (isObj(x) && Array.isArray(x.events)) {
    if (!Array.isArray(x.payloads)) throw new SurfaceInputError(`"${key}" carries events without their payloads: the chain's content cannot be verified without them`)
    return { events: x.events as LedgerEvent[], payloads: x.payloads }
  }
  throw new SurfaceInputError(`"${key}" is required: the book of record as the chain export (ledger.chainJSONL()) string, or { events, payloads }`)
}

/** The chain status a surface reports alongside anything it read from the book. */
export interface BookStatus {
  /** 'chain' = records rebuilt from the chain's payloads; 'records' = no usable chain. */
  source: 'chain' | 'records'
  /** True only when every link and every payload re-hashed. */
  content_verified: boolean
  length: number
  head: string | null
  broken_at?: number
  reason?: string
}

export function bookStatus(view: SnapshotView): BookStatus {
  const c = view.chain
  return {
    source: view.source,
    content_verified: view.content_verified,
    length: c?.length ?? 0,
    head: c?.head ?? null,
    ...(c && !c.ok ? { broken_at: c.brokenAt, reason: c.reason } : {}),
    ...(c && c.ok && !view.content_verified ? { reason: 'the chain links are intact but the payloads were not supplied, so the content was not re-hashed' } : {}),
  }
}

// ── the policy and the workflow's declared settings ──────────────────────────────────────────────────────────────────

/** The declared promotion policy, linted. There is no default: the bars are a business and risk decision. */
export function policyFromJson(x: unknown): PromotionPolicy {
  if (!isObj(x)) throw new SurfaceInputError('"policy" is required: the declared promotion policy (promotion-policy-v0). The bars are a business and risk decision; there is no default')
  const p = x as unknown as PromotionPolicy
  const lint = lintPolicy(p)
  if (!lint.ok) throw new SurfaceInputError(`the promotion policy does not lint: ${lint.errors.join('; ')}`)
  return p
}

/** True when the arguments carry any declared setting (tier, rung, grant, bounds). */
export const hasDeclarationArgs = (a: Record<string, unknown>): boolean => DECLARATION_KEYS.some(k => a[k] !== undefined)

/** The workflow's declaration from JSON arguments (the CLI's `--workflow --tier --granted --grant --bounds`, as JSON). */
export function declarationFromJson(a: Record<string, unknown>): WorkflowDeclaration {
  const workflow_id = optString(a, 'workflow_id')
  if (!workflow_id) throw new SurfaceInputError('"workflow_id" is required (tenant/ruleset@version, e.g. "acme/invoice@0.0.1")')
  let grant: Grant | undefined
  if (a.grant !== undefined) {
    if (!isObj(a.grant)) throw new SurfaceInputError('"grant" must be the person\'s grant record {level, signer_id, signed_at, policy, consequence_tier}')
    grant = a.grant as unknown as Grant
  }
  const tier = optString(a, 'consequence_tier') ?? grant?.consequence_tier
  if (!tier) throw new SurfaceInputError('"consequence_tier" is required (a tier declared in the policy), or a "grant" that names one')
  const granted = (optString(a, 'granted') ?? grant?.level ?? 'record') as VoiceLevel
  if (!VOICE_LADDER.includes(granted)) throw new SurfaceInputError(`"granted" must be one of ${VOICE_LADDER.join(', ')}`)
  const bounds = optString(a, 'bounds')
  return { workflow_id, consequence_tier: tier, granted, ...(bounds !== undefined ? { bounds } : {}), ...(grant ? { grant } : {}) }
}

// ── voice: the current rung and any open proposal ────────────────────────────────────────────────────────────────────

export interface VoiceSurface {
  surface_version: 'voice-surface-v0'
  workflow_id: string
  /** The effective rung: ALWAYS what a person granted. Nothing here changes it. */
  level: VoiceLevel
  granted: VoiceLevel
  /** What the evidence supports, or null when there is nothing to weigh it against (no declared policy or settings). */
  earned: VoiceLevel | null
  /** Whether a person's settings (consequence tier, rung) are declared for this workflow. Undeclared = `record`. */
  declared: boolean
  /** How one action is handled at the effective rung. Every FAIL is shown with its evidence and can be disputed. */
  handling: ActionHandling
  /** The open proposal for a person to sign or decline: a promotion, or an URGENT demotion. Never applied here. */
  open_proposal: VoiceProposal | null
  /**
   * The open demotion's basis (DECISION D-UNEVIDENCED; `open_proposal.basis`): 'failure' is evidence OF failure (urgent),
   * 'unevidenced' a grant above what the book supports with nothing gone wrong (a standing notice). Null otherwise.
   */
  basis: 'failure' | 'unevidenced' | null
  /**
   * The evidence audit behind the assessment, read from the book (`assessment.book.evidence`, surveillance/evidence.ts):
   * what was drawn, what counts, what was set aside and why, surveillance findings, canaries, who the evidence rests on.
   * Present when the rung is read from the book and the tier declares sampling or evidence requirements (or the book carries
   * canaries for the workflow); null otherwise (a declared rung has no book to audit).
   */
  evidence: EvidenceCitation | null
  book: BookStatus
  /** True when the evidence was read from a content-verified chain. False: nothing is proposed from it. */
  verified: boolean
  /**
   * Decisions for this workflow on the book whose signer is not anchored (D-ANCHOR): each is on the book and has NO effect,
   * with its notice ("… is not anchored: it has no effect …; anchor the signer with --trusted-keys / --root-keys"). The note
   * repeats them. Empty when the rung is declared (no book is read) or every signer is anchored.
   */
  no_effect: NoEffect[]
  /** Why there is no assessment, or why its proposal is withheld; and any decision on the book that has no effect. */
  note?: string
  /** The full assessment (every rung's bound, the blockers), when one was made. */
  assessment: VoiceAssessment | null
}

/**
 * A workflow's voice from the book of record: the rung a person granted and any open proposal. `settings` and `policy`
 * are a person's declarations; without them the workflow is at `record` (the day-1 default) and nothing is weighed.
 * A proposal is withheld when the book's content does not verify. Throws on settings the policy refuses (a tier the
 * policy does not declare, a grant made under other settings): those are a person's to correct.
 *
 * BOOK FIRST: `settings` may be the book itself ({ book, consequence_tier?, trusted_keys? }). The rung, tier, bounds and
 * policy version are then the GRANT in force (assessVoice reads and re-verifies it, cites it in `assessment.book`, and
 * holds back a proposal a person declined); `consequence_tier` only while nothing is granted. A book that does not verify
 * grants nothing: it is refused (throws), never read as `record`.
 */
export function voiceSurface(
  view: SnapshotView, workflow_id: string, settings: WorkflowSettings | BookSettings | undefined, policy: PromotionPolicy | undefined,
  calibration: WorkflowCalibrationOptions = {},
): VoiceSurface {
  const book = bookStatus(view)
  let granted: VoiceLevel = 'record'
  let declared = settings !== undefined
  let inert: NoEffect[] = []
  if (isBookSettings(settings)) {
    const db = readVoiceBook(settings.book, settings.trusted_keys, settings.root_keys)
    if (!db.ok) throw new Error(bookRefusal(db))
    // D-DUAL, D-GOVERNING-POLICY: with the policy in hand it governs every grant, whatever policy the grant names (./dual.ts):
    // one it does not admit (a pending autonomy grant, a tier it does not declare) has no effect and is listed in no_effect.
    const gov = governedRead(db, policy)
    const g = grantInForce(db.decisions, workflow_id, governing(policy))
    granted = g?.signed.decision.level ?? 'record'
    declared = g !== undefined || settings.consequence_tier !== undefined
    inert = gov.no_effect({ workflow_id })
  } else if (settings) {
    granted = settings.granted
  }
  // D-ANCHOR: an unanchored GRANT or DECLINE is said, never silently read as record.
  const withInert = (note?: string): { note?: string } => {
    const said = inert.length ? `${inert.map(n => n.notice).join('; ')}.` : undefined
    const all = [note, said].filter((x): x is string => !!x).join(' ')
    return all ? { note: all } : {}
  }
  const base = {
    surface_version: 'voice-surface-v0' as const, workflow_id, level: granted, granted, declared,
    handling: ACTION_HANDLING[granted], book, verified: view.content_verified, basis: null, evidence: null, no_effect: inert,
  }
  if (!settings || !declared || !policy) {
    const note = !settings
      ? 'No person has declared settings for this workflow (a consequence tier and a rung): it is at `record`, the day-1 default, and Riposte weighs nothing toward a change. Declare a tier to have it weigh the evidence.'
      : !declared
        ? 'Nothing is granted on the book of record for this workflow (no signed GRANT), and no consequence tier is declared: it is at `record`, the day-1 default, and Riposte weighs nothing toward a change. Declare a tier to have it weigh the evidence; only a person\'s signed GRANT moves the rung.'
        : 'No promotion policy is declared: Riposte weighs no evidence toward a rung change and proposes nothing. The bars are a business and risk decision.'
    return { ...base, earned: null, open_proposal: null, ...withInert(note), assessment: null }
  }
  const decl: WorkflowDeclaration | BookDeclaration = { ...settings, workflow_id }
  const assessment = assessVoice(workflowCalibration(view.records, workflow_id, calibration), decl, policy)
  const evidence = assessment.book?.evidence ?? null
  if (!view.content_verified) {
    return {
      ...base, evidence, earned: assessment.earned, open_proposal: null, assessment,
      ...withInert(`Withheld: the book of record did not verify (${book.reason ?? 'no chain'}). Nothing is proposed from evidence that cannot be shown to be the ledger's.`),
    }
  }
  const p = assessment.proposal
  // D-UNEVIDENCED: a grant above what the book supports, with nothing gone wrong, is said plainly, never as an alarm.
  const unevidenced = p?.kind === 'DEMOTION_PROPOSAL' && p.basis === 'unevidenced'
    ? `A standing notice, not an alarm: a person granted \`${granted}\` above what the book of record supports, and nothing has gone wrong (open_proposal.basis is unevidenced). The rung stays as a person set it; a person may step it down, or let the record catch up.`
    : undefined
  const basis = p?.kind === 'DEMOTION_PROPOSAL' ? p.basis : null
  return { ...base, basis, evidence, earned: assessment.earned, open_proposal: p ?? null, ...withInert(unevidenced), assessment }
}

/**
 * voice_assess: the voice surface from JSON arguments (ledger, policy, workflow_id and the declared settings). With
 * `from_book: true` the rung is READ FROM THE BOOK (the chain's GRANT in force; the CLI's `verify voice --from-book`):
 * `granted`, `grant` and `bounds` are refused (a flag never overrides a person's signed grant), `consequence_tier` is taken
 * only while nothing is granted, and `trusted_keys` anchors the signers.
 */
export function voiceFromJson(a: Record<string, unknown>): VoiceSurface {
  const snapshot = snapshotFromJson(a.ledger)
  const policy = policyFromJson(a.policy)
  if (a.from_book !== undefined && typeof a.from_book !== 'boolean') throw new SurfaceInputError('"from_book" must be true or false')
  if (a.from_book === true) {
    const flags = (['granted', 'grant', 'bounds'] as const).filter(k => a[k] !== undefined)
    if (flags.length) {
      throw new SurfaceInputError(`"from_book" reads the rung, tier and bounds from the GRANT in force on the book, so ${flags.map(k => `"${k}"`).join(', ')} cannot be passed with it (a flag never overrides a person's signed grant)`)
    }
    const workflow_id = optString(a, 'workflow_id')
    if (!workflow_id) throw new SurfaceInputError('"workflow_id" is required (tenant/ruleset@version, e.g. "acme/invoice@0.0.1")')
    const tier = optString(a, 'consequence_tier')
    const anchors = anchorsFromJson(a)
    const { events, payloads } = snapshot
    if (!events || !payloads) throw new SurfaceInputError('"from_book" needs the chain export with its payloads: the decisions on the book are verified from them')
    const settings: BookSettings = { book: { events, payloads }, ...(tier !== undefined ? { consequence_tier: tier } : {}), ...anchors }
    try {
      return voiceSurface(openSnapshot(snapshot, anchors), workflow_id, settings, policy)
    } catch (e) {
      throw new SurfaceInputError((e as Error).message)
    }
  }
  if (a.trusted_keys !== undefined || a.root_keys !== undefined) {
    // Refused rather than ignored: the declared (flag) path reads no decision off the book, so there is nothing to anchor.
    throw new SurfaceInputError('"trusted_keys" / "root_keys" anchor the signers of the decisions on the book, which only "from_book": true reads; the declared settings path reads none')
  }
  const decl = declarationFromJson(a)
  const { workflow_id, ...settings } = decl
  try {
    return voiceSurface(openSnapshot(snapshot), workflow_id, settings, policy)
  } catch (e) {
    throw new SurfaceInputError((e as Error).message)
  }
}

/** The root public key(s) from JSON: one SPKI PEM, or an array of them (the key registry on the book is read under them). */
export function rootKeysFromJson(x: unknown): RootKeys {
  if (typeof x === 'string' && x) return [x]
  if (Array.isArray(x) && x.length > 0 && x.every(k => typeof k === 'string' && k)) return x as string[]
  throw new SurfaceInputError('"root_keys" must be the root public key (PEM), or an array of them')
}

/** A chain export's anchors from JSON arguments (`trusted_keys`, `root_keys`), each only when given (D-ANCHOR). */
export function anchorsFromJson(a: Record<string, unknown>): { trusted_keys?: TrustedKeys; root_keys?: RootKeys } {
  return {
    ...(a.trusted_keys !== undefined ? { trusted_keys: trustedKeysFromJson(a.trusted_keys) } : {}),
    ...(a.root_keys !== undefined ? { root_keys: rootKeysFromJson(a.root_keys) } : {}),
  }
}

/** Trusted keys from JSON: { "<signer_id>": "<SPKI PEM>" | ["<PEM>", ...] }. */
export function trustedKeysFromJson(x: unknown): TrustedKeys {
  if (!isObj(x)) throw new SurfaceInputError('"trusted_keys" must be { "<signer_id>": "<public key PEM>" | ["<PEM>", ...] }')
  for (const [id, k] of Object.entries(x)) {
    if (!(typeof k === 'string' || (Array.isArray(k) && k.every(p => typeof p === 'string')))) throw new SurfaceInputError(`"trusted_keys.${id}" must be a public key PEM or an array of them`)
  }
  return x as TrustedKeys
}

/**
 * The settings on record for a workflow whose rung is a GRANT on the book, in the declared-settings shape (the grant
 * record included), so a request can be held to them: a request may restate the grant, never change it.
 */
export function grantSettings(g: DecisionEntry<GrantDecision>): WorkflowSettings {
  const d = g.signed.decision
  return {
    consequence_tier: d.consequence_tier, granted: d.level, ...(d.bounds !== undefined ? { bounds: d.bounds } : {}),
    grant: { level: d.level, signer_id: d.signer_id, signed_at: d.signed_at, policy: { ...d.policy }, consequence_tier: d.consequence_tier, ...(d.note !== undefined ? { note: d.note } : {}) },
  }
}

// ── the reviewer's queue ─────────────────────────────────────────────────────────────────────────────────────────────

export interface ReviewQueueSurface {
  surface_version: 'review-queue-v0'
  workflow_id: string
  /** The policy the draw rates come from (the grant's, when a GRANT is in force), or null when none is declared. */
  policy: PolicyRef | null
  /** The tier the draw rates follow: the GRANT in force's, else the declared one. Absent: nothing is drawn. */
  consequence_tier?: string
  /** Every drawn item not yet reviewed, oldest period first, each with its deadline (surveillance/plan.ts reviewQueue). */
  items: QueueItem[]
  count: number
  /** Why nothing can be drawn (no policy, no tier, a tier without a sampling plan), in words. */
  note?: string
}

/**
 * The reviewer's queue for a workflow on a book of record: every drawn (random, chain-seeded) item not yet reviewed, with
 * the rung in force when its period closed and the date it is due by. The draws and the queue are the surveillance module's
 * (reviewQueue), read here unchanged. The tier is the GRANT in force's, else `consequence_tier`; with neither (or no policy)
 * nothing is drawn and the surface says so. Throws when the book does not verify (no draw is read from a broken book) and on
 * settings the policy refuses (a tier it does not declare, a grant made under another policy).
 */
export function reviewQueueSurface(ledger: Ledger, workflow_id: string, policy: PromotionPolicy | undefined, consequence_tier?: string): ReviewQueueSurface {
  const base = { surface_version: 'review-queue-v0' as const, workflow_id }
  const empty = (note: string, tier?: string): ReviewQueueSurface => ({
    ...base, policy: policy ? policyRef(policy) : null, ...(tier !== undefined ? { consequence_tier: tier } : {}), items: [], count: 0, note,
  })
  const db = ledger.decisionBook()
  if (!db.ok) throw new Error(bookRefusal(db))
  if (!policy) return empty('No promotion policy is declared: no sampling plan, so nothing is drawn for review. The bars and the draw rates are a business and risk decision.')
  const g = grantInForce(db.decisions, workflow_id, governing(policy))
  const tier = g?.signed.decision.consequence_tier ?? consequence_tier
  if (tier === undefined) {
    return empty('Nothing is granted on the book for this workflow and no consequence tier is declared: the draw rates follow the tier, so nothing is drawn. Declaring a tier is a person\'s call.')
  }
  const t = policy.tiers.find(x => x.tier === tier)
  if (t && !t.sampling) return empty(`Tier '${tier}' of ${policy.policy_id}@${policy.version} declares no sampling plan: nothing is drawn for review.`, tier)
  const items = reviewQueue(ledger, workflow_id, policy, g ? {} : { consequence_tier: tier })
  return { ...base, policy: policyRef(policy), consequence_tier: tier, items, count: items.length }
}

// ── the action check: one proposed tool call at a rung ───────────────────────────────────────────────────────────────

/**
 * What one proposed tool call gets at a rung, in the hold adapters' vocabulary (products/adapters dispositionOf):
 *   hold     a FAIL or ABSTAIN at gate/autonomy: the action waits until a person resolves it
 *   review   a PASS at gate: a person reviews it before it runs
 *   surface  a FAIL or ABSTAIN at advise: shown in-flow to the person and the agent; not held
 *   record   a FAIL or ABSTAIN at record: a notice on the record; not held
 *   proceed  a PASS at record/advise (Riposte does not intervene), or at autonomy (within the declared bounds)
 */
export type ActionDisposition = 'hold' | 'review' | 'surface' | 'record' | 'proceed'

/** The disposition of an action notice. The notice is never softer than its all-deterministic verdict (notices.ts). */
export function actionDisposition(n: ActionNotice): ActionDisposition {
  if (n.action === 'HOLD') return 'hold'
  if (n.action === 'SURFACE') return n.handling.delivery === 'in-flow' ? 'surface' : 'record'
  return n.handling.PASS === 'HUMAN_REVIEW' ? 'review' : 'proceed'
}

export interface ActionCheckSurface {
  surface_version: 'action-check-v0'
  tool: string
  /** The rung the call is handled at. */
  level: VoiceLevel
  /**
   * Where the rung came from: `request` (the caller's, stateless), `default` (none given: record, the day-1 default),
   * `grant` (a person's signed GRANT on the book, managed tier), `declaration` (the deployment's declared settings), or
   * `none` (managed tier: nothing granted or declared for the workflow, so record).
   */
  level_source: 'request' | 'default' | 'grant' | 'declaration' | 'none'
  /** The workflow whose rung was read (managed tier), when one was named. */
  workflow_id?: string
  disposition: ActionDisposition
  /** True when the call waits for a person (hold or review). */
  holds: boolean
  /** hashOf({ tool, arguments }): identifies this exact call. */
  call_hash: string
  /** The verify_action verdict (a standard, replayable VERDICT; the managed tier records it like any other). */
  verdict: Verdict
  /** Every FAIL and ABSTAIN with its evidence and its own dispute path, and the handling at this rung. */
  notice: ActionNotice
  /** The notice as Markdown. */
  notice_markdown: string
  /**
   * Managed tier: decisions for the workflow on the book with NO effect on its rung, each with its notice: a GRANT still
   * PENDING a second signature (D-DUAL: `pending: { required, signed_by }`), or an unanchored one (D-ANCHOR). Present only
   * when there are any.
   */
  no_effect?: NoEffect[]
  /**
   * Managed tier: what the reader should know about the grant in force, e.g. that it names another policy and is judged under
   * the deployment's governing one (D-GOVERNING-POLICY). Present only when there are any.
   */
  notices?: string[]
}

const isScalarValue = (x: unknown): boolean => typeof x === 'string' || typeof x === 'number'

/**
 * Why `x` is not a usable list of approved records (verify_action's record-bound grounding), or undefined. Refused rather
 * than guessed: an empty list, an empty record, a non-scalar value, or records that name different arguments (a record
 * missing an argument the others name could never ground it, so every action would silently abstain).
 */
export function recordsProblem(x: unknown): string | undefined {
  if (!Array.isArray(x) || x.length === 0) return 'must be a non-empty array of approved records, each { <argument>: <approved value> } (values approved together)'
  let names: string | undefined
  for (const [i, r] of x.entries()) {
    if (!isObj(r) || Object.keys(r).length === 0) return `[${i}] must be a non-empty object: { <argument>: <approved value> }`
    const bad = Object.entries(r).find(([, v]) => !isScalarValue(v))
    if (bad) return `[${i}].${bad[0]} must be a string or a number (an approved value)`
    const these = Object.keys(r).sort().join(', ')
    if (names === undefined) names = these
    else if (these !== names) return `[${i}] names ${these}, but [0] names ${names}: every record must name the same arguments`
  }
  return undefined
}

/** The proposed call and its declared sources from JSON (the MCP verify_action arguments), validated. */
export function actionFromJson(a: Record<string, unknown>): { action: ProposedAction; sources: ActionSources } {
  const act = a.action
  if (!isObj(act) || typeof act.tool !== 'string' || !act.tool) throw new SurfaceInputError('"action" is required: { tool, arguments } (the proposed tool call)')
  if (act.arguments !== undefined && !isObj(act.arguments)) throw new SurfaceInputError('"action.arguments" must be an object (the proposed arguments)')
  const sources: ActionSources = {}
  if (a.sources !== undefined) {
    const s = a.sources
    if (!isObj(s)) throw new SurfaceInputError('"sources" must be { text?, allowed?, records?, require?, fields? } (what counts as an approved source)')
    if (s.text !== undefined) {
      if (typeof s.text !== 'string') throw new SurfaceInputError('"sources.text" must be a string (the source document the agent read)')
      sources.text = s.text
    }
    if (s.allowed !== undefined) {
      if (!isObj(s.allowed)) throw new SurfaceInputError('"sources.allowed" must be { <argument>: [approved values] }')
      for (const [k, v] of Object.entries(s.allowed)) {
        if (!Array.isArray(v) || !v.every(isScalarValue)) throw new SurfaceInputError(`"sources.allowed.${k}" must be an array of approved values (strings or numbers)`)
      }
      sources.allowed = s.allowed as Record<string, (string | number)[]>
    }
    if (s.records !== undefined) {
      const problem = recordsProblem(s.records)
      if (problem) throw new SurfaceInputError(`"sources.records" ${problem}`)
      sources.records = s.records as Record<string, string | number>[]
    }
    if (s.require !== undefined) {
      if (!Array.isArray(s.require) || !s.require.every(x => typeof x === 'string')) throw new SurfaceInputError('"sources.require" must be an array of argument names')
      sources.require = s.require as string[]
    }
    if (s.fields !== undefined) {
      const problem = fieldsProblem(s.fields)
      if (problem) throw new SurfaceInputError(`"sources.fields" ${problem}`)
      sources.fields = s.fields as ActionSources['fields']
    }
  }
  return { action: { tool: act.tool, arguments: (act.arguments ?? {}) as Record<string, unknown> }, sources }
}

/** A rung from JSON, or undefined when absent. */
export function levelFromJson(x: unknown, key = 'level'): VoiceLevel | undefined {
  if (x === undefined) return undefined
  if (typeof x !== 'string' || !VOICE_LADDER.includes(x as VoiceLevel)) throw new SurfaceInputError(`"${key}" must be one of ${VOICE_LADDER.join(', ')}`)
  return x as VoiceLevel
}

/**
 * action_check / POST /v1/action/check: one proposed tool call and its declared sources at a rung → the verify_action
 * verdict, its notice (every FAIL/ABSTAIN with evidence and a dispute path) and the disposition. Stateless: the rung is the
 * request's `level` (default record, the day-1 default). The managed tier reads it from the book instead when a workflow is
 * named (`resolved`). Deterministic but for the verdict's issued_at.
 */
export function actionCheckFromJson(
  a: Record<string, unknown>,
  opts: { now?: () => Date; resolved?: { level: VoiceLevel; source: ActionCheckSurface['level_source']; workflow_id: string; no_effect?: NoEffect[]; notices?: string[] } } = {},
): ActionCheckSurface {
  if (!opts.resolved && a.workflow_id !== undefined) {
    // Refused rather than ignored: a caller naming a workflow expects its rung on the book, which only a book can give.
    throw new SurfaceInputError('"workflow_id" reads the rung from a book of record, which is the managed tier\'s (createService({ ledger }): POST /v1/action/check). Stateless, pass the rung a person granted as "level"')
  }
  const { action, sources } = actionFromJson(a)
  const asked = levelFromJson(a.level)
  const level: VoiceLevel = opts.resolved?.level ?? asked ?? 'record'
  const level_source: ActionCheckSurface['level_source'] = opts.resolved?.source ?? (asked !== undefined ? 'request' : 'default')
  const verdict = verifyAction(action, sources, opts.now ? { now: opts.now } : {})
  const notice = actionNotice(verdict, level)
  const disposition = actionDisposition(notice)
  return {
    surface_version: 'action-check-v0', tool: action.tool, level, level_source,
    ...(opts.resolved ? { workflow_id: opts.resolved.workflow_id } : {}),
    disposition, holds: disposition === 'hold' || disposition === 'review',
    call_hash: hashOf({ tool: action.tool, arguments: action.arguments }),
    verdict, notice, notice_markdown: renderActionNotice(notice),
    ...(opts.resolved?.no_effect?.length ? { no_effect: opts.resolved.no_effect } : {}),
    ...(opts.resolved?.notices?.length ? { notices: opts.resolved.notices } : {}),
  }
}

// ── opinions ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface OpinionSurface {
  /** The source of truth (COUNSEL). Its id re-derives from its content. */
  opinion: Opinion
  /** Its reading copy, under the opinion's headings. */
  markdown: string
}

export interface OpinionContext {
  /** The book of record when the arguments carry none (the managed tier's tenant ledger). */
  snapshot?: LedgerSnapshot
  /** The declared policy when the arguments carry none. */
  policy?: PromotionPolicy
  /** The workflow's declared settings when the arguments carry none. */
  settings?: (workflow_id: string) => WorkflowSettings | undefined
  /** How records map to workflows (the managed tier scopes it to the tenant). */
  calibration?: WorkflowCalibrationOptions
  /**
   * Read one tenant's records and decisions only (a shared book; the managed tier sets it from the caller's identity). The
   * chain is still verified whole; precedent, evidence and grants are the tenant's (opinion/snapshot.ts). A request's own
   * `tenant_id` may restate it, never change it.
   */
  scope?: OpinionScope
}

/**
 * opinion_render / POST /v1/opinion: the courtroom opinion from JSON arguments. One question per opinion:
 *   { dispute: { verdict_id, claim_id? }, inputs? }                 a dispute of one recorded verdict
 *   { policy, proposal }                                              argue a proposal (it must be what the evidence produces)
 *   { policy, workflow_id, consequence_tier, granted | grant, bounds? }   argue whatever the evidence poses
 *   { policy, workflow_id, from_book: true, consequence_tier? }       the rung read from the book (verify opinion --from-book)
 * A chain export's decisions move a rung only under `trusted_keys` / `root_keys` (D-ANCHOR); the opinion names any that don't.
 */
export function opinionFromJson(a: Record<string, unknown>, ctx: OpinionContext = {}): OpinionSurface {
  const snapshot = a.ledger !== undefined ? snapshotFromJson(a.ledger) : ctx.snapshot
  if (!snapshot) throw new SurfaceInputError('"ledger" is required: the book of record as the chain export (ledger.chainJSONL()) string, or { events, payloads }')
  // The tenant scope: the context's (the managed tier's caller), else the request's own `tenant_id` (a stateless caller
  // reading one tenant of a shared chain export). A request may restate the context's tenant, never change it.
  const asked = optString(a, 'tenant_id')
  if (asked !== undefined && !asked) throw new SurfaceInputError('"tenant_id" must be a tenant id')
  if (ctx.scope && asked !== undefined && asked !== ctx.scope.tenant_id) {
    throw new SurfaceInputError(`"tenant_id" is the caller's own here (${ctx.scope.tenant_id}); an opinion is never read under another tenant's scope`)
  }
  const scope: OpinionScope | undefined = ctx.scope ?? (asked !== undefined ? { tenant_id: asked } : undefined)
  // D-ANCHOR: a chain export carries no anchors, so its decisions move nothing unless the caller anchors their signers. A
  // book the context supplies (the managed tier's own ledger) carries its ledger's anchors, and a request never adds its own.
  const anchors = anchorsFromJson(a)
  if (a.ledger === undefined && (anchors.trusted_keys || anchors.root_keys)) {
    throw new SurfaceInputError('"trusted_keys" / "root_keys" anchor the signers of a chain export you supply as "ledger"; the book read here carries its own anchors, and a request never adds to them')
  }
  const scoped = { ...(scope ? { scope } : {}), ...anchors }
  let opinion: Opinion
  if (a.dispute !== undefined) {
    if (a.proposal !== undefined || a.workflow_id !== undefined || a.from_book !== undefined || hasDeclarationArgs(a)) {
      throw new SurfaceInputError('one question per opinion: a "dispute", or a voice question (a "proposal", or a "workflow_id" and its settings), not both')
    }
    const d = a.dispute
    if (!isObj(d) || typeof d.verdict_id !== 'string' || !d.verdict_id) throw new SurfaceInputError('"dispute" must be { verdict_id, claim_id? }')
    if (d.claim_id !== undefined && typeof d.claim_id !== 'string') throw new SurfaceInputError('"dispute.claim_id" must be a string')
    try {
      opinion = disputeOpinion({
        snapshot, verdict_id: d.verdict_id,
        ...(typeof d.claim_id === 'string' ? { claim_id: d.claim_id } : {}),
        ...(a.inputs !== undefined ? { inputs: a.inputs } : {}),
        ...scoped,
      })
    } catch (e) {
      throw new SurfaceInputError((e as Error).message)
    }
  } else {
    const policy = a.policy !== undefined ? policyFromJson(a.policy) : ctx.policy
    if (!policy) throw new SurfaceInputError('"policy" is required for a voice question (the declared promotion policy; there is no default), or "dispute" for a dispute')
    if (a.from_book !== undefined && typeof a.from_book !== 'boolean') throw new SurfaceInputError('"from_book" must be true or false')
    try {
      if (a.from_book === true) {
        // The CLI's `verify opinion --from-book`: the rung, tier, bounds and policy version are the GRANT in force on the book
        // (anchored signers only, D-ANCHOR); `consequence_tier` only while nothing is granted. A flag never overrides a grant.
        const flags = (['proposal', 'granted', 'grant', 'bounds'] as const).filter(k => a[k] !== undefined)
        if (flags.length) throw new SurfaceInputError(`"from_book" reads the rung from the GRANT in force on the book, so ${flags.map(k => `"${k}"`).join(', ')} cannot be passed with it (a flag never overrides a person's signed grant)`)
        const workflow_id = optString(a, 'workflow_id')
        if (!workflow_id) throw new SurfaceInputError('"workflow_id" is required with "from_book" (tenant/ruleset@version)')
        const tier = optString(a, 'consequence_tier')
        opinion = promotionOpinion({ snapshot, policy, workflow_id, ...(tier !== undefined ? { consequence_tier: tier } : {}), ...(ctx.calibration ? { calibration: ctx.calibration } : {}), ...scoped })
      } else if (a.proposal !== undefined) {
        if (!isObj(a.proposal)) throw new SurfaceInputError('"proposal" must be a proposal object (from voice_assess / GET /v1/voice)')
        if (a.workflow_id !== undefined || hasDeclarationArgs(a)) throw new SurfaceInputError('a "proposal" defines the question (its workflow, tier, bounds and rung); do not also pass a workflow_id or settings')
        opinion = promotionOpinion({ snapshot, policy, proposal: a.proposal as unknown as VoiceProposal, ...(ctx.calibration ? { calibration: ctx.calibration } : {}), ...scoped })
      } else {
        let declaration: WorkflowDeclaration
        if (hasDeclarationArgs(a) || !ctx.settings) {
          declaration = declarationFromJson(a)
        } else {
          const workflow_id = optString(a, 'workflow_id')
          if (!workflow_id) throw new SurfaceInputError('"workflow_id" is required (tenant/ruleset@version), or a "proposal", or a "dispute"')
          const s = ctx.settings(workflow_id)
          if (!s) throw new SurfaceInputError(`no settings are declared for ${workflow_id} (a consequence tier and a rung): supply "consequence_tier" and "granted", or declare them`)
          declaration = { ...s, workflow_id }
        }
        opinion = promotionOpinion({ snapshot, policy, declaration, ...(ctx.calibration ? { calibration: ctx.calibration } : {}), ...scoped })
      }
    } catch (e) {
      throw e instanceof SurfaceInputError ? e : new SurfaceInputError((e as Error).message)
    }
  }
  return { opinion, markdown: renderOpinion(opinion) }
}

// ── the structured twin ──────────────────────────────────────────────────────────────────────────────────────────────

const TWIN_MAPS = { '0.1.0': FS_CORE_TWIN_MAP, '0.2.0': FS_CORE_TWIN_MAP_V02, '0.2.1': FS_CORE_TWIN_MAP_V021 } as const
export const TWIN_MAP_VERSIONS = Object.keys(TWIN_MAPS) as (keyof typeof TWIN_MAPS)[]
/**
 * The CLI's `--ruleset 0.1|0.2|0.2.1` (CREDENCE-2 §7) as JSON: it names a map version. 0.2 is exactly 0.2.0, the map
 * CREDENCE-2 is bound to (kept selectable for replay); 0.2.1 is the opt-in statement-anchored map. 0.1 stays the default.
 */
export const TWIN_RULESETS: Readonly<Record<string, keyof typeof TWIN_MAPS>> = { '0.1': '0.1.0', '0.1.0': '0.1.0', '0.2': '0.2.0', '0.2.0': '0.2.0', '0.2.1': '0.2.1' }

/** What a twin map's own measurement says, returned with every result the map makes (an opt-in map is offered with it). */
export interface TwinMapStatus {
  map_version: string
  offered: 'opt-in'
  measured: string
  detail: string
}
/**
 * The measured status of the maps that carry one. 0.2.1 failed its pre-registered held-out check: it is offered opt-in with
 * that result stated wherever it is used, and no block-on-FAIL or zero-false-flag claim is made for it.
 */
export const TWIN_MAP_STATUS: Readonly<Partial<Record<keyof typeof TWIN_MAPS, TwinMapStatus>>> = {
  '0.2.1': {
    map_version: '0.2.1',
    offered: 'opt-in',
    measured: 'held-out prereg FAIL (2026-09-28)',
    detail: 'Pre-registered design (sha256 2f170fa3…) checked on 200 fresh 2026q2 filings: false flags in 4 of 200 filings (2%, the bar), ' +
      'abstentions on correct values 1.22% (bar 1.0%), anchored scale recall 38 of 50; scale-error recall 3,532 of 3,532. It improves on ' +
      '0.2 on each of those numbers and still fails its bars. Its ABSTAIN reason AMBIGUOUS_LINE (the cash roll could not choose between ' +
      'face lines) is the insufficiency AMBIGUOUS_REFERENCE.',
  },
}
/** The filing's presentation texts as flat fields (CREDENCE-2 §7: `--pre`, `--filing-summary`, `--schema`). */
const TWIN_PRESENTATION_KEYS = ['pre', 'filing_summary', 'schema'] as const

/**
 * verify_twin / POST /v1/twin: judge extracted values against the filing's own inline-XBRL facts (the CLI's
 * `verify twin`, as JSON). Map 0.2.0 binds through the presentation linkbase; without one it abstains
 * (NO_PRESENTATION_LINKBASE), as the judge does. Returns {verdict, judgments, twin}.
 *
 * Twin v0.2 (CREDENCE-2 §7): `ruleset` ('0.1' | '0.2') selects the map as `map_version` does, and the presentation texts
 * may arrive flat (`pre`, `filing_summary`, `schema`) or nested (`presentation`). Two ways of saying one thing must agree (a
 * `ruleset` and a `map_version` that differ are refused), the texts arrive one way at a time, and texts a map would not
 * read (map 0.1) are refused rather than ignored.
 *
 * Twin v0.2.1 (opt-in): `ruleset` / `map_version` '0.2.1' reads the linkbase strictly, as that map requires; its result
 * carries `map_status` (TWIN_MAP_STATUS: the held-out check it failed), so the map is never offered without its measurement.
 */
export function twinFromJson(a: Record<string, unknown>, opts: { now?: () => Date } = {}): TwinResult & { map_status?: TwinMapStatus } {
  const html = a.html
  if (typeof html !== 'string' || html.length === 0) throw new SurfaceInputError('"html" is required: the filing\'s primary inline-XBRL document, as text')
  const periodEnd = a.period_end
  if (typeof periodEnd !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) throw new SurfaceInputError('"period_end" is required, as YYYY-MM-DD')
  if (!Array.isArray(a.claims)) throw new SurfaceInputError('"claims" is required: an array of {id, field, value}')
  const claims: TwinClaim[] = a.claims.map((c, i) => {
    if (!isObj(c) || typeof c.id !== 'string' || typeof c.field !== 'string' || typeof c.value !== 'number') {
      throw new SurfaceInputError(`claims[${i}] needs id (string), field (string) and value (number)`)
    }
    return { id: c.id, field: c.field, value: c.value }
  })
  const num = (key: string): number | undefined => {
    const v = a[key]
    if (v === undefined) return undefined
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new SurfaceInputError(`"${key}" must be a non-negative number`)
    return v
  }
  const tolerance = num('tolerance')
  const periodToleranceDays = num('period_tolerance_days')
  const asked = optString(a, 'map_version')
  if (asked !== undefined && !(asked in TWIN_MAPS)) throw new SurfaceInputError(`"map_version" must be one of ${TWIN_MAP_VERSIONS.join(', ')}`)
  const rs = optString(a, 'ruleset')
  if (rs !== undefined && !(rs in TWIN_RULESETS)) throw new SurfaceInputError(`"ruleset" must be one of ${Object.keys(TWIN_RULESETS).join(', ')} (the twin map version)`)
  const byRuleset = rs !== undefined ? TWIN_RULESETS[rs] : undefined
  if (asked !== undefined && byRuleset !== undefined && asked !== byRuleset) {
    throw new SurfaceInputError(`"ruleset" ${rs} is map ${byRuleset}, but "map_version" says ${asked}: pass one, or two that agree`)
  }
  const mapVersion = (asked ?? byRuleset ?? '0.1.0') as keyof typeof TWIN_MAPS
  const map = TWIN_MAPS[mapVersion]
  const statement = (map.binding ?? 'document') === 'statement'
  const flat = TWIN_PRESENTATION_KEYS.filter(k => a[k] !== undefined && a[k] !== null)
  const nested = a.presentation !== undefined && a.presentation !== null
  if (flat.length && nested) {
    throw new SurfaceInputError(`the presentation texts arrive one way: as "presentation" { pre, filing_summary, schema }, or flat (${flat.map(k => `"${k}"`).join(', ')}), not both`)
  }
  let presentation: TwinOptions['presentation']
  if (flat.length || nested) {
    // Refused rather than ignored: a presentation the map does not read would silently change the question.
    const named = nested ? '"presentation" is' : `${flat.map(k => `"${k}"`).join(', ')} ${flat.length === 1 ? 'is' : 'are'}`
    if (!statement) throw new SurfaceInputError(`${named} read only by statement-anchored maps (ruleset 0.2 or 0.2.1, map_version 0.2.0 or 0.2.1); map ${mapVersion} binds over the whole document`)
    const p = nested ? a.presentation : a
    if (!isObj(p)) throw new SurfaceInputError('"presentation" must be { pre?, filing_summary?, schema? } (the filing\'s presentation texts)')
    const text = (k: string): string | null => {
      const v = p[k]
      if (v === undefined || v === null) return null
      if (typeof v !== 'string') throw new SurfaceInputError(`"${nested ? 'presentation.' : ''}${k}" must be a string`)
      return v
    }
    // A map that reads the linkbase strictly (its own `links`) gets the presentation read that way; the default reading otherwise.
    const links = (map as { links?: 'v0.2' | 'strict' }).links
    presentation = parseTwinPresentation({ pre: text('pre'), filingSummary: text('filing_summary'), schema: text('schema') }, links === 'strict' ? { links } : {})
  }
  const producer = optString(a, 'producer')
  let result: TwinResult
  try {
    result = verifyAgainstTwin(html, claims, {
      periodEnd, map,
      ...(tolerance !== undefined ? { tolerance } : {}),
      ...(periodToleranceDays !== undefined ? { periodToleranceDays } : {}),
      ...(statement ? { presentation: presentation ?? null } : {}),
      ...(producer !== undefined ? { producer } : {}),
      ...(opts.now ? { now: opts.now } : {}),
    })
  } catch (e) {
    throw new SurfaceInputError((e as Error).message)
  }
  const status = TWIN_MAP_STATUS[mapVersion]
  return status ? { ...result, map_status: status } : result
}

// ── completeness reconciliation ──────────────────────────────────────────────────────────────────────────────────────

/** What a reconciliation surface returns: the report (the source of truth; report_hash re-derives from it) and its reading copy. */
export interface ReconcileSurface { report: CompletenessReport; markdown: string }

export interface ReconcileContext {
  /** The book when the arguments carry none: the managed tier's own ledger, exported with its own anchored read. */
  book?: BookChain
  /** The caller's tenant (the managed tier): the reconciliation is scoped to it, whatever the arguments say. */
  tenant_id?: string
  /**
   * The deployment's declared promotion policy (the managed tier's `voice.policy`, D-GOVERNING-POLICY): the rung a record was
   * held at is read with the GRANTs it admits, whatever policy a grant names. A request never substitutes its own here.
   */
  policy?: PromotionPolicy
}

const DELIMITERS: readonly CsvDelimiter[] = [',', ';', '\t', '|']

/**
 * The customer's population from JSON: `{ format: 'csv' | 'jsonl', text | base64, delimiter? }` (the export's own bytes:
 * base64 binds its sha256 exactly as the file was), or `{ rows: [...] }` / an array of row objects (bound by rows_hash only).
 */
export function populationFromJson(x: unknown): Population {
  try {
    if (Array.isArray(x)) return populationFromRows(x as Record<string, unknown>[])
    if (!isObj(x)) throw new SurfaceInputError('"population" is required: { format: "csv" | "jsonl", text | base64 } (the export itself), or { rows: [...] }')
    if (x.rows !== undefined) {
      if (!Array.isArray(x.rows)) throw new SurfaceInputError('"population.rows" must be an array of row objects')
      if (x.text !== undefined || x.base64 !== undefined) throw new SurfaceInputError('"population" is rows, or the export as text / base64: one, not both')
      return populationFromRows(x.rows as Record<string, unknown>[])
    }
    const format = x.format
    if (format !== 'csv' && format !== 'jsonl') throw new SurfaceInputError('"population.format" must be "csv" or "jsonl" (declared, never sniffed)')
    if ((x.text === undefined) === (x.base64 === undefined)) throw new SurfaceInputError('"population" carries the export as "text" or as "base64": exactly one')
    let bytes: string | Uint8Array
    if (x.text !== undefined) {
      if (typeof x.text !== 'string') throw new SurfaceInputError('"population.text" must be a string')
      bytes = x.text
    } else {
      if (typeof x.base64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(x.base64)) throw new SurfaceInputError('"population.base64" must be base64 text')
      bytes = Buffer.from(x.base64, 'base64')
    }
    const delimiter = x.delimiter
    if (delimiter !== undefined && (format !== 'csv' || !DELIMITERS.includes(delimiter as CsvDelimiter))) {
      throw new SurfaceInputError(`"population.delimiter" is for csv, one of ${DELIMITERS.map(d => JSON.stringify(d)).join(', ')}`)
    }
    return readPopulation(bytes, format, delimiter !== undefined ? { delimiter: delimiter as CsvDelimiter } : {})
  } catch (e) {
    if (e instanceof PopulationRefused) throw new SurfaceInputError(`population refused: ${e.message}`)
    throw e
  }
}

const stringsOf = (a: Record<string, unknown>, key: string): string[] | undefined => {
  const v = a[key]
  if (v === undefined) return undefined
  if (!Array.isArray(v) || !v.every(x => typeof x === 'string')) throw new SurfaceInputError(`"${key}" must be an array of strings`)
  return v as string[]
}

const objectOf = (a: Record<string, unknown>, key: string): Record<string, unknown> | undefined => {
  const v = a[key]
  if (v === undefined) return undefined
  if (!isObj(v)) throw new SurfaceInputError(`"${key}" must be an object`)
  return v
}

/**
 * reconcile_completeness / POST /v1/reconcile: the book of record against the customer's payment population (the CLI's
 * `verify reconcile`, as JSON). Every population row lands in one class (MATCHED, MISMATCHED, PAID_DESPITE_HOLD,
 * CHECKED_AFTER_PAYMENT, AMBIGUOUS, BYPASSED, UNREADABLE), every in-period verdict in one (MATCHED, ORPHAN, AMBIGUOUS,
 * UNKEYED); the whole book is verified first, and nothing is reconciled against a book that does not verify.
 *
 * Stateless: `ledger` is the chain export, with `trusted_keys` / `root_keys` to anchor its signers and `tenant_id` to read one
 * tenant of a shared chain. With a context book (the managed tier) the book is the tier's own (its anchors travel with it)
 * and the tenant is the caller's: a request naming another tenant or another tenant's workflow is refused, and no request
 * adds anchors.
 */
export function reconcileFromJson(a: Record<string, unknown>, ctx: ReconcileContext = {}): ReconcileSurface {
  const managed = ctx.book !== undefined
  if (managed && a.ledger !== undefined) {
    throw new SurfaceInputError('"ledger": this service reconciles against the caller\'s own book of record; reconcile a chain export offline (verify reconcile) or with the stateless service')
  }
  if (managed && (a.trusted_keys !== undefined || a.root_keys !== undefined)) {
    throw new SurfaceInputError('"trusted_keys" / "root_keys" anchor the signers of a chain export you supply as "ledger"; the book read here carries its own anchors, and a request never adds to them')
  }
  if (managed && a.policy !== undefined) {
    throw new SurfaceInputError(`"policy": the rungs here are read under the deployment's declared policy; a request never substitutes its own`)
  }
  const policy = managed ? ctx.policy : a.policy !== undefined ? policyFromJson(a.policy) : undefined
  const asked = optString(a, 'tenant_id')
  if (ctx.tenant_id !== undefined && asked !== undefined && asked !== ctx.tenant_id) {
    throw new SurfaceInputError(`"tenant_id" ${JSON.stringify(asked)} is not this caller's: a reconciliation here reads the caller's own records only`)
  }
  const tenant_id = ctx.tenant_id ?? asked
  const workflows = stringsOf(a, 'workflows')
  const rulesets = stringsOf(a, 'rulesets')
  if (ctx.tenant_id !== undefined) {
    const foreign = (workflows ?? []).filter(w => !w.startsWith(`${ctx.tenant_id}/`))
    if (foreign.length) throw new SurfaceInputError(`"workflows" ${foreign.map(w => JSON.stringify(w)).join(', ')} ${foreign.length === 1 ? 'is' : 'are'} not this caller's (a workflow id is tenant/ruleset@version)`)
  }
  const book: BookChain = ctx.book ?? (snapshotFromJson(a.ledger) as BookChain)
  if (!isObj(a.mapping)) throw new SurfaceInputError('"mapping" is required: the declared completeness mapping (completeness-mapping-v0)')
  const population = populationFromJson(a.population)
  const period = objectOf(a, 'period')
  const rungs = objectOf(a, 'rungs')
  for (const [wf, level] of Object.entries(rungs ?? {})) {
    if (!VOICE_LADDER.includes(level as VoiceLevel)) throw new SurfaceInputError(`"rungs.${wf}" must be one of ${VOICE_LADDER.join(', ')}`)
  }
  const interval = objectOf(a, 'interval')
  if (a.extractions !== undefined && !Array.isArray(a.extractions)) throw new SurfaceInputError('"extractions" must be an array (the checked extractions or proposed actions; each is used only if its hash is on the book)')
  if (a.include_matched !== undefined && typeof a.include_matched !== 'boolean') throw new SurfaceInputError('"include_matched" must be a boolean')
  const anchors = managed ? {} : anchorsFromJson(a)
  const scope = { ...(tenant_id !== undefined ? { tenant_id } : {}), ...(workflows ? { workflows } : {}), ...(rulesets ? { rulesets } : {}) }
  const options: CompletenessOptions = {
    ...(Object.keys(scope).length ? { scope } : {}),
    ...(period ? { period: period as CompletenessOptions['period'] } : {}),
    ...(a.extractions !== undefined ? { extractions: a.extractions as unknown[] } : {}),
    ...(rungs ? { rungs: rungs as Record<string, VoiceLevel> } : {}),
    ...(interval ? { interval: interval as CompletenessOptions['interval'] } : {}),
    ...(anchors.trusted_keys || anchors.root_keys ? { anchors } : {}),
    ...(a.include_matched === true ? { include_matched: true } : {}),
    ...(policy ? { policy } : {}),
  }
  let report: CompletenessReport
  try {
    report = reconcileCompleteness(population, book, a.mapping as unknown as CompletenessMapping, options)
  } catch (e) {
    if (e instanceof CompletenessRefused || e instanceof PopulationRefused) throw new SurfaceInputError(`reconciliation refused: ${e.message}`)
    throw e
  }
  return { report, markdown: renderCompletenessReport(report) }
}
