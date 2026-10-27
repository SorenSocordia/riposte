/**
 * RFC 3161 time-stamp tokens, verified OFFLINE (2026-09-28). No network, no new dependency: a minimal DER reader
 * and node:crypto.
 *
 * A time-stamp authority (TSA) signs "this 32-byte digest existed by genTime". Asked to stamp checkpointDigest(cp) (the sha256 of
 * exactly what the witness signed), its token puts a trusted third party's time on a checkpoint: the anchored prefix existed,
 * as-is, by then. Obtaining the token is the deployment's (a network call through its own CheckpointWriter); checking it is here.
 *
 * What is checked, in order (RFC 3161 §2.4.2; CMS SignedData):
 *   the token is a SignedData with exactly one signer (the TSA) whose content is a TSTInfo;
 *   TSTInfo.messageImprint is sha256 and equals the expected digest;
 *   the signed attributes carry contentType = id-ct-TSTInfo and messageDigest = hash(TSTInfo);
 *   the SigningCertificate (v1, SHA-1) or SigningCertificateV2 attribute names the TSA certificate by hash;
 *   that certificate is TRUSTED: pinned (tsa_certs), or issued directly by a supplied root (tsa_roots; one level, no path
 *     building, no revocation check);
 *   it carries the timeStamping extended key usage and was valid at genTime;
 *   the signature over the signed attributes verifies (RSA PKCS#1 v1.5 or ECDSA, with SHA-256/384/512).
 * Not supported (refused, not guessed): RSA-PSS and EdDSA signers, SHA-1 digests, certificate chains longer than one, CRL/OCSP.
 */

import { X509Certificate, createHash, constants, verify as cryptoVerify } from 'node:crypto'
import { checkpointDigest, type Checkpoint } from './checkpoint.js'

// ── a minimal DER reader ────────────────────────────────────────────────────────────────────────────────────────────

interface Tlv { tag: number; start: number; body: number; end: number }

class DerError extends Error {}

function tlv(buf: Buffer, pos: number, limit = buf.length): Tlv {
  if (pos + 2 > limit) throw new DerError('truncated DER')
  const tag = buf[pos]!
  if ((tag & 0x1f) === 0x1f) throw new DerError('multi-byte DER tags are not used here')
  let p = pos + 1
  let len = buf[p++]!
  if (len & 0x80) {
    const n = len & 0x7f
    if (n === 0 || n > 4) throw new DerError('indefinite or oversized DER length')
    len = 0
    for (let i = 0; i < n; i++) len = len * 256 + buf[p++]!
  }
  const end = p + len
  if (end > limit) throw new DerError('DER length runs past its container')
  return { tag, start: pos, body: p, end }
}

function kids(buf: Buffer, t: Tlv): Tlv[] {
  const out: Tlv[] = []
  for (let p = t.body; p < t.end;) {
    const c = tlv(buf, p, t.end)
    out.push(c)
    p = c.end
  }
  return out
}

function expectTag(t: Tlv | undefined, tag: number, what: string): Tlv {
  if (!t || t.tag !== tag) throw new DerError(`${what}: expected tag 0x${tag.toString(16)}, got ${t ? '0x' + t.tag.toString(16) : 'nothing'}`)
  return t
}

function oid(buf: Buffer, t: Tlv): string {
  expectTag(t, 0x06, 'OBJECT IDENTIFIER')
  const b = buf.subarray(t.body, t.end)
  const parts: number[] = []
  let v = 0
  for (const byte of b) {
    v = v * 128 + (byte & 0x7f)
    if (!(byte & 0x80)) { parts.push(v); v = 0 }
  }
  const first = parts.shift() ?? 0
  const head = first < 80 ? [Math.floor(first / 40), first % 40] : [2, first - 80]
  return [...head, ...parts].join('.')
}

const bytes = (buf: Buffer, t: Tlv): Buffer => buf.subarray(t.body, t.end)
const whole = (buf: Buffer, t: Tlv): Buffer => buf.subarray(t.start, t.end)

