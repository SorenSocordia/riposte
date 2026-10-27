# A reader of the work graph format (riposte.work-frag/0.1.0) in Python, standard library only. prototype; no measured accuracy.
# SPDX-License-Identifier: Apache-2.0
"""
The work graph's format, read by a second implementation: work frags, charters, the graph's derived statuses and container
states, the check contract, the one-line digest, a deposited file (riposte.workgraph/0.1.0) and a store's index chain and head
record. Written from packages/workgraph/SCHEMA.md and its src/ (schema.ts, charter.ts, graph.ts, digest.ts, bundle.ts, head.ts,
store.ts, canonical.ts, cli.ts). It writes nothing.

    python3 conformance/engine_py/record/workgraph.py open <file.workgraph.json> [--json]
    python3 conformance/engine_py/record/workgraph.py status [--json] [--store <dir>]
    python3 conformance/engine_py/record/workgraph.py digest <id> [--detail] [--store <dir>]
    python3 conformance/engine_py/record/workgraph.py charter check <charter.json>

The functions conformance/check.mjs asks of an implementation are canonicalize, frag_id, validate, map_finding, read_gates,
statuses and states; check.py beside this file runs work-frags.json against them. Exit codes are the workgraph command's:
open 0 intact, 2 intact with something that cannot be told here, 3 not a deposited file or a usage error, 4 integrity
(DEPOSIT TAMPERED OR NOT AS WRITTEN); status and digest 0, or 1 refused (store_tampered and the other codes of SCHEMA.md
section 12), 3 a usage error.
"""

import hashlib
import json
import math
import os
import re
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import ed25519  # noqa: E402
import strict as S  # noqa: E402
from strict import UNDEFINED, get, js_str  # noqa: E402

MAX_DEPTH = 64
WORK_FRAG_SCHEMA = "riposte.work-frag/0.1.0"
CHARTER_SCHEMA = "riposte.charter/0.1.0"
BUNDLE_SCHEMA = "riposte.workgraph/0.1.0"
FRAG_CHAIN_SCHEMA = "riposte.work-chain/0.1.0"
TAMPERED = "DEPOSIT TAMPERED OR NOT AS WRITTEN"
SIGNING_PREFIX = "riposte:charter:v0\n"
KINDS = ["step", "decision", "guard", "claim-check", "inference"]
LEVELS = ["task", "run", "branch", "step"]
FINDINGS = ["pass", "fail", "cant-tell"]
REVERSIBILITY = ["always", "maybe", "never"]
CONTAINER_LEVELS = ["task", "run", "branch"]
CLAUSE_KINDS = ["goal", "no-go", "better", "budget", "amend", "other"]
ROLE_LEVELS = ["operator", "collaborator", "consultant", "approver", "observer"]
EFFECTS = ["gate", "flag", "monitor"]
ZERO = "0" * 64
STORE_HEAD_FILE = "index.jsonl.head.json"
INDEX = "index.jsonl"
ROUTE_PREFIX = "axiom-route:"
PREDICATE_PREFIX = "axiom-predicate:"
# Object.prototype's own property names: `k in o` is true for them on any plain object (bundle.ts tests `id in prose`)
_PROTO = {"constructor", "__defineGetter__", "__defineSetter__", "hasOwnProperty", "__lookupGetter__", "__lookupSetter__",
          "isPrototypeOf", "propertyIsEnumerable", "toString", "valueOf", "__proto__", "toLocaleString"}


class Refused(Exception):
    """A refusal: a code from SCHEMA.md section 12 and a sentence."""

    def __init__(self, code, message):
        Exception.__init__(self, message)
        self.code = code
        self.message = message


# ---------------------------------------------------------------------------------------------------------------------
# canonical.ts: canonical JSON (the engine's, imported unchanged) and the work graph's own strict reader


canonicalize = S.canonicalize


def sha256(text):
    return hashlib.sha256(text.encode("utf-8", "surrogatepass") if isinstance(text, str) else text).hexdigest()


def hash_of(value):
    return sha256(canonicalize(value))


def _normalize(v):
    """canonical.ts normalize: keys in the order canonical JSON orders them (riposte_bind's order), arrays as they are."""
    if isinstance(v, dict):
        return {k: _normalize(v[k]) for k in S.rb._key_order(list(v.keys()))}
    if isinstance(v, list):
        return [_normalize(x) for x in v]
    return v


def canonical_pretty(value):
    """canonicalPretty: the same normalization, two-space indented, a final newline (a deposited file's fixed bytes)."""
    return S.to_json(_normalize(value)) + "\n"


class StrictJsonRefused(Exception):
    def __init__(self, message, at):
        Exception.__init__(self, message)
        self.code = "not_json"
        self.message = message
        self.at = at


def decode_utf8_strict(b, name):
    if S.invalid_utf8_offset(b) >= 0:
        raise StrictJsonRefused("%s: not valid UTF-8" % name, "bytes")
    return b.decode("utf-8")


_NUMBER = re.compile(r"-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?")
_IDENT = re.compile(r"[A-Za-z_$][A-Za-z0-9_$]*")


def parse_strict(text, name):
    """canonical.ts parseStrict: a byte-order mark, a string not closed or not JSON, a repeated key, a non-finite number, a number
    that does not read back as written, nesting past 64 and anything after the value refused, each with its path and the
    character (counted in UTF-16 code units, as JavaScript counts)."""
    if text.startswith(S.BOM):
        raise StrictJsonRefused("%s: starts with a UTF-8 byte-order mark; save it without one" % name, "character 0")
    n = len(text)
    st = {"i": 0}

    def at16():
        i = st["i"]
        return S.utf16_len(text[:i]) if i <= n else S.utf16_len(text) + (i - n)

    def refuse(what, path):
        raise StrictJsonRefused("%s: %s (at %s, character %d)" % (name, what, path, at16()), path)

    def ws():
        i = st["i"]
        while i < n and text[i] in " \t\n\r":
            i += 1
        st["i"] = i

    def string(path):
        start = st["i"]
        st["i"] += 1
        while True:
            if st["i"] >= n:
                refuse("a string is not closed", path)
            c = text[st["i"]]
            if c == '"':
                break
            st["i"] += 2 if c == "\\" else 1
        st["i"] += 1
        try:
            v = json.loads(text[start:st["i"]])
        except ValueError:
            refuse("a string is not valid JSON", path)
        if not isinstance(v, str):
            refuse("a string is not valid JSON", path)
        return v

    def value(path, depth):
        if depth > MAX_DEPTH:
            refuse("nesting deeper than %d levels" % MAX_DEPTH, path)
        ws()
        c = text[st["i"]] if st["i"] < n else ""
        if c == "{":
            st["i"] += 1
            out = {}
            ws()
            if st["i"] < n and text[st["i"]] == "}":
                st["i"] += 1
                return out
            while True:
                ws()
                if st["i"] >= n or text[st["i"]] != '"':
                    refuse("expected a key", path)
                k = string(path)
                kp = "%s.%s" % (path, k) if _IDENT.fullmatch(k) else "%s[%s]" % (path, S.js_string(k))
                if k in out:
                    refuse("the key %s appears twice in one object" % S.js_string(k), kp)
                ws()
                if st["i"] >= n or text[st["i"]] != ":":
                    refuse('expected ":"', kp)
                st["i"] += 1
                out[k] = value(kp, depth + 1)
                ws()
                c2 = text[st["i"]] if st["i"] < n else ""
                if c2 == ",":
                    st["i"] += 1
                    continue
                if c2 == "}":
                    st["i"] += 1
                    return out
                refuse('expected "," or "}"', path)
        if c == "[":
            st["i"] += 1
            out = []
            ws()
            if st["i"] < n and text[st["i"]] == "]":
                st["i"] += 1
                return out
            while True:
                out.append(value("%s[%d]" % (path, len(out)), depth + 1))
                ws()
                c2 = text[st["i"]] if st["i"] < n else ""
                if c2 == ",":
                    st["i"] += 1
                    continue
                if c2 == "]":
                    st["i"] += 1
                    return out
                refuse('expected "," or "]"', path)
        if c == '"':
            return string(path)
        i = st["i"]
        if text.startswith("true", i):
            st["i"] += 4
            return True
        if text.startswith("false", i):
            st["i"] += 5
            return False
        if text.startswith("null", i):
            st["i"] += 4
            return None
        m = _NUMBER.match(text, i)
        if m:
            tok = m.group(0)
            x = S._number(tok)
            if not math.isfinite(x):
                refuse("the number %s is not finite" % tok, path)
            if not S.number_text_is_exact(tok):
                shown = S.js_slice(tok, 32) + "..." if S.utf16_len(tok) > 40 else tok
                refuse("the number %s does not read back as written (it reads as %s)" % (shown, S.js_str(x)), path)
            st["i"] += len(tok)
            return x
        return refuse("expected a value", path)

    v = value("$", 0)
    ws()
    if st["i"] < n:
        refuse("text after the value", "$")
    return v


def parse_strict_bytes(b, name):
    return parse_strict(decode_utf8_strict(b, name), name)


# ---------------------------------------------------------------------------------------------------------------------
# JavaScript's Date.parse for the one ISO form the format allows (YYYY-MM-DDTHH:MM:SS[.fff]Z), as V8 reads it

_ISO = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,3})?Z")


def _days_from_civil(y, m, d):
    y -= m <= 2
    era = (y if y >= 0 else y - 399) // 400
    yoe = y - era * 400
    doy = (153 * (m + (-3 if m > 2 else 9)) + 2) // 5 + d - 1
    doe = yoe * 365 + yoe // 4 - yoe // 100 + doy
    return era * 146097 + doe - 719468


def date_parse(s):
    """Date.parse(s) in milliseconds for a string the ISO pattern matches; NaN where V8 answers NaN (a month outside 1 to 12, a
    day outside 1 to 31, an hour past 24, 24 with anything after it, a minute or a second past 59). A day past the month's end
    rolls into the next month, as V8 reads it."""
    y, mo, d = int(s[0:4]), int(s[5:7]), int(s[8:10])
    h, mi, sec = int(s[11:13]), int(s[14:16]), int(s[17:19])
    frac = s[20:-1] if len(s) > 20 else ""
    ms = int((frac + "00")[:3]) if frac else 0
    if not (1 <= mo <= 12 and 1 <= d <= 31 and h <= 24 and mi <= 59 and sec <= 59):
        return math.nan
    if h == 24 and (mi or sec or ms):
        return math.nan
    return float((_days_from_civil(y, mo, 1) + d - 1) * 86400000 + h * 3600000 + mi * 60000 + sec * 1000 + ms)


