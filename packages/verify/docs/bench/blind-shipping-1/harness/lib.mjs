// blind-shipping-1 harness: the pieces every script of the harness block shares (PREREG.md section 9).
// Nothing here reads data by itself; each script that uses it says what it reads.
//   - paths: where this folder, the verify build and the tree root are
//   - sha256 helpers, argument reading, JSON writing that never overwrites
//   - a namespace-aware XML scanner (offsets kept, so a planted change edits one value and leaves every other byte alone)
//   - the seed and the draw order of section 6
//   - the tree index for the drop rule of section 4 ("a file anywhere in this tree")
//   - the run's ledger (hash-chained lines; the order rule of section 3 is checked against it)
//   - the pin check of sections 2 and 10, by the code `bench check --pins-root` uses
//   - Clopper-Pearson intervals and the bar verdicts of section 7
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const HARNESS = dirname(fileURLToPath(import.meta.url))
export const RUN_DIR = resolve(HARNESS, '..') // docs/bench/blind-shipping-1
export const VERIFY_ROOT = resolve(RUN_DIR, '..', '..', '..') // packages/verify in the shipped tree
export const TREE_ROOT = resolve(RUN_DIR, '..', '..', '..', '..', '..') // the tree root, as `bench check` takes it (four folders above docs/bench)
export const CLI = join(VERIFY_ROOT, 'dist', 'cli.js')
export const PREREG = join(RUN_DIR, 'PREREG.md')
export const FIRST_STAMP = join(RUN_DIR, 'PREREG.md.filing-1.tsr')

// ---------------------------------------------------------------------------------------------------------------- basics
export const sha256 = (b) => createHash('sha256').update(b).digest('hex')
export const sha256File = (p) => sha256(readFileSync(p))
/** A file's sha256, or a folder's digest the way section 2 forms one: sha256 over "<sha256>  <path>\n" per file, sorted by path. */
export function digestOf(p) {
  if (!lstatSync(p).isDirectory()) return sha256File(p)
  const files = []
  const walk = (d, rel) => { for (const n of readdirSync(d)) { const q = join(d, n), r = rel ? `${rel}/${n}` : n; if (lstatSync(q).isDirectory()) walk(q, r); else files.push(r) } }
  walk(p, '')
  return sha256(files.sort().map(f => `${sha256File(join(p, ...f.split('/')))}  ${f}\n`).join(''))
}
export const posix = (p) => p.split(sep).join('/')

/** `--name value` arguments; repeated names collect into an array when `many` lists them. */
export function args(argv, { flags = [], many = [] } = {}) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) { out._.push(a); continue }
    const k = a.slice(2)
    if (flags.includes(k)) { out[k] = true; continue }
    const v = argv[++i]
    if (v === undefined) throw new Error(`--${k} needs a value`)
    if (many.includes(k)) (out[k] ??= []).push(v); else out[k] = v
  }
  return out
}

/** Write JSON, refusing to replace a file that exists: the arm runs once (section 10). */
export function writeNew(path, value) {
  if (existsSync(path)) throw new Error(`${path} exists; this harness never overwrites a record (section 10: each arm runs once)`)
  mkdirSync(dirname(path), { recursive: true })
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 1) + '\n'
  writeFileSync(path, text)
  return sha256(Buffer.from(text, 'utf8'))
}

export const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))

// ------------------------------------------------------------------------------------------------------- the XML scanner
// A small non-validating scanner: comments, CDATA, processing instructions, a DOCTYPE without an internal subset, start,
// end and empty tags, attributes in single or double quotes, and namespace declarations in scope. It keeps the offset of
// every element's start tag and of its text content, so a value can be read or replaced in place.

