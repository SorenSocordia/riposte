/**
 * The managed/hosted tier — a STATEFUL service composed AROUND the pure `route()` core, never inside it.
 *
 * The router stays a pure function (testable without a port, deterministic). Everything the hosted product needs that
 * the core deliberately refuses to hold — tenant identity, rate limiting, and a system-of-record — is injected here as
 * interfaces and layered on top:
 *
 *     authenticate → rate-limit → pure route() → the door → auto-record the verdict into the ledger
 *
 * Each concern is an interface with a dependency-free reference implementation, so OSS runs out of the box and a real
 * deployment swaps a DB-backed ledger / a key store / a distributed limiter behind the same shapes. The core's
 * determinism and the dependency-free border are untouched. A happy side effect: once verdicts auto-record, the honesty
 * machinery (overturn rate, per-rule calibration, book-of-record) goes LIVE — served by the stateful reads below.
 *
 * THE DOOR (verdictDoorProblem): only a well-formed VERDICT enters the book of record over HTTP. Generated material
 * (COUNSEL: an opinion, a candle, an advisory) is never recorded as a VERDICT, whatever it claims. Checked here, in the
 * HTTP layer, whatever the ledger also checks at `record` (defence in depth); a refusal never changes the response.
 *
 * EARNED VOICE (ServiceOptions.voice): with a ledger and a declared policy the tier serves a workflow's rung and open
 * proposal (GET /v1/voice/{workflow}, with the book's evidence audit and the proposal's basis), the reviewer's queue of drawn,
 * unreviewed items (GET /v1/queue/{workflow}), the courtroom opinion over the tenant's own book (POST /v1/opinion), and the
 * report's "what Riposte is asking for this month". Every read is scoped to the caller's tenant. The rung is always
 * what a person granted; nothing here changes it.
 *
 * BOOK FIRST (2026-09-28): the tier's ledger IS the book of record, so a workflow's rung is the GRANT in force on it (a
 * person's signed decision), read and re-verified on every request, with the ledger's own anchors. VoiceConfig.settings
 * cover only workflows with no GRANT (books that predate signed grants) and never override one; a request may restate the
 * settings on record, never change them. A book that does not verify grants nothing: its rungs are refused (409), never
 * read as `record`. POST /v1/action/check naming a `workflow_id` holds the call at that workflow's rung on the book.
 *
 * COMPLETENESS (POST /v1/reconcile): the caller's payment population against the tier's own book. The scope is FORCED to the
 * caller's tenant (never taken from the body), the book is read with the ledger's own anchors, a book that does not verify
 * reconciles nothing (409), and on a shared book the report's summary of the book is the caller's slice (tenantSlice).
 *
 * DUAL AUTHORIZATION (D-DUAL): every grant read here is read against the deployment's declared policy (./dual.ts), so a
 * GRANT of autonomy at a tier whose grant_signatures it has not collected is PENDING and has no effect on any rung, the
 * action check's included, whatever count it states and whatever policy it names; its notice is returned. POST
 * /v1/grant/cosign appends a second person's signed GRANT_COSIGN through the door.
 */

import { route, type HttpRequest, type HttpResponse } from './router.js'
import { openapiFor } from './openapi.js'
import type { Ledger, LedgerRecord } from '../ledger/types.js'
import type { Verdict } from '../verdict/schema.js'
import { renderTenantReport, monthPeriod, readRung, bookRefusal, type TenantReportOptions, type RungRead } from '../ledger/report.js'
import {
  grantInForce, recordedVerdictProblem, carryOwnRead, decisionTenant, DecisionRefused,
  type DecisionBook, type DecisionEntry, type GrantDecision, type SignedDecision, type BookDecision, type NoEffect,
} from '../ledger/decisions.js'
import { tenantOfWorkflow } from '../ledger/registry.js'
import { renderCompletenessReport, type BookChain, type CompletenessReport } from '../reconcile/completeness/index.js'
import { ruleCalibration } from '../ledger/calibration.js'
import { proofProblem } from '../verdict/channel.js'
import { hashOf } from '../verdict/canonical.js'
import { defaultWorkflowOf, type PromotionPolicy, type WorkflowCalibrationOptions } from '../verdict/voice.js'
import { openSnapshot, snapshotOfLedger } from '../opinion/index.js'
import {
  opinionFromJson, voiceSurface, reviewQueueSurface, actionCheckFromJson, levelFromJson, grantSettings, hasDeclarationArgs, reconcileFromJson, SurfaceInputError, DECLARATION_KEYS,
  type WorkflowSettings, type ActionCheckSurface,
} from './surfaces.js'
import type { WebhookTarget, WebhookDispatcher } from './webhooks.js'
import { governedRead, governedSignatures, governing } from './dual.js'

