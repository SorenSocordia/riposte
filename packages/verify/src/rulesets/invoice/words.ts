/**
 * The invoice ruleset's explanations in a controller's words (every engine after 0.7.0, 2026-10-13).
 *
 * A cold reader found `claims[].explanation` for TOTAL_INT reading "Law of the Bottom Line: All predicates satisfied.": the
 * kernel's name for the rule and its vocabulary, in output a controller reads. From the engine after 0.7.0 each invoice explanation says
 * what was checked ("total = subtotal + tax − discount") and the figures; a FAIL names both figures and the difference; a check
 * that could not run says what it was not given, in words. The rule's kernel name stays in `rule_name`, an identifier.
 *
 * Only the sentence changes: never an outcome, a value, the evidence, the insufficiency (its reason and detail stay the machine
 * record) or an id. A prefix the rounding pass wrote ("Within tolerance (…): treated as rounding, not error.") and a suffix
 * ("Not treated as rounding: …") are kept. A verdict of an earlier engine keeps the kernel's text and replays byte for byte.
 */
import type { ClaimVerdict } from '../../verdict/schema.js'
import { WHAT } from '../../verdict/cant-tell.js'
import { ENGINE_VERSION, ENGINE_VERSIONS, type EngineVersion } from '../../version.js'

/** The last engine that keeps the kernel's text; every engine opened after it words invoice explanations this way. */
const LAST_KERNEL_TEXT = '0.7.0'

/**
 * True when engine `v` words invoice explanations in a controller's words: every engine after 0.7.0 (the next label a release
 * pass opens, 0.7.1). Until a pass opens one, the open label this build issues under (ENGINE_VERSION) stands in, and no closed
 * label does, so a verdict of 0.7.0 or earlier keeps the kernel's text once the next label is opened.
 */
export function explainsInWords(v: EngineVersion): boolean {
  const last = (ENGINE_VERSIONS as readonly string[]).indexOf(LAST_KERNEL_TEXT)
  return ENGINE_VERSIONS.length - 1 > last ? ENGINE_VERSIONS.indexOf(v) > last : v === ENGINE_VERSION
}

/** What each check asks, written as the relation a controller checks. */
const CHECK: Readonly<Record<string, string>> = {
  SUM_INT: 'subtotal = the sum of the line amounts',
  TOTAL_INT: 'total = subtotal + tax − discount',
  TAX_INT: 'tax = subtotal × tax rate',
  MATH_INT: 'amount = quantity × unit price',
  RATE_SUP: "unit price ≤ the contract's rate",
  AMT_CAP: 'amount ≤ the contracted limit',
  QTY_MATCH: 'quantity billed = quantity delivered',
  TIME_ORD: "the service date falls within the contract's term",
}

/** The checks whose two figures are the invoice's own and the one computed from it (asserted, computation.result). */
const RECOMPUTE = new Set(['SUM_INT', 'TOTAL_INT', 'TAX_INT', 'MATH_INT'])

/** Where a cross-reference check's second figure comes from. */
const AGAINST: Readonly<Record<string, string>> = { RATE_SUP: 'in the contract', AMT_CAP: 'in the contract', QTY_MATCH: 'on the delivery record' }

/** What a role the kernel names is, for a person ("RATE_CONTRACTED" → "a contract rate for this line"). */
const ROLE_WORDS: Readonly<Record<string, string>> = {
  EVENT_DATE: 'the service date on the invoice', CONTRACT_START: "the contract's start date", CONTRACT_END: "the contract's end date",
  RATE_CONTRACTED: 'a contract rate for this line', CONTRACTED_LIMIT: 'a contracted limit for this line',
  ACTUAL_QUANTITY: 'a delivered quantity for this line (a receipt or delivery record)',
  SUBTOTAL: 'the subtotal', TAX_AMOUNT: 'the tax', TAX_RATE: 'the tax rate', GRAND_TOTAL: 'the total', DISCOUNT_AMOUNT: 'the discount',
  LINE_ITEMS_SUM: 'the line amounts', EXPECTED_GRAND_TOTAL: 'the subtotal plus tax, less any discount', EXPECTED_TAX_AMOUNT: 'the subtotal times the tax rate',
  CLAIMED_AMOUNT: "the line's amount", VERIFIED_AMOUNT: "the line's quantity times its unit price", UNIT_PRICE: 'the unit price', QUANTITY: 'the quantity',
}
const roleWords = (r: string): string => ROLE_WORDS[r] ?? r.toLowerCase().replace(/_/g, ' ')

