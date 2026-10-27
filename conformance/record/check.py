# SPDX-License-Identifier: Apache-2.0
"""The record vectors (riposte.record-vectors/0.1.0; SPEC.md beside this file) in Python (3.10 or later, standard library only).
Prototype; no measured accuracy.

    python3 conformance/record/check.py [--words] [--cases <vectors.json>]

Runs vectors.json through the record readers of conformance/engine_py/record/ (strict.py, ed25519.py, ledger.py, frag.py and
workgraph.py, with conformance/riposte_bind.py) and prints one line per failure, the passes by part, and `passed N, failures M`,
as check.mjs does for the Node packages. --words compares a command's whole stdout and stderr too, not only its exit code and
first lines.

From another runner: check(impl, cases, words=False) returns (passed, failures, parts). impl is a dict of callables, each
optional (a part runs for the callables given), named as check.mjs names them: canonicalize, parse_strict, decode_strict,
parse_strict_graph, decode_strict_graph (each refusal an exception with .where or .at), sha256_canonical, verdict_id, frag_id,
body_sha256, entry_hash, work_frag_id, charter_id, bundle_sha256, index_chain, pin_digest, key_fingerprint, verify_signature,
signed_message, verify_signed; and ledger, frag, workgraph, which take argv and a folder and return (code, out, err).

Exit 0 every case as expected; 1 at least one was not; 3 vectors.json or the readers cannot be read.
"""

import base64
import hashlib
import io
import json
import os
import shutil
import sys
import tempfile

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
CONFORMANCE = os.path.dirname(HERE)
READERS = os.path.join(CONFORMANCE, "engine_py", "record")
SCHEMA = "riposte.record-vectors/0.1.0"
PARTS = ["canonical", "strict", "hashes", "ed25519", "ledger", "frag", "workgraph"]


def load_cases(path=None):
    with open(path or os.path.join(HERE, "vectors.json"), encoding="utf-8") as f:
        cases = json.load(f)
    if cases.get("schema") != SCHEMA:
        raise ValueError("not %s: %r" % (SCHEMA, cases.get("schema")))
    return cases


# ---------------------------------------------------------------------------------------------------------------------
# Files: a fixture is {path: {"utf8": text} | {"base64": bytes}}; a change adds, replaces, edits ({"replace": [a, b]}) or removes


def bytes_of(f):
    return f["utf8"].encode("utf-8", "surrogatepass") if "utf8" in f else base64.b64decode(f["base64"])


def apply_change(files, change):
    out = dict(files)
    for p, c in (change or {}).items():
        if c is None:
            if p not in out:
                raise ValueError("change: %s is not in the fixture" % p)
            del out[p]
        elif isinstance(c, dict) and "replace" in c:
            if p not in out:
                raise ValueError("change: %s is not in the fixture" % p)
            t = bytes_of(out[p]).decode("utf-8")
            a, b = c["replace"]
            i = t.find(a)
            if i < 0:
                raise ValueError("change: %r is not in %s" % (a[:40], p))
            out[p] = {"utf8": t[:i] + b + t[i + len(a):]}
        else:
            out[p] = c
    return out


def write_tree(d, files):
    for p, f in files.items():
        target = os.path.join(d, *p.split("/"))
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, "wb") as fh:
            fh.write(bytes_of(f))


def in_folder(files, fn):
    d = tempfile.mkdtemp(prefix="record-vectors-case-")
    try:
        write_tree(d, files)
        return fn(d)
    finally:
        shutil.rmtree(d, ignore_errors=True)


def files_of(cases, c):
    return apply_change(cases["fixtures"].get(c.get("fixture"), {}), c.get("change"))


def source_text(cases, s):
    t = bytes_of(cases["fixtures"][s["fixture"]][s["file"]]).decode("utf-8")
    return t if s.get("line") is None else t.split("\n")[s["line"]]


def signed_object(cases, c, parse):
    o = parse(source_text(cases, c["source"]))
    holder = {"ledger-entry": lambda: o["signature"], "envelope": lambda: o, "frag": lambda: o["signature"],
              "charter": lambda: o["signatures"][0]}[c["kind"]]()
    sig_key = {"ledger-entry": "sig", "envelope": "signature", "frag": "signature", "charter": "signature"}[c["kind"]]
    if "signature" in c:
        holder[sig_key] = c["signature"]
    if "public_key" in c and c["kind"] != "charter":
        holder["public_key"] = c["public_key"]
    return o


