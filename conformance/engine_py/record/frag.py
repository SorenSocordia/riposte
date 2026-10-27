# A reader of frag folders (riposte.frag/0.1.0) in Python, standard library only. prototype; no measured accuracy.
# SPDX-License-Identifier: Apache-2.0
"""
Opens a frag folder as `node packages/frag/dist/cli.js open` does, in its order and with its exit codes and first lines: the file
read strictly, its shape, the id over lock + claim + proof, the Ed25519 signature (verified here, pure Python), the cover
sentence re-derived, a verdict frag's bundle file, the record (frags.jsonl: its hash chain, every entry signed by the issuer's key,
its head record, the entry at record.seq), the pins recomputed over a tree at hand, and the claim. Written from
packages/frag/SPEC.md and src/{open,format,record,tree,claim}.ts.

    python3 conformance/engine_py/record/frag.py open <frag folder> [--tree <repository root>] [--record <frags.jsonl>] [--issuer <ISSUER.json | public key.pem>] [--json]

What this reader re-performs of a claim, and what it says it cannot tell:
  - a release (an engine label closed): re-performed. "This build" is the Python second engine (engine_py/engine.py), whose
    retained labels are the Node build's, 0.0.1 to 0.7.2; the changelog of the tree at hand must still carry the quoted sentence.
  - a verdict: replayed with the Python second engine when its ruleset is invoice@0.1.0; any other ruleset, or a signed
    envelope, is "can't tell here" (exit 2), never a guess.
  - a bench table: never re-emitted here (the bench tool does that: the frag names the command); "can't tell here" (exit 2).
The pins: the engine's sources, the AP pack and the legal rule (by folder), the two e-invoice rulesets (by file), the pilot tool,
the corpus and the prereg, each by the pin rule. The AP pack's and the legal rule's versions are computed by the Node engine's
code; this reader compares those two rows by their folder digests alone.

Exit: 0 intact and re-performed · 1 intact, the verdict is FAIL · 2 intact, something cannot be told here · 3 not a frag or a
usage error · 4 integrity: the first line after the prototype line is FRAG TAMPERED OR NOT AS RECORDED.
"""

import hashlib
import json
import os
import re
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import ed25519  # noqa: E402
import ledger as L  # noqa: E402
import strict as S  # noqa: E402
from strict import UNDEFINED, get, js_str  # noqa: E402

FRAG_SCHEMA = "riposte.frag/0.1.0"
PROTOTYPE_LINE = "prototype; no measured accuracy"
FRAG_FILE = "frag.json"
COVER_FILE = "cover.txt"
BUNDLE_FILE = "bundle.json"
RECORD_FILE = "frags.jsonl"
ISSUER_FILE = "ISSUER.json"
FRAGS_ROOT = "frags"
FRAG_SIGNING_PREFIX = "riposte:frag:v0\n"
RECORD_EVENT = "frag.issued"
WORK_CHAIN_SCHEMA = "riposte.work-chain/0.1.0"
WORKGRAPH_DEPOSIT_SCHEMA = "riposte.workgraph/0.1.0"
TAMPERED = "FRAG TAMPERED OR NOT AS RECORDED"
ENGINE_OVER = "packages/verify/src/"
AP_PACK_OVER = "packages/verify/src/ap/"
LEGAL_OVER = "packages/verify/src/legal/"
TOOL_OVER = "packages/receipts/src/"
EINVOICE_RULESETS = ["packages/verify/docs/examples/peppol-en16931.ruleset.v0.3.json", "packages/verify/docs/examples/peppol-en16931.ruleset.v0.2.json"]
CHANGELOG = "packages/verify/CHANGELOG.md"
_HEX64 = re.compile(r"[0-9a-f]{64}")


def _u16(s):
    return s.encode("utf-16-be", "surrogatepass")


def _read(path):
    """A file's bytes, the handle closed."""
    with open(path, "rb") as fh:
        return fh.read()


def sha256_bytes(b):
    return hashlib.sha256(b.encode("utf-8", "surrogatepass") if isinstance(b, str) else b).hexdigest()


def short8(h):
    return S.js_slice(h, 8) + "…"


def short16(h):
    return S.js_slice(h, 16) + "…"


# ---------------------------------------------------------------------------------------------------------------------
# format.ts


def frag_id_of(f):
    return S.sha256_text(S.canonicalize({"lock": f["lock"], "claim": f["claim"], "proof": f["proof"]}))


def signed_body(f):
    return {k: f[k] for k in ("schema", "prototype", "name", "lock", "claim", "proof", "provenance", "frag_id")}


def body_sha256(f):
    return S.sha256_text(S.canonicalize(signed_body(f)))


def _message(f):
    return (FRAG_SIGNING_PREFIX + S.canonicalize(signed_body(f))).encode("utf-8", "surrogatepass")


def verify_frag_signature(f, s, issuer_pem=None):
    """(ok, fingerprint or None, reason or None): the signature over the body by the key the frag carries; the issuer pins it."""
    if not isinstance(s, dict) or not S.js_eq(get(s, "alg"), "ed25519") or not isinstance(get(s, "public_key"), str) or not isinstance(get(s, "signature"), str):
        return False, None, "the signature is not an Ed25519 envelope { alg, public_key, signature }"
    fp = None
    try:
        ok = ed25519.verify_pem(s["public_key"], _message(f), s["signature"])
        fp = ed25519.key_fingerprint(s["public_key"])
    except ed25519.KeyError_:
        ok = False
    if not ok:
        return False, fp, "the signature does not verify: the frag was altered after it was signed, or the key does not match"
    if issuer_pem is not None:
        try:
            want = ed25519.key_fingerprint(issuer_pem)
        except ed25519.KeyError_:
            return False, fp, "the issuer key could not be read"
        if fp != want:
            return False, fp, "signed by key %s, not the issuer's %s" % (fp, want)
    return True, fp, None


