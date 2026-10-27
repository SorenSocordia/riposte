// SPDX-License-Identifier: Apache-2.0
// Prototype; no measured accuracy. Writes vectors.json beside this file (riposte.record-vectors/0.1.0; SPEC.md here): the record
// tier's cases, every expected answer taken from running the case through the Node packages that write the formats (the engine,
// riposte-ai's ledger, frag, workgraph). Nothing in vectors.json is typed by hand: change a case here and write the file again.
//
//   node conformance/record/generate.mjs              write vectors.json
//   node conformance/record/generate.mjs --out <file> write it elsewhere
//   node conformance/record/generate.mjs --check      write nothing; exit 0 when every case in vectors.json is what this build
//                                                     answers (the oracle block aside), 1 when one is not
//
// The packages are found built (dist/) as check.mjs finds them. The fixtures are written by the packages themselves in a
// scratch folder (a ledger by the receipts file store, frags by frag build over a small tree, a work graph store and deposit by
// workgraph), read back byte for byte, and then changed by the cases. The keys are test keys made here from fixed seeds.
import { spawnSync } from 'node:child_process'
import { createHash, createPrivateKey, createPublicKey, sign as edSign } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SCHEMA, applyChange, bytesOf, inFolder, loadPackages, nodeImpl, readTree, writeTree } from './check.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const OUT = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : join(HERE, 'vectors.json')
const CHECK = argv.includes('--check')

const pk = await loadPackages()
const { V, R, F, W, dirs } = pk
const impl = nodeImpl(pk)
const SCRATCH = mkdtempSync(join(tmpdir(), 'record-vectors-gen-'))
const sha256Hex = (b) => createHash('sha256').update(b).digest('hex')

// ── keys: test keys from fixed seeds (sha256 of a sentence that says what they are) ──────────────────────────────────────
const PKCS8 = { ed25519: '302e020100300506032b657004220420', x25519: '302e020100300506032b656e04220420' }
const SPKI = '302a300506032b6570032100'
const KEY_NOTE = 'a test key, made for these vectors from the seed below (sha256 of the sentence in seed_from); it signs nothing else'
function testKey(label, alg = 'ed25519') {
  const seedFrom = `${SCHEMA} test key ${label}`
  const seed = createHash('sha256').update(seedFrom, 'utf8').digest()
  const priv = createPrivateKey({ key: Buffer.concat([Buffer.from(PKCS8[alg], 'hex'), seed]), format: 'der', type: 'pkcs8' })
  const public_key = createPublicKey(priv).export({ type: 'spki', format: 'pem' }).toString()
  return { priv, seedFrom, seed: seed.toString('hex'), private_key: priv.export({ type: 'pkcs8', format: 'pem' }).toString(), public_key }
}
const A = testKey('a')
const B = testKey('b')
const X = testKey('x', 'x25519')
const keyRecord = (k, alg = 'ed25519') => ({ note: KEY_NOTE, alg, seed_from: k.seedFrom, seed_hex: k.seed, private_key: k.private_key, public_key: k.public_key, ...(alg === 'ed25519' ? { fingerprint: R.keyFingerprint(k.public_key) } : {}) })
const pemOfRaw = (raw) => `-----BEGIN PUBLIC KEY-----\n${Buffer.concat([Buffer.from(SPKI, 'hex'), raw]).toString('base64')}\n-----END PUBLIC KEY-----\n`
const signWith = (k, msg) => edSign(null, typeof msg === 'string' ? Buffer.from(msg, 'utf8') : msg, k.priv).toString('base64')

// ── a clock that ticks one second per call, so every written time is fixed ───────────────────────────────────────────────
const clock = (iso) => { let t = Date.parse(iso) - 1000; return () => new Date(t += 1000) }
const skipLocks = (p) => /\.lock(\/|$)|\.lock\.|\.tmp$/.test(p)

