// SPDX-License-Identifier: Apache-2.0
// Prototype; no measured accuracy. Writes vectors-forecast-0.1.0.json beside this file (riposte.forecast-vectors/0.1.0): the cases
// of the forecast kind (riposte.forecast/0.1.0, packages/frag/docs/FORECAST.md), every expected answer taken from running the case
// through the frag package's own functions. Nothing in the file is typed by hand: change a case here and write the file again.
// It is a file of its own: vectors.json (riposte.record-vectors/0.1.0) is frozen and is not changed by this one.
//
//   node conformance/record/generate-forecast.mjs              write vectors-forecast-0.1.0.json
//   node conformance/record/generate-forecast.mjs --out <file> write it elsewhere
//   node conformance/record/generate-forecast.mjs --check      write nothing; exit 0 when every case in the file is what this build
//                                                              answers (the oracle block aside), 1 when one is not, 3 unreadable
//
// The salts are sha256 of a sentence that says what they are, so the file is the same bytes on every run of the same build.
// The proofs are made here: the OpenTimestamps header over a digest, followed by one pending attestation naming a calendar. They
// are proofs of nothing in time; they let a reader check that it reads which digest a proof is about.
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadPackages } from './check.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const OUT = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : join(HERE, 'vectors-forecast-0.1.0.json')
const CHECK = argv.includes('--check')
const SCHEMA = 'riposte.forecast-vectors/0.1.0'

const { F, dirs } = await loadPackages()
const sha = (b) => createHash('sha256').update(b).digest('hex')
const saltOf = (label) => sha(`${SCHEMA} test salt ${label}`)
const b64 = (u8) => Buffer.from(u8).toString('base64')

// ── the pin rule over a folder (packages/frag/SPEC.md, "The pin rule") ────────────────────────────────────────────────
function pin(dir) {
  const files = []
  const walk = (d) => { for (const n of readdirSync(d).sort()) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (/\.ts$/.test(n)) files.push(p) } }
  walk(dir)
  const rel = files.map((f) => relative(dir, f).split(sep).join('/')).sort()
  return { sha256: sha(rel.map((r) => `${sha(readFileSync(join(dir, ...r.split('/'))))}  ${r}\n`).join('')), files: rel.length }
}

// ── proofs: the header, the digest, one pending attestation ────────────────────────────────────────────────────────────
const MAGIC = Buffer.concat([Buffer.from([0]), Buffer.from('OpenTimestamps'), Buffer.from([0, 0]), Buffer.from('Proof'), Buffer.from([0, 0xbf, 0x89, 0xe2, 0xe8, 0x84, 0xe8, 0x92, 0x94])])
const PENDING = Buffer.from('83dfe30d2ef90c8e', 'hex')
function proofOver(digestHex, { version = 1, op = 0x08, cut = null } = {}) {
  const uri = Buffer.from('https://a.pool.opentimestamps.org')
  const payload = Buffer.concat([Buffer.from([uri.length]), uri])
  const whole = Buffer.concat([MAGIC, Buffer.from([version, op]), Buffer.from(digestHex, 'hex'), Buffer.from([0]), PENDING, Buffer.from([payload.length]), payload])
  return new Uint8Array(cut === null ? whole : whole.subarray(0, cut))
}

// ── the forecasts the cases run on ────────────────────────────────────────────────────────────────────────────────────
const M = { question_ref: 'manifold:PUu5UdNR6E', resolution_source: 'https://api.manifold.markets/v0/market/PUu5UdNR6E', resolves_by: '2026-12-31T23:59:00Z' }
const K = { question_ref: 'kalshi:KXEXAMPLE-26DEC31-T3', resolution_source: 'https://external-api.kalshi.com/trade-api/v2/markets/KXEXAMPLE-26DEC31-T3', resolves_by: '2026-12-31T00:00:00.000Z' }
const a = F.sealForecast({ ...M, p: 0.37, salt: saltOf('a') })
const b = F.sealForecast({ ...K, p: 1, salt: saltOf('b') })
const c = F.sealForecast({ ...M, p: 0.1 + 0.2, salt: saltOf('c') })
const zero = F.sealForecast({ ...K, p: 0, salt: saltOf('zero') })
const reseal = (r, change) => { const t = { ...r, ...change }; return { ...t, id: F.revealIdOf(t) } }
const recommit = (cm, change) => { const t = { ...cm, ...change }; return t }

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const iso = [
  ['a whole second', '2026-12-31T23:59:00Z'], ['milliseconds', '2026-12-31T23:59:00.250Z'], ['one decimal', '2026-01-01T00:00:00.5Z'],
  ['a leap day', '2028-02-29T12:00:00Z'], ['the year 2000 is a leap year', '2000-02-29T00:00:00Z'], ['2100 is not a leap year', '2100-02-29T00:00:00Z'],
  ['2026 is not a leap year', '2026-02-29T00:00:00Z'], ['February 30 (Date.parse reads it as March 2)', '2026-02-30T00:00:00Z'],
  ['April 31', '2026-04-31T10:00:00Z'], ['hour 24 (Date.parse reads it as the next day)', '2026-01-01T24:00:00Z'], ['a leap second', '2026-06-30T23:59:60Z'],
  ['before 2000', '1999-12-31T23:59:59Z'], ['an offset, not Z', '2026-12-31T23:59:00+00:00'], ['a space for T', '2026-12-31 23:59:00Z'],
  ['four decimals', '2026-12-31T23:59:00.1234Z'], ['no seconds', '2026-12-31T23:59Z'], ['digits of another script', '\u0662\u0660\u0662\u0666-01-01T00:00:00Z'],
  ['month 13', '2026-13-01T00:00:00Z'], ['lower-case z', '2026-12-31T23:59:00z'],
].map(([name, text]) => ({ name, text, expect: { valid: F.isIsoUtc(text), ms: F.isIsoUtc(text) ? Date.parse(text) : null } }))

