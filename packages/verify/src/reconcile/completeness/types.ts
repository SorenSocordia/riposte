/**
 * Completeness reconciliation: types. See ./engine.ts for what the report proves and what it does not.
 */

import type { BoundMethod, Sidedness } from '../../verdict/bounds.js'
import type { PromotionPolicy, VoiceLevel } from '../../verdict/voice.js'
import type { AnchorOptions } from '../../ledger/decisions.js'
import type { Outcome } from '../../verdict/schema.js'
import type { AmountFormat, DateFormat, KeyRules } from './values.js'

/** A reconciliation that will not run (a malformed mapping, a book that does not verify, a malformed population value), with why. */
export class CompletenessRefused extends Error {
  readonly row?: number
  readonly line?: number
  constructor(message: string, where: { row?: number; line?: number } = {}) {
    super(message)
    this.name = 'CompletenessRefused'
    if (where.row !== undefined) this.row = where.row
    if (where.line !== undefined) this.line = where.line
  }
}

// ── the declared mapping ────────────────────────────────────────────────────────────────────────────────────────────

/** The fields a population row and a book record are matched on. */
export type KeyField = 'invoice_number' | 'vendor_id'
export const KEY_FIELDS: readonly KeyField[] = ['invoice_number', 'vendor_id']

/** What a population row can declare. `payment_date` orders a payment against the book's clock; `payment_id` names the row. */
export type PopulationField = 'invoice_number' | 'vendor_id' | 'amount' | 'currency' | 'invoice_date' | 'payment_date' | 'payment_id'
export const POPULATION_FIELDS: readonly PopulationField[] = ['invoice_number', 'vendor_id', 'amount', 'currency', 'invoice_date', 'payment_date', 'payment_id']

/** What a book record can declare (read from the checked extraction or the verdict's claims). */
export type BookField = 'invoice_number' | 'vendor_id' | 'amount' | 'currency' | 'invoice_date'
export const BOOK_FIELDS: readonly BookField[] = ['invoice_number', 'vendor_id', 'amount', 'currency', 'invoice_date']

/** The fields compared on a matched pair (a key field is equal by construction, so it is compared only when it is not a key). */
export type CompareField = 'vendor_id' | 'amount' | 'currency' | 'invoice_date'

/**
 * Where a book record's field is read, tried in order until one yields a value:
 *   { extraction: "totals.total" }   the checked extraction, supplied alongside the book and proven to be the one checked
 *                                    (hashOf(extraction) === verdict.document.extraction_hash). Dot path, [n] indices.
 *   { claim: "document.TOTAL_INT" }  the named claim's `asserted` value on the verdict itself (normalized by the engine).
 */
export type BookSource = { extraction: string } | { claim: string }

export interface CompletenessMapping {
  mapping_version: 'completeness-mapping-v0'
  /** The fields a population row and a book record must agree on to be the same item. One or both of invoice_number, vendor_id. */
  key: KeyField[]
  population: {
    /** Field → the column (CSV header name) or key (JSONL; a dot path when no key has that exact name). */
    columns: Partial<Record<PopulationField, string>>
    amount_format?: AmountFormat
    date_format?: DateFormat
  }
  book: {
    fields: Partial<Record<BookField, BookSource[]>>
    /** How an amount written as text in the extraction is read (a number is read exactly as it prints). */
    amount_format?: AmountFormat
    date_format?: DateFormat
  }
  /** Key normalization, per key field (applied to both sides). */
  normalize?: Partial<Record<KeyField, KeyRules>>
  /** Allowed |book − population| on a matched amount: the larger of abs and rel × the larger magnitude. Default exact (0). */
  amount_tolerance?: { abs?: number | string; rel?: number | string }
  /** Allowed whole-day difference on a matched invoice date. Default 0 (exact). */
  date_tolerance_days?: number
  /** The UTC offset of the population's payment dates, to read the book's UTC clock as the payer's calendar day. Default "+00:00". */
  payment_date_utc_offset?: string
  /** A population value the declared format cannot read: 'refuse' the whole reconciliation (default) or 'report' the row UNREADABLE. */
  on_malformed?: 'refuse' | 'report'
}

