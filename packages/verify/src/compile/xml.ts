/**
 * A small XML reader for schematron files (2026-10-03, the standards compiler). It reads elements, attributes, text,
 * comments, CDATA and the five predefined entities plus character references, and it keeps what a compiled check has to
 * cite: the line of every element and the byte-exact source of every element's content (so an assert's text is quoted
 * verbatim). Namespaces are resolved per element (prefix → URI), so a schematron element is recognised by its namespace,
 * not by the prefix its author chose. It is not a general XML parser: no DTD processing and no external entities (a
 * DOCTYPE is skipped), which is what a schematron needs and what keeps it safe to run on a downloaded file.
 */

export interface XmlElement {
  type: 'element'
  /** the qualified name as written, e.g. "assert", "xsl:function" */
  name: string
  /** the local part of the name */
  local: string
  /** the namespace URI the element's prefix (or the default namespace) resolves to, '' when none */
  ns: string
  /** attributes, values decoded */
  attrs: Record<string, string>
  children: XmlNode[]
  /** 1-based line of the element's '<' */
  line: number
  /** the namespace bindings in scope at this element (prefix → URI; '' is the default namespace) */
  scope: Readonly<Record<string, string>>
  /** offsets into the source: the content between the start tag's '>' and the end tag's '<' (equal for an empty element) */
  innerStart: number
  innerEnd: number
}
export interface XmlText { type: 'text'; text: string; line: number }
export type XmlNode = XmlElement | XmlText

export class XmlError extends Error {
  constructor(message: string, readonly line: number) { super(`${message} (line ${line})`) }
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

/** Decode the predefined entities and character references in text or an attribute value. */
export function decodeEntities(s: string, line = 0): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z][\w.-]*);/g, (_m, e: string) => {
    if (e.startsWith('#x')) return String.fromCodePoint(parseInt(e.slice(2), 16))
    if (e.startsWith('#')) return String.fromCodePoint(parseInt(e.slice(1), 10))
    const v = ENTITIES[e]
    if (v === undefined) throw new XmlError(`unknown entity &${e};`, line)
    return v
  })
}

/** Parse an XML document; returns its root element. */
export function parseXml(src: string): XmlElement {
  let i = 0
  let line = 1
  const advance = (to: number): void => { for (let k = i; k < to; k++) if (src.charCodeAt(k) === 10) line++; i = to }
  const stack: XmlElement[] = []
  let root: XmlElement | undefined
  const pushText = (text: string, at: number): void => {
    const top = stack[stack.length - 1]
    if (!top) { if (text.trim()) throw new XmlError('text outside the root element', at); return }
    top.children.push({ type: 'text', text, line: at })
  }
  if (src.charCodeAt(0) === 0xfeff) i = 1
  while (i < src.length) {
    const lt = src.indexOf('<', i)
    if (lt < 0) { pushText(decodeEntities(src.slice(i), line), line); advance(src.length); break }
    if (lt > i) { const at = line; const raw = src.slice(i, lt); advance(lt); pushText(decodeEntities(raw, at), at) }
    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4)
      if (end < 0) throw new XmlError('unterminated comment', line)
      advance(end + 3); continue
    }
    if (src.startsWith('<![CDATA[', i)) {
      const end = src.indexOf(']]>', i + 9)
      if (end < 0) throw new XmlError('unterminated CDATA section', line)
      const at = line; const text = src.slice(i + 9, end); advance(end + 3); pushText(text, at); continue
    }
    if (src.startsWith('<?', i)) {
      const end = src.indexOf('?>', i + 2)
      if (end < 0) throw new XmlError('unterminated processing instruction', line)
      advance(end + 2); continue
    }
    if (src.startsWith('<!DOCTYPE', i) || src.startsWith('<!doctype', i)) {
      // skipped, with any internal subset; no entity it declares is ever expanded
      let depth = 0, k = i
      for (; k < src.length; k++) { const c = src[k]; if (c === '[') depth++; else if (c === ']') depth--; else if (c === '>' && depth <= 0) break }
      advance(k + 1); continue
    }
    if (src.startsWith('</', i)) {
      const end = src.indexOf('>', i)
      if (end < 0) throw new XmlError('unterminated end tag', line)
      const name = src.slice(i + 2, end).trim()
      const top = stack.pop()
      if (!top || top.name !== name) throw new XmlError(`end tag </${name}> does not close <${top?.name ?? '(none)'}>`, line)
      top.innerEnd = i
      advance(end + 1)
      if (stack.length === 0) root = top
      continue
    }
    // a start tag
    const startLine = line
    let k = i + 1
    while (k < src.length && !/[\s/>]/.test(src[k] as string)) k++
    const name = src.slice(i + 1, k)
    if (!name) throw new XmlError('empty tag name', line)
    const attrs: Record<string, string> = {}
    let selfClosing = false
    for (;;) {
      while (k < src.length && /\s/.test(src[k] as string)) k++
      if (src[k] === '/' && src[k + 1] === '>') { selfClosing = true; k += 2; break }
      if (src[k] === '>') { k += 1; break }
      if (k >= src.length) throw new XmlError(`unterminated start tag <${name}>`, startLine)
      let a = k
      while (a < src.length && !/[\s=/>]/.test(src[a] as string)) a++
      const an = src.slice(k, a)
      while (a < src.length && /\s/.test(src[a] as string)) a++
      if (src[a] !== '=') throw new XmlError(`attribute ${an} has no value`, startLine)
      a++
      while (a < src.length && /\s/.test(src[a] as string)) a++
      const q = src[a]
      if (q !== '"' && q !== "'") throw new XmlError(`attribute ${an} is not quoted`, startLine)
      const close = src.indexOf(q, a + 1)
      if (close < 0) throw new XmlError(`attribute ${an} is not closed`, startLine)
      attrs[an] = decodeEntities(src.slice(a + 1, close), startLine)
      k = close + 1
    }
    const parentScope = stack[stack.length - 1]?.scope ?? { xml: 'http://www.w3.org/XML/1998/namespace' }
    let scope: Record<string, string> | undefined
    for (const [an, av] of Object.entries(attrs)) {
      if (an === 'xmlns') (scope ??= { ...parentScope })[''] = av
      else if (an.startsWith('xmlns:')) (scope ??= { ...parentScope })[an.slice(6)] = av
    }
    const sc = scope ?? parentScope
    const colon = name.indexOf(':')
    const prefix = colon >= 0 ? name.slice(0, colon) : ''
    const el: XmlElement = {
      type: 'element', name, local: colon >= 0 ? name.slice(colon + 1) : name, ns: sc[prefix] ?? '', attrs, children: [],
      line: startLine, scope: sc, innerStart: k, innerEnd: k,
    }
    const parent = stack[stack.length - 1]
    if (parent) parent.children.push(el)
    else if (root) throw new XmlError('a second root element', startLine)
    advance(k)
    if (selfClosing) { if (!parent) root = el } else stack.push(el)
  }
  if (stack.length) throw new XmlError(`<${stack[stack.length - 1]!.name}> is not closed`, line)
  if (!root) throw new XmlError('no root element', 1)
  return root
}

/** The element's text content (children's text concatenated, elements included recursively). */
export function textContent(el: XmlElement): string {
  return el.children.map(c => (c.type === 'text' ? c.text : textContent(c))).join('')
}

/** Child elements, optionally filtered by namespace URI and local name. */
export function childElements(el: XmlElement, ns?: string, local?: string): XmlElement[] {
  return el.children.filter((c): c is XmlElement => c.type === 'element' && (ns === undefined || c.ns === ns) && (local === undefined || c.local === local))
}