def path_problem(p):
    segs = p.split("/")
    if segs[0] != FRAGS_ROOT:
        return "must start with %s/" % FRAGS_ROOT
    if len(segs) < 2:
        return "must name at least one segment after frags/"
    for s in segs[1:]:
        if not re.fullmatch(r"[a-z0-9][a-z0-9._-]*", s) or s in ("..", "."):
            return "has a segment that is not a plain lower-case name: %s" % S.js_string(s)
    return None


def frag_shape_problems(x):
    if not isinstance(x, dict):
        return ["%s: not a JSON object" % FRAG_FILE]
    out = []
    if not S.js_eq(get(x, "schema"), FRAG_SCHEMA):
        out.append("%s: schema must be \"%s\" (got %s)" % (FRAG_FILE, FRAG_SCHEMA, S.stringify(get(x, "schema"))))
    if not S.js_eq(get(x, "prototype"), PROTOTYPE_LINE):
        out.append("%s: prototype must be \"%s\"" % (FRAG_FILE, PROTOTYPE_LINE))
    name = get(x, "name")
    if not isinstance(name, dict) or not isinstance(get(name, "title"), str) or not S.js_trim(name["title"]) or not isinstance(get(name, "path"), str):
        out.append("%s: name must be { title, path }" % FRAG_FILE)
    else:
        p = path_problem(name["path"])
        if p:
            out.append("%s: name.path %s" % (FRAG_FILE, p))
    lock = get(x, "lock")
    if not isinstance(lock, dict) or not isinstance(get(lock, "engine"), dict) or not isinstance(get(lock, "rulesets"), list) or \
            not isinstance(get(lock, "tools"), list) or not isinstance(get(lock, "corpus"), list):
        out.append("%s: lock must carry engine, rulesets, tools, corpus and prereg" % FRAG_FILE)
    claim, proof = get(x, "claim"), get(x, "proof")
    if not isinstance(claim, dict) or js_str(get(claim, "kind")) not in ("bench", "verdict", "release"):
        out.append("%s: claim.kind must be bench, verdict or release" % FRAG_FILE)
    if not isinstance(proof, dict) or not isinstance(claim, dict) or not S.js_eq(get(proof, "kind"), get(claim, "kind")):
        out.append("%s: proof.kind must be the claim's kind" % FRAG_FILE)
    prov = get(x, "provenance")
    if not isinstance(prov, dict) or not isinstance(get(prov, "issued_at"), str) or not isinstance(get(prov, "tier"), str):
        out.append("%s: provenance must carry issued_at and tier" % FRAG_FILE)
    fid = get(x, "frag_id")
    if not isinstance(fid, str) or not _HEX64.fullmatch(fid):
        out.append("%s: frag_id must be 64 lowercase hex" % FRAG_FILE)
    if not isinstance(get(x, "signature"), dict):
        out.append("%s: signature is missing" % FRAG_FILE)
    rec = get(x, "record")
    if not isinstance(rec, dict) or not isinstance(get(rec, "ledger"), str) or not S.is_safe_integer(get(rec, "seq")) or rec["seq"] < 0 or \
            not isinstance(get(rec, "hash"), str) or not _HEX64.fullmatch(rec["hash"]):
        out.append("%s: record must be { ledger, seq, hash }" % FRAG_FILE)
    keys = ["schema", "prototype", "name", "lock", "claim", "proof", "provenance", "frag_id", "signature", "record"]
    extra = sorted([k for k in S.js_keys(x) if k not in keys], key=_u16)
    if extra:
        out.append("%s: unknown field(s) %s" % (FRAG_FILE, ", ".join(extra)))
    return out


def _row_summary(rows):
    p = f = o = 0
    for r in rows:
        v = get(r, "verdict") if isinstance(r, dict) else UNDEFINED
        if S.js_eq(v, "PASS"):
            p += 1
        elif S.js_eq(v, "FAIL"):
            f += 1
        else:
            o += 1
    parts = []
    if p:
        parts.append("%d PASS against a preregistered bar" % p)
    if f:
        parts.append("%d FAIL against a preregistered bar" % f)
    if o:
        parts.append("%d descriptive or post-hoc" % o)
    return ", ".join(parts)


def _q(v, fallback="?"):
    """String(x ?? '?')."""
    return fallback if (v is UNDEFINED or v is None) else js_str(v)