# ---------------------------------------------------------------------------------------------------------------------
# schema.ts

HEX64 = re.compile(r"[0-9a-f]{64}")


def is_id(x):
    return isinstance(x, str) and bool(HEX64.fullmatch(x))


def is_iso(x):
    return isinstance(x, str) and bool(_ISO.fullmatch(x)) and not math.isnan(date_parse(x))


def is_str(x):
    return isinstance(x, str)


def one_line(x):
    return isinstance(x, str) and len(x) > 0 and "\r" not in x and "\n" not in x


def is_role(x):
    return one_line(x) and S.utf16_len(x) <= 80 and "@" not in x


def frag_id(f):
    """The id: sha256 hex of canonical JSON of the frag with `id` removed."""
    rest = {k: v for k, v in f.items() if k != "id"}
    return sha256(canonicalize(rest))


def _exact_keys(o, keys, where):
    for k in keys:
        if k not in o:
            raise Refused("field_missing", "%s: the field \"%s\" is missing (every field is present; write null where it does not apply)" % (where, k))
    for k in S.js_keys(o):
        if k not in keys:
            raise Refused("field_unexpected", "%s: the field \"%s\" is not part of %s" % (where, k, WORK_FRAG_SCHEMA))


def _type_err(where, what):
    return Refused("field_type", "%s: %s" % (where, what))


def _digests(x, where):
    if not isinstance(x, list):
        raise _type_err(where, "must be an array of { name, sha256 }")
    for i, d in enumerate(x):
        if not isinstance(d, dict):
            raise _type_err("%s[%d]" % (where, i), "must be { name, sha256 }")
        _exact_keys(d, ["name", "sha256"], "%s[%d]" % (where, i))
        if not one_line(d["name"]):
            raise _type_err("%s[%d].name" % (where, i), "must be a non-empty one-line string")
        if not is_id(d["sha256"]):
            raise _type_err("%s[%d].sha256" % (where, i), "must be 64 lowercase hex characters")


_CHECK_BY = re.compile(r"(?:person:[^@\r\n]+|[^\r\n]+@[^@\r\n]+)")
_ROUTE_TELL = re.compile(r"axiom-route:[^@\s]+@[^@\s]+")
_AXIOM_NAMESPACE = re.compile(r"axiom(?:-[a-z0-9-]+)?:")


def is_routing_checker(cid):
    return bool(_AXIOM_NAMESPACE.match(cid)) and not cid.startswith(PREDICATE_PREFIX)


def validate_checks(x, where="checks"):
    if not isinstance(x, list):
        raise Refused("check_shape", "%s: must be an array of { by, finding, detail }" % where)
    for i, c in enumerate(x):
        if not isinstance(c, dict):
            raise Refused("check_shape", "%s[%d]: must be { by, finding, detail }" % (where, i))
        for k in ("by", "finding", "detail"):
            if k not in c:
                raise Refused("check_shape", "%s[%d]: the field \"%s\" is missing" % (where, i, k))
        for k in S.js_keys(c):
            if k not in ("by", "finding", "detail"):
                raise Refused("check_shape", "%s[%d]: the field \"%s\" is not part of a check" % (where, i, k))
        if not is_str(c["by"]) or not _CHECK_BY.fullmatch(c["by"]):
            raise Refused("check_shape", "%s[%d].by: must be \"<checker id>@<version>\" or \"person:<role>\"" % (where, i))
        if c["finding"] not in FINDINGS or not isinstance(c["finding"], str):
            raise Refused("check_shape", "%s[%d].finding: must be pass, fail or cant-tell" % (where, i))
        if not is_str(c["detail"]):
            raise Refused("check_shape", "%s[%d].detail: must be a string" % (where, i))
    return x


def _actor(x):
    if not isinstance(x, dict):
        raise Refused("actor_shape", "actor: must be { kind, model, person, tool }")
    _exact_keys(x, ["kind", "model", "person", "tool"], "actor")
    k = x["kind"]
    if k not in ("model", "person", "tool") or not isinstance(k, str):
        raise Refused("actor_shape", "actor.kind: must be model, person or tool")
    for f in ("model", "person", "tool"):
        if f != k and x[f] is not None:
            raise Refused("actor_shape", "actor: a %s actor has \"%s\": null" % (k, f))
    if k == "model":
        m = x["model"]
        if not isinstance(m, dict):
            raise Refused("actor_shape", "actor.model: must be { declared, resolved }")
        _exact_keys(m, ["declared", "resolved"], "actor.model")
        if m["declared"] is not None and not one_line(m["declared"]):
            raise Refused("actor_shape", "actor.model.declared: must be the model id named for the work, or null when nothing declared one (never copied from resolved)")
        if m["resolved"] is not None and not one_line(m["resolved"]):
            raise Refused("actor_shape", "actor.model.resolved: must be the id the reply carried, or null when not attested")
    elif k == "person":
        if not is_role(x["person"]):
            raise Refused("person_not_a_role", "actor.person: must be a role (owner, approver, reviewer), never a personal name or contact")
    else:
        t = x["tool"]
        if not isinstance(t, dict):
            raise Refused("actor_shape", "actor.tool: must be { name, version }")
        _exact_keys(t, ["name", "version"], "actor.tool")
        if not one_line(t["name"]) or not one_line(t["version"]):
            raise Refused("actor_shape", "actor.tool: name and version must be one-line strings")
    return x


_WHO = re.compile(r"(?:person:[^@\r\n]+|model:[^\r\n]+|tool:[^\r\n]+@[^@\r\n]+)")


def _decision_block(b, f):
    _exact_keys(b, ["question", "options", "reversibility", "deferral", "state_digest", "asks", "answer"], "decision")
    if not is_str(b["question"]) or len(b["question"]) == 0:
        raise _type_err("decision.question", "must be a non-empty string")
    if not isinstance(b["options"], list) or len(b["options"]) == 0 or not all(is_str(o) and len(o) > 0 for o in b["options"]):
        raise _type_err("decision.options", "must be at least one non-empty string")
    if not isinstance(b["reversibility"], str) or b["reversibility"] not in REVERSIBILITY:
        raise _type_err("decision.reversibility", "must be always, maybe or never (can the choice be undone?)")
    d = b["deferral"]
    if not isinstance(d, dict):
        raise _type_err("decision.deferral", "must be { policy, max_wait_s }")
    _exact_keys(d, ["policy", "max_wait_s"], "decision.deferral")
    if not S.js_eq(d["policy"], "now") and not S.js_eq(d["policy"], "next-breakpoint"):
        raise _type_err("decision.deferral.policy", "must be now or next-breakpoint")
    if not S.is_safe_integer(d["max_wait_s"]) or d["max_wait_s"] < 0:
        raise _type_err("decision.deferral.max_wait_s", "must be a whole number of seconds, zero or more")
    if not is_id(b["state_digest"]):
        raise _type_err("decision.state_digest", "must be 64 lowercase hex characters")
    ask = b["asks"] is None and b["answer"] is None
    answer = b["asks"] is not None and b["answer"] is not None
    if not ask and not answer:
        raise Refused("answer_without_ask", "decision: an ask has asks and answer both null; an answer has both set")
    if answer:
        if not is_id(b["asks"]):
            raise _type_err("decision.asks", "must be the id of the ask this answers")
        if b["asks"] not in f["parents"]:
            raise Refused("answer_without_ask", "decision: an answer lists the ask it answers among its parents")
        a = b["answer"]
        if not isinstance(a, dict):
            raise _type_err("decision.answer", "must be { choice, who, when, state_digest }")
        _exact_keys(a, ["choice", "who", "when", "state_digest"], "decision.answer")
        if not is_str(a["choice"]) or len(a["choice"]) == 0:
            raise _type_err("decision.answer.choice", "must be a non-empty string")
        if not is_str(a["who"]) or not _WHO.fullmatch(a["who"]):
            raise _type_err("decision.answer.who", "must be person:<role>, model:<resolved id> or tool:<name>@<version>")
        if not is_iso(a["when"]):
            raise _type_err("decision.answer.when", "must be an ISO-8601 UTC time")
        if not is_id(a["state_digest"]):
            raise _type_err("decision.answer.state_digest", "must be 64 lowercase hex characters")


_COMMON = ["schema", "id", "kind", "level", "parents", "charter", "actor", "inputs", "action", "outputs", "claim", "checks", "tokens",
           "time", "closes"]


