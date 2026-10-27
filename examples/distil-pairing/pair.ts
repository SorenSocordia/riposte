/**
 * A model decides, a deterministic check recomputes, only agreement executes: Distil Labs' published AP decisions, gated.
 *
 *   npx tsx examples/distil-pairing/pair.ts                        all seven published configurations
 *   npx tsx examples/distil-pairing/pair.ts --check                also check the published table against BENCHMARK-AP.md
 *   npx tsx examples/distil-pairing/pair.ts --decisions mine.json  your own model's decisions (format: README.md)
 *
 * Two parts, kept apart on purpose:
 *   1. THE PUBLISHED TABLE. The blind, frozen checker's recorded run (bench/ap/results/run-1.jsonl) against each published
 *      decision: the audit table of packages/verify/docs/BENCHMARK-AP.md, reprinted, never recomputed by another checker.
 *   2. THE LIVE GATE. Every decision through the library (apGate from riposte-ai), one hashes-only receipt each on a hash-chained
 *      ledger. The library's checker was tuned on these invoices (the disclosed run 2), so these numbers are labelled and were
 *      pre-registered (PREREG.md). They show the gate's behaviour, not an accuracy result.
 * Plus a flip-stability column: the option-order flip probe (riposte-ai flipProbe) over a decider's typed answers, when
 * answers recorded under several option orders are supplied (--flip-recorded). Distil published one order, so by default the
 * column says "not measured".
 *
 * Data: Distil Labs' invoice-processing-pipeline (Apache-2.0), copied under bench/ap/data/distil/. No model is called.
 */
import { mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateSigningKeypair, splitApLayout, structuredFromText, type ApDocuments, type ApStructuredInput } from 'riposte-verify'
import {
  apGate, fileStore, flipProbe, hashesOnlyBody, keyFingerprint, memoryStore, openLedger, recordedTransport, verifyChain,
  type ApGateResult, type ChoiceAnswer, type FlipResult, type Ledger, type RecordedChoice, type SystemOneRequest,
} from 'riposte-ai'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')

const USAGE = `pair.ts [options]
  --decisions <file>       a decision file (repeatable): JSON in this example's format, or a Distil decider .jsonl
                           (default: the seven published decider files under --data)
  --check                  check the published table against --benchmark, byte for byte (exit 1 if it differs)
  --path text|structured|both   gate the invoice text, the structured input read from it, or both and compare (default both)
  --flip-recorded <file>   JSONL of answers recorded under several option orders: { configuration, id, order, answer }
  --out <dir>              write each configuration's receipts ledger there (default: in memory)
  --sign                   sign every receipt with a key made for this run (prints its fingerprint)
  --now <iso>              the clock for verdicts and receipts (default: now)
  --data <dir>             Distil's data (default bench/ap/data/distil)
  --run1 <file>            the blind checker's recorded run (default bench/ap/results/run-1.jsonl)
  --benchmark <file>       BENCHMARK-AP.md (default packages/verify/docs/BENCHMARK-AP.md)`

interface Args { data: string; run1: string; benchmark: string; decisions: string[]; flip?: string; out?: string; path: 'text' | 'structured' | 'both'; check: boolean; sign: boolean; now?: string; help: boolean }
function parseArgs(argv: string[]): Args {
  const a: Args = { data: join(ROOT, 'bench', 'ap', 'data', 'distil'), run1: join(ROOT, 'bench', 'ap', 'results', 'run-1.jsonl'),
    benchmark: join(ROOT, 'packages', 'verify', 'docs', 'BENCHMARK-AP.md'), decisions: [], path: 'both', check: false, sign: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]!
    const v = (): string => { const x = argv[++i]; if (x === undefined) throw new Error(`${t} needs a value`); return x }
    if (t === '--data') a.data = v(); else if (t === '--run1') a.run1 = v(); else if (t === '--benchmark') a.benchmark = v()
    else if (t === '--decisions') a.decisions.push(v()); else if (t === '--flip-recorded') a.flip = v(); else if (t === '--out') a.out = v()
    else if (t === '--path') { const p = v(); if (p !== 'text' && p !== 'structured' && p !== 'both') throw new Error('--path is text, structured or both'); a.path = p }
    else if (t === '--check') a.check = true; else if (t === '--sign') a.sign = true; else if (t === '--now') a.now = v()
    else if (t === '-h' || t === '--help') a.help = true
    else throw new Error(`unknown option ${t}`)
  }
  return a
}

