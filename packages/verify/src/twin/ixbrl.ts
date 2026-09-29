/**
 * Inline XBRL reader: the filing's own structured twin, read straight from the HTML the filer published.
 *
 * An iXBRL document is ordinary XHTML in which every tagged number is wrapped in `<ix:nonFraction>`, carrying the
 * concept it reports (`name`), the context that says WHEN and FOR WHAT (`contextRef` → an `xbrli:context` in
 * `ix:header`), the unit (`unitRef`), and how the printed digits become the reported value (`scale`, `sign`, `format`).
 * The tagged value is the legally filed number; the text around it is presentation. Reading the tags means never
 * reconstructing a table (titles, units, headers) from the HTML, which is where every false alarm in EXTRACT-3 came from.
 *
 * value = (sign="-" ? −1 : 1) × parse(displayed text, format) × 10^scale
 *
 * Deterministic and dependency-free: regular expressions over the text, no DOM, no network, no clock.
 * What is skipped is COUNTED (nil facts, unparseable text, facts whose context is missing), never silently dropped.
 */
import { sha256 } from '../verdict/canonical.js'

export interface TwinContext {
  id: string
  /** instant date (YYYY-MM-DD) for instant contexts */
  instant?: string
  /** duration start and end dates (YYYY-MM-DD) */
  start?: string
  end?: string
  /** true when the context carries any explicitMember / typedMember (segment or scenario) */
  dimensional: boolean
  /** the dimension members, as written ("us-gaap:StatementBusinessSegmentsAxis=abc:RetailMember"), for evidence */
  members: string[]
}

export interface TwinUnit {
  id: string
  /** the measures, as written ("iso4217:USD"); a divide unit lists numerator then denominator */
  measures: string[]
  /** exactly one measure, no divide, and it is ISO 4217 USD */
  usd: boolean
}

export interface TwinFact {
  /** the concept's local name ("Assets") */
  concept: string
  /** the namespace URI its prefix is bound to ("" when the prefix is not declared) */
  namespace: string
  /** the qualified name as written ("us-gaap:Assets") */
  qname: string
  contextRef: string
  unitRef: string
  /** Infinity for decimals="INF"; null when absent */
  decimals: number | null
  scale: number
  sign: 1 | -1
  /** the format's local name ("num-dot-decimal"); "" when absent */
  format: string
  /** the text a reader sees inside the tag (tags stripped, entities decoded, whitespace collapsed) */
  displayed: string
  /** the reported value: sign × parse(displayed, format) × 10^scale */
  value: number
  /** character span of the whole `<ix:nonFraction …>…</ix:nonFraction>` element in the HTML */
  span: { start: number; end: number }
}

export interface InlineXbrlStats {
  /** every ix:nonFraction element seen */
  nonFraction: number
  /** xsi:nil or self-closing (no value) */
  nil: number
  /** text the declared format cannot read */
  unparseable: number
  /** contextRef names no context */
  missingContext: number
  /** facts kept, by format local name ("" = none declared) */
  formats: Record<string, number>
}

export interface InlineXbrl {
  /** sha256 of the HTML read (the twin's identity in every verdict) */
  sha256: string
  contexts: Map<string, TwinContext>
  units: Map<string, TwinUnit>
  facts: TwinFact[]
  stats: InlineXbrlStats
}