const digests = [
  ['a decimal', 0.37, saltOf('a'), M.question_ref], ['zero', 0, saltOf('zero'), K.question_ref], ['one', 1, saltOf('b'), K.question_ref],
  ['a double that prints long', 0.1 + 0.2, saltOf('c'), M.question_ref], ['a small number in exponent form', 1e-7, saltOf('e'), M.question_ref],
  ['minus zero writes as 0', -0, saltOf('zero'), K.question_ref], ['a question id with non-ASCII letters (the digest is defined on any string)', 0.5, saltOf('u'), 'manifold:caf\u00e9-\u20ac'],
].map(([name, p, salt, question_ref]) => ({ name, input: { p, salt, question_ref }, expect: { commit_digest: F.commitDigestOf(p, salt, question_ref) } }))

const ids = [
  ['commit a', a.commit], ['reveal a', a.reveal], ['commit b', b.commit], ['reveal b', b.reveal], ['commit c', c.commit], ['reveal c', c.reveal],
  ['commit a with its proof path filled (the id does not move)', { ...a.commit, stamp: { ots: 'proofs/a.stamp-input.ots' } }],
].map(([name, object]) => ({ name, object, expect: object.kind === 'forecast.commit' ? { id: F.commitIdOf(object), stamp_bytes_sha256: sha(F.commitStampBytes(object)) } : { id: F.revealIdOf(object) } }))

const shapeCases = [
  ['not an object', [1, 2], 'commit'], ['another schema', { ...a.commit, schema: 'riposte.frag/0.1.0' }, 'commit'], ['another kind', { ...a.commit, kind: 'forecast.guess' }, 'commit'],
  ['a field missing', (() => { const t = { ...a.commit }; delete t.resolves_by; return t })(), 'commit'],
  ['a field too many', { ...a.reveal, note: 'x' }, 'reveal'], ['two fields too many, sorted', { ...a.reveal, zeta: 1, alpha: 2 }, 'reveal'],
  ['p above one', { ...a.reveal, p: 1.5 }, 'reveal'], ['p below zero', { ...a.reveal, p: -0.1 }, 'reveal'], ['p as a string', { ...a.reveal, p: '0.37' }, 'reveal'],
  ['p as true', { ...a.reveal, p: true }, 'reveal'], ['a short salt', { ...a.reveal, salt: 'abc' }, 'reveal'], ['an upper-case salt', { ...a.reveal, salt: saltOf('a').toUpperCase() }, 'reveal'],
  ['a question with a space', { ...a.reveal, question_ref: 'manifold:two words' }, 'reveal'], ['a question with no source', { ...a.reveal, question_ref: 'PUu5UdNR6E' }, 'reveal'],
  ['a question with a non-ASCII id', { ...a.reveal, question_ref: 'manifold:caf\u00e9' }, 'reveal'], ['a question with a no-break space', { ...a.reveal, question_ref: 'manifold:a\u00a0b' }, 'reveal'],
  ['an http source', { ...a.commit, resolution_source: 'http://api.manifold.markets/v0/market/x' }, 'commit'], ['resolves_by on February 30', { ...a.commit, resolves_by: '2026-02-30T00:00:00Z' }, 'commit'],
  ['a stamp path that climbs', { ...a.commit, stamp: { ots: '../a.ots' } }, 'commit'], ['an absolute stamp path', { ...a.commit, stamp: { ots: '/tmp/a.ots' } }, 'commit'],
  ['a drive-letter stamp path', { ...a.commit, stamp: { ots: 'C:/a.ots' } }, 'commit'], ['a stamp with two fields', { ...a.commit, stamp: { ots: null, at: null } }, 'commit'],
  ['a stamp that is null', { ...a.commit, stamp: null }, 'commit'], ['an upper-case id', { ...a.commit, id: a.commit.id.toUpperCase() }, 'commit'],
  ['a well-formed commit', a.commit, 'commit'], ['a well-formed reveal', a.reveal, 'reveal'],
].map(([name, object, where]) => ({ name, object, where, expect: { problems: F.forecastShapeProblems(object, where) } }))

