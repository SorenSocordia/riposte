/**
 * A check that could not run says so in a clerk's words (engine 0.6.0, 2026-10-05). A cold reader in cold review round 3 found a
 * TIME_ORD claim on a numeric date whose outcome was INSUFFICIENT_DATA while its explanation read "Law of Temporal Order VIOLATED:
 * Type mismatch for >= comparison": the wrong word for can't tell, in the kernel's own vocabulary.
 *
 * This rewords the explanation of every INSUFFICIENT_DATA claim whose text says a law was VIOLATED. It never touches the outcome, a
 * value, the evidence, the insufficiency (its reason and detail stay the machine record) or an id. verify() calls it only for engine
 * 0.6.0 and later, so a verdict of an earlier engine keeps the kernel's text and replays byte for byte.
 */
import type { ClaimVerdict, Evidence } from './schema.js'

/** What each built-in check asks, as a clause after "Can't tell". A check not listed is named by its rule id. */
export const WHAT: Readonly<Record<string, string>> = {
  TIME_ORD: "whether the service date falls within the contract's term",
  SUM_INT: 'whether the line amounts add up to the subtotal',
  TOTAL_INT: 'whether the total equals the subtotal plus tax, less any discount',
  TAX_INT: 'whether the tax equals the subtotal times the tax rate',
  MATH_INT: "whether the line's amount matches its quantity times its unit price",
  RATE_SUP: "whether the unit price is within the contract's rate",
  QTY_MATCH: 'whether the quantity billed matches the quantity delivered',
  AMT_CAP: "whether the line's amount stays within the contracted limit",
  DUP_PROHIB: 'whether this invoice was already billed',
}

/** Checks whose operands are dates: an unreadable operand there is "not a date". */
const DATE_CHECKS = new Set(['TIME_ORD'])

/** "dates[service_date]" from the invoice reads "the service date"; "effective_date" from the contract, "the contract's effective date". */
function operandName(e: Evidence): string {
  const loc = e.locator as { kind?: string; source?: string; path?: string }
  const path = typeof loc.path === 'string' ? loc.path : ''
  const leaf = (/\[([^\]]+)\]$/.exec(path)?.[1] ?? path.split(/[./]/).filter(Boolean).at(-1) ?? 'a value').replace(/_/g, ' ')
  return loc.source === 'contract' ? `the contract's ${leaf}` : loc.source === 'evidence' ? `the delivery record's ${leaf}` : `the ${leaf}`
}

/** The sentence for one claim. */
export function cantTellSentence(c: Pick<ClaimVerdict, 'rule_id' | 'evidence'>): string {
  const what = WHAT[c.rule_id] ?? `the check ${c.rule_id}`
  const dates = DATE_CHECKS.has(c.rule_id)
  const unread = (c.evidence ?? []).filter(e => Array.isArray(e.normalizations) && e.normalizations.includes('parse_failed'))
  const why = unread.length
    ? unread.map(e => `${operandName(e)} reads ${JSON.stringify(e.value)}, which is not ${dates ? 'a date' : 'a number or a date'}`).join('; ')
    : `a value it needs is not ${dates ? 'a date' : 'a number or a date'} it can compare`
  return `Can't tell ${what}: ${why}, so nothing was compared.${dates ? ' Write the date as YYYY-MM-DD and check again.' : ''}`
}

/** Engine 0.6.0: reword every INSUFFICIENT_DATA claim that says "… VIOLATED: …". In place; outcomes and values untouched. */
export function cantTellInWords(claims: ClaimVerdict[]): void {
  for (const c of claims) {
    if (c.outcome !== 'INSUFFICIENT_DATA' || typeof c.explanation !== 'string' || !/ VIOLATED: /.test(c.explanation)) continue
    c.explanation = cantTellSentence(c)
  }
}