const NS_US_GAAP = /^https?:\/\/(?:xbrl\.)?fasb\.org\/us-gaap\//i
const NS_IX = /^http:\/\/www\.xbrl\.org\/20(?:08|13)\/inlineXBRL$/i
const NS_ISO4217 = 'http://www.xbrl.org/2003/iso4217'

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
/** Decode HTML/XML character references. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m
    }
    return ENT[e.toLowerCase()] ?? m
  })
}

/** An attribute's value from a start tag's attribute text (either quote style). */
function attr(attrs: string, name: string): string | undefined {
  const m = attrs.match(new RegExp(`(?:^|\\s)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'))
  return m ? decodeEntities(m[1] ?? m[2] ?? '') : undefined
}

/** Every `xmlns:prefix="uri"` declared anywhere in the document. The first binding of a prefix wins. */
function namespaces(html: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const m of html.matchAll(/\sxmlns:([A-Za-z_][\w.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const p = m[1]!
    if (!out.has(p)) out.set(p, m[2] ?? m[3] ?? '')
  }
  return out
}

const dateOnly = (s: string | undefined): string | undefined => {
  const m = s?.trim().match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : undefined
}

function readContexts(html: string): Map<string, TwinContext> {
  const out = new Map<string, TwinContext>()
  for (const m of html.matchAll(/<((?:[A-Za-z_][\w.-]*:)?)context\b([^>]*)>([\s\S]*?)<\/\1context\s*>/g)) {
    const id = attr(m[2]!, 'id')
    if (!id || out.has(id)) continue
    const body = m[3]!
    const inner = (tag: string): string | undefined => body.match(new RegExp(`<(?:[A-Za-z_][\\w.-]*:)?${tag}\\s*>\\s*([^<]*?)\\s*<\\/(?:[A-Za-z_][\\w.-]*:)?${tag}\\s*>`))?.[1]
    const members: string[] = []
    for (const e of body.matchAll(/<(?:[A-Za-z_][\w.-]*:)?(explicitMember|typedMember)\b([^>]*)>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?\1\s*>/g)) {
      members.push(`${attr(e[2]!, 'dimension') ?? '?'}=${decodeEntities(e[3]!.replace(/<[^>]*>/g, '')).trim()}`)
    }
    const instant = dateOnly(inner('instant'))
    const start = dateOnly(inner('startDate'))
    const end = dateOnly(inner('endDate'))
    out.set(id, { id, ...(instant ? { instant } : {}), ...(start ? { start } : {}), ...(end ? { end } : {}), dimensional: members.length > 0, members })
  }
  return out
}

function readUnits(html: string, ns: Map<string, string>): Map<string, TwinUnit> {
  const out = new Map<string, TwinUnit>()
  for (const m of html.matchAll(/<((?:[A-Za-z_][\w.-]*:)?)unit\b([^>]*)>([\s\S]*?)<\/\1unit\s*>/g)) {
    const id = attr(m[2]!, 'id')
    if (!id || out.has(id)) continue
    const body = m[3]!
    const measures = [...body.matchAll(/<(?:[A-Za-z_][\w.-]*:)?measure\s*>\s*([^<]*?)\s*<\/(?:[A-Za-z_][\w.-]*:)?measure\s*>/g)].map((x) => x[1]!.trim())
    const divide = /<(?:[A-Za-z_][\w.-]*:)?divide\b/.test(body)
    let usd = false
    if (!divide && measures.length === 1) {
      const [p, local] = measures[0]!.includes(':') ? measures[0]!.split(':', 2) as [string, string] : ['', measures[0]!]
      const uri = p ? ns.get(p) : undefined
      usd = local === 'USD' && (uri === NS_ISO4217 || (uri === undefined && p.toLowerCase() === 'iso4217'))
    }
    out.set(id, { id, measures, usd })
  }
  return out
}

const WORDS: Record<string, number> = {
  no: 0, none: 0, nil: 0, zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
}

/**
 * The number the displayed text means under the declared ixt format (magnitude only; `sign` carries the sign).
 * null when the format cannot read the text, or the format is not one this reader supports.
 */
export function parseIxNumber(displayed: string, format: string): number | null {
  const f = format.toLowerCase()
  const t = displayed.normalize('NFKC').trim()
  if (f === 'fixed-zero' || f === 'zerodash' || f === 'fixedzero') return 0
  if (f === 'numwordsen' || f === 'num-words-en') {
    const w = t.toLowerCase().replace(/[^a-z]/g, '')
    return w in WORDS ? WORDS[w]! : null
  }
  // strip wrapping parentheses (the sign is the `sign` attribute, never the glyphs) and currency / spacing
  const s = t.replace(/^\((.*)\)$/, '$1').replace(/[\s$\u20ac\u00a3\u00a5]/g, '')
  if (f === '' || f === 'num-dot-decimal' || f === 'numdotdecimal' || f === 'num-dot-decimal-apos' || f === 'numcommadot') {
    const x = s.replace(/[,']/g, '')
    return /^\d+(\.\d+)?$|^\.\d+$/.test(x) ? Number(x) : null
  }
  if (f === 'num-comma-decimal' || f === 'numcommadecimal' || f === 'numdotcomma' || f === 'numspacecomma') {
    const x = s.replace(/\./g, '').replace(',', '.')
    return /^\d+(\.\d+)?$|^\.\d+$/.test(x) ? Number(x) : null
  }
  return null
}

/** Remove ix:exclude content, strip tags, decode, collapse whitespace: what a reader sees inside a fact. */
function displayedText(inner: string, ix: string): string {
  const ex = new RegExp(`<${ix}:exclude\\b[^>]*>[\\s\\S]*?<\\/${ix}:exclude\\s*>`, 'gi')
  return decodeEntities(inner.replace(ex, '').replace(/<[^>]*>/g, '')).replace(/[\s\u200b]+/g, ' ').trim()
}

/** Read the twin: contexts, units and every `ix:nonFraction` fact. */
export function parseInlineXbrl(html: string): InlineXbrl {
  const ns = namespaces(html)
  const ix = [...ns.entries()].find(([, uri]) => NS_IX.test(uri))?.[0] ?? 'ix'
  const contexts = readContexts(html)
  const units = readUnits(html, ns)
  const facts: TwinFact[] = []
  const stats: InlineXbrlStats = { nonFraction: 0, nil: 0, unparseable: 0, missingContext: 0, formats: {} }

  const open = new RegExp(`<${ix}:nonFraction\\b([^>]*?)(\\/?)>`, 'gi')
  const tagRe = new RegExp(`<(\\/?)${ix}:nonFraction\\b[^>]*?(\\/?)>`, 'gi')
  for (let m = open.exec(html); m; m = open.exec(html)) {
    stats.nonFraction++
    const attrs = m[1]!
    const start = m.index
    const openEnd = m.index + m[0].length
    if (m[2] === '/' || /^true$/i.test(attr(attrs, 'xsi:nil') ?? '')) { stats.nil++; continue }
    // the matching close, counting nested nonFraction elements (iXBRL 1.1 allows nesting)
    tagRe.lastIndex = openEnd
    let depth = 1, closeStart = -1, closeEnd = -1
    for (let t = tagRe.exec(html); t; t = tagRe.exec(html)) {
      if (t[1] === '/') { depth--; if (depth === 0) { closeStart = t.index; closeEnd = t.index + t[0].length; break } }
      else if (t[2] !== '/') depth++
    }
    if (closeStart < 0) { stats.unparseable++; continue }
    const displayed = displayedText(html.slice(openEnd, closeStart), ix)
    const format = (attr(attrs, 'format') ?? '').replace(/^[^:]*:/, '')
    const qname = attr(attrs, 'name') ?? ''
    const contextRef = attr(attrs, 'contextRef') ?? ''
    if (!contexts.has(contextRef)) { stats.missingContext++; continue }
    const n = parseIxNumber(displayed, format)
    if (n === null) { stats.unparseable++; continue }
    const scale = Number(attr(attrs, 'scale') ?? 0)
    const decRaw = attr(attrs, 'decimals')
    const decimals = decRaw === undefined ? null : /^inf$/i.test(decRaw.trim()) ? Infinity : Number(decRaw)
    const sign: 1 | -1 = (attr(attrs, 'sign') ?? '').trim() === '-' ? -1 : 1
    const [prefix, local] = qname.includes(':') ? qname.split(':', 2) as [string, string] : ['', qname]
    const value = sign * n * 10 ** (Number.isFinite(scale) ? scale : 0)
    stats.formats[format] = (stats.formats[format] ?? 0) + 1
    facts.push({
      concept: local, namespace: ns.get(prefix) ?? '', qname, contextRef, unitRef: attr(attrs, 'unitRef') ?? '',
      decimals: decimals !== null && Number.isNaN(decimals) ? null : decimals, scale: Number.isFinite(scale) ? scale : 0, sign, format,
      displayed, value: Object.is(value, -0) ? 0 : value, span: { start, end: closeEnd },
    })
  }
  return { sha256: sha256(html), contexts, units, facts, stats }
}

/** True when a fact's concept is in the US-GAAP taxonomy (by namespace; by the conventional prefix when undeclared). */
export function isUsGaap(f: TwinFact): boolean {
  return f.namespace ? NS_US_GAAP.test(f.namespace) : f.qname.startsWith('us-gaap:')
}
