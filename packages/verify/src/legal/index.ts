/**
 * Legal citation verification — now required by court rule.
 *
 * Florida Rule 2.515(d)(2) (adopted Case SC2026-0673, eff. 2026-06-15) REQUIRES that cited authorities "exist and are
 * accurately cited" — a live, confirmed mandate (claim-verify 2026-09-22). California SB 574 (passed the legislature
 * 2026-08-31, awaiting the Governor as of 2026-09) WOULD add a "personally verified" duty — treat as PENDING, not
 * settled law. Existence-checking is a commodity (CourtListener,
 * Shepard's) and cannot catch the growing failure: a REAL case cited for words it does not contain. Of Charlotin's 2,046
 * hallucination decisions, 549 are false QUOTES — exactly what a deterministic verbatim match catches and existence-checkers miss.
 *
 * We decide, deterministically, only what is decidable:
 *   quote present verbatim in the opinion   → PASS
 *   quote's own words are in the opinion but not as quoted (a misquote) → FAIL, with the passage the opinion actually carries
 *   quote located nowhere in the supplied opinion → INSUFFICIENT (maybe a fabrication, maybe wrong/partial source text)
 *   no opinion text supplied for the cite   → INSUFFICIENT / REFERENCE_NOT_PROVIDED (we will not assert existence we can't check)
 *   only a PROPOSITION, no quote            → INSUFFICIENT / OUT_OF_RULESET_SCOPE — whether the case STANDS FOR the
 *                                             proposition is semantic; the deterministic tier does not decide it (a REASONED
 *                                             tier will, later, labelled as an opinion). This declared abstention is the
 *                                             honest "can't-tell".
 *
 * Deterministic; reuses the source-text axis. No I/O, no clock except issued_at.
 */

import { hashOf, sha256 } from '../verdict/canonical.js'
import { prepareSource, matchQuote } from '../textmatch/index.js'
import type { ClaimVerdict, Coverage, Evidence, Outcome, Verdict } from '../verdict/schema.js'
import { ENGINE_VERSION, SCHEMA_VERSION } from '../version.js'

const LEGAL_RULESET = { id: 'legal', version: '0.0.1', domain: 'legal' } as const

export interface Citation {
  /** Stable id for the claim (e.g. "brief:p4n2"). */
  id: string
  /** The reporter citation, recorded (e.g. "550 U.S. 544"). */
  cite?: string
  /** The case name, recorded (e.g. "Bell Atlantic Corp. v. Twombly"). */
  case_name?: string
  /** The passage the brief attributes to the authority — the thing we verify verbatim. */
  quote?: string
  /** What the brief says the authority stands for — NOT decided deterministically (semantic). */
  proposition?: string
  /** Which supplied opinion text to check against. Defaults to cite, then case_name, then id. */
  source_key?: string
}

/** Opinion texts keyed by cite / case_name / source_key. */
export type OpinionSources = Record<string, string>

export interface VerifyCitationsOptions { producer?: string; now?: () => Date }

function spanEvidence(sourceHash: string, span: { start: number; end: number }, text: string): Evidence {
  return { locator: { kind: 'span', source_hash: sourceHash, start: span.start, end: span.end }, value: text, confidence: 100, role: 'QUOTE' }
}

/**
 * Does a negation immediately precede `start` in the source, within the same clause? A verbatim quote lifted from
 * "We do NOT hold that X" while dropping "do not" is the classic meaning-inverting selective quotation — technically
 * present, materially false. We cannot certify such a quote as accurate. (red-team break, 2026-09-22.)
 */
const NEGATION = /\b(?:not|no|never|cannot|can't|don't|doesn't|didn't|nor|without|fail(?:s|ed|ing)?\s+to|declin\w+\s+to|refus\w+\s+to|reject\w*|decline[ds]?)\b/i
function precededByNegation(text: string, start: number): boolean {
  const before = text.slice(Math.max(0, start - 80), start)
  const clause = before.split(/[.;:!?]/).pop() ?? before // only within the same sentence/clause
  return NEGATION.test(clause)
}

