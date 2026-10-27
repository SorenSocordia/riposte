/**
 * EARNED AUTONOMY, END TO END, ON REAL DATA.
 *
 * An AI agent extracts values from 10-K filings. Every value is checked against the filing's own iXBRL (the twin), every
 * verdict goes on a hash-chained book, and the agent's right to act without a person is earned from reviewed evidence,
 * rung by rung. Only a person moves the rung, in either direction. This script walks the whole loop, deterministically:
 *
 *   (a) keys: a root key registers a grant signer (the controller) and a reviewer (segregation of duties)
 *   (b) real verdicts, at rung `record`, onto a file ledger
 *   (c) signed reviews (the reviewer's decisions are the benchmark's gold labels: see LABELS below)
 *   (d) the voice assessment, with Wilson and Clopper-Pearson bounds, and the promotion opinion
 *   (e) the controller's signed grants, and the rung moving
 *   (f) under autonomy: a verifiable surveillance draw, reviews, and a miss raising a failure-basis demotion proposal
 *   (g) the controller's decision on it
 *   (h) the tenant report
 *   (i) a completeness reconciliation against a posting population
 *   (j) the whole book verified and every verdict re-performed
 *   and three attacks on the same book: a self-grant, a forged outcome, a torn tail.
 *
 * No model calls, no network, no randomness: a fixed clock and fixed demo keys, so the final book hashes the same on every
 * machine. Run:  cmd //c "node_modules\.bin\tsx.cmd examples\earned-autonomy\demo.ts"   (or: npx tsx on other systems)
 *
 * LABELS. The reviewer's decisions are the gold labels of the CREDENCE-2 benchmark's audit: an independent MODEL reader
 * (claude-sonnet-5) read each printed statement blind, then adjudicated. They are not a human's review. A real deployment's
 * reviewer is a person; here the labels stand in for one, and the narrative says so wherever they are used.
 *
 * SYNTHETIC, and labelled wherever it appears: the clock (Oct-Dec 2026), the demo keys, the tenant, the posting population,
 * the two planted population rows, and the one post-grant miss (the benchmark has no gold-wrong value that the twin passed).
 */
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto'
import { appendFileSync, copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  verifyAgainstTwin, twinVerdictInput, FS_CORE_TWIN_MAP_V02, ENGINE_VERSION, SCHEMA_VERSION, OPINION_VERSION,
  openFileLedger, parseChainJSONL, verifyChain, verifyChainAgainst, signDecision, makeKeyRegister, makeReview, makeGrant, keyFingerprint,
  assessVoiceFromLedger, grantForProposal, lintPolicy, policyRef, wilsonInterval, clopperPearsonInterval,
  promotionOpinion, snapshotOfLedger, renderOpinion, renderTenantReport, commitDueSamples, reviewQueue, deriveSample,
  reconcileCompleteness, readPopulationJSONL, renderCompletenessReport, verifyReplay, replayView, canonicalize, hashOf,
  noEffect, DecisionRefused,
  type Verdict, type PromotionPolicy, type VoiceAssessment, type TwinClaim, type InlineXbrl, type CompletenessMapping,
  type DemotionProposal, type SampleBody, type RungAssessment,
} from '../../src/index.js'
import { loadFixture, decodeTwin, type FixtureFiling, type FixtureItem } from './fixture.js'

// ── the deployment's declarations (synthetic, and said so) ──────────────────────────────────────────────────────────

export const TENANT = 'northwind-research'
export const MAP = FS_CORE_TWIN_MAP_V02

/**
 * The deployment owner's promotion policy. The bars are the research consequence-tier table's rows T1 (routine) and T3
 * (high): 5% tolerable deviation at 90% one-sided, zero-miss n 45 (AS 2315 .34); 1% at 95%, zero-miss n 299. Two
 * departures, both the deployment's choice: the pre-grant review is a census (every PASS and FAIL is reviewed), so random
 * selection adds nothing and is off; T3's canaries are omitted (the demo has no sealed known-bad items). The surveillance
 * rate (10% of PASSes a month) is a product choice, not a sourced number.
 */
export const DEMO_POLICY: PromotionPolicy = {
  policy_version: 'promotion-policy-v0',
  policy_id: 'demo-10k-face-values',
  version: '1.0.0',
  method: 'clopper-pearson',
  sidedness: 'one-sided',
  tiers: [
    {
      tier: 'routine',
      description: 'Auto-accept a 10-K face-statement value into a research dataset: correctable after the fact, and the filing\'s own iXBRL is a binding twin.',
      confidence: 0.9,
      advise: { min_n: 7, max_error: 0.3 }, gate: { min_n: 15, max_error: 0.15 }, autonomy: { min_n: 45, max_error: 0.05 },
      max_rung: 'autonomy',
      sampling: { period: 'month', surveillance_rate: 0.1 },
      evidence: { signed_reviews: true, segregation: true },
    },
    {
      tier: 'high',
      description: 'Auto-accept an extracted value into a filing workpaper.',
      confidence: 0.95,
      advise: { min_n: 14, max_error: 0.2 }, gate: { min_n: 59, max_error: 0.05 }, autonomy: { min_n: 299, max_error: 0.01 },
      max_rung: 'autonomy',
      sampling: { period: 'month', surveillance_rate: 0.15 },
      evidence: { signed_reviews: true, segregation: true },
    },
  ],
}
export const TIER = 'routine'
export const BOUNDS = `values in the six promoted face-statement cells of XBRL-tagged 10-K filings, checked by ${MAP.id}@${MAP.version} (statement-anchored)`

