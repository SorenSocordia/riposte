# Byte-for-byte comparison of the Node engine's verdict and this Python engine's. prototype; no measured accuracy.
# SPDX-License-Identifier: Apache-2.0
"""
For each extraction, runs `node packages/verify/dist/cli.js <extraction.json>` and
`python3 conformance/engine_py/engine.py issue <extraction.json> --issued-at <the Node verdict's issued_at> --engine <the Node
verdict's engine_version>`, then compares the two stdouts byte for byte and the two exit codes. The Python verdict is issued
under the label the Node verdict carries, so a label this build does not carry is refused by name, never compared as a
difference. With no argument it compares the shipped sample docs/doors/examples/invoice.json.

    python3 conformance/engine_py/compare.py [<extraction.json> ...]

Exit codes, on the engine's replay scale (docs/INTERCHANGE.md section 13), as the conformance suite's own check scripts use
it: 0 every extraction IDENTICAL · 1 at least one extraction DIFFERS · 2 can't tell (the Node CLI is not built) · 3 a usage
error, or an extraction either engine refused.
"""

import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
CLI = os.path.join("packages", "verify", "dist", "cli.js")
ENGINE = os.path.join("conformance", "engine_py", "engine.py")
SAMPLE = os.path.join("docs", "doors", "examples", "invoice.json")


def _rel(path):
    p = os.path.relpath(os.path.abspath(path), ROOT)
    return p.replace(os.sep, "/")


def _run(cmd):
    p = subprocess.run(cmd, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return p.returncode, p.stdout, p.stderr


def _first_difference(a, b):
    la, lb = a.decode("utf-8", "replace").split("\n"), b.decode("utf-8", "replace").split("\n")
    for i in range(max(len(la), len(lb))):
        x = la[i] if i < len(la) else "(end of output)"
        y = lb[i] if i < len(lb) else "(end of output)"
        if x != y:
            return i + 1, x.strip(), y.strip()
    return None


def compare_one(path):
    """(status, line): status is IDENTICAL, DIFFERS, REFUSED or CANT_TELL."""
    rel = _rel(path)
    node_exit, node_out, node_err = _run(["node", CLI, rel])
    if node_exit == 3 or not node_out:
        first = node_err.decode("utf-8", "replace").strip().split("\n")[0]
        return "REFUSED", "REFUSED %s: the Node engine refused it (exit %d): %s" % (rel, node_exit, first)
    try:
        node_verdict = json.loads(node_out.decode("utf-8"))
        issued_at = node_verdict["issued_at"]
        label = node_verdict["engine_version"]
    except (ValueError, KeyError, TypeError) as e:
        return "CANT_TELL", "can't tell %s: the Node output is not a verdict (%s)" % (rel, e)
    py_exit, py_out, py_err = _run([sys.executable, ENGINE, "issue", rel, "--issued-at", issued_at, "--engine", label])
    if py_exit == 3:
        first = py_err.decode("utf-8", "replace").strip().split("\n")[0]
        return "REFUSED", "REFUSED %s: the Python engine refused it (exit 3): %s" % (rel, first)
    if node_out == py_out and node_exit == py_exit:
        return "IDENTICAL", "IDENTICAL %s: %d bytes, verdict_id %s, input_hash %s, gate_status %s, exit %d in both" % (
            rel, len(node_out), node_verdict.get("verdict_id"), node_verdict.get("input_hash"), node_verdict.get("gate_status"), node_exit)
    words = []
    if node_exit != py_exit:
        words.append("exit %d (Node) and %d (Python)" % (node_exit, py_exit))
    if node_out != py_out:
        d = _first_difference(node_out, py_out)
        words.append("stdout first differs at line %d: Node %s; Python %s" % d if d else "stdout differs")
    return "DIFFERS", "DIFFERS %s: %s" % (rel, "; ".join(words))


def main(argv):
    if any(a.startswith("-") for a in argv):
        sys.stderr.write("usage: python3 conformance/engine_py/compare.py [<extraction.json> ...]\n")
        return 3
    if not os.path.isfile(os.path.join(ROOT, CLI)):
        print("can't tell: %s is not built; run npm run build at the repository root first" % CLI.replace(os.sep, "/"))
        return 2
    files = argv or [os.path.join(ROOT, SAMPLE)]
    counts = {"IDENTICAL": 0, "DIFFERS": 0, "REFUSED": 0, "CANT_TELL": 0}
    for f in files:
        if not os.path.isfile(f):
            print("REFUSED %s: no such file" % f)
            counts["REFUSED"] += 1
            continue
        status, line = compare_one(f)
        counts[status] += 1
        print(line)
    print("%d of %d identical; %d differ; %d refused; %d can't tell" % (
        counts["IDENTICAL"], len(files), counts["DIFFERS"], counts["REFUSED"], counts["CANT_TELL"]))
    if counts["DIFFERS"]:
        return 1
    if counts["REFUSED"]:
        return 3
    if counts["CANT_TELL"]:
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
