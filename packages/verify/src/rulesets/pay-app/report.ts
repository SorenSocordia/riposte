/**
 * A pay-application verdict in plain words (2026-10-05): the block `verify <payapp.json> --ruleset pay-app`
 * prints on stderr after its headline, as `verify ap` does for a bill. Before, a failed pay application printed only
 * "verify: FAIL: 1 of 44 checks failed", and the failing line, its figures and who may clear it were in the JSON alone.
 *
 *   FAIL. Do not pay this application as it stands.
 *   Application 3 · period to 2026-09-30 · Example Mechanical Services
 *   Failed:
 *     - line 3: previous work plus this period plus stored materials adds to 72,100, but completed to date says 72,000
 *       read: schedule_of_values[2].previous = 24000; schedule_of_values[2].this_period = 48100; ...
 *       who may clear it: the person who certifies the application (the architect, on AIA G702) (certifier)
 *   Checks: 43 passed, 1 failed, 0 could not run.
 *   The full verdict is the JSON on stdout.
 *
 * Rendering only: it reads the verdict (and the extraction, for the heading) and never changes either. Deterministic; no I/O.
 */
import type { ClaimVerdict, Evidence, Verdict } from '../../verdict/schema.js'

const ROLE: Readonly<Record<string, string>> = {
  certifier: 'the person who certifies the application (the architect, on AIA G702)',
  owner: 'the owner',
}

/**
 * Who a ruling role is, in words, for the payer the reader is (2026-10-13). The pay-app ruleset names the AIA owner's role
 * `owner`, and a ruling is signed for that role. When the reader paying the application is not the AIA owner (a subcontractor
 * reviewing a sub-tier's application), "the owner" names someone else: the words say "the payer's controller" and keep the
 * ruling role in brackets. The AIA title is printed only when payer_role says owner.
 */
function roleWords(authority: string, payer: 'owner' | 'payer'): string {
  if (authority === 'owner') return payer === 'owner' ? 'the owner (owner)' : "the payer's controller (ruling role: owner)"
  return `${ROLE[authority] ?? authority} (${authority})`
}

const clip = (s: string, n = 160): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/**
 * 2026-10-06: every role the pay-app ruleset binds, in the form's words. A remedy the ruleset does not declare
 * is derived from the claim's insufficiency and may name a role ("supply PREVIOUS_COMPLETED_TO_DATE: ..."); on screen it reads
 * as the form does. The JSON keeps the remedy as issued.
 */
const ROLE_WORDS: Readonly<Record<string, string>> = {
  ORIGINAL_CONTRACT_SUM: 'the original contract sum (line 1)', NET_CHANGE_ORDERS: 'the net change by change orders (line 2)',
  CONTRACT_SUM_TO_DATE: 'the contract sum to date (line 3)', TOTAL_COMPLETED_STORED: 'the total completed and stored (line 4)',
  RETAINAGE_RATE: 'the retainage rate', RETAINAGE_TOTAL: 'the total retainage (line 5)', TOTAL_EARNED_LESS_RETAINAGE: 'the total earned less retainage (line 6)',
  PREVIOUS_CERTIFICATES: 'the previous certificates (line 7)', CURRENT_PAYMENT_DUE: 'the current payment due (line 8)',
  BALANCE_INCL_RETAINAGE: 'the balance to finish, including retainage (line 9)', SCHEDULED_VALUE: 'the scheduled value (column C)',
  WORK_PREVIOUS: 'the work from previous applications (column D)', WORK_THIS_PERIOD: 'the work this period (column E)',
  MATERIALS_STORED: 'the materials presently stored (column F)', COMPLETED_TO_DATE: 'the total completed and stored to date (column G)',
  PERCENT_COMPLETE: 'the percent complete', BALANCE_TO_FINISH: 'the balance to finish (column H)', LINE_RETAINAGE: 'the retainage (column I)',
  PREVIOUS_COMPLETED_TO_DATE: "last month's completed to date for the line", PREVIOUS_EARNED_LESS_RETAINAGE: "last month's total earned less retainage",
  EXPECTED_COMPLETED_TO_DATE: 'previous work plus this period plus stored materials', EXPECTED_BALANCE_TO_FINISH: 'the scheduled value less completed to date',
  EXPECTED_PERCENT_COMPLETE: 'completed to date over the scheduled value', EXPECTED_CONTRACT_SUM_TO_DATE: 'the original contract sum plus change orders',
  SOV_SCHEDULED_SUM: 'the scheduled values added up', SOV_COMPLETED_SUM: "the lines' completed to date added up", SOV_RETAINAGE_SUM: "the lines' retainage added up",
  EXPECTED_RETAINAGE_TOTAL: 'the retainage rate applied to the total completed and stored', EXPECTED_EARNED_LESS_RETAINAGE: 'the total completed and stored less retainage',
  EXPECTED_CURRENT_PAYMENT_DUE: 'earned less retainage less previous certificates', EXPECTED_BALANCE_INCL_RETAINAGE: 'the contract sum to date less earned less retainage',
  DOCUMENT_ID: 'the application number', SOV_ITEM_ID: 'the item number', SOV_DESCRIPTION: 'the description of work', CURRENCY_CODE: 'the currency',
}
/** A sentence with every role name in the form's words. */
export const formWords = (s: string): string => s.replace(/\b[A-Z][A-Z_]*_[A-Z_]*[A-Z]\b/g, (m) => ROLE_WORDS[m] ?? m)

