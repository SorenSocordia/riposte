# The declarative ruleset expression language, in Python. prototype; no measured accuracy.
# SPDX-License-Identifier: Apache-2.0
"""
A port of packages/verify/src/declarative/expr.ts: the grammar before engine 0.4.0 (evalExpr, referencedRoles, roleRefs) and
the table grammar of engine 0.4.0 (evalExprV040, operandRefs, referencedRolesV040, roleRefsV040, parseOperandName), with the
same errors thrown at the same inputs, in the same words. An expression is read in UTF-16 code units, as JavaScript reads it,
so an error naming a character names the same unit.
"""

import math
import re

import jsrt as J

_WS = set(J.JS_WS)
_NUMCH = set("0123456789.")
_ALPHA = set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_")
_ALNUM = _ALPHA | set("0123456789")
AGG_FNS = ("median", "min", "max", "count")


class ExprError(Exception):
    """An expression that does not tokenize or parse (JavaScript's thrown Error; str(e) is its message)."""


def _tokenize(s, v040):
    s = J.units(s)
    toks, i, n = [], 0, len(s)
    while i < n:
        c = s[i]
        if c in _WS:
            i += 1
            continue
        if c in _NUMCH:
            j = i
            while j < n and s[j] in _NUMCH:
                j += 1
            toks.append({"t": "num", "v": s[i:j]})
            i = j
            continue
        if c in _ALPHA:
            j = i
            while j < n and s[j] in _ALNUM:
                j += 1
            if v040 and s[i:j] == "doc" and j < n and s[j] == "." and j + 1 < n and s[j + 1] in _ALPHA:
                k = j + 1
                while k < n and s[k] in _ALNUM:
                    k += 1
                if k < n and s[k] == "?":
                    raise ExprError("'?' cannot follow doc.%s: a document value is required or not used" % s[j + 1:k])
                toks.append({"t": "id", "v": s[j + 1:k], "doc": True})
                i = k
                continue
            if j < n and s[j] == "?":
                toks.append({"t": "id", "v": s[i:j], "opt": True})
                i = j + 1
                continue
            toks.append({"t": "id", "v": s[i:j]})
            i = j
            continue
        if c == "(":
            toks.append({"t": "lp", "v": c})
            i += 1
            continue
        if c == ")":
            toks.append({"t": "rp", "v": c})
            i += 1
            continue
        if v040 and c == ",":
            toks.append({"t": "comma", "v": c})
            i += 1
            continue
        if c in "+-*/":
            toks.append({"t": "op", "v": c})
            i += 1
            continue
        raise ExprError("invalid character in expression: '%s'" % c)
    return toks