const NAME = /[A-Za-z_:\u00C0-\uFFFF][-A-Za-z0-9_.:\u00B7\u00C0-\uFFFF]*/y
const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }
export const unescapeXml = (s) => s.replace(/&(#x[0-9A-Fa-f]+|#\d+|lt|gt|amp|quot|apos);/g, (_, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e])

/**
 * Scan an XML string into a tree of elements: { ns, local, qname, attrs: [{ns, local, qname, value}], start, startEnd,
 * end, textStart, textEnd, children, parent }. `start` is the offset of '<', `startEnd` the offset after the start tag's
 * '>', `end` the offset after the end tag. Text of a leaf element is the slice textStart..textEnd (escaped as written).
 * Throws on markup it cannot read: such a file is reported, never guessed at.
 */
export function scanXml(xml) {
  let i = 0
  if (xml.charCodeAt(0) === 0xfeff) i = 1
  const root = { children: [], ns: null, local: '#document', depth: -1 }
  const stack = [{ el: root, scope: new Map([['xml', 'http://www.w3.org/XML/1998/namespace']]) }]
  let rootSeen = false
  while (i < xml.length) {
    const lt = xml.indexOf('<', i)
    if (lt < 0) break
    if (xml.startsWith('<!--', lt)) { const e = xml.indexOf('-->', lt + 4); if (e < 0) throw new Error('unclosed comment'); i = e + 3; continue }
    if (xml.startsWith('<![CDATA[', lt)) { const e = xml.indexOf(']]>', lt + 9); if (e < 0) throw new Error('unclosed CDATA'); i = e + 3; continue }
    if (xml.startsWith('<?', lt)) { const e = xml.indexOf('?>', lt + 2); if (e < 0) throw new Error('unclosed processing instruction'); i = e + 2; continue }
    if (xml.startsWith('<!DOCTYPE', lt)) {
      const e = xml.indexOf('>', lt); if (e < 0) throw new Error('unclosed DOCTYPE')
      if (xml.slice(lt, e).includes('[')) throw new Error('a DOCTYPE with an internal subset is not read')
      i = e + 1; continue
    }
    if (xml[lt + 1] === '/') {
      NAME.lastIndex = lt + 2
      const m = NAME.exec(xml); if (!m) throw new Error(`bad end tag at ${lt}`)
      const gt = xml.indexOf('>', lt); if (gt < 0) throw new Error('unclosed end tag')
      const top = stack.pop()
      if (!top || top.el.qname !== m[0]) throw new Error(`end tag </${m[0]}> does not close <${top?.el.qname}> at ${lt}`)
      top.el.textEnd = lt
      top.el.end = gt + 1
      i = gt + 1
      continue
    }
    NAME.lastIndex = lt + 1
    const m = NAME.exec(xml); if (!m) throw new Error(`bad start tag at ${lt}`)
    let j = NAME.lastIndex
    const raw = []
    for (;;) {
      while (/\s/.test(xml[j] ?? '')) j++
      if (xml[j] === '>' || xml.startsWith('/>', j)) break
      NAME.lastIndex = j
      const a = NAME.exec(xml); if (!a) throw new Error(`bad attribute at ${j}`)
      j = NAME.lastIndex
      while (/\s/.test(xml[j] ?? '')) j++
      if (xml[j] !== '=') throw new Error(`attribute without a value at ${j}`)
      j++
      while (/\s/.test(xml[j] ?? '')) j++
      const q = xml[j]; if (q !== '"' && q !== "'") throw new Error(`unquoted attribute at ${j}`)
      const e = xml.indexOf(q, j + 1); if (e < 0) throw new Error('unclosed attribute value')
      raw.push({ qname: a[0], value: unescapeXml(xml.slice(j + 1, e)) })
      j = e + 1
    }
    const empty = xml.startsWith('/>', j)
    const startEnd = j + (empty ? 2 : 1)
    const parent = stack[stack.length - 1]
    const scope = new Map(parent.scope)
    for (const a of raw) {
      if (a.qname === 'xmlns') scope.set('', a.value)
      else if (a.qname.startsWith('xmlns:')) scope.set(a.qname.slice(6), a.value)
    }
    const split = (q, isAttr) => {
      const c = q.indexOf(':')
      const prefix = c < 0 ? '' : q.slice(0, c)
      const local = c < 0 ? q : q.slice(c + 1)
      if (isAttr && c < 0) return { ns: null, local }
      if (prefix && !scope.has(prefix)) throw new Error(`undeclared prefix ${prefix}: at ${lt}`)
      return { ns: scope.get(prefix) ?? null, local }
    }
    const el = { ...split(m[0], false), qname: m[0], attrs: raw.filter(a => a.qname !== 'xmlns' && !a.qname.startsWith('xmlns:')).map(a => ({ ...split(a.qname, true), qname: a.qname, value: a.value })),
      start: lt, startEnd, textStart: startEnd, textEnd: startEnd, end: startEnd, children: [], parent: parent.el, depth: parent.el.depth + 1 }
    if (parent.el === root) { if (rootSeen) throw new Error('more than one root element'); rootSeen = true }
    parent.el.children.push(el)
    if (!empty) stack.push({ el, scope })
    i = startEnd
  }
  if (stack.length !== 1) throw new Error(`unclosed element <${stack[stack.length - 1].el.qname}>`)
  if (!root.children.length) throw new Error('no root element')
  return root.children[0]
}

export const UBL = {
  invoice: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
  creditNote: 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2',
  cac: 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
  cbc: 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
}

/** 'Invoice' or 'CreditNote' when the root element is a UBL 2.1 Invoice or CreditNote (section 4.2's selection), else null. */
export function ublRoot(buf) {
  let text
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf) } catch { return null }
  const head = text.replace(/^\uFEFF/, '').trimStart()
  if (!head.startsWith('<')) return null
  let root
  try { root = scanXml(text) } catch { return null }
  if (root.ns === UBL.invoice && root.local === 'Invoice') return 'Invoice'
  if (root.ns === UBL.creditNote && root.local === 'CreditNote') return 'CreditNote'
  return null
}

