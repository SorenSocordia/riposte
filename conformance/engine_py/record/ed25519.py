# Ed25519 verification in pure Python, standard library only, for the record readers beside this file.
# SPDX-License-Identifier: Apache-2.0 AND BSD-2-Clause
#
# NOTICE: the curve arithmetic below (point_add, point_mul, point_equal, recover_x, point_compress, point_decompress,
# secret_expand, secret_to_public, sign, verify) is the Python illustration of RFC 8032, "Edwards-Curve Digital Signature
# Algorithm (EdDSA)", section 6 ("Ed25519 Python Illustration"), adapted: x2 is reduced mod p in recover_x, and verify returns
# False on a wrong length instead of raising. Its decoding and checks follow sections 5.1.3 (decoding), 5.1.5 (key generation)
# and 5.1.7 (verify). The RFC's code is a Code Component under the IETF Trust's Legal Provisions, licensed under the
# Simplified BSD License, whose text follows:
#
#   Copyright (c) 2017 IETF Trust and the persons identified as authors of the code. All rights reserved.
#
#   Redistribution and use in source and binary forms, with or without modification, are permitted provided that the
#   following conditions are met:
#   - Redistributions of source code must retain the above copyright notice, this list of conditions and the following
#     disclaimer.
#   - Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following
#     disclaimer in the documentation and/or other materials provided with the distribution.
#   - Neither the name of Internet Society, IETF or IETF Trust, nor the names of specific contributors, may be used to endorse
#     or promote products derived from this software without specific prior written permission.
#
#   THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES,
#   INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
#   DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
#   EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF
#   USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT
#   LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED
#   OF THE POSSIBILITY OF SUCH DAMAGE.
#
# The key handling after the curve code (PEM, SubjectPublicKeyInfo, PKCS #8, the fingerprint, Node's lenient base64) is this
# folder's own, written to read keys and signatures the way the Node tools read them.
"""
Ed25519 for the record readers: verify a signature, read an Ed25519 public or private key in PEM, and take a key's fingerprint
(sha256 over its DER-encoded SubjectPublicKeyInfo, 64 hex: what the receipts ledger prints and pins). It is slow (a few
milliseconds a signature) and not constant-time; it only ever handles public data and a test's throwaway keys.

Where it can differ from Node's crypto.verify (OpenSSL): this checks [s]B = R + [k]A on decoded points, as RFC 8032 section
5.1.7 states it, while OpenSSL recomputes R and compares its encoding. The two agree on every signature a signer produced; they
can disagree on crafted encodings (a small-order key or R), which no real signature uses. Both refuse s >= L and a y >= p.
"""

import base64
import binascii
import hashlib
import re

# ---------------------------------------------------------------------------------------------------------------------
# RFC 8032, section 6 (adapted as the NOTICE above says)


def sha512(s):
    return hashlib.sha512(s).digest()


p = 2 ** 255 - 19


def modp_inv(x):
    return pow(x, p - 2, p)


d = -121665 * modp_inv(121666) % p
q = 2 ** 252 + 27742317777372353535851937790883648493


def sha512_modq(s):
    return int.from_bytes(sha512(s), "little") % q


def point_add(P, Q):
    A, B = (P[1] - P[0]) * (Q[1] - Q[0]) % p, (P[1] + P[0]) * (Q[1] + Q[0]) % p
    C, D = 2 * P[3] * Q[3] * d % p, 2 * P[2] * Q[2] % p
    E, F, G, H = B - A, D - C, D + C, B + A
    return (E * F, G * H, F * G, E * H)


def point_mul(s, P):
    Q = (0, 1, 1, 0)
    while s > 0:
        if s & 1:
            Q = point_add(Q, P)
        P = point_add(P, P)
        s >>= 1
    return Q


def point_equal(P, Q):
    if (P[0] * Q[2] - Q[0] * P[2]) % p != 0:
        return False
    if (P[1] * Q[2] - Q[1] * P[2]) % p != 0:
        return False
    return True


