# A reader of the receipts ledger in Python, standard library only. prototype; no measured accuracy.
# SPDX-License-Identifier: Apache-2.0
"""
Reads a receipts ledger (one JSON entry per line, hash-chained, optionally Ed25519-signed, with its head record beside it) and
says what `riposte-ledger verify` says, with the same exit codes. Written from packages/receipts/src/ledger.ts, head-record.ts
and ledger-command.ts (and the engine's strict reader, which every line goes through; see strict.py).

    python3 conformance/engine_py/record/ledger.py verify <ledger.jsonl> [--key <public.pem>] [--require-signed] [--head <hash>] [--no-sidecar]
    python3 conformance/engine_py/record/ledger.py summary <ledger.jsonl> [--no-sidecar]
    python3 conformance/engine_py/record/ledger.py fingerprint <key.pem> [--short]
    python3 conformance/engine_py/record/ledger.py verify-signature <envelope.json | bundle.json> [--trusted-key <public.pem | 64-hex>]

Exit (verify): 0 verified · 1 not verified (a broken chain, a line the strict reader refuses, a signature that does not verify or
is not the --key's, a cut or rewrite the head record shows, no head record without --no-sidecar, a --head not in the chain, a
torn tail) · 3 a usage error, a file that cannot be read, a line before the last that is not JSON, or what this reader does not
do (named). The signatures are verified here, in pure Python (ed25519.py, RFC 8032).
"""

import os
import re
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import ed25519  # noqa: E402
import strict as S  # noqa: E402
from strict import UNDEFINED, get, js_str, js_truthy  # noqa: E402

GENESIS = "0" * 64
PROG = "ledger.py"
USAGE = "\n".join([
    "python3 conformance/engine_py/record/ledger.py verify <ledger.jsonl> [--key <public.pem>] [--require-signed] [--head <hash>] [--no-sidecar]",
    "python3 conformance/engine_py/record/ledger.py summary <ledger.jsonl> [--no-sidecar]",
    "python3 conformance/engine_py/record/ledger.py fingerprint <key.pem> [--short]",
    "python3 conformance/engine_py/record/ledger.py verify-signature <envelope.json | proof.json> [--trusted-key <public.pem | 64-hex fingerprint>]",
])
HELP = USAGE + """

A reader: it never writes to a ledger. It reads each line strictly, as the engine reads a replay bundle, walks the hash chain,
verifies every Ed25519 signature itself (pure Python, RFC 8032), and reads the head record beside the file
(<ledger>.head.json: entry count, head hash, byte length). Its first lines and exit codes are riposte-ledger verify's.
Not here: rule, sign and case (they write), and verify --proof (the binding of a proof to its receipt).
Exit (verify): 0 verified · 1 not verified · 3 a usage error, a file that cannot be read, a line before the last that is
not JSON, or something this reader does not do (named)."""


# ---------------------------------------------------------------------------------------------------------------------
# ledger.ts


def entry_hash(e):
    """sha256 over canonical JSON of {seq, kind, at, body, prev_hash}, a key the entry lacks left out (undefined)."""
    o = {}
    for k in ("seq", "kind", "at", "body", "prev_hash"):
        v = get(e, k)
        if v is not UNDEFINED:
            o[k] = v
    return S.sha256_text(S.canonicalize(o))


def key_fingerprint(pem):
    return ed25519.key_fingerprint(pem)


def read_ledger_line(text, entry, line):
    """readLedgerLine: (entry, None) when the line reads one way; (loose entry, refusal) when JSON.parse reads it and the strict
    reader refuses it; None when it is not JSON at all."""
    try:
        return S.parse_json_strict(text, "line %d" % line), None
    except S.NotJson:
        return None
    except S.HashInputRefused as e:
        try:
            loose = S.json_parse(text)
        except ValueError:
            return None
        dup = S.duplicate_key_path(text)
        if dup:
            detail = ("line %d: the key %s appears twice in one object (at %s). JSON keeps the last, so the entry's hash and signature "
                      "cover that value, while a reader that keeps the first sees the other. The receipts store writes every key once, so "
                      "something else wrote this line" % (line, S.js_string(dup[1]), dup[0]))
        else:
            detail = e.message
        return loose, {"entry": entry, "line": line, "path": dup[0] if dup else e.where,
                       "reason": "entry %d cannot be read one way: %s" % (entry, detail)}


class LedgerReadError(Exception):
    pass


def _read_whole_lines(lines, collect):
    entries, refused = [], None
    for i, ln in enumerate(lines):
        r = read_ledger_line(ln, i, i + 1)
        if r is None:
            raise LedgerReadError("line %d is not JSON" % (i + 1))
        if r[1] is not None:
            if not collect:
                raise LedgerReadError(r[1]["reason"])
            if refused is None:
                refused = r[1]
        entries.append(r[0])
    return entries, refused