def validate(x, check_id=True):
    """validateFrag: one frag's shape, id and kind rules. Returns it; raises Refused with the first rule broken."""
    if not isinstance(x, dict):
        raise Refused("field_type", "a work frag is a JSON object")
    if not S.js_eq(get(x, "schema"), WORK_FRAG_SCHEMA):
        raise Refused("schema_wrong", "schema: must be \"%s\"" % WORK_FRAG_SCHEMA)
    kind = get(x, "kind")
    if not isinstance(kind, str) or kind not in KINDS:
        raise _type_err("kind", "must be one of %s" % ", ".join(KINDS))
    keys = [k for k in _COMMON if check_id or k != "id"]
    if kind != "step":
        keys.append(kind)
    for k in KINDS:
        if k != "step" and k != kind and k in x:
            raise Refused("field_unexpected", "a %s frag carries no \"%s\" block" % (kind, k))
    if kind != "step" and kind not in x:
        raise Refused("kind_block_missing", "a %s frag carries a \"%s\" block" % (kind, kind))
    _exact_keys(x, keys, "frag")
    if check_id and not is_id(x["id"]):
        raise _type_err("id", "must be 64 lowercase hex characters")
    if not isinstance(x["level"], str) or x["level"] not in LEVELS:
        raise _type_err("level", "must be one of %s" % ", ".join(LEVELS))
    if not isinstance(x["parents"], list) or not all(is_id(p) for p in x["parents"]):
        raise _type_err("parents", "must be an array of ids")
    ps = x["parents"]
    for i in range(1, len(ps)):
        if not ps[i - 1] < ps[i]:
            raise Refused("parents_not_sorted", "parents: must be sorted ascending with no repeats, so one set of parents has one id")
    if x["charter"] is not None:
        c = x["charter"]
        if not isinstance(c, dict):
            raise _type_err("charter", "must be { id, clause } or null")
        _exact_keys(c, ["id", "clause"], "charter")
        if not is_id(c["id"]):
            raise _type_err("charter.id", "must be the charter id")
        if not one_line(c["clause"]):
            raise _type_err("charter.clause", "must be a clause id")
    a = _actor(x["actor"])
    _digests(x["inputs"], "inputs")
    _digests(x["outputs"], "outputs")
    if not one_line(x["action"]) or S.utf16_len(x["action"]) > 240:
        raise _type_err("action", "must be one line, \"<verb> <object>\", at most 240 characters")
    if x["claim"] is not None and (not is_str(x["claim"]) or len(x["claim"]) == 0):
        raise _type_err("claim", "must be a non-empty string or null")
    if x["claim"] is not None and not (kind == "step" and a["kind"] == "model"):
        raise Refused("claim_not_from_model_step", "claim: only a step by a model may carry a claim; people and tools record actions and checks")
    checks = validate_checks(x["checks"])
    t = x["tokens"]
    if not S.js_eq(t, "absent"):
        if not isinstance(t, dict):
            raise _type_err("tokens", "must be { in, out } or \"absent\" (declared, never estimated)")
        _exact_keys(t, ["in", "out"], "tokens")
        if not S.is_safe_integer(t["in"]) or not S.is_safe_integer(t["out"]) or t["in"] < 0 or t["out"] < 0:
            raise _type_err("tokens", "in and out must be whole numbers, zero or more")
    tm = x["time"]
    if not isinstance(tm, dict):
        raise _type_err("time", "must be { started, ended }")
    _exact_keys(tm, ["started", "ended"], "time")
    for k in ("started", "ended"):
        if tm[k] is not None and not is_iso(tm[k]):
            raise _type_err("time.%s" % k, "must be an ISO-8601 UTC time (YYYY-MM-DDTHH:MM:SS[.fff]Z), or null when not recorded (never invented)")
    if tm["started"] is not None and tm["ended"] is not None and date_parse(tm["ended"]) < date_parse(tm["started"]):
        raise Refused("time_order", "time: ended is before started")
    if x["closes"] is not None and not is_id(x["closes"]):
        raise _type_err("closes", "must be an id or null")
    if kind == "decision":
        if not isinstance(x["decision"], dict):
            raise _type_err("decision", "must be an object")
        _decision_block(x["decision"], x)
    elif kind == "guard":
        g = x["guard"]
        if not isinstance(g, dict):
            raise _type_err("guard", "must be { blocked, rule, shown }")
        _exact_keys(g, ["blocked", "rule", "shown"], "guard")
        if not is_str(g["blocked"]) or not g["blocked"] or not one_line(g["rule"]) or not is_str(g["shown"]):
            raise _type_err("guard", "blocked and rule must be non-empty, shown a string")
    elif kind == "claim-check":
        c = x["claim-check"]
        if not isinstance(c, dict):
            raise _type_err("claim-check", "must be { target, result }")
        _exact_keys(c, ["target", "result"], "claim-check")
        if a["kind"] == "model":
            raise Refused("claim_check_by_model", "claim-check: made by a tool or a person; a model's view of another frag is an inference")
        if len(checks) == 0:
            raise Refused("claim_check_without_evidence", "claim-check: carries at least one check, the evidence for its result")
        if not is_id(c["target"]):
            raise _type_err("claim-check.target", "must be the id of the frag judged")
        if c["target"] in ps:
            raise Refused("target_in_parents", "claim-check: the target is not a parent (judging a frag is not relying on it)")
        if not isinstance(c["result"], str) or c["result"] not in ("holds", "wrong", "cant-tell"):
            raise _type_err("claim-check.result", "must be holds, wrong or cant-tell")
    elif kind == "inference":
        nf = x["inference"]
        if not isinstance(nf, dict):
            raise _type_err("inference", "must be { opinion, prediction, tell }")
        _exact_keys(nf, ["opinion", "prediction", "tell"], "inference")
        if len(ps) == 0:
            raise Refused("inference_without_receipts", "inference: names the receipts it was read from as its parents")
        if a["kind"] == "person":
            raise Refused("inference_actor", "inference: made by a model or a tool")
        if not is_str(nf["opinion"]) or not nf["opinion"] or not is_str(nf["prediction"]) or not nf["prediction"]:
            raise _type_err("inference", "opinion and prediction must be non-empty strings")
        if nf["tell"] is not None and not one_line(nf["tell"]):
            raise _type_err("inference.tell", "must be a catalogue id or null")
    if kind != "inference":
        hit = next((c for c in checks if is_routing_checker(c["by"])), None)
        if hit:
            raise Refused("route_cannot_check", "checks: \"%s\" is a routing hit; it may appear only in an inference frag (as its tell), never as a "
                                                "check that could pass or stop a gate" % hit["by"])
        if a["kind"] == "tool" and is_routing_checker(a["tool"]["name"]):
            raise Refused("route_cannot_check", "actor: the tool \"%s\" is in the axiom namespace but not a predicate; a routing hit may appear only "
                                                "as an inference frag" % a["tool"]["name"])
    else:
        tell = x["inference"]["tell"]
        if tell is not None and tell.startswith(ROUTE_PREFIX) and not _ROUTE_TELL.fullmatch(tell):
            raise _type_err("inference.tell", "a routing tell is written %s<id>@<hash>" % ROUTE_PREFIX)
    if check_id:
        want = frag_id(x)
        if x["id"] != want:
            raise Refused("id_mismatch", "id: does not recompute (the content hashes to %s)" % want)
    return x


def short(i):
    return S.js_slice(i, 12)


# ---------------------------------------------------------------------------------------------------------------------
# charter.ts


def _ctype_err(where, what):
    return Refused("field_type", "charter %s: %s" % (where, what))


def _exact_c(o, keys, where):
    for k in keys:
        if k not in o:
            raise Refused("field_missing", "charter %s: the field \"%s\" is missing" % (where, k))
    for k in S.js_keys(o):
        if k not in keys:
            raise Refused("field_unexpected", "charter %s: the field \"%s\" is not part of %s" % (where, k, CHARTER_SCHEMA))


def _unit(x):
    return S.is_num(x) and math.isfinite(x) and 0 <= x <= 1


def charter_id(c):
    body = {k: v for k, v in c.items() if k not in ("id", "signatures")}
    return sha256(canonicalize(body))


def signing_message(c):
    body = {k: v for k, v in c.items() if k != "signatures"}
    return (SIGNING_PREFIX + canonicalize(body)).encode("utf-8", "surrogatepass")


def key_fingerprint(pem):
    return ed25519.key_fingerprint(pem)


_CLAUSE_ID = re.compile(r"[a-z0-9][a-z0-9._-]{0,31}")
_CHARTER_KEYS = ["schema", "id", "supersedes", "intake", "clauses", "thresholds", "roles", "findings", "deferral", "parties", "signatures"]


def _public_key(pem, where):
    if not isinstance(pem, str):
        raise _ctype_err(where, "must be an Ed25519 public key in SPKI PEM form, or null")
    try:
        return ed25519.public_key_bytes(pem)
    except ed25519.KeyError_ as e:
        if "but not Ed25519" in str(e):
            raise _ctype_err(where, "must be an Ed25519 public key")
        raise _ctype_err(where, "must be an Ed25519 public key in SPKI PEM form, or null")