// ── the invoice verdicts the frags and envelopes carry: issued by the engine with a fixed clock ──────────────────────────
const NOW = () => new Date('2026-10-20T00:00:00.000Z')
const invoice = { invoice_number: 'INV-1001', line_items: [{ description: 'Consulting', quantity: 10, unit_price: 150, amount: 1500 }, { description: 'Travel', quantity: 1, unit_price: 250.5, amount: 250.5 }], totals: { subtotal: 1750.5, tax_rate: 0.0825, tax: 144.42, total: 1894.92 } }
const bundleOf = (x, opts = {}) => ({ verdict: V.verify(x, { now: NOW, ...opts }), inputs: V.verifyInputs(x, { now: NOW, ...opts }) })
const openBundle = bundleOf(invoice) // PASS-WITH-OPEN: the contract, the evidence and the history were not supplied
const failBundle = bundleOf({ ...invoice, totals: { ...invoice.totals, total: 1900 } }) // the total is off by 5.08
const passInvoice = { invoice_number: 'INV-2001', prior_invoice_ids: ['INV-1999'], service_date: '2026-03-15', line_items: [{ description: 'Consulting', quantity: 10, unit_price: 150, amount: 1500 }], totals: { subtotal: 1500, tax_rate: 0.1, tax: 150, total: 1650 } }
const passRefs = { contract: { rates: [{ rate: 150 }], max_amount: 2000, effective_date: '2026-01-01', expiration_date: '2026-12-31' }, evidence: [{ line_items: [{ quantity: 10, description: 'Consulting' }], totals: { total: 1500 }, date: '2026-03-15' }], history: [{ invoice_number: 'INV-1999' }] }
const passBundle = bundleOf(passInvoice, { references: passRefs })
for (const [name, b, want] of [['open', openBundle, 'PASS-WITH-OPEN'], ['fail', failBundle, 'FAIL'], ['pass', passBundle, 'PASS']]) {
  if (V.gateStatus(b.verdict) !== want) throw new Error(`the ${name} verdict reads ${V.gateStatus(b.verdict)}, not ${want}`)
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Fixtures, each written by the package that owns the format, then read back byte for byte
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const fixtures = {}

// The ledger: four entries signed by key a, written by the receipts file store (which keeps the head record); a ledger whose
// last entry is signed by key b; an unsigned one; and verdict files signed by `riposte-ledger sign`, the shipped writer.
const LD = join(SCRATCH, 'ledger')
mkdirSync(LD)
let ledgerHead3
{
  const tick = clock('2026-10-20T09:00:00.000Z')
  const led = R.openLedger(R.fileStore(join(LD, 'ledger.jsonl'), { now: tick }), { signingKey: A.private_key, now: tick })
  led.append('decision', { decision: 'HOLD', item: 'INV-1001', reason: 'the totals differ by 5.08' })
  led.append('note', { event: 'example', text: 'a note on the record' })
  led.append('done_check', { outcome: 'PASS', checked: 3 })
  ledgerHead3 = readFileSync(join(LD, 'ledger.jsonl.head.json'), 'utf8')
  led.append('decision', { decision: 'EXECUTE', item: 'INV-1002' })
  const t2 = clock('2026-10-20T10:00:00.000Z')
  const a = R.openLedger(R.fileStore(join(LD, 'two.jsonl'), { now: t2 }), { signingKey: A.private_key, now: t2 })
  a.append('note', { event: 'example', text: 'signed by key a' })
  a.append('note', { event: 'example', text: 'signed by key a again' })
  R.openLedger(R.fileStore(join(LD, 'two.jsonl'), { now: t2 }), { signingKey: B.private_key, now: t2 }).append('note', { event: 'example', text: 'signed by key b' })
  const t3 = clock('2026-10-20T11:00:00.000Z')
  const u = R.openLedger(R.fileStore(join(LD, 'unsigned.jsonl'), { now: t3 }), { now: t3 })
  u.append('note', { event: 'example', text: 'unsigned' })
  u.append('note', { event: 'example', text: 'unsigned again' })
}
writeFileSync(join(LD, 'a.pub.pem'), A.public_key)
writeFileSync(join(LD, 'b.pub.pem'), B.public_key)
writeFileSync(join(LD, 'a.key.pem'), A.private_key)
writeFileSync(join(LD, 'b.key.pem'), B.private_key)
writeFileSync(join(LD, 'verdict.json'), `${JSON.stringify(openBundle.verdict, null, 2)}\n`)
writeFileSync(join(LD, 'bundle.json'), `${JSON.stringify(openBundle, null, 2)}\n`)
for (const [file, from, key] of [['env-a.json', 'verdict.json', 'a.key.pem'], ['env-b.json', 'verdict.json', 'b.key.pem'], ['bundle-env.json', 'bundle.json', 'a.key.pem']]) {
  const r = impl.ledger(['sign', from, '--key', key], LD)
  if (r.code !== 0) throw new Error(`riposte-ledger sign ${from}: exit ${r.code}: ${r.err}`)
  writeFileSync(join(LD, file), r.out)
}
writeFileSync(join(LD, 'not-a-verdict.json'), '{"note":"not a verdict"}\n')
fixtures.ledger = readTree(LD, skipLocks)

// The frags: frag build over a small tree (the engine's folders with one file each, the two e-invoice rulesets, a changelog
// that closes 0.7.1), three verdict frags and a release frag, signed by key a with a fixed clock.
const TREE = join(SCRATCH, 'tree')
writeTree(TREE, {
  'packages/verify/package.json': { utf8: '{ "name": "verify", "version": "0.7.2", "private": true }\n' },
  'packages/verify/src/index.ts': { utf8: '// a small source tree for the record vectors: the frag pins are computed over these files\nexport const example = 1\n' },
  'packages/verify/src/ap/rules.ts': { utf8: 'export const apExample = 1\n' },
  'packages/verify/src/legal/index.ts': { utf8: 'export const legalExample = 1\n' },
  'packages/verify/docs/examples/peppol-en16931.ruleset.v0.3.json': { utf8: '{ "id": "peppol-en16931", "version": "0.3.0" }\n' },
  'packages/verify/docs/examples/peppol-en16931.ruleset.v0.2.json': { utf8: '{ "id": "peppol-en16931", "version": "0.2.0" }\n' },
  'packages/verify/docs/bench/README.md': { utf8: 'No bench tables in this tree.\n' },
  'packages/verify/CHANGELOG.md': { utf8: '# Changelog\n\n**0.7.1 closed on 2026-10-19**: a closed label, for the record vectors.\n' },
  'packages/receipts/package.json': { utf8: '{ "name": "receipts", "version": "0.5.0", "private": true }\n' },
  'packages/receipts/src/index.ts': { utf8: 'export const receiptsExample = 1\n' },
})
const keyFile = join(SCRATCH, 'a.key.pem')
writeFileSync(keyFile, A.private_key)
const ISSUER_WORDS = 'a test key made for these vectors; it signs nothing else'
{
  const now = clock('2026-10-20T12:00:00.000Z')
  for (const [path, title, b] of [['frags/t/pass', 'A verdict that reads PASS', passBundle], ['frags/t/fail', 'A verdict that reads FAIL', failBundle], ['frags/t/open', 'A verdict that reads PASS-WITH-OPEN', openBundle]]) {
    const file = join(SCRATCH, `${path.split('/').pop()}.bundle.json`)
    writeFileSync(file, `${JSON.stringify(b, null, 2)}\n`)
    F.build({ tree: TREE, name: { title, path }, claim: { kind: 'verdict', bundle: file }, key: keyFile, issuer: ISSUER_WORDS, now })
  }
  F.build({ tree: TREE, name: { title: 'Engine 0.7.1, closed', path: 'frags/engine/0.7.1/closed' }, claim: { kind: 'release', engine: '0.7.1' }, key: keyFile, issuer: ISSUER_WORDS, now })
}
writeFileSync(join(TREE, 'a.pub.pem'), A.public_key)
fixtures['frag-tree'] = readTree(TREE, skipLocks)

// The work graph: a charter signed by key a and eleven frags, appended in two batches by the store (the head record after the
// first batch is kept for a case), then deposited; and the same graph deposited with the charter unsigned.
const GS = join(SCRATCH, 'graph')
const T = (n) => new Date(Date.UTC(2026, 9, 20, 8, n, 0)).toISOString().replace('.000Z', 'Z')
const model = W.modelActor('example-model-1', 'example-model-1')
const charterBody = {
  supersedes: null,
  intake: { why: 'Keep the example parser correct.', who_for: 'The people who read its output.', perfect_version: 'Every line read, every total checked.', proud_of: 'Anyone can run every check again.' },
  clauses: [{ id: 'c1', kind: 'goal', text: 'Repair what the tests find.' }, { id: 'c2', kind: 'no-go', text: 'Never publish without asking.' }],
  thresholds: [{ action_class: 'edit-code', reversibility: 'always', act_at: 0.8, ask_at: 0.5 }, { action_class: 'publish', reversibility: 'never', act_at: null, ask_at: 0 }],
  roles: [{ scope: '*', person: 'owner', level: 'approver' }],
  findings: [{ check: '*', finding: 'fail', source: 'evidence', maps_to: 'gate' }, { check: 'unit-tests', finding: 'cant-tell', source: 'evidence', maps_to: 'flag' }],
  deferral: { policy: 'next-breakpoint', max_wait_s: 120 },
  parties: [{ kind: 'person', as: 'owner', public_key: A.public_key }],
}
const charterUnsigned = W.makeCharter(charterBody)
const charter = W.signCharter(charterUnsigned, 0, A.priv)
const g = new W.Graph()
g.addCharter(charter)
const add = (d) => { const f = W.makeFrag(d); g.addFrag(f); return f }
const cl = { id: charter.id, clause: 'c1' }
const task = add({ kind: 'step', level: 'task', action: 'repair the example parser', actor: W.personActor('owner'), time: { started: T(0), ended: T(0) }, charter: cl })
const run = add({ kind: 'step', level: 'run', action: 'attempt 1', actor: model, parents: [task.id], time: { started: T(1), ended: T(1) }, charter: cl })
const branch = add({ kind: 'step', level: 'branch', action: 'line of work 1', actor: model, parents: [run.id], time: { started: T(2), ended: T(2) }, charter: cl })
const s1 = add({ kind: 'step', level: 'step', action: 'edit src/parse.ts', actor: model, parents: [branch.id], outputs: [{ name: 'src/parse.ts', sha256: sha256Hex('parse, second version') }], claim: 'the parser reads every line', checks: [{ by: 'unit-tests@1.0.0', finding: 'pass', detail: 'ran the unit tests' }], tokens: { in: 1200, out: 340 }, time: { started: T(3), ended: T(3) }, charter: cl })
const s2 = add({ kind: 'step', level: 'step', action: 'edit src/total.ts', actor: model, parents: [s1.id], checks: [{ by: 'unit-tests@1.0.0', finding: 'fail', detail: 'one test failed' }], time: { started: T(4), ended: null }, charter: cl })
const batch1 = [charter, task, run, branch, s1, s2]
const inf = add({ kind: 'inference', level: 'step', action: 'read the steps so far', actor: W.toolActor('interpreter', '0.1.0'), parents: [s2.id], time: { started: null, ended: null }, inference: { opinion: 'the agent may be editing tests rather than code', prediction: 'the next change touches test files only', tell: null } })
const askBlock = { question: 'Round half up or half to even?', options: ['half up', 'half to even'], reversibility: 'maybe', deferral: { policy: 'next-breakpoint', max_wait_s: 120 }, state_digest: g.stateDigest([s2.id]), asks: null, answer: null }
const ask = add({ kind: 'decision', level: 'step', action: 'ask how to round', actor: model, parents: [s2.id], time: { started: T(6), ended: T(6) }, decision: askBlock })
const answer = add({ kind: 'decision', level: 'step', action: 'answer the rounding question', actor: W.personActor('owner'), parents: [ask.id, s2.id], time: { started: T(7), ended: T(7) }, decision: { ...askBlock, asks: ask.id, answer: { choice: 'half to even', who: 'person:owner', when: T(7), state_digest: g.stateDigest(ask.parents) } } })
const mark = add({ kind: 'claim-check', level: 'step', action: `mark ${s1.id.slice(0, 12)} wrong`, actor: W.personActor('owner'), parents: [], time: { started: T(8), ended: T(8) }, checks: [{ by: 'person:owner', finding: 'fail', detail: 'the claim does not hold: a line is skipped' }], 'claim-check': { target: s1.id, result: 'wrong' } })
const guard = add({ kind: 'guard', level: 'step', action: 'block a publish', actor: W.toolActor('gate', '1.0.0'), parents: [answer.id], time: { started: T(9), ended: T(9) }, guard: { blocked: 'publish the release', rule: 'c2', shown: 'publishing needs the owner; the request is queued' } })
const close = add({ kind: 'step', level: 'step', action: 'close the line of work', actor: model, parents: [guard.id], closes: branch.id, time: { started: T(10), ended: T(10) }, charter: cl })
const batch2 = [inf, ask, answer, mark, guard, close]
W.initStore(join(GS, 'store'))
W.appendToStore(join(GS, 'store'), batch1)
const graphHead6 = readFileSync(join(GS, 'store', 'index.jsonl.head.json'), 'utf8')
W.appendToStore(join(GS, 'store'), batch2)
const stored = W.loadStore(join(GS, 'store')).graph
writeFileSync(join(GS, 'deposit.workgraph.json'), W.deposit(stored).text)
const gu = new W.Graph()
gu.addCharter(charterUnsigned)
for (const f of [...batch1.slice(1), ...batch2]) gu.addFrag(f)
writeFileSync(join(GS, 'unsigned.workgraph.json'), W.deposit(gu).text)
writeFileSync(join(GS, 'chain.work.json'), `${JSON.stringify({ schema: F.WORK_CHAIN_SCHEMA, prototype: 'prototype; no measured accuracy', source: { kind: 'native' }, frags: [] }, null, 2)}\n`)
fixtures.graph = readTree(GS, skipLocks)

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// The parts
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const text = (fx, p) => bytesOf(fixtures[fx][p]).toString('utf8')
const json = (fx, p) => JSON.parse(text(fx, p))

// 1. canonical JSON
const canonicalTexts = [
  ['array-index keys first, numerically, then every other key by UTF-16 code unit', '{"b":1,"10":2,"9":3,"B":4,"-1":5,"01":6,"4294967294":7,"4294967295":8,"0":9,"":10,"1.5":11}'],
  ['UTF-16 code units, not code points: a surrogate pair sorts before U+FFFF', '{"\\uffff":1,"\\ud83d\\ude00":2,"z":3,"\\u00e9":4,"Z":5,"a":6}'],
  ['numbers as JavaScript writes a double', '[6125.0,6.125e3,612500e-2,1e21,1E+21,-0,0.1,0.30000000000000004,1.5e-7,1e-7,0.000001,123e-20,1e300,5e-324,1.7976931348623157e308,100,2.50,123456789012345680000,4294967295,-1.5,999999999999999900000]'],
  ['control characters, quotes and backslashes: JSON.stringify escaping', '["\\u0000\\u0001\\u0008\\u0009\\u000a\\u000b\\u000c\\u000d\\u001f","\\u007f","\\"","\\\\","\\/"]'],
  ['everything else is the character itself', '["\\u00e9","\\u2713","\\u2028\\u2029","\\ud83d\\ude00","plain"]'],
  ['a lone surrogate is written as an escape', '["\\ud800","\\udc00","\\udc00\\ud800","a\\udbffb"]'],
  ['a "__proto__" key is data', '{"__proto__":{"x":1},"k":"v"}'],
  ['nested objects are ordered at every depth; arrays keep their order', '{"z":[{"b":2,"a":1},[],{}],"a":{"d":{"f":[1,[2,[3,{"y":1,"x":0}]]]},"c":null},"t":true,"f":false}'],
  ['whitespace and CR LF between tokens are not part of the value', '{\r\n  "b" : [ 1 , 2 ] ,\r\n\t"a" : "x"\r\n}\r\n'],
  ['empty key, empty string, empty containers', '{"":"","a":[],"o":{}}'],
  ['a key written with an escape is the same key', '{"\\u0062":2,"a":1}'],
  ['a string at the top level', '"a\\tb"'],
  ['a number at the top level', '12.50'],
  ['null at the top level', 'null'],
  ['two hundred nested arrays', `${'['.repeat(200)}1${']'.repeat(200)}`],
]
const canonical = canonicalTexts.map(([name, t]) => {
  const c1 = V.canonicalize(JSON.parse(t))
  // the work graph writes the same canonical JSON: compared wherever its reader (nesting limit 64) reads the text
  let c2 = c1
  try { c2 = W.canonicalize(W.parseStrict(t, 'case.json')) } catch (e) { if (!(e instanceof W.StrictJsonRefused)) throw e }
  if (c1 !== c2) throw new Error(`canonical, ${name}: the engine writes ${c1} and the work graph ${c2}`)
  return { name, text: t, expect: { canonical: c1, sha256: V.sha256(c1) } }
})

// 1b. the strict readers
const nest = (n) => `${'['.repeat(n)}${']'.repeat(n)}`
const strictTexts = [
  ['a byte-order mark', '﻿{"a":1}'],
  ['a key twice in one object', '{"a":1,"a":2}'],
  ['a key twice, deeper', '{"verdict":{"outcome":"FAIL","outcome":"PASS"}}'],
  ['a key twice, written two ways', '{"a":1,"\\u0061":2}'],
  ['a key twice inside an array element', '[{"k":1},{"k":1,"k":1}]'],
  ['the same key in two objects is not a repeat', '[{"k":1},{"k":2}]'],
  ['a key that is not an identifier, twice', '{"a b":1,"a b":2}'],
  ['a number past the double range', '{"x":1e999}'],
  ['a negative number past the double range', '[-1e999]'],
  ['a number that reads back as another: 2^53 + 1', '{"n":9007199254740993}'],
  ['a number that reads back as another: seventeen digits', '[0.10000000000000001]'],
  ['a number that reads back as another: 21 digits', '[123456789012345678901]'],
  ['a number that reads back as another: it underflows to 0', '[1e-400]'],
  ['numbers at the edge that read back as written', '[9007199254740992,9007199254740991,5e-324,1.7976931348623157e308]'],
  ['every spelling of zero is exact', '[-0,0.0,-0.0e5,0e-10]'],
  ['nesting 64 levels', nest(64)],
  ['nesting 65 levels', nest(65)],
  ['nesting 66 levels', nest(66)],
  ['nesting 256 levels', nest(256)],
  ['nesting 257 levels', nest(257)],
  ['brackets inside a string do not nest', `["${'['.repeat(300)}",1]`],
  ['not JSON', '{"a":}'],
  ['text after the value', '{} {}'],
  ['a lone surrogate in a string is data', '["\\ud800"]'],
  ['a value that is not an object is read', '[1,"two",null]'],
]
const strictBytes = [
  ['bytes: 0xFF is never UTF-8', Buffer.from([0x5b, 0x22, 0x61, 0xff, 0x62, 0x22, 0x5d])],
  ['bytes: an overlong form', Buffer.from([0x5b, 0x22, 0xc0, 0xaf, 0x22, 0x5d])],
  ['bytes: an encoded surrogate', Buffer.from([0x5b, 0x22, 0xed, 0xa0, 0x80, 0x22, 0x5d])],
  ['bytes: above U+10FFFF', Buffer.from([0x5b, 0x22, 0xf4, 0x90, 0x80, 0x80, 0x22, 0x5d])],
  ['bytes: a stray continuation byte', Buffer.from([0x5b, 0x22, 0x80, 0x22, 0x5d])],
  ['bytes: a sequence cut at the end', Buffer.from([0x5b, 0x31, 0x5d, 0xe2, 0x82])],
  ['bytes: a four-byte character is UTF-8', Buffer.from([0x5b, 0x22, 0xf0, 0x9f, 0x98, 0x80, 0x22, 0x5d])],
]
const strictOutcome = (fn) => {
  try { return { canonical: V.canonicalize(fn()) } } catch (e) { return { refused: { where: e.where ?? e.at ?? null, message: e.message } } }
}
const strict = []
for (const reader of ['engine', 'workgraph']) {
  const parse = reader === 'engine' ? impl.parseStrict : impl.parseStrictGraph
  const decode = reader === 'engine' ? impl.decodeStrict : impl.decodeStrictGraph
  for (const [name, t] of strictTexts) strict.push({ name: `${reader}: ${name}`, reader, file: 'case.json', text: t, expect: strictOutcome(() => parse(t, 'case.json')) })
  for (const [name, b] of strictBytes) strict.push({ name: `${reader}: ${name}`, reader, file: 'case.json', base64: b.toString('base64'), expect: strictOutcome(() => parse(decode(b, 'case.json'), 'case.json')) })
}

// 2. sha256 bindings
const hashes = []
const respelled = JSON.stringify(failBundle.inputs).replace('"amount":1500', '"amount":1.5e3').replace('"quantity":10', '"quantity":10.0').replace(/,/g, ' ,\r\n ')
const stringFigure = JSON.stringify(failBundle.inputs).replace('"amount":1500', '"amount":"1500.00"')
for (const [name, t, recorded] of [
  ['input_hash of a FAIL verdict\'s inputs', JSON.stringify(failBundle.inputs), failBundle.verdict.input_hash],
  ['input_hash of the same inputs with numbers spelled otherwise, keys spaced and CR LF between tokens', respelled, failBundle.verdict.input_hash],
  ['input_hash of the same inputs with one figure written as a string: another input', stringFigure, null],
  ['input_hash of a PASS verdict\'s inputs, with a contract, evidence and history', JSON.stringify(passBundle.inputs), passBundle.verdict.input_hash],
  ['extraction_hash of a PASS-WITH-OPEN verdict\'s extraction', JSON.stringify(openBundle.inputs.extraction), openBundle.verdict.document.extraction_hash],
  ['remedy_table_hash: the table an engine with no declared remedies hashes', '{}', null],
]) {
  const sha = impl.sha256Canonical(JSON.parse(t))
  if (recorded !== null && sha !== recorded) throw new Error(`hashes, ${name}: ${sha}, the verdict records ${recorded}`)
  hashes.push({ name, rule: 'sha256_canonical', text: t, expect: { sha256: sha } })
}
for (const [name, b, engine, rth] of [
  ['verdict_id of the FAIL verdict (engine 0.2.0 and later: four parts)', failBundle, null, undefined],
  ['verdict_id of the PASS verdict', passBundle, null, undefined],
  ['verdict_id under engine 0.0.1, which binds no remedy table (three parts)', failBundle, '0.0.1', null],
]) {
  const v = b.verdict
  const e = engine ?? v.engine_version
  const r = rth === undefined ? v.remedy_table_hash : rth
  const id = impl.verdictId(v.input_hash, { id: v.ruleset.id, version: v.ruleset.version }, e, r)
  if (engine === null && id !== v.verdict_id) throw new Error(`hashes, ${name}: ${id}, the verdict records ${v.verdict_id}`)
  hashes.push({ name, rule: 'verdict_id', input_hash: v.input_hash, ruleset: { id: v.ruleset.id, version: v.ruleset.version }, engine_version: e, remedy_table_hash: r, expect: { verdict_id: id } })
}
for (const p of ['frags/engine/0.7.1/closed', 'frags/t/fail']) {
  const f = json('frag-tree', `${p}/frag.json`)
  hashes.push({ name: `frag_id and the record's body_sha256 of ${p}`, rule: 'frag_id', source: { fixture: 'frag-tree', file: `${p}/frag.json` }, expect: { frag_id: F.fragIdOf(f), body_sha256: F.bodySha256(f) } })
}
for (const [line, what] of [[0, 'the first'], [3, 'the last']]) {
  const e = JSON.parse(text('ledger', 'ledger.jsonl').split('\n')[line])
  const h = impl.entryHash(e)
  if (h !== e.hash) throw new Error(`hashes, ledger entry ${line}: ${h}, the entry records ${e.hash}`)
  hashes.push({ name: `entry hash of ${what} ledger entry (its first prev_hash is 64 zeros)`, rule: 'entry_hash', source: { fixture: 'ledger', file: 'ledger.jsonl', line }, expect: { hash: h } })
}
{
  const e = { seq: 0, kind: 'note', at: '2026-10-20T09:00:00.000Z', body: { 'é': 'café', '10': 1, '9': [0.5, -0, 1e21], text: 'tab\there' }, prev_hash: '0'.repeat(64) }
  hashes.push({ name: 'entry hash of an entry whose body needs the canonical rules (key order, numbers, escapes)', rule: 'entry_hash', entry: e, expect: { hash: impl.entryHash(e) } })
}
for (const f of [task, inf, answer, mark]) hashes.push({ name: `work frag id of the ${f.kind} "${f.action}"`, rule: 'work_frag_id', source: { fixture: 'graph', file: `store/frags/${f.id}.json` }, expect: { id: impl.workFragId(f) } })
hashes.push({ name: 'charter id (its signatures are outside it)', rule: 'charter_id', source: { fixture: 'graph', file: `store/charters/${charter.id}.json` }, expect: { id: impl.charterId(charter) } })
for (const file of ['deposit.workgraph.json', 'unsigned.workgraph.json']) {
  const d = json('graph', file)
  const got = impl.bundleSha256(d)
  if (got !== d.bundle_sha256) throw new Error(`hashes, ${file}: ${got}, the file records ${d.bundle_sha256}`)
  hashes.push({ name: `bundle_sha256 of ${file}`, rule: 'bundle_sha256', source: { fixture: 'graph', file }, expect: { bundle_sha256: got } })
}
{
  const idx = text('graph', 'store/index.jsonl')
  const head = JSON.parse(text('graph', 'store/index.jsonl.head.json'))
  const chain = impl.indexChain(idx)
  const want = { bytes: head.bytes, count: head.count, head: head.head }
  if (JSON.stringify(chain.head_record) !== JSON.stringify(want)) throw new Error(`hashes, the store's head record says ${JSON.stringify(want)}, the index gives ${JSON.stringify(chain.head_record)}`)
  hashes.push({ name: 'the store index: each line\'s sha256 (the next line\'s prev) and the head record the store wrote', rule: 'index_chain', source: { fixture: 'graph', file: 'store/index.jsonl' }, expect: { line_sha256: chain.line_sha256, head_record: want } })
}
{
  const lock = json('frag-tree', 'frags/engine/0.7.1/closed/frag.json').lock
  for (const [name, folder, recursive, suffix, pinned] of [
    ['the pin rule over a folder, recursively (the engine\'s sources)', 'packages/verify/src', true, null, lock.engine.sha256],
    ['the pin rule over the top-level .ts files of a folder (the AP pack)', 'packages/verify/src/ap', false, '.ts', lock.rulesets[0].sha256],
    ['the pin rule over the top-level .ts files of a folder (the legal rule)', 'packages/verify/src/legal', false, '.ts', lock.rulesets[1].sha256],
    ['the pin rule over a folder, recursively (the pilot tool)', 'packages/receipts/src', true, null, lock.tools[0].sha256],
  ]) {
    const got = inFolder(fixtures['frag-tree'], (d) => impl.pinDigest(join(d, ...folder.split('/')), { recursive, suffix }))
    if (got.sha256 !== pinned) throw new Error(`hashes, ${name}: ${got.sha256}, the frag's lock pins ${pinned}`)
    hashes.push({ name, rule: 'pin_rule', source: { fixture: 'frag-tree', folder }, recursive, ...(suffix ? { suffix } : {}), expect: got })
  }
}
for (const [name, pem] of [['key a', A.public_key], ['key b', B.public_key], ['key a, its PEM with CR LF line endings', A.public_key.replace(/\n/g, '\r\n')], ['key a, from its private key (the public half)', A.private_key]]) {
  hashes.push({ name: `the fingerprint of ${name}`, rule: 'key_fingerprint', pem, expect: { fingerprint: impl.keyFingerprint(pem) } })
}

// 3. Ed25519
const RFC8032 = [ // RFC 8032 section 7.1, TEST 1 to TEST 3: secret key, public key, message, signature (the RFC's own values)
  ['9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60', 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a', '', 'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b'],
  ['4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb', '3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c', '72', '92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00'],
  ['c5aa8df43f9f837bedb7442f31dcb7b166d38535076f094b85ce3a2e0b4458f7', 'fc51cd8e6218a1a38da47ed00230f0580816ed13ba3303ac5deb911548908025', 'af82', '6291d657deec24024827e69c3abe01a30ce548a284743a445e3680d7db5ac3ac18ff9b538d16f290ae67f760984dc6594a7c15e9716ed28dc027beceea1ec40a'],
]
const ed25519 = []
const raw = (name, pem, msgHex, sig, edge) => ed25519.push({ name, kind: 'raw', public_key: pem, message_hex: msgHex, signature: sig, ...(edge ? { edge } : {}), expect: { valid: impl.verifySignature(pem, Buffer.from(msgHex, 'hex'), sig) } })
RFC8032.forEach(([secret, pub, msg, sig], i) => {
  const k = createPrivateKey({ key: Buffer.concat([Buffer.from(PKCS8.ed25519, 'hex'), Buffer.from(secret, 'hex')]), format: 'der', type: 'pkcs8' })
  const derived = createPublicKey(k).export({ type: 'spki', format: 'der' }).subarray(12).toString('hex')
  if (derived !== pub || edSign(null, Buffer.from(msg, 'hex'), k).toString('hex') !== sig) throw new Error(`RFC 8032 TEST ${i + 1}: the engine's crypto gives another key or signature`)
  raw(`RFC 8032 TEST ${i + 1}`, pemOfRaw(Buffer.from(pub, 'hex')), msg, Buffer.from(sig, 'hex').toString('base64'))
})
{
  const [, pub, , sig] = RFC8032[1]
  raw('RFC 8032 TEST 2, the message changed', pemOfRaw(Buffer.from(pub, 'hex')), '73', Buffer.from(sig, 'hex').toString('base64'))
  raw('RFC 8032 TEST 2 under TEST 1\'s key', pemOfRaw(Buffer.from(RFC8032[0][1], 'hex')), '72', Buffer.from(sig, 'hex').toString('base64'))
  const L = (1n << 252n) + 27742317777372353535851937790883648493n
  const sb = Buffer.from(sig, 'hex')
  let s = 0n
  for (let i = 63; i >= 32; i--) s = (s << 8n) | BigInt(sb[i])
  const le = (n) => { const o = Buffer.alloc(32); for (let i = 0; i < 32; i++) { o[i] = Number(n & 0xffn); n >>= 8n } return o }
  raw('RFC 8032 TEST 2 with s + L in place of s (s not reduced)', pemOfRaw(Buffer.from(pub, 'hex')), '72', Buffer.concat([sb.subarray(0, 32), le(s + L)]).toString('base64'), 's out of range')
  const identity = Buffer.alloc(32)
  identity[0] = 1
  const p = (1n << 255n) - 19n
  const msg = Buffer.from('any message at all', 'utf8').toString('hex')
  raw('a small-order key (the identity point), R the identity and s = 0, over any message', pemOfRaw(identity), msg, Buffer.concat([identity, Buffer.alloc(32)]).toString('base64'), 'small-order key')
  raw('the same with the identity written as y = p + 1 (a key encoding that is not canonical)', pemOfRaw(le(p + 1n)), msg, Buffer.concat([identity, Buffer.alloc(32)]).toString('base64'), 'non-canonical key encoding')
  raw('the identity key with R written as y = p + 1 (an R encoding that is not canonical)', pemOfRaw(identity), msg, Buffer.concat([le(p + 1n), Buffer.alloc(32)]).toString('base64'), 'non-canonical R encoding')
  const hello = Buffer.from('hello', 'utf8')
  const ok = signWith(A, hello)
  raw('key a over "hello"', A.public_key, hello.toString('hex'), ok)
  raw('key a over "hello", its PEM with CR LF line endings', A.public_key.replace(/\n/g, '\r\n'), hello.toString('hex'), ok)
  raw('key a\'s private key PEM where the public key goes (the public half is derived)', A.private_key, hello.toString('hex'), ok, 'private key in place of the public key')
  raw('an X25519 key (another algorithm)', X.public_key, hello.toString('hex'), ok, 'another algorithm')
}
// The four signed messages, each from a fixture object, with the signature (and the key) changed
const kinds = [
  { kind: 'ledger-entry', source: { fixture: 'ledger', file: 'ledger.jsonl', line: 1 }, sigOf: (o) => o.signature.sig },
  { kind: 'envelope', source: { fixture: 'ledger', file: 'env-a.json' }, sigOf: (o) => o.signature },
  { kind: 'frag', source: { fixture: 'frag-tree', file: 'frags/engine/0.7.1/closed/frag.json' }, sigOf: (o) => o.signature.signature, issuers: [undefined, 'a'] },
  { kind: 'charter', source: { fixture: 'graph', file: `store/charters/${charter.id}.json` }, sigOf: (o) => o.signatures[0].signature, noKey: true },
]
for (const k of kinds) {
  const read = () => {
    const t = bytesOf(fixtures[k.source.fixture][k.source.file]).toString('utf8')
    return JSON.parse(k.source.line === undefined ? t : t.split('\n')[k.source.line])
  }
  const base = read()
  const msg = Buffer.from(impl.signedMessage(k.kind, base))
  const good = k.sigOf(base)
  const g64 = Buffer.from(good, 'base64')
  const byB = signWith(B, msg)
  const variants = [
    ['as written', {}],
    ['a signature by key b, the key a kept', { signature: byB }],
    ...(k.noKey ? [] : [['a signature by key b, with key b', { signature: byB, public_key: B.public_key }]]),
    ['the signature cut to 63 bytes', { signature: g64.subarray(0, 63).toString('base64') }],
    ['the signature with a 65th byte', { signature: Buffer.concat([g64, Buffer.from([0])]).toString('base64') }],
    ['a character outside base64 inside the signature', { signature: `${good.slice(0, 20)}!${good.slice(20)}` }],
    ['the signature in the URL-safe alphabet', { signature: good.replace(/\+/g, '-').replace(/\//g, '_') }],
    ['the signature without its padding', { signature: good.replace(/=+$/, '') }],
    ['the signature with a newline after it', { signature: `${good}\n` }],
    ['an all-zero signature', { signature: Buffer.alloc(64).toString('base64') }],
    ['an empty signature', { signature: '' }],
  ]
  for (const issuer of k.issuers ?? [undefined]) {
    for (const [what, v] of variants) {
      const o = read()
      if (v.signature !== undefined) { if (k.kind === 'ledger-entry') o.signature.sig = v.signature; else if (k.kind === 'envelope') o.signature = v.signature; else if (k.kind === 'frag') o.signature.signature = v.signature; else o.signatures[0].signature = v.signature }
      if (v.public_key !== undefined) { if (k.kind === 'envelope') o.public_key = v.public_key; else o.signature.public_key = v.public_key }
      const valid = impl.verifySigned(k.kind, o, issuer ? A.public_key : undefined)
      ed25519.push({ name: `${k.kind}${issuer ? ', issuer key a pinned' : ''}: ${what}`, kind: k.kind, source: k.source, ...v, ...(issuer ? { issuer } : {}), expect: { valid, ...(what === 'as written' ? { message_sha256: sha256Hex(msg) } : {}) } })
    }
  }
}

// ── the commands ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/** What a case expects: the exit, the answering stream's first lines, and both streams whole. */
function expectOf(r, stream, k) {
  const s = stream ?? (r.err ? 'stderr' : 'stdout')
  return { exit: r.code, stream: s, head: (s === 'stdout' ? r.out : r.err).split('\n').slice(0, k ?? 1), stdout: r.out, stderr: r.err }
}
const leaks = []
// The commands as their bins run them, with nothing caught: the ledger command is called directly, so an exception reaches here
const direct = {
  ledger: (a, d) => { const prev = process.cwd(); process.chdir(d); try { return R.ledgerCli(a, (p) => R.readLedgerText(readFileSync(p), p)) } finally { process.chdir(prev) } },
  frag: impl.frag,
  workgraph: impl.workgraph,
}
function runCase(tool, c, stream, k) {
  const files = applyChange(fixtures[c.fixture], c.change)
  let r
  try { r = inFolder(files, (d) => direct[tool](c.argv, d)) } catch (e) {
    // the tool stopped with an exception (no verdict line): measure the exit of its bin, as a person would see it
    r = { code: binExit(tool, files, c.argv), out: '', err: '', threw: `${e.name}: ${e.message}` }
  }
  const expect = r.threw ? { exit: r.code, stream: null, head: null, threw: r.threw } : expectOf(r, stream, k)
  const shown = JSON.stringify(expect)
  if (shown.includes(SCRATCH) || shown.includes(SCRATCH.replace(/\\/g, '/')) || shown.includes(JSON.stringify(SCRATCH).slice(1, -1)) || /record-vectors-case-|record-vectors-gen-/.test(shown)) leaks.push(`${tool}, ${c.name}`)
  return { ...c, expect }
}
function binExit(tool, files, args) {
  const bin = { ledger: join(dirs.receipts, 'dist', 'ledger-cli.js') }[tool]
  if (!bin) throw new Error(`${tool}: an exception, and no bin to measure`)
  return inFolder(files, (d) => spawnSync(process.execPath, [bin, ...args], { cwd: d, encoding: 'utf8' }).status)
}

// 4. the ledger (riposte-ledger verify, summary, fingerprint, verify-signature)
const LT = text('ledger', 'ledger.jsonl')
const lines = LT.split('\n').slice(0, -1)
const entry3 = JSON.parse(lines[3])
const resigned = (() => {
  const e = { seq: 3, kind: entry3.kind, at: entry3.at, body: { decision: 'EXECUTE', item: 'INV-1003' }, prev_hash: entry3.prev_hash }
  const hash = R.entryHash(e)
  return JSON.stringify({ ...e, hash, signature: { alg: 'ed25519', public_key: A.public_key, sig: signWith(A, hash) } })
})()
const inexactLine = (() => {
  const e = { seq: 4, kind: 'note', at: '2026-10-20T09:00:05.000Z', body: { event: 'example', n: 9007199254740992 }, prev_hash: entry3.hash }
  const hash = R.entryHash(e)
  return JSON.stringify({ ...e, hash, signature: { alg: 'ed25519', public_key: A.public_key, sig: signWith(A, hash) } }).replace('9007199254740992', '9007199254740993')
})()
const ln = (arr) => `${arr.join('\n')}\n`
const e1 = JSON.parse(lines[1])
const notUtf8 = Buffer.concat([Buffer.from(ln(lines.slice(0, 1)), 'utf8'), Buffer.from(lines[1].replace('a note on the record', 'a note on the r#cord'), 'utf8'), Buffer.from('\n' + ln(lines.slice(2)), 'utf8')])
notUtf8[notUtf8.indexOf('r#cord')] = 0xff
const fpA = R.keyFingerprint(A.public_key)
const ledgerCases = [
  ['verified with key a pinned', null, ['verify', 'ledger.jsonl', '--key', 'a.pub.pem']],
  ['verified with no trust anchor: a note says what that proves', null, ['verify', 'ledger.jsonl']],
  ['verified with --require-signed', null, ['verify', 'ledger.jsonl', '--require-signed']],
  ['verified against a head recorded earlier (entry 1)', null, ['verify', 'ledger.jsonl', '--head', e1.hash]],
  ['a --head that is not in the chain', null, ['verify', 'ledger.jsonl', '--head', 'f'.repeat(64)]],
  ['verified without the head record (--no-sidecar)', null, ['verify', 'ledger.jsonl', '--no-sidecar', '--key', 'a.pub.pem']],
  ['key b pinned: every entry is key a\'s', null, ['verify', 'ledger.jsonl', '--key', 'b.pub.pem']],
  ['no head record beside the file', { 'ledger.jsonl.head.json': null }, ['verify', 'ledger.jsonl', '--key', 'a.pub.pem']],
  ['a cut tail: the last entry removed, the head record left', { 'ledger.jsonl': { utf8: ln(lines.slice(0, 3)) } }, ['verify', 'ledger.jsonl', '--key', 'a.pub.pem']],
  ['the last line rewritten, its hash recomputed and signed again by key a', { 'ledger.jsonl': { utf8: ln([...lines.slice(0, 3), resigned]) } }, ['verify', 'ledger.jsonl', '--key', 'a.pub.pem']],
  ['a body edited, its hash left as it was', { 'ledger.jsonl': { replace: ['"item":"INV-1002"', '"item":"INV-1003"'] } }, ['verify', 'ledger.jsonl', '--key', 'a.pub.pem']],
  ['two entries swapped', { 'ledger.jsonl': { utf8: ln([lines[0], lines[2], lines[1], lines[3]]) } }, ['verify', 'ledger.jsonl']],
  ['a signature that does not verify (another entry\'s signature)', { 'ledger.jsonl': { replace: [JSON.parse(lines[2]).signature.sig, e1.signature.sig] } }, ['verify', 'ledger.jsonl']],
  ['a torn tail: an unfinished last line, no newline after it', { 'ledger.jsonl': { utf8: `${LT}{"seq":4,"kind":"note","at":"2026-10-20T09:0` } }, ['verify', 'ledger.jsonl', '--key', 'a.pub.pem']],
  ['a torn tail with a newline after it', { 'ledger.jsonl': { utf8: `${LT}{"seq":4,"kind":"note","at":"2026-10-20T09:0\n` } }, ['verify', 'ledger.jsonl', '--key', 'a.pub.pem']],
  ['the last entry whole, with no newline after it', { 'ledger.jsonl': { utf8: LT.slice(0, -1) } }, ['verify', 'ledger.jsonl', '--key', 'a.pub.pem']],
  ['a line that is JSON null', { 'ledger.jsonl': { utf8: `${LT}null\n` } }, ['verify', 'ledger.jsonl', '--key', 'a.pub.pem']],
  ['a line that is a JSON array, not an object', { 'ledger.jsonl': { utf8: `${LT}[]\n` } }, ['verify', 'ledger.jsonl', '--key', 'a.pub.pem']],
  ['a line that is a JSON number, not an object', { 'ledger.jsonl': { utf8: `${LT}5\n` } }, ['verify', 'ledger.jsonl', '--key', 'a.pub.pem']],
  ['a line before the last that is not JSON', { 'ledger.jsonl': { utf8: ln([lines[0], 'not json', ...lines.slice(1)]) } }, ['verify', 'ledger.jsonl']],
  ['a key written twice in one object (JSON keeps the last, so the hash and the signature hold)', { 'ledger.jsonl': { replace: ['{"decision":"EXECUTE"', '{"decision":"HOLD","decision":"EXECUTE"'] } }, ['verify', 'ledger.jsonl', '--key', 'a.pub.pem']],
  ['a number whose text does not read back as written (hashed and signed as it reads)', { 'ledger.jsonl': { utf8: `${LT}${inexactLine}\n` } }, ['verify', 'ledger.jsonl', '--key', 'a.pub.pem']],
  ['bytes that are not UTF-8', { 'ledger.jsonl': { base64: notUtf8.toString('base64') } }, ['verify', 'ledger.jsonl', '--key', 'a.pub.pem']],
  ['a space added inside an entry: the same values, another byte count', { 'ledger.jsonl': { replace: ['"seq":0,', '"seq": 0,'] } }, ['verify', 'ledger.jsonl', '--key', 'a.pub.pem']],
  ['CR LF line endings', { 'ledger.jsonl': { utf8: LT.replace(/\n/g, '\r\n') } }, ['verify', 'ledger.jsonl', '--key', 'a.pub.pem']],
  ['a head record that does not parse', { 'ledger.jsonl.head.json': { utf8: 'not json\n' } }, ['verify', 'ledger.jsonl', '--key', 'a.pub.pem']],
  ['a head record written before the last entry: behind, not a failure', { 'ledger.jsonl.head.json': { utf8: ledgerHead3 } }, ['verify', 'ledger.jsonl', '--key', 'a.pub.pem']],
  ['a second key: entry 2 signed by key b, key a pinned', null, ['verify', 'two.jsonl', '--key', 'a.pub.pem']],
  ['a second key, no key pinned: two signers, verified', null, ['verify', 'two.jsonl']],
  ['an unsigned ledger under --require-signed', null, ['verify', 'unsigned.jsonl', '--require-signed']],
  ['an unsigned ledger with key a pinned', null, ['verify', 'unsigned.jsonl', '--key', 'a.pub.pem']],
  ['an unknown option', null, ['verify', 'ledger.jsonl', '--keys', 'a.pub.pem']],
  ['summary', null, ['summary', 'ledger.jsonl']],
  ['summary of a cut file', { 'ledger.jsonl': { utf8: ln(lines.slice(0, 3)) } }, ['summary', 'ledger.jsonl']],
  ['fingerprint of a public key', null, ['fingerprint', 'a.pub.pem']],
  ['fingerprint of a private key, with --short', null, ['fingerprint', 'a.key.pem', '--short']],
  ['verify-signature of an envelope', null, ['verify-signature', 'env-a.json']],
  ['verify-signature with the trusted key as a file', null, ['verify-signature', 'env-a.json', '--trusted-key', 'a.pub.pem']],
  ['verify-signature with the trusted key as its fingerprint', null, ['verify-signature', 'env-a.json', '--trusted-key', fpA]],
  ['verify-signature with another key trusted', null, ['verify-signature', 'env-a.json', '--trusted-key', 'b.pub.pem']],
  ['verify-signature of an envelope by key b, key a trusted', null, ['verify-signature', 'env-b.json', '--trusted-key', fpA]],
  ['verify-signature with a private key given as the trusted key', null, ['verify-signature', 'env-a.json', '--trusted-key', 'a.key.pem']],
  ['verify-signature of an envelope whose verdict was changed', { 'env-a.json': { replace: ['"gate_status": "PASS_WITH_OPEN"', '"gate_status": "PASS"'] } }, ['verify-signature', 'env-a.json']],
  ['verify-signature of an envelope with a key written twice', { 'env-a.json': { replace: ['"outcome": "PASS"', '"outcome": "FAIL",\n    "outcome": "PASS"'] } }, ['verify-signature', 'env-a.json']],
  ['verify-signature of a verdict with no envelope', null, ['verify-signature', 'verdict.json']],
  ['verify-signature of a replay bundle carrying an envelope', null, ['verify-signature', 'bundle-env.json', '--trusted-key', fpA]],
  ['verify-signature of a file that is not a verdict', null, ['verify-signature', 'not-a-verdict.json']],
]
const ledger = ledgerCases.map(([name, change, a]) => runCase('ledger', { name, fixture: 'ledger', ...(change ? { change } : {}), argv: a }, 'stderr', 1))
for (const c of ledger) if (c.expect.head && c.expect.head[0] === '' && c.expect.stdout) { c.expect.stream = 'stdout'; c.expect.head = [c.expect.stdout.split('\n')[0]] }

// 5. frag open
const FT = 'frag-tree'
const fragJson = (p) => text(FT, `${p}/frag.json`)
const relFile = text(FT, 'frags/frags.jsonl')
const relLines = relFile.split('\n').slice(0, -1)
const onlyFrags = Object.fromEntries(Object.keys(fixtures[FT]).filter((p) => !p.startsWith('frags/')).map((p) => [p, null]))
const resignedFrag = (() => {
  const f = JSON.parse(fragJson('frags/engine/0.7.1/closed'))
  const s = signWith(B, Buffer.from(F.FRAG_SIGNING_PREFIX + V.canonicalize(F.signedBody(f)), 'utf8'))
  return fragJson('frags/engine/0.7.1/closed').replace(JSON.stringify(f.signature.public_key), JSON.stringify(B.public_key)).replace(JSON.stringify(f.signature.signature), JSON.stringify(s))
})()
const failFrag = JSON.parse(fragJson('frags/t/fail'))
const fragCases = [
  ['a release frag: intact and re-performed', null, ['open', 'frags/engine/0.7.1/closed']],
  ['a verdict frag that replays PASS (with a contract, evidence and history)', null, ['open', 'frags/t/pass']],
  ['a verdict frag that replays FAIL', null, ['open', 'frags/t/fail']],
  ['a verdict frag that replays PASS-WITH-OPEN', null, ['open', 'frags/t/open']],
  ['the issuer pinned by a key file given on the command line', null, ['open', 'frags/engine/0.7.1/closed', '--issuer', 'a.pub.pem']],
  ['no issuer pinned (no ISSUER.json beside the record)', { 'frags/ISSUER.json': null }, ['open', 'frags/engine/0.7.1/closed']],
  ['a --tree that is not a repository root', null, ['open', 'frags/engine/0.7.1/closed', '--tree', 'elsewhere']],
  ['no repository root above the frags', onlyFrags, ['open', 'frags/engine/0.7.1/closed']],
  ['a --record that is not there', null, ['open', 'frags/engine/0.7.1/closed', '--record', 'frags/none.jsonl']],
  ['a pin that differs from the tree: noted, not tampering', { 'packages/verify/src/index.ts': { replace: ['export const example = 1', 'export const example = 2'] } }, ['open', 'frags/engine/0.7.1/closed']],
  ['a folder with no frag.json', null, ['open', 'frags/t']],
  ['frag.json with a key written twice', { 'frags/t/fail/frag.json': { replace: ['"schema": "riposte.frag/0.1.0"', '"schema": "riposte.frag/0.1.0",\n  "schema": "riposte.frag/0.1.0"'] } }, ['open', 'frags/t/fail']],
  ['frag.json of another schema', { 'frags/t/fail/frag.json': { replace: ['"schema": "riposte.frag/0.1.0"', '"schema": "riposte.frag/0.2.0"'] } }, ['open', 'frags/t/fail']],
  ['tampered: cover.txt edited', { 'frags/t/fail/cover.txt': { replace: ['A verdict that reads FAIL', 'A verdict that reads PASS'] } }, ['open', 'frags/t/fail']],
  ['tampered: the provenance edited (signed, outside the id)', { 'frags/t/fail/frag.json': { replace: ['"tier": "demo"', '"tier": "blind"'] } }, ['open', 'frags/t/fail']],
  ['tampered: the claim edited (inside the id)', { 'frags/t/fail/frag.json': { replace: ['"outcome": "FAIL"', '"outcome": "PASS"'] } }, ['open', 'frags/t/fail']],
  ['tampered: frag_id edited', { 'frags/t/fail/frag.json': { replace: [`"frag_id": "${failFrag.frag_id}"`, `"frag_id": "${failFrag.frag_id.slice(0, 63)}${failFrag.frag_id.endsWith('0') ? '1' : '0'}"`] } }, ['open', 'frags/t/fail']],
  ['tampered: bundle.json edited', { 'frags/t/fail/bundle.json': { replace: ['"total": 1900', '"total": 1894.92'] } }, ['open', 'frags/t/fail']],
  ['tampered: bundle.json removed', { 'frags/t/fail/bundle.json': null }, ['open', 'frags/t/fail']],
  ['tampered: a record entry edited', { 'frags/frags.jsonl': { replace: ['"claim":"verdict"', '"claim":"verdicT"'] } }, ['open', 'frags/t/fail']],
  ['tampered: the record cut at the tail, its head record left', { 'frags/frags.jsonl': { utf8: `${relLines.slice(0, 3).join('\n')}\n` } }, ['open', 'frags/engine/0.7.1/closed']],
  ['tampered: ISSUER.json names key b', { 'frags/ISSUER.json': { utf8: `${JSON.stringify({ public_key: B.public_key, fingerprint: R.keyFingerprint(B.public_key), note: 'key b' }, null, 2)}\n` } }, ['open', 'frags/engine/0.7.1/closed']],
  ['tampered: the frag signed again by key b, key a the issuer', { 'frags/engine/0.7.1/closed/frag.json': { utf8: resignedFrag } }, ['open', 'frags/engine/0.7.1/closed']],
  ['tampered: the changelog no longer carries the sentence the release claim quotes', { 'packages/verify/CHANGELOG.md': { replace: ['**0.7.1 closed on 2026-10-19**', '0.7.1 closed'] } }, ['open', 'frags/engine/0.7.1/closed']],
  ['a usage error: two folders', null, ['open', 'frags/t/fail', 'frags/t/open']],
]
const frag = fragCases.map(([name, change, a]) => runCase('frag', { name, fixture: FT, ...(change ? { change } : {}), argv: a }, undefined, 2))
for (const c of frag) if (c.expect.stream === 'stderr') c.expect.head = c.expect.head.slice(0, 1)

// 6. the work graph: open a deposit, and read its store
const GT = 'graph'
const dep = json(GT, 'deposit.workgraph.json')
const rehash = (d) => { const { bundle_sha256: _, ...body } = d; return W.canonicalPretty({ ...body, bundle_sha256: W.hashOf(body) }) }
const editedFrag = (() => { const d = JSON.parse(JSON.stringify(dep)); d.frags[3].action = 'edit src/parse.ts and src/read.ts'; return d })()
const editedProse = (() => { const d = JSON.parse(JSON.stringify(dep)); const k = Object.keys(d.prose)[0]; d.prose[k] = `${d.prose[k]} (edited)`; return rehash(d) })()
const editedSig = (() => { const d = JSON.parse(JSON.stringify(dep)); d.charters[0].signatures[0].signature = signWith(B, W.signingMessage(charter)); return rehash(d) })()
const idx = text(GT, 'store/index.jsonl')
const idxLines = idx.split('\n').slice(0, -1)
const s1File = `store/frags/${s1.id}.json`
const workgraphCases = [
  ['a deposit opens intact', null, ['open', 'deposit.workgraph.json']],
  ['a deposit opens intact, as JSON', null, ['open', 'deposit.workgraph.json', '--json']],
  ['a deposit whose charter party is named but has not signed', null, ['open', 'unsigned.workgraph.json']],
  ['tampered: a frag edited (the bundle digest no longer recomputes)', { 'deposit.workgraph.json': { utf8: W.canonicalPretty(editedFrag) } }, ['open', 'deposit.workgraph.json']],
  ['tampered: a frag edited and bundle_sha256 recomputed (the frag\'s id no longer recomputes)', { 'deposit.workgraph.json': { utf8: rehash(editedFrag) } }, ['open', 'deposit.workgraph.json']],
  ['tampered: the prose edited and bundle_sha256 recomputed', { 'deposit.workgraph.json': { utf8: editedProse } }, ['open', 'deposit.workgraph.json']],
  ['tampered: the charter signed by key b, bundle_sha256 recomputed', { 'deposit.workgraph.json': { utf8: editedSig } }, ['open', 'deposit.workgraph.json']],
  ['not a deposit: a frag work chain', null, ['open', 'chain.work.json']],
  ['not a deposit: a key written twice', { 'deposit.workgraph.json': { replace: ['"schema": "riposte.workgraph/0.1.0"', '"schema": "riposte.workgraph/0.1.0",\n  "schema": "riposte.workgraph/0.1.0"'] } }, ['open', 'deposit.workgraph.json']],
  ['not a deposit: another schema', { 'deposit.workgraph.json': { replace: ['"schema": "riposte.workgraph/0.1.0"', '"schema": "riposte.workgraph/0.2.0"'] } }, ['open', 'deposit.workgraph.json']],
  ['the store: status', null, ['status', '--store', 'store']],
  ['the store: status, as JSON', null, ['status', '--json', '--store', 'store']],
  ['the store: the digest of a frag marked wrong', null, ['digest', s1.id, '--store', 'store']],
  ['the store: the digest of a frag that closes its branch, in detail', null, ['digest', close.id, '--detail', '--store', 'store']],
  ['the store: the digest of a container, in detail', null, ['digest', branch.id, '--detail', '--store', 'store']],
  ['the store with no head record', { 'store/index.jsonl.head.json': null }, ['status', '--store', 'store']],
  ['the store with index lines past its head record (an append stopped before writing it)', { 'store/index.jsonl.head.json': { utf8: graphHead6 } }, ['status', '--store', 'store']],
  ['the store: a frag file edited (no longer canonical JSON)', { [s1File]: { replace: ['"action":"edit src/parse.ts"', '"action": "edit src/parse.ts"'] } }, ['status', '--store', 'store']],
  ['the store: a frag file edited in canonical form (its id no longer recomputes)', { [s1File]: { replace: ['"action":"edit src/parse.ts"', '"action":"edit src/read.ts"'] } }, ['status', '--store', 'store']],
  ['the store: the index cut at the tail, its head record left', { 'store/index.jsonl': { utf8: `${idxLines.slice(0, -1).join('\n')}\n` } }, ['status', '--store', 'store']],
  ['the store: two index lines swapped', { 'store/index.jsonl': { utf8: `${[idxLines[0], idxLines[2], idxLines[1], ...idxLines.slice(3)].join('\n')}\n` } }, ['status', '--store', 'store']],
  ['the store: the index with no newline at its end', { 'store/index.jsonl': { utf8: idx.slice(0, -1) } }, ['status', '--store', 'store']],
  ['the store: a head record that is not { bytes, count, head, version }', { 'store/index.jsonl.head.json': { utf8: '{"count":12}\n' } }, ['status', '--store', 'store']],
  ['the store: an indexed frag file missing', { [s1File]: null }, ['status', '--store', 'store']],
]
const workgraph = workgraphCases.map(([name, change, a]) => runCase('workgraph', { name, fixture: GT, ...(change ? { change } : {}), argv: a }, undefined, 1))
for (const c of workgraph) if (c.expect.head && c.expect.stdout) { c.expect.stream = 'stdout'; c.expect.head = [c.expect.stdout.split('\n')[0]] }

if (leaks.length) throw new Error(`a machine path reached the expected answers of: ${leaks.join('; ')}`)

// ── the oracle: what ran, by content (the pin rule over each package's sources and over the JavaScript that ran) ──────────
const pkgJson = (n) => JSON.parse(readFileSync(join(dirs[n], 'package.json'), 'utf8'))
const digest = (dir, filter) => { const d = F.digestFolder(dir, { recursive: true, ...(filter ? { filter } : {}) }); return { sha256: d.sha256, files: d.files } }
const oracle = {
  about: 'The build that answered every case: each package\'s version, the pin rule over its TypeScript sources (src/) and over the JavaScript that ran (dist/**/*.js), the sha256 of the generator and of the runner whose adapters it calls, and the Node.js and OpenSSL it ran on. No commit names it: these hashes do. dist is what answered; src is the tree beside it when the file was written, which can be newer than dist (compiling src afresh and comparing with dist is the check).',
  generator: { file: 'conformance/record/generate.mjs', sha256: sha256Hex(readFileSync(fileURLToPath(import.meta.url))) },
  runner: { file: 'conformance/record/check.mjs', sha256: sha256Hex(readFileSync(join(HERE, 'check.mjs'))), note: 'the generator calls the packages through its adapters (nodeImpl)' },
  node: process.version,
  openssl: process.versions.openssl,
  rule: F.PIN_RULE,
  packages: Object.fromEntries([['riposte-verify', 'verify'], ['riposte-ai', 'receipts'], ['riposte-frag', 'frag'], ['riposte-workgraph', 'workgraph']].map(([shown, n]) => [shown, { version: pkgJson(n).version, src: digest(join(dirs[n], 'src')), dist: digest(join(dirs[n], 'dist'), (f) => f.endsWith('.js')) }])),
}

const ABOUT = 'Conformance cases for the record tier (SPEC.md in this folder): a strict JSON reader, canonical JSON, sha256 bindings, Ed25519, the receipts ledger with its head record, frag open and workgraph open with its store. Every expect was written by running the case through the Node packages named in oracle; nothing in this file was typed by hand. canonical: canonicalize(JSON.parse(text)) is expect.canonical, and its UTF-8 bytes hash to expect.sha256. strict: the reader (engine: nesting limit 256; workgraph: 64) reads text (or base64 bytes, decoded first), named file, and either accepts it (its value written canonically is expect.canonical) or refuses it at expect.refused.where (null: no place is named), in the words expect.refused.message. hashes: rule names what is hashed (SPEC.md); source names an object inside a fixture ({ fixture, file, line? }, line counted from 0) or a folder. ed25519: raw cases verify signature (base64, read as Node reads base64) over message_hex under public_key; the other kinds take the object at source, put signature and public_key in place of its own, and run the format\'s own check (issuer: the key a frag must be signed by); message_sha256 is the sha256 of the bytes that kind signs. ledger, frag, workgraph: the fixture\'s files with change applied (null removes a file; { replace: [a, b] } swaps the first a for b) are written to an empty folder, argv is run there, and the command gives expect.exit, its answering stream (expect.stream) begins with expect.head, and its whole stdout and stderr are expect.stdout and expect.stderr; expect.threw means the Node tool stopped with an exception and printed no verdict line (only the exit is compared). keys are test keys made from the seeds shown. check.mjs and check.py run each part an implementation offers.'

const body = { schema: SCHEMA, about: ABOUT, oracle, keys: { a: keyRecord(A), b: keyRecord(B), x: keyRecord(X, 'x25519') }, fixtures, canonical, strict, hashes, ed25519, ledger, frag, workgraph }
const out = `${JSON.stringify(body, null, 2)}\n`
rmSync(SCRATCH, { recursive: true, force: true })

const counts = ['canonical', 'strict', 'hashes', 'ed25519', 'ledger', 'frag', 'workgraph'].map((k) => `${k} ${body[k].length}`).join(', ')
if (CHECK) {
  let had
  try { had = JSON.parse(readFileSync(OUT, 'utf8')) } catch (e) { console.log(`cannot read ${OUT}: ${e.message}`); process.exit(3) }
  const strip = (x) => { const { oracle: _, ...rest } = x; return JSON.stringify(rest) }
  const sameCases = strip(had) === strip(body)
  const sameOracle = JSON.stringify(had.oracle) === JSON.stringify(oracle)
  console.log(`${counts}\nthe cases ${sameCases ? 'are' : 'are NOT'} what this build answers; the oracle block ${sameOracle ? 'is the same' : 'differs (another build, or another layout)'}`)
  process.exit(sameCases ? 0 : 1)
}
writeFileSync(OUT, out)
console.log(`${counts}\nwrote ${OUT} (${Buffer.byteLength(out)} bytes, sha256 ${sha256Hex(out)})`)