def parse_ledger_tolerant(text, collect=False):
    """parseLedgerTolerant: {entries, torn?, no_final_newline?, refused?}; LedgerReadError for a line before the last that is not
    JSON (and, unless collect, for a line the strict reader refuses)."""
    lines = text.split("\n")
    last = len(lines) - 1
    while last >= 0 and not S.js_trim(lines[last]):
        last -= 1
    if last < 0:
        return {"entries": []}
    entries, refused = _read_whole_lines([ln for ln in lines[:last] if S.js_trim(ln)], collect)
    tail = lines[last]
    newline = last < len(lines) - 1
    t = read_ledger_line(tail, len(entries), len(entries) + 1)
    out = {"entries": entries}
    if t is None:
        torn = {"bytes": S.byte_length(tail) + (1 if newline else 0), "after_line": len(entries)}
        if newline:
            torn["ends_in_newline"] = True
        out["torn"] = torn
        if refused:
            out["refused"] = refused
        return out
    if t[1] is not None:
        if not collect:
            raise LedgerReadError(t[1]["reason"])
        if refused is None:
            refused = t[1]
    entries.append(t[0])
    if not newline:
        out["no_final_newline"] = True
    if refused:
        out["refused"] = refused
    return out


def _signature_check(e):
    """(ok, fingerprint) for an entry's signature, as verifyChain reads it (any failure to read is a signature that fails)."""
    sig = get(e, "signature")
    h = get(e, "hash")
    pem = get(sig, "public_key") if isinstance(sig, dict) else UNDEFINED
    sg = get(sig, "sig") if isinstance(sig, dict) else UNDEFINED
    if not isinstance(h, str) or not isinstance(pem, str) or not isinstance(sg, str):
        return False, ""
    try:
        ok = ed25519.verify_pem(pem, h.encode("utf-8", "surrogatepass"), sg)
        if not ok:
            return False, ""
        return True, key_fingerprint(pem)
    except ed25519.KeyError_:
        return False, ""


def verify_chain(entries, policy=None, refused=None):
    """verifyChain: the chain, the signatures and the anchor answered apart; the first failure in entry order named."""
    policy = policy or {}
    signed = unsigned = 0
    signers = []
    expected = None
    if policy.get("publicKey"):
        try:
            expected = key_fingerprint(policy["publicKey"])
        except ed25519.KeyError_:
            out = {"ok": False, "chain_ok": False, "signatures_ok": False}
            if policy.get("head"):
                out["anchor_ok"] = False
            out.update({"length": len(entries), "head": GENESIS, "reason": "the expected public key could not be read",
                        "signed": 0, "unsigned": 0, "signers": []})
            return out
    chain_at = sig_at = None
    head = prev = GENESIS
    anchored = not policy.get("head")
    repairs = []
    for i, e in enumerate(entries):
        if e is None:
            # JSON null as a line: not an entry; the chain breaks here, in the Node verifier's words (since 2026-10-20)
            if chain_at is None:
                chain_at = (i, "entry %d is not a ledger entry (the line is JSON null)" % i)
            prev = UNDEFINED
            unsigned += 1
            continue
        seq, ph, hh = get(e, "seq"), get(e, "prev_hash"), get(e, "hash")
        if chain_at is None:
            if refused is not None and refused["entry"] == i:
                chain_at = (i, refused["reason"])
            elif not S.js_eq(seq, float(i)):
                chain_at = (i, "entry %d has seq %s (reordered or removed entries)" % (i, js_str(seq)))
            elif not S.js_eq(ph, prev):
                chain_at = (i, "entry %d does not follow entry %d (chain broken)" % (i, i - 1))
            elif not S.js_eq(entry_hash(e), hh):
                chain_at = (i, "entry %d was altered after it was written" % i)
            else:
                head = hh
        prev = hh
        if js_truthy(get(e, "signature")):
            ok, fp = _signature_check(e)
            if not ok:
                if sig_at is None:
                    sig_at = (i, "entry %d signature does not verify" % i)
            else:
                if fp not in signers:
                    signers.append(fp)
                signed += 1
                if expected and fp != expected and sig_at is None:
                    sig_at = (i, "entry %d is signed by key %s, not the expected %s (re-signed by someone else?)" % (i, fp, expected))
        else:
            unsigned += 1
            if policy.get("requireSigned"):
                if sig_at is None:
                    sig_at = (i, "entry %d is not signed (signatures required)" % i)
            elif expected:
                if sig_at is None:
                    sig_at = (i, "entry %d is not signed, and a pinned key needs every entry signed by it (an unsigned entry could have "
                                 "been written by anyone)" % i)
        if policy.get("head") and S.js_eq(hh, policy["head"]) and (chain_at is None or chain_at[0] > i):
            anchored = True
        b = get(e, "body")
        if chain_at is None and S.js_eq(get(e, "kind"), "note") and isinstance(b, (dict, list)) and S.js_eq(get(b, "event"), "ledger.torn_tail_quarantined"):
            cut = get(b, "cut_entry")
            rep = {"seq": i, "bytes": S.js_number_of(get(b, "bytes")), "sha256": js_str(get(b, "sha256")),
                   "quarantined_to": js_str(get(b, "quarantined_to")),
                   "after_seq": get(b, "after_seq") if S.is_num(get(b, "after_seq")) else None}
            if isinstance(cut, (dict, list)) and S.is_num(get(cut, "seq")) and isinstance(get(cut, "hash"), str):
                rep["cut_entry"] = {"seq": get(cut, "seq"), "hash": get(cut, "hash")}
            repairs.append(rep)
    first = chain_at if chain_at is not None and (sig_at is None or chain_at[0] <= sig_at[0]) else sig_at
    anchor_reason = None if anchored else ("the anchored hash %s is not in this chain (rewritten or truncated since it was recorded)"
                                           % S.ellipsis16(policy["head"]))
    base = {"chain_ok": chain_at is None, "signatures_ok": sig_at is None}
    if policy.get("head"):
        base["anchor_ok"] = anchored
    base.update({"length": len(entries), "head": head, "signed": signed, "unsigned": unsigned, "signers": list(signers)})
    if repairs:
        base["repairs"] = repairs
    if first:
        out = {"ok": False}
        out.update(base)
        out["broken_at"] = first[0]
        out["reason"] = first[1]
        return out
    if anchor_reason:
        out = {"ok": False}
        out.update(base)
        out["reason"] = anchor_reason
        return out
    out = {"ok": True}
    out.update(base)
    return out