def _claim_lines(c, p):
    ck, pk = get(c, "kind"), get(p, "kind")
    if ck == "bench" and pk == "bench":
        run = c["run"] if isinstance(get(c, "run"), dict) else {}
        results = ", results sha256 %s" % short8(p["results"]["sha256"]) if S.js_truthy(get(p, "results")) else ""
        return ["Claim: bench table %s, \"%s\": %d rows (%s); run %s under engine %s, %s; label %s." % (
            js_str(c["table"]), js_str(c["title"]), len(c["rows"]), _row_summary(c["rows"]), _q(get(run, "date")), _q(get(run, "engine_version")),
            _q(get(run, "ruleset")), js_str(c["label"])),
            "Proof: the table re-emits from %s%s; reruns from this tree: %s (%s)." % (js_str(p["folder"]), results, js_str(p["reruns_from_this_tree"]), js_str(p["rerun"]))]
    if ck == "verdict" and pk == "verdict":
        bv = get(get(c, "bundle"), "verdict")
        v = (bv["verdict"] if isinstance(get(bv, "verdict"), dict) else bv) if isinstance(bv, dict) else {}
        rs = get(v, "ruleset")
        rss = "%s@%s" % (js_str(get(rs, "id")), js_str(get(rs, "version"))) if isinstance(rs, dict) else js_str(rs)
        return ["Claim: one verdict, %s, outcome %s, ruleset %s, engine %s, with the inputs it was issued on." % (
            js_str(get(v, "verdict_id")), js_str(get(v, "outcome")), rss, js_str(get(v, "engine_version"))),
            "Proof: the bundle replays (%s); reruns from this tree: yes." % js_str(p["replay"])]
    if ck == "release" and pk == "release":
        return ["Claim: engine %s is %s, carried by %s: \"%s\"" % (js_str(c["engine"]), js_str(c["status"]), js_str(c["carried_by"]), js_str(c["statement"])),
                "Proof: %s (sha256 %s); reruns from this tree: partly (%s)." % (js_str(p["record"]["file"]), short8(p["record"]["sha256"]), js_str(p["reason"]))]
    return ["Claim: of a kind this build does not read."]


def cover_text(f):
    """coverText: a pure function of the frag's fields, re-derived and compared on open."""
    lk = f["lock"]
    ns = len([c for c in lk["corpus"] if not S.js_truthy(get(c, "ships"))])
    n = len(lk["corpus"])
    corpus = ("%d corpus entr%s%s" % (n, "y" if n == 1 else "ies", ", %d of them hashed, not shipped" % ns if ns else "")) if n else "no corpus entries"
    pr = get(lk, "prereg")
    prereg = "prereg %s, %s" % (short8(pr["sha256"]), js_str(pr["stamp"])) if S.js_truthy(pr) else "no prereg"
    eng = lk["engine"]
    lines = [PROTOTYPE_LINE,
             "Frag %s (%s): one answer the engine gave, named and pinned. %s." % (f["name"]["path"], FRAG_SCHEMA, f["name"]["title"])]
    lines += _claim_lines(f["claim"], f["proof"])
    lines.append("Pinned: engine %s, sources %s (%s files under %s); %d ruleset pins; %d tool pin%s; %s; %s." % (
        js_str(get(eng, "label")), short8(js_str(get(eng, "sha256"))), js_str(get(eng, "files")), js_str(get(eng, "over")), len(lk["rulesets"]),
        len(lk["tools"]), "" if len(lk["tools"]) == 1 else "s", corpus, prereg))
    pv = f["provenance"]
    lines.append("Issued %s; tier: %s; %s." % (pv["issued_at"], pv["tier"], js_str(get(pv, "issuer"))))
    if S.js_truthy(get(pv, "supersedes")):
        lines.append("Supersedes frag %s." % js_str(pv["supersedes"]))
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------------------------------------------------
# record.ts


def read_issuer(file):
    if not os.path.exists(file):
        return None
    try:
        with open(file, "rb") as fh:
            x = S.json_parse(fh.read().decode("utf-8", "replace"))
    except ValueError:
        return None
    if not isinstance(x, dict) or not all(isinstance(get(x, k), str) for k in ("public_key", "fingerprint", "note")):
        return None
    try:
        if ed25519.key_fingerprint(x["public_key"]) != x["fingerprint"]:
            return None
    except ed25519.KeyError_:
        return None
    return {"public_key": x["public_key"], "fingerprint": x["fingerprint"], "note": x["note"]}


def record_body_of(e):
    if e is None or e is UNDEFINED or not isinstance(e, dict):
        return None
    b = get(e, "body")
    if not S.js_eq(get(e, "kind"), "note") or not isinstance(b, dict) or not S.js_eq(get(b, "event"), RECORD_EVENT):
        return None
    if not all(isinstance(get(b, k), str) for k in ("frag_id", "path", "claim", "body_sha256")):
        return None
    return {"event": RECORD_EVENT, "frag_id": b["frag_id"], "path": b["path"], "claim": b["claim"], "body_sha256": b["body_sha256"],
            "supersedes": b["supersedes"] if isinstance(get(b, "supersedes"), str) else None}


# ---------------------------------------------------------------------------------------------------------------------
# tree.ts


def resolve_tree(root):
    r = os.path.abspath(root)
    if os.path.exists(os.path.join(r, "packages", "verify", "src")):
        return {"root": r, "layout": "shipped"}
    if os.path.exists(os.path.join(r, "verify", "src")):
        return {"root": r, "layout": "lab"}
    return None


def tree_path(t, shipped):
    parts = re.sub(r"/+$", "", shipped).split("/")
    if t["layout"] == "lab" and parts[0] == "packages":
        return os.path.join(t["root"], *parts[1:])
    return os.path.join(t["root"], *parts)


