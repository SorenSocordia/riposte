/**
 * The completeness report in words an auditor can read: what it covers (the book head and length, the population hash),
 * the answer (coverage, with its bound), every exception with the row and the verdict it rests on, most severe first, how
 * the matching was declared, and what the report does not prove. Deterministic: the same report renders the same bytes.
 */

import { BOOK_CLASSES, POPULATION_CLASSES, type BookRef, type CompletenessReport, type MatchedItem, type PopulationRef } from './types.js'

export interface RenderCompletenessOptions {
  /** Rows listed per section before "… and N more (in the JSON)". Default 50. */
  max_rows?: number
}

const cell = (s: string | number | undefined): string => (s === undefined || s === '' ? '—' : String(s).replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' '))
const code = (s: string | undefined): string => (s === undefined ? '—' : '`' + s.replace(/`/g, "'").replace(/\|/g, '\\|') + '`')
const pct = (x: number): string => `${Number((x * 100).toPrecision(4))}%`
const money = (t: Record<string, string>): string => {
  const ks = Object.keys(t)
  return ks.length === 0 ? '—' : ks.map(k => `${t[k]} ${k}`).join(' · ')
}
const keyOf = (k: Partial<Record<string, string>>): string => Object.entries(k).map(([f, v]) => `${f}=${v}`).join(', ')
const rowRef = (p: PopulationRef): string => `${p.row}${p.payment_id !== undefined ? ` (${cell(p.payment_id)})` : ''}`
const verdictRef = (b: BookRef): string => `${code(b.verdict_id)} @${b.record_seq}`

const LABEL: Record<string, string> = {
  MATCHED: 'MATCHED', MISMATCHED: 'MISMATCHED', PAID_DESPITE_HOLD: 'PAID DESPITE HOLD', CHECKED_AFTER_PAYMENT: 'CHECKED AFTER PAYMENT',
  AMBIGUOUS: 'AMBIGUOUS', BYPASSED: 'BYPASSED', UNREADABLE: 'UNREADABLE', ORPHAN: 'ORPHAN', UNKEYED: 'UNKEYED',
}

function more(L: string[], total: number, shown: number): void {
  if (total > shown) L.push('', `… and ${total - shown} more (in the JSON report).`)
}

function holdWords(x: MatchedItem): string {
  const h = x.hold
  if (!h) return '—'
  const by = h.rung_from === 'grant' && h.grant ? `GRANT ${code(h.grant.decision_id.slice(0, 12))} by ${cell(h.grant.signer_id)}` : 'declared rung'
  const res = h.resolution === 'NONE' ? 'no person has reviewed it'
    : h.resolution === 'AFTER_PAYMENT' ? `first reviewed ${h.review!.first_decided_at.slice(0, 10)}, after the payment`
    : h.resolution === 'UNORDERED' ? `reviewed (${h.review!.decision}); no payment date to order it by`
    : `reviewed ${h.review!.first_decided_at.slice(0, 10)} (${h.review!.decision})`
  return `held at \`${h.rung}\` (${by}); ${res}`
}

/** Render a completeness report as Markdown. */
export function renderCompletenessReport(r: CompletenessReport, opts: RenderCompletenessOptions = {}): string {
  const max = opts.max_rows ?? 50
  const L: string[] = []
  const pb = r.binds.population
  L.push('# Completeness reconciliation', '')
  L.push(`**What this covers.** The book of record at head ${code(r.binds.book.head)} (${r.binds.book.length} events), verified whole before any record was read, reconciled against the population ${pb.sha256 !== undefined ? code(pb.sha256) : `rows ${code(pb.rows_hash)}`} (${pb.format}${pb.bytes !== undefined ? `, ${pb.bytes} bytes` : ''}, ${pb.rows} rows).`)
  L.push(`Mapping ${code(r.binds.mapping_hash.slice(0, 16))} · options ${code(r.binds.options_hash.slice(0, 16))} · engine ${r.engine_version} · report ${code(r.report_hash)}${r.generated_at ? ` · generated ${r.generated_at}` : ''}.`)
  const sc = [r.scope.tenant_id !== undefined ? `tenant \`${r.scope.tenant_id}\`` : '', r.scope.workflows ? `workflows ${r.scope.workflows.map(w => code(w)).join(', ')}` : '', r.scope.rulesets ? `rulesets ${r.scope.rulesets.map(w => code(w)).join(', ')}` : ''].filter(Boolean)
  const pe = [r.period.since ? `from ${r.period.since}` : '', r.period.until ? `until ${r.period.until}` : ''].filter(Boolean)
  L.push(`Scope: ${sc.length ? sc.join('; ') : 'every record on the book'}. Period (book clock): ${pe.length ? pe.join(' ') : 'the whole book'}.`, '')
  L.push(`> ${r.boundary[0]}`, '')

  // The answer.
  const c = r.coverage
  L.push('## The answer', '')
  L.push(`- **${r.clean ? 'Clean' : 'Not clean'}.** ${c.on_book} of ${c.population_rows} payments (${c.rate === null ? 'n/a' : pct(c.rate)}) went through the check and have exactly one verdict on the book; ${c.not_on_book} did not (BYPASSED ${r.population.by_class.BYPASSED}, AMBIGUOUS ${r.population.by_class.AMBIGUOUS}, UNREADABLE ${r.population.by_class.UNREADABLE}).`)
  L.push(`- **Bound (${c.bound.words}):** the not-on-book rate the data cannot rule out is ${pct(c.bound.not_on_book_upper)} (coverage at least ${pct(c.bound.coverage_lower)}). ${c.note}`)
  if (c.before_payment) L.push(`- **Checked by the payment date:** ${c.before_payment.checked_by_payment_date} of ${c.before_payment.rows_with_date} dated payments on the book; ${c.before_payment.checked_after} were checked only after they were paid.`)
  L.push(`- **Exceptions:** PAID DESPITE HOLD ${r.population.by_class.PAID_DESPITE_HOLD} · MISMATCHED ${r.population.by_class.MISMATCHED} · CHECKED AFTER PAYMENT ${r.population.by_class.CHECKED_AFTER_PAYMENT}. Orphans on the book: ${r.book.by_class.ORPHAN}.`, '')

  L.push('## The population', '')
  L.push('| class | rows | amount |', '|---|---:|---|')
  for (const k of POPULATION_CLASSES) L.push(`| ${LABEL[k]} | ${r.population.by_class[k]} | ${money(r.amounts.by_class[k])} |`)
  L.push(`| **total** | **${r.population.rows}** | **${money(r.amounts.population)}** |`, '')
  if (r.amounts.rows_without_amount) L.push(`${r.amounts.rows_without_amount} row(s) have no readable amount and are not in the totals.`, '')

  // Exceptions, most severe first.
  const pdh = r.exceptions.paid_despite_hold
  L.push(`## PAID DESPITE HOLD (${pdh.length}): a control override`, '')
  if (pdh.length === 0) L.push('None. No payment was made on a FAIL/ABSTAIN that the book held at gate or autonomy without a person\'s resolution.', '')
  else {
    L.push('Paid, while the book says the verdict was held at a holding rung and no person had resolved it by the payment date.', '')
    L.push('| row | key | paid | payment date | verdict | outcome | hold |', '|---|---|---|---|---|---|---|')
    for (const x of pdh.slice(0, max)) L.push(`| ${rowRef(x.population)} | ${cell(keyOf(x.population.key))} | ${cell(x.population.amount)} ${cell(x.population.currency ?? '')} | ${cell(x.population.payment_date)} | ${verdictRef(x.book)} | ${x.book.outcome} | ${holdWords(x)} |`)
    more(L, pdh.length, Math.min(max, pdh.length))
    L.push('')
  }

  const mm = r.exceptions.mismatched
  L.push(`## MISMATCHED (${mm.length}): what was checked is not what was paid`, '')
  if (mm.length === 0) L.push('None.', '')
  else {
    L.push('| row | key | field | paid | on the book | book source | Δ (book − paid) | verdict |', '|---|---|---|---|---|---|---|---|')
    let shown = 0
    for (const x of mm.slice(0, max)) {
      for (const d of x.differences) L.push(`| ${rowRef(x.population)} | ${cell(keyOf(x.population.key))} | ${d.field} | ${cell(d.population)} | ${cell(d.book)} | ${code(d.book_source)} | ${cell(d.delta)} | ${verdictRef(x.book)} |`)
      shown++
    }
    more(L, mm.length, shown)
    L.push('')
  }

  const late = r.exceptions.checked_after_payment
  L.push(`## CHECKED AFTER PAYMENT (${late.length}): the check did not gate these`, '')
  if (late.length === 0) L.push(r.coverage.before_payment ? 'None.' : 'Not assessed: the population declares no payment date.', '')
  else {
    L.push(`Dates compared on the payer's calendar (UTC offset ${r.mapping.payment_date_utc_offset}); a check on the same day as the payment is not flagged.`, '')
    L.push('| row | key | payment date | first on the book | verdict |', '|---|---|---|---|---|')
    for (const x of late.slice(0, max)) L.push(`| ${rowRef(x.population)} | ${cell(keyOf(x.population.key))} | ${x.late!.payment_date} | ${x.late!.first_recorded_day} | ${verdictRef(x.book)} |`)
    more(L, late.length, Math.min(max, late.length))
    L.push('')
  }

  const amb = r.exceptions.ambiguous
  L.push(`## AMBIGUOUS (${amb.length} key${amb.length === 1 ? '' : 's'}, ${r.population.by_class.AMBIGUOUS} row${r.population.by_class.AMBIGUOUS === 1 ? '' : 's'}): not resolved, by design`, '')
  if (amb.length === 0) L.push('None.', '')
  else {
    L.push('| key | shape | rows | verdicts |', '|---|---|---|---|')
    for (const g of amb.slice(0, max)) L.push(`| ${cell(keyOf(g.key))} | ${g.shape === 'POPULATION_DUPLICATES' ? 'several payments, one verdict (a possible duplicate payment)' : g.shape === 'BOOK_DUPLICATES' ? 'one payment, several verdicts' : 'several of each'} | ${g.population.map(rowRef).join(', ')} | ${g.book.map(b => `${verdictRef(b)} ${b.outcome}${b.tenant_id ? ` (${cell(b.tenant_id)})` : ''}`).join(', ')} |`)
    more(L, amb.length, Math.min(max, amb.length))
    L.push('')
  }

  const by = r.exceptions.bypassed
  L.push(`## BYPASSED (${by.length}): paid with no verdict on the book`, '')
  if (by.length === 0) L.push('None.', '')
  else {
    L.push('| row | key | paid | payment date | why |', '|---|---|---|---|---|')
    for (const x of by.slice(0, max)) L.push(`| ${rowRef(x.population)} | ${cell(keyOf(x.population.key))} | ${cell(x.population.amount)} ${cell(x.population.currency ?? '')} | ${cell(x.population.payment_date)} | ${x.reason === 'NO_KEY' ? 'the row has no key value' : 'no in-scope verdict has this key'}${x.duplicate_key ? '; the key repeats in the population' : ''} |`)
    more(L, by.length, Math.min(max, by.length))
    L.push('')
  }

  const un = r.exceptions.unreadable
  if (un.length > 0) {
    L.push(`## UNREADABLE (${un.length}): the declared format could not read these rows`, '')
    L.push('| row | line | column | value | why |', '|---|---|---|---|---|')
    for (const u of un.slice(0, max)) for (const p of u.problems) L.push(`| ${u.row} | ${u.line} | ${cell(p.column)} | ${code(p.value)} | ${cell(p.why)} |`)
    more(L, un.length, Math.min(max, un.length))
    L.push('')
  }

  // The book side.
  const b = r.book
  L.push('## The book side', '')
  L.push(`${b.records} record(s) on the book across ${b.tenants.length} tenant(s); ${b.in_scope} in scope (${b.out_of_scope} outside it${b.not_verdict.length ? `, ${b.not_verdict.length} not a VERDICT` : ''}); ${b.in_period} recorded in the period. ${b.matched_outside_period} record(s) from outside the period matched a payment in it.`, '')
  L.push('| class (in period) | records | amount |', '|---|---:|---|')
  for (const k of BOOK_CLASSES) L.push(`| ${LABEL[k]} | ${b.by_class[k]} | ${money(r.amounts.book_in_period[k])} |`)
  L.push('')
  const or = r.exceptions.orphans
  if (or.length > 0) {
    L.push(`**Orphans (${or.length}).** A verdict in the period with no payment. A held FAIL/ABSTAIN that was never paid is the control working. A PASS orphan was checked and not paid in this population: open, paid elsewhere, or a sign the population is incomplete.`, '')
    L.push('| verdict | outcome | held | reviewed | key | recorded |', '|---|---|---|---|---|---|')
    for (const o of or.slice(0, max)) L.push(`| ${verdictRef(o.book)} | ${o.book.outcome} | ${o.held ? 'yes' : 'no'} | ${o.reviewed ? 'yes' : 'no'} | ${cell(keyOf(o.book.key))} | ${o.book.recorded_at} |`)
    more(L, or.length, Math.min(max, or.length))
    L.push('')
  }
  const uk = r.exceptions.unkeyed
  if (uk.length > 0) {
    L.push(`**Unkeyed (${uk.length}).** A verdict whose declared key could not be read (supply its extraction, or declare a claim source). It could not be matched, so it cannot vouch for any payment.`, '')
    L.push('| verdict | outcome | why |', '|---|---|---|')
    for (const u of uk.slice(0, max)) L.push(`| ${verdictRef(u.book)} | ${u.book.outcome} | ${cell(u.why.join('; '))} |`)
    more(L, uk.length, Math.min(max, uk.length))
    L.push('')
  }
  if (b.not_verdict.length > 0) {
    L.push(`**Not a VERDICT (${b.not_verdict.length}).** Never counted as the control operating.`, '')
    for (const x of b.not_verdict.slice(0, max)) L.push(`- ${code(x.verdict_id)} (${cell(x.tenant_id)}): ${cell(x.why)}`)
    more(L, b.not_verdict.length, Math.min(max, b.not_verdict.length))
    L.push('')
  }
  L.push(`**Rungs.** ${b.rungs.length === 0 ? 'No workflow in scope.' : b.rungs.map(w => `${code(w.workflow_id)}: ${w.from === 'grant' ? 'read from signed GRANTs on the book, at the time of each record' : w.from === 'declared' ? 'declared (no GRANT on the book)' : 'record (nothing granted or declared; nothing is held)'}`).join(' · ')}.`)
  for (const g of b.unanchored_grants) L.push(`GRANT ${code(g.decision_id.slice(0, 12))} (${code(g.level)} for ${code(g.workflow_id)}, by ${cell(g.signer_id)}, seq ${g.seq}) is not anchored to a person: it has no effect on any rung here.`)
  if (b.unanchored_signers.length) L.push(`Decision signers not anchored to a person (no trusted keys supplied): ${b.unanchored_signers.map(s => code(s)).join(', ')}.`)
  L.push('')

  const rh = r.resolved_holds
  L.push(`## Holds a person resolved before payment (${rh.count}: UPHELD ${rh.upheld}, OVERTURNED ${rh.overturned})`, '')
  if (rh.count === 0) L.push('None.', '')
  else {
    L.push('Not exceptions. Listed so a person can sample them: an UPHELD FAIL that was then paid means a person confirmed the finding and the payment was made anyway.', '')
    L.push('| row | key | verdict | outcome | review |', '|---|---|---|---|---|')
    for (const x of rh.items.slice(0, max)) L.push(`| ${rowRef(x.population)} | ${cell(keyOf(x.population.key))} | ${verdictRef(x.book)} | ${x.book.outcome} | ${holdWords(x)} |`)
    more(L, rh.count, Math.min(max, rh.count))
    L.push('')
  }
  if (r.matched_with_uncompared > 0) L.push(`${r.matched_with_uncompared} matched row(s) had a compared field missing or unreadable on one side; those fields were not compared (see \`uncompared\` in the JSON).`, '')

  // How it was matched.
  const m = r.mapping
  L.push('## How it was matched (declared)', '')
  L.push(`- **Key:** ${m.key.join(' + ')}. Normalization, both sides, in order (trim → remove → case → leading zeros): ${m.key.map(k => { const n = m.normalize[k]; return `${k}: trim ${n.trim ? 'on' : 'off'}, remove ${n.remove ? code(n.remove) : 'none'}, case ${n.case}, strip leading zeros ${n.strip_leading_zeros ? 'on' : 'off'}` }).join('; ')}.`)
  L.push(`- **Compared on a match:** ${m.compared.length ? m.compared.join(', ') : 'nothing beyond the key'}. Amount tolerance: ${m.amount_tolerance.abs === '0' && m.amount_tolerance.rel === '0' ? 'exact' : `the larger of ${m.amount_tolerance.abs} and ${m.amount_tolerance.rel} × the larger amount`}. Invoice-date tolerance: ${m.date_tolerance_days === 0 ? 'exact' : `${m.date_tolerance_days} day(s)`}. Currency: trimmed, upper-cased, exact.`)
  L.push(`- **Population columns:** ${Object.entries(m.population.columns).map(([f, col]) => `${f} ← ${code(col)}`).join(', ')}. Dates ${m.population.date_format}; amounts decimal ${code(m.population.amount_format.decimal)}, grouping ${m.population.amount_format.group ? code(m.population.amount_format.group) : 'none'}${m.population.amount_format.strip.length ? `, stripping ${m.population.amount_format.strip.map(s => code(s)).join(' ')}` : ''}${m.population.amount_format.parens_negative ? ', (x) negative' : ''}${m.population.amount_format.trailing_minus ? ', trailing minus' : ''}.`)
  L.push(`- **Book fields:** ${Object.entries(m.book.fields).map(([f, s]) => `${f} ← ${(s ?? []).map(x => 'extraction' in x ? `extraction ${code(x.extraction)}` : `claim ${code(x.claim)}`).join(' then ')}`).join('; ')}. An extraction counts only when its hash is the one on the book (${r.binds.extractions.used} of ${r.binds.extractions.distinct} supplied extraction(s) used).`)
  L.push(`- **Payment dates** are the payer's calendar at UTC offset ${m.payment_date_utc_offset}. A malformed population value: ${m.on_malformed === 'refuse' ? 'refused (the default)' : 'reported UNREADABLE'}.`, '')

  L.push('## What this proves, and what it does not', '')
  for (const line of r.boundary) L.push(`- ${line}`)
  L.push('- Why it matters: AS 1105 .10 asks the auditor to "Test the accuracy and completeness of the information, or test the controls over the accuracy and completeness of that information" (PCAOB, quoted from pcaobus.org by the research lane ✓). This report is the completeness half for the book; the population\'s own completeness is tested at its source.')
  L.push('')
  return L.join('\n')
}
