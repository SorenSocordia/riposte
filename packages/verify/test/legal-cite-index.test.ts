/**
 * The citations check reads a brief once (2026-10-20). Two readings were made again for every citation, so their cost grew with the
 * square of the number of citations: a short form read every citation of the brief to find the full citations it can point to
 * (shortFormOf), and a citation looked up by its reporter citation read every supplied key (lookup050). At 4,000 citations of genuine
 * length that took 17 s and 27 s through verifyCitations, the call the command line, POST /v1/verify/citations and the MCP tool
 * verify_citations all make. Three smaller readings had the same shape: the list of supplied texts a miss prints, and the namings of
 * each text that the provenance and the choice ledger record. Each is now read once per call.
 *
 * Two things are tested. Time: three briefs of 4,000 citations must each answer within a fixed time for every citation, a bound
 * linear in the number of citations (PER_CITATION_MS, and PER_FOUND_CITATION_MS for a brief whose every citation is bound to a text;
 * the reason for each constant is beside it). Identity: seeded briefs that mix short forms, full
 * citations in every position around them, repeated and parallel citations, case names that name some full citations and not others,
 * and texts keyed several ways, issued under every legal rule, must give the verdicts recorded from the engine before the change
 * (sha256 of each brief's verdicts, below). No verdict changes, so no rule version changes.
 */
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifyCitations, LEGAL_RULESET_VERSIONS, type Citation, type OpinionSources } from '../src/legal/index'

// ── time ──
/**
 * The bound: 1 ms for each citation of the brief, so 4 s at 4,000. Measured on 2026-10-20 on the 8-thread laptop these tests were
 * written on, through verifyCitations, one call after a warm-up. Before the change the short-form brief took 17.2 s on a quiet machine
 * (4.3 ms a citation) and 23.5 to 26.3 s on a busy one, and the key brief 26.6 s (6.7 ms a citation) and 31.1 to 31.9 s; both grew about
 * fourfold for each doubling. After it, on the same busy machine, they take 0.12 to 0.15 s and 0.15 to 0.21 s. The constant sits between
 * the two with room on both sides: the whole suite running at once stays far under it, and a loop that again reads the whole brief for
 * each citation goes over it at this size.
 */
const PER_CITATION_MS = 1
/**
 * A brief whose every citation finds its text and is bound by the text's caption costs more for each citation, whatever the brief's
 * length: binding builds a regular expression for each citation's reporter citation (binding.ts citeNamed), about 0.6 to 0.9 ms a
 * citation here. So that brief has its own constant, 4 ms a citation (16 s at 4,000): after the change it takes 2.3 to 3.6 s on the busy
 * machine, and before it 37 to 40 s.
 */
const PER_FOUND_CITATION_MS = 4
const N = 4000

const shortFormBrief = (n: number): { citations: Citation[]; sources: OpinionSources } => {
  // half short forms ("477 U.S. at 248", each with a quotation), half full citations in distinct volumes; no texts
  const citations: Citation[] = []
  for (let i = 0; i < n; i++) citations.push(i % 2 ? { id: `s${i}`, cite: '477 U.S. at 248', quote: `the words quoted ${i}` } : { id: `f${i}`, cite: `${100 + i} U.S. 242`, quote: `the words quoted ${i}` })
  return { citations, sources: {} }
}
const keyBrief = (n: number): { citations: Citation[]; sources: OpinionSources } => {
  // every citation carries a pin ("201 F.3d 110, 113"), so it is looked up by the reporter citation read off it, against n texts
  // keyed by other reporter citations: every key is read for the lookup, and every citation misses
  const citations: Citation[] = []
  const sources: OpinionSources = {}
  for (let i = 0; i < n; i++) { citations.push({ id: `c${i}`, cite: '201 F.3d 110, 113', quote: `the words quoted ${i}` }); sources[`${300 + i} F.3d 110`] = `text ${i}` }
  return { citations, sources }
}
const foundBrief = (n: number): { citations: Citation[]; sources: OpinionSources } => {
  // every citation finds its own text through the reporter citation read off its pin cite, and the text's caption names it: every
  // text is recorded with its naming in the provenance (each a proposition, so no quotation is read)
  const citations: Citation[] = []
  const sources: OpinionSources = {}
  for (let i = 0; i < n; i++) {
    const cite = `${300 + i} F.3d 110`
    citations.push({ id: `c${i}`, cite: `${cite}, 113`, proposition: 'the point the brief makes' })
    const text = `Party${i} v. Other${i}\n${cite} (2d Cir. 2000)\n\nThe court held what it held.`
    sources[cite] = i % 3 === 0 ? { text, bind: 'strict' } : text
  }
  return { citations, sources }
}

