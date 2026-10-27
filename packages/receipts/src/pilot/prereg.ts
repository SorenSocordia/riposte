/**
 * The shadow pilot's pre-registration (2026-10-03). The primary number, its bar, its confidence and the audit sample size
 * are written down and FROZEN before the month is run: `freezePrereg` hashes the file and writes `<file>.lock.json`; the run
 * refuses a prereg that is not frozen, that changed since, or that names another month or source; the report refuses to
 * render without the same file, unchanged, frozen before the run started.
 *
 * The file is Markdown for people, with one fenced ```json block of parameters the run reads. Every "<fill: …>" must be
 * replaced before it can be frozen.
 *
 * THE CO-PRIMARY MISS RATE (2026-10-05). hold_precision measures false holds only. A reviewer
 * reading the pilot in the role of a controller pointed out that it says nothing about bad bills the check would have paid,
 * which is the failure that costs money. So the default template registers a co-primary,
 * `miss_rate`: of the bills the check would have PAID automatically, the share a person confirms is a bad bill, on a random
 * sample of would-pays drawn the same way as the would-hold sample. Lower is better: its decision rule is the mirror image.
 * `co_primary` is optional: a prereg written before it (no co_primary block) parses, freezes and runs exactly as before.
 *
 * THE BUYER'S OWN DOCUMENT (2026-10-05). The generated prereg holds the buyer's parameters and the rules they
 * are judged by, nothing else: no reviewer's words (the reason for the co-primary is stated plainly; PILOT.md says where it
 * came from). The template writes each number it asks for WITHOUT quotes (`"bar": <fill: …>`), so filling it in gives a
 * JSON number. A number left in quotes (`"bar": "0.85"`) is refused with the fix ("remove the quotes around 0.85"), and an
 * unfilled template is refused naming every blank, before the block is parsed as JSON.
 *
 * THE PRICE TOLERANCE (2026-10-05). How far a unit price may run over the PO's before the check holds the bill is
 * the buyer's parameter, registered here and frozen with the rest: `price_tolerance`, a fraction (0.02 is 2%). The template
 * writes 0.02, or the value `prereg init --price-tolerance` was given. The run checks every bill under it and records it in each
 * receipt; a run asked for another tolerance is refused. A prereg written before the field reads as 0.02, as those runs did.
 *
 * THE FREIGHT RULE (2026-10-05). Freight billed on a purchase order that does not say whether freight is allowed
 * went to a person on every bill; a Ramp export has no such field, so every freighted bill from it did. `freight` is the
 * buyer's rule, registered and frozen here as the price tolerance is: "person" (the default, and what a prereg without the
 * field reads) or "allow" (the freight is added into the total as an allowed charge; a purchase order that says no is never
 * overridden). The run checks every bill under it, records it in each receipt, and binds it into each verdict's inputs.
 *
 * THE FILLED FILE HOLDS NO BLANK MARKER (2026-10-05). The instructions above the block used to quote the blank
 * marker itself, so a search of a filled prereg for blanks still found one; they now describe the blanks without quoting it.
 *
 * THE TAX RULE (2026-10-06). No export mapping reads a purchase order's tax terms, so every taxed bill of a
 * pilot went to a person (a controller: "every supply-house bill we get carries sales tax"). `tax` is the buyer's rule,
 * registered and frozen as the freight rule is, written as the `--tax` flag writes it: "person" (the default, and what a prereg
 * without the field reads), "allow" (tax accepted as billed, and each answer says so) or "rate:8.25%" (the tax checked within the
 * price tolerance of that rate on the taxable lines). A purchase order that states its tax terms is never overridden. The run
 * checks every bill under it, records it in each receipt, and binds it into each verdict's inputs (never for "person").
 *
 * A SAMPLE THAT CANNOT CLEAR ITS BAR IS SAID (2026-10-06). `prereg freeze` accepted an audit sample of 2 for a
 * 0.85 bar without a word. preregWarnings names each registered number that cannot pass even at its best (every audited
 * would-hold confirmed; no audited would-pay bad), with the fewest that could. It warns; it never refuses: the buyer may freeze
 * a pilot that measures something else.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { clopperPearsonInterval, parseTaxPolicy, taxPolicyText } from 'riposte-verify'
import { SOURCE_IDS, type SourceId } from './mappers.js'

export const PREREG_VERSION = 'riposte.pilot-prereg/0.1.0'
export const PRIMARY_METRICS = ['hold_precision', 'agreement', 'coverage'] as const
export type PrimaryMetric = (typeof PRIMARY_METRICS)[number]
/** The co-primary: lower is better (2026-10-05). */
export const CO_PRIMARY_METRICS = ['miss_rate'] as const
export type CoPrimaryMetric = (typeof CO_PRIMARY_METRICS)[number]
/**
 * A reviewer's words (2026-10-05): why the default prereg registers the miss rate too. Quoted in PILOT.md as what they
 * are; never written into a buyer's pre-registration (2026-10-05).
 */