def walk(d, base=None, out=None):
    base = d if base is None else base
    out = [] if out is None else out
    for e in os.scandir(d):
        if e.is_dir(follow_symlinks=False):
            walk(e.path, base, out)
        else:
            out.append(os.path.relpath(e.path, base).replace(os.sep, "/"))
    return sorted(out, key=_u16)


def digest_folder(d, recursive=True, filt=None):
    if recursive:
        files = walk(d)
    else:
        files = sorted([f for f in os.listdir(d) if not os.path.isdir(os.path.join(d, f))], key=_u16)
    if filt:
        files = [f for f in files if filt(f)]
    text = "".join("%s  %s\n" % (sha256_bytes(_read(os.path.join(d, f))), f) for f in files)
    return {"sha256": sha256_bytes(text), "files": len(files)}


class _PinError(Exception):
    pass


def _pkg_version(t, pkg):
    p = tree_path(t, "packages/%s/package.json" % pkg)
    if not os.path.exists(p):
        raise _PinError("%s: no package.json at %s" % (pkg, os.path.relpath(p, t["root"]).replace(os.sep, "/")))
    try:
        v = get(S.json_parse(_read(p).decode("utf-8", "replace")), "version")
    except ValueError as e:
        raise _PinError("%s: package.json does not parse (%s)" % (pkg, e))
    if not isinstance(v, str):
        raise _PinError("%s: package.json names no version" % pkg)
    return v


def _folder_pin(t, over, recursive, filt=None):
    d = tree_path(t, over)
    if not os.path.exists(d):
        raise _PinError("the tree holds no %s" % over)
    dg = digest_folder(d, recursive, filt)
    return {"over": over, "recursive": recursive, "sha256": dg["sha256"], "files": dg["files"]}


def lock_table(t, lock):
    """lockTable over a tree: the AP pack's and the legal rule's ids and versions are the lock's own (see the head of this file)."""
    eng = dict(_folder_pin(t, ENGINE_OVER, True))
    eng["label"] = _pkg_version(t, "verify")

    def ts(f):
        return f.endswith(".ts")
    ap = next((r for r in lock["rulesets"] if isinstance(r, dict) and get(r, "over") == AP_PACK_OVER), {"id": "ap-threeway", "version": "?"})
    lg = next((r for r in lock["rulesets"] if isinstance(r, dict) and get(r, "over") == LEGAL_OVER), {"id": "legal", "version": "?"})
    rulesets = [dict({"id": get(ap, "id"), "version": get(ap, "version")}, **_folder_pin(t, AP_PACK_OVER, False, ts)),
                dict({"id": "legal", "version": get(lg, "version")}, **_folder_pin(t, LEGAL_OVER, False, ts))]
    for file in EINVOICE_RULESETS:
        p = tree_path(t, file)
        if not os.path.exists(p):
            raise _PinError("the tree holds no %s" % file)
        b = _read(p)
        try:
            j = S.json_parse(b.decode("utf-8", "replace"))
        except ValueError as e:
            raise _PinError("%s does not parse (%s)" % (file, e))
        rid, ver = get(j, "id"), get(j, "version")
        rulesets.append({"id": js_str(rid) if rid not in (UNDEFINED, None) else "peppol-en16931", "version": js_str(ver) if ver not in (UNDEFINED, None) else "?",
                         "file": file, "sha256": sha256_bytes(b), "bytes": len(b)})
    tools = [dict({"name": "riposte-ai", "version": _pkg_version(t, "receipts")}, **_folder_pin(t, TOOL_OVER, True))]
    return {"engine": eng, "rulesets": rulesets, "tools": tools}


def compare_pins(lock, t):
    try:
        now = lock_table(t, lock)
    except (_PinError, OSError) as e:
        return {"agree": [], "differ": [], "error": str(e)}
    agree, differ = [], []

    def cmp(pin, pinned, here):
        if pinned == here:
            agree.append(pin)
        else:
            differ.append({"pin": pin, "pinned": pinned, "here": here})
    eng = lock["engine"]
    cmp("engine %s (%s)" % (js_str(get(eng, "label")), js_str(get(eng, "over"))), get(eng, "sha256"),
        now["engine"]["sha256"] if S.js_eq(now["engine"]["label"], get(eng, "label")) else "label %s, sources %s" % (now["engine"]["label"], now["engine"]["sha256"]))
    for r in lock["rulesets"]:
        rfile = get(r, "file")
        here = next((x for x in now["rulesets"] if S.js_eq(x["id"], get(r, "id")) and (S.js_eq(x.get("file", UNDEFINED), rfile) if S.js_truthy(rfile)
                                                                                         else S.js_eq(x.get("over", UNDEFINED), get(r, "over")))), None)
        label = "ruleset %s@%s (%s)" % (js_str(get(r, "id")), js_str(get(r, "version")), js_str(rfile if S.js_truthy(rfile) else get(r, "over")))
        pinned = get(r, "sha256") if get(r, "sha256") not in (UNDEFINED, None) else ""
        if here is None:
            cmp(label, pinned, "not in this tree")
        else:
            cmp(label, pinned, here.get("sha256", "") if S.js_eq(here["version"], get(r, "version")) else "version %s, %s" % (here["version"], here.get("sha256")))
    for r in lock["tools"]:
        here = next((x for x in now["tools"] if S.js_eq(x["name"], get(r, "name"))), None)
        label = "tool %s %s (%s)" % (js_str(get(r, "name")), js_str(get(r, "version")), js_str(get(r, "over")))
        cmp(label, get(r, "sha256"), (here["sha256"] if S.js_eq(here["version"], get(r, "version")) else "version %s, %s" % (here["version"], here["sha256"])) if here else "not in this tree")
    for c in lock["corpus"]:
        if not S.js_truthy(get(c, "ships")):
            continue
        p = tree_path(t, js_str(get(c, "name")))
        if not os.path.exists(p):
            differ.append({"pin": "corpus %s" % js_str(get(c, "name")), "pinned": get(c, "sha256"), "here": "not in this tree"})
            continue
        here = digest_folder(p, True)["sha256"] if os.path.isdir(p) else sha256_bytes(_read(p))
        cmp("corpus %s" % js_str(get(c, "name")), get(c, "sha256"), here)
    pr = get(lock, "prereg")
    if S.js_truthy(pr):
        p = tree_path(t, js_str(get(pr, "path")))
        cmp("prereg %s" % js_str(get(pr, "path")), get(pr, "sha256"), sha256_bytes(_read(p)) if os.path.exists(p) else "not in this tree")
    return {"agree": agree, "differ": differ}


