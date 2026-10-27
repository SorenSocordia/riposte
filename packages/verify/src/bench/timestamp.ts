/**
 * Third-party timestamps for preregistrations (RFC 3161). A timestamp authority (TSA) signs a file's sha256 together with
 * the time it saw it, so "this prereg existed before the run" stops resting on the authors' own clock.
 *
 *   verify bench stamp <file> [--out <query.tsq>] [--tsa <url>]
 *       Writes the RFC 3161 query for the file's sha256 (default `<file>.tsq`). Contacts nothing unless --tsa is given;
 *       then it posts the query with curl and writes the reply beside the file (`<file>.tsr`), and checks it.
 *       Without --tsa it prints the exact curl command to send it, so the first real stamp is a person's deliberate act.
 *   verify bench stamp-verify <file> <proof.tsr> [--ca <root.pem>]... [--untrusted <certs.pem>] [--query <query.tsq>]
 *       Reads the reply (a TimeStampResp or a bare token), checks it was granted, that its message imprint is the
 *       file's sha256 under SHA-256, and prints the time the authority signed. With --ca (the ROOT certificate(s) the
 *       authority chains to; repeat it for a root and its cross-signer) it also checks the signature and the certificate
 *       chain with `openssl ts -verify`, passing the certificates the token itself carries as untrusted intermediates.
 *       Exit 0 only when all of that holds.
 *
 * The request is DER built here (no dependency); the reply is read by the small DER walker below; the signature check is
 * delegated to OpenSSL, the reference implementation of `ts -verify`. Exit codes: 0 verified · 1 not verified · 3 usage.
 */

import { spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const SHA256_OID = '2.16.840.1.101.3.4.2.1'
const SIGNED_DATA_OID = '1.2.840.113549.1.7.2'
const TST_INFO_OID = '1.2.840.113549.1.9.16.1.4'

// ── DER writing ────────────────────────────────────────────────────────────────────────────────────────────────────────

function derLength(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n])
  const bytes: number[] = []
  for (let v = n; v > 0; v = Math.floor(v / 256)) bytes.unshift(v & 0xff)
  return Buffer.from([0x80 | bytes.length, ...bytes])
}
const tlv = (tag: number, content: Buffer): Buffer => Buffer.concat([Buffer.from([tag]), derLength(content.length), content])
const seq = (...parts: Buffer[]): Buffer => tlv(0x30, Buffer.concat(parts))

function oidBytes(oid: string): Buffer {
  const arcs = oid.split('.').map(Number)
  const out: number[] = [40 * arcs[0]! + arcs[1]!]
  for (const arc of arcs.slice(2)) {
    const stack: number[] = [arc & 0x7f]
    for (let v = Math.floor(arc / 128); v > 0; v = Math.floor(v / 128)) stack.unshift(0x80 | (v & 0x7f))
    out.push(...stack)
  }
  return tlv(0x06, Buffer.from(out))
}

/** A non-negative INTEGER from big-endian bytes (a leading zero keeps the sign bit clear). */
function intBytes(b: Buffer): Buffer {
  let i = 0
  while (i < b.length - 1 && b[i] === 0) i++
  const body = b.subarray(i)
  return tlv(0x02, body[0]! & 0x80 ? Buffer.concat([Buffer.from([0]), body]) : body)
}

/**
 * The DER TimeStampReq (RFC 3161 §2.4.1) for a SHA-256 digest: version 1, the message imprint, a nonce, and certReq TRUE
 * (so the reply carries the TSA's certificate and a verifier needs only the authority's CA).
 */
export function timestampQuery(digest: Buffer, nonce: Buffer = randomBytes(8)): Buffer {
  if (digest.length !== 32) throw new TypeError('timestampQuery: a SHA-256 digest is 32 bytes')
  const imprint = seq(seq(oidBytes(SHA256_OID), Buffer.from([0x05, 0x00])), tlv(0x04, digest))
  return seq(intBytes(Buffer.from([1])), imprint, intBytes(nonce), Buffer.from([0x01, 0x01, 0xff]))
}

// ── DER reading ────────────────────────────────────────────────────────────────────────────────────────────────────────

interface Node { tag: number; start: number; body: Buffer; end: number }

function readNode(buf: Buffer, at: number): Node {
  if (at + 2 > buf.length) throw new TimestampError('bad-der', 'truncated DER')
  const tag = buf[at]!
  let len = buf[at + 1]!
  let off = at + 2
  if (len & 0x80) {
    const n = len & 0x7f
    if (n === 0 || n > 4) throw new TimestampError('bad-der', 'unsupported DER length (indefinite or too long)')
    len = 0
    for (let i = 0; i < n; i++) len = len * 256 + buf[off + i]!
    off += n
  }
  if (off + len > buf.length) throw new TimestampError('bad-der', 'DER length runs past the end of the data')
  return { tag, start: at, body: buf.subarray(off, off + len), end: off + len }
}