export interface AuthResult { tenant_id: string }
/** Resolve a request to a tenant, or null to reject (401). */
export type Authenticator = (req: HttpRequest) => AuthResult | null
/** Decide whether a tenant may proceed; retry_after_seconds populates the 429. */
export interface RateLimiter { check(tenant_id: string): { ok: boolean; retry_after_seconds?: number } }

/** A deployment's earned-voice declarations: a person's decisions, never the caller's. */
export interface VoiceConfig {
  /** The declared promotion policy (its bars are a business and risk decision). Without it nothing is proposed. */
  policy?: PromotionPolicy
  /**
   * A workflow's declared settings (consequence tier, the rung a person granted, bounds, the grant record), or undefined
   * when nothing is declared: the workflow is then at `record`, the day-1 default. BOOK FIRST: a GRANT in force on the
   * ledger governs its workflow, and these settings never override it; they cover books that predate signed grants.
   */
  settings?: (tenant_id: string, workflow_id: string) => WorkflowSettings | undefined
}

/** A verdict-bearing result the door refused to record, and why. */
export interface UnrecordedEvent { tenant_id: string; path: string; verdict_id?: string; problem: string }

export interface ServiceOptions {
  /** The book of record. When present, verdicts auto-record and the /v1/ledger/* reads are served. */
  ledger?: Ledger
  /** Resolve tenant from the request (e.g. an API key). Omit for a single-tenant ('default') OSS deployment. */
  authenticate?: Authenticator
  rateLimiter?: RateLimiter
  /** Auto-record verdict-bearing responses. Defaults to true when a ledger is present. */
  record?: boolean
  /** Fire a `verdict.recorded` webhook per recorded verdict. `resolve` maps a tenant to its targets. Best-effort. */
  webhooks?: { resolve: (tenant_id: string) => WebhookTarget[]; dispatch: WebhookDispatcher }
  /** Earned voice: GET /v1/voice/{workflow}, POST /v1/opinion over the tenant's book, and the report's opinions section. */
  voice?: VoiceConfig
  /** The clock that picks the report's reporting month (UTC). Default: the wall clock. It never touches a verdict. */
  now?: () => Date
  /** The pure core. Default route(). Whatever it returns passes the same door before anything is recorded. */
  router?: (req: HttpRequest) => HttpResponse
  /** Told of every verdict-bearing result the door refused (and why). Observability only: never affects the response. */
  onUnrecorded?: (e: UnrecordedEvent) => void
}

export interface Service { handle(req: HttpRequest): HttpResponse }

const json = (status: number, body: unknown): HttpResponse => ({ status, json: body })
const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x)
const isPublicPath = (method: string, path: string): boolean => method === 'GET' && /^\/(v1\/)?(health|openapi\.json)$/.test(path)
const OUTCOMES: ReadonlySet<unknown> = new Set(['PASS', 'FAIL', 'INSUFFICIENT_DATA'])

/**
 * The HTTP door to the book of record: the first reason `x` may NOT be recorded as a VERDICT, or undefined.
 *
 *  1. Generated material never passes, whatever else it claims: a COUNSEL tag, a GENERATED provenance, or the marks of
 *     counsel or an opinion (counsel_version, opinion_version, dismissible, holds_action).
 *  2. The VERDICT-channel contract (verdict/channel.ts proofProblem): verdict-shaped, `replayable: true`, bound to its
 *     inputs (verdict_id re-derives from input_hash + ruleset@version + engine), every PASS/FAIL claim evidenced and
 *     DETERMINISTIC (a judgement-tier finding is COUNSEL).
 *  3. Well-formed under schema v0: one of the three outcomes, ANY_FAIL_FAILS, claims that carry an id, a rule and one of
 *     the three outcomes, an explained insufficiency on every abstention and on nothing else, an outcome that follows
 *     from the claims, and coverage that recounts from them.
 */