function timeOne(make: (n: number) => { citations: Citation[]; sources: OpinionSources }): { ms: number; claims: number } {
  const warm = make(20)
  verifyCitations(warm.citations, warm.sources)
  const { citations, sources } = make(N)
  const t = performance.now()
  const v = verifyCitations(citations, sources)
  return { ms: performance.now() - t, claims: v.claims.length }
}

describe('the citations check is linear in the number of citations', () => {
  it(`${N} citations, half short forms and half full citations, within ${PER_CITATION_MS} ms a citation`, () => {
    const r = timeOne(shortFormBrief)
    expect(r.claims).toBe(N)
    expect(r.ms, `${r.ms.toFixed(0)} ms for ${N} citations`).toBeLessThan(PER_CITATION_MS * N)
  }, 180_000)
  it(`${N} citations looked up against ${N} texts' keys, within ${PER_CITATION_MS} ms a citation`, () => {
    const r = timeOne(keyBrief)
    expect(r.claims).toBe(N)
    expect(r.ms, `${r.ms.toFixed(0)} ms for ${N} citations`).toBeLessThan(PER_CITATION_MS * N)
  }, 180_000)
  it(`${N} citations each finding its own text, within ${PER_FOUND_CITATION_MS} ms a citation`, () => {
    const r = timeOne(foundBrief)
    expect(r.claims).toBe(N)
    expect(r.ms, `${r.ms.toFixed(0)} ms for ${N} citations`).toBeLessThan(PER_FOUND_CITATION_MS * N)
  }, 180_000)
})

// ── identity ──
/** A small seeded generator (mulberry32), so every run builds the same briefs. */
function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const VOLUME_SETS = [['477'], ['477', '550'], ['477', '0477'], ['12', '477', '550']]
const REPORTER_SETS = [['U.S.'], ['U.S.', 'U. S.', 'u.s.'], ['U.S.', 'F.3d'], ['F.3d', 'F. 3d', 'S. Ct.']]
const PAGES = ['242', '0242', '248', '250', '317', '1', '99999']
const PINS = ['248', '249', '255', '317', '320', '1', '99999', '0', '242', '250']
const NAMES = ['Anderson v. Liberty Lobby, Inc.', 'Celotex Corp. v. Catrett', 'Anderson v. Celotex Corp.', 'Bell Atlantic Corp. v. Twombly', 'In re Gault', 'United States v. Anderson']
const SHORT_NAMES = ['Anderson', 'Celotex', 'Liberty Lobby', 'Twombly', 'Nobody', 'Anderson v. Catrett', '  ', 'U.S.', 'Gault']
const QUOTE = 'the words the brief quotes'

/**
 * One generated brief: short forms ("477 U.S. at 248", with a case name or none, a range, a footnote, a parenthetical), full citations
 * written several ways (bare, with a pin, a parenthetical, the case name before it, a parallel citation, a database number), "Id." and
 * "supra", each in any order, some repeated with different case names; and texts keyed by reporter citations in several spellings
 * (some pairs naming one citation with one text, some with two), by a case name, and by a word that is no citation. Each brief cites
 * one to three volumes and reporters, so its short forms meet its full citations: one at or before the pin, several, or none.
 */