/** Thousands separated: "1894.92" → "1,894.92". */
const grouped = (text: string): string => text.replace(/^(\d+)/, (w) => w.replace(/\B(?=(\d{3})+(?!\d))/g, ','))

/** A figure as a controller reads it: thousands separated, two decimals, more only where the figure carries them (up to 4). */
function figure(x: unknown): string {
  if (typeof x !== 'number' || !Number.isFinite(x)) return typeof x === 'string' ? x : JSON.stringify(x) ?? String(x)
  const abs = Math.abs(x)
  const cents = Math.abs(abs * 100 - Math.round(abs * 100)) < 1e-6
  let text = cents ? abs.toFixed(2) : abs.toFixed(4).replace(/0+$/, '')
  if (text.endsWith('.')) text += '00'
  else if (/\.\d$/.test(text)) text += '0'
  return `${x < 0 ? '-' : ''}${grouped(text)}`
}
/** A difference, always to two decimals ("5.00"). */
const money2 = (x: number): string => grouped(Math.abs(x).toFixed(2))
/** A count as written ("10", "9.5"): quantities are not money. */
const count = (x: unknown): string => (typeof x === 'number' && Number.isFinite(x) ? `${x < 0 ? '-' : ''}${grouped(String(Math.abs(x)))}` : figure(x))
/** A cross-reference check's figure: a count for the quantity check, a sum of money for the others. */
const crossFigure = (rule: string, x: unknown): string => (rule === 'QTY_MATCH' ? count(x) : figure(x))

// No sentence names a line: the claim's id does (line[1]), and the invoice remedies' "Line {line}" counts the same way, so an
// explanation that said "line 2" would disagree with both (test/remedy-position.test.ts).

/** Which of a check's two figures is the invoice's own and which was computed from it. For TOTAL_INT, TAX_INT and MATH_INT the
 * invoice's figure is `asserted` and the recomputation is `computation.result`. SUM_INT is the other way round: its predicate is
 * LINE_ITEMS_SUM = SUBTOTAL, so `asserted` is the computed line sum and `computation.result` the subtotal the invoice states.
 * (Named the wrong way round until 2026-10-13, under the open 0.7.1 label; found by the Python second engine's port.) */
function twoFigures(ruleId: string, asserted: number, result: number): { computed: number; invoice: number } {
  return ruleId === 'SUM_INT' ? { computed: asserted, invoice: result } : { computed: result, invoice: asserted }
}

/** The PASS sentence for a check that holds. */
function passWords(c: ClaimVerdict): string {
  const check = CHECK[c.rule_id]!
  const a = c.asserted, r = c.computation?.result
  if (RECOMPUTE.has(c.rule_id) && typeof a === 'number' && typeof r === 'number') {
    const { computed, invoice } = twoFigures(c.rule_id, a, r)
    return `${check}: ${figure(computed)} computed, ${figure(invoice)} on the invoice${Math.abs(invoice - computed) < 0.005 ? ', the same to the cent' : ''}`
  }
  if (AGAINST[c.rule_id] && a !== null && a !== undefined && r !== undefined) return `${check}: ${crossFigure(c.rule_id, a)} on the invoice, ${crossFigure(c.rule_id, r)} ${AGAINST[c.rule_id]}`
  if (c.rule_id === 'TIME_ORD' && typeof a === 'string') return `the service date, ${a}, falls within the contract's term`
  return `${check}: it holds`
}