# ---------------------------------------------------------------------------------------------------------------------
# claim.ts (open's side), with the Python second engine as "this build"


def _engine():
    import engine as E  # engine_py/engine.py, imported unchanged (strict.py put its folder on the path)
    return E


def reperform_release(t, claim, proof):
    E = _engine()
    problems, notes = [], []
    eng = claim["engine"]
    open_label = E.ENGINES[-1]
    if eng not in E.ENGINES:
        problems.append("this build's engine does not carry %s (it carries %s)" % (js_str(eng), ", ".join(E.ENGINES)))
    elif open_label == eng:
        problems.append("this build's open label is %s: the label is not closed here" % eng)
    else:
        notes.append("this build (engine %s) carries %s as a retained engine, below its open label" % (open_label, eng))
    if t:
        file = tree_path(t, js_str(proof["record"]["file"]))
        if not os.path.exists(file):
            notes.append("%s is not in this tree" % js_str(proof["record"]["file"]))
        else:
            b = _read(file)
            if sha256_bytes(b) != proof["record"]["sha256"]:
                notes.append("%s has other bytes than the frag records (the changelog grows)" % js_str(proof["record"]["file"]))
            if js_str(claim["statement"]) not in b.decode("utf-8", "replace"):
                problems.append("%s no longer carries the sentence the claim quotes" % js_str(proof["record"]["file"]))
    return problems, notes


def gate_status(v):
    """verify's gateStatus (verdict/aggregation.ts): read from the claims, a held-suspect claim booked as FAIL, PASS-WITH-OPEN
    spelled as on screen. None where JavaScript would throw (not a verdict the gate reads)."""
    if not isinstance(v, dict):
        return None
    outcome, claims = get(v, "outcome"), get(v, "claims")
    if S.js_eq(outcome, "FAIL"):
        return "FAIL"
    if not isinstance(claims, list):
        return None

    def field(c, k):
        if c is None:
            raise TypeError("a claim is null")
        return get(c, k)
    try:
        if any(S.js_eq(field(c, "outcome"), "INSUFFICIENT_DATA") and not S.js_eq(field(c, "tier"), "REASONED") and field(c, "suspect") is not UNDEFINED
               for c in claims):
            return "FAIL"
        if not S.js_eq(outcome, "PASS"):
            return outcome if isinstance(outcome, str) else js_str(outcome)
        return "PASS-WITH-OPEN" if any(S.js_eq(field(c, "outcome"), "INSUFFICIENT_DATA") and not S.js_eq(field(c, "tier"), "REASONED") for c in claims) else "PASS"
    except TypeError:
        return None


def reperform_verdict(claim):
    """(result, reason or None, answer or None): the Python second engine's replay; a case it does not re-perform is
    NOT_REPERFORMED, never a refusal of the frag."""
    E = _engine()
    bundle = claim["bundle"]
    bv = get(bundle, "verdict")
    v = bv["verdict"] if isinstance(bv, dict) and isinstance(get(bv, "verdict"), dict) and isinstance(get(bv, "signature"), str) else bv
    answer = gate_status(v)
    try:
        _, _, _, case = E.replay_parsed(bundle)
    except Exception as e:  # the second engine's own limit: never a verdict on the frag
        return "NOT_REPERFORMED", "this reader's engine stopped on it (%s)" % e, answer
    result = case.get("result")
    reason = case.get("reason")
    if result == "REFUSED" and isinstance(reason, str) and reason.startswith("outside what this build re-performs"):
        result = "NOT_REPERFORMED"
    if case.get("first_difference") and reason:
        reason = "%s; first difference: %s" % (reason, case["first_difference"])
    return result, reason, answer


# ---------------------------------------------------------------------------------------------------------------------
# open.ts


def _not_a_frag(problems):
    return {"schema": "riposte.frag-open/0.1.0", "exit": 3, "frag_id": None, "name": None, "intact": False,
            "signature": {"ok": False, "fingerprint": None, "issuer_pinned": False},
            "record": {"checked": False, "file": None, "seq": None, "head": None, "entries": None, "words": "not checked"},
            "pins": {"compared": False, "agree": [], "differ": [], "words": "not compared"},
            "claim": {"kind": None, "reperformed": False, "words": "not re-performed"},
            "problems": problems, "cant_tell": [], "notes": [],
            "cover": [PROTOTYPE_LINE, "Not a frag: nothing was re-performed."] + ["  - %s" % p for p in problems[:10]]}