# ---------------------------------------------------------------------------------------------------------------------
# head-record.ts


def ledger_layout(text):
    """ledgerLayout: where each entry's line ends, in bytes, and whether the lines end in CR LF."""
    ends = []
    crlf = False
    offset = 0
    for ln in text.split("\n"):
        n = S.byte_length(ln)
        if S.js_trim(ln):
            ends.append(offset + n + 1)
            if ln.endswith("\r"):
                crlf = True
        offset += n + 1
    return {"bytes_through": (lambda count: 0 if count == 0 else (ends[count - 1] if count - 1 < len(ends) else None)), "crlf": crlf}


def head_record_path_of(ledger_path):
    return ledger_path + ".head.json"


ANCHOR = "pin --head <hash>, a head you recorded somewhere you control"
_HEX64 = re.compile(r"[0-9a-f]{64}")


def check_head_record(entries, file, text, skipped=False, required=False, layout=None):
    """checkHeadRecord: agrees, behind, absent, skipped, cut, rewritten or unreadable, with its words."""
    if skipped:
        return {"file": file, "status": "skipped", "ok": True,
                "words": "head record not read (--no-sidecar); truncation cannot be detected without an anchor: %s" % ANCHOR}
    if text is None and required:
        return {"file": file, "status": "absent", "ok": False,
                "words": ("no head record found (%s), so a cut at the end of the file, or the record deleted with it, would not show: verify "
                          "against a head you recorded elsewhere (--head <hash>) as well, and pass --no-sidecar to verify without the record "
                          "when this ledger never had one" % file)}
    if text is None:
        return {"file": file, "status": "absent", "ok": True,
                "words": "no head record found (%s); truncation cannot be detected without an anchor: %s" % (file, ANCHOR)}

    def unreadable(why):
        return {"file": file, "status": "unreadable", "ok": False,
                "words": "the head record %s %s, so it cannot say where the ledger ends; delete it, or pass --no-sidecar, to verify without it" % (file, why)}
    try:
        r = S.json_parse(text)
    except ValueError:
        return unreadable("does not parse")
    shape = "{ count, head, bytes }" if layout else "{ count, head }"
    count, head, rbytes = get(r, "count"), get(r, "head"), get(r, "bytes")
    if r is None or not isinstance(r, (dict, list)) or not S.is_safe_integer(count) or count < 0 or not isinstance(head, str) \
            or not _HEX64.fullmatch(head):
        return unreadable("is not %s" % shape)
    if layout and (not S.is_safe_integer(rbytes) or rbytes < 0):
        return unreadable("is not %s" % shape)
    rbytes = rbytes if layout else None
    count = int(count)
    said = {"file": file, "count": count, "head": head}
    if rbytes is not None:
        said["bytes"] = rbytes
    h16 = S.ellipsis16(head)
    if count == 0:
        if head != GENESIS:
            return unreadable("records no entries but a head that is not the empty chain's")
        if rbytes is not None and rbytes != 0:
            return unreadable("records no entries but %s bytes" % js_str(rbytes))
        z = {"file_bytes": 0} if rbytes is not None else {}
        if entries:
            out = dict(said)
            out.update(z)
            out.update({"status": "behind", "ok": True,
                        "words": "head record %s: no entries; the file holds %d, chained from the start (appended after the record was written)" % (file, len(entries))})
            return out
        out = dict(said)
        out.update(z)
        out.update({"status": "agrees", "ok": True, "words": "head record %s: no entries, as in the file" % file})
        return out
    n = len(entries)
    if n < count:
        k = count - n
        out = dict(said)
        out.update({"status": "cut", "ok": False,
                    "words": ("the file has %d %s; its head record (%s) says %d (head %s); the last %s removed or the file was rewritten; verify "
                              "against a head you recorded elsewhere (--head <hash>)" % (n, "entry" if n == 1 else "entries", file, count, h16,
                                                                                        "entry was" if k == 1 else "%d entries were" % k))})
        return out
    at = entries[count - 1]
    at_hash = get(at, "hash") if at is not None else UNDEFINED
    if not S.js_eq(at_hash, head):
        out = dict(said)
        out.update({"status": "rewritten", "ok": False,
                    "words": ("entry %d %s; the file was rewritten; verify against a head you recorded elsewhere (--head <hash>)" % (count - 1, (
                    "is not the one its head record (%s) names (the record says head %s; the file has %s there)" % (file, h16, S.ellipsis16(at_hash))
                    if isinstance(at_hash, str) else
                    "is not a ledger entry, so it is not the one its head record (%s) names (the record says head %s)" % (file, h16))))})
        return out
    found = layout["bytes_through"](count) if layout else None
    fb = {"file_bytes": found} if found is not None else {}
    if rbytes is not None and found is not None and found != rbytes:
        out = dict(said)
        out.update(fb)
        out.update({"status": "rewritten", "ok": False,
                    "words": ("the file holds %d bytes up to the end of entry %d; its head record (%s) says %s (head %s, the same entry): bytes were "
                              "added to or removed from the entries it covers, so the file was rewritten; verify against a head you recorded "
                              "elsewhere (--head <hash>)" % (found, count - 1, file, js_str(rbytes), h16))
                    + ("; its lines end in CR LF, and a line-ending conversion adds one byte per line" if layout["crlf"] else "")})
        return out
    if n > count:
        out = dict(said)
        out.update(fb)
        out.update({"status": "behind", "ok": True,
                    "words": "head record %s: %d entries, head %s; the file holds %d more, chained after it (appended after the record was written)" % (file, count, h16, n - count)})
        return out
    out = dict(said)
    out.update(fb)
    out.update({"status": "agrees", "ok": True, "words": "head record %s: %d entries, head %s, as in the file" % (file, count, h16)})
    return out