export function verdictDoorProblem(x: unknown): string | undefined {
  // One door, two readers (SECURITY-FIX FS1, 2026-09-28): the book's own checks (ledger/decisions recordedVerdictProblem),
  // then the live door's refusal of judgement-tier findings (proofProblem, strict). Before this, the HTTP door recomputed
  // ANY_FAIL_FAILS exactly and so refused a partially grounded action's legitimate INSUFFICIENT_DATA hold: the hosted tier
  // answered "hold" and recorded nothing, and the audit trail lost exactly the holds.
  return recordedVerdictProblem(x) ?? proofProblem(x)
}

/** True for a well-formed VERDICT the HTTP door lets into the book of record (see verdictDoorProblem). */
export const isRecordableVerdict = (x: unknown): x is Verdict => verdictDoorProblem(x) === undefined

/** Records the tenant's workflows only (the default keyer, tenant/ruleset@version); every other tenant's record is skipped. */
const scopeTo = (tenant_id: string): WorkflowCalibrationOptions => ({
  workflowOf: (rec: LedgerRecord) => (rec.tenant_id === tenant_id ? defaultWorkflowOf(rec) : undefined),
})
const ownsWorkflow = (tenant_id: string, workflow_id: string): boolean => workflow_id.startsWith(`${tenant_id}/`)
/** A scoped opinion refusing another tenant's verdict or workflow (opinion/dispute.ts, opinion/promotion.ts): answered 404. */
export const NOT_THE_TENANTS = /is not on tenant .*'s book of record|is not tenant .*'s: an opinion scoped to a tenant/