modp_sqrt_m1 = pow(2, (p - 1) // 4, p)


def recover_x(y, sign):
    if y >= p:
        return None
    x2 = (y * y - 1) * modp_inv(d * y * y + 1) % p
    if x2 == 0:
        if sign:
            return None
        return 0
    x = pow(x2, (p + 3) // 8, p)
    if (x * x - x2) % p != 0:
        x = x * modp_sqrt_m1 % p
    if (x * x - x2) % p != 0:
        return None
    if (x & 1) != sign:
        x = p - x
    return x


g_y = 4 * modp_inv(5) % p
g_x = recover_x(g_y, 0)
G = (g_x, g_y, 1, g_x * g_y % p)


def point_compress(P):
    zinv = modp_inv(P[2])
    x = P[0] * zinv % p
    y = P[1] * zinv % p
    return int.to_bytes(y | ((x & 1) << 255), 32, "little")


def point_decompress(s):
    if len(s) != 32:
        return None
    y = int.from_bytes(s, "little")
    sign = y >> 255
    y &= (1 << 255) - 1
    x = recover_x(y, sign)
    if x is None:
        return None
    return (x, y, 1, x * y % p)


def secret_expand(secret):
    if len(secret) != 32:
        raise ValueError("an Ed25519 private key is 32 bytes")
    h = sha512(secret)
    a = int.from_bytes(h[:32], "little")
    a &= (1 << 254) - 8
    a |= (1 << 254)
    return (a, h[32:])


def secret_to_public(secret):
    a, _ = secret_expand(secret)
    return point_compress(point_mul(a, G))


def sign(secret, msg):
    """For tests only: sign `msg` (bytes) with a 32-byte seed."""
    a, prefix = secret_expand(secret)
    A = point_compress(point_mul(a, G))
    r = sha512_modq(prefix + msg)
    Rs = point_compress(point_mul(r, G))
    h = sha512_modq(Rs + A + msg)
    s = (r + h * a) % q
    return Rs + int.to_bytes(s, 32, "little")


def verify(public, msg, signature):
    """True when `signature` (64 bytes) is a valid Ed25519 signature of `msg` (bytes) by the 32-byte key `public`."""
    if len(public) != 32 or len(signature) != 64:
        return False
    A = point_decompress(public)
    if A is None:
        return False
    Rs = signature[:32]
    R = point_decompress(Rs)
    if R is None:
        return False
    s = int.from_bytes(signature[32:], "little")
    if s >= q:
        return False
    h = sha512_modq(Rs + public + msg)
    sB = point_mul(s, G)
    hA = point_mul(h, A)
    return point_equal(sB, point_add(R, hA))


# ---------------------------------------------------------------------------------------------------------------------
# Keys as the Node tools hand them over: PEM text, SubjectPublicKeyInfo (public) or PKCS #8 (private)

SPKI_PREFIX = bytes.fromhex("302a300506032b6570032100")
PKCS8_PREFIX = bytes.fromhex("302e020100300506032b657004220420")
_PEM = re.compile(r"-----BEGIN ([A-Z0-9 ]+)-----(.*?)-----END \1-----", re.S)


class KeyError_(Exception):
    """A key that cannot be read as an Ed25519 key in PEM."""


def _der_len(b, i):
    n = b[i]
    i += 1
    if n < 0x80:
        return n, i
    k = n & 0x7F
    if k == 0 or k > 4 or i + k > len(b):
        raise ValueError("bad length")
    return int.from_bytes(b[i:i + k], "big"), i + k


def _tlv(b, i):
    if i + 2 > len(b):
        raise ValueError("truncated")
    tag = b[i]
    n, j = _der_len(b, i + 1)
    if j + n > len(b):
        raise ValueError("truncated")
    return tag, b[j:j + n], j + n


def _algorithm_oid(der):
    """The algorithm OID (DER bytes) of a SubjectPublicKeyInfo or a PKCS #8 key, or None when it is neither."""
    try:
        tag, body, end = _tlv(der, 0)
        if tag != 0x30 or end != len(der):
            return None
        tag, first, i = _tlv(body, 0)
        if tag == 0x02:  # PKCS #8: version, then the algorithm
            tag, alg, i = _tlv(body, i)
        else:
            alg = first
        if tag != 0x30:
            return None
        tag, oid, _ = _tlv(alg, 0)
        return oid if tag == 0x06 else None
    except (ValueError, IndexError):
        return None


ED25519_OID = bytes.fromhex("2b6570")


def pem_blocks(text):
    """Every PEM block in `text`: (label, DER bytes); a block whose body is not base64 is left out."""
    out = []
    for m in _PEM.finditer(text):
        body = re.sub(r"\s+", "", m.group(2))
        try:
            out.append((m.group(1), base64.b64decode(body, validate=True)))
        except (binascii.Error, ValueError):
            continue
    return out


def public_key_bytes(pem):
    """The 32-byte Ed25519 public key a PEM holds: SPKI as is, or derived from a PKCS #8 private key (as Node's
    createPublicKey accepts a private key). Raises KeyError_ with a reason otherwise."""
    if not isinstance(pem, str):
        raise KeyError_("not a key in PEM form")
    blocks = pem_blocks(pem)
    if not blocks:
        raise KeyError_("not a key in PEM form")
    label, der = blocks[0]
    if label == "PUBLIC KEY":
        if len(der) == 44 and der.startswith(SPKI_PREFIX):
            return der[12:]
        oid = _algorithm_oid(der)
        raise KeyError_("a public key, but not Ed25519" if oid is not None else "not a public key this reader can parse")
    if label == "PRIVATE KEY":
        if der.startswith(PKCS8_PREFIX) and len(der) >= 48:
            return secret_to_public(der[16:48])
        if len(der) > 16 and der[0] == 0x30 and der[2:5] == bytes.fromhex("020101") and ED25519_OID in der[:16]:
            # PKCS #8 v2 (OneAsymmetricKey) with the public key appended: the seed is the first OCTET STRING inside
            i = der.find(bytes.fromhex("04220420"))
            if i > 0 and i + 36 <= len(der):
                return secret_to_public(der[i + 4:i + 36])
        oid = _algorithm_oid(der)
        raise KeyError_("a private key, but not Ed25519" if oid is not None else "not a private key this reader can parse")
    raise KeyError_("a PEM block labelled %s, not a key this reader reads" % label)


def is_private_pem(pem):
    return isinstance(pem, str) and any(label == "PRIVATE KEY" for label, _ in pem_blocks(pem))


def spki_der(public):
    return SPKI_PREFIX + public


def spki_pem(public):
    """The public key as Node exports it: SPKI PEM, 64-character lines, a final newline."""
    b64 = base64.b64encode(spki_der(public)).decode("ascii")
    lines = [b64[i:i + 64] for i in range(0, len(b64), 64)]
    return "-----BEGIN PUBLIC KEY-----\n" + "\n".join(lines) + "\n-----END PUBLIC KEY-----\n"


def key_fingerprint(pem):
    """sha256 over the DER-encoded SubjectPublicKeyInfo, 64 hex (receipts keyFingerprint). Raises KeyError_."""
    return hashlib.sha256(spki_der(public_key_bytes(pem))).hexdigest()


_B64_KEEP = re.compile(r"[^A-Za-z0-9+/]")


def b64decode_lenient(text):
    """Buffer.from(text, 'base64') as Node reads it: the URL-safe letters accepted, other characters skipped, decoding stops at
    the first '=', and a trailing group of one character dropped."""
    if not isinstance(text, str):
        return b""
    t = text.replace("-", "+").replace("_", "/")
    t = t.split("=", 1)[0]
    t = _B64_KEEP.sub("", t)
    rem = len(t) % 4
    if rem == 1:
        t = t[:-1]
    elif rem:
        t += "=" * (4 - rem)
    try:
        return base64.b64decode(t)
    except (binascii.Error, ValueError):
        return b""


def verify_pem(pem, message, signature_b64):
    """crypto.verify(null, message, createPublicKey(pem), Buffer.from(sig, 'base64')): True, False, or KeyError_ raised when
    the key cannot be read (Node throws there too)."""
    return verify(public_key_bytes(pem), message, b64decode_lenient(signature_b64))
