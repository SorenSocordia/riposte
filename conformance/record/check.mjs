// SPDX-License-Identifier: Apache-2.0
// Prototype; no measured accuracy. The record vectors (riposte.record-vectors/0.1.0; SPEC.md beside this file) run against any
// implementation of the record tier, with no dependencies (Node.js 20.6 or later). Import it from any test runner and assert
// that `failures` is empty:
//
//   import { check } from '<path to>/conformance/record/check.mjs'
//   const { passed, failures, parts } = check(impl, { words: false })
//
// Every member of impl is optional; check runs each part the implementation offers and counts a pass per case.
// impl.canonicalize(value)                     canonical JSON text of a parsed value                              (canonical)
// impl.parseStrict(text, name)                 the engine's strict reader: the value, or a throw with .where      (strict)
// impl.decodeStrict(bytes, name)               the engine's UTF-8 decoder: the text, or a throw with .where       (strict)
// impl.parseStrictGraph(text, name)            the work graph's strict reader (nesting limit 64); a throw with .at (strict)
// impl.decodeStrictGraph(bytes, name)          the work graph's UTF-8 decoder                                       (strict)
// impl.sha256Canonical(value)                  sha256 hex of canonical JSON (input_hash, extraction_hash, ...)    (hashes)
// impl.verdictId(input_hash, ruleset, engine_version, remedy_table_hash)   the 32-hex verdict id                  (hashes)
// impl.fragId(frag), impl.bodySha256(frag)     a frag's id and the hash its record entry commits to               (hashes)
// impl.entryHash(entry)                        a ledger entry's hash                                               (hashes)
// impl.workFragId(frag), impl.charterId(charter), impl.bundleSha256(deposit)                                       (hashes)
// impl.indexChain(text)                        { line_sha256: [...], head_record: { bytes, count, head } }         (hashes)
// impl.pinDigest(folder, { recursive, suffix }) { sha256, files }: the pin rule over a folder on disk               (hashes)
// impl.keyFingerprint(pem)                     sha256 hex of the key's DER SubjectPublicKeyInfo (a private PEM: its public half)
// impl.verifySignature(publicKeyPem, messageBytes, signatureBase64)   true or false, never a throw               (ed25519)
// impl.signedMessage(kind, object)             the bytes a kind signs (ledger-entry, envelope, frag, charter)     (ed25519)
// impl.verifySigned(kind, object, issuerPem)   the format's own signature check: true or false                  (ed25519)
// impl.ledger(argv, folder), impl.frag(argv, folder), impl.workgraph(argv, folder)
//                                              run the command with the folder as its working folder: { code, out, err }
// opts.words   default false: a command case compares its exit code and its first lines; true: its whole stdout and stderr too
//
// Run as a program, it checks the Node packages that wrote the file and prints `passed N, failures M`:
//   node conformance/record/check.mjs [--words]
// Exit 0: every case as expected. Exit 1: at least one was not. Exit 3: vectors.json or the packages cannot be read.
import { createHash, createPublicKey, verify as edVerify } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { register } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const SCHEMA = 'riposte.record-vectors/0.1.0'
export const CASES = new URL('./vectors.json', import.meta.url)
export const PARTS = ['canonical', 'strict', 'hashes', 'ed25519', 'ledger', 'frag', 'workgraph']

export function loadCases(file = CASES) {
  const cases = JSON.parse(readFileSync(file, 'utf8'))
  if (cases.schema !== SCHEMA) throw new Error(`not ${SCHEMA}: ${String(cases.schema)}`)
  return cases
}

// ── files: a fixture is { "<path>": { "utf8": text } | { "base64": bytes } }; a change adds, replaces, edits or removes ──

export const bytesOf = (f) => (typeof f.utf8 === 'string' ? Buffer.from(f.utf8, 'utf8') : Buffer.from(f.base64, 'base64'))

/** A fixture with a case's change applied: null removes a file; { replace: [a, b] } swaps the first a for b in its text. */
export function applyChange(files, change) {
  const out = { ...files }
  for (const [p, c] of Object.entries(change ?? {})) {
    if (c === null) { if (!(p in out)) throw new Error(`change: ${p} is not in the fixture`); delete out[p] }
    else if (Array.isArray(c.replace)) {
      if (!(p in out)) throw new Error(`change: ${p} is not in the fixture`)
      const t = bytesOf(out[p]).toString('utf8')
      const [a, b] = c.replace
      const i = t.indexOf(a)
      if (i < 0) throw new Error(`change: ${JSON.stringify(a.slice(0, 40))} is not in ${p}`)
      out[p] = { utf8: t.slice(0, i) + b + t.slice(i + a.length) }
    } else out[p] = c
  }
  return out
}