// ── fixed demo keys (NOT secrets: published so anyone reproduces the book; never use them for anything real) ───────────

function demoKey(label: string): { priv: string; pub: string; fingerprint: string } {
  const seed = createHash('sha256').update(`riposte earned-autonomy demo key · ${label} · NOT A REAL KEY`).digest()
  const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed])
  const k = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' })
  const pub = createPublicKey(k).export({ type: 'spki', format: 'pem' }).toString()
  return { priv: k.export({ type: 'pkcs8', format: 'pem' }).toString(), pub, fingerprint: keyFingerprint(pub)! }
}

// ── the run ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface DemoOptions {
  /** Called with each narrative line as it is produced (the CLI prints them). */
  log?: (line: string) => void
  /** Keep the temp directory (the book, the population, the rendered documents) and report where it is. */
  keep?: boolean
  /** Print the long documents (the opinion, the report, the reconciliation) in full. Default true for the CLI. */
  documents?: boolean
  /**
   * The engine version the verdicts are made under (2026-10-03): this build's when absent, or an earlier one it retains
   * ('0.0.1'), to show that the book an earlier engine wrote is still re-performed byte for byte.
   */
  engine?: string
}

export interface DemoResult {
  versions: { engine: string; schema: string; ruleset: string; map: string; opinion: string; policy: string; fixture_sha256: string }
  workflow_id: string
  record: { verdicts: number; by_outcome: Record<string, number>; reviewed: number; overturned: number }
  assessment: { earned: string; rungs: { rung: string; n: number; errors: number; upper: number; cleared: boolean }[]; high_tier_earned: string }
  ladder: string[]
  surveillance: { period: string; seed: string; population: Record<string, number>; drawn: Record<string, number>; rederived: boolean; synthetic_miss: string }
  demotion: { kind: string; basis: string; urgent: boolean; from: string; to: string; opinion_disposition: string }
  after_decision: { level: string; report_reasks_promotion: boolean }
  reconcile: { by_class: Record<string, number>; paid_despite_hold: string[]; bypassed: string[]; coverage: { rows: number; on_book: number; upper: number }; report_hash: string }
  attacks: { door_refused: boolean; spliced: string; forged_replay: string; forged_structure_only: string; torn: string }
  chain: { ok: boolean; length: number; head: string; book_sha256: string }
  replay: { reperformed_from_fixture: number; reperformed_from_filing: number; total: number }
  dir?: string
}

const OUTCOME: Record<FixtureItem['bench_v02'], Verdict['outcome']> = { PASS: 'PASS', FAIL: 'FAIL', ABSTAIN: 'INSUFFICIENT_DATA' }
const pct = (x: number, d = 2): string => `${(x * 100).toFixed(d)}%`