def _record_for(d, path):
    depth = len(path.split("/")) - 1
    for _ in range(depth):
        d = os.path.dirname(d)
    return os.path.join(d, RECORD_FILE), os.path.dirname(d)


def _read_issuer_opt(p, beside_record):
    file = p if p is not None else os.path.join(os.path.dirname(beside_record), ISSUER_FILE)
    if not os.path.exists(file):
        return None
    if file.endswith(".json"):
        return read_issuer(file)
    pem = _read(file).decode("utf-8", "replace")
    if "PUBLIC KEY" not in pem:
        return None
    try:
        k = L.public_of(pem)
        return {"public_key": k["public_key"], "fingerprint": k["fingerprint"], "note": "a public key given on the command line"}
    except ed25519.KeyError_:
        return None


def _deposit_pointer(p, shown):
    if not os.path.isfile(p):
        return None
    try:
        x = S.json_parse(_read(p).decode("utf-8", "replace"))
    except ValueError:
        return None
    if isinstance(x, dict) and S.js_eq(get(x, "schema"), WORKGRAPH_DEPOSIT_SCHEMA):
        return ("%s: a work graph deposit: open it with workgraph open (its schema is %s; this command opens frag folders and %s chains)"
                % (shown, WORKGRAPH_DEPOSIT_SCHEMA, WORK_CHAIN_SCHEMA))
    return None