def _show(x):
    s = json.dumps(x, ensure_ascii=True)
    return s if len(s) <= 160 else s[:157] + "..."


def command_difference(r, e, words):
    code, out, err = r
    if e.get("threw"):
        # the Node tool stopped with an exception and printed no verdict line: only the exit is the contract
        return None if code == e["exit"] else "exit %s, expected %s (the Node tool stops with an exception here)" % (code, e["exit"])
    stream = out if e.get("stream") == "stdout" else err
    if code != e["exit"]:
        first = (stream or out or err).split("\n")[0]
        return "exit %s, expected %s%s; %s" % (code, e["exit"], " (%s)" % _show(e["head"][0]) if e.get("head") else "", _show(first))
    if e.get("head"):
        lines = stream.split("\n")[:len(e["head"])]
        for i, want in enumerate(e["head"]):
            got = lines[i] if i < len(lines) else None
            if got != want:
                return "%s line %d is %s, expected %s" % (e["stream"], i + 1, _show(got), _show(want))
    if words:
        for name, got in (("stdout", out), ("stderr", err)):
            if got != e[name]:
                a, b = got.split("\n"), e[name].split("\n")
                n = next((i for i in range(max(len(a), len(b))) if (a[i] if i < len(a) else None) != (b[i] if i < len(b) else None)), 0)
                return "%s differs at line %d: %s, expected %s" % (name, n + 1, _show(a[n] if n < len(a) else None), _show(b[n] if n < len(b) else None))
    return None