// ── decisions ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
interface Decision { id: string; decision: string; gold?: string; confidence?: number; typed?: ChoiceAnswer }
/** What the decider answered with: one choice question (the flip probe applies), yes/no questions (no option order), or labels only. */
type Answers = 'choice' | 'yes-no' | 'labels'
interface DecisionSet { name: string; label: string; decisions: Map<string, Decision>; answers: Answers }

/** Distil's published configurations, in BENCHMARK-AP.md's order, with the labels it prints. */
const PUBLISHED: [string, string][] = [
  ['jev-single', 'Jev — single question'], ['jev-checks', 'Jev — one question per check'], ['jev-lines', 'Jev — one question per line & check'],
  ['gemini-3.5-flash-lite', 'Gemini 3.5 Flash Lite'], ['gpt-5.6-luna', 'GPT-5.6 Luna'], ['glm-5.3-high', 'GLM-5.3 (high)'],
  ['gpt-5.6-luna-high', 'GPT-5.6 Luna (high reasoning)'],
]
const LABELS = ['approve', 'hold_no_po', 'hold_quantity', 'hold_price', 'hold_total']
/** A decision is right when it is the gold label; a bare "hold" is right on any gold hold (it holds, as the gold says to). */
const isRight = (decision: string, g: string | undefined): boolean => decision === g || (decision === 'hold' && g !== undefined && g.startsWith('hold_'))
const isObj = (x: unknown): x is Record<string, any> => typeof x === 'object' && x !== null && !Array.isArray(x)

/** A decision file: a Distil decider .jsonl, or JSON { configuration?, decisions: [{ id, decision | action+reason, confidence? }] }. */
function readDecisions(file: string): DecisionSet {
  const text = readFileSync(file, 'utf8')
  const decisions = new Map<string, Decision>()
  if (file.endsWith('.jsonl')) {
    const name = basename(file).replace(/^decider__|\.jsonl$/g, '')
    let answers: Answers = 'labels'
    for (const l of text.trim().split('\n')) {
      const r = JSON.parse(l)
      const typed = isObj(r.answers?.decision) && r.answers.decision.type === 'choice' ? r.answers.decision as ChoiceAnswer : undefined
      const vals = isObj(r.answers) ? Object.values(r.answers) : []
      if (typed) answers = 'choice'
      else if (vals.length && vals.every((v) => isObj(v) && v.type === 'boolean')) answers = 'yes-no'
      decisions.set(r.id, { id: r.id, decision: r.prediction, gold: r.gold, ...(typed ? { typed, confidence: typed.confidence } : {}) })
    }
    return { name, label: PUBLISHED.find(([n]) => n === name)?.[1] ?? name, decisions, answers }
  }
  const j = JSON.parse(text)
  if (!isObj(j) || !Array.isArray(j.decisions)) throw new Error(`${file}: expected { "decisions": [ { "id", "decision" } ] }`)
  for (const d of j.decisions) {
    const decision = typeof d.decision === 'string' ? d.decision : d.action === 'pay' ? 'approve' : d.action === 'hold' ? (d.reason ?? 'hold') : undefined
    if (typeof d.id !== 'string' || !decision) throw new Error(`${file}: each decision needs "id" and "decision" (or "action": "pay" | "hold")`)
    decisions.set(d.id, { id: d.id, decision, ...(typeof d.confidence === 'number' ? { confidence: d.confidence } : {}) })
  }
  const name = typeof j.configuration === 'string' ? j.configuration : basename(file, '.json')
  return { name, label: name, decisions, answers: 'labels' }
}

// ── part 1: the published table, from the blind checker's recorded run ───────────────────────────────────────────────────
const TABLE_HEAD = ['| AI configuration (Distil\'s published runs) | wrong decisions | wrong **approvals** (bad invoice paid) | caught | wrong auto-payments | auto-paid |', '|---|---|---|---|---|---|']