export const kids = (el, ns, local) => el.children.filter(c => c.ns === ns && c.local === local)
export const kid = (el, ns, local) => kids(el, ns, local)[0] ?? null
/** The text of a leaf element, unescaped, or null when it has element children. */
export function textOf(xml, el) {
  if (!el || el.children.length) return null
  return unescapeXml(xml.slice(el.textStart, el.textEnd).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<!--[\s\S]*?-->/g, ''))
}
export const attr = (el, local) => el?.attrs.find(a => a.ns === null && a.local === local)?.value ?? null

// ------------------------------------------------------------------------------------------------- seed and draw order
/**
 * Section 6: the seed is the sha256 of "<this file's sha256>:<the stamp's serial number>:<arm>", derived from the first
 * stamp's bytes. Both values are read from that stamp (PREREG.md.filing-1.tsr): its message imprint (the sha256 of the file
 * it stamped) and its serial number, written as `bench check` prints it (the DER integer's bytes in lower-case hex).
 * Arms are named "ap", "einvoice" and "legal".
 */
export async function seedFor(arm, stampPath = FIRST_STAMP) {
  if (!['ap', 'einvoice', 'legal'].includes(arm)) throw new Error(`unknown arm ${arm}`)
  const { parseTimestampReply } = await import(pathToFileURL(join(VERIFY_ROOT, 'dist', 'bench', 'timestamp.js')).href)
  const info = parseTimestampReply(readFileSync(stampPath))
  return { seed: sha256(`${info.imprint}:${info.serial}:${arm}`), imprint: info.imprint, serial: info.serial, stamped_at: info.gen_time, stamp_sha256: sha256File(stampPath) }
}
export const seedFromParts = (imprint, serial, arm) => sha256(`${imprint}:${serial}:${arm}`)

/** Section 6's order: the eligible items sorted by the sha256 of "<seed>:<item id>". */
export function drawOrder(seed, ids) {
  return ids.map(id => ({ id, key: sha256(`${seed}:${id}`) })).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)).map(x => x.id)
}

// ------------------------------------------------------------------------------------------------------ the tree index
// Section 4: "Any document whose sha256 equals a file anywhere in this tree is dropped." The tree is every file under the
// tree root, read once BEFORE anything is fetched, except: version-control metadata (.git), installed third-party packages
// (node_modules), this run's own outputs (results/ and tmp/ inside this folder), and folders the build marks as never read
// (named by --never-read; their files are not opened). Files are indexed by size first and hashed only when a fetched file
// has the same size, so the walk reads metadata and opens few files.
export const TREE_EXCLUDED_NAMES = ['.git', 'node_modules']
export const PRIVATE_DIR = /-(?:private|sealed)$/i