export const MISS_RATE_REASON = 'That measures false holds. It does not measure bad bills it would have paid, which is the failure that costs money. I expected the miss rate as a primary or co-primary.'

export interface PreregParams {
  prereg_version: typeof PREREG_VERSION
  buyer: string
  month: string
  source: SourceId
  /** optional (2026-10-05): the price tolerance the run checks every bill under, a fraction from 0 to 1; absent reads 0.02 */
  price_tolerance?: number
  /** optional (2026-10-05): freight on a PO that does not say: "person" (absent reads person) or "allow" */
  freight?: 'allow' | 'person'
  /** optional (2026-10-06): tax on a PO that states no tax terms: "person" (absent reads person), "allow" or "rate:<pct>" */
  tax?: string
  primary: { metric: PrimaryMetric; bar: number; confidence: 0.9 | 0.95 | 0.99; sample_size?: number }
  /** optional (2026-10-05): the miss rate on a sample of would-pays; passes when its upper bound is at or below the bar */
  co_primary?: { metric: CoPrimaryMetric; bar: number; confidence: 0.9 | 0.95 | 0.99; sample_size: number }
  secondary: PrimaryMetric[]
  tertiary: string[]
}

export interface PreregLock { prereg_version: string; file: string; sha256: string; frozen_at: string; params: PreregParams }
export interface FrozenPrereg { path: string; sha256: string; frozen_at: string; params: PreregParams; text: string }

export class PreregRefused extends Error {
  constructor(message: string) { super(message); this.name = 'PreregRefused' }
}

export const lockPathOfPrereg = (path: string): string => `${path}.lock.json`

/** A number the template asks for: a marker JSON.stringify keeps as a string, then written without quotes. */
const NUM_MARK = '@@number@@'
const num = (what: string): string => `${NUM_MARK}<fill: ${what}>`