function publishedTable(run1: Map<string, { got: { outcome: string; decision: string | null } }>, sets: DecisionSet[], gold: Map<string, string>): string[] {
  const rows: string[] = []
  for (const [name, label] of PUBLISHED) {
    const s = sets.find((x) => x.name === name)
    if (!s) continue
    let wrong = 0, wrongApprove = 0, caught = 0, auto = 0, wrongAuto = 0
    for (const d of s.decisions.values()) {
      const right = isRight(d.decision, d.gold ?? gold.get(d.id))
      if (!right) { wrong++; if (d.decision === 'approve') wrongApprove++ }
      const c = run1.get(d.id)
      const agree = c !== undefined && c.got.outcome === 'DECIDED' && c.got.decision === d.decision
      if (agree) { auto++; if (!right) wrongAuto++ } else if (!right) caught++
    }
    rows.push(`| ${label} | ${wrong} | ${wrongApprove} | ${wrong ? `${caught} / ${wrong}` : '—'} | **${wrongAuto}** | ${auto} |`)
  }
  return [...TABLE_HEAD, ...rows]
}

// ── part 2: the live gate ────────────────────────────────────────────────────────────────────────────────────────────────
interface Tally { n: number; pay: number; hold: number; disagree: number; abstain: number; unstable: number; wrong: number; caught: number; wrongAuto: number; correct: number; flip: string }
const request = (state: string): SystemOneRequest => ({
  state, questions: { decision: { type: 'choice', instructions: 'Pay or hold this invoice under the four-check policy.', criteria: Object.fromEntries(LABELS.map((l) => [l, null])) } },
})