def open_frag(folder, tree=None, record=None, issuer=None, cwd=None):
    """open(): the result object of `frag open`, its exit and its sheet (result['cover'])."""
    cwd = cwd or os.getcwd()
    d = os.path.normpath(os.path.join(cwd, folder))
    if not os.path.isdir(d):
        return _not_a_frag([_deposit_pointer(d, folder) or "%s: not a folder" % folder])
    frag_path = os.path.join(d, FRAG_FILE)
    if not os.path.exists(frag_path):
        return _not_a_frag(["%s: missing; a frag is a folder with a frag.json" % FRAG_FILE])
    try:
        x = S.parse_json_strict(S.decode_utf8_strict(_read(frag_path), FRAG_FILE), FRAG_FILE)
    except (S.HashInputRefused, S.NotJson) as e:
        return _not_a_frag(["%s: refused by the strict JSON reader (%s)" % (FRAG_FILE, e.message)])
    shape = frag_shape_problems(x)
    if shape:
        return _not_a_frag(shape)
    f = x
    problems, cant_tell, notes = [], [], []
    fid = frag_id_of(f)
    if fid != f["frag_id"]:
        problems.append("%s: frag_id does not recompute over lock + claim + proof (%s stated, %s recomputed)" % (FRAG_FILE, short16(f["frag_id"]), short16(fid)))
    record_default, _ = _record_for(d, f["name"]["path"])
    record_file = os.path.normpath(os.path.join(cwd, record)) if record else record_default
    iss = _read_issuer_opt(os.path.normpath(os.path.join(cwd, issuer)) if issuer else None, record_file)
    sig_ok, sig_fp, sig_reason = verify_frag_signature(f, f["signature"], iss["public_key"] if iss else None)
    if not sig_ok:
        problems.append("%s: %s" % (FRAG_FILE, sig_reason))
    if not iss:
        cant_tell.append("the issuer key is not pinned here (no %s beside the record and no --issuer): the signature verifies against the key the frag carries, "
                         "which proves consistency, not who issued it" % ISSUER_FILE)
    cover_path = os.path.join(d, COVER_FILE)
    if not os.path.exists(cover_path):
        problems.append("%s: missing" % COVER_FILE)
    elif _read(cover_path).decode("utf-8", "replace") != cover_text(f):
        problems.append("%s: does not match the cover sentence re-derived from %s" % (COVER_FILE, FRAG_FILE))
    if f["claim"]["kind"] == "verdict":
        bp = os.path.join(d, BUNDLE_FILE)
        if not os.path.exists(bp):
            problems.append("%s: missing (a verdict frag carries its bundle as a file)" % BUNDLE_FILE)
        else:
            try:
                if S.canonicalize(S.parse_json_strict(S.decode_utf8_strict(_read(bp), BUNDLE_FILE), BUNDLE_FILE)) != S.canonicalize(get(f["claim"], "bundle")):
                    problems.append("%s: is not the claim's bundle" % BUNDLE_FILE)
            except (S.HashInputRefused, S.NotJson) as e:
                problems.append("%s: %s" % (BUNDLE_FILE, e.message))
    rec = {"checked": False, "file": None, "seq": None, "head": None, "entries": None, "words": ""}
    if not os.path.exists(record_file):
        rec["words"] = "the record is not reachable from this folder (looked for %s); pass --record <frags.jsonl>" % (record or record_default)
        cant_tell.append(rec["words"])
    else:
        rec["checked"] = True
        rec["file"] = record_file
        r = L.read_record(record_file, iss["public_key"] if iss else None)
        if "error" in r:
            problems.append(r["error"])
        else:
            rec["entries"] = len(r["entries"])
            rec["head"] = r["chain"]["head"]
            if r.get("torn"):
                problems.append("%s: its last line is torn (%d bytes with no newline)" % (RECORD_FILE, r["torn"]["bytes"]))
            if not r["chain"]["ok"]:
                problems.append("%s: the chain does not verify (%s)" % (RECORD_FILE, r["chain"].get("reason") or "broken"))
            if not r["head"]["ok"]:
                problems.append("%s: %s" % (RECORD_FILE, r["head"]["words"]))
            seq = int(f["record"]["seq"])
            e = r["entries"][seq] if seq < len(r["entries"]) else None
            b = record_body_of(e)
            if not e or not b:
                problems.append("%s: entry %d is not a frag's record entry" % (RECORD_FILE, seq))
            else:
                if not S.js_eq(get(e, "hash"), f["record"]["hash"]):
                    problems.append("%s: entry %d has hash %s, not the %s the frag records" % (RECORD_FILE, seq, short16(js_str(get(e, "hash"))), short16(f["record"]["hash"])))
                if b["frag_id"] != f["frag_id"]:
                    problems.append("%s: entry %d records frag %s, not this frag (%s)" % (RECORD_FILE, seq, short16(b["frag_id"]), short16(f["frag_id"])))
                if b["body_sha256"] != body_sha256(f):
                    problems.append("%s: entry %d records another body (name or provenance changed after the frag was recorded)" % (RECORD_FILE, seq))
                if b["path"] != f["name"]["path"]:
                    problems.append("%s: entry %d records the address %s, not %s" % (RECORD_FILE, seq, b["path"], f["name"]["path"]))
                rec["seq"] = get(e, "seq")
            later = next((x2 for x2 in (record_body_of(e2) for e2 in r["entries"][seq + 1:]) if x2 and x2["supersedes"] == f["frag_id"]), None)
            if later:
                notes.append("a later frag supersedes this one: %s (%s)" % (short16(later["frag_id"]), later["path"]))
            if any(p.startswith(RECORD_FILE) for p in problems):
                rec["words"] = "the record does not hold this frag as written"
            else:
                c = r["chain"]
                rec["words"] = "entry %d of %d, chain %s, %d signed%s; head %s; %s" % (
                    seq, len(r["entries"]), "intact" if c["chain_ok"] else "broken", c["signed"],
                    ", every entry by the issuer's key %s" % short16(iss["fingerprint"]) if iss else "", short16(c["head"]), r["head"]["words"])
    t = None
    if tree:
        t = resolve_tree(os.path.normpath(os.path.join(cwd, tree)))
        if not t:
            cant_tell.append("%s: not a repository root, so the pins were not compared and the claim was not re-performed" % tree)
    else:
        t = resolve_tree(_record_for(d, f["name"]["path"])[1])
        if not t:
            cant_tell.append("no repository root above this frag, so the pins were not compared and the claim was not re-performed; pass --tree <root>")
    pins = {"compared": False, "agree": [], "differ": [], "words": "not compared"}
    claim = {"kind": f["claim"]["kind"], "reperformed": False, "words": "not re-performed"}
    if t:
        c = compare_pins(f["lock"], t)
        if c.get("error"):
            cant_tell.append("the pins could not be computed over this tree: %s" % c["error"])
        else:
            pins.update({"compared": True, "agree": c["agree"], "differ": c["differ"]})
            pins["words"] = ("%d of %d pins differ from this tree (%s): this is not the tree the frag pins" % (
                len(c["differ"]), len(c["agree"]) + len(c["differ"]), "; ".join(x["pin"] for x in c["differ"]))
                if c["differ"] else "every one of the %d pins agrees with this tree" % len(c["agree"]))
            if c["differ"]:
                notes.append(pins["words"])
    ck, pk = f["claim"]["kind"], f["proof"]["kind"]
    if ck == "bench" and pk == "bench":
        if not t:
            cant_tell.append("the bench table was not re-emitted: no tree")
        else:
            cant_tell.append("the bench table was not re-emitted here: this reader does not re-emit bench tables; the bench tool does (%s)" % js_str(f["proof"]["reemit"]))
    elif ck == "verdict":
        result, reason, answer = reperform_verdict(f["claim"])
        claim["answer"] = answer
        if result == "MATCH":
            claim["reperformed"] = True
            claim["words"] = "the bundle replays: MATCH%s" % (", %s" % ("can't tell" if answer == "INSUFFICIENT_DATA" else answer) if answer else "")
        elif result == "NOT_REPERFORMED":
            claim["words"] = "the engine verified the verdict's structure but did not re-perform it (%s)" % (reason or "not re-performed")
            cant_tell.append(claim["words"])
        else:
            claim["words"] = "the verdict does not replay (%s%s)" % (result, ": %s" % reason if reason else "")
            problems.append("%s: %s" % (FRAG_FILE, claim["words"]))
    elif ck == "release" and pk == "release":
        rp, rn = reperform_release(t, f["claim"], f["proof"])
        problems += rp
        notes += rn
        claim["reperformed"] = not rp
        claim["words"] = ("engine %s is carried as a closed label below this build's open one" if claim["reperformed"] else "engine %s is not a closed label here") % f["claim"]["engine"]
        lrec = get(f["lock"], "record")
        if S.js_truthy(lrec) and rec["checked"] and rec["entries"] is not None:
            rr = L.read_record(record_file, iss["public_key"] if iss else None)
            if "error" not in rr:
                for fr in lrec["frags"]:
                    sq = int(fr["seq"])
                    b2 = record_body_of(rr["entries"][sq] if sq < len(rr["entries"]) else None)
                    if not b2 or b2["frag_id"] != fr["frag_id"]:
                        problems.append("%s: the release names frag %s at entry %d, and the record holds %s there" % (
                            RECORD_FILE, short16(fr["frag_id"]), sq, short16(b2["frag_id"]) if b2 else "no frag"))
    intact = not problems
    if not intact:
        code = 4
    elif ck == "verdict" and claim.get("answer") == "FAIL":
        code = 1
    elif cant_tell:
        code = 2
    elif ck == "verdict" and claim.get("answer") != "PASS":
        code = 2
    else:
        code = 0
    head = [PROTOTYPE_LINE]
    if not intact:
        head.append("%s: the frag is not what it says it is." % TAMPERED)
        head += ["  - %s" % p for p in problems]
    else:
        head.append("On opening: %s" % ("intact and re-performed." if code == 0 else "intact and re-performed; the verdict is FAIL." if code == 1
                                        else "intact; some of it cannot be told here."))
        head.append("  frag %s" % f["frag_id"])
        head.append("  signature: %s, key %s%s" % ("verifies" if sig_ok else "fails", short16(sig_fp) if sig_fp else "?",
                                                 " (the issuer's: %s)" % iss["note"] if iss else " (issuer not pinned)"))
        head.append("  record: %s" % rec["words"])
        head.append("  pins: %s" % pins["words"])
        head.append("  claim: %s" % claim["words"])
        head += ["  can't tell: %s" % c for c in cant_tell]
        head += ["  note: %s" % n for n in notes]
    sheet = cover_text(f).rstrip().split("\n")[1:] if intact else []
    return {"schema": "riposte.frag-open/0.1.0", "exit": code, "frag_id": f["frag_id"], "name": f["name"], "intact": intact,
            "signature": {"ok": sig_ok, "fingerprint": sig_fp, "issuer_pinned": bool(iss)},
            "record": rec, "pins": pins, "claim": claim, "problems": problems, "cant_tell": cant_tell, "notes": notes,
            "cover": head + ([""] + sheet if sheet else [])}