function generatedBrief(seed: number): { citations: Citation[]; sources: OpinionSources } {
  const r = seeded(seed)
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T
  const VOLUMES = pick(VOLUME_SETS), REPORTERS = pick(REPORTER_SETS)
  const FIRST_PAGES = r() < 0.4 ? [pick(PAGES)] : r() < 0.5 ? [pick(PAGES), pick(PAGES)] : PAGES
  const full = (): string => {
    const v = pick(VOLUMES), rep = pick(REPORTERS), p = pick(FIRST_PAGES)
    switch (Math.floor(r() * 8)) {
      case 0: return `${v} ${rep} ${p}, ${pick(PINS)}`
      case 1: return `${v} ${rep} ${p} (1986)`
      case 2: return `${pick(NAMES)}, ${v} ${rep} ${p}, ${pick(PINS)} (1986)`
      case 3: return `${v} ${rep} ${p}, ${pick(VOLUMES)} ${pick(REPORTERS)} ${pick(PAGES)}`
      case 4: return r() < 0.5 ? '2025 WL 1188234' : `${pick(NAMES)}, 2025 WL 1188234, at *3 (D. Minn. 2025)`
      default: return `${v} ${rep} ${p}`
    }
  }
  const short = (): string => {
    const v = pick(VOLUMES).replace(/^0/, ''), rep = pick(REPORTERS), pin = pick(PINS)
    switch (Math.floor(r() * 7)) {
      case 0: return `${pick(SHORT_NAMES).trim() || 'Anderson'}, ${v} ${rep} at ${pin}`
      case 1: return `${v} ${rep} at ${pin}-${Number(pin) + 2}`
      case 2: return `${v} ${rep} at ${pin} n.4`
      case 3: return `${v} ${rep} at ${pin} (Stevens, J., dissenting)`
      case 4: return pick(['Id.', 'Id. at 5', `${pick(SHORT_NAMES)}, supra, at 3`])
      default: return `${v} ${rep} at ${pin}`
    }
  }
  const n = 8 + Math.floor(r() * 48)
  const citations: Citation[] = []
  const pool: string[] = []
  for (let i = 0; i < n; i++) {
    const roll = r()
    // a repeat of an earlier full citation, with its own case name: which one a short form points to shows in the answer
    const cite = roll < 0.42 ? short() : roll < 0.55 && pool.length > 0 ? pick(pool) : roll < 0.58 ? (r() < 0.5 ? '' : undefined) : full()
    if (cite !== undefined && roll >= 0.42) pool.push(cite)
    const c: Citation = { id: `c${i}`, ...(cite !== undefined ? { cite } : {}) }
    const nameRoll = r()
    if (nameRoll < 0.3) c.case_name = pick(NAMES)
    else if (nameRoll < 0.55) c.case_name = pick(SHORT_NAMES)
    else if (nameRoll < 0.6) c.case_name = ''
    if (r() < 0.85) c.quote = r() < 0.9 ? QUOTE : ' '
    else c.proposition = 'the point the brief makes'
    if (r() < 0.05) c.source_key = pick(['477 U.S. 242', 'notes', 'Celotex Corp. v. Catrett'])
    citations.push(c)
  }
  const sources: OpinionSources = {}
  const texts = NAMES.map((name, i) => `${name}\n${pick(VOLUMES)} ${pick(REPORTERS)} ${pick(PAGES)} (198${i})\n\nThe court said that ${QUOTE} are the words.`)
  const keys = Math.floor(r() * 12)
  for (let k = 0; k < keys; k++) {
    const key = r() < 0.75 ? `${pick(VOLUMES)} ${pick(REPORTERS)} ${pick(PAGES)}` : pick(['notes', 'Celotex Corp. v. Catrett', '2025 WL 1188234', '477 U.S. 242, 248'])
    const text = pick(texts)
    sources[key] = r() < 0.5 ? text : { text, source: 'a test', ...(r() < 0.3 ? { bind: pick(['strict', 'parties'] as const) } : {}) }
  }
  return { citations, sources }
}