/** The mapping with every default filled in: what the report states it ran under, and what mapping_hash binds. */
export interface EffectiveMapping {
  mapping_version: 'completeness-mapping-v0'
  key: KeyField[]
  population: { columns: Partial<Record<PopulationField, string>>; amount_format: Required<AmountFormat>; date_format: DateFormat }
  book: { fields: Partial<Record<BookField, BookSource[]>>; amount_format: Required<AmountFormat>; date_format: DateFormat }
  normalize: Record<KeyField, Required<KeyRules>>
  /** Canonical decimal strings. */
  amount_tolerance: { abs: string; rel: string }
  date_tolerance_days: number
  payment_date_utc_offset: string
  on_malformed: 'refuse' | 'report'
  /** The fields compared on a matched pair: mapped on both sides and not in the key. */
  compared: CompareField[]
}

export interface CompletenessOptions {
  /** Which book records are this control's verdicts for this population. Records outside are ignored (counted, never matched). */
  scope?: {
    tenant_id?: string
    /** Exact workflow ids (`<tenant>/<ruleset>@<version>`). */
    workflows?: string[]
    /** Ruleset ids, any version. */
    rulesets?: string[]
  }
  /**
   * The period the population covers, on the book's clock (recorded_at, ISO-8601; since inclusive, until exclusive). A book
   * record recorded in the period with no population item is an ORPHAN. Records outside the period still match (an invoice
   * checked last month and paid this month), but are never orphans. Default: the whole book.
   */
  period?: { since?: string; until?: string }
  /** The checked extractions (or proposed actions), for `extraction` book sources. Each is used only if its hash is on the book. */
  extractions?: readonly unknown[]
  /**
   * The rung a workflow ran at, for a deployment that sets it by declaration rather than a GRANT on the book. Used only for a
   * workflow with no GRANT on the book; a workflow with a GRANT reads its rung from the book (at the time of each record).
   */
  rungs?: Readonly<Record<string, VoiceLevel>>
  /** The bound on the not-on-book rate. Default 95% one-sided clopper-pearson (the attribute-sampling basis). */
  interval?: { method?: BoundMethod; confidence?: number; sidedness?: Sidedness }
  /** Anchor decision signers on read (the book must verify under them). */
  anchors?: AnchorOptions
  /**
   * The deployment's declared promotion policy (P-S4-C, D-GOVERNING-POLICY): the rung a record was held at is read with the
   * GRANTs this policy admits (its tiers, max_rung, grant_signatures), whatever policy a grant names. Omitted: the count each
   * grant states governs, as before.
   */
  policy?: PromotionPolicy
  /** Stamps `generated_at` (outside report_hash). Omitted: no clock in the report at all. */
  now?: () => Date
  /** List every clean MATCHED pair in the report (large). Default false: counted and bound by matched_hash. */
  include_matched?: boolean
}

// ── the report ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** Every population row lands in exactly one class. */
export type PopulationClass = 'MATCHED' | 'MISMATCHED' | 'PAID_DESPITE_HOLD' | 'CHECKED_AFTER_PAYMENT' | 'AMBIGUOUS' | 'BYPASSED' | 'UNREADABLE'
export const POPULATION_CLASSES: readonly PopulationClass[] = ['MATCHED', 'MISMATCHED', 'PAID_DESPITE_HOLD', 'CHECKED_AFTER_PAYMENT', 'AMBIGUOUS', 'BYPASSED', 'UNREADABLE']
/** A matched row's exception classes, most severe first: its class is the first that applies. */
export const MATCH_PRECEDENCE: readonly PopulationClass[] = ['PAID_DESPITE_HOLD', 'MISMATCHED', 'CHECKED_AFTER_PAYMENT']

/** Every in-scope book record recorded in the period lands in exactly one class. */
export type BookClass = 'MATCHED' | 'ORPHAN' | 'AMBIGUOUS' | 'UNKEYED'
export const BOOK_CLASSES: readonly BookClass[] = ['MATCHED', 'ORPHAN', 'AMBIGUOUS', 'UNKEYED']