USAGE = "\n".join([
    PROTOTYPE_LINE,
    "usage:",
    "  python3 conformance/engine_py/record/frag.py open <frag folder> [--tree <repository root>] [--record <frags.jsonl>] [--issuer <ISSUER.json | public key.pem>] [--json]",
    "  (a reader: build, release, import, export, emit, contract and the opening of work-frag chains are node packages/frag/dist/cli.js's)",
])
_VALUE_FLAGS = ["--tree", "--name", "--title", "--claim", "--key", "--out", "--issuer", "--tier", "--supersedes", "--engine", "--record",
                "--declared", "--resolved", "--rollout", "--contract", "--root", "--actor", "--action", "--parents", "--ledger", "--trajectory"]


def _is_work_chain_file(p):
    if not os.path.isfile(p):
        return False
    try:
        x = S.json_parse(_read(p).decode("utf-8", "replace"))
    except ValueError:
        return False
    return isinstance(x, dict) and S.js_eq(get(x, "schema"), WORK_CHAIN_SCHEMA)


def main(argv, out=None, err=None, cwd=None):
    out = out or sys.stdout
    err = err or sys.stderr
    cwd = cwd or os.getcwd()
    cmd = argv[0] if argv else None
    args = argv[1:]
    if cmd in ("help", "--help"):
        out.write(USAGE + "\n")
        return 0
    flags, rest, bools = {}, [], set()
    i = 0
    while i < len(args):
        a = args[i]
        if a in _VALUE_FLAGS:
            v = args[i + 1] if i + 1 < len(args) else None
            if v is None or (v.startswith("--") and len(v) > 2):
                err.write("frag: %s needs a value\n%s\n" % (a, USAGE))
                return 3
            if a in flags:
                err.write("frag: %s given twice\n%s\n" % (a, USAGE))
                return 3
            flags[a] = v
            i += 2
            continue
        if a == "--json":
            bools.add(a)
        elif a.startswith("--"):
            err.write("frag: unknown flag %s\n%s\n" % (a, USAGE))
            return 3
        else:
            rest.append(a)
        i += 1
    if cmd in ("build", "release", "import", "export", "emit", "contract"):
        err.write("frag %s: this reader only opens frags (node packages/frag/dist/cli.js %s)\n" % (cmd, cmd))
        return 3
    if cmd == "open" and len(rest) == 1 and _is_work_chain_file(os.path.normpath(os.path.join(cwd, rest[0]))):
        err.write("frag open: %s is a chain of work frags (%s): node packages/frag/dist/cli.js open re-performs it; this reader opens frag folders\n"
                  % (rest[0], WORK_CHAIN_SCHEMA))
        return 3
    if cmd == "open":
        allowed = ["--tree", "--record", "--issuer"]
        if len(rest) != 1 or any(k not in allowed for k in flags):
            err.write("frag open: give one frag folder\n%s\n" % USAGE)
            return 3
        r = open_frag(rest[0], tree=flags.get("--tree"), record=flags.get("--record"), issuer=flags.get("--issuer"), cwd=cwd)
        out.write(S.to_json(r) + "\n" if "--json" in bools else "\n".join(r["cover"]) + "\n")
        return r["exit"]
    err.write(USAGE + "\n")
    return 3


if __name__ == "__main__":
    S.utf8_streams()
    sys.exit(main(sys.argv[1:]))