export function writeTree(dir, files) {
  for (const [p, f] of Object.entries(files)) {
    const target = join(dir, ...p.split('/'))
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, bytesOf(f))
  }
}

/** Every file under `dir` as a fixture (sorted by path); `skip(path)` leaves files out. */
export function readTree(dir, skip = () => false) {
  const out = {}
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const f = join(d, e.name)
      if (e.isDirectory()) walk(f)
      else {
        const p = relative(dir, f).split(sep).join('/')
        if (skip(p)) continue
        const b = readFileSync(f)
        const t = b.toString('utf8')
        out[p] = Buffer.from(t, 'utf8').equals(b) ? { utf8: t } : { base64: b.toString('base64') }
      }
    }
  }
  walk(dir)
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}

/** Run `fn(folder)` in a fresh folder holding `files`, removed afterwards. */
export function inFolder(files, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'record-vectors-case-'))
  try { writeTree(dir, files); return fn(dir) } finally { rmSync(dir, { recursive: true, force: true }) }
}

/** A case's files: its fixture with its change applied. */
export const filesOf = (cases, c) => applyChange(cases.fixtures[c.fixture] ?? {}, c.change)

/** An object a case names inside a fixture: { fixture, file, line? }, read as JSON (line: the n-th line of the file, from 0). */
export function sourceOf(cases, s) {
  const text = bytesOf(cases.fixtures[s.fixture][s.file]).toString('utf8')
  return JSON.parse(s.line === undefined ? text : text.split('\n')[s.line])
}

/** The object an ed25519 case signs, with the case's signature and public key put in place of the fixture's. */
export function signedObject(cases, c) {
  const o = c.object ?? sourceOf(cases, c.source)
  const set = (holder, sigKey) => {
    if (c.signature !== undefined) holder[sigKey] = c.signature
    if (c.public_key !== undefined) holder.public_key = c.public_key
  }
  if (c.kind === 'ledger-entry') set(o.signature, 'sig')
  else if (c.kind === 'envelope') set(o, 'signature')
  else if (c.kind === 'frag') set(o.signature, 'signature')
  else if (c.kind === 'charter') { if (c.signature !== undefined) o.signatures[0].signature = c.signature }
  return o
}

const sha256Hex = (b) => createHash('sha256').update(b).digest('hex')
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const show = (x) => { const s = JSON.stringify(x); return s === undefined ? 'nothing' : s.length > 160 ? `${s.slice(0, 157)}...` : s }