export function runDemo(opts: DemoOptions = {}): DemoResult {
  const lines: string[] = []
  const say = (s = ''): void => { lines.push(s); opts.log?.(s) }
  const h = (s: string): void => { say(); say(`━━ ${s} ${'━'.repeat(Math.max(0, 100 - s.length))}`) }
  const doc = (title: string, text: string): void => { if (opts.documents === false) return; say(`┌── ${title}`); for (const l of text.split('\n')) say(`│ ${l}`); say('└──') }

  const engineOpt = opts.engine !== undefined ? { engine: opts.engine } : {}
  const engineVersion = opts.engine ?? ENGINE_VERSION
  const { fixture, bytes } = loadFixture()
  const fixtureSha = createHash('sha256').update(bytes).digest('hex')
  const dir = mkdtempSync(join(tmpdir(), 'riposte-earned-autonomy-'))
  const bookPath = join(dir, 'book.jsonl')

  // A fixed clock: every event on the book advances it one minute; `at` jumps to a day.
  let clock = 0
  const at = (isoDay: string): void => { clock = Date.parse(`${isoDay}T09:00:00Z`) }
  const tick = (): Date => new Date((clock += 60_000))
  const nowIso = (): string => new Date(clock).toISOString()

  try {
    // ── (a) keys ────────────────────────────────────────────────────────────────────────────────────────────────────
    const ROOT = demoKey('root'), CONTROLLER = demoKey('controller'), REVIEWER = demoKey('reviewer'), AGENT = demoKey('extraction-agent')
    const ROOTS = [ROOT.pub]
    h('(a) keys: who may do what')
    at('2026-10-01')
    const led = openFileLedger(bookPath, { now: tick, root_keys: ROOTS })
    const register = (subject: string, key: { pub: string }, role: 'grant_signer' | 'reviewer'): void => {
      led.decide(signDecision(makeKeyRegister({ subject_id: subject, public_key: key.pub, roles: [role], signer_id: 'root', signed_at: nowIso() }), ROOT.priv))
    }
    register('controller', CONTROLLER, 'grant_signer')
    register('reviewer', REVIEWER, 'reviewer')
    say(`SYNTHETIC demo keys, derived from published labels so the book reproduces (never use them for anything real):`)
    say(`  root key        ${ROOT.fingerprint.slice(0, 16)}…  anchors the book; registers people, signs nothing else`)
    say(`  controller      ${CONTROLLER.fingerprint.slice(0, 16)}…  role grant_signer: the only person who can move the rung`)
    say(`  reviewer        ${REVIEWER.fingerprint.slice(0, 16)}…  role reviewer: signs reviews, cannot grant (segregation of duties)`)
    say(`  extraction agent ${AGENT.fingerprint.slice(0, 16)}… unregistered: the agent whose autonomy is at stake`)

    // ── (b) real verdicts at record ─────────────────────────────────────────────────────────────────────────────────
    const policyLint = lintPolicy(DEMO_POLICY)
    if (!policyLint.ok) throw new Error(`the demo policy does not lint: ${policyLint.errors.join('; ')}`)
    const twins = new Map<string, InlineXbrl>()
    const twinOf = (f: FixtureFiling): InlineXbrl => { let t = twins.get(f.adsh); if (!t) { t = decodeTwin(f.twin); twins.set(f.adsh, t) } return t }
    interface Rec { verdict: Verdict; filing: FixtureFiling; item: FixtureItem; claim: TwinClaim; day: string }
    const recs = new Map<string, Rec>()
    const recordFiling = (f: FixtureFiling, day: string): Rec[] => {
      at(day)
      const out: Rec[] = []
      for (const item of f.items) {
        const claim: TwinClaim = { id: `${f.adsh}.${f.model}.${item.field}`, field: item.field, value: item.value }
        const issued = new Date(clock)
        const r = verifyAgainstTwin(twinOf(f), [claim], { periodEnd: f.period_end, map: MAP, presentation: f.presentation, producer: f.model, now: () => issued, ...engineOpt })
        if (r.verdict.outcome !== OUTCOME[item.bench_v02]) throw new Error(`${claim.id}: the demo's verdict (${r.verdict.outcome}) is not the benchmark's (${item.bench_v02})`)
        led.record(r.verdict, { tenant_id: TENANT })
        const rec = { verdict: r.verdict, filing: f, item, claim, day }
        recs.set(r.verdict.verdict_id, rec)
        out.push(rec)
      }
      return out
    }
    const PRE = fixture.filings.slice(0, 20), POST = fixture.filings.slice(20, 26), DEC = fixture.filings[26]!
    const pre = PRE.flatMap((f, i) => recordFiling(f, `2026-10-${String(i + 1).padStart(2, '0')}`))
    const first = pre[0]!.verdict
    const WF = `${TENANT}/${first.ruleset.id}@${first.ruleset.version}`
    const count = (rs: Rec[]): Record<string, number> => rs.reduce((a, r) => { a[r.verdict.outcome] = (a[r.verdict.outcome] ?? 0) + 1; return a }, { PASS: 0, FAIL: 0, INSUFFICIENT_DATA: 0 } as Record<string, number>)
    const preBy = count(pre)
    h('(b) real verdicts, rung `record`')
    say(`Versions (pinned): engine ${engineVersion} · verdict schema ${SCHEMA_VERSION} · ruleset ${first.ruleset.id}@${first.ruleset.version} · twin map ${MAP.id}@${MAP.version} · opinion ${OPINION_VERSION} · policy ${DEMO_POLICY.policy_id}@${DEMO_POLICY.version}`)
    say(`Twin: the STATEMENT-ANCHORED map v0.2 (binds only facts the filing's presentation places on a face statement), the map`)
    say(`the benchmark pre-registered and passed. v0.1 is the library's default map; v0.2.1's held-out pre-registration failed.`)
    say(`Data: ${PRE.length} real 10-K filings (FY2024/25; the first 20 of the benchmark's audit sample, in its sha256 order), the values`)
    say(`an agent extracted from each (${new Set(PRE.map(f => f.model)).size} agents: ${[...new Set(PRE.map(f => f.model))].join(', ')}), six promoted face-statement cells.`)
    say(`Fixture sha256 ${fixtureSha.slice(0, 16)}… (source files: ${Object.entries(fixture.source.files).map(([k, v]) => `${k} ${v.slice(0, 8)}`).join(', ')}).`)
    say(`Each value is checked on its own (one claim, one verdict): the unit the benchmark audited. ${pre.length} verdicts recorded Oct 1-20:`)
    say(`  PASS ${preBy.PASS} · FAIL ${preBy.FAIL} · ABSTAIN ${preBy.INSUFFICIENT_DATA}   (every outcome equals the benchmark's own twin v0.2 outcome for the item)`)

    // ── (c) signed reviews ──────────────────────────────────────────────────────────────────────────────────────────
    const correct = (r: Rec): boolean => r.item.gold !== undefined && r.item.gold.value === r.item.value
    const reviewOf = (r: Rec): 'UPHELD' | 'OVERTURNED' => (r.verdict.outcome === 'PASS') === correct(r) ? 'UPHELD' : 'OVERTURNED'
    const review = (r: Rec, decision: 'UPHELD' | 'OVERTURNED'): void => {
      led.reviewSigned(signDecision(makeReview({ verdict_id: r.verdict.verdict_id, tenant_id: TENANT, decision, procedure: 're-performed', signer_id: 'reviewer', signed_at: nowIso() }), REVIEWER.priv))
    }
    at('2026-10-21')
    const preReviewed = pre.filter(r => r.verdict.outcome !== 'INSUFFICIENT_DATA')
    for (const r of preReviewed) review(r, reviewOf(r))
    const falseFlags = preReviewed.filter(r => r.verdict.outcome === 'FAIL' && reviewOf(r) === 'OVERTURNED')
    const misses = preReviewed.filter(r => r.verdict.outcome === 'PASS' && reviewOf(r) === 'OVERTURNED')
    h('(c) signed reviews (a census of the PASSes and FAILs)')
    say(`LABELS: the reviewer's decisions are the benchmark's GOLD LABELS: an independent model reader (claude-sonnet-5) read each`)
    say(`printed statement blind, then adjudicated. Not a human. A real deployment's reviewer is a person; the labels stand in.`)
    say(`Rule: a PASS is UPHELD when the printed value equals the extracted one; a FAIL is UPHELD when it does not.`)
    say(`${preReviewed.length} signed reviews, each an Ed25519 signature by the registered reviewer, procedure 're-performed':`)
    say(`  PASS reviewed ${preBy.PASS}, overturned ${misses.length} (a miss: the check passed a wrong value)`)
    say(`  FAIL reviewed ${preBy.FAIL}, overturned ${falseFlags.length} (a false flag: the check failed a correct value)`)
    for (const r of falseFlags) say(`    the false flag: ${r.filing.name.trim()}, ${r.item.field} = ${r.item.value.toLocaleString('en-US')}; the statement prints "${r.item.gold!.displayed}" (${r.item.gold!.row}). The filer tagged the printed line with a disposal-group variant of the concept the map binds.`)
    say(`  ABSTAIN ${preBy.INSUFFICIENT_DATA}: routed to a person to correct, never auto-accepted, and no calibration signal either way.`)

    // ── (d) assessment + opinion ────────────────────────────────────────────────────────────────────────────────────
    at('2026-10-22')
    const assess = (tier?: string): VoiceAssessment => assessVoiceFromLedger(led, WF, DEMO_POLICY, { ...(tier ? { consequence_tier: tier } : {}), root_keys: ROOTS })
    const rungLine = (r: RungAssessment): string => {
      const c = r.confidence, w = wilsonInterval(r.errors, r.n, c).upper, cp = clopperPearsonInterval(r.errors, r.n, c).upper
      return `  ${r.rung.padEnd(8)} ${r.metric.padEnd(16)} ${String(r.errors).padStart(2)}/${String(r.n).padEnd(4)} upper(${Math.round(c * 100)}% one-sided): Wilson ${pct(w).padStart(7)} · Clopper-Pearson ${pct(cp).padStart(7)}   bar ≤ ${pct(r.bar.max_error, 0)}, n ≥ ${r.bar.min_n}   ${r.cleared ? 'CLEARED' : 'not cleared'}`
    }
    const a0 = assess(TIER)
    const high = assess('high')
    h('(d) the voice assessment')
    say(`Workflow ${WF}; tier '${TIER}' (the deployment owner's declaration: ${DEMO_POLICY.tiers[0]!.description})`)
    for (const r of a0.rungs) say(rungLine(r))
    say(`Earned: ${a0.earned}. Granted: ${a0.granted}. Proposal on the table: ${a0.proposal ? `${a0.proposal.kind} ${a0.proposal.from} → ${a0.proposal.to}` : 'none'} (one rung at a time).`)
    say(`The same evidence under tier 'high' (a filing workpaper: 1% at 95%, n ≥ 299; gate ≤ 5%, n ≥ 59) earns only: ${high.earned}.`)
    for (const r of high.rungs.filter(x => !x.cleared)) say(`  ${r.rung}: ${r.reason}`)

    // ── (e) grants: the controller walks the ladder, answering each proposal ───────────────────────────────────────
    h('(e) a person moves the rung')
    const ladder: string[] = []
    let a = a0
    let autonomyOpinion = ''
    while (a.proposal && a.proposal.kind === 'PROMOTION_PROPOSAL') {
      const p = a.proposal
      if (p.to === 'autonomy') {
        const o = promotionOpinion({ snapshot: snapshotOfLedger(led), policy: DEMO_POLICY, proposal: p, root_keys: ROOTS })
        autonomyOpinion = renderOpinion(o)
        say(`The promotion opinion for ${p.from} → ${p.to} (courtroom form: question, readings, authorities, ruling, dissent, what would overturn it):`)
        doc('opinion', autonomyOpinion)
        say(`(Where the opinion says "human review", it means a review signed by the registered reviewer's key: the engine cannot`)
        say(`tell who holds a key. In this demo those signatures carry the benchmark's model-reader gold labels, as stated in (c).)`)
      }
      const g = grantForProposal(p, { signer_id: 'controller', signed_at: nowIso(), ...(p.to === 'autonomy' ? { bounds: BOUNDS } : {}) }, DEMO_POLICY)
      const e = led.decide(signDecision(g, CONTROLLER.priv))
      a = assess()
      ladder.push(a.level)
      say(`GRANT ${p.from} → ${p.to}, signed by the controller at ${g.signed_at} (book seq ${e.seq}); the book now reads: ${a.level}.`)
    }
    say(`At ${a.level}: ${JSON.stringify(a.handling)}`)
    say(`Bounds, in the controller's words: "${BOUNDS}".`)

    // ── (f) under autonomy: new work, the surveillance draw, reviews, a miss ───────────────────────────────────────
    h('(f) under autonomy: surveillance')
    const post = POST.flatMap((f, i) => recordFiling(f, `2026-11-${String(i + 2).padStart(2, '0')}`))
    const postBy = count(post)
    say(`Nov 2-7: ${POST.length} more real filings, ${post.length} verdicts: PASS ${postBy.PASS} (accepted without a person) · FAIL ${postBy.FAIL} and ABSTAIN ${postBy.INSUFFICIENT_DATA} (held for a person).`)
    const dec = recordFiling(DEC, '2026-12-01')
    say(`Dec 1: the agent's next filing (${dec.length} values; the benchmark's next filing in the same order, no gold labels) closes November.`)
    const committed = commitDueSamples(led, WF, DEMO_POLICY)
    const nov = committed.find(s => s.sample.period.start.startsWith('2026-11'))
    if (!nov) throw new Error(`no November draw was committed (committed: ${committed.map(s => s.sample.period.start).join(', ') || 'none'})`)
    const s: SampleBody = nov.sample
    const chainNow = parseChainJSONL(led.chainJSONL())
    const again = deriveSample(chainNow.events, chainNow.payloads, { workflow_id: WF, unit: s.period.unit, start: s.period.start, rates: s.rates }) as SampleBody
    const rederived = canonicalize(again) === canonicalize(s)
    for (const c of committed) say(`SAMPLE ${c.sample.period.start.slice(0, 7)} committed at seq ${c.seq}: rates PASS ${c.sample.rates.PASS} / FAIL ${c.sample.rates.FAIL}, drawn PASS ${c.sample.selected.PASS.length} / FAIL ${c.sample.selected.FAIL.length}${c === nov ? '' : ' (items already reviewed in the census)'}`)
    say(`The November draw (the first period lived wholly under autonomy):`)
    say(`  seed = sha256 over the workflow, the period and the chain head when the period closed (epoch seq ${s.epoch.seq}, ${s.epoch.entry_hash.slice(0, 16)}…): ${s.seed.slice(0, 16)}…`)
    say(`  population PASS ${s.population.PASS} / FAIL ${s.population.FAIL}; rates PASS ${s.rates.PASS} / FAIL ${s.rates.FAIL}; drawn PASS ${s.selected.PASS.length} / FAIL ${s.selected.FAIL.length}`)
    say(`  anyone holding the book re-derives the same draw: ${rederived ? 'yes (byte-identical)' : 'NO'}`)
    at('2026-12-02')
    const queue = reviewQueue(led, WF, DEMO_POLICY)
    const firstPass = queue.find(q => q.stratum === 'PASS')
    if (!firstPass) throw new Error('the surveillance queue has no PASS')
    const missed = recs.get(firstPass.verdict_id)!
    for (const q of queue) {
      const r = recs.get(q.verdict_id)!
      review(r, q.verdict_id === firstPass.verdict_id ? 'OVERTURNED' : reviewOf(r))
    }
    const realOver = queue.filter(q => q.verdict_id !== firstPass.verdict_id && reviewOf(recs.get(q.verdict_id)!) === 'OVERTURNED').length
    say(`Dec 2: the reviewer works the queue: ${queue.length} items (due by ${queue[0]!.due_by.slice(0, 10)}); gold labels as decisions; ${realOver} real overturns.`)
    say(`SYNTHETIC MISS: the benchmark has no gold-wrong value that twin v0.2 passed (0 of 340 audited auto-accepts), so the demo`)
    say(`plants one. The first PASS the draw selected, ${missed.filing.name.trim()} ${missed.item.field} = ${missed.item.value.toLocaleString('en-US')},`)
    say(`is reviewed OVERTURNED as if the filer had printed and tagged the same wrong figure: the one error class a twin cannot see.`)
    say(`The gold label says this value is correct. Everything else in the queue is decided by its real gold label.`)
    const a4 = assess()
    const d4 = a4.proposal as DemotionProposal | undefined
    if (!d4 || d4.kind !== 'DEMOTION_PROPOSAL') throw new Error(`expected a demotion proposal, got ${a4.proposal?.kind ?? 'none'}`)
    const auto = a4.rungs.find(r => r.rung === 'autonomy')!
    say(`The assessment: ${d4.kind}, basis '${d4.basis}', urgent ${d4.urgent}, ${d4.from} → ${d4.to}. The rung is still ${a4.level}: a proposal moves nothing.`)
    for (const why of d4.reasons) say(`  reason: ${why}`)
    say(rungLine(auto))
    say(`  (the pooled bound still clears the bar; the proposal is raised because the miss came AFTER the grant, under autonomy)`)
    const demOpinion = promotionOpinion({ snapshot: snapshotOfLedger(led), policy: DEMO_POLICY, proposal: d4, root_keys: ROOTS })
    say(`The opinion on it rules: ${demOpinion.ruling.disposition}: ${demOpinion.ruling.statement}`)

    // ── (g) the person's decision ───────────────────────────────────────────────────────────────────────────────────
    h('(g) the controller decides')
    at('2026-12-03')
    const g5 = grantForProposal(d4, { signer_id: 'controller', signed_at: nowIso(), note: 'accepted: back to gate until the miss is explained' }, DEMO_POLICY)
    const e5 = led.decide(signDecision(g5, CONTROLLER.priv))
    const a5 = assess()
    say(`ACCEPTED: a signed GRANT ${d4.from} → ${d4.to} by the controller (book seq ${e5.seq}). The book reads: ${a5.level}. FAILs and ABSTAINs hold; PASSes go to a person again.`)

    // ── (h) the tenant report ───────────────────────────────────────────────────────────────────────────────────────
    h('(h) the tenant report')
    const report = renderTenantReport(led, { tenant_id: TENANT, voice: { policy: DEMO_POLICY, book: led }, period: { since: '2026-11-01T00:00:00.000Z', until: '2026-12-01T00:00:00.000Z', label: '2026-11' } })
    const reAsk = /### Asking for \(\d+\)[\s\S]*?\*\*Promotion\*\*[^\n]*`gate` → `autonomy`/.test(report)
    say(`${report.split('\n').length} lines${opts.keep ? '; also written to report.md in the run directory' : ''}.`)
    doc('tenant report', report)
    if (reAsk) {
      say(`NOTE (a finding, not a feature): the same day the controller stepped the workflow down, the report asks to promote it`)
      say(`back to autonomy. The step-down grant restarts the post-grant window, so the pre-grant miss no longer counts as`)
      say(`surveillance, and the pooled bound (1/272) still clears 5%. Nothing requires new evidence after a failure-basis demotion.`)
    }

    // ── (i) completeness reconciliation ────────────────────────────────────────────────────────────────────────────
    h('(i) completeness: did every accepted value go through the control?')
    const popRows: Record<string, unknown>[] = []
    let n = 0
    const post_ = (item: string, amount: number, day: string, label?: string): void => { popRows.push({ posting_id: `P-${String(++n).padStart(4, '0')}`, item, amount, posted_on: day, ...(label ? { label } : {}) }) }
    for (const r of post) if (r.verdict.outcome === 'PASS') post_(r.claim.id, r.item.value, r.day)
    const heldFail = post.find(r => r.verdict.outcome === 'FAIL')!
    post_(heldFail.claim.id, heldFail.item.value, heldFail.day, 'SYNTHETIC: a held FAIL posted anyway, before any review')
    const byp = POST.find(f => f.unchecked_value)!
    post_(`${byp.adsh}.${byp.model}.${byp.unchecked_value!.field}`, byp.unchecked_value!.value, '2026-11-02', 'SYNTHETIC: a real extracted value posted without ever being checked')
    const popText = popRows.map(r => JSON.stringify(r)).join('\n') + '\n'
    writeFileSync(join(dir, 'postings-2026-11.jsonl'), popText)
    const MAPPING: CompletenessMapping = {
      mapping_version: 'completeness-mapping-v0', key: ['invoice_number'],
      population: { columns: { payment_id: 'posting_id', invoice_number: 'item', amount: 'amount', payment_date: 'posted_on' } },
      book: { fields: { invoice_number: [{ extraction: '0.id' }], amount: [{ extraction: '0.value' }] } },
    }
    const extractions = [...recs.values()].map(r => [{ id: r.claim.id, field: r.claim.field, value: r.claim.value }])
    for (const [i, x] of extractions.entries()) if (hashOf(x) !== [...recs.values()][i]!.verdict.document.extraction_hash) throw new Error('an extraction sidecar does not hash to its verdict')
    const rec = reconcileCompleteness(readPopulationJSONL(popText), led, MAPPING, {
      scope: { tenant_id: TENANT, workflows: [WF] }, period: { since: '2026-11-01T00:00:00.000Z', until: '2026-12-01T00:00:00.000Z' },
      extractions, anchors: { root_keys: ROOTS },
    })
    say(`SYNTHETIC population: the dataset's November postings (one row per value it accepted), derived from the same items: every`)
    say(`PASS posted on the day it was checked, held items not posted, plus two PLANTED rows: a held FAIL posted anyway, and a real`)
    say(`extracted value (${byp.unchecked_value!.field}, outside the six cells) posted without a check. ${popRows.length} rows.`)
    say(`  population by class: ${Object.entries(rec.population.by_class).map(([k, v]) => `${k} ${v}`).join(' · ')}`)
    say(`  book by class:       ${Object.entries(rec.book.by_class).map(([k, v]) => `${k} ${v}`).join(' · ')}`)
    for (const x of rec.exceptions.paid_despite_hold) say(`  PAID DESPITE HOLD: ${x.population.payment_id} ${String(x.book.verdict_id).slice(0, 12)}… held at ${x.hold?.rung} by the grant in force at the record; review: ${x.hold?.resolution}`)
    for (const x of rec.exceptions.bypassed) say(`  BYPASSED: ${x.population.payment_id} (${x.reason})`)
    say(`  coverage: ${rec.coverage.on_book}/${rec.coverage.population_rows} rows on the book; ${rec.coverage.bound.words} upper bound on the not-on-book rate: ${pct(rec.coverage.bound.not_on_book_upper)}`)
    say(`  orphans (on the book, never posted): ${rec.exceptions.orphans.length}, of which held: ${rec.exceptions.orphans.filter(o => o.held).length} (the control working)`)
    const recMd = renderCompletenessReport(rec)
    doc('completeness reconciliation', recMd)

    // ── attacks on the same book ────────────────────────────────────────────────────────────────────────────────────
    h('attacks on the same book')
    const headBefore = led.chainHead()
    let doorRefused = false
    const selfGrant = () => signDecision(makeGrant({ workflow_id: WF, level: 'autonomy', consequence_tier: TIER, policy: policyRef(DEMO_POLICY), bounds: 'all', signer_id: 'extraction-agent', signed_at: nowIso() }), AGENT.priv)
    try { led.decide(selfGrant()) } catch (e) { doorRefused = e instanceof DecisionRefused; say(`D-ANCHOR 1, the door: the agent signs itself a GRANT to autonomy. Refused: ${(e as Error).message.slice(0, 160)}`) }
    say(`  the book is unchanged: ${led.chainHead() === headBefore}`)
    // The splice: a copy of the book, opened with no anchors (a "default" book), takes the self-grant; the deployment reads it anchored.
    const copyPath = join(dir, 'attack-copy.jsonl')
    copyFileSync(bookPath, copyPath)
    let spliced: string
    {
      const loose = openFileLedger(copyPath, { now: tick })
      try {
        loose.decide(selfGrant()); loose.close()
        const anchored = openFileLedger(copyPath, { readOnly: true, root_keys: ROOTS })
        const db = anchored.decisionBook()
        if (!db.ok) spliced = `it fails closed; the anchored reader refuses the whole copy (no rung is read from a broken book): ${db.check.reason}`
        else {
          const ax = assessVoiceFromLedger(anchored, WF, DEMO_POLICY, { root_keys: ROOTS })
          spliced = `on the book, no effect: the rung reads ${ax.level}; ${noEffect(db, { workflow_id: WF }).map(x => x.notice).join(' ') || '(no notice)'}`
        }
        anchored.close()
      } catch (e) { spliced = `refused even on an unanchored copy: ${(e as Error).message.slice(0, 160)}` }
    }
    say(`D-ANCHOR 2, the splice: on a copy opened with no anchors, the self-grant is appended; read with the root key: ${spliced}`)
    // A flipped outcome, replayed against the real filing.
    const full = fixture.full!
    const fullFiling = fixture.filings.find(f => f.adsh === full.adsh)!
    const target = [...recs.values()].find(r => r.filing.adsh === full.adsh && r.verdict.outcome === 'FAIL')!
    const inputsOf = (r: Rec): unknown => twinVerdictInput(r.filing.twin.sha256, [r.claim], { periodEnd: r.filing.period_end, map: MAP, presentation: r.filing.presentation })
    const forged = structuredClone(target.verdict) as Verdict
    forged.outcome = 'PASS'
    forged.claims[0]!.outcome = 'PASS'
    forged.coverage = { ...forged.coverage, claims_pass: 1, claims_fail: 0 }
    const rForged = verifyReplay(forged, inputsOf(target), { document: full.html, presentation: full.presentation })
    const rForgedBare = verifyReplay(forged, inputsOf(target))
    say(`R1, a forged outcome: ${fullFiling.name.trim()} ${target.item.field} FAIL rewritten to PASS.`)
    say(`  replayed against the real filing: ${rForged.status}${rForged.ok ? '' : ` (${(rForged.reason ?? "").slice(0, 200)})`}`)
    say(`  replayed without the filing:      ${rForgedBare.status}: outcome_verified ${rForgedBare.outcome_verified} (a signature or a hash is not a re-performance)`)
    // A torn tail.
    const tornPath = join(dir, 'torn-copy.jsonl')
    copyFileSync(bookPath, tornPath)
    appendFileSync(tornPath, '{"seq":99999,"ts":"2026-12-03T10:00:00.000Z","type":"REC')
    let torn: string
    try {
      const t = openFileLedger(tornPath, { root_keys: ROOTS })
      let append = 'an append was accepted'
      try { t.record(target.verdict, { tenant_id: TENANT }) } catch (e) { append = `an append is refused (${(e as Error).name})` }
      torn = `opens read-only (torn: ${t.torn ? `line ${t.torn.line}, ${t.torn.bytes} bytes` : 'none'}); ${t.all().length} records read, content verifies: ${t.verifyContent().ok}; ${append}`
      t.close()
    } catch (e) { torn = `does not open: ${(e as Error).message.slice(0, 160)}` }
    say(`R5, a torn tail (a crash mid-append): the book ${torn}`)

    // ── (j) the whole book, verified; every verdict re-performed ───────────────────────────────────────────────────
    h('(j) the whole book')
    led.close()
    const bookBytes = readFileSync(bookPath)
    const chain = parseChainJSONL(bookBytes.toString('utf8'))
    const links = verifyChain(chain.events)
    const check = verifyChainAgainst(chain.events, ev => chain.payloads[ev.seq])
    const reopened = openFileLedger(bookPath, { readOnly: true, root_keys: ROOTS })
    const content = reopened.verifyContent()
    let fromFixture = 0, fromFiling = 0
    for (const r of recs.values()) {
      const again = verifyAgainstTwin(twinOf(r.filing), [r.claim], { periodEnd: r.filing.period_end, map: MAP, presentation: r.filing.presentation, producer: r.filing.model, now: () => new Date(r.verdict.issued_at), ...engineOpt })
      if (canonicalize(replayView(again.verdict)) !== canonicalize(replayView(r.verdict))) throw new Error(`${r.claim.id}: re-performance differs`)
      fromFixture++
      if (r.filing.adsh === full.adsh) {
        const rp = verifyReplay(r.verdict, inputsOf(r), { document: full.html, presentation: full.presentation })
        if (rp.status !== 'REPERFORMED') throw new Error(`${r.claim.id}: replay from the filing: ${rp.status}`)
        fromFiling++
      }
    }
    const bookSha = createHash('sha256').update(bookBytes).digest('hex')
    say(`verifyChain (links): ${links.ok ? 'OK' : 'BROKEN'}; verifyChainAgainst (every payload hash): ${check.ok ? 'OK' : `BROKEN at ${check.brokenAt}: ${check.reason}`} over ${chain.events.length} events; content (every signature, grant, review, draw): ${content.ok ? 'OK' : content.reason}`)
    say(`head ${reopened.chainHead()}; book file sha256 ${bookSha}`)
    say(`Re-performed: all ${fromFixture} verdicts from the stored twins, byte-identical; the ${fromFiling} of ${full.adsh} also through`)
    say(`verifyReplay from the real filing's bytes (REPERFORMED). The builder proved the stored twins give the full filings' verdicts.`)
    reopened.close()

    if (opts.keep) { writeFileSync(join(dir, 'narrative.txt'), lines.join('\n') + '\n'); writeFileSync(join(dir, 'opinion.md'), autonomyOpinion); writeFileSync(join(dir, 'report.md'), report); writeFileSync(join(dir, 'reconciliation.md'), recMd) }

    return {
      versions: { engine: engineVersion, schema: SCHEMA_VERSION, ruleset: `${first.ruleset.id}@${first.ruleset.version}`, map: `${MAP.id}@${MAP.version}`, opinion: OPINION_VERSION, policy: `${DEMO_POLICY.policy_id}@${DEMO_POLICY.version}`, fixture_sha256: fixtureSha },
      workflow_id: WF,
      record: { verdicts: pre.length, by_outcome: preBy, reviewed: preReviewed.length, overturned: falseFlags.length + misses.length },
      assessment: { earned: a0.earned, rungs: a0.rungs.map(r => ({ rung: r.rung, n: r.n, errors: r.errors, upper: r.upper, cleared: r.cleared })), high_tier_earned: high.earned },
      ladder,
      surveillance: { period: s.period.start, seed: s.seed, population: s.population, drawn: { PASS: s.selected.PASS.length, FAIL: s.selected.FAIL.length }, rederived, synthetic_miss: missed.claim.id },
      demotion: { kind: d4.kind, basis: d4.basis, urgent: d4.urgent, from: d4.from, to: d4.to, opinion_disposition: demOpinion.ruling.disposition },
      after_decision: { level: a5.level, report_reasks_promotion: reAsk },
      reconcile: {
        by_class: rec.population.by_class, paid_despite_hold: rec.exceptions.paid_despite_hold.map(x => x.population.payment_id ?? ''),
        bypassed: rec.exceptions.bypassed.map(x => x.population.payment_id ?? ''), report_hash: rec.report_hash,
        coverage: { rows: rec.coverage.population_rows, on_book: rec.coverage.on_book, upper: rec.coverage.bound.not_on_book_upper },
      },
      attacks: { door_refused: doorRefused, spliced, forged_replay: rForged.status, forged_structure_only: rForgedBare.status, torn },
      chain: { ok: links.ok && check.ok && content.ok, length: chain.events.length, head: chain.events[chain.events.length - 1]!.entry_hash, book_sha256: bookSha },
      replay: { reperformed_from_fixture: fromFixture, reperformed_from_filing: fromFiling, total: recs.size },
      ...(opts.keep ? { dir } : {}),
    }
  } finally {
    if (!opts.keep) rmSync(dir, { recursive: true, force: true })
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const keep = process.argv.includes('--keep')
  const r = runDemo({ log: l => console.log(l), keep, documents: !process.argv.includes('--brief') })
  console.log()
  console.log(`book ${r.chain.book_sha256}${r.dir ? ` · kept in ${r.dir}` : ' · temp files removed'}`)
}