def validate_charter(x):
    """validateCharter: shape, id, rules and signatures. Returns (charter, party reports); raises Refused."""
    if not isinstance(x, dict):
        raise Refused("field_type", "a charter is a JSON object")
    if not S.js_eq(get(x, "schema"), CHARTER_SCHEMA):
        raise Refused("schema_wrong", "charter schema: must be \"%s\"" % CHARTER_SCHEMA)
    _exact_c(x, _CHARTER_KEYS, "object")
    if not is_id(x["id"]):
        raise _ctype_err("id", "must be 64 lowercase hex characters")
    if x["supersedes"] is not None and not is_id(x["supersedes"]):
        raise _ctype_err("supersedes", "must be a charter id or null")
    it = x["intake"]
    if not isinstance(it, dict):
        raise _ctype_err("intake", "must be { why, who_for, perfect_version, proud_of }")
    _exact_c(it, ["why", "who_for", "perfect_version", "proud_of"], "intake")
    for k in ("why", "who_for", "perfect_version", "proud_of"):
        if not isinstance(it[k], str):
            raise _ctype_err("intake.%s" % k, "must be a string (empty when not answered)")
    if not isinstance(x["clauses"], list) or len(x["clauses"]) == 0:
        raise _ctype_err("clauses", "must hold at least one clause")
    ids = set()
    for i, c in enumerate(x["clauses"]):
        if not isinstance(c, dict):
            raise _ctype_err("clauses[%d]" % i, "must be { id, kind, text }")
        _exact_c(c, ["id", "kind", "text"], "clauses[%d]" % i)
        if not isinstance(c["id"], str) or not _CLAUSE_ID.fullmatch(c["id"]):
            raise _ctype_err("clauses[%d].id" % i, "must be a short lower-case id (c1, no-push)")
        if c["id"] in ids:
            raise Refused("clause_duplicate", "charter clauses: the id \"%s\" is used twice" % c["id"])
        ids.add(c["id"])
        if not isinstance(c["kind"], str) or c["kind"] not in CLAUSE_KINDS:
            raise _ctype_err("clauses[%d].kind" % i, "must be one of %s" % ", ".join(CLAUSE_KINDS))
        if not isinstance(c["text"], str) or not S.js_trim(c["text"]):
            raise _ctype_err("clauses[%d].text" % i, "must say what the clause binds")
    if not isinstance(x["thresholds"], list):
        raise _ctype_err("thresholds", "must be an array")
    classes = set()
    for i, t in enumerate(x["thresholds"]):
        if not isinstance(t, dict):
            raise _ctype_err("thresholds[%d]" % i, "must be { action_class, reversibility, act_at, ask_at }")
        _exact_c(t, ["action_class", "reversibility", "act_at", "ask_at"], "thresholds[%d]" % i)
        if not one_line(t["action_class"]):
            raise _ctype_err("thresholds[%d].action_class" % i, "must name an action class, or *")
        if t["action_class"] in classes:
            raise Refused("threshold_order", "charter thresholds: the action class \"%s\" has two rows" % t["action_class"])
        classes.add(t["action_class"])
        if not isinstance(t["reversibility"], str) or t["reversibility"] not in REVERSIBILITY:
            raise _ctype_err("thresholds[%d].reversibility" % i, "must be always, maybe or never (can it be undone?)")
        if not _unit(t["ask_at"]):
            raise _ctype_err("thresholds[%d].ask_at" % i, "must be a number from 0 to 1")
        if t["act_at"] is not None and not _unit(t["act_at"]):
            raise _ctype_err("thresholds[%d].act_at" % i, "must be a number from 0 to 1, or null (always ask)")
        if t["reversibility"] == "never" and t["act_at"] is not None:
            raise Refused("never_reversible_must_ask", "charter thresholds: \"%s\" cannot be undone, so it always asks: act_at is null" % t["action_class"])
        if t["act_at"] is not None and t["ask_at"] > t["act_at"]:
            raise Refused("threshold_order", "charter thresholds: \"%s\" asks above the point where it would act (ask_at %s > act_at %s)"
                          % (t["action_class"], js_str(t["ask_at"]), js_str(t["act_at"])))
    if not isinstance(x["roles"], list):
        raise _ctype_err("roles", "must be an array")
    for i, r in enumerate(x["roles"]):
        if not isinstance(r, dict):
            raise _ctype_err("roles[%d]" % i, "must be { scope, person, level }")
        _exact_c(r, ["scope", "person", "level"], "roles[%d]" % i)
        if not one_line(r["scope"]):
            raise _ctype_err("roles[%d].scope" % i, "must name a branch, or *")
        if not is_role(r["person"]):
            raise Refused("person_not_a_role", "charter roles[%d].person: must be a role, never a personal name or contact" % i)
        if not isinstance(r["level"], str) or r["level"] not in ROLE_LEVELS:
            raise _ctype_err("roles[%d].level" % i, "must be one of %s" % ", ".join(ROLE_LEVELS))
    if not isinstance(x["findings"], list):
        raise _ctype_err("findings", "must be an array")
    for i, f in enumerate(x["findings"]):
        if not isinstance(f, dict):
            raise _ctype_err("findings[%d]" % i, "must be { check, finding, source, maps_to }")
        _exact_c(f, ["check", "finding", "source", "maps_to"], "findings[%d]" % i)
        if not one_line(f["check"]):
            raise _ctype_err("findings[%d].check" % i, "must name a checker, or *")
        if not S.js_eq(f["finding"], "*") and not (isinstance(f["finding"], str) and f["finding"] in FINDINGS):
            raise _ctype_err("findings[%d].finding" % i, "must be pass, fail, cant-tell or *")
        if not S.js_eq(f["source"], "evidence") and not S.js_eq(f["source"], "inference"):
            raise _ctype_err("findings[%d].source" % i, "must be evidence or inference")
        if not isinstance(f["maps_to"], str) or f["maps_to"] not in EFFECTS:
            raise _ctype_err("findings[%d].maps_to" % i, "must be gate, flag or monitor")
        if f["source"] == "inference" and f["maps_to"] == "gate":
            raise Refused("inference_cannot_gate", "charter findings[%d]: an inference finding maps only to flag or monitor; an opinion never passes or "
                                                   "stops a gate" % i)
    d = x["deferral"]
    if not isinstance(d, dict):
        raise _ctype_err("deferral", "must be { policy, max_wait_s }")
    _exact_c(d, ["policy", "max_wait_s"], "deferral")
    if not S.js_eq(d["policy"], "now") and not S.js_eq(d["policy"], "next-breakpoint"):
        raise _ctype_err("deferral.policy", "must be now or next-breakpoint")
    if not S.is_safe_integer(d["max_wait_s"]) or d["max_wait_s"] < 0:
        raise _ctype_err("deferral.max_wait_s", "must be a whole number of seconds, zero or more")
    if not isinstance(x["parties"], list) or len(x["parties"]) == 0:
        raise _ctype_err("parties", "must name at least one party")
    keys = []
    for i, p in enumerate(x["parties"]):
        if not isinstance(p, dict):
            raise _ctype_err("parties[%d]" % i, "must be { kind, as, public_key }")
        _exact_c(p, ["kind", "as", "public_key"], "parties[%d]" % i)
        if not S.js_eq(p["kind"], "person") and not S.js_eq(p["kind"], "agent"):
            raise _ctype_err("parties[%d].kind" % i, "must be person or agent")
        if (not is_role(p["as"])) if p["kind"] == "person" else (not one_line(p["as"])):
            raise Refused("party_not_a_role", "charter parties[%d].as: a person party is named by role, never by name or contact; an agent party by the "
                                              "name it chose" % i)
        keys.append(None if p["public_key"] is None else _public_key(p["public_key"], "parties[%d].public_key" % i))
    want = charter_id(x)
    if x["id"] != want:
        raise Refused("id_mismatch", "charter id: does not recompute (the content hashes to %s)" % want)
    if not isinstance(x["signatures"], list):
        raise _ctype_err("signatures", "must be an array")
    msg = signing_message(x)
    signed_by = set()
    for i, s in enumerate(x["signatures"]):
        if not isinstance(s, dict):
            raise _ctype_err("signatures[%d]" % i, "must be { party, alg, signature }")
        _exact_c(s, ["party", "alg", "signature"], "signatures[%d]" % i)
        party = s["party"]
        if not S.is_safe_integer(party) or party < 0 or party >= len(keys):
            raise Refused("signature_invalid", "charter signatures[%d]: party %s is not in parties" % (i, js_str(party)))
        party = int(party)
        k = keys[party]
        if k is None:
            raise Refused("signature_invalid", "charter signatures[%d]: party %d has no key, so it cannot sign" % (i, party))
        if party in signed_by:
            raise Refused("signature_invalid", "charter signatures[%d]: party %d signed twice" % (i, party))
        if not S.js_eq(s["alg"], "ed25519") or not isinstance(s["signature"], str):
            raise Refused("signature_invalid", "charter signatures[%d]: alg is ed25519 and the signature base64" % i)
        if not ed25519.verify(k, msg, ed25519.b64decode_lenient(s["signature"])):
            raise Refused("signature_invalid", "charter signatures[%d]: the signature of party %d (%s) does not verify" % (i, party, js_str(x["parties"][party]["as"])))
        signed_by.add(party)
    parties = []
    for i, p in enumerate(x["parties"]):
        fp = hashlib.sha256(ed25519.spki_der(keys[i])).hexdigest() if keys[i] is not None else None
        parties.append({"index": i, "kind": p["kind"], "as": p["as"], "fingerprint": fp if p["public_key"] else None, "signed": i in signed_by})
    return x, parties


def _checker_name(by):
    """checkerName: `person:<role>` as it is; else the text before the last '@', or the whole id when that is empty."""
    if by.startswith("person:"):
        return by
    return by[:max(0, by.rfind("@"))] or by


def is_registered(charter, by):
    if not charter:
        return False
    name = _checker_name(by)
    if any(r["check"] != "*" and (r["check"] == by or r["check"] == name) for r in charter.get("findings", [])):
        return True
    return by.startswith("person:") and any(r["person"] == by[len("person:"):] for r in (charter.get("roles") or []))


def _row_effect(charter, by, finding, source):
    name = _checker_name(by)
    best, best_score = None, -1
    for r in (charter.get("findings", []) if charter else []):
        if r["source"] != source:
            continue
        cs = 2 if r["check"] == by else 1 if r["check"] == name else 0 if r["check"] == "*" else -1
        fs = 1 if r["finding"] == finding else 0 if r["finding"] == "*" else -1
        if cs < 0 or fs < 0:
            continue
        score = cs * 2 + fs
        if score > best_score:
            best, best_score = r, score
    if best:
        effect = best["maps_to"]
    elif source == "evidence":
        effect = "gate" if finding == "fail" else "flag" if finding == "cant-tell" else "monitor"
    else:
        effect = "flag" if finding == "fail" else "monitor"
    return "flag" if (source == "inference" and effect == "gate") else effect


def explain_finding(charter, by, finding, source, kind=None):
    registered = is_registered(charter, by)
    if kind == "claim-check" and not registered:
        return "flag", True
    effect = _row_effect(charter, by, finding, source)
    if effect == "gate" and not registered:
        return "flag", True
    return effect, False


def map_finding(rows, by, finding, source, kind=None):
    """The effect (gate, flag, monitor) of a finding under a charter's findings rows (check.mjs's mapFinding: no roles)."""
    return explain_finding({"findings": rows, "roles": []}, by, finding, source, kind)[0]


def read_gates(findings):
    """The gates read together: any fail is FAIL; else any cant-tell is can't tell; else a pass is PASS; none is can't tell."""
    if "fail" in findings:
        return "FAIL"
    if "cant-tell" in findings:
        return "can't tell"
    return "PASS" if "pass" in findings else "can't tell"


def clause_of(charter, cid):
    return next((c for c in charter["clauses"] if c["id"] == cid), None)


# ---------------------------------------------------------------------------------------------------------------------
# graph.ts


def _u16(s):
    return s.encode("utf-16-be", "surrogatepass")


def _by_time_then_id(f):
    return (_u16(f["time"]["started"] or ""), _u16(f["id"]))