def check(impl, cases, words=False):
    """check.mjs's check(impl, { words }): returns (passed, failures, parts)."""
    failures = []
    passed = [0]
    parts = {}
    mark = [0]
    parse = impl.get("json_parse") or json.loads

    def part(name):
        parts[name] = passed[0] - mark[0]
        mark[0] = passed[0]

    def ok():
        passed[0] += 1

    def fail(p, c, why):
        failures.append("%s, %s: %s" % (p, c["name"], why))

    # 1. canonical JSON
    if "canonicalize" in impl:
        for c in cases["canonical"]:
            try:
                got = impl["canonicalize"](parse(c["text"]))
            except Exception as e:  # noqa: BLE001
                fail("canonical", c, "threw %s" % e)
                continue
            if got == c["expect"]["canonical"]:
                ok()
            else:
                fail("canonical", c, "got %s, expected %s" % (_show(got), _show(c["expect"]["canonical"])))
    part("canonical")

    # 1b. the strict readers
    for c in cases["strict"]:
        graph = c["reader"] == "workgraph"
        p = impl.get("parse_strict_graph" if graph else "parse_strict")
        d = impl.get("decode_strict_graph" if graph else "decode_strict")
        if p is None or ("base64" in c and d is None):
            continue
        refused = c["expect"].get("refused")
        try:
            text = d(base64.b64decode(c["base64"]), c["file"]) if "base64" in c else c["text"]
            value = p(text, c["file"])
        except Exception as e:  # noqa: BLE001
            where = getattr(e, "where", None)
            if where is None:
                where = getattr(e, "at", None)
            if not refused:
                fail("strict", c, "refused (%s): %s" % (where, getattr(e, "message", e)))
            elif where != refused["where"]:
                fail("strict", c, "refused at %s, expected at %s" % (where or "no place", refused["where"] or "no place"))
            elif words and getattr(e, "message", str(e)) != refused["message"]:
                fail("strict", c, "the words differ: %s" % _show(getattr(e, "message", str(e))))
            else:
                ok()
            continue
        if refused:
            fail("strict", c, "accepted, expected a refusal at %s" % (refused["where"] or "no place"))
        elif "canonicalize" in impl and impl["canonicalize"](value) != c["expect"]["canonical"]:
            fail("strict", c, "read as %s, expected %s" % (_show(impl["canonicalize"](value)), _show(c["expect"]["canonical"])))
        else:
            ok()
    part("strict")

    # 2. sha256 bindings
    def src(c):
        return parse(source_text(cases, c["source"]))
    rules = {
        "sha256_canonical": ("sha256_canonical", lambda c: {"sha256": impl["sha256_canonical"](parse(c["text"]))}),
        "verdict_id": ("verdict_id", lambda c: {"verdict_id": impl["verdict_id"](c["input_hash"], c["ruleset"], c["engine_version"], c.get("remedy_table_hash"))}),
        "frag_id": ("frag_id", lambda c: (lambda f: {"frag_id": impl["frag_id"](f), "body_sha256": impl["body_sha256"](f)})(src(c))),
        "entry_hash": ("entry_hash", lambda c: {"hash": impl["entry_hash"](c["entry"] if "entry" in c else src(c))}),
        "work_frag_id": ("work_frag_id", lambda c: {"id": impl["work_frag_id"](src(c))}),
        "charter_id": ("charter_id", lambda c: {"id": impl["charter_id"](src(c))}),
        "bundle_sha256": ("bundle_sha256", lambda c: {"bundle_sha256": impl["bundle_sha256"](src(c))}),
        "index_chain": ("index_chain", lambda c: impl["index_chain"](source_text(cases, c["source"]))),
        "pin_rule": ("pin_digest", lambda c: in_folder(cases["fixtures"][c["source"]["fixture"]],
                                                     lambda d: impl["pin_digest"](os.path.join(d, *c["source"]["folder"].split("/")), c["recursive"], c.get("suffix")))),
        "key_fingerprint": ("key_fingerprint", lambda c: {"fingerprint": impl["key_fingerprint"](c["pem"])}),
    }
    for c in cases["hashes"]:
        need, fn = rules[c["rule"]]
        if need not in impl or (c["rule"] == "frag_id" and "body_sha256" not in impl):
            continue
        try:
            got = fn(c)
        except Exception as e:  # noqa: BLE001
            fail("hashes", c, "threw %s" % e)
            continue
        off = [k for k in c["expect"] if got.get(k) != c["expect"][k]]
        if off:
            fail("hashes", c, "; ".join("%s %s, expected %s" % (k, _show(got.get(k)), _show(c["expect"][k])) for k in off))
        else:
            ok()
    part("hashes")

    # 3. Ed25519
    for c in cases["ed25519"]:
        if c["kind"] == "raw":
            if "verify_signature" not in impl:
                continue
            try:
                got = impl["verify_signature"](c["public_key"], bytes.fromhex(c["message_hex"]), c["signature"])
            except Exception as e:  # noqa: BLE001
                fail("ed25519", c, "threw %s" % e)
                continue
            if got == c["expect"]["valid"]:
                ok()
            else:
                fail("ed25519", c, "%s, expected it %s" % ("verifies" if got else "does not verify", "to verify" if c["expect"]["valid"] else "not to verify"))
            continue
        o = signed_object(cases, c, parse)
        if "message_sha256" in c["expect"] and "signed_message" in impl:
            m = impl["signed_message"](c["kind"], o)
            h = hashlib.sha256(m.encode("utf-8", "surrogatepass") if isinstance(m, str) else m).hexdigest()
            if h != c["expect"]["message_sha256"]:
                fail("ed25519", c, "the signed message hashes to %s, expected %s" % (h, c["expect"]["message_sha256"]))
                continue
        if "verify_signed" not in impl:
            continue
        try:
            got = impl["verify_signed"](c["kind"], o, cases["keys"][c["issuer"]]["public_key"] if c.get("issuer") else None)
        except Exception as e:  # noqa: BLE001
            fail("ed25519", c, "threw %s" % e)
            continue
        if got == c["expect"]["valid"]:
            ok()
        else:
            fail("ed25519", c, "%s, expected it %s" % ("verifies" if got else "does not verify", "to verify" if c["expect"]["valid"] else "not to verify"))
    part("ed25519")

    # 4-6. the commands
    for name in ("ledger", "frag", "workgraph"):
        run = impl.get(name)
        if run is not None:
            for c in cases[name]:
                try:
                    r = in_folder(files_of(cases, c), lambda d: run(c["argv"], d))
                except Exception as e:  # noqa: BLE001
                    fail(name, c, "threw %s: %s" % (type(e).__name__, e))
                    continue
                why = command_difference(r, c["expect"], words)
                if why:
                    fail(name, c, why)
                else:
                    ok()
        part(name)
    return passed[0], failures, parts


# ---------------------------------------------------------------------------------------------------------------------
# This folder's readers, as an implementation