export function createService(opts: ServiceOptions = {}): Service {
  const ledger = opts.ledger
  const record = opts.record ?? !!ledger
  const router = opts.router ?? route
  const now = opts.now ?? (() => new Date())
  const declaredOf = (tenant_id: string, workflow_id: string): WorkflowSettings | undefined => opts.voice?.settings?.(tenant_id, workflow_id)
  /**
   * D-DUAL, D-GOVERNING-POLICY: the deployment's declared policy governs every grant read here (./dual.ts), so a GRANT of
   * autonomy that has not collected its declared tier's grant_signatures is pending, whatever count it states and whatever
   * policy it names. Without a declared policy the count the grant states governs.
   */
  const policy = opts.voice?.policy
  const read = governing(policy)
  /** The settings on record, BOOK FIRST: the GRANT in force on the ledger (as settings, grant record included), else the declared ones. */
  const settingsOf = (tenant_id: string, workflow_id: string): WorkflowSettings | undefined => {
    const db = ledger?.decisionBook()
    const g = db?.ok ? grantInForce(db.decisions, workflow_id, read) : undefined
    return g ? grantSettings(g) : declaredOf(tenant_id, workflow_id)
  }
  /**
   * A workflow's rung read from the ledger, BOOK FIRST (report.ts readRung) under the declared policy, and what is on the book
   * for it with no effect (a pending or unanchored GRANT). Throws on a book that does not verify.
   */
  const rungOf = (led: Ledger, tenant_id: string, workflow_id: string): RungRead & { no_effect: NoEffect[]; notices: string[] } => {
    const db = led.decisionBook()
    if (!db.ok) throw new Error(bookRefusal(db))
    const gov = governedRead(db, policy)
    return { ...readRung(gov.book, led, workflow_id, declaredOf(tenant_id, workflow_id), undefined, policy), no_effect: gov.no_effect({ workflow_id }), notices: gov.notices(workflow_id) }
  }

  return {
    handle(req: HttpRequest): HttpResponse {
      const path = req.path.replace(/\/+$/, '') || '/'
      const pub = isPublicPath(req.method, path)

      let tenant = 'default'
      if (opts.authenticate && !pub) {
        const a = opts.authenticate(req)
        if (!a) return json(401, { error: 'unauthorized' })
        tenant = a.tenant_id
      }

      if (opts.rateLimiter && !pub) {
        const rl = opts.rateLimiter.check(tenant)
        if (!rl.ok) return json(429, { error: 'rate limit exceeded', ...(rl.retry_after_seconds !== undefined ? { retry_after_seconds: rl.retry_after_seconds } : {}) })
      }

      // 2026-10-05: the spec describes this server: every route with a book of record, the pure core's without one
      if (req.method === 'GET' && (path === '/v1/openapi.json' || path === '/openapi.json')) return json(200, openapiFor({ ledger: Boolean(ledger) }))
      // Stateful reads — only meaningful with a ledger; these are the hosted product's dashboards, in JSON.
      if (ledger && req.method === 'GET') {
        if (path === '/v1/ledger/stats') return json(200, ledger.stats(tenant))
        if (path === '/v1/ledger/report') return json(200, { tenant_id: tenant, markdown: renderTenantReport(ledger, reportOptions(tenant)) })
        if (path === '/v1/ledger/calibration') return json(200, ruleCalibration(ledger.query({ tenant_id: tenant, reviewed: true })))
        if (path.startsWith('/v1/voice/')) return voiceRead(ledger, path.slice('/v1/voice/'.length), tenant)
        if (path.startsWith('/v1/queue/')) return queueRead(ledger, path.slice('/v1/queue/'.length), tenant)
      }
      // The courtroom opinion over the tenant's own book. A caller-supplied "ledger" stays stateless (the pure route).
      if (ledger && req.method === 'POST' && path === '/v1/opinion' && isObj(req.body) && req.body.ledger === undefined) {
        return opinionRead(ledger, req.body, tenant)
      }
      // Completeness over the tenant's own book: the scope is the caller's tenant, never the request's.
      if (ledger && req.method === 'POST' && path === '/v1/reconcile') return reconcileRead(ledger, req.body, tenant)
      // A second person's signature on a GRANT (D-DUAL), through the ledger's door.
      if (ledger && req.method === 'POST' && path === '/v1/grant/cosign') return cosignWrite(ledger, req.body, tenant)
      // An action check naming a workflow is held at that workflow's rung on the book, not at a rung the caller states.
      if (req.method === 'POST' && path === '/v1/action/check' && isObj(req.body) && req.body.workflow_id !== undefined) {
        const res = actionCheckRead(req.body, tenant)
        if (record && ledger && res.status === 200) recordFrom(res.json, tenant, path)
        return res
      }

      const res = router(req)
      if (record && ledger && res.status === 200) recordFrom(res.json, tenant, path)
      return res
    },
  }

  function reportOptions(tenant_id: string): TenantReportOptions {
    const voice: NonNullable<TenantReportOptions['voice']> = {
      // Book first: the rungs are the GRANTs on the tier's own ledger; the declared settings cover the rest.
      ...(ledger ? { book: ledger } : {}),
      ...(opts.voice?.policy ? { policy: opts.voice.policy } : {}),
      ...(opts.voice ? { declarations: (wf: string) => declaredOf(tenant_id, wf) } : {}),
    }
    return { tenant_id, period: monthPeriod(now()), ...(Object.keys(voice).length ? { voice } : {}) }
  }

  /** GET /v1/voice/{workflow}: the rung a person granted and any open proposal, from the tenant's book. */
  function voiceRead(led: Ledger, raw: string, tenant_id: string): HttpResponse {
    let workflow_id: string
    try { workflow_id = decodeURIComponent(raw) } catch { return json(400, { error: 'the workflow id is not valid URL encoding' }) }
    if (!workflow_id) return json(400, { error: 'a workflow id is required: GET /v1/voice/{workflow}, URL-encoded (tenant/ruleset@version)' })
    if (!ownsWorkflow(tenant_id, workflow_id)) return json(404, { error: `no workflow ${JSON.stringify(workflow_id)} for this tenant (a workflow id is tenant/ruleset@version)` })
    const view = openSnapshot(snapshotOfLedger(led))
    try {
      const r = rungOf(led, tenant_id, workflow_id)
      return json(200, { tenant_id, ...voiceSurface(view, workflow_id, r.settings, opts.voice?.policy, scopeTo(tenant_id)) })
    } catch (e) {
      // Declared settings the policy refuses (an undeclared tier, a grant made under other settings): a person's to correct.
      // A book that does not verify grants nothing: no rung is read from it.
      return json(409, { error: (e as Error).message })
    }
  }

  /**
   * GET /v1/queue/{workflow}: the reviewer's queue on the tenant's book, every drawn item not yet reviewed with its deadline.
   * The tier is the GRANT in force's, else the deployment's declared one; the policy is the deployment's. Another tenant's
   * workflow is 404; a book that does not verify, or settings the policy refuses, 409.
   */
  function queueRead(led: Ledger, raw: string, tenant_id: string): HttpResponse {
    let workflow_id: string
    try { workflow_id = decodeURIComponent(raw) } catch { return json(400, { error: 'the workflow id is not valid URL encoding' }) }
    if (!workflow_id) return json(400, { error: 'a workflow id is required: GET /v1/queue/{workflow}, URL-encoded (tenant/ruleset@version)' })
    if (!ownsWorkflow(tenant_id, workflow_id)) return json(404, { error: `no workflow ${JSON.stringify(workflow_id)} for this tenant (a workflow id is tenant/ruleset@version)` })
    try {
      return json(200, { tenant_id, ...reviewQueueSurface(led, workflow_id, opts.voice?.policy, declaredOf(tenant_id, workflow_id)?.consequence_tier) })
    } catch (e) {
      return json(409, { error: (e as Error).message })
    }
  }

  /**
   * POST /v1/action/check with a workflow_id: the call is held at the workflow's rung ON THE BOOK (the GRANT in force; else
   * the declared settings; else record), never at a rung the request states. A request may restate it; a different one is
   * 409 (a flag never overrides a person's signed grant). The verdict is recorded like any other (the door).
   */
  function actionCheckRead(body: Record<string, unknown>, tenant_id: string): HttpResponse {
    const workflow_id = body.workflow_id
    if (typeof workflow_id !== 'string' || !workflow_id) return json(400, { error: '"workflow_id" must be a workflow id (tenant/ruleset@version)' })
    if (!ownsWorkflow(tenant_id, workflow_id)) return json(404, { error: `no workflow ${JSON.stringify(workflow_id)} for this tenant (a workflow id is tenant/ruleset@version)` })
    let level: ActionCheckSurface['level'], source: ActionCheckSurface['level_source']
    let inert: ActionCheckSurface['no_effect'] = []
    let notices: string[] = []
    try {
      if (ledger) {
        const r = rungOf(ledger, tenant_id, workflow_id)
        level = r.granted
        source = r.from === 'grant' ? 'grant' : r.from === 'declaration' || r.settings ? 'declaration' : 'none'
        // What is on the book for this workflow with no effect on its rung (a pending or unanchored GRANT), said, never silent.
        inert = r.no_effect
        notices = r.notices
      } else {
        const d = declaredOf(tenant_id, workflow_id)
        level = d?.granted ?? 'record'
        source = d ? 'declaration' : 'none'
      }
    } catch (e) {
      return json(409, { error: (e as Error).message })
    }
    try {
      const asked = levelFromJson(body.level)
      if (asked !== undefined && asked !== level) {
        return json(409, { error: `the rung on record for ${workflow_id} is ${level} (${source === 'grant' ? 'a person\'s signed GRANT on the book' : source === 'declaration' ? 'the declared settings' : 'nothing granted: record, the day-1 default'}); this request says ${asked}. A request may restate the rung on record, never change it: a flag never overrides a person's signed grant.` })
      }
      return json(200, actionCheckFromJson(body, { resolved: { level, source, workflow_id, ...(inert.length ? { no_effect: inert } : {}), ...(notices.length ? { notices } : {}) } }))
    } catch (e) {
      if (e instanceof SurfaceInputError) return json(400, { error: e.message })
      return json(400, { error: `verification error: ${(e as Error).message}` })
    }
  }

  /** POST /v1/opinion without a "ledger": the opinion over the tenant's own book, under the settings on record. */
  function opinionRead(led: Ledger, body: Record<string, unknown>, tenant_id: string): HttpResponse {
    let args = body
    if (body.dispute !== undefined) {
      const d = body.dispute
      if (isObj(d) && typeof d.verdict_id === 'string') {
        if (led.get(d.verdict_id)?.tenant_id !== tenant_id) return json(404, { error: `verdict ${d.verdict_id} is not on this tenant's book of record` })
        // A shared book is served: the opinion is scoped to the caller's tenant (its precedent, prior ruling and
        // verdict are the tenant's own; the chain is still verified whole), so it never cites another tenant's reviews.
      }
    } else {
      const proposal = body.proposal
      const workflow_id = typeof body.workflow_id === 'string' ? body.workflow_id
        : isObj(proposal) && typeof proposal.workflow_id === 'string' ? proposal.workflow_id : undefined
      if (workflow_id !== undefined && !ownsWorkflow(tenant_id, workflow_id)) return json(404, { error: `no workflow ${JSON.stringify(workflow_id)} for this tenant (a workflow id is tenant/ruleset@version)` })
      const onRecord = workflow_id !== undefined && proposal === undefined ? settingsOf(tenant_id, workflow_id) : undefined
      if (onRecord && hasDeclarationArgs(body)) {
        const conflict = settingsConflict(onRecord, body)
        if (conflict) {
          return json(409, { error: `the settings on record for ${workflow_id} are a person's decision (tier '${onRecord.consequence_tier}', rung ${onRecord.granted}); this request says ${conflict}. An opinion here argues from the settings on record; to argue others, POST your own chain export as "ledger".` })
        }
        args = Object.fromEntries(Object.entries(body).filter(([k]) => !(DECLARATION_KEYS as readonly string[]).includes(k)))
      }
    }
    try {
      return json(200, opinionFromJson(args, {
        snapshot: snapshotOfLedger(led),
        ...(opts.voice?.policy ? { policy: opts.voice.policy } : {}),
        settings: wf => settingsOf(tenant_id, wf),
        calibration: scopeTo(tenant_id),
        scope: { tenant_id, owns_workflow: wf => ownsWorkflow(tenant_id, wf) },
      }))
    } catch (e) {
      // The scoped opinion's own refusal of another tenant's verdict or workflow is a 404, like the pre-checks: under a
      // shared verdict id the ledger names the latest owner, so the scoped opinion is the final word.
      if (e instanceof SurfaceInputError) return json(NOT_THE_TENANTS.test(e.message) ? 404 : 400, { error: e.message })
      return json(500, { error: `opinion error: ${(e as Error).message}` })
    }
  }

  /**
   * POST /v1/reconcile: completeness over the tenant's own book. The book is the tier's ledger, exported with its own anchored
   * read (so a GRANT counts exactly when the ledger honors it); the scope is the caller's tenant, forced; a book that does not
   * verify reconciles nothing (409, as the rung reads); a request naming another tenant or its workflow is refused (404).
   */
  function reconcileRead(led: Ledger, body: unknown, tenant_id: string): HttpResponse {
    if (!isObj(body)) return json(400, { error: 'request body must be a JSON object' })
    const db = led.decisionBook()
    if (!db.ok) return json(409, { error: bookRefusal(db) })
    const book: BookChain = led.snapshot()
    carryOwnRead(book.events, db)
    try {
      const r = reconcileFromJson(body, { book, tenant_id, ...(opts.voice?.policy ? { policy: opts.voice.policy } : {}) })
      const own = tenantSlice(r.report, tenant_id, book, db)
      return json(200, { tenant_id, report: own, markdown: own === r.report ? r.markdown : renderCompletenessReport(own) })
    } catch (e) {
      if (e instanceof SurfaceInputError) return json(/not this caller's/.test(e.message) ? 404 : 400, { error: e.message })
      return json(500, { error: `reconcile error: ${(e as Error).message}` })
    }
  }

  /**
   * POST /v1/grant/cosign (D-DUAL): the body is a person's signed GRANT_COSIGN (made offline with their own key: makeCosign +
   * signDecision). It goes through the ledger's door, which verifies the signature, the anchoring, and that it counts (not the
   * grant's own signer, not a repeat signer or key, not a superseded or unanchored grant): a refusal is 409 and appends nothing.
   * The grant must be on the caller's tenant's book (another tenant's is 404). Returns the entry and the grant's signatures.
   */
  function cosignWrite(led: Ledger, body: unknown, tenant_id: string): HttpResponse {
    if (!isObj(body) || !isObj(body.decision) || typeof body.signature !== 'string' || typeof body.public_key !== 'string') {
      return json(400, { error: 'the body is a signed GRANT_COSIGN: { decision: { kind: "GRANT_COSIGN", workflow_id, grant, level, signer_id, signed_at }, alg, public_key, signature, decision_id }' })
    }
    const d = body.decision
    if (d.kind !== 'GRANT_COSIGN' || typeof d.grant !== 'string') return json(400, { error: '"decision" must be a GRANT_COSIGN naming the grant it co-signs ("grant": its decision_id)' })
    const db = led.decisionBook()
    if (!db.ok) return json(409, { error: bookRefusal(db) })
    const named = db.decisions.find(e => e.decision_id === d.grant)
    const grantTenant = named ? decisionTenant(named.signed.decision) : typeof d.workflow_id === 'string' ? tenantOfWorkflow(d.workflow_id) : undefined
    if (grantTenant !== tenant_id) return json(404, { error: `no grant ${JSON.stringify(d.grant)} on this tenant's book of record` })
    let entry: DecisionEntry<BookDecision>
    try {
      entry = led.decide(body as unknown as SignedDecision<BookDecision>)
    } catch (e) {
      if (e instanceof DecisionRefused) return json(409, { error: e.message })
      return json(400, { error: `the co-signature could not be read: ${(e as Error).message}` })
    }
    const after = led.decisionBook()
    const gov = governedRead(after, policy)
    const g = after.decisions.find(e => e.decision_id === d.grant) as DecisionEntry<GrantDecision> | undefined
    const grant = g ? {
      decision_id: g.decision_id, workflow_id: g.signed.decision.workflow_id, level: g.signed.decision.level,
      signatures: governedSignatures(g, after, policy),
      in_force: grantInForce(after.decisions, g.signed.decision.workflow_id, read)?.decision_id === g.decision_id,
    } : null
    const pending = g ? gov.no_effect({ workflow_id: g.signed.decision.workflow_id }).filter(n => n.decision_id === g.decision_id || n.decision_id === entry.decision_id) : []
    return json(200, { tenant_id, appended: entry, grant, no_effect: pending })
  }

  /** Every verdict a response carries: the verdict itself, a batch's results, or a twin result's verdict. */
  function recordFrom(body: unknown, tenant_id: string, path: string): void {
    if (!isObj(body)) return
    const candidates: unknown[] = typeof body.verdict_id === 'string' ? [body]
      : Array.isArray(body.results) ? body.results
      : isObj(body.verdict) ? [body.verdict]
      : []
    for (const c of candidates) {
      const verdict_id = isObj(c) && typeof c.verdict_id === 'string' ? c.verdict_id : undefined
      const problem = verdictDoorProblem(c)
      if (problem) { unrecorded({ tenant_id, path, problem, ...(verdict_id ? { verdict_id } : {}) }); continue }
      try {
        recordAndNotify(c as Verdict, tenant_id)
      } catch (e) {
        unrecorded({ tenant_id, path, problem: `the ledger refused it: ${(e as Error).message}`, ...(verdict_id ? { verdict_id } : {}) })
      }
    }
  }

  function unrecorded(e: UnrecordedEvent): void {
    try { opts.onUnrecorded?.(e) } catch { /* observability must never affect the response */ }
  }

  function recordAndNotify(verdict: Verdict, tenant_id: string): void {
    ledger!.record(verdict, { tenant_id })
    if (opts.webhooks) {
      for (const target of opts.webhooks.resolve(tenant_id)) {
        // Best-effort: never let a webhook failure affect the verdict response.
        try { void opts.webhooks.dispatch({ type: 'verdict.recorded', tenant_id, verdict }, target) } catch { /* swallow */ }
      }
    }
  }
}

/**
 * The caller's slice of a completeness report over a shared book. The engine matches only the caller's records (the forced
 * scope), but its summary of the book counts and names the whole book: every tenant on it, every record, every unanchored
 * GRANT and signer. A tenant is shown its own: the tenants list, the record counts, and the unanchored GRANTs and signers of
 * its own decisions and signed reviews. The chain's head and length stay (they bind the report to the book). report_hash is
 * re-derived over what is served, so completenessReportIntact holds on it; on a book that is only the caller's, the slice is
 * the report itself, byte for byte.
 */
function tenantSlice(r: CompletenessReport, tenant_id: string, book: BookChain, db: DecisionBook): CompletenessReport {
  const records = new Set<string>()
  for (const p of book.payloads) {
    const q = p as { type?: unknown; tenant_id?: unknown; verdict?: { verdict_id?: unknown } } | null
    if (q && q.type === 'RECORD' && String(q.tenant_id ?? '') === tenant_id && typeof q.verdict?.verdict_id === 'string') records.add(q.verdict.verdict_id)
  }
  const signers = new Set<string>()
  for (const e of [...db.decisions, ...db.cosigns, ...db.canaries]) if (decisionTenant(e.signed.decision) === tenant_id) signers.add(e.signed.decision.signer_id)
  for (const e of db.signed_reviews) if (e.tenant_id === tenant_id) signers.add(e.signer_id)
  const b = r.book
  const own: CompletenessReport['book'] = {
    ...b,
    unanchored_signers: b.unanchored_signers.filter(s => signers.has(s)),
    unanchored_grants: b.unanchored_grants.filter(g => tenantOfWorkflow(g.workflow_id) === tenant_id),
    tenants: b.tenants.filter(t => t === tenant_id),
    records: records.size,
    out_of_scope: Math.max(0, records.size - b.in_scope - b.not_verdict.length),
  }
  if (hashOf(own) === hashOf(b)) return r
  const { report_hash, generated_at, ...body } = r
  void report_hash
  const sliced = { ...body, book: own }
  return { ...sliced, report_hash: hashOf(sliced), ...(generated_at !== undefined ? { generated_at } : {}) }
}

/** The first declared setting a request states differently from the settings on record, in words; undefined if none. */
function settingsConflict(onRecord: WorkflowSettings, body: Record<string, unknown>): string | undefined {
  if (body.consequence_tier !== undefined && body.consequence_tier !== onRecord.consequence_tier) return `tier ${JSON.stringify(body.consequence_tier)}`
  if (body.granted !== undefined && body.granted !== onRecord.granted) return `rung ${JSON.stringify(body.granted)}`
  if (body.bounds !== undefined && body.bounds !== onRecord.bounds) return `bounds ${JSON.stringify(body.bounds)}`
  if (body.grant !== undefined && hashOf(body.grant) !== hashOf(onRecord.grant ?? null)) return 'a different grant record'
  return undefined
}

/** Reference API-key authenticator: maps an `x-api-key` header value to a tenant. Swap for a key store in production. */
export function apiKeyAuth(keyToTenant: Record<string, string>): Authenticator {
  return (req: HttpRequest): AuthResult | null => {
    const key = req.headers?.['x-api-key']
    if (typeof key === 'string' && Object.prototype.hasOwnProperty.call(keyToTenant, key)) return { tenant_id: keyToTenant[key]! }
    return null
  }
}

/** Reference fixed-window rate limiter. Deterministic given an injected clock; per-tenant counters reset each window. */
export function fixedWindowRateLimiter(opts: { limit: number; windowMs: number; now?: () => number }): RateLimiter {
  const now = opts.now ?? (() => Date.now())
  const buckets = new Map<string, { count: number; resetAt: number }>()
  return {
    check(tenant_id: string) {
      const t = now()
      let b = buckets.get(tenant_id)
      if (!b || t >= b.resetAt) { b = { count: 0, resetAt: t + opts.windowMs }; buckets.set(tenant_id, b) }
      if (b.count >= opts.limit) return { ok: false, retry_after_seconds: Math.ceil((b.resetAt - t) / 1000) }
      b.count++
      return { ok: true }
    },
  }
}
