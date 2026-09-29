/**
 * A small, strict, deterministic XML reader for structured e-invoices (UBL 2.1 / KSeF FA(3)).
 *
 * Why not a dependency: the package allows no new runtime deps, and an e-invoice needs only well-formed element
 * trees with namespaces, attributes, text and CHARACTER SPANS (every binding value is cited by its offsets into the
 * exact XML string that was hashed). Scope, stated so nobody over-trusts it:
 *   - elements, attributes (single or double quotes, whitespace around `=`), namespaces (default + prefixed,
 *     lexically scoped), text, CDATA, comments, processing instructions, the XML declaration, a leading BOM;
 *   - the five predefined entities and numeric character references;
 *   - REJECTED (parse error, never guessed): any DOCTYPE (so no entity expansion / XXE), unknown entities,
 *     mismatched or unclosed tags, duplicate attributes, an unbound prefix, content after the root.
 * It is NOT a validating parser: schema conformance is the sender's and the access point's job. The twin only reads.
 */

export interface XmlSpan { start: number; end: number }

export interface XmlElement {
  /** local name (no prefix) */
  local: string
  /** resolved namespace URI ('' when none) */
  ns: string
  /** the qualified name as written in the instance */
  qname: string
  /** attributes by qualified name as written (namespace declarations excluded) */
  attrs: Record<string, string>
  children: XmlElement[]
  parent: XmlElement | null
  /** concatenated character data of the element's DIRECT text children (entities decoded) */
  text: string
  /** the whole element, from '<' of the start tag to '>' of the end tag */
  span: XmlSpan
  /** the raw content between the start tag and the end tag (for a leaf, the value as written) */
  inner: XmlSpan
}

export class XmlParseError extends Error {
  constructor(message: string, readonly offset: number) { super(`${message} (at offset ${offset})`) }
}

const NAME_START = /[A-Za-z_\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD]/
const NAME_CHAR = /[\-.0-9:\u00B7\u0300-\u036F\u203F-\u2040A-Za-z_\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD]/
const PREDEFINED: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }
const XML_NS = 'http://www.w3.org/XML/1998/namespace'

function decode(raw: string, at: number): string {
  if (!raw.includes('&')) return raw
  return raw.replace(/&([^;&\s]*);?/g, (m, body: string, off: number) => {
    if (!m.endsWith(';')) throw new XmlParseError(`unterminated entity reference "${m}"`, at + off)
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const cp = /^[0-9a-fA-F]+$/.test(body.slice(2)) ? parseInt(body.slice(2), 16) : NaN
      if (!Number.isFinite(cp) || cp > 0x10ffff) throw new XmlParseError(`bad character reference "${m}"`, at + off)
      return String.fromCodePoint(cp)
    }
    if (body.startsWith('#')) {
      const cp = /^[0-9]+$/.test(body.slice(1)) ? parseInt(body.slice(1), 10) : NaN
      if (!Number.isFinite(cp) || cp > 0x10ffff) throw new XmlParseError(`bad character reference "${m}"`, at + off)
      return String.fromCodePoint(cp)
    }
    const v = PREDEFINED[body]
    if (v === undefined) throw new XmlParseError(`unknown entity "${m}" (DTD entities are not supported)`, at + off)
    return v
  })
}

