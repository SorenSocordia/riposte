/**
 * The standards compiler (2026-10-03): a schematron in, a declarative ruleset skeleton out (docs/COMPILER.md).
 *
 *   compile     compileSchematron(inputs, options) → { ruleset, report }: every assert compiled (arithmetic, presence,
 *               membership) or listed uncompiled with its reason; every check quoting its assert and citing its source
 *   compare     compareWithHand(compiled, hand) → a check-by-check comparison with a hand-written ruleset (the recompile test)
 *   diff        markHandEdits(compiled, edited) → the edited ruleset with every hand edit marked `hand_edited: true`
 *   structure   the UBL structure the XPath is mapped onto: a TSV table or the published structure XML
 *   schematron  the schematron reader; xpath the XPath 2.0 subset parser; interpret their meaning over the structure
 */

export { compileSchematron, COMPILER_ID, COMPILER_VERSION, POLICIES, type CompileOptions, type CompileResult, type CompileReport, type ReportEntry, type AliasFile } from './compile.js'
export { compareWithHand, renderComparison, termKeyOf, type Comparison, type CheckComparison, type Difference } from './compare.js'
export { markHandEdits, type HandEdit } from './diff.js'
export { parseStructureTsv, parseStructureXml, type Structure, type StructureRow } from './structure.js'
export { readSchematron, type Schematron, type SchematronAssert, type ReadFile } from './schematron.js'
export { parseXPath, showXPath, XPathError, type Ast } from './xpath.js'
export { parseXml, XmlError } from './xml.js'
export { polyOfExpr } from './normal.js'