function children(n: Node): Node[] {
  const out: Node[] = []
  for (let at = 0; at < n.body.length;) { const c = readNode(n.body, at); out.push(c); at = c.end }
  return out
}

function oidString(b: Buffer): string {
  const arcs: number[] = [Math.floor(b[0]! / 40), b[0]! % 40]
  let v = 0
  for (const x of b.subarray(1)) { v = v * 128 + (x & 0x7f); if (!(x & 0x80)) { arcs.push(v); v = 0 } }
  return arcs.join('.')
}

const expectTag = (n: Node | undefined, tag: number, what: string): Node => {
  if (!n || n.tag !== tag) throw new TimestampError('bad-reply', `${what}: expected tag 0x${tag.toString(16)}, got ${n ? `0x${n.tag.toString(16)}` : 'nothing'}`)
  return n
}

/** An OCTET STRING's bytes, including a constructed one (its parts concatenated). */
function octets(n: Node): Buffer {
  if (n.tag === 0x04) return n.body
  if (n.tag === 0x24) return Buffer.concat(children(n).map(octets))
  throw new TimestampError('bad-reply', `expected an OCTET STRING, got tag 0x${n.tag.toString(16)}`)
}

function generalizedTime(s: string): string {
  const m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\.\d+)?Z$/)
  if (!m) throw new TimestampError('bad-reply', `genTime ${JSON.stringify(s)} is not a UTC GeneralizedTime`)
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] ?? ''}Z`
}

export class TimestampError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'TimestampError' }
}

/** What a timestamp reply says, read without trusting it (the signature is a separate check). */
export interface TimestampInfo {
  /** PKIStatus: 0 granted, 1 granted with modifications; anything else is a refusal. Null for a bare token. */
  status: number | null
  policy: string
  imprint_algorithm: string
  /** The message imprint, hex: for a stamp of file F under SHA-256 it must equal sha256(F). */
  imprint: string
  serial: string
  /** The time the authority signed, ISO 8601 UTC. */
  gen_time: string
  nonce: string | null
}

/** The token's SignedData fields, and the reply's PKIStatus (null for a bare token). Throws on a refusal or a malformed reply. */
function signedDataOf(der: Buffer): { status: number | null; sd: Node[] } {
  const top = readNode(der, 0)
  expectTag(top, 0x30, 'reply')
  const parts = children(top)
  let status: number | null = null
  let token: Node
  if (parts[0]?.tag === 0x30) {
    // TimeStampResp: PKIStatusInfo, then the token when granted
    const st = expectTag(children(parts[0])[0], 0x02, 'PKIStatusInfo.status')
    status = st.body.reduce((a, b) => a * 256 + b, 0)
    if (status !== 0 && status !== 1) throw new TimestampError('refused', `the authority refused the request (PKIStatus ${status})`)
    token = expectTag(parts[1], 0x30, 'timeStampToken')
  } else token = top
  const ci = children(token)
  if (oidString(expectTag(ci[0], 0x06, 'ContentInfo.contentType').body) !== SIGNED_DATA_OID) throw new TimestampError('bad-reply', 'the token is not CMS SignedData')
  const signedData = expectTag(children(expectTag(ci[1], 0xa0, 'ContentInfo.content'))[0], 0x30, 'SignedData')
  return { status, sd: children(signedData) }
}

/**
 * The certificates the token carries (SignedData `certificates`, RFC 5652 §5.1), each as DER. An authority usually embeds its
 * responder certificate and the intermediates up to, but not including, its root: the same set `openssl ts -reply -token_out
 * | openssl pkcs7 -print_certs` prints. A verifier passes them as untrusted intermediates and trusts only the root(s) it holds.
 */
export function embeddedCertificates(der: Buffer): Buffer[] {
  const { sd } = signedDataOf(der)
  const certs = sd.slice(3).find(n => n.tag === 0xa0)
  if (!certs) return []
  return children(certs).filter(c => c.tag === 0x30).map(c => Buffer.from(certs.body.subarray(c.start, c.end)))
}

/** DER certificates as one PEM text. */
export const certificatesPem = (ders: Buffer[]): string =>
  ders.map(d => `-----BEGIN CERTIFICATE-----\n${(d.toString('base64').match(/.{1,64}/g) ?? []).join('\n')}\n-----END CERTIFICATE-----\n`).join('')

/** Read a TimeStampResp (RFC 3161 §2.4.2) or a bare TimeStampToken (CMS ContentInfo). */
export function parseTimestampReply(der: Buffer): TimestampInfo {
  const { status, sd } = signedDataOf(der)
  const encap = children(expectTag(sd[2], 0x30, 'SignedData.encapContentInfo'))
  if (oidString(expectTag(encap[0], 0x06, 'eContentType').body) !== TST_INFO_OID) throw new TimestampError('bad-reply', 'the signed content is not a TSTInfo')
  const eContent = children(expectTag(encap[1], 0xa0, 'eContent'))[0]
  if (!eContent) throw new TimestampError('bad-reply', 'the TSTInfo is missing')
  const tst = children(expectTag(readNode(octets(eContent), 0), 0x30, 'TSTInfo'))
  const policy = oidString(expectTag(tst[1], 0x06, 'TSTInfo.policy').body)
  const mi = children(expectTag(tst[2], 0x30, 'TSTInfo.messageImprint'))
  const alg = oidString(expectTag(children(expectTag(mi[0], 0x30, 'hashAlgorithm'))[0], 0x06, 'hashAlgorithm.oid').body)
  const imprint = expectTag(mi[1], 0x04, 'hashedMessage').body.toString('hex')
  const serial = expectTag(tst[3], 0x02, 'TSTInfo.serialNumber').body.toString('hex')
  const gen = generalizedTime(expectTag(tst[4], 0x18, 'TSTInfo.genTime').body.toString('latin1'))
  let nonce: string | null = null
  for (const n of tst.slice(5)) if (n.tag === 0x02) { nonce = n.body.toString('hex').replace(/^00(?=[89a-f])/, ''); break }
  return { status, policy, imprint_algorithm: alg, imprint, serial, gen_time: gen, nonce }
}

/** The nonce a query carries, hex (for matching a reply to its request). */
export function queryNonce(query: Buffer): string | null {
  const parts = children(readNode(query, 0))
  const n = parts.find((p, i) => i > 1 && p.tag === 0x02)
  return n ? n.body.toString('hex').replace(/^00(?=[89a-f])/, '') : null
}

// ── checking ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface StampCheck {
  ok: boolean
  info: TimestampInfo | null
  /** sha256 of the file, hex. */
  sha256: string
  /** One line per check, in order, each starting with "ok" or "FAIL" (or "not checked"). */
  lines: string[]
}

export type OpensslRunner = (args: string[]) => { status: number | null; stdout: string; stderr: string; error?: Error }

/** OpenSSL as found on PATH (`RIPOSTE_OPENSSL` overrides the binary). */
export const runOpenssl: OpensslRunner = (args) => {
  const p = spawnSync(process.env.RIPOSTE_OPENSSL || 'openssl', args, { encoding: 'utf8', windowsHide: true })
  return { status: p.status, stdout: p.stdout ?? '', stderr: p.stderr ?? '', ...(p.error ? { error: p.error } : {}) }
}

export interface VerifyOptions {
  /**
   * The root certificate(s) the authority chains to (PEM files; give every root the chain may end at, e.g. a root and the root
   * that cross-signs it). With them, the signature and chain are checked by `openssl ts -verify`. Only these are trusted.
   */
  ca?: string | string[]
  /** More intermediate certificates (PEM), beyond the ones the reply carries (those are always used, as untrusted). */
  untrusted?: string
  /** The query the reply answers: its nonce must match. */
  query?: Buffer
  openssl?: OpensslRunner
}

/** Check a stamp of `file` (see the module comment). Pure except for reading the files and running OpenSSL with --ca. */
export function verifyStamp(file: string, proof: string, o: VerifyOptions = {}): StampCheck {
  const bytes = readFileSync(file)
  const sha = createHash('sha256').update(bytes).digest('hex')
  const lines: string[] = []
  let info: TimestampInfo
  try { info = parseTimestampReply(readFileSync(proof)) } catch (e) {
    return { ok: false, info: null, sha256: sha, lines: [`FAIL reply: ${(e as Error).message}`] }
  }
  let ok = true
  lines.push(info.status === null ? 'ok   reply: a bare timestamp token' : `ok   reply: granted (PKIStatus ${info.status})`)
  if (info.imprint_algorithm !== SHA256_OID) { ok = false; lines.push(`FAIL imprint algorithm ${info.imprint_algorithm} is not SHA-256`) }
  if (info.imprint !== sha) { ok = false; lines.push(`FAIL imprint ${info.imprint} is not the file's sha256 ${sha}`) } else lines.push(`ok   imprint is the file's sha256 ${sha}`)
  if (o.query) {
    const want = queryNonce(o.query)
    if (want !== info.nonce) { ok = false; lines.push(`FAIL nonce ${info.nonce ?? 'none'} does not answer the query's ${want ?? 'none'}`) } else lines.push('ok   nonce answers the query')
  }
  lines.push(`ok   signed time ${info.gen_time} (serial ${info.serial})`)
  const cas = o.ca === undefined ? [] : Array.isArray(o.ca) ? o.ca : [o.ca]
  if (!cas.length) { ok = false; lines.push('not checked: signature and certificate chain (give --ca <the authority\'s root certificate>)') }
  else {
    // the roots are trusted; the certificates the token carries (and any --untrusted) are only candidates for the chain
    const dir = mkdtempSync(join(tmpdir(), 'bench-stamp-'))
    try {
      const caFile = join(dir, 'roots.pem')
      writeFileSync(caFile, cas.map(f => readFileSync(f, 'utf8').replace(/\s*$/, '\n')).join(''))
      const carried = embeddedCertificates(readFileSync(proof))
      const extra = o.untrusted ? readFileSync(o.untrusted, 'utf8').replace(/\s*$/, '\n') : ''
      const args = ['ts', '-verify', '-data', file, '-in', proof, '-CAfile', caFile]
      if (info.status === null) args.push('-token_in')
      if (carried.length || extra) {
        const untrustedFile = join(dir, 'untrusted.pem')
        writeFileSync(untrustedFile, certificatesPem(carried) + extra)
        args.push('-untrusted', untrustedFile)
      }
      const r = (o.openssl ?? runOpenssl)(args)
      const via = `${cas.length} root file(s) trusted; ${carried.length} certificate(s) from the token${extra ? ' and --untrusted' : ''} as intermediates`
      if (r.error) { ok = false; lines.push(`FAIL signature: openssl could not run (${r.error.message})`) }
      else if (r.status === 0 && /Verification: OK/.test(r.stdout + r.stderr)) lines.push(`ok   signature and chain (openssl ts -verify: Verification: OK; ${via})`)
      else { ok = false; lines.push(`FAIL signature: openssl ts -verify said ${JSON.stringify((r.stdout + r.stderr).trim().split(/\r?\n/).slice(-2).join(' | '))} (${via})`) }
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }
  return { ok, info, sha256: sha, lines }
}