def _compile(toks, v040):
    pos = [0]

    def peek():
        return toks[pos[0]] if pos[0] < len(toks) else None

    def nxt():
        t = toks[pos[0]]
        pos[0] += 1
        return t

    def expect(t):
        p = peek()
        if p is None or p["t"] != t:
            raise ExprError("expected %s" % t)
        nxt()

    def chain(first, ops, sub):
        rest = []
        while True:
            p = peek()
            if p is None or p["t"] != "op" or p["v"] not in ops:
                break
            op = nxt()["v"]
            rest.append((op, sub()))
        if not rest:
            return first
        node = {"k": "chain", "first": first, "rest": rest}
        if v040:
            node["fin"] = True
        return node

    def role_arg(fn):
        arg = peek()
        if arg is None or arg["t"] != "id" or arg.get("doc"):
            raise ExprError("%s() expects a role name" % fn)
        if arg.get("opt"):
            raise ExprError("%s() takes a role name without '?'" % fn)
        nxt()
        return arg["v"]

    def parse_expr():
        return chain(parse_term(), "+-", parse_term)

    def parse_term():
        return chain(parse_factor(), "*/", parse_factor)

    def parse_factor():
        tk = peek()
        if tk is None:
            raise ExprError("unexpected end of expression")
        if tk["t"] == "op" and tk["v"] == "-":
            nxt()
            return {"k": "neg", "a": parse_factor()}
        if tk["t"] == "op" and tk["v"] == "+":
            nxt()
            return parse_factor()
        if tk["t"] == "num":
            nxt()
            return {"k": "num", "v": J.number_of(tk["v"])}
        if tk["t"] == "lp":
            nxt()
            v = parse_expr()
            expect("rp")
            return v
        if tk["t"] == "id":
            nxt()
            if v040 and tk.get("doc"):
                return {"k": "var", "name": "doc.%s" % tk["v"], "opt": False, "syn": "doc", "role": tk["v"]}
            p = peek()
            if p is not None and p["t"] == "lp":
                if tk.get("opt"):
                    raise ExprError("'?' marks an optional role; it cannot follow the function name '%s'" % tk["v"])
                nxt()
                if not v040:
                    if tk["v"] == "sum":
                        arg = peek()
                        if arg is None or arg["t"] != "id":
                            raise ExprError("sum() expects a role name")
                        if arg.get("opt"):
                            raise ExprError("sum() takes a role name without '?'")
                        nxt()
                        expect("rp")
                        return {"k": "sum", "role": arg["v"]}
                    if tk["v"] == "abs":
                        v = parse_expr()
                        expect("rp")
                        return {"k": "abs", "a": v}
                    raise ExprError("unknown function '%s'" % tk["v"])
                if tk["v"] == "sum" or tk["v"] in AGG_FNS:
                    role = role_arg(tk["v"])
                    st = None
                    p = peek()
                    if p is not None and p["t"] == "comma":
                        nxt()
                        s2 = peek()
                        if s2 is None or s2["t"] != "id" or s2.get("opt") or s2.get("doc"):
                            raise ExprError("%s() takes a row set name as its second argument" % tk["v"])
                        nxt()
                        st = s2["v"]
                    expect("rp")
                    if tk["v"] == "sum" and st is None:
                        return {"k": "sum", "role": role}
                    node = {"k": "agg", "fn": tk["v"], "role": role}
                    if st is not None:
                        node["set"] = st
                    return node
                if tk["v"] == "abs":
                    v = parse_expr()
                    expect("rp")
                    return {"k": "abs", "a": v}
                if tk["v"] == "sqrt":
                    v = parse_expr()
                    expect("rp")
                    return {"k": "sqrt", "a": v}
                if tk["v"] in ("prev", "next"):
                    role = role_arg(tk["v"])
                    expect("rp")
                    return {"k": "var", "name": "%s.%s" % (tk["v"], role), "opt": False, "syn": tk["v"], "role": role}
                raise ExprError("unknown function '%s'" % tk["v"])
            return {"k": "var", "name": tk["v"], "opt": tk.get("opt") is True}
        if v040 and tk["t"] == "comma":
            raise ExprError("unexpected ',' (a comma separates a function's arguments)")
        raise ExprError("unexpected token '%s'" % tk["v"])

    root = parse_expr()
    if pos[0] != len(toks):
        raise ExprError("trailing tokens in expression")
    return root


class Env(object):
    """vars: role -> number or None (undefined); sum(role); engine 0.4.0: agg(fn, role, set), ref(kind, role), domain(note)."""

    def __init__(self, vars, sum, agg=None, ref=None, domain=None):
        self.vars = vars
        self.sum = sum
        self.agg = agg
        self.ref = ref
        self.domain = domain

    def copy(self, **kw):
        e = Env(self.vars, self.sum, self.agg, self.ref, self.domain)
        for k, v in kw.items():
            setattr(e, k, v)
        return e


def _finite(v):
    return v is not None and math.isfinite(v)


def _eval(n, env):
    k = n["k"]
    if k == "num":
        return n["v"]
    if k == "var":
        if "syn" in n:
            v = env.ref(n["syn"], n["role"]) if env.ref is not None else None
            return v if _finite(v) else None
        v = env.vars.get(n["name"])
        if n["opt"]:
            return 0.0 if v is None else v
        return v
    if k == "sum":
        return env.sum(n["role"])
    if k == "neg":
        v = _eval(n["a"], env)
        return None if v is None else -v
    if k == "abs":
        v = _eval(n["a"], env)
        return None if v is None else abs(v)
    if k == "chain":
        left = _eval(n["first"], env)
        fin = n.get("fin")
        for op, sub in n["rest"]:
            right = _eval(sub, env)
            if left is None or right is None:
                left = None
            elif op == "+":
                left = left + right
            elif op == "-":
                left = left - right
            elif op == "*":
                left = left * right
            else:
                left = None if right == 0 else _div(left, right)
            if fin and left is not None and not math.isfinite(left):
                left = None
        return left
    if k == "sqrt":
        v = _eval(n["a"], env)
        if v is None:
            return None
        if v < 0:
            if env.domain is not None:
                env.domain("sqrt of a negative value (%s)" % J.js_number(J.number_of(J.to_fixed(v, 4))))
            return None
        r = math.sqrt(v)
        return J.round9(r) if math.isfinite(r) else None
    if k == "agg":
        v = env.agg(n["fn"], n["role"], n.get("set")) if env.agg is not None else None
        return v if _finite(v) else None
    raise AssertionError(k)