/**
 * One document field a claim read, as "path = value" (computed values and spans are left out: the explanation gives them). A
 * line claim's own fields carry the line's index in place of "[*]" (`line` is the index from the claim id).
 */
function readOf(e: Evidence, line: string | undefined): string | null {
  if (e.locator.kind !== 'field' || e.locator.source === 'computed') return null
  const shown = e.original !== undefined ? e.original : e.value
  const path = line !== undefined ? e.locator.path.replace('[*]', `[${line}]`) : e.locator.path
  return `${e.locator.source === 'history' ? 'last month: ' : ''}${path} = ${JSON.stringify(shown)}`
}

export interface PayAppReportOptions {
  /** the extraction the verdict was made on, for the heading (application number, period, contractor) */
  extraction?: Record<string, unknown>
  /** at most this many claims listed per section (default 12); the rest are counted */
  maxClaims?: number
  /**
   * 2026-10-13: who pays the application. 'owner' (the AIA owner) prints the AIA title, "the owner (owner)"; 'payer', the
   * default, names whoever pays it, "the payer's controller (ruling role: owner)". Words only: the verdict is unchanged.
   */
  payer_role?: 'owner' | 'payer'
}

/** The plain-English block for a pay-application verdict. Ends with a newline. */
export function formatPayAppReport(v: Verdict, opts: PayAppReportOptions = {}): string {
  const out: string[] = []
  const failed = v.claims.filter((c) => c.outcome === 'FAIL')
  const open = v.claims.filter((c) => c.outcome === 'INSUFFICIENT_DATA')
  // 2026-10-05: a check that ran and found the application's figures disagree (retainage under the rate that applies,
  // say) is a person's decision, said as such, apart from a check that could not run
  const forPerson = open.filter((c) => String(c.insufficiency?.reason ?? '').startsWith('AMBIGUOUS'))
  const couldNot = open.filter((c) => !forPerson.includes(c))
  const openWords = [couldNot.length ? `${couldNot.length} could not run` : '', forPerson.length ? `${forPerson.length} ${forPerson.length === 1 ? 'needs' : 'need'} a person` : ''].filter(Boolean).join(' and ')
  out.push(failed.length ? 'FAIL. Do not pay this application as it stands.'
    : open.length && v.coverage.claims_checked === 0 ? 'A PERSON DECIDES. No check could run. Do not pay this application automatically.'
      : open.length ? `A PERSON DECIDES. Every check that ran held, but ${openWords}. Do not pay this application automatically.`
        : 'PASS. Every check ran and held.')
  const x = opts.extraction ?? {}
  const pick = (...keys: string[]): string | null => {
    for (const k of keys) { const val = x[k]; if (typeof val === 'string' && val.trim() || typeof val === 'number') return String(val) }
    return null
  }
  const head = [pick('application_number', 'application_no', 'pay_app_number') ? `Application ${pick('application_number', 'application_no', 'pay_app_number')}` : null,
    pick('period_to') ? `period to ${pick('period_to')}` : null, pick('contractor'), pick('project')].filter(Boolean)
  if (head.length) out.push(head.join(' · '))
  // 2026-10-05: how the retainage was read, on every answer where its check passed (a lower retainage the application
  // states is named here, never only in the JSON); a retainage check that did not pass is printed in its section below
  const rate = v.claims.find((c) => c.rule_id === 'G702_RATE' && c.outcome === 'PASS')
  if (rate) out.push(`Retainage: ${clip(rate.explanation.replace(/\s+/g, ' ').trim(), 400)}`)
  // 2026-10-06: how continuity with last month was read, where it was read another way than "previous = last month's
  // column G": the form's own column D convention, stored materials carried in G, and each change order the application accounts for
  const readings = v.claims.filter((c) => c.rule_id === 'G703_PREV' && c.outcome === 'PASS').flatMap((c) => {
    const e = c.evidence.find((x) => x.locator.kind === 'field' && x.locator.source === 'computed')
    const line = /^line\[(\d+)\]/.exec(c.claim_id)?.[1]
    return e?.locator.kind === 'field' && line !== undefined ? [{ n: Number(line) + 1, path: e.locator.path }] : []
  })
  const nums = (ns: readonly number[]): string => (ns.length === 1 ? `line ${ns[0]}` : `lines ${ns.slice(0, -1).join(', ')} and ${ns[ns.length - 1]}`)
  const formD = readings.filter((r) => /form's own heading/.test(r.path)).map((r) => r.n)
  const carriedG = readings.filter((r) => /column D read as last month's column G/.test(r.path)).map((r) => r.n)
  if (formD.length) out.push(`Previous work: ${nums(formD)} ${formD.length === 1 ? 'reads' : 'read'} column D by the form's own heading, "from previous application (D + E)": stored materials are not in D, and move to this period when installed.`)
  if (carriedG.length) out.push(`Previous work: ${nums(carriedG)} ${carriedG.length === 1 ? 'reads' : 'read'} column D as last month's completed to date (column G), stored materials included.`)
  for (const r of readings.filter((x) => /change order/.test(x.path))) {
    // the change-order words start where the line's change is named ("line 8 is new this month", "line 3's scheduled value")
    const k = r.path.search(/line \d+ is new this month|line \d+'s scheduled value/)
    const said = k >= 0 ? r.path.slice(k) : r.path
    out.push(`Change order: ${clip(`${said.charAt(0).toUpperCase()}${said.slice(1)}`.replace(/\s+/g, ' ').trim(), 400)}.`)
  }

  const max = opts.maxClaims ?? 12
  const remedies = v.remedies ?? []
  const section = (title: string, claims: readonly ClaimVerdict[], settle: boolean): void => {
    if (!claims.length) return
    out.push(title)
    for (const c of claims.slice(0, max)) {
      out.push(`  - ${clip(formWords(c.explanation).replace(/\s+/g, ' ').trim(), 400)}`)
      const line = /^line\[(\d+)\]/.exec(c.claim_id)?.[1]
      const reads = [...new Set(c.evidence.map((e) => readOf(e, line)).filter((s): s is string => s !== null))]
      if (reads.length) out.push(`    read: ${clip(reads.slice(0, 5).join('; '), 300)}${reads.length > 5 ? `; and ${reads.length - 5} more` : ''}`)
      const mine = remedies.filter((m) => m.claims.includes(c.claim_id))
      const who = [...new Set(mine.filter((m) => m.kind === 'authority' && m.authority).map((m) => roleWords(m.authority!, opts.payer_role ?? 'payer')))]
      if (who.length) out.push(`    who may clear it: ${who.join('; ')}, for this application only`)
      if (settle) {
        const need = mine.find((m) => m.kind === 'missing-operand')
        if (need) out.push(`    what would settle it: ${clip(formWords(need.detail).replace(/\s+/g, ' ').trim(), 300)}`)
      }
    }
    if (claims.length > max) out.push(`  - (${claims.length - max} more in the JSON)`)
  }
  section('Failed:', failed, false)
  section('A person decides:', forPerson, true)
  section('Could not run:', couldNot, true)
  out.push(`Checks: ${v.coverage.claims_pass} passed, ${v.coverage.claims_fail} failed, ${v.coverage.claims_insufficient} could not run.`)
  out.push('The full verdict is the JSON on stdout.')
  return `${out.join('\n')}\n`
}