# ---------------------------------------------------------------------------------------------------------------------
# ledger-command.ts (the reading commands)


class ReadFailed(Exception):
    def __init__(self, message, code=None):
        Exception.__init__(self, message)
        self.message = message
        self.code = code


def read_ledger_text(path):
    """The bin's readFile: a file's bytes as UTF-8 text, refusing bytes that are not UTF-8 (readLedgerText); a BOM is kept."""
    try:
        b = S.read_bytes(path)
    except OSError as e:
        code = "ENOENT" if S.node_error(e).startswith("ENOENT") else ("EISDIR" if S.node_error(e).startswith("EISDIR") else "EIO")
        raise ReadFailed(S.node_error(e), code)
    at = S.invalid_utf8_offset(b)
    if at >= 0:
        raise ReadFailed("%s is not valid UTF-8 at byte %d: every file this command reads is UTF-8 (the receipts store writes nothing else), "
                         "and reading it would replace those bytes, so two different files would read the same" % (path, at), "ledger.not_utf8")
    return b.decode("utf-8")


def head_record_for(file, entries, skip, required=False, ledger_text=None, read_file=read_ledger_text):
    """headRecordFor: the head-record check, or {'error'} when the record exists and cannot be read (exit 3)."""
    name = re.split(r"[\\/]", head_record_path_of(file))[-1]
    if skip:
        return check_head_record(entries, name, None, skipped=True)
    try:
        rtext = read_file(head_record_path_of(file))
    except ReadFailed as e:
        if e.code in (None, "ENOENT", "ENOTDIR"):
            rtext = None
        else:
            return {"error": "cannot read the head record %s: %s (pass --no-sidecar to verify without it)" % (head_record_path_of(file), e.message)}
    if rtext is None:
        return check_head_record(entries, name, None, required=required)
    text = ledger_text
    if text is None:
        try:
            text = read_file(file)
        except ReadFailed as e:
            return {"error": "cannot read %s to compare it with its head record: %s" % (file, e.message)}
    return check_head_record(entries, name, rtext, required=required, layout=ledger_layout(text))