// ── stamping ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Posts a query file to a TSA and writes the reply. The default is curl; tests pass a local mock. */
export type Submitter = (queryPath: string, replyPath: string, tsa: string) => { ok: boolean; message: string }

export const curlSubmitter: Submitter = (queryPath, replyPath, tsa) => {
  const p = spawnSync('curl', ['-sS', '--fail', '-H', 'Content-Type: application/timestamp-query', '--data-binary', `@${queryPath}`, '-o', replyPath, tsa], { encoding: 'utf8', windowsHide: true })
  return { ok: p.status === 0, message: p.error ? p.error.message : (p.stderr ?? '').trim() || `curl exit ${p.status}` }
}

/** The command a person runs to send a query by hand (printed by `stamp` without --tsa). */
export const curlCommand = (queryPath: string, replyPath: string, tsa = '<TSA URL>'): string =>
  `curl -sS --fail -H "Content-Type: application/timestamp-query" --data-binary @${queryPath} -o ${replyPath} ${tsa}`

export interface StampOptions { out?: string; tsa?: string; submit?: Submitter; nonce?: Buffer }
export interface StampResult { sha256: string; query: string; reply?: string; check?: StampCheck; message: string }

/** Write the query for `file`; with a TSA, submit it, write the reply beside the file and check the imprint and nonce. */
export function stampFile(file: string, o: StampOptions = {}): StampResult {
  if (!existsSync(file)) throw new TimestampError('no-file', `${file} does not exist`)
  const digest = createHash('sha256').update(readFileSync(file)).digest()
  const query = timestampQuery(digest, o.nonce)
  const qPath = o.out ?? `${file}.tsq`
  writeFileSync(qPath, query)
  const rPath = `${file}.tsr`
  if (!o.tsa) return { sha256: digest.toString('hex'), query: qPath, message: `query written; nothing was sent. To stamp: ${curlCommand(qPath, rPath)}` }
  const sent = (o.submit ?? curlSubmitter)(qPath, rPath, o.tsa)
  if (!sent.ok || !existsSync(rPath)) throw new TimestampError('submit-failed', `the authority did not answer: ${sent.message}`)
  const check = verifyStamp(file, rPath, { query })
  return { sha256: digest.toString('hex'), query: qPath, reply: rPath, check, message: check.info ? `stamped at ${check.info.gen_time}` : 'reply unreadable' }
}