export interface PopulationRef {
  row: number
  line: number
  payment_id?: string
  /** Normalized key values. */
  key: Partial<Record<KeyField, string>>
  amount?: string
  currency?: string
  invoice_date?: string
  payment_date?: string
  vendor_id?: string
}

export interface BookRef {
  verdict_id: string
  tenant_id: string
  workflow_id: string
  outcome: Outcome
  /** The latest RECORD of this (tenant, verdict) on the chain. */
  record_seq: number
  entry_hash: string
  recorded_at: string
  /** When the check first reached the book. */
  first_recorded_at: string
  key: Partial<Record<KeyField, string>>
  amount?: string
  currency?: string
  invoice_date?: string
  vendor_id?: string
  /** Where each field was read: `extraction:<path>` (hash-verified) or `claim:<claim_id>`. */
  sources: Partial<Record<BookField, string>>
}

export interface FieldDifference {
  field: CompareField
  population: string
  book: string
  book_source: string
  /** amount: book − population (omitted when the currencies differ); invoice_date: days, book − population. */
  delta?: string
}

export interface Uncompared { field: CompareField; why: string }

export interface HoldInfo {
  /** The rung the FAIL/ABSTAIN was held at. */
  rung: 'gate' | 'autonomy'
  /** 'grant' = a signed GRANT on the book was in force when the verdict was recorded; 'declared' = options.rungs. */
  rung_from: 'grant' | 'declared'
  grant?: { decision_id: string; seq: number; signer_id: string }
  /**
   * NONE: no person reviewed it. AFTER_PAYMENT: the first review is dated after the payment. ON_OR_BEFORE_PAYMENT: reviewed
   * by the payment date. UNORDERED: reviewed, and the population declares no payment date to order it by.
   */
  resolution: 'NONE' | 'AFTER_PAYMENT' | 'ON_OR_BEFORE_PAYMENT' | 'UNORDERED'
  review?: { decision: 'UPHELD' | 'OVERTURNED'; reviewer_id: string; decided_at: string; seq: number; first_decided_at: string }
}

export interface MatchedItem {
  class: 'MATCHED' | 'MISMATCHED' | 'PAID_DESPITE_HOLD' | 'CHECKED_AFTER_PAYMENT'
  /** Every exception class that applies, most severe first (the class is the first). */
  flags: PopulationClass[]
  population: PopulationRef
  book: BookRef
  differences: FieldDifference[]
  uncompared: Uncompared[]
  hold?: HoldInfo
  /** The check first reached the book on a later calendar day (the payer's) than the payment. */
  late?: { first_recorded_day: string; payment_date: string }
}

export interface BypassedItem {
  population: PopulationRef
  /** NO_VERDICT: no in-scope record on the book has this key. NO_KEY: the row has no value for a key field. */
  reason: 'NO_VERDICT' | 'NO_KEY'
  /** Another population row has the same key (with no verdict for either). */
  duplicate_key: boolean
}

export interface AmbiguousGroup {
  key: Partial<Record<KeyField, string>>
  /** BOOK_DUPLICATES: one row, several records. POPULATION_DUPLICATES: several rows (a possible duplicate payment), one record. */
  shape: 'BOOK_DUPLICATES' | 'POPULATION_DUPLICATES' | 'MANY_TO_MANY'
  population: PopulationRef[]
  book: BookRef[]
}

export interface OrphanItem {
  book: BookRef
  /** The FAIL/ABSTAIN was held at gate/autonomy (a held item that was never paid is the control working). */
  held: boolean
  reviewed: boolean
}

export interface UnkeyedItem {
  book: BookRef
  missing: KeyField[]
  why: string[]
}

export interface UnreadableItem {
  row: number
  line: number
  problems: { field: PopulationField; column: string; value: string; why: string }[]
}

export interface CoverageBound {
  method: BoundMethod
  confidence: number
  sidedness: Sidedness
  /** "95% one-sided clopper-pearson". */
  words: string
  /** The not-on-book rate the data cannot rule out (the process view; see coverage.note). */
  not_on_book_upper: number
  /** 1 − not_on_book_upper. */
  coverage_lower: number
}