def python_impl():
    for p in (READERS, CONFORMANCE):
        if p not in sys.path:
            sys.path.insert(0, p)
    import ed25519 as E  # noqa: E402
    import frag as F  # noqa: E402
    import ledger as L  # noqa: E402
    import strict as S  # noqa: E402
    import workgraph as W  # noqa: E402
    import riposte_bind as rb  # noqa: E402

    def in_dir(d, fn):
        prev = os.getcwd()
        os.chdir(d)
        try:
            return fn()
        finally:
            os.chdir(prev)

    def collect(fn):
        out, err = io.StringIO(), io.StringIO()
        code = fn(out, err)
        return code, out.getvalue(), err.getvalue()

    def verify_signature(pem, msg, sig):
        try:
            return bool(E.verify_pem(pem, msg, sig))
        except E.KeyError_:
            return False

    def index_chain(text):
        lines = text.split("\n")
        if lines and lines[-1] == "":
            lines.pop()
        return {"line_sha256": [W.sha256(x) for x in lines],
                "head_record": {"bytes": len(text.encode("utf-8")), "count": len(lines), "head": W.sha256(lines[-1]) if lines else "0" * 64}}

    def signed_message(kind, o):
        if kind == "ledger-entry":
            return o["hash"].encode("utf-8", "surrogatepass")
        if kind == "envelope":
            return S.canonicalize(o["verdict"]).encode("utf-8", "surrogatepass")
        if kind == "frag":
            return F._message(o)
        return W.signing_message(o)

    def verify_signed(kind, o, issuer):
        if kind == "ledger-entry":
            # verifyEntry: the hash re-derives, then the signature over it (ledger.py's own check, as verify_chain reads it)
            return L.entry_hash(o) == o.get("hash") and L._signature_check(o)[0]
        if kind == "envelope":
            # riposte-ledger verify-signature over the envelope as a file: exit 0 is a signature that verifies
            d = tempfile.mkdtemp(prefix="record-vectors-env-")
            try:
                with open(os.path.join(d, "env.json"), "w", encoding="utf-8", newline="\n") as fh:
                    fh.write(S.to_json(o) + "\n")
                return in_dir(d, lambda: L.ledger_cli(["verify-signature", "env.json"]))["code"] == 0
            finally:
                shutil.rmtree(d, ignore_errors=True)
        if kind == "frag":
            return F.verify_frag_signature(o, o["signature"], issuer)[0]
        try:
            W.validate_charter(o)
            return True
        except W.Refused as e:
            if e.code == "signature_invalid":
                return False
            raise

    def pin_digest(d, recursive, suffix):
        r = F.digest_folder(d, recursive, (lambda f: f.endswith(suffix)) if suffix else None)
        return {"sha256": r["sha256"], "files": r["files"]}

    def body_of(dep):
        return {k: v for k, v in dep.items() if k != "bundle_sha256"}

    return {
        "json_parse": S.json_parse,
        "canonicalize": S.canonicalize,
        "parse_strict": S.parse_json_strict,
        "decode_strict": S.decode_utf8_strict,
        "parse_strict_graph": W.parse_strict,
        "decode_strict_graph": W.decode_utf8_strict,
        "sha256_canonical": lambda v: S.sha256_text(S.canonicalize(v)),
        "verdict_id": rb.derive_verdict_id,
        "frag_id": F.frag_id_of,
        "body_sha256": F.body_sha256,
        "entry_hash": L.entry_hash,
        "work_frag_id": W.frag_id,
        "charter_id": W.charter_id,
        "bundle_sha256": lambda dep: W.hash_of(body_of(dep)),
        "index_chain": index_chain,
        "pin_digest": pin_digest,
        "key_fingerprint": lambda pem: L.public_of(pem)["fingerprint"],
        "verify_signature": verify_signature,
        "signed_message": signed_message,
        "verify_signed": verify_signed,
        "ledger": lambda argv, d: in_dir(d, lambda: (lambda r: (r["code"], r["out"], r["err"]))(L.ledger_cli(argv))),
        "frag": lambda argv, d: in_dir(d, lambda: collect(lambda out, err: F.main(argv, out, err, cwd=d))),
        "workgraph": lambda argv, d: in_dir(d, lambda: collect(lambda out, err: W.main(argv, out, err, env={}, cwd=d))),
    }


def main(argv):
    words = "--words" in argv
    path = argv[argv.index("--cases") + 1] if "--cases" in argv and argv.index("--cases") + 1 < len(argv) else None
    try:
        cases = load_cases(path)
        impl = python_impl()
    except Exception as e:  # noqa: BLE001
        print("cannot read the vectors or the readers: %s" % e)
        return 3
    passed, failures, parts = check(impl, cases, words)
    for f in failures:
        print(f.encode("ascii", "backslashreplace").decode("ascii"))
    print(", ".join("%s %d" % (k, parts[k]) for k in PARTS))
    print("python %s%s: passed %d, failures %d" % (sys.version.split()[0], ", words" if words else "", passed, len(failures)))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
