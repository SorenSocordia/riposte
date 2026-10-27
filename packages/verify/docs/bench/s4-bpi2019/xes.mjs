// Streaming IEEE-XES reader, no dependencies. Yields one trace at a time: { index, attrs, events }.
// attrs / each event = { key: typedValue } for the attribute elements directly inside it (string, float, int, date,
// boolean, id). Attributes inside <global> / <extension> / <classifier> are skipped. Nested (meta) attribute children are
// skipped. Values are XML-entity-decoded. Memory: one trace at a time plus one read chunk.
import { createReadStream } from 'node:fs'

const TAG = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g
const ATTR = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
const TYPED = new Set(['string', 'float', 'int', 'date', 'boolean', 'id'])

export function decodeEntities(s) {
  if (s.indexOf('&') < 0) return s
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e) =>
    e === 'amp' ? '&' : e === 'lt' ? '<' : e === 'gt' ? '>' : e === 'quot' ? '"' : e === 'apos' ? "'"
      : e[1] === 'x' ? String.fromCodePoint(parseInt(e.slice(2), 16)) : String.fromCodePoint(parseInt(e.slice(1), 10)))
}

function parseAttrs(s) {
  const o = {}
  ATTR.lastIndex = 0
  let m
  while ((m = ATTR.exec(s))) o[m[1]] = decodeEntities(m[2] ?? m[3] ?? '')
  return o
}

function typed(type, raw) {
  if (type === 'float' || type === 'int') return Number(raw)
  if (type === 'boolean') return raw === 'true' ? true : raw === 'false' ? false : raw
  return raw
}

/**
 * @param {string} path
 * @param {{ limit?: number, onSchema?: (kind: 'trace'|'event', type: string, key: string) => void }} [opts]
 */
export async function* traces(path, opts = {}) {
  const limit = opts.limit ?? Infinity
  const stream = createReadStream(path, { encoding: 'utf8', highWaterMark: 1 << 20 })
  let carry = ''
  let skipDepth = 0 // inside <global>, <extension>, <classifier> containers (non-self-closing)
  let nestDepth = 0 // inside a non-self-closing typed attribute (its children are meta attributes)
  let trace = null
  let event = null
  let index = 0
  const out = []
  for await (const chunk of stream) {
    const data = carry + chunk
    TAG.lastIndex = 0
    let m
    let lastEnd = 0
    while ((m = TAG.exec(data))) {
      lastEnd = TAG.lastIndex
      const [, close, name, attrStr, self] = m
      if (skipDepth > 0) {
        if (!self && (name === 'global' || name === 'extension' || name === 'classifier')) skipDepth += close ? -1 : 1
        continue
      }
      if (!close && !self && (name === 'global' || name === 'extension' || name === 'classifier')) { skipDepth = 1; continue }
      if (TYPED.has(name)) {
        if (close) { if (nestDepth > 0) nestDepth--; continue }
        if (nestDepth > 0) { if (!self) nestDepth++; continue }
        if (!self) nestDepth = 1
        const a = parseAttrs(attrStr)
        if (a.key === undefined) continue
        const v = typed(name, a.value ?? '')
        if (event) { event[a.key] = v; opts.onSchema?.('event', name, a.key) }
        else if (trace) { trace.attrs[a.key] = v; opts.onSchema?.('trace', name, a.key) }
        continue
      }
      if (name === 'trace') {
        if (!close && !self) trace = { index: index, attrs: {}, events: [] }
        else if (close && trace) { out.push(trace); trace = null; index++ }
      } else if (name === 'event') {
        if (!close && !self) event = {}
        else if (close && event) { if (trace) trace.events.push(event); event = null }
      }
    }
    const rest = data.slice(lastEnd)
    const lt = rest.lastIndexOf('<')
    carry = lt >= 0 ? rest.slice(lt) : ''
    while (out.length) {
      const t = out.shift()
      yield t
      if (t.index + 1 >= limit) { stream.destroy(); return }
    }
  }
}