function resolveSource(c: Citation, sources: OpinionSources): { key: string; text: string } | null {
  for (const k of [c.source_key, c.cite, c.case_name, c.id]) {
    if (k !== undefined && typeof sources[k] === 'string' && sources[k].length > 0) return { key: k, text: sources[k] }
  }
  return null
}

export function verifyCitation(c: Citation, sources: OpinionSources): ClaimVerdict {
  const label = c.case_name ?? c.cite ?? c.id
  const base = {
    claim_id: `cite.${c.id}`, kind: 'QUOTE_MATCH' as const, tier: 'DETERMINISTIC' as const,
    field: c.cite ?? c.case_name ?? c.id, asserted: (c.quote ?? c.proposition ?? label) as string,
    rule_id: 'CITE_VERBATIM', rule_name: 'Citation quoted accurately',
  }

  const src = resolveSource(c, sources)
  if (!src) {
    return { ...base, outcome: 'INSUFFICIENT_DATA', evidence: [],
      insufficiency: { reason: 'REFERENCE_NOT_PROVIDED', detail: `no opinion text supplied for ${label}; existence and quotation cannot be verified without the source opinion. (Existence-only checking is a separate commodity; we verify the words.)` },
      locked: false, explanation: `No opinion text for ${label}; cannot verify.` }
  }

  if (c.quote === undefined || c.quote.trim().length === 0) {
    // Existence context is present (we have the opinion), but there is no quotation to check — only a proposition.
    return { ...base, outcome: 'INSUFFICIENT_DATA',
      evidence: [{ locator: { kind: 'field', source: 'contract', path: `opinion:${src.key}` }, value: label, confidence: 100, role: 'REFERENCE' }],
      insufficiency: { reason: 'OUT_OF_RULESET_SCOPE', detail: `whether ${label} stands for the asserted proposition is a semantic judgement the deterministic tier does not make. Supply the quoted language to verify it verbatim, or await the REASONED tier.` },
      locked: false, explanation: `${label}: proposition not deterministically decidable; abstaining by design.` }
  }

  const prepared = prepareSource(src.text)
  const sourceHash = sha256(src.text)
  const r = matchQuote(prepared, c.quote)
  if (r.found && r.span) {
    // The words appear verbatim — but if they are lifted from immediately after a negation the quotation drops, the
    // citation may invert the opinion's meaning. We will not certify accuracy in that case; we flag it for a human.
    if (precededByNegation(src.text, r.span.start)) {
      return { ...base, outcome: 'INSUFFICIENT_DATA',
        evidence: [spanEvidence(sourceHash, r.span, r.matchedText ?? '')],
        insufficiency: { reason: 'SELECTIVE_QUOTE', detail: `the quoted words appear in ${label}, but immediately follow a negation in the opinion (e.g. "we do not hold that…") that the quotation omits. This may be a selective quotation that inverts the holding — cannot certify as accurately cited; verify in context.` },
        locked: false, explanation: `${label}: quoted words present but preceded by a negation the quote omits; not certified — possible selective quotation.` }
    }
    return { ...base, outcome: 'PASS', locked: true,
      evidence: [spanEvidence(sourceHash, r.span, r.matchedText ?? '')],
      explanation: `The quotation attributed to ${label} appears verbatim in the opinion.` }
  }
  if (r.reason === 'misquote_nearest' && r.nearest) {
    return { ...base, outcome: 'FAIL', locked: true,
      computation: { formula: 'brief_quote = opinion[cited passage]', operands: { brief_quote: c.quote, opinion_says: r.nearest.text }, result: r.nearest.text },
      evidence: [spanEvidence(sourceHash, r.nearest.span, r.nearest.text)],
      explanation: `${label} is a real authority, but the quotation is not accurate. The opinion reads: "${r.nearest.text}".` }
  }
  return { ...base, outcome: 'INSUFFICIENT_DATA', evidence: [],
    insufficiency: { reason: 'SPAN_NOT_FOUND', detail: `the quoted passage was not found in the supplied text of ${label}; it may be fabricated, or the supplied opinion text may be incomplete. Not confirmed — do not rely on this citation as quoted.` },
    locked: false, explanation: `${label}: quotation not located in the opinion; abstaining rather than asserting a fabrication.` }
}

