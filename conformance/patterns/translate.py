# SPDX-License-Identifier: Apache-2.0
"""riposte.pattern/0.1.0: the pattern dialect (SPEC.md in this folder), read into Python's standard `re`.

Python 3.10 or later, standard library only. translate.mjs reads the same grammar into JavaScript; vectors.json is the
contract both answer.

    from translate import translate, compile_pattern, test, first_match
    t = translate(r'\\bwire\\s+details\\b', 'i')      # {'source': ..., 'flags': re.ASCII, ...} or raises PatternRefused
    test(compile_pattern(r'\\p{L}+', ''), 'abc')      # 'match' | 'no match' | "can't tell"

Command line:
    python translate.py <pattern> [flags]                 prints the re source and flags as JSON
    python translate.py <pattern> [flags] --test <text>   prints match, no match or can't tell
Exit 0 translated, or the text matches; 1 the text does not match; 2 can't tell; 3 refused (the position and the reason
are printed), or a usage error.
"""
import json
import os
import re
import sys

DIALECT = "riposte.pattern/0.1.0"
TABLE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "unicode-classes.json")
MAX_CODE_POINT = 0x10FFFF
MAX_COUNT = 1000
INF = float("inf")

# The reasons a pattern is refused, by code. Both translators use these words.
REASONS = {
    "usage": "the pattern and its flags must be strings",
    "flag": "a flag other than i is outside the dialect",
    "outside-plane": "a lone surrogate, or a character outside the Basic Multilingual Plane written as itself (write \\u{...}), is outside the dialect's pattern text",
    "backreference": "a backreference is outside the dialect: JavaScript matches an unset group as empty, Python fails",
    "named-group": "a named group is outside the dialect: the two languages spell it differently",
    "group-syntax": "this group syntax is outside the dialect (only (...), (?:...), (?=...), (?!...), (?<=...) and (?<!...))",
    "property": "this property class is outside the dialect: only the classes of the pinned table (L, Lu, Ll, N, Mn)",
    "escape": "this escape is outside the dialect: the two languages read it differently, or no pack pattern uses it",
    "lookbehind-width": "a lookbehind must match a fixed number of characters: Python refuses any other",
    "quantified-assertion": "a quantifier on an assertion is outside the dialect",
    "nothing-to-repeat": "a quantifier with nothing to repeat",
    "count": "a count must be at most 1000, with the lower bound not above the upper",
    "brace": "a lone {, } or ] is outside the dialect: escape it",
    "class-range": "a class range must run between two characters, low to high",
    "empty-class": "an empty class, [] or [^], is outside the dialect",
    "unclosed": "a group or a class is not closed, or a ) has no group",
    "trailing-backslash": "the pattern ends in a backslash",
    "case-fold": "a character outside ASCII that has another case, under the i flag: the dialect folds ASCII letters only",
    "cased-class-fold": "the class Lu or Ll under the i flag: JavaScript's Unicode mode reads either case, the dialect one",
}


class PatternRefused(Exception):
    def __init__(self, code, at):
        super().__init__("refused%s: %s" % ("" if at is None else " at %d" % at, REASONS[code]))
        self.code = code
        self.at = at


_default_table = None


def load_table(path=None):
    """The pinned class table (unicode-classes.json), read once."""
    global _default_table
    if path is None and _default_table is not None:
        return _default_table
    with open(path or TABLE_FILE, encoding="utf-8") as f:
        t = json.load(f)
    if path is None:
        _default_table = t
    return t


# -- ranges: sorted, merged lists of [lo, hi] code points ------------------------------------------------------------------
def norm(ranges):
    out = []
    for a, b in sorted([a, b] for a, b in ranges):
        if out and a <= out[-1][1] + 1:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return out


def complement(ranges):
    out = []
    nxt = 0
    for a, b in norm(ranges):
        if a > nxt:
            out.append([nxt, a - 1])
        nxt = b + 1
    if nxt <= MAX_CODE_POINT:
        out.append([nxt, MAX_CODE_POINT])
    return out


def intersects(ranges, lo, hi):
    return any(a <= hi and b >= lo for a, b in ranges)


def in_ranges(ranges, cp):
    lo, hi = 0, len(ranges) - 1
    while lo <= hi:
        mid = (lo + hi) >> 1
        if cp < ranges[mid][0]:
            hi = mid - 1
        elif cp > ranges[mid][1]:
            lo = mid + 1
        else:
            return True
    return False