class Graph(object):
    def __init__(self, allow_outside=False):
        self.allow_outside = allow_outside
        self.frags = {}
        self.charters = {}
        self.order = []
        self.outside = {}  # an ordered set
        self._kids = {}
        self._judged = {}
        self._answers = {}
        self._cache = None

    def has(self, i):
        return i in self.frags or i in self.charters

    def add_charter(self, c):
        charter, _ = validate_charter(c)
        if self.has(charter["id"]):
            raise Refused("duplicate", "charter %s is already in the graph" % short(charter["id"]))
        if charter["supersedes"] is not None and charter["supersedes"] not in self.charters:
            if not self.allow_outside:
                raise Refused("unknown_charter", "charter supersedes %s, which is not in the graph" % short(charter["supersedes"]))
            self.outside[charter["supersedes"]] = True
        self.charters[charter["id"]] = charter
        self.order.append(("charter", charter["id"]))
        return charter

    def add_frag(self, x):
        f = validate(x)
        if self.has(f["id"]):
            raise Refused("duplicate", "frag %s is already in the graph" % short(f["id"]))

        def missing(i, code, what):
            if self.allow_outside:
                self.outside[i] = True
                return
            raise Refused(code, "%s %s is not in the graph (add it first)" % (what, short(i)))
        for p in f["parents"]:
            if p not in self.frags:
                missing(p, "unknown_parent", "parent")
        if f["charter"]:
            c = self.charters.get(f["charter"]["id"])
            if not c:
                missing(f["charter"]["id"], "unknown_charter", "charter")
            elif not clause_of(c, f["charter"]["clause"]):
                raise Refused("unknown_clause", "charter %s has no clause \"%s\"" % (short(f["charter"]["id"]), f["charter"]["clause"]))
        cc = f.get("claim-check")
        if cc and cc["target"] not in self.frags:
            missing(cc["target"], "unknown_target", "target")
        if f["closes"] is not None:
            t = self.frags.get(f["closes"])
            if not t:
                missing(f["closes"], "closes_not_a_container", "the closed frag")
            elif t["level"] not in CONTAINER_LEVELS or f["closes"] not in self.ancestors_of(f["parents"]):
                raise Refused("closes_not_a_container", "closes: %s must be an ancestor at level task, run or branch" % short(f["closes"]))
        d = f.get("decision")
        if d and d["asks"] is not None:
            ask = self.frags.get(d["asks"])
            if not ask:
                missing(d["asks"], "answer_without_ask", "the ask")
            else:
                a = ask.get("decision")
                if not a or a["asks"] is not None:
                    raise Refused("answer_without_ask", "decision: %s is not an open ask" % short(d["asks"]))
                if canonicalize([a["question"], a["options"], a["reversibility"], a["deferral"], a["state_digest"]]) != \
                        canonicalize([d["question"], d["options"], d["reversibility"], d["deferral"], d["state_digest"]]):
                    raise Refused("answer_differs_from_ask", "decision: an answer repeats its ask's question, options, reversibility, deferral and state "
                                                             "digest exactly")
        self.frags[f["id"]] = f
        self.order.append(("frag", f["id"]))
        for p in f["parents"]:
            self._kids.setdefault(p, {})[f["id"]] = True
        if cc:
            self._judged.setdefault(cc["target"], []).append(f["id"])
        if d and d["asks"] is not None:
            self._answers.setdefault(d["asks"], []).append(f["id"])
        self._cache = None
        return f

    def get(self, i):
        return self.frags.get(i)

    def children(self, i):
        return list(self._kids.get(i, {}))

    def judgements_of(self, i):
        return list(self._judged.get(i, []))

    def answers_of(self, i):
        return list(self._answers.get(i, []))

    def descendants_of(self, ids):
        seen = {}
        stack = list(ids)
        while stack:
            for c in self._kids.get(stack.pop(), {}):
                if c not in seen:
                    seen[c] = True
                    stack.append(c)
        return seen

    def ancestors_of(self, ids):
        seen = {}
        stack = list(ids)
        while stack:
            i = stack.pop()
            if i in seen:
                continue
            seen[i] = True
            f = self.frags.get(i)
            for p in (f["parents"] if f else []):
                stack.append(p)
        return seen

    def statuses(self):
        """The derived status of every frag (SCHEMA.md section 5): {id: {status, marks, staleFrom, clearedFor}}."""
        if self._cache is not None:
            return self._cache
        frag_ids = [i for t, i in self.order if t == "frag"]
        wrong, marks = {}, {}
        for i in reversed(frag_ids):
            m = [c for c in self._judged.get(i, []) if self.frags[c]["claim-check"]["result"] == "wrong" and not wrong.get(c)]
            marks[i] = m
            wrong[i] = len(m) > 0
        info = {}
        for i in frag_ids:
            info[i] = {"status": "wrong" if wrong.get(i) else "ok", "marks": marks[i], "staleFrom": [], "clearedFor": []}
        anc_cache = {}

        def ancestors(i):
            a = anc_cache.get(i)
            if a is None:
                a = anc_cache[i] = self.ancestors_of([i])
            return a
        for root in frag_ids:
            if not wrong.get(root):
                continue
            root_marks = marks[root]

            def cleared_for_root(x):
                for h in self._judged.get(x, []):
                    hf = self.frags[h]
                    if hf["claim-check"]["result"] != "holds" or wrong.get(h):
                        continue
                    anc = ancestors(h)
                    if any(m in anc for m in root_marks):
                        return True
                return False
            seen = set()
            stack = list(self._kids.get(root, {}))
            while stack:
                x = stack.pop()
                if x in seen:
                    continue
                seen.add(x)
                if cleared_for_root(x):
                    continue
                info[x]["staleFrom"].append(root)
                for c in self._kids.get(x, {}):
                    stack.append(c)
            for x in self.descendants_of([root]):
                if cleared_for_root(x):
                    info[x]["clearedFor"].append(root)
        for xi in info.values():
            xi["staleFrom"].sort(key=_u16)
            xi["clearedFor"] = sorted({r for r in xi["clearedFor"] if r not in xi["staleFrom"]}, key=_u16)
            if xi["status"] != "wrong":
                xi["status"] = "stale" if xi["staleFrom"] else ("cleared" if xi["clearedFor"] else "ok")
        self._cache = info
        return info

    def status(self, i):
        s = self.statuses().get(i)
        if not s:
            raise Refused("unknown_parent", "%s is not a frag in this graph" % short(i))
        return s

    def heads(self):
        return sorted([f for f in self.frags.values() if not self._kids.get(f["id"])], key=_by_time_then_id)

    def state_digest(self, parents):
        st = self.statuses()
        members = list(parents) + list(self.descendants_of(parents))
        sset = {}
        for i in members:
            if i in self.frags and self.frags[i]["kind"] != "decision":
                sset[i] = True
        frontier = sorted([i for i in sset if not any(c in sset for c in self._kids.get(i, {}))], key=_u16)
        return sha256(canonicalize([[i, st[i]["status"]] for i in frontier]))

    def open_asks(self, within=None):
        st = self.statuses()
        return sorted([f for f in self.frags.values() if f.get("decision") and f["decision"]["asks"] is None and not self._answers.get(f["id"])
                       and st[f["id"]]["status"] != "wrong" and (within is None or f["id"] in within)], key=_by_time_then_id)

    def resolve(self, ref):
        if self.has(ref):
            return ref
        if not re.fullmatch(r"[0-9a-f]{8,64}", ref):
            raise Refused("unknown_parent", "\"%s\" is not an id or an id prefix of 8 or more hex characters" % ref)
        hits = [i for i in list(self.frags) + list(self.charters) if i.startswith(ref)]
        if len(hits) == 1:
            return hits[0]
        raise Refused("unknown_parent", "\"%s\" matches %d ids; give more characters" % (ref, len(hits)) if hits else "no frag or charter starts with \"%s\"" % ref)


def statuses(frags):
    """check.mjs's statuses: a graph built from the frags, parents first; {id: ok | wrong | stale | cleared}."""
    g = Graph()
    for f in frags:
        g.add_frag(f)
    return {i: x["status"] for i, x in g.statuses().items()}


def states(frags):
    """check.mjs's states: {id: needs you | ready for review | working} for every task, run and branch."""
    g = Graph()
    for f in frags:
        g.add_frag(f)
    out = {}
    for f in frags:
        s = container_state(g, f["id"])
        if s is not None:
            out[f["id"]] = s
    return out


# ---------------------------------------------------------------------------------------------------------------------
# digest.ts


_JS_SPACE = "[" + "".join("\\u%04x" % ord(c) for c in sorted(S._JS_WS)) + "]+"


def clip(s, n=80):
    t = S.js_trim(re.sub(_JS_SPACE, " ", s))
    return S.js_slice(t, n - 3) + "..." if S.utf16_len(t) > n else t


def plural(n, one, many=None):
    return "%d %s" % (n, one if n == 1 else (many or one + "s"))


def actor_words(a):
    if a["kind"] == "person":
        return "a person (%s)" % a["person"]
    if a["kind"] == "tool":
        return "tool %s@%s" % (a["tool"]["name"], a["tool"]["version"])
    m = a["model"]
    if m["declared"] is None:
        return "a model, none declared, not attested" if m["resolved"] is None else "model %s (none declared)" % m["resolved"]
    if m["resolved"] is None:
        return "model %s, not attested" % m["declared"]
    return "model %s" % m["resolved"] if m["resolved"] == m["declared"] else "model %s (declared %s)" % (m["resolved"], m["declared"])


def _why_words(g, f):
    if not f["charter"]:
        return "no charter clause"
    c = g.charters.get(f["charter"]["id"])
    cl = clause_of(c, f["charter"]["clause"]) if c else None
    return "clause %s: %s" % (cl["id"], clip(cl["text"], 70)) if cl else "clause %s (its charter is not in this graph)" % f["charter"]["clause"]


def _is_container(f):
    return f["level"] in CONTAINER_LEVELS


def _effect_words(e, finding):
    if e == "gate":
        return "gate, %s" % ("met" if finding == "pass" else "not met" if finding == "fail" else "can't tell")
    return e


def _explained(g, f, by, finding):
    charter = g.charters.get(f["charter"]["id"]) if f["charter"] else None
    return explain_finding(charter, by, finding, "inference" if f["kind"] == "inference" else "evidence", f["kind"])


def _score_of(g, f):
    st = g.statuses()
    checks = sorted([g.get(i) for i in g.judgements_of(f["id"]) if st[i]["status"] != "wrong" and g.get(i)["claim-check"]["result"] != "cant-tell"],
                    key=_by_time_then_id)
    return checks[-1]["claim-check"]["result"] if checks else None


def _stale_answer(f):
    d = f.get("decision")
    return bool(d and d["answer"]) and d["answer"]["state_digest"] != d["state_digest"]


