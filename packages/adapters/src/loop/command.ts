/**
 * `riposte-loop-run` (2026-10-03, T3): run a deterministic stand-in agent through the closed loop over a file of cases, writing
 * one loop bundle per case and a summary. No model runs.
 *
 *   riposte-loop-run ap --cases <cases.jsonl> --erp <erp.json> --out <dir> [--key <ed25519 pem>] [--source-name erp]
 *       a case: { "id", "invoice", "history"? }  (the invoice text the agent was given; it proposes to pay with the PO from the
 *       structured source record whose key the invoice names, supplies what the remedies name, concedes on a FAIL). "history":
 *       the invoices already booked, [] when none, carried on the loop's task (2026-10-05, engine 0.6.0: without it the
 *       duplicate check does not run, and an approve cannot pay)
 *   riposte-loop-run reread --cases <cases.jsonl> --ruleset <ruleset.json> --out <dir> [--key <pem>] [--agent standin|naive]
 *                            [--discipline on|off]
 *       a case: { "id", "input_sha256", "extraction", "source": { "text", "quotes" }, "readings": [R2, R3] }
 *       (R2/R3: { name, text, values: { <path>: value }, quotes: { <path>: quote } }, two alternative readings of the page)
 *
 * With RIPOSTE_GOV_* set (the bin), every round is first checked by the fleet's governance (../governance.ts): a refusal
 * closes that case HELD-FOR-HUMAN before the round is submitted, and the receipt goes to RIPOSTE_GOV_RECEIPTS.
 *
 * Each bundle replays with `riposte-loop replay <dir>/<id>.loop.json` (receipts). Exit 0 when every case ran, 3 on a usage error.
 */
import type { DeclarativeProposal, LoopTask } from 'riposte-ai'
import type { DeclarativeRuleset } from 'riposte-verify'
import { runLoop, type LoopAgentImpl, type LoopGovernance } from './driver.js'
import { apStandIn, naiveRecompute, rereadStandIn, type Reading } from './standins.js'

export const LOOP_RUN_USAGE = [
  'riposte-loop-run ap --cases <cases.jsonl> --erp <erp.json> --out <dir> [--key <pem>] [--source-name erp]',
  'riposte-loop-run reread --cases <cases.jsonl> --ruleset <ruleset.json> --out <dir> [--key <pem>] [--agent standin|naive] [--discipline on|off]',
].join('\n')

export interface LoopRunIo {
  readFile: (path: string) => string
  writeFile: (path: string, text: string) => void
  mkdir: (path: string) => void
  join: (...parts: string[]) => string
  sha256: (text: string) => string
  /** the governance check before each round (the bin builds it from RIPOSTE_GOV_*); absent: no governance */
  governance?: LoopGovernance
}

export async function loopRunCli(argv: string[], io: LoopRunIo): Promise<{ code: number; out: string; err: string }> {
  const usage = (msg?: string): { code: number; out: string; err: string } => ({ code: msg ? 3 : 0, out: '', err: `${msg ? `${msg}\n` : ''}${LOOP_RUN_USAGE}\n` })
  const mode = argv[0]
  if (!mode || mode === '--help' || mode === '-h') return usage()
  if (mode !== 'ap' && mode !== 'reread') return usage(`unknown mode ${mode}`)
  const f: Record<string, string> = {}
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]!
    if (!['--cases', '--erp', '--out', '--key', '--source-name', '--ruleset', '--agent', '--discipline'].includes(a)) return usage(`unknown argument ${a}`)
    const v = argv[++i]
    if (!v || v.startsWith('--')) return usage(`${a} needs a value`)
    f[a.slice(2)] = v
  }
  if (!f.cases || !f.out) return usage('--cases and --out are required')
  if (mode === 'ap' && !f.erp) return usage('ap: --erp <erp.json> is required')
  if (mode === 'reread' && !f.ruleset) return usage('reread: --ruleset <ruleset.json> is required')
  if (f.agent && !['standin', 'naive'].includes(f.agent)) return usage('--agent is standin or naive')
  if (f.discipline && !['on', 'off'].includes(f.discipline)) return usage('--discipline is on or off')
  let cases: Record<string, unknown>[]
  let erp: Record<string, string> = {}
  let ruleset: DeclarativeRuleset | undefined
  let key: string | undefined
  try {
    cases = io.readFile(f.cases).split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l) as Record<string, unknown>)
    if (f.erp) erp = JSON.parse(io.readFile(f.erp)) as Record<string, string>
    if (f.ruleset) ruleset = JSON.parse(io.readFile(f.ruleset)) as DeclarativeRuleset
    if (f.key) key = io.readFile(f.key)
  } catch (e) { return { code: 3, out: '', err: `cannot read the inputs: ${(e as Error).message}\n` } }
  io.mkdir(f.out)
  const summary: Record<string, unknown>[] = []
  for (const c of cases) {
    const id = String(c.id)
    let agent: LoopAgentImpl
    let task
    if (mode === 'ap') {
      const invoice = String(c.invoice ?? '')
      agent = apStandIn(invoice, erp, { ...(f['source-name'] ? { source: f['source-name'] } : {}) })
      const key0 = Object.keys(erp).filter((k) => k.length >= 3 && invoice.includes(k))
      if (c.history !== undefined && !Array.isArray(c.history)) return usage(`case ${id}: "history" is a list of the invoices already booked ([] when none)`)
      task = { kind: 'ap-text' as const, item_id: id, input_sha256: io.sha256(invoice), ...(c.history !== undefined ? { history: c.history as NonNullable<LoopTask['history']> } : {}) }
      const structuredSources = key0.length === 1 ? { [`${f['source-name'] ?? 'erp'}:${key0[0]}`]: erp[key0[0]!]! } : {}
      const run = await runLoop(task, agent, { ...(key ? { signingKey: key } : {}), loopId: id, structuredSources }, io.governance)
      io.writeFile(io.join(f.out, `${id}.loop.json`), JSON.stringify(run.bundle))
      summary.push({ id, outcome: run.closed.outcome, rounds_used: run.closed.rounds_used, reason: run.closed.reason, top_hash: run.bundle.top_hash, rounds: run.rounds })
    } else {
      const round1: DeclarativeProposal = { kind: 'declarative', decision: 'accept', extraction: c.extraction as Record<string, unknown>, ...(c.source ? { source: c.source as DeclarativeProposal['source'] } : {}) }
      const readings = c.readings as [Reading, Reading]
      agent = f.agent === 'naive' ? naiveRecompute(round1) : rereadStandIn(round1, readings, ruleset!)
      task = { kind: 'declarative' as const, item_id: id, input_sha256: String(c.input_sha256 ?? ''), ruleset: ruleset! }
      const run = await runLoop(task, agent, { ...(key ? { signingKey: key } : {}), loopId: id, discipline: f.discipline !== 'off' }, io.governance)
      io.writeFile(io.join(f.out, `${id}.loop.json`), JSON.stringify(run.bundle))
      summary.push({ id, outcome: run.closed.outcome, rounds_used: run.closed.rounds_used, reason: run.closed.reason, top_hash: run.bundle.top_hash, rounds: run.rounds })
    }
  }
  io.writeFile(io.join(f.out, 'summary.jsonl'), summary.map((s) => JSON.stringify(s)).join('\n') + '\n')
  const n = (o: string): number => summary.filter((s) => s.outcome === o).length
  return { code: 0, out: `${JSON.stringify({ cases: summary.length, converged_pass: n('CONVERGED-PASS'), converged_fail: n('CONVERGED-FAIL'), held: n('HELD-FOR-HUMAN') })}\n`, err: '' }
}