function generalizedTime(buf: Buffer, t: Tlv): string {
  expectTag(t, 0x18, 'GeneralizedTime')
  const s = bytes(buf, t).toString('latin1')
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\.\d+)?Z$/.exec(s)
  if (!m) throw new DerError(`genTime is not a UTC GeneralizedTime: ${s}`)
  const ms = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] ?? ''}Z`)
  if (!Number.isFinite(ms)) throw new DerError(`genTime does not parse: ${s}`)
  return new Date(ms).toISOString()
}

// ── object identifiers ──────────────────────────────────────────────────────────────────────────────────────────────

const OID = {
  signedData: '1.2.840.113549.1.7.2',
  tstInfo: '1.2.840.113549.1.9.16.1.4',
  contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
  signingCertificate: '1.2.840.113549.1.9.16.2.12',
  signingCertificateV2: '1.2.840.113549.1.9.16.2.47',
  timeStamping: '1.3.6.1.5.5.7.3.8',
}
const DIGESTS: Readonly<Record<string, string>> = {
  '2.16.840.1.101.3.4.2.1': 'sha256',
  '2.16.840.1.101.3.4.2.2': 'sha384',
  '2.16.840.1.101.3.4.2.3': 'sha512',
}
/** Signature algorithms: RSA PKCS#1 v1.5 (bare, or naming its hash) and ECDSA. The hash named must match the digest algorithm. */
const SIGS: Readonly<Record<string, { kind: 'rsa' | 'ecdsa'; hash?: string }>> = {
  '1.2.840.113549.1.1.1': { kind: 'rsa' },
  '1.2.840.113549.1.1.11': { kind: 'rsa', hash: 'sha256' },
  '1.2.840.113549.1.1.12': { kind: 'rsa', hash: 'sha384' },
  '1.2.840.113549.1.1.13': { kind: 'rsa', hash: 'sha512' },
  '1.2.840.10045.4.3.2': { kind: 'ecdsa', hash: 'sha256' },
  '1.2.840.10045.4.3.3': { kind: 'ecdsa', hash: 'sha384' },
  '1.2.840.10045.4.3.4': { kind: 'ecdsa', hash: 'sha512' },
}

// ── the verifier ────────────────────────────────────────────────────────────────────────────────────────────────────

export interface TimestampTrust {
  /** Pinned TSA certificates (PEM): a token signed by one of these is trusted. */
  tsa_certs?: readonly string[]
  /** Root certificates (PEM) whose DIRECT issuance of a TSA certificate (embedded in the token, or pinned) is trusted. */
  tsa_roots?: readonly string[]
}

export interface TimestampCheck {
  ok: boolean
  reason?: string
  /** The TSA's time, ISO-8601 UTC. */
  gen_time?: string
  /** TSTInfo.serialNumber, hex. */
  serial?: string
  policy?: string
  /** The trusted TSA certificate's subject. */
  tsa?: string
  /** How the TSA certificate was trusted. */
  via?: 'pinned' | 'root'
}

const certs = (pems: readonly string[] | undefined): X509Certificate[] => (pems ?? []).map(p => new X509Certificate(p))
const validAt = (c: X509Certificate, iso: string): boolean => {
  const t = Date.parse(iso)
  return Date.parse(c.validFrom) <= t && t <= Date.parse(c.validTo)
}
const ekuOf = (c: X509Certificate): readonly string[] =>
  ((c as unknown as { extKeyUsage?: string[] }).extKeyUsage ?? (c as unknown as { keyUsage?: string[] }).keyUsage ?? [])

/**
 * Verify an RFC 3161 TimeStampToken (DER, or base64 of it) over `digest` (the sha256 the TSA was asked to stamp), against the
 * TSAs a deployment trusts. Offline and deterministic.
 */
export function verifyTimestampToken(token: Buffer | string, digest: Buffer, trust: TimestampTrust): TimestampCheck {
  const no = (reason: string, extra: Partial<TimestampCheck> = {}): TimestampCheck => ({ ok: false, reason, ...extra })
  const buf = typeof token === 'string' ? Buffer.from(token, 'base64') : token
  try {
    // ContentInfo → SignedData
    const ci = expectTag(tlv(buf, 0), 0x30, 'ContentInfo')
    if (ci.end !== buf.length) return no('trailing bytes after the token')
    const [ctype, ctx] = kids(buf, ci)
    if (oid(buf, ctype!) !== OID.signedData) return no('the token is not a CMS SignedData')
    const sd = expectTag(kids(buf, expectTag(ctx, 0xa0, 'ContentInfo.content'))[0], 0x30, 'SignedData')
    const sdk = kids(buf, sd)
    const encap = expectTag(sdk[2], 0x30, 'encapContentInfo')
    let i = 3
    const embedded: X509Certificate[] = []
    if (sdk[i]?.tag === 0xa0) { for (const c of kids(buf, sdk[i]!)) if (c.tag === 0x30) embedded.push(new X509Certificate(whole(buf, c))); i++ }
    if (sdk[i]?.tag === 0xa1) i++
    const signerInfos = kids(buf, expectTag(sdk[i], 0x31, 'signerInfos'))
    if (signerInfos.length !== 1) return no(`a time-stamp token carries exactly one signature (the TSA's); this one carries ${signerInfos.length}`)

    // TSTInfo
    const [etype, econt] = kids(buf, encap)
    if (oid(buf, etype!) !== OID.tstInfo) return no('the signed content is not a TSTInfo')
    const eOctets = expectTag(kids(buf, expectTag(econt, 0xa0, 'eContent'))[0], 0x04, 'eContent OCTET STRING')
    const tstBytes = bytes(buf, eOctets)
    const tst = expectTag(tlv(tstBytes, 0), 0x30, 'TSTInfo')
    const tk = kids(tstBytes, tst)
    const policy = oid(tstBytes, tk[1]!)
    const mi = kids(tstBytes, expectTag(tk[2], 0x30, 'messageImprint'))
    const miAlg = oid(tstBytes, kids(tstBytes, expectTag(mi[0], 0x30, 'hashAlgorithm'))[0]!)
    const hashed = bytes(tstBytes, expectTag(mi[1], 0x04, 'hashedMessage'))
    const serial = bytes(tstBytes, expectTag(tk[3], 0x02, 'serialNumber')).toString('hex')
    const gen_time = generalizedTime(tstBytes, tk[4]!)
    const facts = { gen_time, serial, policy }
    if (DIGESTS[miAlg] !== 'sha256') return no(`the stamped imprint is ${DIGESTS[miAlg] ?? miAlg}, not sha256`, facts)
    if (!hashed.equals(digest)) return no('the token stamps a different digest: it is not a time-stamp of this checkpoint', facts)

    // SignerInfo
    const si = kids(buf, expectTag(signerInfos[0], 0x30, 'SignerInfo'))
    const digestAlg = DIGESTS[oid(buf, kids(buf, expectTag(si[2], 0x30, 'digestAlgorithm'))[0]!)]
    if (!digestAlg) return no('the signer digest algorithm is not SHA-256/384/512 (SHA-1 and others are refused)', facts)
    const attrsTlv = expectTag(si[3], 0xa0, 'signedAttrs')
    const sigAlgOid = oid(buf, kids(buf, expectTag(si[4], 0x30, 'signatureAlgorithm'))[0]!)
    const signature = bytes(buf, expectTag(si[5], 0x04, 'signature'))
    const sigAlg = SIGS[sigAlgOid]
    if (!sigAlg) return no(`unsupported signature algorithm ${sigAlgOid} (RSA PKCS#1 v1.5 and ECDSA only)`, facts)
    if (sigAlg.hash && sigAlg.hash !== digestAlg) return no('the signature algorithm names a different hash than the digest algorithm', facts)

    // Signed attributes
    const attrs = new Map<string, Tlv[]>()
    for (const a of kids(buf, attrsTlv)) {
      const [t, vals] = kids(buf, expectTag(a, 0x30, 'Attribute'))
      attrs.set(oid(buf, t!), kids(buf, expectTag(vals, 0x31, 'attrValues')))
    }
    const ct = attrs.get(OID.contentType)?.[0]
    if (!ct || oid(buf, ct) !== OID.tstInfo) return no('the signed contentType attribute is not id-ct-TSTInfo', facts)
    const md = attrs.get(OID.messageDigest)?.[0]
    if (!md || !bytes(buf, expectTag(md, 0x04, 'messageDigest')).equals(createHash(digestAlg).update(tstBytes).digest())) {
      return no('the signed messageDigest does not match the TSTInfo (the stamped content was altered)', facts)
    }
    let certHash: { alg: string; hash: Buffer } | undefined
    const v1 = attrs.get(OID.signingCertificate)?.[0]
    const v2 = attrs.get(OID.signingCertificateV2)?.[0]
    if (v2) {
      const id = kids(buf, kids(buf, kids(buf, v2)[0]!)[0]!)
      const hasAlg = id[0]!.tag === 0x30
      const alg = hasAlg ? DIGESTS[oid(buf, kids(buf, id[0]!)[0]!)] : 'sha256'
      if (!alg) return no('SigningCertificateV2 names an unsupported hash', facts)
      certHash = { alg, hash: bytes(buf, expectTag(id[hasAlg ? 1 : 0], 0x04, 'certHash')) }
    } else if (v1) {
      const id = kids(buf, kids(buf, kids(buf, v1)[0]!)[0]!)
      certHash = { alg: 'sha1', hash: bytes(buf, expectTag(id[0], 0x04, 'certHash')) }
    }
    if (!certHash) return no('the token does not name its TSA certificate (SigningCertificate / SigningCertificateV2 is required)', facts)

    // The TSA certificate: named by hash, and trusted (pinned, or issued directly by a supplied root).
    const pinned = certs(trust.tsa_certs)
    const roots = certs(trust.tsa_roots)
    const named = [...pinned, ...embedded].find(c => createHash(certHash!.alg).update(c.raw).digest().equals(certHash!.hash))
    if (!named) return no('the TSA certificate the token names is neither pinned nor embedded in it', facts)
    let via: 'pinned' | 'root' | undefined
    if (pinned.some(p => p.raw.equals(named.raw))) via = 'pinned'
    else if (roots.some(r => named.checkIssued(r) && named.verify(r.publicKey) && validAt(r, gen_time))) via = 'root'
    if (!via) return no(`the TSA certificate (${named.subject.replace(/\n/g, ', ')}) is not trusted: pin it (tsa_certs) or supply the root that issued it (tsa_roots)`, facts)
    if (!ekuOf(named).includes(OID.timeStamping)) return no('the TSA certificate lacks the timeStamping extended key usage', facts)
    if (!validAt(named, gen_time)) return no(`the TSA certificate was not valid at genTime ${gen_time}`, facts)

    // The signature over the DER SET OF signed attributes (the [0] IMPLICIT tag re-tagged as SET, RFC 5652 §5.4).
    const signedAttrs = Buffer.from(whole(buf, attrsTlv))
    signedAttrs[0] = 0x31
    const ok = sigAlg.kind === 'rsa'
      ? cryptoVerify(digestAlg, signedAttrs, { key: named.publicKey, padding: constants.RSA_PKCS1_PADDING }, signature)
      : cryptoVerify(digestAlg, signedAttrs, named.publicKey, signature)
    if (!ok) return no('the TSA signature does not verify: the token was altered, or signed by another key', facts)
    return { ok: true, ...facts, tsa: named.subject.replace(/\n/g, ', '), via }
  } catch (e) {
    return no(`the token does not parse: ${(e as Error).message}`)
  }
}

/** Verify an RFC 3161 token as a time-stamp of this checkpoint (its imprint is checkpointDigest(cp)). */
export function verifyCheckpointTimestamp(cp: Checkpoint, token: Buffer | string, trust: TimestampTrust): TimestampCheck {
  return verifyTimestampToken(token, checkpointDigest(cp), trust)
}