def _below(g, f):
    st = g.statuses()
    ids = g.descendants_of([f["id"]])
    members = sorted([g.get(i) for i in ids], key=_by_time_then_id)
    flag = 0
    gates = []
    for m in members:
        for c in m["checks"]:
            e, unreg = _explained(g, m, c["by"], c["finding"])
            if e == "gate":
                gates.append(c["finding"])
            elif e == "flag" and (c["finding"] != "pass" or unreg):
                flag += 1
    return {
        "members": members,
        "wrong": [m for m in members if st[m["id"]]["status"] == "wrong"],
        "stale": [m for m in members if st[m["id"]]["status"] == "stale"],
        "gateNotMet": len([x for x in gates if x == "fail"]), "gateCantTell": len([x for x in gates if x == "cant-tell"]), "gates": gates, "flag": flag,
        "asks": g.open_asks(ids),
        "closing": [m for m in members if m["closes"] == f["id"]],
        "heads": [m for m in members if not any(c in ids for c in g.children(m["id"]))],
    }


def _state_of(b):
    if b["asks"]:
        return "needs you"
    if b["closing"]:
        return "ready for review"
    return "working"


def container_state(g, i):
    f = g.get(i)
    if not f:
        raise ValueError("%s is not a frag in this graph" % short(i))
    return _state_of(_below(g, f)) if _is_container(f) else None


def _relies(si):
    return "re-check: relies on %s%s, marked wrong" % (", ".join(short(x) for x in si["staleFrom"][:2]), " and more" if len(si["staleFrom"]) > 2 else "")


def _next_words(g, f, si, b):
    out = []
    if b:
        if b["asks"]:
            out.append("answer: %s%s" % (clip(b["asks"][0]["decision"]["question"], 70), " (+%d more)" % (len(b["asks"]) - 1) if len(b["asks"]) > 1 else ""))
        if si["status"] == "wrong":
            out.append("re-check %s that relied on it" % plural(len(b["stale"]) + len(b["wrong"]), "frag"))
        elif si["status"] == "stale":
            out.append(_relies(si))
        if b["stale"] and si["status"] != "wrong":
            out.append("re-check %s below" % plural(len(b["stale"]), "stale frag"))
        if not b["asks"] and b["closing"]:
            out.append("review: %s" % clip(sorted(b["closing"], key=_by_time_then_id)[-1]["action"], 70))
        if not out:
            hs = sorted(b["heads"], key=_by_time_then_id)
            out.append("last: %s" % clip(hs[-1]["action"], 70) if hs else "no step recorded yet")
        return out
    d = f.get("decision")
    if d and d["asks"] is None and len(g.answers_of(f["id"])) == 0 and si["status"] != "wrong":
        out.append("waiting on a person: %s" % clip(d["question"], 70))
    if si["status"] == "wrong":
        n = len([i for i in g.descendants_of([f["id"]]) if f["id"] in g.status(i)["staleFrom"]])
        out.append("re-check %s that relied on it" % plural(n, "frag") if n else "nothing relied on it")
    if si["status"] == "stale":
        out.append(_relies(si))
    if _stale_answer(f):
        out.append("ask again: the inputs moved while the question waited")
    if f["kind"] == "inference" and _score_of(g, f) is None:
        out.append("watching for: %s" % clip(f["inference"]["prediction"], 70))
    kids = sorted([g.get(i) for i in g.children(f["id"])], key=_by_time_then_id)
    if kids:
        out.append("followed by: %s%s" % (clip(kids[0]["action"], 60), " (+%d more)" % (len(kids) - 1) if len(kids) > 1 else ""))
    if not out:
        out.append("no later step recorded")
    return out


def digest_line(g, i):
    f = g.get(i)
    if not f:
        raise ValueError("%s is not a frag in this graph" % short(i))
    si = g.status(i)
    if _is_container(f):
        b = _below(g, f)
        state = _state_of(b)
        head = state if si["status"] == "ok" else "%s; %s" % (si["status"], state)
        parts = [plural(len(b["members"]), "frag"),
                 "%d wrong" % len(b["wrong"]) if b["wrong"] else "",
                 "%d stale" % len(b["stale"]) if b["stale"] else "",
                 "%d gate%s not met" % (b["gateNotMet"], "" if b["gateNotMet"] == 1 else "s") if b["gateNotMet"] else "",
                 "%d gate%s can't tell" % (b["gateCantTell"], "" if b["gateCantTell"] == 1 else "s") if b["gateCantTell"] else "",
                 "%d flagged" % b["flag"] if b["flag"] else "",
                 plural(len(b["asks"]), "open ask") if b["asks"] else ""]
        counts = ", ".join(p for p in parts if p)
        return "%s | doing: %s (%s, by %s) | why: %s | next: %s | below: %s" % (head, clip(f["action"], 70), f["level"], actor_words(f["actor"]),
                                                                               _why_words(g, f), _next_words(g, f, si, b)[0], counts)
    return "%s | doing: %s (%s, by %s) | why: %s | next: %s" % (si["status"], clip(f["action"], 70), f["kind"], actor_words(f["actor"]),
                                                              _why_words(g, f), _next_words(g, f, si, None)[0])


def digest_detail(g, i):
    f = g.get(i)
    if not f:
        raise ValueError("%s is not a frag in this graph" % short(i))
    st = g.statuses()
    si = st[i]
    L = [digest_line(g, i), "", "doing"]
    L.append("  action: %s" % f["action"])
    L.append("  record: %s at level %s, id %s" % (f["kind"], f["level"], f["id"]))
    L.append("  by: %s" % actor_words(f["actor"]))
    L.append("  claim: %s" % (f["claim"] if f["claim"] is not None else "none"))
    if not f["checks"]:
        L.append("  checks: none")
    else:
        L.append("  checks:")
        for c in f["checks"]:
            e, unreg = _explained(g, f, c["by"], c["finding"])
            words = "flag, unregistered checker: a person decides" if unreg else _effect_words(e, c["finding"])
            L.append("    - %s: %s (%s)%s" % (c["by"], "can't tell" if c["finding"] == "cant-tell" else c["finding"], words,
                                           ": %s" % clip(c["detail"], 100) if c["detail"] else ""))

    def dg(label, ds):
        if not ds:
            L.append("  %s: none" % label)
        else:
            L.append("  %s:" % label)
            for dd in ds:
                L.append("    - %s (sha256 %s)" % (dd["name"], dd["sha256"][:12]))
    dg("inputs", f["inputs"])
    dg("outputs", f["outputs"])
    L.append("  tokens: %s" % ("absent (not reported; never estimated)" if f["tokens"] == "absent" else "in %s, out %s" % (js_str(f["tokens"]["in"]), js_str(f["tokens"]["out"]))))
    t = f["time"]
    L.append("  time: %s" % ("not recorded" if t["started"] is None and t["ended"] is None else "%s to %s" % (
        t["started"] if t["started"] is not None else "start not recorded", t["ended"] if t["ended"] is not None else "end not recorded")))
    d = f.get("decision")
    if d:
        L.append("  question: %s" % d["question"])
        L.append("  options: %s" % " / ".join(d["options"]))
        L.append("  can it be undone: %s%s" % (d["reversibility"], " (so a person is always asked)" if d["reversibility"] == "never" else ""))
        L.append("  deferral: %s, at most %s s" % (d["deferral"]["policy"], js_str(d["deferral"]["max_wait_s"])))
        if d["answer"]:
            L.append("  answer: %s, by %s, at %s%s" % (d["answer"]["choice"], d["answer"]["who"], d["answer"]["when"],
                                                      " (given after the inputs moved)" if _stale_answer(f) else ""))
        else:
            L.append("  answer: %s" % ("given in a later frag" if g.answers_of(f["id"]) else "not yet"))
    gd = f.get("guard")
    if gd:
        L.extend(["  blocked: %s" % gd["blocked"], "  rule: %s" % gd["rule"], "  shown to the agent: %s" % (gd["shown"] or "(nothing)")])
    cc = f.get("claim-check")
    if cc:
        tf = g.get(cc["target"])
        L.append("  judges: %s%s" % (short(cc["target"]), " [%s] %s" % (st[tf["id"]]["status"], clip(tf["action"], 60)) if tf else " (not in this graph)"))
        L.append("  result: %s" % ("can't tell" if cc["result"] == "cant-tell" else cc["result"]))
    nf = f.get("inference")
    if nf:
        s = _score_of(g, f)
        L.extend(["  opinion (an inference, not evidence): %s" % nf["opinion"], "  prediction: %s" % nf["prediction"],
                  "  tell: %s" % (nf["tell"] if nf["tell"] is not None else "none named"),
                  "  scored: %s" % ("not yet" if s is None else "the prediction held" if s == "holds" else "the prediction did not hold")])
    L.append("why")
    L.append("  serves: %s" % _why_words(g, f))
    parents = sorted([g.get(p) for p in f["parents"] if g.get(p)], key=_by_time_then_id)
    if not f["parents"]:
        L.append("  relied on: nothing")
    else:
        L.append("  relied on:")
        for p in parents:
            L.append("    - %s [%s] %s" % (short(p["id"]), st[p["id"]]["status"], clip(p["action"], 70)))
        for p in sorted([p for p in f["parents"] if not g.get(p)], key=_u16):
            L.append("    - %s (not in this graph)" % short(p))
    if si["marks"]:
        L.append("  marked wrong by:")
        for m in sorted([g.get(x) for x in si["marks"]], key=_by_time_then_id):
            L.append("    - %s %s: %s" % (short(m["id"]), actor_words(m["actor"]), clip("; ".join(c["detail"] for c in m["checks"] if c["detail"]) or m["action"], 80)))
    L.append("next")
    b = _below(g, f) if _is_container(f) else None
    for nw in _next_words(g, f, si, b):
        L.append("  %s" % nw)
    if b:
        L.append("  below: %s; %d wrong, %d stale; gates read %s (%d met, %d not met, %d can't tell); %d flagged; %s" % (
            plural(len(b["members"]), "frag"), len(b["wrong"]), len(b["stale"]), read_gates(b["gates"]),
            len(b["gates"]) - b["gateNotMet"] - b["gateCantTell"], b["gateNotMet"], b["gateCantTell"], b["flag"], plural(len(b["asks"]), "open ask")))
        for a in b["asks"]:
            L.append("    - asks %s: %s" % (short(a["id"]), clip(a["decision"]["question"], 80)))
        for w in b["wrong"]:
            L.append("    - wrong %s: %s" % (short(w["id"]), clip(w["action"], 80)))
        for s2 in b["stale"]:
            L.append("    - stale %s: %s" % (short(s2["id"]), clip(s2["action"], 80)))
        L.append("  latest (finished steps collapse):" if b["heads"] else "  latest: none")
        for h in b["heads"]:
            L.append("    - %s [%s] %s" % (short(h["id"]), st[h["id"]]["status"], clip(h["action"], 80)))
        in_scope = [f["id"]] + [m["id"] for m in b["members"]]
        judgements = [g.get(j) for x in dict.fromkeys(in_scope) for j in g.judgements_of(x)]
        merged = {}
        for m in b["members"] + judgements:
            merged[m["id"]] = m
        calls = sorted([m for m in merged.values() if m["actor"]["kind"] == "person" and ((m.get("decision") and m["decision"]["answer"]) or m.get("claim-check"))],
                       key=_by_time_then_id)
        if calls:
            L.append("  steered by people:")
            for m in calls:
                if m.get("decision") and m["decision"]["answer"]:
                    L.append("    - %s answered \"%s\": %s" % (m["actor"]["person"], clip(m["decision"]["question"], 60), clip(m["decision"]["answer"]["choice"], 40)))
                else:
                    r = m["claim-check"]["result"]
                    L.append("    - %s judged %s %s" % (m["actor"]["person"], short(m["claim-check"]["target"]), "can't tell" if r == "cant-tell" else r))
    inside = sorted([g.get(a) for a in g.ancestors_of(f["parents"]) if g.get(a) and _is_container(g.get(a))], key=_by_time_then_id)
    if inside:
        L.append("  inside:")
        for c in inside:
            L.append("    - %s %s: %s" % (c["level"], short(c["id"]), clip(c["action"], 70)))
    return "\n".join(L) + "\n"


