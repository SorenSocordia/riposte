# A reader of forecasts (riposte.forecast/0.1.0) in Python, with the standard library alone. prototype; no measured accuracy.
# SPDX-License-Identifier: Apache-2.0
"""
Re-performs a forecast as `node packages/frag/dist/cli.js forecast verify` does, in its order, with its words and its exit codes: the
two files read strictly, their shapes, both ids recomputed, the reveal naming the commit and its question, the commit digest
recomputed from p, salt and question_ref, the OpenTimestamps proof's header read for the digest it was made over, and the attested
time compared with the cutoff (the earlier of the commit's resolves_by and the market's actual close). Written from
packages/frag/src/forecast/format.ts and packages/frag/docs/FORECAST.md.

    python3 conformance/engine_py/record/forecast.py verify <commit.json> <reveal.json> [--ots <proof.ots>] [--attested <ISO time>] [--closed <ISO time>] [--outcome yes|no] [--json]
    python3 conformance/engine_py/record/forecast.py vectors [<vectors-forecast-0.1.0.json>]

It writes nothing. seal() makes a commit and its reveal in memory, for the tests and for a reader who wants to see the digest made;
the files a forecaster publishes are written by the Node command.

What it does not do: it does not check that a Bitcoin block commits to the proof's digest, or read that block's time. That is an
OpenTimestamps verifier's to say; the time it reports is passed with --attested, and this reader ties it to the commit by the
proof's digest.

Exit (verify): 0 counts · 1 intact, the stamp does not land before the cutoff · 2 intact, the timing cannot be told here · 3 not a
forecast commit and reveal, or a usage error · 4 integrity: the line after the prototype line is FORECAST TAMPERED OR NOT AS COMMITTED.
Exit (vectors): 0 every case as expected · 1 at least one was not · 3 the file cannot be read.
"""

import base64
import calendar
import json
import os
import re
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import strict as S  # noqa: E402
from strict import js_str  # noqa: E402

FORECAST_SCHEMA = "riposte.forecast/0.1.0"
FORECAST_KINDS = ["forecast.commit", "forecast.reveal"]
FORECAST_TAMPERED = "FORECAST TAMPERED OR NOT AS COMMITTED"
FORECAST_CHECK_SCHEMA = "riposte.forecast-check/0.1.0"
PROTOTYPE_LINE = "prototype; no measured accuracy"
VECTORS_SCHEMA = "riposte.forecast-vectors/0.1.0"

# [0-9] and [!-~], never \d or \s: Python's classes match other scripts' digits and spaces, JavaScript's do not
_HEX64 = re.compile(r"[0-9a-f]{64}\Z")
_ISO = re.compile(r"([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.([0-9]{1,3}))?Z\Z")
_QUESTION_REF = re.compile(r"[a-z][a-z0-9-]{0,31}:[!-~]{1,200}\Z")
_HTTPS = re.compile(r"https://[!-~]{1,500}\Z")
_REL_PATH = re.compile(r"[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)*\Z")
COMMIT_FIELDS = ["schema", "kind", "id", "question_ref", "resolution_source", "resolves_by", "commit_digest", "stamp"]
REVEAL_FIELDS = ["schema", "kind", "id", "commit_ref", "question_ref", "p", "salt"]

OTS_MAGIC = b"\x00" + b"OpenTimestamps" + b"\x00\x00" + b"Proof" + b"\x00" + bytes([0xBF, 0x89, 0xE2, 0xE8, 0x84, 0xE8, 0x92, 0x94])
OTS_SHA256 = 0x08


def _is_str(x):
    return isinstance(x, str)


def _js_sorted(keys):
    """Array.prototype.sort's default order: by UTF-16 code units."""
    return sorted(keys, key=lambda k: k.encode("utf-16-be", "surrogatepass"))