export function check(impl, opts = {}) {
  const cases = opts.cases ?? loadCases()
  const words = opts.words === true
  const failures = []
  let passed = 0
  const parts = {}
  let mark = 0
  const part = (name) => { parts[name] = passed - mark; mark = passed }
  const pass = () => { passed++ }
  const fail = (part, c, why) => { failures.push(`${part}, ${c.name}: ${why}`) }

  // 1. canonical JSON: text in, canonical text out
  if (typeof impl.canonicalize === 'function') {
    for (const c of cases.canonical) {
      let got
      try { got = impl.canonicalize(JSON.parse(c.text)) } catch (e) { fail('canonical', c, `threw ${e && e.message}`); continue }
      if (got === c.expect.canonical) pass()
      else fail('canonical', c, `got ${show(got)}, expected ${show(c.expect.canonical)}`)
    }
  }
  part('canonical')

  // 1b. the strict readers: accepted (with the value's canonical form) or refused (with where, and the words when asked)
  for (const c of cases.strict) {
    const graph = c.reader === 'workgraph'
    const parse = graph ? impl.parseStrictGraph : impl.parseStrict
    const decode = graph ? impl.decodeStrictGraph : impl.decodeStrict
    if (typeof parse !== 'function' || (c.base64 !== undefined && typeof decode !== 'function')) continue
    let value
    try {
      const text = c.base64 !== undefined ? decode(Buffer.from(c.base64, 'base64'), c.file) : c.text
      value = parse(text, c.file)
    } catch (e) {
      const where = e && (e.where ?? e.at)
      if (!c.expect.refused) { fail('strict', c, `refused (${where ?? '-'}): ${e && e.message}`); continue }
      if ((where ?? null) !== c.expect.refused.where) { fail('strict', c, `refused at ${where ?? 'no place'}, expected at ${c.expect.refused.where ?? 'no place'}`); continue }
      if (words && e.message !== c.expect.refused.message) { fail('strict', c, `the words differ: ${show(e.message)}`); continue }
      pass()
      continue
    }
    if (c.expect.refused) { fail('strict', c, `accepted, expected a refusal at ${c.expect.refused.where ?? 'no place'}`); continue }
    if (typeof impl.canonicalize === 'function' && impl.canonicalize(value) !== c.expect.canonical) fail('strict', c, `read as ${show(impl.canonicalize(value))}, expected ${show(c.expect.canonical)}`)
    else pass()
  }
  part('strict')

  // 2. sha256 bindings
  const rules = {
    sha256_canonical: (c) => impl.sha256Canonical && { sha256: impl.sha256Canonical(JSON.parse(c.text)) },
    verdict_id: (c) => impl.verdictId && { verdict_id: impl.verdictId(c.input_hash, c.ruleset, c.engine_version, c.remedy_table_hash) },
    frag_id: (c) => impl.fragId && impl.bodySha256 && ((f) => ({ frag_id: impl.fragId(f), body_sha256: impl.bodySha256(f) }))(sourceOf(cases, c.source)),
    entry_hash: (c) => impl.entryHash && { hash: impl.entryHash(c.entry ?? sourceOf(cases, c.source)) },
    work_frag_id: (c) => impl.workFragId && { id: impl.workFragId(sourceOf(cases, c.source)) },
    charter_id: (c) => impl.charterId && { id: impl.charterId(sourceOf(cases, c.source)) },
    bundle_sha256: (c) => impl.bundleSha256 && { bundle_sha256: impl.bundleSha256(sourceOf(cases, c.source)) },
    index_chain: (c) => impl.indexChain && impl.indexChain(bytesOf(cases.fixtures[c.source.fixture][c.source.file]).toString('utf8')),
    pin_rule: (c) => impl.pinDigest && inFolder(cases.fixtures[c.source.fixture], (d) => impl.pinDigest(join(d, ...c.source.folder.split('/')), { recursive: c.recursive, suffix: c.suffix ?? null })),
    key_fingerprint: (c) => impl.keyFingerprint && { fingerprint: impl.keyFingerprint(c.pem) },
  }
  for (const c of cases.hashes) {
    let got
    try { got = rules[c.rule](c) } catch (e) { fail('hashes', c, `threw ${e && e.message}`); continue }
    if (!got) continue
    const off = Object.keys(c.expect).filter((k) => !same(got[k], c.expect[k]))
    if (!off.length) pass()
    else fail('hashes', c, off.map((k) => `${k} ${show(got[k])}, expected ${show(c.expect[k])}`).join('; '))
  }
  part('hashes')

  // 3. Ed25519: raw verification, the message each kind signs, and each format's own check
  for (const c of cases.ed25519) {
    if (c.kind === 'raw') {
      if (typeof impl.verifySignature !== 'function') continue
      let got
      try { got = impl.verifySignature(c.public_key, Buffer.from(c.message_hex, 'hex'), c.signature) } catch (e) { fail('ed25519', c, `threw ${e && e.message}`); continue }
      if (got === c.expect.valid) pass()
      else fail('ed25519', c, `${got ? 'verifies' : 'does not verify'}, expected it ${c.expect.valid ? 'to verify' : 'not to verify'}`)
      continue
    }
    const o = signedObject(cases, c)
    if (c.expect.message_sha256 !== undefined && typeof impl.signedMessage === 'function') {
      let m
      try { m = impl.signedMessage(c.kind, o) } catch (e) { fail('ed25519', c, `signedMessage threw ${e && e.message}`); continue }
      const h = sha256Hex(typeof m === 'string' ? Buffer.from(m, 'utf8') : m)
      if (h !== c.expect.message_sha256) { fail('ed25519', c, `the signed message hashes to ${h}, expected ${c.expect.message_sha256}`); continue }
    }
    if (typeof impl.verifySigned !== 'function') continue
    let got
    try { got = impl.verifySigned(c.kind, o, c.issuer ? cases.keys[c.issuer].public_key : undefined) } catch (e) { fail('ed25519', c, `threw ${e && e.message}`); continue }
    if (got === c.expect.valid) pass()
    else fail('ed25519', c, `${got ? 'verifies' : 'does not verify'}, expected it ${c.expect.valid ? 'to verify' : 'not to verify'}`)
  }
  part('ed25519')

  // 4-6. the commands: the ledger, frag open, workgraph open and its store
  for (const name of ['ledger', 'frag', 'workgraph']) {
    const run = impl[name]
    if (typeof run === 'function') {
      for (const c of cases[name]) {
        let r
        try { r = inFolder(filesOf(cases, c), (d) => run(c.argv, d)) } catch (e) { fail(name, c, `threw ${e && e.message}`); continue }
        const why = commandDifference(r, c.expect, words)
        if (why) fail(name, c, why)
        else pass()
      }
    }
    part(name)
  }
  return { passed, failures, parts }
}