# ---------------------------------------------------------------------------------------------------------------------
# bundle.ts: the deposited file

_DEPOSIT_KEYS = ["schema", "note", "charters", "frags", "prose", "bundle_sha256"]


def prose_of(g):
    return {h["id"]: digest_line(g, h["id"]) for h in g.heads()}


def open_deposit(b, name):
    """openDeposit: {exit, lines, graph} from the file's bytes alone (0 intact, 2 something cannot be told here, 3 not a
    deposited file, 4 tampered)."""
    try:
        x = parse_strict_bytes(b, name)
    except StrictJsonRefused as e:
        return {"exit": 3, "lines": ["not a deposited work graph: %s" % e.message], "graph": None}
    if isinstance(x, dict) and S.js_eq(get(x, "schema"), FRAG_CHAIN_SCHEMA):
        return {"exit": 3, "lines": ["not a deposited work graph: %s is a frag work chain: open it with riposte-frag open (its schema is %s; this "
                                     "command opens %s)" % (name, FRAG_CHAIN_SCHEMA, BUNDLE_SCHEMA)], "graph": None}
    if not isinstance(x, dict) or not S.js_eq(get(x, "schema"), BUNDLE_SCHEMA):
        return {"exit": 3, "lines": ["not a deposited work graph: %s is not of the schema %s" % (name, BUNDLE_SCHEMA)], "graph": None}
    shape = all(k in x for k in _DEPOSIT_KEYS) and all(k in _DEPOSIT_KEYS for k in x) and isinstance(x["charters"], list) and \
        isinstance(x["frags"], list) and isinstance(x["prose"], dict) and isinstance(x["bundle_sha256"], str)
    if not shape:
        return {"exit": 3, "lines": ["not a deposited work graph: %s does not have the fields %s" % (name, ", ".join(_DEPOSIT_KEYS))], "graph": None}

    def bad(why):
        return {"exit": 4, "lines": [TAMPERED] + ["  %s" % w for w in why], "graph": None}
    body = {k: v for k, v in x.items() if k != "bundle_sha256"}
    want = hash_of(body)
    if x["bundle_sha256"] != want:
        return bad(["bundle_sha256 does not recompute (the content hashes to %s)" % want])
    g = Graph(allow_outside=True)
    tell = []
    party_lines = []
    for i, c in enumerate(x["charters"]):
        try:
            charter, parties = validate_charter(c)
            g.add_charter(charter)

            def pw(p):
                if p["signed"]:
                    return "signed, key sha256 %s" % p["fingerprint"][:16]
                return "keyed (sha256 %s) but not signed" % p["fingerprint"][:16] if p["fingerprint"] else "named, not signed"
            party_lines.append("charter %s: %s" % (short(charter["id"]), "; ".join("%s (%s): %s" % (p["kind"], p["as"], pw(p)) for p in parties)))
            for p in parties:
                if not p["signed"]:
                    tell.append("charter %s: the %s party \"%s\" has not signed" % (short(charter["id"]), p["kind"], p["as"]))
        except Refused as e:
            return bad(["charters[%d]: %s: %s" % (i, e.code, e.message)])
        except Exception as e:  # bundle.ts catches anything: an error without a code reads "refused"
            return bad(["charters[%d]: refused: %s" % (i, e)])
    for i, f in enumerate(x["frags"]):
        try:
            g.add_frag(f)
        except Refused as e:
            return bad(["frags[%d]: %s: %s" % (i, e.code, e.message)])
        except Exception as e:
            return bad(["frags[%d]: refused: %s" % (i, e)])
    early = [i for i in g.outside if g.has(i)]
    if early:
        return bad(["%d frag(s) appear after a frag that relies on them (%s); a deposit lists parents first" % (len(early), ", ".join(short(i) for i in early[:3]))])
    if g.outside:
        out_ids = sorted(g.outside, key=_u16)
        tell.append("%d id(s) referenced but not in this file: %s%s" % (len(out_ids), ", ".join(short(i) for i in out_ids[:5]), ", ..." if len(out_ids) > 5 else ""))
    prose = prose_of(g)
    carried = x["prose"]
    diffs = []
    for i in dict.fromkeys(S.js_keys(prose) + S.js_keys(carried)):
        # carried[id] !== prose[id]; `id in o` is also true for Object.prototype's names, as on any plain JavaScript object
        if i in prose and i in carried and isinstance(carried[i], str) and carried[i] == prose[i]:
            continue
        in_prose = i in prose or i in _PROTO
        in_carried = i in carried or i in _PROTO
        diffs.append("prose for %s: %s" % (short(i), ("differs from what the graph generates" if in_carried else "missing") if in_prose
                                           else "is not a head of this graph"))
    if diffs:
        return bad(diffs[:5])
    st = g.statuses()

    def count(s):
        return len([v for v in st.values() if v["status"] == s])
    lines = ["%s: intact%s: %d frag(s), %d charter(s); bundle sha256 %s" % (BUNDLE_SCHEMA, ", and some things cannot be told here" if tell else "",
                                                                             len(g.frags), len(g.charters), want)]
    lines += party_lines
    lines.append("statuses: %d ok, %d wrong, %d stale, %d cleared; %d open ask(s)" % (count("ok"), count("wrong"), count("stale"), count("cleared"), len(g.open_asks())))
    if tell:
        lines.append("can't tell here:")
        lines += ["  %s" % t for t in tell]
    lines.append("heads (generated, re-derived from the graph):")
    lines += ["  %s %s" % (short(h["id"]), prose[h["id"]]) for h in g.heads()]
    return {"exit": 2 if tell else 0, "lines": lines, "graph": g}


# ---------------------------------------------------------------------------------------------------------------------
# head.ts + store.ts: a store's index chain and head record (read only)


def _tampered(what):
    return Refused("store_tampered", "store: %s" % what)


def _lines(k):
    return "%d line%s" % (k, "" if k == 1 else "s")


def _read_text_lossy(path):
    """readFileSync(path, 'utf8'): bytes that are not UTF-8 read as U+FFFD."""
    with open(path, "rb") as fh:
        return fh.read().decode("utf-8", "replace")


def parse_store_head(text):
    def unreadable(why):
        raise _tampered("the head record %s %s, so it cannot say where the index ends; if nothing else touched the store, delete it: the next append "
                        "checks the whole store and writes it again" % (STORE_HEAD_FILE, why))
    try:
        r = parse_strict(text, STORE_HEAD_FILE)
    except StrictJsonRefused:
        unreadable("does not parse")
    if not isinstance(r, dict) or ",".join(sorted(r.keys(), key=_u16)) != "bytes,count,head,version" or not S.js_eq(r["version"], 1.0) or \
            not S.is_safe_integer(r["bytes"]) or r["bytes"] < 0 or not S.is_safe_integer(r["count"]) or r["count"] < 0 or \
            not isinstance(r["head"], str) or not HEX64.fullmatch(r["head"]):
        unreadable("is not { bytes, count, head, version }")
    h = {"bytes": int(r["bytes"]), "count": int(r["count"]), "head": r["head"]}
    if (h["count"] == 0) != (h["bytes"] == 0) or (h["count"] == 0 and h["head"] != ZERO):
        unreadable("records %s in %d bytes with head %s, which cannot all be true" % (_lines(h["count"]), h["bytes"], S.ellipsis16(h["head"])))
    return h


def check_lines_against_head(index_lines, h):
    n = len(index_lines)
    if n < h["count"]:
        k = h["count"] - n
        raise _tampered("%s holds %s, but its head record %s says %d: the last %s %s removed or the index was rewritten"
                        % (INDEX, _lines(n), STORE_HEAD_FILE, h["count"], _lines(k), "was" if k == 1 else "were"))
    if h["count"] > 0:
        at = sha256(index_lines[h["count"] - 1])
        if at != h["head"]:
            raise _tampered("line %d of %s is not the one its head record %s names (the record says hash %s, the index has %s there): the index was rewritten"
                            % (h["count"], INDEX, STORE_HEAD_FILE, S.ellipsis16(h["head"]), S.ellipsis16(at)))
    nbytes = sum(S.byte_length(index_lines[i]) + 1 for i in range(h["count"]))
    if nbytes != h["bytes"]:
        raise _tampered("%s holds %d bytes up to the end of line %d, but its head record %s says %d: bytes were added to or removed from the lines it covers"
                        % (INDEX, nbytes, h["count"], STORE_HEAD_FILE, h["bytes"]))
    if n > h["count"]:
        return ("the head record %s covers %d of the %d index lines (an append stopped before it wrote the head); the next append checks the whole store "
                "and writes it again" % (STORE_HEAD_FILE, h["count"], n))
    return None


