/**
 * The filing's own presentation linkbase (twin v0.2, CREDENCE-2): WHICH concepts sit on the face financial statements.
 *
 * An EDGAR XBRL filing package carries, next to the inline-XBRL document, the filer's extension taxonomy. Its
 * presentation linkbase (`<prefix>-<date>_pre.xml`, or the same links embedded in the `.xsd`) lists, for every
 * presentation ROLE (one per statement, note, table, detail), the concepts shown in it (`<link:loc xlink:href="…#us-gaap_Assets">`).
 * `FilingSummary.xml` (the EDGAR rendering index of the same package) says which roles are the face STATEMENTS
 * (`<MenuCategory>Statements</MenuCategory>`), as opposed to notes, policies, tables and details.
 *
 * statement concepts = us-gaap concepts located in the presentation link of at least one statement role that is not
 * parenthetical. Whole-document binding (v0.1) let a higher-priority concept tagged in MD&A or a note beat the line
 * the statement actually prints; statement-anchored binding (v0.2) only binds concepts the filer presents on a face
 * statement.
 *
 * Statement roles, in order of preference:
 *   1. FilingSummary.xml: a Report whose MenuCategory is "Statements" (or, when a report has no MenuCategory, whose
 *      LongName reads "… - Statement - …"), and whose name does not say "Parenthetical";
 *   2. otherwise the roleType definitions ("0000002 - Statement - Consolidated Balance Sheets") found in the schema or
 *      the linkbase text, with the same parenthetical rule.
 *
 * Deterministic and dependency-free (regular expressions over the text, no network, no clock). Nothing is guessed:
 * no presentation link at all → null (the judge answers INSUFFICIENT_DATA with NO_PRESENTATION_LINKBASE); links but no statement role →
 * `statementRoles` is empty (NO_STATEMENT_ROLES).
 */
import { sha256 } from '../verdict/canonical.js'
import { decodeEntities } from './ixbrl.js'

export interface TwinPresentationRole {
  role: string
  /** the report / role name ("00000002 - Statement - Consolidated Balance Sheets"), "" when none is known */
  name: string
  statement: boolean
  parenthetical: boolean
  /** distinct concepts located in this role's presentation link(s) */
  concepts: number
}

export interface TwinPresentation {
  /** sha256 over the component hashes (the presentation's identity in every verdict) */
  sha256: string
  /** sha256 of each text supplied (null when not supplied) */
  inputs: { pre: string | null; filingSummary: string | null; schema: string | null }
  /** how statement roles were identified */
  source: 'filing-summary' | 'role-definition' | 'none'
  /** every role that has a presentation link, in document order */
  roles: TwinPresentationRole[]
  /** role URIs of the face statements (non-parenthetical), in document order */
  statementRoles: string[]
  /** us-gaap local names ("Assets") located on at least one face-statement role, sorted */
  statementConcepts: string[]
  stats: { links: number; locs: number }
  /** present only for the strict reading (v0.2.1); absent = the v0.2 reading */
  links?: 'strict'
}

export interface TwinPresentationInput {
  /** the presentation linkbase (`*_pre.xml`) */
  pre?: string | null
  /** EDGAR's FilingSummary.xml for the same filing */
  filingSummary?: string | null
  /** the extension schema (`*.xsd`): roleType definitions, and presentation links when the filer embeds them */
  schema?: string | null
}

export interface TwinPresentationOptions {
  /**
   * 'v0.2' (default) the reading CREDENCE-2's results are bound to, byte for byte
   * 'strict'         (required by FS_CORE_TWIN_MAP_V021) a self-closing presentationLink is an empty link; the reading
   *                  enters the presentation's sha256, so a verdict commits to which reading it bound through
   */
  links?: 'v0.2' | 'strict'
}

const US_GAAP_HREF = /(?:^|\/\/)(?:xbrl\.)?fasb\.org\/us-gaap\//i
const PARENTHETICAL = /parenthetical/i