export interface CompletenessReport {
  report_version: 'completeness-v0'
  engine_version: string
  /** What this report covers, exactly. */
  binds: {
    book: { head: string; length: number }
    population: { format: 'csv' | 'jsonl' | 'rows'; sha256?: string; bytes?: number; rows: number; rows_hash: string }
    mapping_hash: string
    options_hash: string
    extractions: { supplied: number; distinct: number; used: number; set_hash: string }
    /** hashOf the clean MATCHED pairs (row ↔ verdict), listed or not. */
    matched_hash: string
  }
  mapping: EffectiveMapping
  scope: { tenant_id?: string; workflows?: string[]; rulesets?: string[] }
  period: { since?: string; until?: string }
  population: { rows: number; by_class: Record<PopulationClass, number> }
  book: {
    verified: true
    /** Signers of decisions on the book whose key is not anchored to a person (no trusted_keys / root_keys supplied), sorted. */
    unanchored_signers: string[]
    /** GRANTs on the book whose signer is not anchored: listed, and of no effect on any rung (D-ANCHOR). */
    unanchored_grants: { decision_id: string; seq: number; workflow_id: string; level: string; signer_id: string }[]
    tenants: string[]
    /** Distinct (tenant, verdict) records on the book. */
    records: number
    out_of_scope: number
    /** Records that are not a VERDICT (COUNSEL, a judgement-tier finding, an id not bound to its inputs): never the control operating. */
    not_verdict: { verdict_id: string; tenant_id: string; why: string }[]
    in_scope: number
    in_period: number
    /** Over in-scope records recorded in the period. */
    by_class: Record<BookClass, number>
    /** In-scope records recorded outside the period that matched a population row. */
    matched_outside_period: number
    /** Workflow → where its rung was read ('grant' on the book, 'declared', or 'none' = record). */
    rungs: { workflow_id: string; from: 'grant' | 'declared' | 'none' }[]
  }
  coverage: {
    population_rows: number
    /** Rows matched to exactly one verdict (MATCHED, MISMATCHED, PAID_DESPITE_HOLD, CHECKED_AFTER_PAYMENT). */
    on_book: number
    /** BYPASSED + AMBIGUOUS + UNREADABLE. */
    not_on_book: number
    /** on_book / population_rows, or null for an empty population. */
    rate: number | null
    bound: CoverageBound
    /** When payment dates are declared: of the rows on the book with a payment date, how many were checked by that day. */
    before_payment?: { rows_with_date: number; checked_by_payment_date: number; checked_after: number }
    note: string
  }
  /** Canonical decimal totals by currency ('UNSPECIFIED' when none is declared or given). */
  amounts: {
    population: Record<string, string>
    by_class: Record<PopulationClass, Record<string, string>>
    /** Population rows with no readable amount. */
    rows_without_amount: number
    book_in_period: Record<BookClass, Record<string, string>>
  }
  exceptions: {
    paid_despite_hold: MatchedItem[]
    mismatched: MatchedItem[]
    checked_after_payment: MatchedItem[]
    ambiguous: AmbiguousGroup[]
    bypassed: BypassedItem[]
    unreadable: UnreadableItem[]
    orphans: OrphanItem[]
    unkeyed: UnkeyedItem[]
  }
  /** Held FAIL/ABSTAINs that were paid after a person's review (not exceptions; listed so a person can sample them). */
  resolved_holds: { count: number; upheld: number; overturned: number; items: MatchedItem[] }
  /** Matched rows with at least one compared field that could not be compared (missing or unreadable on one side). */
  matched_with_uncompared: number
  /** Clean MATCHED pairs, when options.include_matched. */
  matched?: MatchedItem[]
  /** No population row outside MATCHED (no exception, nothing off the book). Orphans and unkeyed records do not affect it. */
  clean: boolean
  /** What this report proves and what it does not, in words. */
  boundary: string[]
  /** hashOf(the report without report_hash and generated_at). */
  report_hash: string
  generated_at?: string
}
