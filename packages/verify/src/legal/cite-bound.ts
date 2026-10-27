/**
 * The longest citation text a door reads (2026-10-20).
 *
 * A citation's cite, case name and source key, and the keys its opinion texts are filed under, are the caller's text. Five patterns
 * that read them are quadratic in a long run of spaces or of open parentheses: the short-form pattern AT_FORM and the trim before a
 * reporter citation in citeParts (./index.ts), and the three patterns of parseReporterCite (./binding.ts). Measured on engine 0.7.2
 * under the default rule, through verifyCitations, one cite of "1 A", spaces, "x" took about 2 ms at 1,024 characters, 28 ms at
 * 4,096, 158 ms at 8,192 and 9.7 s at 65,536; a case name or a text key of that shape costs as much, and a text key is read again
 * for every citation of the brief (10,000 citations against one such key of 1,024 characters took 20 s, against a key of genuine
 * length 0.4 s). The longest citation text in this package's legal fixtures, the legal blind sets, the drift sets and the cold
 * reviews' briefs is a cite of 122 characters with a "(quoting ...)" parenthetical; the 99th percentile of cites is 99; no case name
 * is over 74 and no key over 33.
 *
 * The bound is 1,024 characters, as JavaScript counts a string (UTF-16 code units: a character outside the Basic Multilingual Plane
 * counts two): 8.4 times the longest genuine cite, and a cite at the bound costs about 2 ms where one of 64 KB costs 9.7 s. The doors
 * that take citations from a caller (POST /v1/verify/citations, the MCP tool verify_citations, the citations command) refuse text
 * over it before any pattern runs and before anything is hashed. It is a refusal, never a verdict: no verdict changes, and no rule
 * version changes. Changing the bound changes which requests are refused, never what a verdict says. The library's verifyCitations
 * has no bound; a program that reads its own briefs through it reads them whole.
 */
export const MAX_CITE_CHARS = 1024

/** One citation text over the bound: what it is, in words ("the cite of citation 0 (\"c1\")"), and its length. */
export interface CiteTooLong { what: string; chars: number }

/** A citation as the refusal names it: its position in the list, and its id when that is a short string. */
function citationName(c: object, i: number): string {
  const id = (c as Record<string, unknown>).id
  return typeof id === 'string' && id.length <= 64 ? `citation ${i} (${JSON.stringify(id)})` : `citation ${i}`
}

/**
 * The first citation text over MAX_CITE_CHARS in a request, or undefined: each citation's `cite`, `case_name` and `source_key` when
 * it is a string, then each key of `sources` when that is an object. Lengths only: no pattern runs. `keysAre` names the texts' keys
 * in the words (`a key of "sources"` over HTTP and MCP; the command line names its manifest or its folder).
 */
export function citeTooLong(citations: readonly unknown[], sources?: unknown, keysAre = 'a key of "sources"'): CiteTooLong | undefined {
  for (let i = 0; i < citations.length; i++) {
    const c = citations[i]
    if (c === null || typeof c !== 'object') continue
    for (const field of ['cite', 'case_name', 'source_key'] as const) {
      const s = (c as Record<string, unknown>)[field]
      if (typeof s === 'string' && s.length > MAX_CITE_CHARS) return { what: `the ${field} of ${citationName(c, i)}`, chars: s.length }
    }
  }
  if (sources !== null && typeof sources === 'object' && !Array.isArray(sources)) {
    for (const k of Object.keys(sources)) if (k.length > MAX_CITE_CHARS) return { what: keysAre, chars: k.length }
  }
  return undefined
}

/** The words every door refuses with: what was too long and its length, the bound, and that nothing was checked. */
export function citeTooLongWords(t: CiteTooLong): string {
  return `citation text too long: ${t.what} is ${t.chars} characters; a cite, case name, source key or the key of a text is read up to ${MAX_CITE_CHARS} characters. Nothing was checked; this is not a verdict`
}