def iso_ms(x):
    """Milliseconds since 1970 of an ISO-8601 UTC time this format accepts, else None (the rule of format.ts isIsoUtc)."""
    m = _ISO.match(x) if _is_str(x) else None
    if not m:
        return None
    y, mo, d, h, mi, s = (int(g) for g in m.groups()[:6])
    leap = y % 4 == 0 and (y % 100 != 0 or y % 400 == 0)
    days = [31, 29 if leap else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    if not (y >= 2000 and 1 <= mo <= 12 and 1 <= d <= days[mo - 1] and h <= 23 and mi <= 59 and s <= 59):
        return None
    frac = m.group(7) or ""
    return calendar.timegm((y, mo, d, h, mi, s, 0, 0, 0)) * 1000 + (int(frac.ljust(3, "0")) if frac else 0)


def is_iso_utc(x):
    return iso_ms(x) is not None


def _is_probability(x):
    return S.is_num(x) and x == x and x not in (float("inf"), float("-inf")) and 0 <= x <= 1


def commit_digest_of(p, salt, question_ref):
    return S.sha256_text(S.canonicalize({"p": p, "salt": salt, "question_ref": question_ref}))


def commit_body(c):
    return {k: c[k] for k in ("schema", "kind", "question_ref", "resolution_source", "resolves_by", "commit_digest")}


def commit_stamp_bytes(c):
    """The bytes an OpenTimestamps stamp is taken over: the commit body's canonical JSON in UTF-8; their sha256 is the commit's id."""
    return S.canonicalize(commit_body(c)).encode("utf-8", "surrogatepass")


def commit_id_of(c):
    return S.sha256_text(S.canonicalize(commit_body(c)))


def reveal_id_of(r):
    return S.sha256_text(S.canonicalize({k: r[k] for k in ("schema", "kind", "commit_ref", "question_ref", "p", "salt")}))


def seal(p, question_ref, resolution_source, resolves_by, salt=None):
    """(commit, reveal) in memory; the salt is 32 fresh random bytes unless one is given."""
    salt = salt if salt is not None else os.urandom(32).hex()
    commit = {"schema": FORECAST_SCHEMA, "kind": "forecast.commit", "id": "", "question_ref": question_ref,
              "resolution_source": resolution_source, "resolves_by": resolves_by, "commit_digest": commit_digest_of(p, salt, question_ref),
              "stamp": {"ots": None}}
    commit["id"] = commit_id_of(commit)
    reveal = {"schema": FORECAST_SCHEMA, "kind": "forecast.reveal", "id": "", "commit_ref": commit["id"], "question_ref": question_ref,
              "p": p, "salt": salt}
    reveal["id"] = reveal_id_of(reveal)
    problems = shape_problems(commit, "commit") + shape_problems(reveal, "reveal")
    if problems:
        raise ValueError("; ".join(problems))
    return commit, reveal


def shape_problems(x, where):
    """forecastShapeProblems: what makes a value not a forecast commit or reveal, each problem led by its code."""
    if not isinstance(x, dict):
        return ["%s: field_type: not a JSON object" % where]
    out = []

    def p(s):
        out.append("%s: %s" % (where, s))

    if x.get("schema", S.UNDEFINED) != FORECAST_SCHEMA or not _is_str(x.get("schema")):
        p('schema_wrong: schema must be "%s"' % FORECAST_SCHEMA)
        return out
    kind = x.get("kind", S.UNDEFINED)
    if not (_is_str(kind) and kind in FORECAST_KINDS):
        p("field_type: kind must be one of %s" % ", ".join(FORECAST_KINDS))
        return out
    fields = COMMIT_FIELDS if kind == "forecast.commit" else REVEAL_FIELDS
    missing = [k for k in fields if k not in x]
    if missing:
        p("field_missing: missing %s" % ", ".join(missing))
    extra = [k for k in x.keys() if k not in fields]
    if extra:
        p("field_unexpected: %s is not part of a %s" % (", ".join(_js_sorted(extra)), kind))
    g = lambda k: x.get(k, S.UNDEFINED)  # noqa: E731
    if not (_is_str(g("id")) and _HEX64.match(g("id"))):
        p("field_type: id must be 64 lowercase hex")
    if not (_is_str(g("question_ref")) and _QUESTION_REF.match(g("question_ref"))):
        p('field_type: question_ref is "<source>:<market id>": a lower-case source name, a colon, then the market id with no spaces')
    if kind == "forecast.commit":
        if not (_is_str(g("resolution_source")) and _HTTPS.match(g("resolution_source"))):
            p("field_type: resolution_source is an https address with no spaces")
        if not is_iso_utc(g("resolves_by")):
            p("field_type: resolves_by is an ISO-8601 UTC time, e.g. 2026-12-31T23:59:00Z")
        if not (_is_str(g("commit_digest")) and _HEX64.match(g("commit_digest"))):
            p("field_type: commit_digest must be 64 lowercase hex")
        s = g("stamp")
        if not isinstance(s, dict) or list(s.keys()) != ["ots"]:
            p("field_type: stamp is { ots }: the proof's path, or null until it is minted")
        elif s["ots"] is not None and (not _is_str(s["ots"]) or len(s["ots"].encode("utf-16-le", "surrogatepass")) // 2 > 200
                                       or not _REL_PATH.match(s["ots"]) or any(seg in ("..", ".") for seg in s["ots"].split("/"))):
            p('field_type: stamp.ots is a relative path beside the commit (letters, digits, ".", "_", "-", "/"; no ".." segment), or null')
    else:
        if not (_is_str(g("commit_ref")) and _HEX64.match(g("commit_ref"))):
            p("field_type: commit_ref must be 64 lowercase hex: the id of the commit it opens")
        if not _is_probability(g("p")):
            p("field_type: p is a number from 0 to 1")
        if not (_is_str(g("salt")) and _HEX64.match(g("salt"))):
            p("field_type: salt is 64 lowercase hex (32 random bytes)")
    return out


def ots_proof_digest(b):
    """otsProofDigest: {'ok': True, 'digest'} or {'ok': False, 'code', 'words'}, from the proof's header."""
    if len(b) < len(OTS_MAGIC) + 2:
        return {"ok": False, "code": "too-short", "words": "the file is shorter than a proof's header"}
    if b[:len(OTS_MAGIC)] != OTS_MAGIC:
        return {"ok": False, "code": "not-a-proof", "words": "the file does not start with the OpenTimestamps proof header"}
    if b[len(OTS_MAGIC)] != 0x01:
        return {"ok": False, "code": "unsupported-version", "words": "the proof's major version is not 1"}
    if b[len(OTS_MAGIC) + 1] != OTS_SHA256:
        return {"ok": False, "code": "not-sha256", "words": "the proof was made over a digest other than sha256, so it cannot name a commit id"}
    start = len(OTS_MAGIC) + 2
    if len(b) < start + 32:
        return {"ok": False, "code": "too-short", "words": "the file ends inside the digest"}
    return {"ok": True, "digest": b[start:start + 32].hex()}


def verify(commit, reveal, proof=None, attested_time=None, closed_at=None, outcome=None):
    """verifyForecast: the check, as a dict with the Node result's fields and words."""
    shape = shape_problems(commit, "commit") + shape_problems(reveal, "reveal")
    if not shape and commit["kind"] != "forecast.commit":
        shape.append("commit: kind_wrong: the first file is a forecast.reveal, not a forecast.commit")
    if not shape and reveal["kind"] != "forecast.reveal":
        shape.append("reveal: kind_wrong: the second file is a forecast.commit, not a forecast.reveal")
    opt = []
    if attested_time is not None and not is_iso_utc(attested_time):
        opt.append("options: field_type: the attested time is an ISO-8601 UTC time")
    if closed_at is not None and not is_iso_utc(closed_at):
        opt.append("options: field_type: the close time is an ISO-8601 UTC time")
    if outcome is not None and outcome not in ("yes", "no"):
        opt.append("options: field_type: the outcome is yes or no")

    def result(**kw):
        r = {"schema": FORECAST_CHECK_SCHEMA, "intact": False, "problems": [], "commit_id": None, "proof": "absent",
             "attested_time": attested_time, "cutoff": None, "timing": "cant-tell", "counts": "cant-tell", "brier": None,
             "cant_tell": [], "notes": [], "exit": 3}
        r.update(kw)
        return r

    if shape or opt:
        return result(problems=shape + opt, exit=3)
    c, r = commit, reveal
    problems = []
    cid = commit_id_of(c)
    if cid != c["id"]:
        problems.append("commit: id_mismatch: the commit's id does not recompute from its fields: it was changed after it was written")
    if reveal_id_of(r) != r["id"]:
        problems.append("reveal: id_mismatch: the reveal's id does not recompute from its fields: it was changed after it was written")
    if r["commit_ref"] != c["id"]:
        problems.append("reveal: commit_ref_differs: the reveal names another commit")
    if r["question_ref"] != c["question_ref"]:
        problems.append("reveal: question_differs: the reveal names another question than the commit")
    if commit_digest_of(r["p"], r["salt"], r["question_ref"]) != c["commit_digest"]:
        problems.append("reveal: digest_differs: sha256 of { p, salt, question_ref } is not the commit's digest: the probability or the salt is not the one committed")
    proof_state = "absent"
    if proof is not None:
        h = ots_proof_digest(proof)
        if not h["ok"]:
            proof_state = "unreadable"
            problems.append("proof: proof_unreadable: %s: %s" % (h["code"], h["words"]))
        elif h["digest"] != cid:
            proof_state = "differs"
            problems.append("proof: proof_differs: the proof is over other bytes than this commit (its digest is not the commit's id)")
        else:
            proof_state = "matches"
    cutoff = closed_at if closed_at and iso_ms(closed_at) < iso_ms(c["resolves_by"]) else c["resolves_by"]
    if problems:
        return result(problems=problems, commit_id=cid, proof=proof_state, cutoff=cutoff, exit=4)
    cant = []
    if proof_state == "absent":
        cant.append("no proof was given: the commit's time cannot be tied to it")
    if not attested_time:
        cant.append("no attested time was given: run an OpenTimestamps verifier on the proof and pass the time it reports")
    notes = [] if closed_at else ["no close time was given: the cutoff is the commit's resolves_by; a market that closed early has an earlier one"]
    if proof_state == "matches" and attested_time:
        timing = "before" if iso_ms(attested_time) < iso_ms(cutoff) else "after"
    else:
        timing = "cant-tell"
    counts = {"before": "yes", "after": "no"}.get(timing, "cant-tell")
    miss = (r["p"] - (1 if outcome == "yes" else 0)) if outcome else None
    brier = None if miss is None else miss * miss
    return result(intact=True, problems=[], commit_id=cid, proof=proof_state, cutoff=cutoff, timing=timing, counts=counts, brier=brier,
                  cant_tell=cant if timing == "cant-tell" else [], notes=notes, exit={"before": 0, "after": 1}.get(timing, 2))


def sheet(k):
    """forecastSheet: the lines a person reads."""
    lines = [PROTOTYPE_LINE]
    if k["exit"] == 3:
        return lines + ["not a forecast commit and reveal"] + ["  - %s" % x for x in k["problems"]]
    if k["exit"] == 4:
        return lines + [FORECAST_TAMPERED] + ["  - %s" % x for x in k["problems"]]
    head = ("COUNTS: the reveal opens the commit, and the stamp lands before the cutoff" if k["counts"] == "yes"
            else "DOES NOT COUNT: the reveal opens the commit, but the stamp does not land before the cutoff" if k["counts"] == "no"
            else "can't tell whether it counts: the reveal opens the commit; the timing cannot be told here")
    lines += [head, "  commit %s" % k["commit_id"], "  proof: %s" % k["proof"],
              "  attested time: %s" % (k["attested_time"] if k["attested_time"] is not None else "not given"), "  cutoff: %s" % js_str(k["cutoff"])]
    if k["brier"] is not None:
        lines.append("  Brier score: %s" % js_str(k["brier"]))
    lines += ["  can't tell: %s" % c for c in k["cant_tell"]]
    lines += ["  note: %s" % n for n in k["notes"]]
    return lines


def pretty(v, indent=""):
    """JSON.stringify(v, null, 2) for the values a check holds (keys in insertion order)."""
    if isinstance(v, dict):
        if not v:
            return "{}"
        inner = indent + "  "
        return "{\n" + ",\n".join("%s%s: %s" % (inner, S.rb.js_string(k), pretty(x, inner)) for k, x in v.items()) + "\n" + indent + "}"
    if isinstance(v, list):
        if not v:
            return "[]"
        inner = indent + "  "
        return "[\n" + ",\n".join(inner + pretty(x, inner) for x in v) + "\n" + indent + "]"
    return S.canonicalize(v)


# ---------------------------------------------------------------------------------------------------------------------
# The command line


USAGE = "\n".join([
    PROTOTYPE_LINE,
    "usage (a reader in Python; it writes nothing):",
    "  python3 conformance/engine_py/record/forecast.py verify <commit.json> <reveal.json> [--ots <proof.ots>] [--attested <ISO time>] [--closed <ISO time>] [--outcome yes|no] [--json]",
    "  python3 conformance/engine_py/record/forecast.py vectors [<vectors-forecast-0.1.0.json>]",
])
_VALUE = ("--ots", "--attested", "--closed", "--outcome")


def _read_json(path):
    name = os.path.basename(path)
    return S.parse_json_strict(S.decode_utf8_strict(S.read_bytes(path), name), name)


def default_vectors():
    for p in (os.path.join(HERE, "..", "..", "record", "vectors-forecast-0.1.0.json"),):
        if os.path.isfile(p):
            return os.path.normpath(p)
    return None


def run_vectors(v):
    """(passed, failures) over a vectors-forecast file's cases."""
    passed, failures = 0, []

    def same(name, got, want):
        nonlocal passed
        if S.canonicalize(got) == S.canonicalize(want):
            passed += 1
        else:
            failures.append("%s: got %s, expected %s" % (name, S.canonicalize(got), S.canonicalize(want)))

    for c in v["iso"]:
        same("iso/" + c["name"], {"valid": is_iso_utc(c["text"]), "ms": iso_ms(c["text"])}, c["expect"])
    for c in v["digests"]:
        i = c["input"]
        same("digests/" + c["name"], {"commit_digest": commit_digest_of(i["p"], i["salt"], i["question_ref"])}, c["expect"])
    for c in v["ids"]:
        o = c["object"]
        got = {"id": commit_id_of(o), "stamp_bytes_sha256": S.sha256_text(S.canonicalize(commit_body(o)))} if o["kind"] == "forecast.commit" else {"id": reveal_id_of(o)}
        same("ids/" + c["name"], got, c["expect"])
    for c in v["shapes"]:
        same("shapes/" + c["name"], {"problems": shape_problems(c["object"], c["where"])}, c["expect"])
    for c in v["proofs"]:
        same("proofs/" + c["name"], ots_proof_digest(base64.b64decode(c["base64"])), c["expect"])
    for c in v["checks"]:
        o = c["options"]
        k = verify(c["commit"], c["reveal"], proof=base64.b64decode(o["proof_base64"]) if o.get("proof_base64") is not None else None,
                   attested_time=o.get("attested_time"), closed_at=o.get("closed_at"), outcome=o.get("outcome"))
        same("checks/" + c["name"], {"result": k, "sheet": sheet(k)}, c["expect"])
    return passed, failures


def main(argv):
    S.utf8_streams()
    if not argv or argv[0] in ("help", "--help"):
        (sys.stdout if argv else sys.stderr).write(USAGE + "\n")
        return 0 if argv else 3
    cmd, args = argv[0], argv[1:]
    if cmd == "vectors":
        path = args[0] if args else default_vectors()
        if len(args) > 1 or not path:
            sys.stderr.write("forecast vectors: give the vectors file (none found beside conformance/record)\n")
            return 3
        try:
            v = json.loads(S.read_bytes(path).decode("utf-8"))
            if v.get("schema") != VECTORS_SCHEMA:
                raise ValueError("schema is not %s" % VECTORS_SCHEMA)
        except (OSError, ValueError) as e:
            sys.stderr.write("forecast vectors: %s: %s\n" % (path, S.node_error(e)))
            return 3
        passed, failures = run_vectors(v)
        for f in failures:
            sys.stdout.write("FAIL %s\n" % f)
        sys.stdout.write("forecast vectors: passed %d, failures %d\n" % (passed, len(failures)))
        return 0 if not failures else 1
    if cmd != "verify":
        sys.stderr.write("forecast: no command %s\n%s\n" % (json.dumps(cmd), USAGE))
        return 3
    flags, rest, as_json = {}, [], False
    i = 0
    while i < len(args):
        a = args[i]
        if a in _VALUE:
            if i + 1 >= len(args) or (args[i + 1].startswith("--") and len(args[i + 1]) > 2):
                sys.stderr.write("forecast verify: %s needs a value\n%s\n" % (a, USAGE))
                return 3
            if a in flags:
                sys.stderr.write("forecast verify: %s given twice\n%s\n" % (a, USAGE))
                return 3
            flags[a] = args[i + 1]
            i += 2
            continue
        if a == "--json":
            as_json = True
        elif a.startswith("--"):
            sys.stderr.write("forecast verify: unknown flag %s\n%s\n" % (a, USAGE))
            return 3
        else:
            rest.append(a)
        i += 1
    if len(rest) != 2:
        sys.stderr.write("forecast verify: give the commit and the reveal\n%s\n" % USAGE)
        return 3
    try:
        commit = _read_json(rest[0])
        reveal = _read_json(rest[1])
        proof = S.read_bytes(flags["--ots"]) if "--ots" in flags else None
    except (OSError, S.HashInputRefused, S.NotJson, UnicodeDecodeError, ValueError) as e:
        sys.stderr.write("forecast verify: %s\n" % getattr(e, "message", S.node_error(e)))
        return 3
    outcome = flags.get("--outcome")
    if outcome is not None and outcome not in ("yes", "no"):
        sys.stderr.write("forecast verify: --outcome is yes or no\n")
        return 3
    k = verify(commit, reveal, proof=proof, attested_time=flags.get("--attested"), closed_at=flags.get("--closed"), outcome=outcome)
    sys.stdout.write((pretty(k) if as_json else "\n".join(sheet(k))) + "\n")
    return k["exit"]


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
