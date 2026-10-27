/**
 * Read a schematron (ISO 19757-3) file into what the compiler needs (2026-10-03): every assert with its file, sha256, line,
 * pattern id, rule context, flag, test and verbatim text; the global and rule-level `let` variables; the XSLT functions a
 * schematron defines; and `include`d files, read and hashed like the file that includes them. Nothing is evaluated here.
 */

import { createHash } from 'node:crypto'
import { childElements, decodeEntities, parseXml, textContent, type XmlElement } from './xml.js'

export const SCH_NS = 'http://purl.oclc.org/dsdl/schematron'
const SCH_NS_OLD = 'http://www.ascc.net/xml/schematron'
export const XSL_NS = 'http://www.w3.org/1999/XSL/Transform'
const isSch = (e: XmlElement): boolean => e.ns === SCH_NS || e.ns === SCH_NS_OLD

export interface SourceFile { file: string; sha256: string; bytes: number; included_from?: string }
export interface Let { name: string; value: string; file: string; line: number }
export interface XslFunction { name: string; params: string[]; vars: { name: string; select: string }[]; select: string | undefined; file: string; line: number }

export interface SchematronAssert {
  /** the input file's base name and sha256 (an included file is its own input) */
  file: string
  sha256: string
  line: number
  pattern_id: string
  rule_context: string
  rule_line: number
  /** the rule's `let`s, in order (evaluated in the rule's context) */
  rule_lets: Let[]
  assert_id: string
  /** the assert's flag, else the rule's, else '' */
  flag: string
  /** the test attribute, entities decoded */
  test: string
  /** the assert's content exactly as the file has it (byte-exact, entities not decoded) */
  text_raw: string
  /** the content with entities decoded and whitespace runs collapsed; child elements shown as their markup */
  text: string
  kind: 'assert' | 'report'
  /** set when the assert cannot be compiled for a structural reason found while reading (an abstract rule, …) */
  unreadable?: string
}

export interface Schematron {
  /** the top-level file this was read from (base name) */
  file: string
  files: SourceFile[]
  /** namespace prefixes declared with <ns> (prefix → URI) */
  ns: Record<string, string>
  /** global lets (schema- and pattern-level), in document order */
  lets: Let[]
  functions: Map<string, XslFunction>
  asserts: SchematronAssert[]
  phases: { id: string; active: string[] }[]
  title?: string
}

export type ReadFile = (href: string, fromPath: string) => { path: string; text: string }

const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex')
const baseName = (p: string): string => p.replace(/\\/g, '/').split('/').pop() ?? p

/** The text of an element's content with child elements rendered as their (self-closing) markup, decoded, whitespace collapsed. */
function displayText(src: string, el: XmlElement): string {
  const parts: string[] = []
  for (const c of el.children) {
    if (c.type === 'text') parts.push(c.text)
    else {
      const attrs = Object.entries(c.attrs).map(([k, v]) => ` ${k}="${v}"`).join('')
      parts.push(c.children.length ? `<${c.name}${attrs}>${displayText(src, c)}</${c.name}>` : `<${c.name}${attrs}/>`)
    }
  }
  return parts.join('').replace(/\s+/g, ' ').trim()
}