const NOW = (): Date => new Date('2026-10-20T00:00:00.000Z')
/** sha256 of a brief's verdicts under every legal rule, under engine 0.7.2 (named, so a later default leaves them as they are). */
function verdictsDigest(brief: { citations: Citation[]; sources: OpinionSources }): string {
  const h = createHash('sha256')
  for (const r of LEGAL_RULESET_VERSIONS) h.update(`${JSON.stringify(verifyCitations(brief.citations, brief.sources, { ruleset: `${r.id}@${r.version}`, engine: '0.7.2', now: NOW }))}\n`)
  return h.digest('hex').slice(0, 16)
}

/** Recorded from the engine before the change (src/legal/index.ts at sha256 8b42c794…, binding.ts at 03e1008d…), seeds 1 to 48. */
const EXPECTED: readonly string[] = [
  '1818b9262e01240d', 'fed4de18d769b620', 'd61f63b5e345c7b2', '4b2fbf152b37e567', '1e0be755cf17e066', '2394b3cdfcec2d5f', '963e7db9afb0fd10', '0d2781a669794f84',
  'c8496da7eb7438c3', '7699c9598d9fd7fe', 'd2c4277649f3438e', 'cc71f639645e975e', 'b185b6f6c88440f0', 'c993249ba9328226', 'aa190526b152e511', '53279e6912b5ae25',
  '6da1ed122687ad42', '75ba56c1f1dbc966', 'f0e4569e4de62f8b', 'bdfbdadb88ec750a', '87bdc46a83b82155', '0430cef40ad27727', '414583532a145b10', '977f185d6a0849f2',
  '0540c17275897f88', 'f4a0a6b333b8ea52', '89926f45f492a690', '32522f2be1f79502', '8c9b21d5d465c637', '28d9e52ebf27032d', 'c4bc3758e1e8c9e8', '910c181dd7c3394f',
  '2a025f91ffda78c5', 'e7043a54b67c103b', '0a45c06a6df0355a', '37e723e1d7c0f540', '2e03e82ea493b7d0', 'ad5509a65f899e1a', '0dd3861efa0a8163', 'b39e0b6963285b1b',
  'e0239fc42af94e41', '5264ff692862ae72', '9fcd6f5cac68bf83', 'a5965e5cfc00c29f', '708e3a2c1ab036e7', '5255638b28832a0d', 'a492cbb3f224d869', 'e892b6b4ea01ffdb',
]

describe('the answers are the ones recorded before the change', () => {
  it('48 generated briefs, every legal rule, byte for byte', () => {
    const got = Array.from({ length: 48 }, (_, i) => verdictsDigest(generatedBrief(i + 1)))
    expect(got).toEqual(EXPECTED)
  })
  it('the generated briefs carry what they are meant to test', () => {
    // short forms that resolve, short forms that point to more than one full citation, short forms with none, and lookups that hit
    let resolved = 0, many = 0, none = 0, read = 0
    for (let i = 1; i <= 48; i++) {
      const b = generatedBrief(i)
      const v = verifyCitations(b.citations, b.sources, { ruleset: 'legal@0.5.4', engine: '0.7.2', now: NOW })
      for (const c of v.claims) {
        if (/Short form .* read as a pin cite/.test(c.explanation)) resolved++
        if (/could point to more than one full citation/.test(c.insufficiency?.detail ?? '')) many++
        if (/gives no full citation in/.test(c.insufficiency?.detail ?? '')) none++
      }
      for (const p of v.opinion_sources ?? []) for (const nm of p.names) if (nm.read_as !== undefined) read++
    }
    // measured on 2026-10-20: 34 resolved, 49 that could point to more than one, 218 with none, 122 read off the cite
    expect({ resolved: resolved >= 30, many: many >= 40, none: none >= 150, read: read >= 100 }).toEqual({ resolved: true, many: true, none: true, read: true })
  })
})
