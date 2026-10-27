/**
 * The extraction contract (2026-10-03): the pre-pass every extractor must satisfy before verify will read its output, when
 * a ruleset asks for it (`require_contract: true`). See docs/EXTRACTION-CONTRACT.md.
 *
 *   schema       extractionSchema(ruleset) → the JSON Schema for that ruleset's extraction; validateContract(envelope, ruleset)
 *   contract     the envelope types, lowerContract (envelope → the extraction the checks read), isContractEnvelope
 *   canonical    the fixed canonicalization two readings are compared under, and strict number reading
 *   agree        two readings → one value, or UNREADABLE with both kept, or ABSENT (not_printed)
 *   readers      the PDF text layer (pdfjs-dist, optional) and OCR (pdftoppm + Tesseract), rows
 *   labels       the generic reader of labelled document fields
 *   extract      the reference extractor: a PDF in, an envelope (plus verify's --source/--quotes) out
 *   legal        quotations read twice off a decision; the legal envelope and its lowering to citations
 */

export * from './canonical.js'
export * from './contract.js'
export * from './jsonschema.js'
export * from './schema.js'
export * from './agree.js'
export * from './readers.js'
export * from './labels.js'
export * from './extract.js'
export * from './legal.js'
