# Load and validate a declarative ruleset, as the Node command line reads `--ruleset`. prototype; no measured accuracy.
# SPDX-License-Identifier: Apache-2.0
"""
A port of packages/verify/src/rulesets/declarative.ts (the rulesets carried by name, the default version per engine label)
and of the command line's readRulesetArg (src/cli.ts): a carried name resolves to a verbatim copy of its file (in rulesets/
beside this file; test_declarative.py pins each copy's sha256 to the Node package's docs/examples file), anything else is read
as a JSON file under the hash contract. What the Node loader refuses is refused here in its words:

  a name nobody carries, and no such file   no ruleset named "<arg>" (did you mean <name>?); known: ...; or the path of a ruleset JSON file
  a carried id at a version not carried     ruleset <id>@<version> is not one this build carries; it carries <id>@<v>, ...
  a file that is not readable JSON          the reader's refusal (invalid UTF-8, a byte-order mark, a repeated key, ...)

A file that is JSON but not a declarative ruleset is refused here too (the Node command line hands it to the built-in path,
where it fails without a verdict); and lint_ruleset (lint.py) checks one before it runs, as `verify lint` does.
"""

import copy
import os
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import jsrt as J  # noqa: E402

E = J.E
rb = J.rb
RULESET_DIR = os.path.join(HERE, "rulesets")

# id, version, file (verbatim copies of products/verify/docs/examples/<file>)
CARRIED = [("peppol-en16931", "0.1.0", "peppol-en16931.ruleset.json"),
           ("peppol-en16931", "0.2.0", "peppol-en16931.ruleset.v0.2.json"),
           ("peppol-en16931", "0.3.0", "peppol-en16931.ruleset.v0.3.json")]
CARRIED_SHA256 = {"peppol-en16931.ruleset.json": "0a3cd5a52e6a835a8649ac8fa831bce47906ae77e5be2bdb85a70d1a9a0cd81c",
                  "peppol-en16931.ruleset.v0.2.json": "c0e1ae6cc4c8bf6894caedc11c2cbfb9ea351169c09752a1cbd572603d66b66d",
                  "peppol-en16931.ruleset.v0.3.json": "20e0d12fe16f8910780bb7c9a768508b9fea2d0e74936f43074abed0d9b1ebe7"}
DEFAULT_VERSIONS = {"peppol-en16931": "0.3.0"}                 # engine 0.6.0 and later
DEFAULT_VERSIONS_BEFORE_0_6_0 = {"peppol-en16931": "0.2.0"}    # engines 0.0.1 to 0.5.0
DOMAIN_DEFAULTS = {"e-invoice": "peppol-en16931"}
BUILTIN = ("invoice", "pay-app")

_cache = {}


class RulesetRefused(Exception):
    """A --ruleset the Node loader refuses (the command line's exit 3), in its words. `lead` is how the command line leads the
    line: "verify:" for a name nobody carries (its ArgRefused), "error reading reference:" for a version not carried (a plain
    Error the resolver throws)."""

    def __init__(self, message, lead="verify:"):
        Exception.__init__(self, message)
        self.lead = lead


def _carried(id_, version):
    for i, v, f in CARRIED:
        if i == id_ and v == version:
            if f not in _cache:
                with open(os.path.join(RULESET_DIR, f), "rb") as fh:
                    _cache[f] = rb.read_json_bytes(fh.read(), f)
            return copy.deepcopy(_cache[f])
    return None


def default_versions(engine=None):
    engines = list(E.ENGINES)
    e = engine if engine in engines else engines[-1]
    return DEFAULT_VERSIONS if engines.index(e) >= engines.index("0.6.0") else DEFAULT_VERSIONS_BEFORE_0_6_0


def is_carried_name(ref):
    if not isinstance(ref, str):
        return False
    id_ = ref.split("@")[0]
    if id_ in DOMAIN_DEFAULTS:
        return "@" not in ref
    return any(i == id_ for i, _, _ in CARRIED)


