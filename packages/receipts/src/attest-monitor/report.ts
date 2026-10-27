/**
 * The monthly attestation report: Markdown for people, JSON for machines, both hashed into one signed receipt on the ledger.
 * Rendering is deterministic (no clock in the body); the time of signing lives on the ledger entry.
 */
import { createHash } from 'node:crypto'
import { canonicalize } from 'riposte-verify'
import type { Ledger, LedgerEntry } from '../ledger.js'
import { TIERS, TIER_ORDER, tierTable } from './tiers.js'
import { SWITCH_CAUSES, type MonitorResult, type MonitorSwitch, type ReplyFinding } from './monitor.js'

/** 0.2.0 (2026-10-06): can't tell reads INSUFFICIENT_DATA in the table and the JSON (0.1.0: ABSTAIN). */
export const REPORT_VERSION = 'riposte.attest-report/0.2.0'
const sha = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex')
const pct = (k: number, n: number): string => (n ? `${((100 * k) / n).toFixed(1)}%` : 'n/a')
const cell = (s: unknown): string => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')

/** The report's JSON: canonical, so its hash is stable. */
export function attestReportJson(r: MonitorResult): string {
  return `${canonicalize({ report_version: REPORT_VERSION, ...r } as unknown as Record<string, unknown>)}\n`
}

const switchRow = (s: MonitorSwitch): string =>
  `| ${cell(s.run)} | ${s.reply} | ${cell(s.at ?? '')} | ${cell(s.from)} to ${cell(s.to)} | ${s.cause}${s.host_reason ? ` (${cell(s.host_reason)})` : ''} | ${s.evidence.before.tier}: ${cell(s.evidence.before.refs.join('; ') || 'none')} | ${s.evidence.after.tier}: ${cell(s.evidence.after.refs.join('; ') || 'none')} |`
const findingRow = (f: ReplyFinding, what: string): string =>
  `| ${cell(f.run)} | ${f.reply ?? '-'} | ${cell(f.at ?? '')} | ${cell(f.recorded ?? 'none')} | ${f.tier} | ${cell(what)} |`