def is_store(d):
    return os.path.exists(os.path.join(d, INDEX)) and os.path.exists(os.path.join(d, "frags"))


def _read_stored(d, sub, i):
    p = os.path.join(d, sub, "%s.json" % i)
    try:
        with open(p, "rb") as fh:
            b = fh.read()
    except FileNotFoundError:
        raise _tampered("%s/%s.json is indexed but missing" % (sub, i))
    obj = parse_strict_bytes(b, "%s/%s.json" % (sub, i))
    if b.decode("utf-8") != canonicalize(obj) + "\n":
        raise _tampered("%s/%s.json is not the canonical JSON its id was taken over" % (sub, i))
    return obj


def load_store(d):
    """loadStore: (graph, notes), re-checking every id, file name, the index chain, every indexed file, and the head record."""
    if not is_store(d):
        raise Refused("field_missing", "%s is not a work graph store (run \"workgraph init\" there first)" % d)
    hp = os.path.join(d, STORE_HEAD_FILE)
    head_text = _read_text_lossy(hp) if os.path.exists(hp) else None
    graph = Graph()
    notes = []
    text = _read_text_lossy(os.path.join(d, INDEX))
    lines = text.split("\n")
    if lines[-1] != "":
        raise _tampered("%s does not end with a newline (a line was cut short)" % INDEX)
    lines.pop()
    prev = ZERO
    indexed = set()
    for i, line in enumerate(lines):
        try:
            e = parse_strict_bytes(line.encode("utf-8", "surrogatepass"), "%s line %d" % (INDEX, i + 1))
        except StrictJsonRefused as err:
            raise _tampered(err.message)
        if canonicalize(e) != line:
            raise _tampered("%s line %d is not in canonical form" % (INDEX, i + 1))
        if e is None:
            raise _tampered("%s line %d is not an index line (JSON null)" % (INDEX, i + 1))
        if not S.js_eq(get(e, "seq"), float(i)):
            raise _tampered("%s line %d says seq %s; lines were removed or reordered" % (INDEX, i + 1, js_str(get(e, "seq"))))
        if not S.js_eq(get(e, "prev"), prev):
            raise _tampered("%s line %d does not chain to the line before it" % (INDEX, i + 1))
        prev = sha256(line)
        typ = get(e, "type")
        sub = "frags" if S.js_eq(typ, "frag") else "charters" if S.js_eq(typ, "charter") else None
        if not sub:
            raise _tampered("%s line %d has an unknown type" % (INDEX, i + 1))
        eid = js_str(get(e, "id"))
        obj = _read_stored(d, sub, eid)
        try:
            if typ == "frag":
                if not S.js_eq(get(obj, "schema"), WORK_FRAG_SCHEMA):
                    raise Refused("schema_wrong", "not a work frag")
                graph.add_frag(obj)
            else:
                if not S.js_eq(get(obj, "schema"), CHARTER_SCHEMA):
                    raise Refused("schema_wrong", "not a charter")
                graph.add_charter(obj)
        except Refused as r:
            raise _tampered("%s/%s.json: %s%s" % (sub, eid, "%s: " % r.code if r.code else "", r.message))
        if not S.js_eq(get(obj, "id"), get(e, "id")):
            raise _tampered("%s/%s.json holds %s" % (sub, eid, S.js_slice(js_str(get(obj, "id")), 12)))
        indexed.add("%s/%s.json" % (sub, eid))
    if head_text is not None:
        behind = check_lines_against_head(lines, parse_store_head(head_text))
        if behind:
            notes.append(behind)
    for sub in ("frags", "charters"):
        p = os.path.join(d, sub)
        if not os.path.isdir(p):
            raise OSError("ENOENT: no such file or directory, scandir '%s'" % p)  # readdirSync's words
        for name in os.listdir(p):
            if name.endswith(".json") and "%s/%s" % (sub, name) not in indexed:
                notes.append("%s/%s is not in the index (a write that did not finish, or a file added by hand); it is not part of the graph" % (sub, name))
    return graph, notes


# ---------------------------------------------------------------------------------------------------------------------
# cli.ts (the reading verbs)

USAGE = "\n".join([
    "prototype; no measured accuracy",
    "usage: python3 conformance/engine_py/record/workgraph.py <verb> [options]   (the store is --store <dir>, else $WORKGRAPH_STORE, else ./.workgraph)",
    "  open <file.workgraph.json> [--json]        check a deposited file with no other file (exit 0, 2, 3 or 4)",
    "  status [--json]                            counts, wrong, stale, open asks (the store's index chain and head record re-checked)",
    "  digest <id> [--detail]                     doing / why / next, generated from the graph",
    "  charter check <charter.json>               verify the id and every signature; list the parties",
    "  (a reader: init, add, invalidate, check, deposit, open --into, charter parse and charter sign write, and are the workgraph command's)",
])
_VALUE = {"--store", "--by", "--reason", "--evidence", "--time", "--result", "--compare", "--out", "--into", "--party", "--key"}
_BOOL = {"--json", "--detail", "--help"}


class UsageError(Exception):
    pass


def _parse(args):
    flags, bools, rest = {}, set(), []
    i = 0
    while i < len(args):
        a = args[i]
        if a in _VALUE:
            i += 1
            if i >= len(args):
                raise UsageError("%s needs a value" % a)
            flags[a] = args[i]
        elif a in _BOOL:
            bools.add(a)
        elif a.startswith("--"):
            raise UsageError("unknown option %s" % a)
        else:
            rest.append(a)
        i += 1
    return flags, bools, rest


def main(argv, out=None, err=None, env=None, cwd=None):
    out = out or sys.stdout
    err = err or sys.stderr
    env = os.environ if env is None else env
    cwd = cwd or os.getcwd()

    def at(p):
        return p if os.path.isabs(p) else os.path.normpath(os.path.join(cwd, p))

    def say(s):
        out.write(s if s.endswith("\n") else s + "\n")
    try:
        verb = argv[0] if argv else None
        args = argv[1:]
        if not verb:
            err.write(USAGE + "\n")
            return 3
        if verb in ("help", "--help"):
            say(USAGE)
            return 0
        flags, bools, rest = _parse(args)
        store = at(flags.get("--store") or env.get("WORKGRAPH_STORE") or ".workgraph")
        if verb in ("init", "add", "invalidate", "check", "deposit"):
            raise UsageError("%s writes to a store; this reader only reads (node packages/workgraph/dist/cli.js %s)" % (verb, verb))
        if verb == "status":
            graph, notes = load_store(store)
            st = graph.statuses()

            def by(s):
                return [graph.get(i) for i, v in st.items() if v["status"] == s]
            asks = graph.open_asks()
            if "--json" in bools:
                say(S.stringify({"frags": len(graph.frags), "charters": len(graph.charters), "wrong": [f["id"] for f in by("wrong")],
                                 "stale": [f["id"] for f in by("stale")], "cleared": [f["id"] for f in by("cleared")],
                                 "open_asks": [f["id"] for f in asks], "notes": notes}))
                return 0
            say("%d frag(s), %d charter(s): %d ok, %d wrong, %d stale, %d cleared; %d open ask(s)" % (
                len(graph.frags), len(graph.charters), len(by("ok")), len(by("wrong")), len(by("stale")), len(by("cleared")), len(asks)))
            for s in ("wrong", "stale", "cleared"):
                for f in by(s):
                    say("  %s %s %s" % (s, short(f["id"]), f["action"]))
            for a in asks:
                say("  asks %s %s" % (short(a["id"]), a["decision"]["question"]))
            for nt in notes:
                say("note: %s" % nt)
            return 0
        if verb == "digest":
            if len(rest) != 1:
                raise UsageError("digest takes one id")
            if "--compare" in flags:
                raise UsageError("--compare is the workgraph command's (node packages/workgraph/dist/cli.js digest --compare)")
            graph, _ = load_store(store)
            i = graph.resolve(rest[0])
            out.write(digest_detail(graph, i) if "--detail" in bools else digest_line(graph, i) + "\n")
            return 0
        if verb == "open":
            if len(rest) != 1:
                raise UsageError("open takes one file")
            if "--into" in flags:
                raise UsageError("--into writes to a store; this reader only reads (node packages/workgraph/dist/cli.js open --into)")
            f = at(rest[0])
            if not os.path.exists(f):
                err.write("no such file: %s\n" % rest[0])
                return 3
            with open(f, "rb") as fh:
                r = open_deposit(fh.read(), rest[0])
            if "--json" in bools:
                say(S.stringify({"exit": r["exit"], "lines": r["lines"]}))
            else:
                for ln in r["lines"]:
                    say(ln)
            return r["exit"]
        if verb == "charter":
            sub = rest[0] if rest else None
            file = rest[1] if len(rest) > 1 else None
            if not sub or not file:
                raise UsageError("charter parse|sign|check <file>")
            if sub in ("parse", "sign"):
                raise UsageError("charter %s writes; this reader only reads (node packages/workgraph/dist/cli.js charter %s)" % (sub, sub))
            if sub != "check":
                raise UsageError("unknown charter verb %s" % sub)
            with open(at(file), "rb") as fh:
                charter, parties = validate_charter(parse_strict_bytes(fh.read(), file))
            say("charter %s: the id recomputes and every signature present verifies" % charter["id"])
            for p in parties:
                say("  party %d: %s (%s): %s" % (p["index"], p["kind"], p["as"], "signed, key sha256 %s" % p["fingerprint"] if p["signed"] else (
                    "keyed (sha256 %s), not signed" % p["fingerprint"] if p["fingerprint"] else "named, not signed")))
            return 0 if all(p["signed"] for p in parties) else 2
        raise UsageError("unknown verb %s" % verb)
    except UsageError as e:
        err.write("%s\n%s\n" % (e, USAGE))
        return 3
    except (Refused, StrictJsonRefused) as e:
        err.write("refused (%s): %s\n" % (e.code, e.message))
        return 1
    except (OSError, ValueError) as e:
        err.write("%s\n" % e)
        return 1


if __name__ == "__main__":
    S.utf8_streams()
    sys.exit(main(sys.argv[1:]))