def _latest(id_):
    vs = [v for i, v, _ in CARRIED if i == id_]
    vs.sort(key=lambda v: [int(x) if x.isdigit() else float("nan") for x in v.split(".")])
    return vs[-1] if vs else None


def resolve_carried(ref, engine=None):
    """resolveDeclarativeRuleset: a fresh copy of the carried ruleset, None when `ref` is not a carried name. A carried id at a
    version not carried is refused, naming the versions that are. A bare id takes the default version under `engine`."""
    if not is_carried_name(ref):
        return None
    parts = ref.split("@")
    name, asked = parts[0], (parts[1] if len(parts) > 1 else None)
    id_ = DOMAIN_DEFAULTS.get(name, name)
    version = asked if asked is not None else (default_versions(engine).get(id_) or _latest(id_))
    hit = _carried(id_, version)
    if hit is None:
        raise RulesetRefused("ruleset %s@%s is not one this build carries; it carries %s" % (
            id_, version, ", ".join("%s@%s" % (i, v) for i, v, _ in CARRIED if i == id_)), lead="error reading reference:")
    return hit


def carried_names():
    ids = []
    for i, _, _ in CARRIED:
        if i not in ids:
            ids.append(i)
    return ids + ["%s@%s" % (i, v) for i, v, _ in CARRIED] + list(DOMAIN_DEFAULTS.keys())


def known_names():
    return list(BUILTIN) + carried_names()


def _edit_distance(a, b):
    d = [[i] + [0] * len(b) for i in range(len(a) + 1)]
    for j in range(1, len(b) + 1):
        d[0][j] = j
    for i in range(1, len(a) + 1):
        for j in range(1, len(b) + 1):
            d[i][j] = min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (0 if a[i - 1] == b[j - 1] else 1))
    return d[len(a)][len(b)]


def did_you_mean(unknown, known):
    name = unknown.split("=", 1)[0]
    best, best_d = None, 3
    for k in known:
        dd = _edit_distance(J.units(name), J.units(k))
        if dd < best_d:
            best, best_d = k, dd
    return " (did you mean %s?)" % best if best is not None and best != name else ""


def is_declarative_ruleset(x):
    return isinstance(x, dict) and "compute" not in x and (x.get("fields", J.UNDEF) is None or isinstance(x.get("fields"), (dict, list))) \
        and isinstance(x.get("checks"), list)


def load_ruleset(arg, engine=None):
    """readRulesetArg: a carried name, else a JSON file. Raises RulesetRefused (the words of the Node loader) or rb.Refused."""
    named = resolve_carried(arg, engine)
    if named is not None:
        return named
    if arg in BUILTIN:
        raise RulesetRefused("%s is a built-in ruleset, not a declarative one; this folder re-performs declarative rulesets only "
                             "(the invoice ruleset is conformance/engine_py/engine.py's)" % arg)
    if not os.path.exists(arg):
        raise RulesetRefused("no ruleset named \"%s\"%s; known: %s; or the path of a ruleset JSON file" % (arg, did_you_mean(arg, known_names()), ", ".join(known_names())))
    with open(arg, "rb") as fh:
        rs = E.read_json(fh.read(), arg)
    if not is_declarative_ruleset(rs):
        raise RulesetRefused("%s is not a declarative ruleset: it needs \"fields\" (an object) and \"checks\" (a list), and no \"compute\"" % arg)
    return rs


def read_ruleset_bytes(data, name="ruleset"):
    """A ruleset handed over as bytes (a bundle's inputs carry it parsed; this is for a file a caller already read)."""
    rs = E.read_json(data, name)
    if not is_declarative_ruleset(rs):
        raise RulesetRefused("%s is not a declarative ruleset: it needs \"fields\" (an object) and \"checks\" (a list), and no \"compute\"" % name)
    return rs