function coverageOf(claims: ClaimVerdict[]): Coverage {
  let pass = 0, fail = 0, ins = 0
  for (const c of claims) c.outcome === 'PASS' ? pass++ : c.outcome === 'FAIL' ? fail++ : ins++
  return { claims_total: claims.length, claims_checked: pass + fail, claims_pass: pass, claims_fail: fail, claims_insufficient: ins }
}

/** Verify a brief's citations against supplied opinion texts. Returns the standard proof object (ruleset 'legal'). */
export function verifyCitations(citations: Citation[], sources: OpinionSources = {}, options: VerifyCitationsOptions = {}): Verdict {
  const claims = citations.map(c => verifyCitation(c, sources))
  const coverage = coverageOf(claims)
  const outcome: Outcome = coverage.claims_fail > 0 ? 'FAIL' : coverage.claims_checked === 0 ? 'INSUFFICIENT_DATA' : 'PASS'

  const input_hash = hashOf({ citations, sources })
  const verdict_id = sha256(`${input_hash}:${LEGAL_RULESET.id}@${LEGAL_RULESET.version}:${ENGINE_VERSION}`).slice(0, 32)
  const issued_at = (options.now ?? (() => new Date()))().toISOString()

  return {
    schema_version: SCHEMA_VERSION, verdict_id, issued_at, engine_version: ENGINE_VERSION,
    ruleset: { ...LEGAL_RULESET }, input_hash, replayable: true,
    document: { extraction_hash: hashOf(citations), ...(options.producer !== undefined ? { producer: options.producer } : {}), line_items: citations.length },
    references: { contract: false, evidence: 0, history: 0, source: Object.keys(sources).length > 0 },
    outcome, aggregation: 'ANY_FAIL_FAILS', claims, coverage,
  }
}

/**
 * Render a court-presentable citation audit from a legal verdict — the signable artifact a filer attaches (pair with
 * `signVerdict` from ../protocol for a tamper-evident, independently-verifiable report). Honest by construction: it
 * states its own scope (verbatim quotation + existence in the supplied text; it does NOT decide whether an authority
 * stands for a proposition) so it cannot be read as more than it is.
 */
export function renderCitationAudit(verdict: Verdict, opts: { title?: string } = {}): string {
  const sym = (o: Outcome): string => (o === 'PASS' ? '✓' : o === 'FAIL' ? '✗' : '⚠')
  const label = (o: Outcome): string => (o === 'PASS' ? 'verified' : o === 'FAIL' ? 'INACCURATE' : 'could not verify')
  const c = verdict.coverage
  const lines: string[] = [
    `# ${opts.title ?? 'Citation audit'}`,
    '',
    `> Deterministic verbatim-quotation + existence check against the supplied opinion text. It does NOT decide whether an authority *stands for* a proposition — that semantic question is explicitly abstained (see ⚠ entries). Verdict \`${verdict.verdict_id}\`, engine ${verdict.engine_version}; replayable and independently verifiable.`,
    '',
    `**${verdict.claims.length} citations** — ${c.claims_pass} verified · ${c.claims_fail} inaccurate · ${c.claims_insufficient} could-not-verify. Overall: **${verdict.outcome}**.`,
    '',
  ]
  for (const cl of verdict.claims) lines.push(`- ${sym(cl.outcome)} **${cl.field}** — _${label(cl.outcome)}._ ${cl.explanation}`)
  lines.push('')
  return lines.join('\n')
}