function attr(attrs: string, name: string): string | undefined {
  const m = attrs.match(new RegExp(`(?:^|\\s)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'))
  return m ? decodeEntities(m[1] ?? m[2] ?? '') : undefined
}
const inner = (body: string, tag: string): string | undefined => {
  const m = body.match(new RegExp(`<(?:[A-Za-z_][\\w.-]*:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z_][\\w.-]*:)?${tag}\\s*>`, 'i'))
  return m ? decodeEntities(m[1]!.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).trim() : undefined
}

/** The concept a presentation locator points at: us-gaap local name, or "" for any other taxonomy. */
function usGaapConcept(href: string): string {
  const hash = href.indexOf('#')
  if (hash < 0) return ''
  const path = href.slice(0, hash), frag = href.slice(hash + 1)
  if (!US_GAAP_HREF.test(path)) return ''
  const m = frag.match(/^us-gaap_(.+)$/)
  return m ? m[1]! : ''
}

/** v0.2's reading (frozen: CREDENCE-2's results are bound to it). A self-closing link is paired with the NEXT link's close. */
const LINKS_V02 = /<((?:[A-Za-z_][\w.-]*:)?)presentationLink\b([^>]*)>([\s\S]*?)<\/\1presentationLink\s*>/g
/** The strict reading (v0.2.1): a self-closing `<presentationLink … />` is an empty link, a role with no concepts. */
const LINKS_STRICT = /<((?:[A-Za-z_][\w.-]*:)?)presentationLink\b((?:[^>/]|\/(?!>))*)(?:\/>|>([\s\S]*?)<\/\1presentationLink\s*>)/g

/**
 * Every presentation link in a text: role URI → us-gaap concepts located in it (links sharing a role are merged).
 * Under the v0.2 reading a self-closing link swallows the next link (its role, and its locators under the empty
 * link's role): measured on CREDENCE-2's Outdoor Holding package, where an empty "…Parenthetical" link hides the
 * shareholders'-equity STATEMENT. The strict reading fixes that; it is opt-in so v0.2 stays byte-identical.
 */
function readLinks(text: string, into: Map<string, Set<string>>, order: string[], stats: { links: number; locs: number }, strict: boolean): void {
  for (const m of text.matchAll(strict ? LINKS_STRICT : LINKS_V02)) {
    const role = attr(m[2]!, 'xlink:role') ?? attr(m[2]!, 'role') ?? ''
    stats.links++
    if (!into.has(role)) { into.set(role, new Set()); order.push(role) }
    const set = into.get(role)!
    for (const l of (m[3] ?? '').matchAll(/<(?:[A-Za-z_][\w.-]*:)?loc\b([^>]*?)\/?>/g)) {
      stats.locs++
      const c = usGaapConcept(attr(l[1]!, 'xlink:href') ?? '')
      if (c) set.add(c)
    }
  }
}

/** FilingSummary.xml reports: role URI → { name, statement? }. */
function readFilingSummary(xml: string): Map<string, { name: string; statement: boolean }> {
  const out = new Map<string, { name: string; statement: boolean }>()
  for (const m of xml.matchAll(/<Report\b[^>]*>([\s\S]*?)<\/Report\s*>/g)) {
    const body = m[1]!
    const role = inner(body, 'Role')
    if (!role || out.has(role)) continue
    const longName = inner(body, 'LongName') ?? ''
    const shortName = inner(body, 'ShortName') ?? ''
    const menu = inner(body, 'MenuCategory')
    const statement = menu !== undefined ? /^statements$/i.test(menu) : /\s-\s*Statement\s*-\s/i.test(longName)
    out.set(role, { name: longName || shortName, statement: statement && !PARENTHETICAL.test(`${longName} ${shortName}`) })
  }
  return out
}

/** roleType definitions in a schema or linkbase text: role URI → definition. */
function readRoleTypes(text: string, into: Map<string, string>): void {
  for (const m of text.matchAll(/<((?:[A-Za-z_][\w.-]*:)?)roleType\b([^>]*)>([\s\S]*?)<\/\1roleType\s*>/g)) {
    const role = attr(m[2]!, 'roleURI')
    const def = inner(m[3]!, 'definition')
    if (role && def !== undefined && !into.has(role)) into.set(role, def)
  }
}

/**
 * Read the filing's presentation: which roles are face statements and which us-gaap concepts they present.
 * Returns null when no presentation link is found in `pre` or `schema` (there is nothing to anchor to).
 */
export function parseTwinPresentation(input: TwinPresentationInput, opts: TwinPresentationOptions = {}): TwinPresentation | null {
  const pre = input.pre ?? null, fs = input.filingSummary ?? null, schema = input.schema ?? null
  const strict = opts.links === 'strict'
  const links = new Map<string, Set<string>>(), order: string[] = []
  const stats = { links: 0, locs: 0 }
  if (pre) readLinks(pre, links, order, stats, strict)
  if (schema) readLinks(schema, links, order, stats, strict)
  if (stats.links === 0) return null

  const summary = fs ? readFilingSummary(fs) : new Map<string, { name: string; statement: boolean }>()
  const defs = new Map<string, string>()
  if (schema) readRoleTypes(schema, defs)
  if (pre) readRoleTypes(pre, defs)
  const source: TwinPresentation['source'] = summary.size ? 'filing-summary' : defs.size ? 'role-definition' : 'none'

  const roles: TwinPresentationRole[] = order.map((role) => {
    const concepts = links.get(role)!.size
    if (source === 'filing-summary') {
      const r = summary.get(role)
      const name = r?.name ?? defs.get(role) ?? ''
      return { role, name, statement: r?.statement ?? false, parenthetical: PARENTHETICAL.test(name), concepts }
    }
    const name = defs.get(role) ?? ''
    const parenthetical = PARENTHETICAL.test(name)
    return { role, name, statement: source === 'role-definition' && /\s-\s*Statement\s*-\s/i.test(name) && !parenthetical, parenthetical, concepts }
  })
  const statementRoles = roles.filter((r) => r.statement).map((r) => r.role)
  const concepts = new Set<string>()
  for (const r of statementRoles) for (const c of links.get(r)!) concepts.add(c)
  const inputs = { pre: pre === null ? null : sha256(pre), filingSummary: fs === null ? null : sha256(fs), schema: schema === null ? null : sha256(schema) }
  return {
    sha256: sha256(`twin-presentation|${strict ? 'links:strict|' : ''}pre:${inputs.pre ?? '-'}|filing-summary:${inputs.filingSummary ?? '-'}|schema:${inputs.schema ?? '-'}`),
    inputs, source, roles, statementRoles, statementConcepts: [...concepts].sort(), stats, ...(strict ? { links: 'strict' as const } : {}),
  }
}