/** Why a command's result is not the case's (undefined when it is). */
export function commandDifference(r, e, words) {
  // the Node tool stopped with an exception and printed no verdict line: only the exit is the contract
  if (e.threw) return r.code === e.exit ? undefined : `exit ${r.code}, expected ${e.exit} (the Node tool stops with an exception here)`
  if (r.code !== e.exit) return `exit ${r.code}, expected ${e.exit}${e.head ? ` (${show(e.head[0])})` : ''}; ${show(((e.stream === 'stdout' ? r.out : r.err) || r.out || r.err).split('\n')[0])}`
  if (e.head) {
    const lines = (e.stream === 'stdout' ? r.out : r.err).split('\n').slice(0, e.head.length)
    const at = e.head.findIndex((l, i) => lines[i] !== l)
    if (at >= 0) return `${e.stream} line ${at + 1} is ${show(lines[at])}, expected ${show(e.head[at])}`
  }
  if (words) {
    for (const s of ['stdout', 'stderr']) {
      const got = s === 'stdout' ? r.out : r.err
      if (got !== e[s]) {
        const a = got.split('\n')
        const b = e[s].split('\n')
        const n = a.findIndex((l, i) => l !== b[i])
        return `${s} differs at line ${n + 1}: ${show(a[n])}, expected ${show(b[n])}`
      }
    }
  }
  return undefined
}

// ── the Node packages that wrote the file: found, loaded and wrapped as an implementation ────────────────────────────────

const HERE = dirname(fileURLToPath(import.meta.url))
/** The repository root (the exported layout) or the folder that holds conformance/ (the development layout). */
const ROOT = join(HERE, '..', '..')
/** Each package by the names its importers use: the published name, and the name the development layout gives it. */
export const PACKAGES = { verify: ['riposte-verify', 'verify'], receipts: ['riposte-ai', 'receipts'], frag: ['riposte-frag', 'frag'], workgraph: ['riposte-workgraph', 'workgraph'] }

/** A built package: under $RIPOSTE_NODE_PACKAGES, else packages/<name> under the repository root, else <name> beside it. */
export function packageDir(name) {
  const c = []
  if (process.env.RIPOSTE_NODE_PACKAGES) c.push(join(process.env.RIPOSTE_NODE_PACKAGES, name))
  c.push(join(ROOT, 'packages', name), join(dirname(ROOT), name))
  return c.find((d) => existsSync(join(d, 'dist', 'index.js')))
}

let loaded
/**
 * Load the four packages, each from its dist/, through one resolve hook that maps every name above to its folder (so the
 * frag package finds the engine and the ledger in either layout, with no link on disk).
 */
export async function loadPackages() {
  if (loaded) return loaded
  const dirs = {}
  for (const n of Object.keys(PACKAGES)) {
    dirs[n] = packageDir(n)
    if (!dirs[n]) throw new Error(`the ${n} package is not built (no dist/index.js under $RIPOSTE_NODE_PACKAGES, ${join(ROOT, 'packages', n)} or ${join(dirname(ROOT), n)}): run npm run build`)
  }
  const map = {}
  for (const [n, names] of Object.entries(PACKAGES)) for (const a of names) map[a] = pathToFileURL(dirs[n]).href
  const hook = `const M = ${JSON.stringify(map)};
export async function resolve(s, c, n) {
  if (Object.prototype.hasOwnProperty.call(M, s)) return { url: M[s] + '/dist/index.js', shortCircuit: true }
  const i = s.indexOf('/')
  if (i > 0 && Object.prototype.hasOwnProperty.call(M, s.slice(0, i))) return { url: M[s.slice(0, i)] + s.slice(i), shortCircuit: true }
  return n(s, c)
}`
  register(`data:text/javascript,${encodeURIComponent(hook)}`)
  const [V, R, F, W] = await Promise.all(['verify', 'receipts', 'frag', 'workgraph'].map((n) => import(`${pathToFileURL(dirs[n]).href}/dist/index.js`)))
  loaded = { V, R, F, W, dirs }
  return loaded
}