export function renderAttestReport(r: MonitorResult): string {
  const L: string[] = []
  const t = r.totals
  L.push(`# Model attestation report: ${r.deployer ?? 'unnamed deployer'}, ${r.month}`, '')
  L.push(`Which model answered each recorded reply, on what evidence, and every model switch with its cause. ${t.replies} replies in ${t.runs} runs; ${t.flags} flag${t.flags === 1 ? '' : 's'}: ${t.silent_switches} silent switch${t.silent_switches === 1 ? '' : 'es'}, ${t.violations} repl${t.violations === 1 ? 'y' : 'ies'} from a model that was not declared, ${t.contradictions} where a provider or anchor record disagrees with the host record, ${t.bucket_shortfalls} bucket${t.bucket_shortfalls === 1 ? '' : 's'} where a provider billed fewer tokens on a model than the host recorded.`, '')
  L.push(`Coverage: ${t.coverage_any} of ${t.replies} replies (${pct(t.coverage_any, t.replies)}) rest on evidence beyond the declaration (T1 or higher).`, '')

  L.push('## Per declared model', '')
  L.push('| declared | runs | replies | T3 | T2 | T1 | T0 | corroborated by an export | coverage | switches: announced / silent | not declared | disagreeing records | buckets billed short | runs PASS / FAIL / INSUFFICIENT_DATA |')
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
  for (const d of r.per_declared) {
    const silent = d.silent_switches.length
    L.push(`| ${cell(d.declared)} | ${d.runs} | ${d.replies} | ${d.by_tier.T3} | ${d.by_tier.T2} | ${d.by_tier.T1} | ${d.by_tier.T0} | ${d.corroborated.T2} (${pct(d.corroborated.T2, d.replies)}) | ${pct(d.coverage.any_evidence, d.coverage.of)} | ${d.switches.user_command} / ${silent} | ${d.violations} | ${d.contradicted} | ${d.bucket_shortfalls} | ${d.outcomes.PASS} / ${d.outcomes.FAIL} / ${d.outcomes.INSUFFICIENT_DATA} |`)
  }
  L.push('', 'Each reply is counted once, at the highest tier that agrees with it. Silent switches by cause:', '')
  L.push('| declared | ' + SWITCH_CAUSES.filter((c) => c !== 'user_command').join(' | ') + ' |', '|---|' + SWITCH_CAUSES.filter((c) => c !== 'user_command').map(() => '---').join('|') + '|')
  for (const d of r.per_declared) L.push(`| ${cell(d.declared)} | ${SWITCH_CAUSES.filter((c) => c !== 'user_command').map((c) => d.switches[c]).join(' | ')} |`)

  L.push('', '## Evidence tiers', '', tierTable(), '')

  const silent = r.runs.flatMap((x) => x.switches.filter((s) => !s.announced))
  L.push('## Silent switches, with evidence', '')
  if (!silent.length) L.push('None.')
  else {
    L.push('| run | reply | at | change | cause | evidence before | evidence after |', '|---|---|---|---|---|---|---|')
    for (const s of silent) L.push(switchRow(s))
  }
  const announced = r.runs.flatMap((x) => x.switches.filter((s) => s.announced))
  L.push('', '## Announced switches (the user asked)', '')
  if (!announced.length) L.push('None.')
  else {
    L.push('| run | reply | at | change | cause | evidence before | evidence after |', '|---|---|---|---|---|---|---|')
    for (const s of announced) L.push(switchRow(s))
  }
  const violations = r.runs.flatMap((x) => x.violations)
  L.push('', '## Replies from a model that was not declared', '')
  if (!violations.length) L.push('None.')
  else {
    L.push('| run | reply | at | recorded | tier | declared |', '|---|---|---|---|---|---|')
    for (const f of violations.slice(0, 200)) L.push(findingRow(f, f.declared))
    if (violations.length > 200) L.push('', `(${violations.length - 200} more in the JSON report)`)
  }
  const contra = r.runs.flatMap((x) => x.contradictions)
  L.push('', '## Records that disagree with the host record', '')
  if (!contra.length) L.push('None.')
  else {
    L.push('| run | reply | at | recorded | tier | what disagrees |', '|---|---|---|---|---|---|')
    for (const f of contra.slice(0, 200)) L.push(findingRow(f, f.conflict ?? ''))
    if (contra.length > 200) L.push('', `(${contra.length - 200} more in the JSON report)`)
  }

  const short = r.runs.flatMap((x) => x.bucket_shortfalls.map((s) => ({ run: x.name, s })))
  L.push('', '## Buckets billed short', '')
  if (!short.length) L.push('None.')
  else {
    L.push('A provider billed a model for fewer tokens in this window than the host recorded on it. No single reply can be blamed, so the bucket is one finding for every run in it.', '')
    L.push('| run | export | window | model | host recorded (in / out) | provider billed (in / out) | replies |', '|---|---|---|---|---|---|---|')
    for (const { run, s } of short) L.push(`| ${cell(run)} | ${s.source} | ${s.start} to ${s.end} | ${cell(s.model)} | ${s.used.input} / ${s.used.output} | ${s.billed.input} / ${s.billed.output} | ${s.replies.length} |`)
  }

  L.push('', '## Runs', '')
  L.push('| run | host record | declared | outcome | replies | T3 / T2 / T1 / T0 | outside the month | unreadable lines | reasons |', '|---|---|---|---|---|---|---|---|---|')
  for (const x of r.runs) L.push(`| ${cell(x.name)} | ${x.format} | ${cell(x.declared)} | ${x.outcome} | ${x.replies} | ${TIER_ORDER.slice().reverse().map((k) => x.by_tier[k]).join(' / ')} | ${x.replies_outside_month} | ${x.rejected_lines} | ${cell(x.reasons.join('; '))} |`)

  L.push('', '## Provider exports used', '')
  if (!r.exports.length) L.push('None. Nothing here rests on T2.')
  else {
    L.push('| export | rows | replies matched | by method | schema | assumed | acknowledged unknown fields |', '|---|---|---|---|---|---|---|')
    for (const e of r.exports) L.push(`| ${e.source} | ${e.rows} | ${e.matched_replies} | ${cell(Object.entries(e.methods).sort().map(([k, v]) => `${k} ${v}`).join(', ') || 'none')} | ${cell(e.doc)} | ${cell(e.assumed.join('; ') || 'none')} | ${cell(e.acknowledged.join(', ') || 'none')} |`)
    const notes = r.exports.flatMap((e) => e.notes.map((n) => `${e.source}: ${n}`))
    if (notes.length) L.push('', ...notes.map((n) => `- ${n}`))
    L.push('', `Joins: by request id (confidence 1.0); by time window (${r.window_seconds} s) and equal token counts (0.9 unique, 0.6 when several rows of the same model fit); by bucket sums (0.3 to 0.8 by bucket width). Nothing is joined on time alone.`)
  }
  if (r.anchors.length) {
    L.push('', '## Anchors (T3)', '', '| ledger | verifies with the pinned key | anchors | signer |', '|---|---|---|---|')
    for (const a of r.anchors) L.push(`| ${cell(a.ledger)} | ${a.ok ? 'yes' : `no: ${cell(a.reason)}`} | ${a.anchors} | ${a.signer ?? ''} |`)
  }

  L.push('', '## What this report cannot prove', '')
  for (const c of r.cannot_prove) L.push(`- ${c}`)
  L.push('', '## How to check this report', '')
  L.push('- The JSON report holds every reply\'s finding: its tier, each piece of evidence (transcript line, export record numbers and join method, anchor seq) and what would raise it.')
  L.push('- The receipt on the ledger holds the sha256 of this file and of the JSON report. `riposte-ledger verify <ledger> --key <public key> --require-signed` checks the chain and the signature.')
  L.push(`- Tier definitions: ${TIER_ORDER.map((k) => `${k} ${TIERS[k].name}`).join(' · ')}.`)
  return `${L.join('\n')}\n`
}

export interface ReportReceipt { report_version: string; month: string; deployer: string | null; report_sha256: string; markdown_sha256: string; totals: MonitorResult['totals']; per_declared: { declared: string; replies: number; flags: number }[] }

/** Put the report on the ledger: one `model_attest_report` receipt holding both hashes and the totals. */
export function signAttestReport(ledger: Ledger, r: MonitorResult, json: string, md: string): LedgerEntry {
  const body: ReportReceipt = {
    report_version: REPORT_VERSION, month: r.month, deployer: r.deployer, report_sha256: sha(json), markdown_sha256: sha(md), totals: r.totals,
    per_declared: r.per_declared.map((d) => ({ declared: d.declared, replies: d.replies, flags: d.silent_switches.length + d.violations + d.contradicted + d.bucket_shortfalls })),
  }
  return ledger.append('model_attest_report', body)
}