/** The FAIL sentence for a check that does not hold; `reasons` is the kernel's own (its figures). */
function failWords(c: ClaimVerdict, reasons: string): string {
  const check = CHECK[c.rule_id]!
  const a = c.asserted, r = c.computation?.result
  if (RECOMPUTE.has(c.rule_id) && typeof a === 'number' && typeof r === 'number') {
    const { computed, invoice } = twoFigures(c.rule_id, a, r)
    return `${check}: ${figure(computed)} computed, but the invoice says ${figure(invoice)} (a difference of ${money2(invoice - computed)})`
  }
  if (AGAINST[c.rule_id] && a !== null && a !== undefined && r !== undefined) return `${check} does not hold: ${crossFigure(c.rule_id, a)} on the invoice, ${crossFigure(c.rule_id, r)} ${AGAINST[c.rule_id]}`
  return `${check} does not hold: ${reasons}`
}

/**
 * The can't-tell sentence for a check whose inputs were not all given ("Cannot evaluate: missing bindings for …"). Like the
 * can't-tell pass (verdict/cant-tell.ts) it names no line: the claim's id does.
 */
function notGivenWords(c: ClaimVerdict, roles: string[]): string {
  const what = WHAT[c.rule_id] ?? `the check ${c.rule_id}`
  return `Can't tell ${what}: not given: ${roles.map(roleWords).join(', ')}`
}

/** The can't-tell sentence for a check held back after it ran (a guessed field, a reference that offers several values). */
function heldBackWords(c: ClaimVerdict): string {
  const what = WHAT[c.rule_id] ?? `the check ${c.rule_id}`
  const why = c.insufficiency?.reason === 'AMBIGUOUS_REFERENCE'
    ? 'the contract lists several values it could be checked against, and none is tied to this line. Give one value, or a contract line whose description matches this line'
    : c.insufficiency?.reason === 'AMBIGUOUS_FIELD'
      ? 'a figure it rests on was found only by a near match of its field name, and nothing is decided on a guessed field. Give it under a field name the ruleset reads'
      : 'a figure it rests on is not certain, so nothing was decided'
  return `Can't tell ${what}: ${why}`
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * From the engine after 0.7.0: reword every invoice explanation the kernel wrote in its own vocabulary. In place; outcomes, values, evidence,
 * insufficiencies and ids untouched. An INSUFFICIENT_DATA claim whose text says a law was VIOLATED is left to the can't-tell pass
 * that runs after this one (verdict/cant-tell.ts), which already words it.
 */
export function explainInWords(claims: ClaimVerdict[], engine: EngineVersion): void {
  if (!explainsInWords(engine)) return
  for (const c of claims) {
    if (typeof c.explanation !== 'string' || CHECK[c.rule_id] === undefined) continue
    const name = typeof c.rule_name === 'string' ? c.rule_name : ''
    const missing = /^Cannot evaluate: missing bindings for (.+)$/.exec(c.explanation)
    if (missing) { c.explanation = notGivenWords(c, missing[1]!.split(/,\s*/)); continue }
    if (!name) continue
    const pass = `${name}: All predicates satisfied.`
    if (c.outcome === 'INSUFFICIENT_DATA') {
      // a check held back after it passed: "Abstained: <name>: All predicates satisfied." becomes the reason in words
      if (c.explanation.includes(pass)) c.explanation = heldBackWords(c)
      continue
    }
    if (c.outcome === 'PASS' && c.explanation.includes(pass)) { c.explanation = c.explanation.replace(pass, `${passWords(c)}.`); continue }
    // a FAIL, or a PASS the rounding pass turned from one ("Within tolerance (…): treated as rounding, not error. <name> VIOLATED: …")
    const m = new RegExp(`^(.*?)${escape(name)} VIOLATED: (.*?)( Not treated as rounding: .*)?$`, 's').exec(c.explanation)
    if (!m) continue
    if (c.outcome === 'FAIL') c.explanation = `${m[1]}${failWords(c, m[2]!)}${m[3] ?? ''}`
    else if (c.outcome === 'PASS') c.explanation = `${m[1]}${passWords(c)}.${m[3] ?? ''}`
  }
}