async function main(argv: string[]): Promise<number> {
  const a = parseArgs(argv)
  if (a.help) { console.log(USAGE); return 0 }
  const now = a.now ? () => new Date(a.now!) : () => new Date()
  const cases = readFileSync(join(a.data, 'invoice_cases.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { id: string; input: string; decision: string })
  const gold = new Map(cases.map((c) => [c.id, c.decision]))
  const files = a.decisions.length ? a.decisions
    : readdirSync(join(a.data, 'results')).filter((f) => /^decider__.*\.jsonl$/.test(f)).sort().map((f) => join(a.data, 'results', f))
  // the published configurations in the published table's order, then any others
  const rank = (s: DecisionSet): number => { const i = PUBLISHED.findIndex(([n]) => n === s.name); return i < 0 ? PUBLISHED.length : i }
  const sets = files.map(readDecisions).sort((x, y) => rank(x) - rank(y))

  // 1. the published table
  const run1 = new Map<string, { checker_sha256: string; got: { outcome: string; decision: string | null } }>()
  for (const l of readFileSync(a.run1, 'utf8').trim().split('\n')) { const r = JSON.parse(l); run1.set(r.id, r) }
  const table = publishedTable(run1, sets, gold)
  let status = 0
  if (table.length > TABLE_HEAD.length) {
    console.log(`1. THE PUBLISHED TABLE: the blind, frozen checker (sha256 ${[...run1.values()][0]!.checker_sha256.slice(0, 16)}…, its recorded run) against each published decision\n`)
    console.log(table.join('\n'))
    if (a.check) {
      const doc = readFileSync(a.benchmark, 'utf8')
      const same = doc.includes(table.join('\n'))
      console.log(same ? `\ncheck: these lines are BENCHMARK-AP.md's Result 2 table, byte for byte (${table.length} lines)` : '\ncheck FAILED: the table differs from BENCHMARK-AP.md\'s')
      if (!same) status = 1
    }
  }

  // 2. the live gate
  const paths: ('text' | 'structured')[] = a.path === 'both' ? ['text', 'structured'] : [a.path]
  const docsOf = new Map<string, { text: ApDocuments; structured?: ApStructuredInput }>()
  for (const c of cases) {
    const text = splitApLayout(c.input)
    if (!text) throw new Error(`${c.id}: not a three-section layout`)
    const s = structuredFromText(text)
    docsOf.set(c.id, { text, ...(s.ok ? { structured: s.input } : {}) })
  }
  const recorded = new Map<string, RecordedChoice[]>()
  if (a.flip) {
    for (const l of readFileSync(a.flip, 'utf8').trim().split('\n')) {
      const r = JSON.parse(l)
      const k = `${r.configuration}\u0000${r.id}`
      recorded.set(k, [...(recorded.get(k) ?? []), { question: 'decision', order: r.order, answer: r.answer }])
    }
  }
  const key = a.sign ? generateSigningKeypair() : undefined
  if (a.out) mkdirSync(a.out, { recursive: true })

  console.log(`\n2. THE LIVE GATE: every decision through apGate (riposte-ai), checker ap-threeway@0.2.0. NOT BLIND: this checker carries\n   the two wording rules tuned on these invoices (the disclosed run 2). Pre-registered in PREREG.md. Not an accuracy result.\n`)
  const byPath = new Map<string, Map<string, ApGateResult>>()
  const tallies: [DecisionSet, Tally, Ledger][] = []
  for (const s of sets) {
    const ledger = openLedger(a.out ? fileStore(join(a.out, `${s.name}.receipts.jsonl`), { now }) : memoryStore(), { ...(key ? { signingKey: key.privateKeyPem } : {}), now })
    const t: Tally = { n: 0, pay: 0, hold: 0, disagree: 0, abstain: 0, unstable: 0, wrong: 0, caught: 0, wrongAuto: 0, correct: 0, flip: '' }
    let probed = 0, stable = 0, typed = 0
    for (const c of cases) {
      const d = s.decisions.get(c.id)
      if (!d) continue
      const docs = docsOf.get(c.id)!
      for (const p of paths) {
        const input = p === 'text' ? docs.text : docs.structured
        if (!input) continue
        const g = apGate(d.decision, input, { now })
        const m = byPath.get(p) ?? new Map<string, ApGateResult>()
        m.set(`${s.name}\u0000${c.id}`, g)
        byPath.set(p, m)
        if (p !== paths[0]) continue
        // the flip probe, when answers recorded under several orders exist for this decision
        let flip: FlipResult | undefined
        if (d.typed) typed++
        const recs = recorded.get(`${s.name}\u0000${c.id}`)
        if (d.typed && recs && recs.length > 1) {
          try { flip = (await flipProbe(recordedTransport(recs), request(c.id)))['decision']; probed++; if (flip?.stable) stable++ } catch { /* an order nobody recorded: not measured */ }
        }
        const right = isRight(d.decision, d.gold ?? gold.get(c.id))
        const unstable = flip !== undefined && !flip.stable
        const executes = g.action === 'EXECUTE' && !unstable
        t.n++
        if (right) t.correct++; else t.wrong++
        if (executes) { if (g.effect === 'PAY') t.pay++; else t.hold++; if (!right) t.wrongAuto++ }
        else {
          if (unstable && g.action === 'EXECUTE') t.unstable++
          else if (g.checker_decision === 'abstain') t.abstain++
          else t.disagree++
          if (!right) t.caught++
        }
        ledger.append('ap_gate', { ...hashesOnlyBody(g, input), example: { configuration: s.name, case: c.id, ...(flip ? { flip: { stable: flip.stable, flip_rate: flip.flipRate } } : {}) } })
      }
    }
    t.flip = probed ? `${stable} / ${probed} stable` : typed ? 'not measured: 1 order published'
      : s.answers === 'yes-no' ? 'n/a: yes/no questions, no option order' : 'n/a: labels only, no typed answer'
    tallies.push([s, t, ledger])
  }
  console.log('| configuration | gated | executed: pay | executed: hold | to a person: check disagrees | to a person: check abstains | to a person: flips | wrong decisions | caught | wrong auto-executions | flip stability |')
  console.log('|---|---|---|---|---|---|---|---|---|---|---|')
  for (const [s, t] of tallies) console.log(`| ${s.label} | ${t.n} | ${t.pay} | ${t.hold} | ${t.disagree} | ${t.abstain} | ${t.unstable} | ${t.wrong} | ${t.wrong ? `${t.caught} / ${t.wrong}` : '—'} | **${t.wrongAuto}** | ${t.flip} |`)

  // the receipts
  console.log(`\nreceipts (hashes only: no invoice text; one per gated decision${a.out ? `, written to ${a.out}` : ', in memory'}${key ? `; signed by a key made for this run, ${keyFingerprint(key.publicKeyPem)}` : '; unsigned'}):`)
  for (const [s, , ledger] of tallies) {
    const chain = verifyChain(ledger.entries(), key ? { publicKey: key.publicKeyPem, requireSigned: true } : {})
    console.log(`  ${s.name.padEnd(22)} ${String(chain.length).padStart(3)} entries · chain ${chain.ok ? 'verified' : `BROKEN at ${chain.broken_at}: ${chain.reason}`} · signed ${chain.signed} · head ${chain.head.slice(0, 16)}…`)
    if (!chain.ok) status = 1
  }
  const first = tallies[0]
  if (first) {
    console.log(`  the first three of ${first[0].name}:`)
    for (const e of first[2].entries().slice(0, 3)) {
      const b = e.body as Record<string, any>
      console.log(`    #${e.seq} ${b.example.case} ${b.action} ${b.effect} model=${b.model_decision} check=${b.checker_decision} verdict=${b.verdict_id} hash=${e.hash.slice(0, 16)}…`)
    }
  }

  // the structured path, decision by decision
  let pathsAgree: boolean | undefined
  if (paths.length === 2) {
    const tx = byPath.get('text')!, st = byPath.get('structured') ?? new Map()
    const diff = [...tx].filter(([k, g]) => { const h = st.get(k); return !h || h.action !== g.action || h.effect !== g.effect || h.checker_decision !== g.checker_decision })
    console.log(`\nstructured path (each invoice converted from the text parser's own reading, ruleset ap-structured@0.1.0): ${diff.length ? `${diff.length} of ${tx.size} gated decisions differ: ${diff.slice(0, 5).map(([k]) => k.replace('\u0000', ' ')).join(', ')}` : `the same action, effect and checker decision on all ${tx.size} gated decisions`}`)
    pathsAgree = diff.length === 0
    if (diff.length) status = 1
  }

  // the pre-registered predictions (PREREG.md), checked against what just ran
  const pub = tallies.filter(([s]) => PUBLISHED.some(([n]) => n === s.name))
  if (pub.length) {
    const p1 = pub.every(([, t]) => t.wrongAuto === 0)
    const p2 = pub.every(([, t]) => t.caught === t.wrong)
    const p3 = pub.every(([, t]) => t.pay + t.hold === t.correct && t.abstain === 0)
    console.log(`\npre-registered predictions (PREREG.md), on the ${pub.length} published configurations:`)
    console.log(`  1. zero wrong auto-executions in each: ${p1 ? 'held' : 'MISSED'} (${pub.map(([, t]) => t.wrongAuto).join(', ')})`)
    console.log(`  2. every wrong decision to a person: ${p2 ? 'held' : 'MISSED'} (caught ${pub.reduce((x, [, t]) => x + t.caught, 0)} of ${pub.reduce((x, [, t]) => x + t.wrong, 0)})`)
    console.log(`  3. executed = correct decisions, none abstained: ${p3 ? 'held' : 'MISSED'} (${pub.map(([, t]) => `${t.pay + t.hold}/${t.correct}`).join(', ')})`)
    console.log(`  4. the structured path gives the same matrix: ${pathsAgree === undefined ? 'not run (--path both runs it)' : pathsAgree ? 'held' : 'MISSED'}`)
    console.log(`  5. flip stability not measured: ${pub.every(([, t]) => !/stable$/.test(t.flip)) ? 'held' : 'MISSED'} (${[...new Set(pub.map(([, t]) => t.flip))].join('; ')})`)
    if (!p1) status = Math.max(status, 2)
  }
  return status
}

main(process.argv.slice(2)).then((code) => { process.exitCode = code }, (e) => { console.error(`pair.ts: ${(e as Error).message}\n\n${USAGE}`); process.exitCode = 3 })