def ascii_fold(ranges):
    """Adds the other case of every ASCII letter in the ranges (the dialect's i flag)."""
    add = []
    for a, b in ranges:
        ua, ub = max(a, 0x41), min(b, 0x5A)
        if ua <= ub:
            add.append([ua + 32, ub + 32])
        la, lb = max(a, 0x61), min(b, 0x7A)
        if la <= lb:
            add.append([la - 32, lb - 32])
    return norm(list(ranges) + add)


DIGIT = [[0x30, 0x39]]
WORD = [[0x30, 0x39], [0x41, 0x5A], [0x5F, 0x5F], [0x61, 0x7A]]
# ECMAScript's WhiteSpace and LineTerminator, written out: the dialect's \s on every reader.
SPACE = [[0x09, 0x0D], [0x20, 0x20], [0xA0, 0xA0], [0x1680, 0x1680], [0x2000, 0x200A], [0x2028, 0x2029], [0x202F, 0x202F],
         [0x205F, 0x205F], [0x3000, 0x3000], [0xFEFF, 0xFEFF]]
DOT_EXCLUDES = [[0x0A, 0x0A], [0x0D, 0x0D], [0x2028, 0x2029]]
SYNTAX = "^$\\.*+?()[]{}|"
QUANT = re.compile(r"\{([0-9]+)(,([0-9]*))?\}")
PROPERTY = re.compile(r"[pP]\{([A-Za-z_=]+)\}")
HEX4 = re.compile(r"u([0-9A-Fa-f]{4})")
BRACED = re.compile(r"u\{([0-9A-Fa-f]{1,6})\}")
NAME_START = re.compile(r"[A-Za-z_$]")