/** The template `riposte-pilot prereg init` writes. */
export function preregTemplate(o: { buyer?: string; month?: string; source?: string; priceTolerance?: number; freight?: 'allow' | 'person'; tax?: string } = {}): string {
  const fill = (what: string, v?: string) => v ?? `<fill: ${what}>`
  const params = {
    prereg_version: PREREG_VERSION,
    buyer: fill('whose month this is', o.buyer),
    month: fill('YYYY-MM, a closed month', o.month),
    source: fill(SOURCE_IDS.join(' | '), o.source),
    price_tolerance: o.priceTolerance ?? DEFAULT_PRICE_TOLERANCE,
    freight: o.freight ?? DEFAULT_FREIGHT,
    tax: o.tax ?? DEFAULT_TAX,
    primary: { metric: 'hold_precision', bar: num('the lowest precision that counts as a pass, e.g. 0.85'), confidence: 0.95, sample_size: num('how many would-holds a person audits, e.g. 40') },
    co_primary: { metric: 'miss_rate', bar: num('the highest miss rate that counts as a pass, e.g. 0.05'), confidence: 0.95, sample_size: num('how many would-pays a person audits, e.g. 75') },
    secondary: ['coverage', 'agreement'],
    tertiary: ['dollars_held'],
  }
  // every number the buyer fills in is written without quotes, so that 0.85 typed over the blank is a JSON number
  const block = JSON.stringify(params, null, 2).split(`"${NUM_MARK}`).map((s, i) => (i === 0 ? s : s.replace(/^(<fill: [^"]*>)"/, '$1'))).join('')
  return `# Shadow pilot: pre-registration

Written and frozen before the month is run. \`riposte-pilot prereg freeze <this file>\` records its sha256; the run and the
report refuse it if it changed afterwards.

## What is run

One closed month of the buyer's own bills, read from its export, each checked by the deterministic three-way match (bill,
purchase order, item receipts) in shadow: nothing is executed, no payment or hold is sent anywhere. Every bill gets a signed
receipt that holds hashes, not documents.

## The primary number

**hold_precision**: of the bills the check would have held, the share a person confirms is a real problem (wrong price,
quantity, arithmetic, total, or a duplicate), on a random sample drawn after the run from a seed nobody chooses (the sha256 of
this file and the receipt ledger's head). Reported with its exact (Clopper-Pearson) interval at the confidence below.

Decision rule, fixed now: the lower bound at or above the bar is a pass; the upper bound below the bar is a fail; anything else
is inconclusive and is reported as inconclusive.

## The co-primary number

**miss_rate**: of the bills the check would have paid automatically, the share a person confirms is a bad bill (the same
auditor's rule as below), on a second random sample, of would-pays, drawn after the run the same way. Reported with its exact
interval at the confidence below. Why it is registered: hold_precision alone measures false holds. It says nothing about bad
bills the check would have paid, which is the failure that costs money.

Decision rule, fixed now (lower is better): the upper bound at or below the bar is a pass; the lower bound above the bar is a
fail; anything else is inconclusive. Both numbers are primary: the pilot passes only when both pass, fails when either
fails, and is otherwise inconclusive. With no bad bill found, 75 audited would-pays is about the fewest whose 95% upper bound
falls under 0.05. Delete the co_primary block before freezing to register hold_precision alone.

What counts as a real problem (the auditor's rule): the bill as recorded asks for more money, a different price, or a quantity
not received, compared with the purchase order and the receipts on record, or it repeats a bill already paid.

## The check's price tolerance

\`price_tolerance\` is how far a bill's unit price may run over the purchase order's before the check holds it, as a fraction:
0.02 is 2%. Set it to what your contracts allow (a metals surcharge, for instance) before freezing. Every bill of the run is
checked under it, and each receipt records it.

## The check's freight rule

\`freight\` says what happens to freight billed on a purchase order that does not say whether freight is allowed. "person"
sends each such bill to a person. "allow" adds the freight into the bill's total as an allowed charge. A purchase order that
says freight is not allowed is never overridden. Choose before freezing; every bill of the run is checked under it, and each
receipt records it.

## The check's tax rule

\`tax\` says what happens to tax billed on a purchase order that states no tax terms. "person" sends each such bill to a person.
"allow" accepts the tax as billed, and each answer says it was not checked against a rate. "rate:8.25%" checks the tax against
that rate on the bill's taxable lines, within the price tolerance; a tax off by more goes to a person. A purchase order that
states its tax terms is never overridden. Choose before freezing; every bill of the run is checked under it, and each receipt
records it.

## Secondary and tertiary

- coverage: the share of the month's bills the export let the check run on (the rest are listed with the reason).
- agreement: the share of the bills the buyer decided (paid or held) where the check's pay/hold class matches; a check that
  could not decide counts as not matching.
- dollars_held: the total of the bills the check would have held (from the export's totals).

## Parameters (the run reads this block)

Each blank in the block below is in angle brackets and starts with "fill:", followed by what to write. Replace each one,
brackets included, with your value. Numbers are written without quotes, like 0.85 or 40.

\`\`\`json
${block}
\`\`\`

## Not claimed

No number is claimed before the month is run. A synthetic or tuned month is never presented as the buyer's result.
`
}

const isObj = (x: unknown): x is Record<string, any> => x !== null && typeof x === 'object' && !Array.isArray(x)

/** The price tolerance a run uses when its prereg names none (every prereg written before the field). */
export const DEFAULT_PRICE_TOLERANCE = 0.02
/** The price tolerance a frozen prereg registers. */
export const preregPriceTolerance = (p: PreregParams): number => p.price_tolerance ?? DEFAULT_PRICE_TOLERANCE
/** The freight rule a run uses when its prereg names none (every prereg written before the field): a person decides. */
export const DEFAULT_FREIGHT = 'person' as const
/** The freight rule a frozen prereg registers. */
export const preregFreight = (p: PreregParams): 'allow' | 'person' => p.freight ?? DEFAULT_FREIGHT
/** The tax rule a run uses when its prereg names none (every prereg written before the field): a person decides. */
export const DEFAULT_TAX = 'person'
/** The tax rule a frozen prereg registers, as the gate's policy ("person", "allow" or { rate }). */
export function preregTax(p: PreregParams): 'person' | 'allow' | { rate: number } {
  const r = parseTaxPolicy(p.tax ?? DEFAULT_TAX)
  if ('error' in r) throw new PreregRefused(`prereg: "tax" ${r.error.replace(/^--tax /, '')}`)
  return r.value
}
/** The tax rule as the flag writes it ("person", "allow", "rate:8.25%"). */
export const preregTaxText = (p: PreregParams): string => taxPolicyText(preregTax(p))

/**
 * What a registered number cannot do at its best (2026-10-06): a primary hold_precision sample too small for its
 * lower bound to reach the bar even if every audited would-hold is confirmed, and a miss-rate sample too small for its upper bound
 * to fall to the bar even if no audited would-pay is bad. Each warning names the number, the best bound and the fewest that could.
 * The bounds are the report's own: two-sided exact (Clopper-Pearson) at the registered confidence.
 */
export function preregWarnings(p: PreregParams): string[] {
  const out: string[] = []
  const lowerAllConfirmed = (n: number, c: number): number => clopperPearsonInterval(n, n, (1 + c) / 2).lower
  const upperNoneBad = (n: number, c: number): number => clopperPearsonInterval(0, n, (1 + c) / 2).upper
  const fewest = (ok: (n: number) => boolean): number | null => { for (let n = 1; n <= 10000; n++) if (ok(n)) return n; return null }
  const pc = (c: number): string => `${Math.round(c * 100)}%`
  const r3 = (x: number): string => String(Math.round(x * 1000) / 1000)
  const pr = p.primary
  if (pr.metric === 'hold_precision' && typeof pr.sample_size === 'number') {
    const best = lowerAllConfirmed(pr.sample_size, pr.confidence)
    if (best < pr.bar) {
      const need = fewest((n) => lowerAllConfirmed(n, pr.confidence) >= pr.bar)
      out.push(`primary.sample_size is ${pr.sample_size}: even if every one of the ${pr.sample_size} audited would-holds is confirmed, the lower bound of the ${pc(pr.confidence)} interval is ${r3(best)}, under the bar of ${pr.bar}, so hold_precision cannot pass with this sample${need !== null ? `; ${need} is the fewest that could` : ''}`)
    }
  }
  const co = p.co_primary
  if (co) {
    const best = upperNoneBad(co.sample_size, co.confidence)
    if (best > co.bar) {
      const need = fewest((n) => upperNoneBad(n, co.confidence) <= co.bar)
      out.push(`co_primary.sample_size is ${co.sample_size}: even if none of the ${co.sample_size} audited would-pays is a bad bill, the upper bound of the ${pc(co.confidence)} interval is ${r3(best)}, over the bar of ${co.bar}, so the miss rate cannot pass with this sample${need !== null ? `; ${need} is the fewest that could` : ''}`)
    }
  }
  return out
}

/** The parameters in a prereg's text, validated. */
export function parsePrereg(text: string): PreregParams {
  const blocks = [...text.matchAll(/```json\s*\n([\s\S]*?)\n```/g)]
  if (blocks.length !== 1) throw new PreregRefused(`the prereg must hold exactly one \`\`\`json block of parameters (found ${blocks.length})`)
  // the blanks first, read from the text: an unfilled number is not JSON (`"bar": <fill: …>`), and the blank is what to name
  const fills = blocks[0]![1]!.match(/<fill:[^>]*>/g)
  if (fills) throw new PreregRefused(`the prereg still has ${fills.length} blank${fills.length === 1 ? '' : 's'} to fill: ${fills.join('; ')}`)
  let p: unknown
  try { p = JSON.parse(blocks[0]![1]!) } catch (e) { throw new PreregRefused(`the parameters block is not JSON: ${(e as Error).message}`) }
  if (!isObj(p)) throw new PreregRefused('the parameters block must be an object')
  const bad = (m: string): never => { throw new PreregRefused(`prereg: ${m}`) }
  // a number written in quotes is named, with the fix (2026-10-05: "0.85 *is* between 0 and 1")
  const quoted = (where: string, x: unknown): void => {
    if (typeof x === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(x)) bad(`"${where}" is the text "${x}", in quotes: remove the quotes around ${x.trim()} (a number is written without quotes: "${where.split('.').pop()}": ${x.trim()})`)
  }
  for (const [k, v] of Object.entries(isObj(p.primary) ? p.primary : {})) quoted(`primary.${k}`, v)
  for (const [k, v] of Object.entries(isObj(p.co_primary) ? p.co_primary : {})) quoted(`co_primary.${k}`, v)
  if (p.prereg_version !== PREREG_VERSION) bad(`prereg_version must be ${PREREG_VERSION}`)
  if (typeof p.buyer !== 'string' || !p.buyer.trim()) bad('"buyer" names whose month this is')
  if (typeof p.month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(p.month)) bad('"month" is YYYY-MM')
  if (!(SOURCE_IDS as readonly string[]).includes(p.source)) bad(`"source" is one of ${SOURCE_IDS.join(', ')}`)
  if (p.price_tolerance !== undefined) {
    quoted('price_tolerance', p.price_tolerance)
    if (typeof p.price_tolerance !== 'number' || !(p.price_tolerance >= 0 && p.price_tolerance <= 1)) bad('"price_tolerance" is a fraction from 0 to 1 (0.02 is 2%)')
  }
  if (p.freight !== undefined && p.freight !== 'allow' && p.freight !== 'person') bad('"freight" is "person" (a person decides on freight a purchase order does not address) or "allow" (it is added to the total)')
  // 2026-10-06: the tax rule, written as the --tax flag writes it
  if (p.tax !== undefined && (typeof p.tax !== 'string' || 'error' in parseTaxPolicy(p.tax))) bad('"tax" is "person" (a person decides on tax a purchase order states no terms for), "allow" (tax accepted as billed) or "rate:<percent>", such as "rate:8.25%"')
  const pr = p.primary
  if (!isObj(pr) || !(PRIMARY_METRICS as readonly string[]).includes(pr.metric)) bad(`"primary.metric" is one of ${PRIMARY_METRICS.join(', ')}`)
  if (typeof pr.bar !== 'number' || !(pr.bar > 0 && pr.bar < 1)) bad('"primary.bar" is a number between 0 and 1')
  if (![0.9, 0.95, 0.99].includes(pr.confidence)) bad('"primary.confidence" is 0.9, 0.95 or 0.99')
  if (pr.metric === 'hold_precision' && !(Number.isInteger(pr.sample_size) && pr.sample_size >= 1 && pr.sample_size <= 10000)) bad('"primary.sample_size" (the audit sample) is an integer from 1 to 10000')
  if (p.co_primary !== undefined) {
    const co = p.co_primary
    if (!isObj(co) || !(CO_PRIMARY_METRICS as readonly string[]).includes(co.metric)) bad(`"co_primary.metric" is one of ${CO_PRIMARY_METRICS.join(', ')}`)
    if (typeof co.bar !== 'number' || !(co.bar > 0 && co.bar < 1)) bad('"co_primary.bar" is a number between 0 and 1')
    if (![0.9, 0.95, 0.99].includes(co.confidence)) bad('"co_primary.confidence" is 0.9, 0.95 or 0.99')
    if (!(Number.isInteger(co.sample_size) && co.sample_size >= 1 && co.sample_size <= 10000)) bad('"co_primary.sample_size" (the would-pay audit sample) is an integer from 1 to 10000')
  }
  if (!Array.isArray(p.secondary) || !p.secondary.every((m: unknown) => (PRIMARY_METRICS as readonly unknown[]).includes(m))) bad(`"secondary" lists metrics from ${PRIMARY_METRICS.join(', ')}`)
  if (!Array.isArray(p.tertiary) || !p.tertiary.every((m: unknown) => typeof m === 'string')) bad('"tertiary" is a list of names')
  return p as PreregParams
}

const sha = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex')

/** Freeze: validate, hash, and write the lock beside it. A prereg is frozen once; a changed file must be renamed and frozen anew. */
export function freezePrereg(path: string, now: () => Date = () => new Date()): PreregLock {
  if (!existsSync(path)) throw new PreregRefused(`${path} does not exist (riposte-pilot prereg init ${path} writes a template)`)
  const bytes = readFileSync(path)
  const params = parsePrereg(bytes.toString('utf8'))
  const lp = lockPathOfPrereg(path)
  if (existsSync(lp)) {
    const old = JSON.parse(readFileSync(lp, 'utf8')) as PreregLock
    if (old.sha256 === sha(bytes)) return old
    throw new PreregRefused(`${basename(path)} was already frozen (${old.sha256.slice(0, 16)}… at ${old.frozen_at}) and has changed since: a frozen prereg is never re-frozen. Save the new version under a new name and freeze that.`)
  }
  const lock: PreregLock = { prereg_version: PREREG_VERSION, file: basename(path), sha256: sha(bytes), frozen_at: now().toISOString(), params }
  writeFileSync(lp, `${JSON.stringify(lock, null, 2)}\n`, { flag: 'wx' })
  return lock
}

/** The frozen prereg, checked: frozen, unchanged since, and (when given) frozen no later than `notAfter`. */
export function frozenPrereg(path: string, notAfter?: Date): FrozenPrereg {
  if (!existsSync(path)) throw new PreregRefused(`no prereg at ${path}: a pilot runs and reports only against a frozen pre-registration`)
  const lp = lockPathOfPrereg(path)
  if (!existsSync(lp)) throw new PreregRefused(`${basename(path)} is not frozen: run \`riposte-pilot prereg freeze ${path}\` BEFORE the month is run`)
  const bytes = readFileSync(path)
  let lock: PreregLock
  try { lock = JSON.parse(readFileSync(lp, 'utf8')) as PreregLock } catch { throw new PreregRefused(`${basename(lp)} does not parse`) }
  if (lock.sha256 !== sha(bytes)) throw new PreregRefused(`${basename(path)} changed after it was frozen (frozen ${lock.sha256.slice(0, 16)}…, now ${sha(bytes).slice(0, 16)}…): a pre-registration cannot be edited after the fact`)
  const params = parsePrereg(bytes.toString('utf8'))
  if (JSON.stringify(params) !== JSON.stringify(lock.params)) throw new PreregRefused(`${basename(lp)} records other parameters than ${basename(path)} holds`)
  if (notAfter && Date.parse(lock.frozen_at) > notAfter.getTime()) throw new PreregRefused(`${basename(path)} was frozen at ${lock.frozen_at}, after the run started (${notAfter.toISOString()}): it was not a pre-registration`)
  return { path, sha256: lock.sha256, frozen_at: lock.frozen_at, params, text: bytes.toString('utf8') }
}