export function indexTree(root, { neverRead = [], exclude = [] } = {}) {
  const bySize = new Map()
  const skip = new Set([...neverRead, ...exclude].map(p => resolve(p).toLowerCase()))
  let files = 0, links = 0
  const walk = (dir) => {
    let names
    try { names = readdirSync(dir) } catch { return }
    for (const n of names) {
      const p = join(dir, n)
      if (TREE_EXCLUDED_NAMES.includes(n) || skip.has(resolve(p).toLowerCase())) continue
      let st
      try { st = lstatSync(p) } catch { continue }
      if (st.isSymbolicLink()) { links++; continue }
      if (st.isDirectory()) {
        // a folder the tree marks as never read is not listed and not opened: one holding a README-SEAL.md notice, or one
        // named *-private or *-sealed. It is counted, never named.
        if (PRIVATE_DIR.test(n) || existsSync(join(p, 'README-SEAL.md'))) { privateDirs++; continue }
        walk(p)
      } else if (st.isFile()) { files++; const l = bySize.get(st.size); if (l) l.push(p); else bySize.set(st.size, [p]) }
    }
  }
  let privateDirs = 0
  walk(resolve(root))
  const cache = new Map()
  return {
    root: resolve(root), files, links_not_followed: links, private_folders_not_opened: privateDirs,
    // the never-read folders are counted, not named: their names stay out of every record this run publishes
    excluded: [...TREE_EXCLUDED_NAMES.map(n => `every ${n}/`), ...exclude.map(p => posix(relative(resolve(root), resolve(p))) || '.')], never_read_folders: neverRead.length,
    /** Every file in the tree whose bytes are these (relative paths), or []. */
    matches(buf) {
      const same = bySize.get(buf.length) ?? []
      const h = sha256(buf)
      return same.filter(p => { if (!cache.has(p)) { try { cache.set(p, sha256File(p)) } catch { cache.set(p, null) } } return cache.get(p) === h }).map(p => posix(relative(resolve(root), p)))
    },
  }
}

// ----------------------------------------------------------------------------------------------------------- the ledger
// The run's ledger: one JSON line per event, each carrying the sha256 of the line before it. Section 3: the labels and the
// planted set of an arm are hashed and their hashes recorded here before the first engine call on that arm.
export const LEDGER = join(RUN_DIR, 'results', 'ledger.jsonl')

export function ledgerLines(path = LEDGER) {
  if (!existsSync(path)) return []
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean)
  let prev = null
  return lines.map((l, n) => {
    const e = JSON.parse(l)
    if (e.prev !== prev) throw new Error(`ledger line ${n + 1} does not chain to the line before it`)
    prev = sha256(Buffer.from(l, 'utf8'))
    return e
  })
}

export function ledgerAppend(event, path = LEDGER) {
  const lines = existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean) : []
  ledgerLines(path)
  const prev = lines.length ? sha256(Buffer.from(lines[lines.length - 1], 'utf8')) : null
  const line = JSON.stringify({ at: new Date().toISOString(), ...event, prev })
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, line + '\n')
  return line
}

/** The order rule: refuse unless every named record of the arm is on the ledger with the sha256 its file has now. */
export function requireRecorded(arm, records, { restart = false, path = LEDGER } = {}) {
  const lines = ledgerLines(path)
  const started = lines.filter(l => l.arm === arm && l.event === 'engine-start').length
  const restarted = lines.filter(l => l.arm === arm && l.event === 'engine-restart').length
  if (!restart && started) throw new Error(`the ${arm} arm has already started (section 10: each arm runs once; one restart from the beginning is allowed after a crash: --restart)`)
  if (restart && (!started || restarted)) throw new Error(`section 10: a restart follows exactly one start of the ${arm} arm, once`)
  for (const [kind, file] of Object.entries(records)) {
    const h = digestOf(file)
    if (!lines.some(l => l.arm === arm && l.event === 'hashed' && l.kind === kind && l.sha256 === h)) {
      throw new Error(`section 3: the ${kind} of the ${arm} arm (sha256 ${h.slice(0, 12)}…) is not on the ledger; record it (node harness/ledger.mjs hash --arm ${arm} --kind ${kind} --file <path>) before any engine call`)
    }
  }
}

// ----------------------------------------------------------------------------------------------------------- the pins
/** Sections 2 and 10: every pin, as the latest amendment's table leaves it, recomputed on the tree the runner runs. */
export async function checkPinsNow(pinsRoot = TREE_ROOT) {
  const tree = await import(pathToFileURL(join(VERIFY_ROOT, 'dist', 'bench', 'tree.js')).href)
  const pins = tree.preregPins(readFileSync(PREREG, 'utf8'))
  const rows = pins.map(p => {
    const d = tree.pinDigest(pinsRoot, p)
    return { what: p.label, version: p.version, path: p.path, pinned: p.sha256, files_pinned: p.files, tree: d?.sha256 ?? null, files_tree: d?.files ?? null, match: d?.sha256 === p.sha256 }
  })
  const c = tree.checkPins(pins, pinsRoot)
  return { pins_root: pinsRoot, rows, stale: c.stale, unrecomputed: c.unrecomputed, ok: c.stale.length === 0 && c.unrecomputed.length === 0 && c.pathless.length === 0 && rows.every(r => r.match) }
}