def public_of(pem):
    """publicOf: the public PEM and fingerprint of a PEM holding a public or a private Ed25519 key."""
    pub = ed25519.public_key_bytes(pem)
    import hashlib
    return {"public_key": ed25519.spki_pem(pub), "fingerprint": hashlib.sha256(ed25519.spki_der(pub)).hexdigest()}


def _result(code, out="", err=""):
    return {"code": code, "out": out, "err": err}


def _is_envelope(x):
    return isinstance(x, dict) and isinstance(get(x, "verdict"), dict) and isinstance(get(x, "signature"), str)


def _fingerprint_or_unknown(pem):
    try:
        return key_fingerprint(js_str(pem))
    except ed25519.KeyError_:
        return "?"


def _read_json_strict(file, read_file):
    try:
        text = read_file(file)
    except ReadFailed as e:
        return None, "cannot read %s: %s" % (file, e.message)
    try:
        return S.parse_json_strict(text, file), None
    except (S.HashInputRefused, S.NotJson) as e:
        return None, e.message


def verify_signature_command(file, rest, read_file):
    """riposte-ledger verify-signature: an envelope's Ed25519 signature over the canonical JSON of its verdict, offline."""
    def usage(msg):
        return _result(3, "", "%s\n%s\n" % (msg, USAGE))
    trusted_spec = None
    i = 0
    while i < len(rest):
        a = rest[i]
        if a != "--trusted-key":
            return usage("unknown option %s" % a)
        i += 1
        v = rest[i] if i < len(rest) else None
        if v is None or v.startswith("--"):
            return usage("--trusted-key needs a value: a public key PEM file, or the 64-hex fingerprint")
        trusted_spec = v
        i += 1
    js, err = _read_json_strict(file, read_file)
    if err is not None:
        return _result(3, "", "%s\n" % err)
    trusted = None
    if trusted_spec is not None:
        if _HEX64.fullmatch(trusted_spec):
            trusted = trusted_spec
        else:
            try:
                pem = read_file(trusted_spec)
            except ReadFailed as e:
                return _result(3, "", "--trusted-key: cannot read %s: %s (give a public key PEM file, or the 64-hex fingerprint)\n" % (trusted_spec, e.message))
            if "PRIVATE KEY" in pem:
                return _result(3, "", "--trusted-key is a private key: give the public key whose signature counts (never a private key)\n")
            try:
                trusted = key_fingerprint(pem)
            except ed25519.KeyError_ as e:
                return _result(3, "", "--trusted-key: %s is not a public key in PEM: %s\n" % (trusted_spec, e))
    if _is_envelope(js):
        env = js
    elif isinstance(js, dict) and _is_envelope(get(js, "verdict")):
        env = js["verdict"]
    elif isinstance(js, dict) and ((isinstance(get(js, "verdict"), dict) and isinstance(get(js["verdict"], "verdict_id"), str))
                                   or isinstance(get(js, "verdict_id"), str)):
        vid = js["verdict"]["verdict_id"] if isinstance(get(js, "verdict"), dict) else js["verdict_id"]
        return _result(1, S.to_json({"ok": False, "signature_ok": False, "verdict_id": vid, "reason": "not signed"}) + "\n",
                       "NOT VERIFIED: not signed: %s carries a verdict with no envelope { verdict, alg, public_key, signature }; riposte-ledger sign writes one\n" % file)
    else:
        return _result(3, "", "%s: not a signed envelope, a replay bundle carrying one, or a verdict\n" % file)
    issuer = _fingerprint_or_unknown(get(env, "public_key"))
    verdict_id = get(env["verdict"], "verdict_id") if isinstance(get(env, "verdict"), dict) else UNDEFINED
    # verify's verifyEnvelope
    reason = None
    signature_ok = False
    if not S.js_eq(get(env, "alg"), "ed25519"):
        reason = "unsupported alg: %s" % js_str(get(env, "alg"))
    else:
        try:
            pem = get(env, "public_key")
            if not isinstance(pem, str):
                raise ed25519.KeyError_("the public key is not a string")
            signature_ok = ed25519.verify_pem(pem, S.canonicalize(env["verdict"]).encode("utf-8", "surrogatepass"), env["signature"])
            if not signature_ok:
                reason = "signature does not verify — the verdict body was altered, or the key does not match"
        except ed25519.KeyError_ as e:
            reason = "signature verification errored: %s" % e
    if not signature_ok:
        extra = "%s\n" % reason if reason and not reason.startswith("signature does not verify") else ""
        return _result(1, S.to_json({"ok": False, "signature_ok": False, "verdict_id": verdict_id, "issuer_fingerprint": issuer,
                                     "reason": "the signature does not verify: the verdict body was altered, or the key does not match"}) + "\n",
                       "NOT VERIFIED: the signature does not verify: the verdict body was altered, or the key does not match\n" + extra)
    if trusted is not None and trusted != issuer:
        return _result(1, S.to_json({"ok": False, "signature_ok": True, "verdict_id": verdict_id, "issuer_fingerprint": issuer, "trusted": False}) + "\n",
                       "NOT VERIFIED: signed by %s, which is not the trusted key (%s); the signature verifies, but it proves only that the holder of that "
                       "other key issued the verdict\n" % (issuer, trusted))
    out = {"ok": True, "signature_ok": True, "verdict_id": verdict_id, "issuer_fingerprint": issuer}
    if trusted is not None:
        out["trusted"] = True
    return _result(0, S.to_json(out) + "\n",
                   "OK: the signature verifies%s; issuer fingerprint %s\nnote: this checks the signature, not the verdict: riposte-replay or verify "
                   "replay re-performs it\n" % (", by the trusted key" if trusted is not None else "", issuer))


