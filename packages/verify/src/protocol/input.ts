/**
 * Input refusals at the library's front door (2026-09-28, N7).
 *
 * `verify(null)` used to throw a raw TypeError from deep inside a ruleset (`reading 'line_items'`), and `verify(undefined)`
 * one from the hasher. A library that answers garbage with a crash makes every caller guess what went wrong. This module
 * names the one refusal verify() needs, as a TYPED error a caller can catch by class:
 *
 *   assertExtraction(x)   throws InputRefused when there is no document to bind a verdict to.
 *
 * What is refused, and why only that: a verdict is bound to its input by hashing it (input_hash), so anything with a
 * canonical JSON form can be answered in the protocol's own terms: an array, a number or a string is not a document, and
 * verify() answers it with INSUFFICIENT_DATA, bound to its hash (a refusal inside the protocol, measured 2026-09-28). What
 * cannot be answered that way is refused here:
 *   - null and undefined: there is no document (and verify() crashed on both);
 *   - a function, a symbol or a bigint at the top: not JSON data. Their canonical form collapses, so two different inputs
 *     share one input_hash, which the binding forbids (measured 2026-09-28: verify() answered a function and a symbol with
 *     verdicts carrying the SAME input_hash; a bigint hashes as its decimal string).
 * Every JSON value verify() answers today with a verdict still passes, unchanged. Only the non-JSON cases above change: from
 * a colliding verdict to a refusal.
 */

/** The library refused an input it cannot bind a verdict to. `input` names which argument; the message says why. */
export class InputRefused extends TypeError {
  readonly input: string
  constructor(input: string, message: string) {
    super(message)
    this.name = 'InputRefused'
    this.input = input
  }
}

/** Why `x` cannot be verified as an extraction (there is no document to bind a verdict to), or undefined. */
export function extractionProblem(x: unknown): string | undefined {
  if (x === null) return 'the extraction is null: there is no document to verify (pass the extracted fields as a JSON object)'
  if (x === undefined) return 'the extraction is missing (undefined): there is no document to verify (pass the extracted fields as a JSON object)'
  const t = typeof x
  if (t === 'function' || t === 'symbol' || t === 'bigint') {
    return `the extraction is a ${t}, not JSON data: it has no canonical form a verdict could be bound to (pass the extracted fields as a JSON object)`
  }
  return undefined
}

/**
 * Refuse an extraction verify() cannot bind a verdict to (see the module note). Throws InputRefused; returns nothing
 * otherwise. The one line for the top of verify(): `assertExtraction(extraction)`.
 */
export function assertExtraction(x: unknown): void {
  const problem = extractionProblem(x)
  if (problem) throw new InputRefused('extraction', `verify: ${problem}`)
}