// ------------------------------------------------------------------------------------------- Clopper-Pearson and bars
function logGamma(x) {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5]
  let y = x, t = x + 5.5
  t -= (x + 0.5) * Math.log(t)
  let s = 1.000000000190015
  for (const c of g) s += c / ++y
  return -t + Math.log(2.5066282746310005 * s / x)
}
function betacf(a, b, x) {
  const FPMIN = 1e-300
  let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap
  if (Math.abs(d) < FPMIN) d = FPMIN
  d = 1 / d
  let h = d
  for (let m = 1; m <= 10000; m++) {
    const m2 = 2 * m
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2))
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d; h *= d * c
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < 1e-15) break
  }
  return h
}
/** The regularized incomplete beta function I_x(a, b). */
export function ibeta(x, a, b) {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x))
  return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b
}
function betaQuantile(p, a, b) {
  let lo = 0, hi = 1
  for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (ibeta(mid, a, b) < p) lo = mid; else hi = mid }
  return (lo + hi) / 2
}
/** Clopper-Pearson, 95%, two-sided (section 7). */
export function clopperPearson(k, n) {
  if (!Number.isInteger(k) || !Number.isInteger(n) || n < 0 || k < 0 || k > n) throw new Error(`bad count ${k} of ${n}`)
  if (n === 0) return { lower: 0, upper: 1 }
  return { lower: k === 0 ? 0 : betaQuantile(0.025, k, n - k + 1), upper: k === n ? 1 : betaQuantile(0.975, k + 1, n - k) }
}
/**
 * Section 7's verdict for one bar. `low`: a rate that should be low (PASS when the upper bound is at or below the bar, FAIL
 * when the lower bound is above it). `high`: a rate that should be high (PASS when the lower bound is at or above the bar,
 * FAIL when the upper bound is below it). INCONCLUSIVE otherwise; INSUFFICIENT when the sample is smaller than its size.
 */
export function barVerdict({ k, n, bar, kind, size }) {
  if (n === null || k === null) return { verdict: 'DID NOT RUN', k, n }
  const ci = clopperPearson(k, n)
  if (n < size) return { verdict: 'INSUFFICIENT', k, n, ...ci }
  let verdict = 'INCONCLUSIVE'
  if (kind === 'low') verdict = ci.upper <= bar ? 'PASS' : ci.lower > bar ? 'FAIL' : 'INCONCLUSIVE'
  else verdict = ci.lower >= bar ? 'PASS' : ci.upper < bar ? 'FAIL' : 'INCONCLUSIVE'
  return { verdict, k, n, ...ci }
}

// ---------------------------------------------------------------------------------------------- the rulesets' citations
export const RULESET_FILES = {
  '0.3.0': join(VERIFY_ROOT, 'docs', 'examples', 'peppol-en16931.ruleset.v0.3.json'),
  '0.2.0': join(VERIFY_ROOT, 'docs', 'examples', 'peppol-en16931.ruleset.v0.2.json'),
}
const RULE_ID = /^((?:BR(?:-[A-Z]+)*-\d+[a-z]?)|(?:PEPPOL-EN16931-[A-Z]+\d+)):/
/**
 * The rules a ruleset cites, read off its checks: a check whose name begins with a rule id and a colon ("BR-CO-10: …",
 * "PEPPOL-EN16931-R120: …") cites that rule. A check whose name begins otherwise (0.3.0's document-wide R120 slack says it
 * is "not an EN 16931 or Peppol rule") cites none. Returns { rules: [ids], byCode: { checkCode: ruleId | null } }.
 */
export function citedRules(rulesetJson) {
  const byCode = {}
  for (const c of rulesetJson.checks ?? []) byCode[c.code] = c.name?.match(RULE_ID)?.[1] ?? null
  return { rules: [...new Set(Object.values(byCode).filter(Boolean))].sort(), byCode }
}