const proofCases = [
  ['over commit a', proofOver(a.commit.id)], ['not a proof', new TextEncoder().encode('just some text, long enough to be a header and then some more')],
  ['version 2', proofOver(a.commit.id, { version: 2 })], ['made over sha1', proofOver(a.commit.id, { op: 0x02 })], ['cut inside the digest', proofOver(a.commit.id, { cut: 40 })],
  ['cut inside the header', proofOver(a.commit.id, { cut: 20 })], ['empty', new Uint8Array(0)],
].map(([name, bytes]) => ({ name, base64: b64(bytes), expect: F.otsProofDigest(bytes) }))

const P = (cm) => b64(proofOver(cm.id))
const checkCases = [
  ['counts: the proof is over the commit and the attested time is before resolves_by', a.commit, a.reveal, { proof_base64: P(a.commit), attested_time: '2026-10-27T01:00:00Z' }],
  ['counts, with the Brier score of a YES', a.commit, a.reveal, { proof_base64: P(a.commit), attested_time: '2026-10-27T01:00:00Z', outcome: 'yes' }],
  ['counts, with the Brier score of a NO and a close time after resolves_by (the cutoff stays resolves_by)', a.commit, a.reveal, { proof_base64: P(a.commit), attested_time: '2026-10-27T01:00:00Z', closed_at: '2027-01-05T00:00:00Z', outcome: 'no' }],
  ['does not count: the attested time is after resolves_by', a.commit, a.reveal, { proof_base64: P(a.commit), attested_time: '2027-01-01T00:00:00Z' }],
  ['does not count: the market closed early, before the attested time', a.commit, a.reveal, { proof_base64: P(a.commit), attested_time: '2026-11-20T00:00:00Z', closed_at: '2026-11-15T00:00:00Z' }],
  ['does not count: the attested time equals the cutoff (the stamp must land before it)', a.commit, a.reveal, { proof_base64: P(a.commit), attested_time: '2026-12-31T23:59:00.000Z' }],
  ["can't tell: no proof", a.commit, a.reveal, { attested_time: '2026-10-27T01:00:00Z' }],
  ["can't tell: a proof, no attested time", a.commit, a.reveal, { proof_base64: P(a.commit) }],
  ["can't tell: nothing but the two files", b.commit, b.reveal, {}],
  ['counts: the proof path filled in the commit after stamping (outside the id)', { ...b.commit, stamp: { ots: 'b.stamp-input.ots' } }, b.reveal, { proof_base64: P(b.commit), attested_time: '2026-10-27T01:00:00Z', outcome: 'no' }],
  ['counts: p = 0.1 + 0.2 and a YES (the score of a double)', c.commit, c.reveal, { proof_base64: P(c.commit), attested_time: '2026-10-27T01:00:00Z', outcome: 'yes' }],
  ['counts: p = 0 and a NO', zero.commit, zero.reveal, { proof_base64: P(zero.commit), attested_time: '2026-10-27T01:00:00Z', outcome: 'no' }],
  ['integrity: p changed and the reveal id recomputed', a.commit, reseal(a.reveal, { p: 0.38 }), { proof_base64: P(a.commit), attested_time: '2026-10-27T01:00:00Z' }],
  ['integrity: p changed and the reveal id left as it was', a.commit, { ...a.reveal, p: 0.38 }, {}],
  ['integrity: the salt changed', a.commit, reseal(a.reveal, { salt: saltOf('other') }), {}],
  ["integrity: the commit's resolves_by moved after it was written", recommit(a.commit, { resolves_by: '2027-06-30T00:00:00Z' }), a.reveal, {}],
  ['integrity: the reveal opens another commit', b.commit, a.reveal, {}],
  ['integrity: the reveal names another question (its id recomputed)', a.commit, reseal(a.reveal, { question_ref: K.question_ref }), {}],
  ['integrity: the proof is over other bytes', a.commit, a.reveal, { proof_base64: P(b.commit), attested_time: '2026-10-27T01:00:00Z' }],
  ['integrity: the proof is not a proof', a.commit, a.reveal, { proof_base64: b64(new TextEncoder().encode('not a proof file at all, but long enough to read a header')), attested_time: '2026-10-27T01:00:00Z' }],
  ['not a forecast: the files in the wrong order', a.reveal, a.commit, {}],
  ['not a forecast: two commits', a.commit, b.commit, {}],
  ['not a forecast: an attested time with an offset', a.commit, a.reveal, { attested_time: '2026-10-27T01:00:00+00:00' }],
  ['not a forecast: an outcome that is not yes or no', a.commit, a.reveal, { outcome: 'maybe' }],
  ['not a forecast: a reveal with a field too many', a.commit, { ...a.reveal, note: 'x' }, {}],
].map(([name, commit, reveal, options]) => {
  const k = F.verifyForecast(commit, reveal, { proof: options.proof_base64 != null ? new Uint8Array(Buffer.from(options.proof_base64, 'base64')) : null, attested_time: options.attested_time ?? null, closed_at: options.closed_at ?? null, outcome: options.outcome ?? null })
  return { name, commit, reveal, options, expect: { result: k, sheet: F.forecastSheet(k) } }
})