def ledger_cli(argv, read_file=read_ledger_text):
    """The reading half of ledgerCli: verify, summary, fingerprint and verify-signature. Returns {code, out, err}."""
    cmd = argv[0] if argv else None
    file = argv[1] if len(argv) > 1 else None
    rest = argv[2:]

    def usage(msg=None):
        return _result(3 if msg else 0, "", "%s%s\n" % ("%s\n" % msg if msg else "", USAGE if msg else HELP))
    if not cmd or cmd in ("--help", "-h") or file in ("--help", "-h"):
        return usage()
    if not file:
        return usage("%s needs a file" % cmd)
    if cmd in ("rule", "sign", "case"):
        return _result(3, "", "%s writes; this reader only reads (node packages/receipts/dist/ledger-cli.js %s ...)\n" % (cmd, cmd))
    if cmd == "verify-signature":
        return verify_signature_command(file, rest, read_file)
    try:
        text = read_file(file)
    except ReadFailed as e:
        return _result(3, "", "cannot read %s: %s\n" % (file, e.message))

    if cmd == "fingerprint":
        for a in rest:
            if a != "--short":
                return usage("unknown option %s" % a)
        short = "--short" in rest
        try:
            p = public_of(text)
        except ed25519.KeyError_ as e:
            return _result(3, "", "not a key: %s\n" % e)
        shown = dict(p)
        if short:
            shown["short"] = p["fingerprint"][:16]
        return _result(0, S.to_json(shown) + "\n", "fingerprint %s%s\n" % (
            p["fingerprint"], "\nshort %s (for display only: pin the full fingerprint)" % p["fingerprint"][:16] if short else ""))

    try:
        parsed = parse_ledger_tolerant(text, collect=True)
    except LedgerReadError as e:
        return _result(3, "", "%s: %s\n" % (file, e))
    entries = parsed["entries"]
    torn = parsed.get("torn")
    no_final_newline = parsed.get("no_final_newline")
    refused = parsed.get("refused")
    if torn and cmd != "verify":
        return _result(3, "", "%s: line %d is not JSON (a torn tail of %d bytes: riposte-ledger verify says more)\n" % (file, len(entries) + 1, torn["bytes"]))

    if cmd == "summary":
        for a in rest:
            if a != "--no-sidecar":
                return usage("unknown option %s" % a)
        hr = head_record_for(file, entries, "--no-sidecar" in rest, False, text, read_file)
        if "error" in hr:
            return _result(3, "", "%s\n" % hr["error"])
        kinds = {}
        for e in entries:
            k = js_str(get(e, "kind") if e is not None else UNDEFINED)
            kinds[k] = kinds.get(k, 0) + 1
        c = verify_chain(entries, {}, refused)

        def at_of(e):
            if e is None:
                return None
            if isinstance(e, (str, list)):
                return UNDEFINED  # String.prototype.at and Array.prototype.at: a function, which JSON leaves out
            v = get(e, "at")
            return None if v is UNDEFINED else v
        s = {"entries": len(entries), "kinds": kinds, "first_at": at_of(entries[0]) if entries else None,
             "last_at": at_of(entries[-1]) if entries else None, "head": c["head"], "chain_ok": c["chain_ok"],
             "signatures_ok": c["signatures_ok"], "signed": c["signed"], "unsigned": c["unsigned"], "signers": c["signers"]}
        if c.get("reason"):
            s["reason"] = c["reason"]
        s["head_record"] = hr
        return _result(0 if (c["ok"] and hr["ok"]) else 1, S.to_json(s) + "\n", "" if hr["ok"] else "%s\n" % hr["words"])

    if cmd != "verify":
        return usage("unknown command %s" % cmd)
    policy = {}
    want = None
    proof_file = None
    no_sidecar = False
    i = 0
    while i < len(rest):
        a = rest[i]
        if a == "--require-signed":
            policy["requireSigned"] = True
        elif a == "--no-sidecar":
            no_sidecar = True
        elif a in ("--key", "--head", "--proof", "--entry"):
            i += 1
            v = rest[i] if i < len(rest) else None
            if not v:
                return usage("%s needs a value" % a)
            if a == "--head":
                policy["head"] = v
            elif a == "--proof":
                proof_file = v
            elif a == "--entry":
                want = v
            else:
                try:
                    policy["publicKey"] = public_of(read_file(v))["public_key"]
                except ReadFailed as e:
                    return _result(3, "", "cannot use key %s: %s\n" % (v, e.message))
                except ed25519.KeyError_ as e:
                    return _result(3, "", "cannot use key %s: %s\n" % (v, e))
        else:
            return usage("unknown option %s" % a)
        i += 1
    if want is not None and proof_file is None:
        return usage("--entry names the receipt a --proof binds to: give --proof too")
    if proof_file is not None:
        return _result(3, "", "--proof is outside what this reader checks: the binding of a proof to its ap_gate receipt is "
                              "riposte-ledger verify --proof's (node packages/receipts/dist/ledger-cli.js verify %s --proof %s)\n" % (file, proof_file))
    c = verify_chain(entries, policy, refused)
    hr = head_record_for(file, entries, no_sidecar, True, text, read_file)
    if "error" in hr:
        return _result(3, "", "%s\n" % hr["error"])
    anchored = bool(policy.get("publicKey") or policy.get("requireSigned") or policy.get("head"))
    warn = "" if anchored else ("note: no trust anchor given (--key, --require-signed or --head). This proves the file is internally consistent, "
                                "not that nobody rewrote all of it.\n")
    counts = "%d entries, head %s · %d signed (%s) · %d unsigned" % (c["length"], S.ellipsis16(c["head"]), c["signed"],
                                                                    ", ".join(c["signers"]) or "no keys", c["unsigned"])
    torn_cut = " (the unfinished line at the end of the file may be that entry: see TORN TAIL)" if torn and hr["status"] == "cut" else ""
    sig_note = ("signatures_ok is true because each signature covers the hash its entry records, not the entry's body or its place in the chain: "
                "with the chain broken it does not vouch for this file. Read ok, which is false\n") if c["signatures_ok"] else ""
    if not c["chain_ok"]:
        line = "BROKEN: chain\nBROKEN at entry %s: %s\n%s" % (js_str(c.get("broken_at", "-")), c["reason"], sig_note)
    elif not c["ok"]:
        line = "NOT VERIFIED: %s; the hash chain itself holds (%s)\n" % (c["reason"], counts)
    elif not hr["ok"]:
        st = hr["status"]
        line = "%s: %s%s\n" % ("BROKEN at the tail" if st == "cut" else "BROKEN" if st == "rewritten" else "NOT VERIFIED", hr["words"], torn_cut)
        line += "the entries in the file chain correctly on their own (%s); %s\n" % (counts, (
            "that does not show nothing was removed after them" if st == "cut" else
            "a consistent chain is what a rewrite by the key holder looks like" if st == "rewritten" else
            "without a readable head record, a cut at the tail would not show"))
    elif torn:
        line = "NOT VERIFIED: torn tail. %s; the entries before it chain correctly on their own (%s)\n" % (
            "The file's last line is not a whole entry" if torn.get("ends_in_newline") else "The file ends in an unfinished line", counts)
    else:
        line = "OK: %s\n" % counts
    if not hr["ok"]:
        hr_line = "" if c["ok"] else "head record: %s\n" % hr["words"]
    elif hr["status"] in ("agrees", "behind"):
        hr_line = "%s%s\n" % (hr["words"], "" if policy.get("head") else (
            ". It is written beside the file by the same process, so it catches a cut that left it behind, not one that rewrote it too: "
            "--head <hash>, recorded somewhere you control, is the anchor"))
    else:
        if policy.get("head"):
            hr_line = "note: %s; the --head you gave is the anchor\n" % (
                "head record not read (--no-sidecar)" if hr["status"] == "skipped" else "no head record found (%s)" % hr["file"])
        else:
            hr_line = "note: %s\n" % hr["words"]
    next_step = ("Next: truncate the file after entry %d and verify again, or restore it from a copy that matches its head record "
                 "(<ledger>.head.json)" % (torn["after_line"] - 1)) if torn else ""
    if not torn:
        torn_line = ""
    elif torn.get("ends_in_newline"):
        torn_line = ("TORN TAIL: the file's last line is not a whole entry (%d bytes after entry %d), and a newline follows it, which a crash "
                     "mid-append does not leave: a cut or an edit. The entries before it are checked above. %s.\n" % (torn["bytes"], torn["after_line"] - 1, next_step))
    else:
        torn_line = ("TORN TAIL: the file ends in an unfinished line (%d bytes after entry %d): a crash mid-append. The entries before it are "
                     "checked above; the receipts file store moves those bytes to <ledger>.torn-<stamp> and records it when it next opens this "
                     "ledger. %s, or let the store do it.\n" % (torn["bytes"], torn["after_line"] - 1, next_step))
    newline_line = ("note: the last line has no newline after it. Every entry is whole and was checked. The receipts file store reads the bytes "
                    "after the last newline as an unfinished line and moves them aside when it next opens this ledger, so add the newline "
                    "first (printf '\\n' >> %s)\n" % file) if no_final_newline else ""
    repair_lines = ""
    for r in c.get("repairs", []):
        repair_lines += "quarantined: entry %d records a torn tail of %s bytes (sha256 %s) moved to %s%s" % (
            r["seq"], js_str(r["bytes"]), S.ellipsis16(r["sha256"]), r["quarantined_to"],
            " after entry %s" % js_str(r["after_seq"]) if r["after_seq"] is not None else "")
        if r.get("cut_entry"):
            repair_lines += ("; the cut went through entry %s (hash %s), which had been written: that entry is lost from this file (a disk fault "
                             "or an edit, not a crash)" % (js_str(r["cut_entry"]["seq"]), S.ellipsis16(r["cut_entry"]["hash"])))
        repair_lines += "\n"
    ok = c["ok"] and hr["ok"] and not torn
    if not c["ok"]:
        reason = c["reason"]
    elif not hr["ok"]:
        reason = hr["words"]
    elif torn:
        reason = ("torn tail: the last line is not a whole entry (%d bytes after entry %d, a newline after it): a cut or an edit, not a crash "
                  "mid-append" % (torn["bytes"], torn["after_line"] - 1)) if torn.get("ends_in_newline") else (
            "torn tail: the file ends in an unfinished line (%d bytes after entry %d), a crash mid-append" % (torn["bytes"], torn["after_line"] - 1))
    else:
        reason = None
    out = dict(c)
    out["ok"] = ok
    if reason is not None:
        out["reason"] = reason
    out["head_record"] = hr
    if torn:
        out["torn_tail"] = torn
    if no_final_newline:
        out["no_final_newline"] = True
    return _result(0 if ok else 1, S.to_json(out) + "\n", line + hr_line + newline_line + torn_line + repair_lines + warn)


