# Every invoice@0.1.0 conformance vector and shipped sample, in both engines. prototype; no measured accuracy.
# SPDX-License-Identifier: Apache-2.0
"""
Replays every conformance vector whose verdict is invoice@0.1.0 (each run the manifest lists: the main run and its `also`
runs, with their flags) and the two invoice pack bundles, with `node packages/verify/dist/cli.js replay` and with
`python3 conformance/engine_py/engine.py replay`, and checks for each run:

  - both engines exit as the manifest expects (the pack bundles: 0, VERIFIED);
  - the manifest's phrase is on the first line each engine prints;
  - the ids agree: the computed input_hash and verdict_id each engine reports (where it computes one) are the same.

It also re-issues the two pack bundles' verdicts with the Python engine alone, under engine 0.0.1 and their own issued_at,
and checks that each is the recorded verdict, byte for byte in canonical JSON: the recorded verdict is what engine 0.0.1 said.

    python3 conformance/engine_py/sweep.py

Exit codes: 0 every run as expected · 1 at least one was not · 2 can't tell (the Node CLI is not built) · 3 the manifest or
the pack cannot be read. No network; each pack bundle is written to a temporary file outside the tree and removed.
"""

import json
import os
import re
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)

import engine  # noqa: E402
import riposte_bind as rb  # noqa: E402

CLI = os.path.join("packages", "verify", "dist", "cli.js")
ENGINE = os.path.join("conformance", "engine_py", "engine.py")
MANIFEST = os.path.join("conformance", "vectors.json")
PACK = os.path.join("packages", "verify", "test", "fixtures", "engine-0.0.1-bundles.json")
PACK_IDS = ("invoice-builtin-clean", "invoice-builtin-garbled-tax")
INVOICE = re.compile(rb'"id"\s*:\s*"invoice"')


def run(cmd):
    p = subprocess.run(cmd, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    first = p.stderr.decode("utf-8", "replace").strip().split("\n")[0] if p.stderr.strip() else ""
    try:
        body = json.loads(p.stdout.decode("utf-8")) if p.stdout.strip() else {}
    except ValueError:
        body = {}
    return p.returncode, first, body if isinstance(body, dict) else {}


def ids(body, node):
    """(input_hash, verdict_id) as each engine computed them, None where it did not compute one."""
    if node:
        return body.get("computed_input_hash") or body.get("expected_input_hash"), body.get("expected_verdict_id")
    return body.get("computed_input_hash"), body.get("computed_verdict_id")


def check_run(label, path, args, exit_expected, phrase):
    node = run(["node", CLI, "replay", path] + args)
    py = run([sys.executable, ENGINE, "replay", path] + args)
    problems = []
    for who, (code, first, _) in (("Node", node), ("Python", py)):
        if code != exit_expected:
            problems.append("%s exit %d, expected %d" % (who, code, exit_expected))
        if phrase not in first:
            problems.append("%s's first line lacks %r: %s" % (who, phrase, first[:120]))
    if node[0] != 3 and py[0] != 3:
        n_ids, p_ids = ids(node[2], True), ids(py[2], False)
        for i, what in enumerate(("input_hash", "verdict_id")):
            if n_ids[i] is not None and p_ids[i] is not None and n_ids[i] != p_ids[i]:
                problems.append("%s differs: Node %s, Python %s" % (what, n_ids[i], p_ids[i]))
            if (n_ids[i] is None) != (p_ids[i] is None) and not (node[0] == py[0] == 1 and what == "input_hash"):
                problems.append("%s computed by one engine only" % what)
    shown_ids = ids(py[2], False)
    detail = "exit %d in both" % node[0] if node[0] == py[0] else "exit %d (Node) and %d (Python)" % (node[0], py[0])
    if shown_ids[1]:
        detail += ", verdict_id %s" % shown_ids[1]
    return (not problems), ("AS EXPECTED %s: %s" % (label, detail) if not problems else "NOT AS EXPECTED %s: %s" % (label, "; ".join(problems)))


def main():
    if not os.path.isfile(os.path.join(ROOT, CLI)):
        print("can't tell: %s is not built; run npm run build at the repository root first" % CLI.replace(os.sep, "/"))
        return 2
    try:
        with open(os.path.join(ROOT, MANIFEST), "rb") as fh:
            manifest = json.loads(fh.read().decode("utf-8"))
        with open(os.path.join(ROOT, PACK), "rb") as fh:
            pack = rb.read_json_bytes(fh.read(), PACK)
    except (OSError, ValueError, rb.Refused) as e:
        print("cannot read the manifest or the pack: %s" % e)
        return 3
    vectors = manifest if isinstance(manifest, list) else manifest["vectors"]
    ok_count, total = 0, 0
    for v in vectors:
        path = os.path.join("conformance", "vectors", os.path.basename(v["file"]))
        with open(os.path.join(ROOT, path), "rb") as fh:
            if not INVOICE.search(fh.read()):
                continue  # another ruleset's vector
        e = v["expect"]
        runs = [(e.get("args", []), e["engine_exit"], e["engine_says"])] + [(a.get("args", []), a["engine_exit"], a["engine_says"]) for a in e.get("also", [])]
        for args, code, phrase in runs:
            label = "vector %s%s" % (v["id"], " " + " ".join(args) if args else "")
            ok, line = check_run(label, path, args, code, phrase)
            total += 1
            ok_count += ok
            print(line)
    for b in pack["bundles"]:
        if b["id"] not in PACK_IDS:
            continue
        fd, tmp = tempfile.mkstemp(suffix=".json")
        try:
            with os.fdopen(fd, "wb") as fh:
                fh.write(json.dumps(b, ensure_ascii=False).encode("utf-8"))
            ok, line = check_run("pack %s" % b["id"], tmp, [], 0, "outcome VERIFIED")
        finally:
            os.remove(tmp)
        total += 1
        ok_count += ok
        print(line)
        # the recorded verdict is engine 0.0.1's own output: re-issued here, it must be that verdict
        v = b["verdict"]
        inp = b["inputs"]
        again = engine.issue(inp["extraction"], v["issued_at"], engine=v["engine_version"], references=inp["references"], source=inp["source"])
        same = rb.canonical_json(engine._fix_ints(again)) == rb.canonical_json(v)
        total += 1
        ok_count += same
        print("%s pack %s re-issued by the Python engine under engine %s: %s" % (
            "AS EXPECTED" if same else "NOT AS EXPECTED", b["id"], v["engine_version"],
            "the recorded verdict, byte for byte in canonical JSON (verdict_id %s)" % v["verdict_id"] if same else
            "differs from the recorded verdict at %s" % engine.first_difference(engine._fix_ints(again), v)))
    print("%d of %d as expected" % (ok_count, total))
    return 0 if ok_count == total else 1


if __name__ == "__main__":
    sys.exit(main())