def parse(source, flags="", table=None):
    """Parses a pattern in the dialect: the tree, or PatternRefused with the code and the position (an index into the
    pattern text, which holds no character outside the Basic Multilingual Plane, so Python and JavaScript count alike)."""
    if not isinstance(source, str) or not isinstance(flags, str):
        raise PatternRefused("usage", None)
    if flags not in ("", "i"):
        raise PatternRefused("flag", None)
    table = table if table is not None else load_table()
    fold = flags == "i"
    cased = table["cased"]
    s = source
    n = len(s)
    st = {"i": 0, "groups": 0, "uses_table": False}

    def ch():
        return s[st["i"]] if st["i"] < n else ""

    def refuse(code, pos=None):
        raise PatternRefused(code, st["i"] if pos is None else pos)

    def plain(pos):
        c = ord(s[pos])
        if c > 0xFFFF or 0xD800 <= c <= 0xDFFF:
            refuse("outside-plane", pos)
        return c

    def check_fold(lo, hi, pos):
        if fold and hi > 0x7F and intersects(cased, max(lo, 0x80), hi):
            refuse("case-fold", pos)

    def quantifier_ahead():
        m = QUANT.match(s, st["i"])
        if not m:
            return None
        lo = int(m.group(1))
        hi = lo if m.group(2) is None else (INF if m.group(3) == "" else int(m.group(3)))
        return lo, hi, len(m.group(0))

    def disjunction():
        alts = [alternative()]
        while ch() == "|":
            st["i"] += 1
            alts.append(alternative())
        return alts[0] if len(alts) == 1 else {"type": "alt", "items": alts}

    def alternative():
        items = []
        while st["i"] < n and ch() != "|" and ch() != ")":
            items.append(term())
        return {"type": "seq", "items": items}

    def term():
        start = st["i"]
        c = ch()
        if c in ("^", "$"):
            st["i"] += 1
            return no_quantifier({"type": "assert", "kind": c})
        if c == "\\" and start + 1 < n and s[start + 1] in ("b", "B"):
            st["i"] += 2
            return no_quantifier({"type": "assert", "kind": s[start + 1]})
        if c == "(":
            if s.startswith("(?=", start) or s.startswith("(?!", start) or s.startswith("(?<=", start) or s.startswith("(?<!", start):
                behind = s[start + 2] == "<"
                negate = s[start + 3 if behind else start + 2] == "!"
                st["i"] += 4 if behind else 3
                body = disjunction()
                if ch() != ")":
                    refuse("unclosed", start)
                st["i"] += 1
                node = {"type": "look", "behind": behind, "negate": negate, "body": body}
                if behind:
                    lo, hi = width(body)
                    if lo != hi:
                        refuse("lookbehind-width", start)
                return no_quantifier(node)
            if s.startswith("(?:", start):
                st["i"] += 3
                body = disjunction()
                if ch() != ")":
                    refuse("unclosed", start)
                st["i"] += 1
                atom = {"type": "group", "capture": False, "body": body}
            elif start + 1 < n and s[start + 1] == "?":
                if start + 2 < n and s[start + 2] == "<" and start + 3 < n and NAME_START.match(s[start + 3]):
                    refuse("named-group", start)
                refuse("group-syntax", start)
            else:
                st["i"] += 1
                st["groups"] += 1
                index = st["groups"]
                body = disjunction()
                if ch() != ")":
                    refuse("unclosed", start)
                st["i"] += 1
                atom = {"type": "group", "capture": True, "index": index, "body": body}
        elif c == "[":
            atom = char_class()
        elif c == ".":
            st["i"] += 1
            atom = {"type": "set", "negated": True, "ranges": DOT_EXCLUDES}
        elif c in ("*", "+", "?"):
            refuse("nothing-to-repeat")
        elif c == "{":
            refuse("nothing-to-repeat" if quantifier_ahead() else "brace")
        elif c in ("}", "]"):
            refuse("brace")
        elif c == "\\":
            atom = atom_escape()
        else:
            cp = plain(start)
            check_fold(cp, cp, start)
            st["i"] += 1
            atom = {"type": "char", "cp": cp}
        return quantified(atom)

    def no_quantifier(node):
        c = ch()
        if c in ("*", "+", "?") or (c == "{" and quantifier_ahead()):
            refuse("quantified-assertion")
        return node

    def quantified(atom):
        c = ch()
        if c == "*":
            lo, hi = 0, INF
            st["i"] += 1
        elif c == "+":
            lo, hi = 1, INF
            st["i"] += 1
        elif c == "?":
            lo, hi = 0, 1
            st["i"] += 1
        elif c == "{":
            q = quantifier_ahead()
            if not q:
                refuse("brace")
            lo, hi, length = q
            if lo > MAX_COUNT or (hi != INF and (hi > MAX_COUNT or hi < lo)):
                refuse("count")
            st["i"] += length
        else:
            return atom
        lazy = False
        if ch() == "?":
            lazy = True
            st["i"] += 1
        c2 = ch()
        if c2 in ("*", "+", "?") or (c2 == "{" and quantifier_ahead()):
            refuse("nothing-to-repeat")
        return {"type": "quant", "min": lo, "max": hi, "lazy": lazy, "body": atom}

    def class_escape(start):
        i = st["i"]
        e = s[i]
        if e in ("d", "D"):
            st["i"] += 1
            return DIGIT if e == "d" else complement(DIGIT), False
        if e in ("w", "W"):
            st["i"] += 1
            return WORD if e == "w" else complement(WORD), False
        if e in ("s", "S"):
            st["i"] += 1
            return SPACE if e == "s" else complement(SPACE), False
        if e in ("p", "P"):
            m = PROPERTY.match(s, i)
            if not m or m.group(1) not in table["classes"]:
                refuse("property", start)
            if fold and m.group(1) in ("Lu", "Ll"):
                refuse("cased-class-fold", start)
            st["i"] += len(m.group(0))
            st["uses_table"] = True
            r = table["classes"][m.group(1)]
            return (r if e == "p" else complement(r)), True
        return None

    def char_escape(start):
        i = st["i"]
        if i >= n:
            refuse("trailing-backslash", start)
        e = s[i]
        if e == "n":
            st["i"] += 1
            return 0x0A
        if e == "r":
            st["i"] += 1
            return 0x0D
        if e == "t":
            st["i"] += 1
            return 0x09
        if e == "u":
            rx = BRACED if i + 1 < n and s[i + 1] == "{" else HEX4
            m = rx.match(s, i)
            if not m:
                refuse("escape", start)
            cp = int(m.group(1), 16)
            if cp > MAX_CODE_POINT:
                refuse("escape", start)
            if 0xD800 <= cp <= 0xDFFF:
                refuse("outside-plane", start)
            st["i"] += len(m.group(0))
            return cp
        if "1" <= e <= "9":
            refuse("backreference", start)
        if e == "k":
            refuse("backreference", start)
        if e in SYNTAX or e == "/" or e == "-":
            plain(i)
            st["i"] += 1
            return ord(e)
        plain(i)
        refuse("escape", start)

    def atom_escape():
        start = st["i"]
        st["i"] += 1
        if st["i"] >= n:
            refuse("trailing-backslash", start)
        k = class_escape(start)
        if k:
            return {"type": "set", "negated": False, "ranges": k[0]}
        cp = char_escape(start)
        check_fold(cp, cp, start)
        return {"type": "char", "cp": cp}

    def char_class():
        start = st["i"]
        st["i"] += 1
        negated = False
        if ch() == "^":
            negated = True
            st["i"] += 1
        if ch() == "]":
            refuse("empty-class", start)
        parts = []

        def class_atom():
            a_start = st["i"]
            if st["i"] >= n:
                refuse("unclosed", start)
            if ch() == "\\":
                st["i"] += 1
                if st["i"] >= n:
                    refuse("trailing-backslash", a_start)
                k = class_escape(a_start)
                if k:
                    return {"set": k[0], "at": a_start}
                if s[st["i"]] == "b":
                    refuse("escape", a_start)
                return {"cp": char_escape(a_start), "at": a_start}
            cp = plain(st["i"])
            st["i"] += 1
            return {"cp": cp, "at": a_start}

        while ch() != "]":
            if st["i"] >= n:
                refuse("unclosed", start)
            a = class_atom()
            i = st["i"]
            if ch() == "-" and i + 1 < n and s[i + 1] != "]":
                st["i"] += 1
                b = class_atom()
                if "set" in a or "set" in b or a["cp"] > b["cp"]:
                    refuse("class-range", a["at"])
                check_fold(a["cp"], b["cp"], a["at"])
                parts.append([a["cp"], b["cp"]])
            elif "set" in a:
                parts.extend(a["set"])
            else:
                check_fold(a["cp"], a["cp"], a["at"])
                parts.append([a["cp"], a["cp"]])
        st["i"] += 1
        return {"type": "set", "negated": negated, "ranges": norm(parts)}

    tree = disjunction()
    if st["i"] < n:
        refuse("unclosed", st["i"])
    return {"tree": tree, "fold": fold, "groups": st["groups"], "uses_table": st["uses_table"]}