# ---------------------------------------------------------------------------------------------------------------------
# For the frag reader: the record as frag.ts reads it (record.ts readRecord)


def read_record(file, issuer_pem=None):
    """readRecord: {entries, chain, head, torn?} or {'error'}. The text is read as Node's readFileSync(file, 'utf8') reads it
    (bytes that are not UTF-8 replaced), and the head record's byte count is not compared, as frag open does not compare it."""
    if not os.path.exists(file):
        return {"error": "%s: no such record" % file}
    with open(file, "rb") as fh:
        text = fh.read().decode("utf-8", "replace")
    try:
        parsed = parse_ledger_tolerant(text)
    except LedgerReadError as e:
        return {"error": "%s: not a receipts ledger (%s)" % (file, e)}
    entries = parsed["entries"]
    policy = {"requireSigned": True}
    if issuer_pem:
        policy["publicKey"] = issuer_pem
    chain = verify_chain(entries, policy)
    side = head_record_path_of(file)
    side_text = None
    if os.path.exists(side):
        with open(side, "rb") as fh:
            side_text = fh.read().decode("utf-8", "replace")
    head = check_head_record(entries, re.split(r"[\\/]", side)[-1], side_text, required=True)
    out = {"entries": entries, "chain": chain, "head": head}
    if parsed.get("torn"):
        out["torn"] = {"bytes": parsed["torn"]["bytes"]}
    return out


def main(argv, out=None, err=None):
    out = out or sys.stdout
    err = err or sys.stderr
    r = ledger_cli(argv)
    out.write(r["out"])
    err.write(r["err"])
    return r["code"]


if __name__ == "__main__":
    S.utf8_streams()
    sys.exit(main(sys.argv[1:]))