const pkg = JSON.parse(readFileSync(join(dirs.frag, 'package.json'), 'utf8'))
const file = {
  schema: SCHEMA,
  about: 'The cases of the forecast kind (riposte.forecast/0.1.0): ISO times as the format reads them, commit digests, ids, shape problems, proof headers, and whole checks with the sheet a person reads. Every expected answer was written by running the case through the frag package. The proofs are made here and prove nothing in time. vectors.json (riposte.record-vectors/0.1.0) is a separate, frozen file.',
  oracle: {
    package: { name: pkg.name, version: pkg.version, forecast_sources: { over: 'src/forecast/', rule: 'the pin rule (packages/frag/SPEC.md)', ...pin(join(dirs.frag, 'src', 'forecast')) } },
    generator_sha256: sha(readFileSync(fileURLToPath(import.meta.url))), node: process.version,
  },
  counts: { iso: iso.length, digests: digests.length, ids: ids.length, shapes: shapeCases.length, proofs: proofCases.length, checks: checkCases.length },
  iso, digests, ids, shapes: shapeCases, proofs: proofCases, checks: checkCases,
}
const text = JSON.stringify(file, null, 2) + '\n'
// a machine path (this folder, the package's, the working folder, a home folder) never reaches the file; the cases' own
// deliberately bad stamp paths ("C:/a.ots", "/tmp/a.ots") are not machine paths
const machine = [HERE, dirs.frag, process.cwd()].flatMap((p) => [p, p.split(sep).join('/'), JSON.stringify(p).slice(1, -1)])
if (machine.some((p) => p && text.includes(p)) || /[\\/]Users[\\/]|\/home\//.test(text)) { process.stderr.write('generate-forecast: a machine path reached the file; refusing to write it\n'); process.exit(3) }
if (CHECK) {
  let have
  try { have = JSON.parse(readFileSync(OUT, 'utf8')) } catch (e) { process.stderr.write(`generate-forecast --check: ${OUT} cannot be read (${e.message})\n`); process.exit(3) }
  const differ = []
  for (const part of ['iso', 'digests', 'ids', 'shapes', 'proofs', 'checks']) {
    const want = file[part]; const got = have[part] ?? []
    if (got.length !== want.length) differ.push(`${part}: ${got.length} cases in the file, ${want.length} in this build`)
    want.forEach((w, i) => { if (JSON.stringify(got[i]) !== JSON.stringify(w)) differ.push(`${part}/${w.name}: not what this build answers`) })
  }
  const total = Object.values(file.counts).reduce((s, n) => s + n, 0)
  process.stdout.write(differ.length ? `${differ.join('\n')}\ngenerate-forecast --check: ${differ.length} difference(s) in ${total} cases\n` : `generate-forecast --check: all ${total} cases are what this build answers; oracle block ${JSON.stringify(have.oracle) === JSON.stringify(file.oracle) ? 'the same' : 'differs (another build or layout)'}\n`)
  process.exit(differ.length ? 1 : 0)
}
writeFileSync(OUT, text)
process.stdout.write(`generate-forecast: wrote ${relative(HERE, OUT) || OUT} (${Object.entries(file.counts).map(([k, n]) => `${k} ${n}`).join(', ')})\n`)
