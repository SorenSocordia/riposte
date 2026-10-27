/**
 * RFC 3161 prereg stamps (src/bench/timestamp.ts) against a local, offline mock authority (test/bench-stamp-mock.ts): the
 * query is the file's SHA-256 in DER that OpenSSL reads back; `stamp` sends nothing without --tsa; a reply verifies only when
 * its imprint is the file's sha256, its nonce answers the query, and (with the CA) its signature and chain hold. Nothing here
 * opens a socket or contacts a real authority.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash, X509Certificate } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { runBench } from '../src/bench/cli-bench'
import { certificatesPem, curlCommand, embeddedCertificates, parseTimestampReply, queryNonce, stampFile, timestampQuery, TimestampError, verifyStamp, type Submitter } from '../src/bench/timestamp'
import { mockTsa, opensslAvailable } from './bench-stamp-mock'

const dirs: string[] = []
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })
const tmp = (p: string): string => { const d = mkdtempSync(join(tmpdir(), p)); dirs.push(d); return d }
const sha = (s: string | Buffer): string => createHash('sha256').update(s).digest('hex')
const bench = (args: string[]): { code: number; err: string } => { let err = ''; const code = runBench(args, { out: () => {}, err: s => { err += s } }); return { code, err } }

describe('the query and the default path (no OpenSSL needed)', () => {
  it('builds a DER TimeStampReq for a 32-byte digest, with the nonce readable back', () => {
    const q = timestampQuery(Buffer.alloc(32, 7), Buffer.from('0102030405060708', 'hex'))
    expect(q[0]).toBe(0x30)
    expect(queryNonce(q)).toBe('0102030405060708')
    expect(() => timestampQuery(Buffer.alloc(20))).toThrow(/32 bytes/)
  })

  it('stamp without --tsa writes the query and sends nothing: the submitter is never called', () => {
    const d = tmp('stamp-default-')
    const f = join(d, 'PREREG.md'); writeFileSync(f, 'Bar: 0 wrong.\n')
    let called = 0
    const spy: Submitter = () => { called++; return { ok: false, message: 'must not be called' } }
    const r = stampFile(f, { submit: spy })
    expect(called).toBe(0)
    expect(r.reply).toBeUndefined()
    expect(existsSync(`${f}.tsq`)).toBe(true)
    expect(r.message).toMatch(/nothing was sent/)
    expect(r.message).toContain(curlCommand(`${f}.tsq`, `${f}.tsr`))
    const cli = bench(['stamp', f])
    expect(cli.code).toBe(0)
    expect(cli.err).toMatch(/query written; nothing was sent/)
    expect(cli.err).toMatch(/then: verify bench stamp-verify/)
  })

  it('a refused request (PKIStatus 2) and garbage are reported, never read as a stamp', () => {
    const refused = Buffer.from([0x30, 0x05, 0x30, 0x03, 0x02, 0x01, 0x02])
    expect(() => parseTimestampReply(refused)).toThrow(TimestampError)
    expect(() => parseTimestampReply(refused)).toThrow(/refused the request \(PKIStatus 2\)/)
    expect(() => parseTimestampReply(Buffer.from('not der'))).toThrow(TimestampError)
  })

  it('usage errors exit 3', () => {
    expect(bench(['stamp']).code).toBe(3)
    expect(bench(['stamp-verify', 'only-one']).code).toBe(3)
    expect(bench(['stamp-verify', 'nope.md', 'nope.tsr']).code).toBe(3)
  })
})

describe.skipIf(!opensslAvailable())('against the offline mock authority', () => {
  const tsa = mockTsa(tmp('stamp-tsa-'))
  const other = mockTsa(tmp('stamp-tsa-other-'), 'Other TSA')

  function stamped(text = 'Bar: 0 wrong PASS on the known-bad items.\n'): { f: string; proof: string; query: string } {
    const d = tmp('stamp-')
    const f = join(d, 'PREREG.md'); writeFileSync(f, text)
    const r = stampFile(f, { tsa: 'mock', submit: tsa.submit })
    return { f, proof: r.reply!, query: r.query }
  }

  it('OpenSSL reads the query back: SHA-256, the file\'s digest, certificate requested', () => {
    const { f, query } = stamped()
    const p = spawnSync('openssl', ['ts', '-query', '-in', query, '-text'], { encoding: 'utf8', windowsHide: true })
    expect(p.status).toBe(0)
    expect(p.stdout).toMatch(/Hash Algorithm: sha256/)
    expect(p.stdout).toMatch(/Certificate required: yes/)
    const hex = [...p.stdout.matchAll(/^\s+\d{4} - ((?:[0-9a-f]{2}[ -]){1,16})/gm)].map(m => m[1]!.replace(/[ -]/g, '')).join('')
    expect(hex).toBe(sha(readFileSync(f)))
  })

  it('a granted stamp verifies: imprint, nonce, signed time, signature and chain', () => {
    const { f, proof, query } = stamped()
    const c = verifyStamp(f, proof, { ca: tsa.ca, query: readFileSync(query) })
    expect(c.ok).toBe(true)
    expect(c.info).toMatchObject({ status: 0, imprint: sha(readFileSync(f)), imprint_algorithm: '2.16.840.1.101.3.4.2.1' })
    expect(c.info!.gen_time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/)
    expect(c.lines.join('\n')).toMatch(/ok   signature and chain/)
    const cli = bench(['stamp-verify', f, proof, '--ca', tsa.ca, '--query', query])
    expect(cli.code).toBe(0)
    expect(cli.err).toMatch(/VERIFIED: .*PREREG\.md existed by \d{4}-/)
  })

  it('an edited prereg fails: the imprint is no longer its sha256, and OpenSSL refuses too', () => {
    const { f, proof } = stamped()
    writeFileSync(f, 'Bar: 1 wrong PASS on the known-bad items.\n')
    const c = verifyStamp(f, proof, { ca: tsa.ca })
    expect(c.ok).toBe(false)
    expect(c.lines.join('\n')).toMatch(/FAIL imprint .* is not the file's sha256/)
    expect(c.lines.join('\n')).toMatch(/FAIL signature/)
    expect(bench(['stamp-verify', f, proof, '--ca', tsa.ca]).code).toBe(1)
  })

  it('a flipped byte in the proof fails', () => {
    const { f, proof } = stamped()
    const b = readFileSync(proof)
    b[b.length - 20] = b[b.length - 20]! ^ 0xff
    writeFileSync(proof, b)
    expect(verifyStamp(f, proof, { ca: tsa.ca }).ok).toBe(false)
  })

  it('a reply checked against the wrong authority\'s CA fails the signature check', () => {
    const { f, proof } = stamped()
    const c = verifyStamp(f, proof, { ca: other.ca })
    expect(c.ok).toBe(false)
    expect(c.lines.join('\n')).toMatch(/FAIL signature/)
  })

  it('without --ca the signature is "not checked", and that is not VERIFIED', () => {
    const { f, proof } = stamped()
    const c = verifyStamp(f, proof)
    expect(c.ok).toBe(false)
    expect(c.lines.join('\n')).toMatch(/not checked: signature and certificate chain/)
    const cli = bench(['stamp-verify', f, proof])
    expect(cli.code).toBe(1)
    expect(cli.err).toMatch(/NOT VERIFIED/)
  })

  it('a reply to a different query fails the nonce check', () => {
    const a = stamped(), b = stamped()
    writeFileSync(b.f, readFileSync(a.f))
    const c = verifyStamp(b.f, b.proof, { ca: tsa.ca, query: readFileSync(a.query) })
    expect(c.lines.join('\n')).toMatch(/FAIL nonce/)
    expect(c.ok).toBe(false)
  })
})

// ── a real stamp from the tree (read-only), and the authority roots shipped beside the tables ─────────────────────────────
const BENCH = join(__dirname, '..', 'docs', 'bench')
const REAL = { prereg: join(BENCH, 'x1-einvoice-pdf', 'PREREG.md'), proof: join(BENCH, 'x1-einvoice-pdf', 'PREREG.md.tsr') }
const ROOTS = [join(BENCH, '_tsa', 'digicert-assured-id-root-ca.pem'), join(BENCH, '_tsa', 'digicert-trusted-root-g4.pem')]
const ROOT_SHA256 = {
  'digicert-assured-id-root-ca.pem': '3E:90:99:B5:01:5E:8F:48:6C:00:BC:EA:9D:11:1E:E7:21:FA:BA:35:5A:89:BC:F1:DF:69:56:1E:3D:C6:32:5C',
  'digicert-trusted-root-g4.pem': '55:2F:7B:DC:F1:A7:AF:9E:6C:E6:72:01:7F:4F:12:AB:F7:72:40:C7:8E:76:1A:C2:03:D1:D9:D2:0A:C8:99:88',
}

describe.skipIf(!existsSync(REAL.proof))('a real DigiCert stamp from docs/bench (read-only)', () => {
  it('reads it without trusting it: granted, the prereg\'s sha256, the signed time, three embedded certificates', () => {
    const info = parseTimestampReply(readFileSync(REAL.proof))
    expect(info).toMatchObject({ status: 0, imprint: sha(readFileSync(REAL.prereg)), imprint_algorithm: '2.16.840.1.101.3.4.2.1', gen_time: '2026-10-05T16:07:30Z', policy: '2.16.840.1.114412.7.1' })
    const certs = embeddedCertificates(readFileSync(REAL.proof)).map(d => new X509Certificate(d))
    expect(certs.map(c => c.subject.match(/CN=([^\n]+)/)?.[1])).toEqual([
      'DigiCert SHA256 RSA4096 Timestamp Responder 2026 1', 'DigiCert Trusted G4 TimeStamping RSA4096 SHA256 2025 CA1', 'DigiCert Trusted Root G4'])
    expect(certs[2]!.issuer).toMatch(/CN=DigiCert Assured ID Root CA/) // the cross-signed G4, so the chain can end at either root
    expect(certificatesPem(embeddedCertificates(readFileSync(REAL.proof))).match(/BEGIN CERTIFICATE/g)).toHaveLength(3)
  })

  it('the shipped roots are the two self-signed DigiCert roots, pinned by SHA-256 fingerprint', () => {
    for (const f of ROOTS) {
      const c = new X509Certificate(readFileSync(f))
      expect(c.issuer).toBe(c.subject)
      expect(c.fingerprint256).toBe(ROOT_SHA256[basename(f) as keyof typeof ROOT_SHA256])
    }
  })

  it.skipIf(!opensslAvailable())('VERIFIED with the two roots, the token\'s own certificates taken as intermediates', () => {
    const c = verifyStamp(REAL.prereg, REAL.proof, { ca: ROOTS })
    expect(c.lines.join('\n')).toMatch(/ok   signature and chain \(openssl ts -verify: Verification: OK; 2 root file\(s\) trusted; 3 certificate\(s\) from the token as intermediates\)/)
    expect(c.ok).toBe(true)
    const cli = bench(['stamp-verify', REAL.prereg, REAL.proof, '--ca', ROOTS[0]!, '--ca', ROOTS[1]!])
    expect(cli.code).toBe(0)
    expect(cli.err).toMatch(/VERIFIED: .*existed by 2026-10-05T16:07:30Z/)
  })

  it.skipIf(!opensslAvailable())('the same real proof fails against a copy of the prereg with one byte changed, and against a wrong root', () => {
    const d = tmp('stamp-real-')
    const copy = join(d, 'PREREG.md')
    const b = readFileSync(REAL.prereg); b[0] = b[0]! ^ 0x01; writeFileSync(copy, b)
    const bad = verifyStamp(copy, REAL.proof, { ca: ROOTS })
    expect(bad.ok).toBe(false)
    expect(bad.lines.join('\n')).toMatch(/FAIL imprint/)
    const other = mockTsa(tmp('stamp-real-ca-'), 'Not DigiCert')
    expect(verifyStamp(REAL.prereg, REAL.proof, { ca: other.ca }).lines.join('\n')).toMatch(/FAIL signature/)
  })
})