/** Read a schematron file (and what it includes). `text` is the file's content; `path` names it for includes and reports. */
export function readSchematron(path: string, text: string, read?: ReadFile): Schematron {
  const out: Schematron = { file: baseName(path), files: [], ns: {}, lets: [], functions: new Map(), asserts: [], phases: [] }
  const visit = (filePath: string, src: string, includedFrom?: string): void => {
    const file = baseName(filePath)
    const hash = sha256(src)
    out.files.push({ file, sha256: hash, bytes: Buffer.byteLength(src, 'utf8'), ...(includedFrom ? { included_from: includedFrom } : {}) })
    const root = parseXml(src)
    const handleTop = (el: XmlElement): void => {
      if (el.ns === XSL_NS && el.local === 'function') { readFunction(el, file); return }
      if (!isSch(el)) return
      switch (el.local) {
        case 'title': out.title ??= textContent(el).replace(/\s+/g, ' ').trim(); return
        case 'ns': if (el.attrs.prefix !== undefined && el.attrs.uri !== undefined) out.ns[el.attrs.prefix] = el.attrs.uri; return
        case 'let': out.lets.push({ name: el.attrs.name ?? '', value: el.attrs.value ?? '', file, line: el.line }); return
        case 'phase': out.phases.push({ id: el.attrs.id ?? '', active: childElements(el).filter(c => isSch(c) && c.local === 'active').map(c => c.attrs.pattern ?? '') }); return
        case 'include': {
          const href = el.attrs.href
          if (!href || !read) throw new Error(`${file}:${el.line}: <include href="${href ?? ''}"> cannot be read (no file reader given)`)
          const inc = read(href, filePath)
          visit(inc.path, inc.text, file)
          return
        }
        case 'pattern': readPattern(el, file, filePath, src, hash); return
        case 'schema': for (const c of childElements(el)) handleTop(c); return
        default: return
      }
    }
    // an included file's root may itself be a pattern (XRechnung's common.sch) or a schema fragment
    if (isSch(root) && root.local === 'pattern') readPattern(root, file, filePath, src, hash)
    else if (isSch(root) && root.local === 'schema') for (const c of childElements(root)) handleTop(c)
    else throw new Error(`${file}: the root element is <${root.name}>, not a schematron schema or pattern`)
  }
  const readFunction = (el: XmlElement, file: string): void => {
    const name = el.attrs.name ?? ''
    const kids = childElements(el, XSL_NS)
    const seq = kids.filter(k => k.local === 'sequence')
    out.functions.set(name, {
      name, file, line: el.line,
      params: kids.filter(k => k.local === 'param').map(k => k.attrs.name ?? ''),
      vars: kids.filter(k => k.local === 'variable').map(k => ({ name: k.attrs.name ?? '', select: k.attrs.select ?? '' })),
      select: seq.length === 1 ? seq[0]!.attrs.select : undefined,
    })
  }
  const readPattern = (pat: XmlElement, file: string, filePath: string, src: string, hash: string): void => {
    const patternId = pat.attrs.id ?? `pattern@${pat.line}`
    const abstractPattern = pat.attrs.abstract === 'true' || pat.attrs['is-a'] !== undefined
    for (const c of childElements(pat)) {
      if (c.ns === XSL_NS && c.local === 'function') { readFunction(c, file); continue }
      if (!isSch(c)) continue
      if (c.local === 'let') { out.lets.push({ name: c.attrs.name ?? '', value: c.attrs.value ?? '', file, line: c.line }); continue }
      if (c.local === 'include') {
        const href = c.attrs.href
        if (!href || !read) throw new Error(`${file}:${c.line}: <include href="${href ?? ''}"> cannot be read (no file reader given)`)
        const inc = read(href, filePath)
        const incRoot = parseXml(inc.text)
        out.files.push({ file: baseName(inc.path), sha256: sha256(inc.text), bytes: Buffer.byteLength(inc.text, 'utf8'), included_from: file })
        if (isSch(incRoot) && incRoot.local === 'rule') readRule(incRoot, patternId, baseName(inc.path), inc.text, sha256(inc.text), abstractPattern)
        continue
      }
      if (c.local === 'rule') readRule(c, patternId, file, src, hash, abstractPattern)
    }
  }
  const readRule = (rule: XmlElement, patternId: string, file: string, src: string, hash: string, abstractPattern: boolean): void => {
    const lets: Let[] = []
    const context = rule.attrs.context ?? ''
    const why = abstractPattern ? 'the assert sits in an abstract pattern (is-a), which this compiler does not instantiate'
      : rule.attrs.abstract === 'true' ? 'the assert sits in an abstract rule, which this compiler does not instantiate'
        : childElements(rule).some(k => isSch(k) && k.local === 'extends') ? 'the rule extends an abstract rule, which this compiler does not instantiate'
          : context === '' ? 'the rule has no context' : undefined
    for (const c of childElements(rule)) {
      if (!isSch(c)) continue
      if (c.local === 'let') { lets.push({ name: c.attrs.name ?? '', value: c.attrs.value ?? '', file, line: c.line }); continue }
      if (c.local !== 'assert' && c.local !== 'report') continue
      out.asserts.push({
        file, sha256: hash, line: c.line, pattern_id: patternId, rule_context: context, rule_line: rule.line, rule_lets: [...lets],
        assert_id: c.attrs.id ?? `${patternId}@${c.line}`, flag: c.attrs.flag ?? rule.attrs.flag ?? '', test: c.attrs.test ?? '',
        text_raw: src.slice(c.innerStart, c.innerEnd), text: displayText(src, c), kind: c.local,
        ...(why ? { unreadable: why } : {}),
      })
    }
  }
  visit(path, text)
  return out
}

/** Decode a raw text (for tests and reports). */
export const decoded = (s: string): string => decodeEntities(s)
