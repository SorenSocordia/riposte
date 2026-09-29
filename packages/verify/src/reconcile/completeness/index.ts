/**
 * Completeness reconciliation: the book of record against the customer's system-of-record population (the AP payment
 * register, a GL payments extract). Answers the auditor's first question: did every payment go through the control?
 * See ./engine.ts. Distinct from ../index.ts (`reconcile`: the cross-document N-way match on one transaction's documents).
 */

export { reconcileCompleteness, effectiveCompletenessMapping, completenessReportIntact, COMPLETENESS_BOUNDARY } from './engine.js'
export { renderCompletenessReport, type RenderCompletenessOptions } from './render.js'
export {
  readPopulation, readPopulationCSV, readPopulationJSONL, populationFromRows, populationRowsHash, PopulationRefused,
  type Population, type PopulationRow, type CsvDelimiter,
} from './population.js'
export { readBook, type BookInput, type BookChain, type BookRecordView, type BookView } from './book.js'
export {
  CompletenessRefused, KEY_FIELDS, POPULATION_FIELDS, BOOK_FIELDS, POPULATION_CLASSES, BOOK_CLASSES, MATCH_PRECEDENCE,
  type KeyField, type PopulationField, type BookField, type CompareField, type BookSource, type CompletenessMapping, type EffectiveMapping,
  type CompletenessOptions, type CompletenessReport, type PopulationClass, type BookClass, type PopulationRef, type BookRef,
  type FieldDifference, type Uncompared, type HoldInfo, type MatchedItem, type BypassedItem, type AmbiguousGroup, type OrphanItem,
  type UnkeyedItem, type UnreadableItem, type CoverageBound,
} from './types.js'
export type { AmountFormat, DateFormat, KeyRules } from './values.js'