def width(node):
    """[min, max] characters a node matches (max may be infinite)."""
    t = node["type"]
    if t in ("char", "set"):
        return 1, 1
    if t in ("assert", "look"):
        return 0, 0
    if t == "group":
        return width(node["body"])
    if t == "seq":
        lo = hi = 0
        for x in node["items"]:
            a, b = width(x)
            lo, hi = lo + a, hi + b
        return lo, hi
    if t == "alt":
        ws = [width(x) for x in node["items"]]
        return min(w[0] for w in ws), max(w[1] for w in ws)
    if t == "quant":
        a, b = width(node["body"])
        if node["max"] == INF:
            return a * node["min"], (0 if b == 0 else INF)
        return a * node["min"], b * node["max"]
    raise ValueError("unknown node " + t)


# -- emitting Python (re.ASCII for \b; everything else written out as code points) ------------------------------------------
def esc_py(cp):
    if 0x30 <= cp <= 0x39 or 0x41 <= cp <= 0x5A or 0x61 <= cp <= 0x7A:
        return chr(cp)
    return "\\u%04X" % cp if cp <= 0xFFFF else "\\U%08X" % cp


NEVER = "(?!)"
WORD_CLASS = "[0-9A-Z_a-z]"
NOT_BOUNDARY = "(?:(?<=%s)(?=%s)|(?<!%s)(?!%s))" % (WORD_CLASS, WORD_CLASS, WORD_CLASS, WORD_CLASS)


def set_py(ranges, negated):
    if not ranges:
        return "[%s-%s]" % (esc_py(0), esc_py(MAX_CODE_POINT)) if negated else NEVER
    if negated and len(ranges) == 1 and ranges[0][0] == 0 and ranges[0][1] == MAX_CODE_POINT:
        return NEVER
    body = "".join(esc_py(a) if a == b else "%s-%s" % (esc_py(a), esc_py(b)) for a, b in ranges)
    return "[%s%s]" % ("^" if negated else "", body)


def quant_text(node):
    lo, hi = node["min"], node["max"]
    if lo == 0 and hi == INF:
        q = "*"
    elif lo == 1 and hi == INF:
        q = "+"
    elif lo == 0 and hi == 1:
        q = "?"
    elif hi == INF:
        q = "{%d,}" % lo
    elif lo == hi:
        q = "{%d}" % lo
    else:
        q = "{%d,%d}" % (lo, hi)
    return q + ("?" if node["lazy"] else "")