/** Run `fn` with the process in `dir` (each command reads its paths as given, from its working folder, as its bin does). */
function inDir(dir, fn) {
  const prev = process.cwd()
  process.chdir(dir)
  try { return fn() } finally { process.chdir(prev) }
}

/** The Node packages as an implementation of every part. */
export function nodeImpl({ V, R, F, W }) {
  const collect = (fn) => { let out = ''; let err = ''; const code = fn({ out: (s) => { out += s }, err: (s) => { err += s } }); return { code, out, err } }
  const tryVerify = (pem, msg, sig) => { try { return edVerify(null, msg, createPublicKey(pem), Buffer.from(sig, 'base64')) } catch { return false } }
  return {
    canonicalize: (v) => V.canonicalize(v),
    parseStrict: (t, n) => V.parseJsonStrict(t, n),
    decodeStrict: (b, n) => V.decodeUtf8Strict(new Uint8Array(b), n),
    parseStrictGraph: (t, n) => W.parseStrict(t, n),
    decodeStrictGraph: (b, n) => W.decodeUtf8Strict(new Uint8Array(b), n),
    sha256Canonical: (v) => V.hashOf(v),
    verdictId: (h, rs, e, rth) => V.deriveVerdictId(h, rs, e, rth ?? undefined),
    fragId: (f) => F.fragIdOf(f),
    bodySha256: (f) => F.bodySha256(f),
    entryHash: (e) => R.entryHash(e),
    workFragId: (f) => W.fragId(f),
    charterId: (c) => W.charterId(c),
    bundleSha256: (d) => { const { bundle_sha256: _, ...body } = d; return W.hashOf(body) },
    indexChain: (text) => {
      const lines = text.split('\n').filter((l, i, a) => i < a.length - 1 || l !== '')
      return { line_sha256: lines.map((l) => W.sha256(l)), head_record: { bytes: Buffer.byteLength(text, 'utf8'), count: lines.length, head: lines.length ? W.sha256(lines[lines.length - 1]) : '0'.repeat(64) } }
    },
    pinDigest: (dir, o) => { const d = F.digestFolder(dir, { recursive: o.recursive, ...(o.suffix ? { filter: (f) => f.endsWith(o.suffix) } : {}) }); return { sha256: d.sha256, files: d.files } },
    keyFingerprint: (pem) => R.publicOf(pem).fingerprint,
    verifySignature: tryVerify,
    signedMessage: (kind, o) => kind === 'ledger-entry' ? Buffer.from(o.hash, 'utf8')
      : kind === 'envelope' ? Buffer.from(V.canonicalize(o.verdict), 'utf8')
        : kind === 'frag' ? Buffer.from(F.FRAG_SIGNING_PREFIX + V.canonicalize(F.signedBody(o)), 'utf8')
          : W.signingMessage(o),
    verifySigned: (kind, o, issuer) => {
      if (kind === 'ledger-entry') return R.verifyEntry(o).ok
      if (kind === 'envelope') return V.verifyEnvelope(o).signature_ok
      if (kind === 'frag') return F.verifyFragSignature(o, o.signature, issuer).ok
      try { W.validateCharter(o); return true } catch (e) { if (e && e.code === 'signature_invalid') return false; throw e }
    },
    // an exception ends the bin with exit 1 and a stack trace, no verdict line (measured on the bin when the file was written)
    ledger: (argv, dir) => inDir(dir, () => { try { return R.ledgerCli(argv, (p) => R.readLedgerText(readFileSync(p), p)) } catch (e) { return { code: 1, out: '', err: `${e && e.name}: ${e && e.message}
` } } }),
    frag: (argv, dir) => inDir(dir, () => collect((io) => F.main(argv, { ...io, cwd: dir }))),
    workgraph: (argv, dir) => inDir(dir, () => collect((io) => W.main(argv, { ...io, cwd: dir, env: {} }))),
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const words = process.argv.includes('--words')
  let cases
  let impl
  try {
    cases = loadCases()
    impl = nodeImpl(await loadPackages())
  } catch (e) {
    console.log(`cannot read the vectors or the packages: ${e && e.message}`)
    process.exit(3)
  }
  const { passed, failures, parts } = check(impl, { cases, words })
  for (const f of failures) console.log(f)
  console.log(Object.entries(parts).map(([k, v]) => `${k} ${v}`).join(', '))
  console.log(`node ${process.versions.node}${words ? ', words' : ''}: passed ${passed}, failures ${failures.length}`)
  process.exit(failures.length ? 1 : 0)
}