def _div(a, b):
    """a / b in IEEE-754, as JavaScript divides (Python raises on an overflowing quotient)."""
    try:
        return a / b
    except OverflowError:
        return math.copysign(math.inf, a) * math.copysign(1.0, b)


_CACHE = {}


def _cached(key, make):
    hit = _CACHE.get(key)
    if hit is None:
        try:
            hit = make()
        except ExprError as e:
            hit = e
        if len(_CACHE) >= 8192:
            _CACHE.clear()
        _CACHE[key] = hit
    if isinstance(hit, ExprError):
        raise ExprError(str(hit))
    return hit


def _tokens(expr):
    return _cached(("tok", expr), lambda: _tokenize(expr, False))


def _tree(expr):
    return _cached(("tree", expr), lambda: _compile(_tokens(expr), False))


def _tree040(expr):
    return _cached(("tree040", expr), lambda: _compile(_cached(("tok040", expr), lambda: _tokenize(expr, True)), True))


def eval_expr(expr, env):
    return _eval(_tree(expr), env)


def eval_expr_v040(expr, env):
    return _eval(_tree040(expr), env)


def referenced_roles(expr):
    out = []
    for t in _tokens(expr):
        if t["t"] == "id" and t["v"] not in ("sum", "abs") and t["v"] not in out:
            out.append(t["v"])
    return out


def role_refs(*exprs):
    all_, req = [], set()
    for e in exprs:
        for t in _tokens(e):
            if t["t"] != "id" or t["v"] in ("sum", "abs"):
                continue
            if t["v"] not in all_:
                all_.append(t["v"])
            if not t.get("opt"):
                req.add(t["v"])
    return {"all": all_, "required": [r for r in all_ if r in req], "optional": [r for r in all_ if r not in req]}


def operand_refs(expr):
    out = []

    def walk(n):
        k = n["k"]
        if k == "num":
            return
        if k == "var":
            if "syn" in n:
                out.append({"name": n["name"], "kind": n["syn"], "role": n["role"], "optional": False})
                return
            if n["name"] in ("sum", "abs"):
                return
            out.append({"name": n["name"], "kind": "role", "role": n["name"], "optional": n["opt"]})
            return
        if k == "sum":
            out.append({"name": n["role"], "kind": "sum", "role": n["role"], "optional": False})
            return
        if k in ("neg", "abs", "sqrt"):
            walk(n["a"])
            return
        if k == "chain":
            walk(n["first"])
            for _, s in n["rest"]:
                walk(s)
            return
        if k == "agg":
            r = {"name": "%s(%s%s)" % (n["fn"], n["role"], ",%s" % n["set"] if "set" in n else ""), "kind": "agg", "role": n["role"],
                 "fn": n["fn"]}
            if "set" in n:
                r["set"] = n["set"]
            r["optional"] = False
            out.append(r)
    walk(_tree040(expr))
    return out


def referenced_roles_v040(expr):
    out = []
    for r in operand_refs(expr):
        if r["name"] not in out:
            out.append(r["name"])
    return out


def role_refs_v040(*exprs):
    all_, req = [], set()
    for e in exprs:
        for r in operand_refs(e):
            if r["name"] not in all_:
                all_.append(r["name"])
            if not r["optional"]:
                req.add(r["name"])
    return {"all": all_, "required": [r for r in all_ if r in req], "optional": [r for r in all_ if r not in req]}


_REF_NAME = re.compile(r"(doc|prev|next)\.([A-Za-z_][A-Za-z0-9_]*)\Z")
_AGG_NAME = re.compile(r"(median|min|max|count|sum)\(([A-Za-z_][A-Za-z0-9_]*)(?:,([A-Za-z_][A-Za-z0-9_]*))?\)\Z")


def parse_operand_name(name):
    m = _REF_NAME.match(name)
    if m:
        return {"name": name, "kind": m.group(1), "role": m.group(2)}
    m = _AGG_NAME.match(name)
    if m:
        r = {"name": name, "kind": "agg", "role": m.group(2), "fn": m.group(1)}
        if m.group(3) is not None:
            r["set"] = m.group(3)
        return r
    return None