def emit_py(node, fold):
    t = node["type"]
    if t == "alt":
        return "|".join(emit_py(x, fold) for x in node["items"])
    if t == "seq":
        return "".join(emit_py(x, fold) for x in node["items"])
    if t == "char":
        cp = node["cp"]
        if fold and (0x41 <= cp <= 0x5A or 0x61 <= cp <= 0x7A):
            return set_py(ascii_fold([[cp, cp]]), False)
        return esc_py(cp)
    if t == "set":
        return set_py(ascii_fold(node["ranges"]) if fold else node["ranges"], node["negated"])
    if t == "group":
        return "(%s%s)" % ("" if node["capture"] else "?:", emit_py(node["body"], fold))
    if t == "look":
        return "(?%s%s%s)" % ("<" if node["behind"] else "", "!" if node["negate"] else "=", emit_py(node["body"], fold))
    if t == "assert":
        # \A and \Z: the start and the very end of the text; \B written out (before 3.14, Python's \B fails on an empty text)
        return {"^": "\\A", "$": "\\Z", "b": "\\b", "B": NOT_BOUNDARY}[node["kind"]]
    if t == "quant":
        return emit_py(node["body"], fold) + quant_text(node)
    raise ValueError("unknown node " + t)


def translate(source, flags="", table=None):
    """Translates a dialect pattern into a Python re source and flags. Raises PatternRefused when the pattern is not in
    the dialect. `uses_table` says the pattern names a class of the pinned table: such a pattern answers can't tell on a
    text holding a code point outside the table's repertoire (test() and first_match() do this; a caller compiling
    `source` itself must do the same)."""
    table = table if table is not None else load_table()
    p = parse(source, flags, table)
    return {"dialect": DIALECT, "source": emit_py(p["tree"], p["fold"]), "flags": re.ASCII, "uses_table": p["uses_table"],
            "groups": p["groups"], "unicode": table["unicode"]}


def compile_pattern(source, flags="", table=None):
    """A translated pattern ready to run: the compiled re, and the repertoire it answers within."""
    table = table if table is not None else load_table()
    t = translate(source, flags, table)
    t["regex"] = re.compile(t["source"], t["flags"])
    t["repertoire"] = table["repertoire"]
    return t


def outside_repertoire(text, repertoire):
    """The first code point of the text outside the repertoire, as a UTF-16 index, or -1."""
    k = 0
    for c in text:
        cp = ord(c)
        if not in_ranges(repertoire, cp):
            return k
        k += 2 if cp > 0xFFFF else 1
    return -1


def _utf16_len(text):
    return len(text) + sum(1 for c in text if ord(c) > 0xFFFF)


def test(compiled, text):
    """match, no match, or can't tell (a pattern naming a table class, on a text holding a code point outside the
    repertoire)."""
    if compiled["uses_table"] and outside_repertoire(text, compiled["repertoire"]) >= 0:
        return "can't tell"
    return "match" if compiled["regex"].search(text) is not None else "no match"


def first_match(compiled, text):
    """The answer and, on a match, the first match's span in UTF-16 code units of the text."""
    if compiled["uses_table"] and outside_repertoire(text, compiled["repertoire"]) >= 0:
        return {"answer": "can't tell"}
    m = compiled["regex"].search(text)
    if m is None:
        return {"answer": "no match"}
    start = _utf16_len(text[:m.start()])
    return {"answer": "match", "span": [start, start + _utf16_len(m.group(0))]}


def fold(text, name, table=None):
    """Applies a character map of the table (maps.<name>) code point by code point; when to apply it is the caller's
    rule."""
    table = table if table is not None else load_table()
    m = table.get("maps", {}).get(name, {}).get("map")
    if m is None:
        raise KeyError("the table has no map " + name)
    return "".join(m.get("%04X" % ord(c), c) for c in text)


def main(argv):
    args = list(argv)
    text = None
    if "--test" in args:
        k = args.index("--test")
        if k + 1 >= len(args):
            print("usage: python translate.py <pattern> [flags] [--test <text>]", file=sys.stderr)
            return 3
        text = args[k + 1]
        del args[k:k + 2]
    if len(args) < 1 or len(args) > 2:
        print("usage: python translate.py <pattern> [flags] [--test <text>]", file=sys.stderr)
        return 3
    try:
        c = compile_pattern(args[0], args[1] if len(args) > 1 else "")
    except PatternRefused as e:
        print(str(e))
        return 3
    if text is None:
        print(json.dumps({"dialect": c["dialect"], "source": c["source"], "flags": "re.ASCII", "uses_table": c["uses_table"],
                          "unicode": c["unicode"]}))
        return 0
    a = test(c, text)
    print(a)
    return 0 if a == "match" else 1 if a == "no match" else 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