/** Parse a whole document. Throws XmlParseError on anything outside the declared scope. */
export function parseXml(src: string): XmlElement {
  let i = src.charCodeAt(0) === 0xfeff ? 1 : 0
  const n = src.length
  let root: XmlElement | null = null
  const stack: { el: XmlElement; scope: Map<string, string>; textParts: string[] }[] = []

  const readName = (): string => {
    const s = i
    if (i >= n || !NAME_START.test(src[i]!)) throw new XmlParseError('expected a name', i)
    i++
    while (i < n && NAME_CHAR.test(src[i]!)) i++
    return src.slice(s, i)
  }
  const skipWs = (): void => { while (i < n && (src[i] === ' ' || src[i] === '\t' || src[i] === '\n' || src[i] === '\r')) i++ }
  const expect = (s: string): void => { if (!src.startsWith(s, i)) throw new XmlParseError(`expected "${s}"`, i); i += s.length }
  const resolve = (prefix: string, scope: Map<string, string>, isAttr: boolean, at: number): string => {
    if (prefix === 'xml') return XML_NS
    if (prefix === '') return isAttr ? '' : scope.get('') ?? ''
    const u = scope.get(prefix)
    if (u === undefined) throw new XmlParseError(`unbound namespace prefix "${prefix}"`, at)
    return u
  }

  while (i < n) {
    const lt = src.indexOf('<', i)
    const textEnd = lt < 0 ? n : lt
    if (textEnd > i) {
      const raw = src.slice(i, textEnd)
      if (stack.length) stack[stack.length - 1]!.textParts.push(decode(raw, i))
      else if (raw.trim() !== '') throw new XmlParseError('character data outside the root element', i)
      i = textEnd
      continue
    }
    // at '<'
    if (src.startsWith('<!--', i)) {
      const e = src.indexOf('-->', i + 4)
      if (e < 0) throw new XmlParseError('unterminated comment', i)
      i = e + 3
      continue
    }
    if (src.startsWith('<![CDATA[', i)) {
      if (!stack.length) throw new XmlParseError('CDATA outside the root element', i)
      const e = src.indexOf(']]>', i + 9)
      if (e < 0) throw new XmlParseError('unterminated CDATA section', i)
      stack[stack.length - 1]!.textParts.push(src.slice(i + 9, e))
      i = e + 3
      continue
    }
    if (src.startsWith('<!', i)) throw new XmlParseError('DOCTYPE / markup declarations are not accepted (no DTD, no entity expansion)', i)
    if (src.startsWith('<?', i)) {
      const e = src.indexOf('?>', i + 2)
      if (e < 0) throw new XmlParseError('unterminated processing instruction', i)
      i = e + 2
      continue
    }
    if (src.startsWith('</', i)) {
      const at = i
      i += 2
      const name = readName()
      skipWs()
      expect('>')
      const top = stack.pop()
      if (!top) throw new XmlParseError(`unexpected end tag </${name}>`, at)
      if (top.el.qname !== name) throw new XmlParseError(`end tag </${name}> does not match <${top.el.qname}>`, at)
      top.el.text = top.textParts.join('')
      top.el.inner.end = at
      top.el.span.end = i
      continue
    }
    // start tag
    const at = i
    if (root && !stack.length) throw new XmlParseError('content after the root element', at)
    i++
    const qname = readName()
    const rawAttrs: { name: string; value: string; at: number }[] = []
    for (;;) {
      const before = i
      skipWs()
      if (src.startsWith('/>', i) || src[i] === '>') break
      if (i === before) throw new XmlParseError(`expected whitespace before an attribute in <${qname}>`, i)
      const aAt = i
      const aName = readName()
      skipWs(); expect('='); skipWs()
      const q = src[i]
      if (q !== '"' && q !== "'") throw new XmlParseError(`attribute ${aName} value must be quoted`, i)
      const e = src.indexOf(q, i + 1)
      if (e < 0) throw new XmlParseError(`unterminated attribute ${aName}`, i)
      const rawV = src.slice(i + 1, e)
      if (rawV.includes('<')) throw new XmlParseError(`"<" in attribute ${aName}`, i)
      if (rawAttrs.some((a) => a.name === aName)) throw new XmlParseError(`duplicate attribute ${aName}`, aAt)
      rawAttrs.push({ name: aName, value: decode(rawV, i + 1), at: aAt })
      i = e + 1
    }
    const selfClose = src.startsWith('/>', i)
    i += selfClose ? 2 : 1
    const parentScope = stack.length ? stack[stack.length - 1]!.scope : new Map<string, string>()
    let scope = parentScope
    const attrs: Record<string, string> = {}
    for (const a of rawAttrs) {
      if (a.name === 'xmlns' || a.name.startsWith('xmlns:')) {
        if (scope === parentScope) scope = new Map(parentScope)
        scope.set(a.name === 'xmlns' ? '' : a.name.slice(6), a.value)
      }
    }
    for (const a of rawAttrs) {
      if (a.name === 'xmlns' || a.name.startsWith('xmlns:')) continue
      const c = a.name.indexOf(':')
      if (c > 0) resolve(a.name.slice(0, c), scope, true, a.at) // prefix must be bound
      attrs[a.name] = a.value
    }
    const c = qname.indexOf(':')
    const el: XmlElement = {
      local: c > 0 ? qname.slice(c + 1) : qname,
      ns: resolve(c > 0 ? qname.slice(0, c) : '', scope, false, at),
      qname, attrs, children: [], parent: stack.length ? stack[stack.length - 1]!.el : null, text: '',
      span: { start: at, end: i }, inner: { start: i, end: i },
    }
    if (el.parent) el.parent.children.push(el)
    else root = el
    if (!selfClose) stack.push({ el, scope, textParts: [] })
  }
  if (stack.length) throw new XmlParseError(`unclosed element <${stack[stack.length - 1]!.el.qname}>`, n)
  if (!root) throw new XmlParseError('no root element', 0)
  return root
}

/** Direct children with this namespace URI and local name. */
export function kids(el: XmlElement, ns: string, local: string): XmlElement[] {
  return el.children.filter((c) => c.local === local && c.ns === ns)
}

/** 1-based position of `el` among its parent's children of the same expanded name (for a concrete XPath). */
export function positionOf(el: XmlElement): { index: number; of: number } {
  if (!el.parent) return { index: 1, of: 1 }
  const same = el.parent.children.filter((c) => c.local === el.local && c.ns === el.ns)
  return { index: same.indexOf(el) + 1, of: same.length }
}
