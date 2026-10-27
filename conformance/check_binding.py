# Checks the binding verifier (riposte_bind.py) against the twenty vectors and the eight pack bundles. Standard library only.
# SPDX-License-Identifier: Apache-2.0
"""
    python3 conformance/check_binding.py

For each vector in conformance/vectors.json: the file's sha256, then riposte_bind.py run on it as a separate process, whose
exit code must be the vector's binding answer (holds 2, fails 1, refused 3) and whose computed input_hash and verdict_id must
equal the manifest's. Vector 20 also checks that a plain sorted-keys writer gets another hash. For each bundle of the pack
(packages/verify/test/fixtures/engine-0.0.1-bundles.json): the binding holds and both computed values equal the recorded ones.

Exit 0 every case as expected; 1 at least one was not; 3 the manifest or the pack cannot be read.
"""

import hashlib
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
VERIFIER = os.path.join(HERE, "riposte_bind.py")
PACK = os.path.join(ROOT, "packages", "verify", "test", "fixtures", "engine-0.0.1-bundles.json")
EXIT_OF = {"holds": 2, "fails": 1, "refused": 3}


def run(path):
    p = subprocess.run([sys.executable, "-I", VERIFIER, path], capture_output=True, text=True, encoding="utf-8")
    first = p.stderr.splitlines()[0] if p.stderr else ""
    try:
        result = json.loads(p.stdout)
    except ValueError:
        result = {}
    return p.returncode, result, first


def main():
    try:
        with open(os.path.join(HERE, "vectors.json"), encoding="utf-8") as f:
            manifest = json.load(f)
        with open(PACK, encoding="utf-8") as f:
            pack = json.load(f)
    except (OSError, ValueError) as e:
        sys.stderr.write("cannot read the manifest or the pack: %s\n" % e)
        return 3

    bad = 0

    def line(ok, name, detail):
        nonlocal bad
        if not ok:
            bad += 1
        sys.stdout.write("%s %s  %s\n" % ("ok  " if ok else "BAD ", name, detail))

    for v in manifest["vectors"]:
        path = os.path.join(HERE, "vectors", v["file"])
        with open(path, "rb") as f:
            sha = hashlib.sha256(f.read()).hexdigest()
        if sha != v["sha256"]:
            line(False, "vector %s" % v["id"], "the file's bytes changed (sha256 %s); a checkout may have converted its line endings" % sha)
            continue
        e = v["expect"]
        code, result, first = run(path)
        problems = []
        if code != EXIT_OF[e["binding"]]:
            problems.append("exit %s, expected %s (%s)" % (code, EXIT_OF[e["binding"]], e["binding"]))
        if not first.endswith("the check is not re-performed"):
            problems.append("the first stderr line does not say that the check is not re-performed")
        if e["binding"] != "refused":
            for k in ("computed_input_hash", "computed_verdict_id"):
                if result.get(k) != e[k]:
                    problems.append("%s %s, expected %s" % (k, result.get(k), e[k]))
        if "sorted_keys_input_hash" in e:
            # what a plain Python reader and sorted-keys writer would hash: json.loads, then json.dumps(sort_keys=True)
            with open(path, encoding="utf-8") as f:
                inputs = json.load(f)["inputs"]
            plain = json.dumps(inputs, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
            plain_hash = hashlib.sha256(plain.encode("utf-8")).hexdigest()
            if plain_hash != e["sorted_keys_input_hash"]:
                problems.append("the sorted-keys hash is %s, expected %s" % (plain_hash, e["sorted_keys_input_hash"]))
            if plain_hash == e["computed_input_hash"]:
                problems.append("the sorted-keys hash equals the canonical one; the vector shows nothing")
        line(not problems, "vector %s" % v["id"], "exit %s (%s)%s" % (code, e["binding"], ": " + "; ".join(problems) if problems else ""))

    with tempfile.TemporaryDirectory(prefix="riposte-conformance-") as scratch:
        for b in pack["bundles"]:
            path = os.path.join(scratch, b["id"] + ".json")
            with open(path, "w", encoding="utf-8") as f:
                json.dump({"verdict": b["verdict"], "inputs": b["inputs"]}, f, ensure_ascii=False)
            code, result, _ = run(path)
            problems = []
            if code != 2:
                problems.append("exit %s, expected 2 (holds)" % code)
            if result.get("computed_input_hash") != b["verdict"]["input_hash"]:
                problems.append("input_hash %s, recorded %s" % (result.get("computed_input_hash"), b["verdict"]["input_hash"]))
            if result.get("computed_verdict_id") != b["verdict"]["verdict_id"]:
                problems.append("verdict_id %s, recorded %s" % (result.get("computed_verdict_id"), b["verdict"]["verdict_id"]))
            line(not problems, "pack %s" % b["id"], "exit %s, input_hash %s, verdict_id %s%s" % (
                code, b["verdict"]["input_hash"][:12], b["verdict"]["verdict_id"], ": " + "; ".join(problems) if problems else ""))

    total = len(manifest["vectors"]) + len(pack["bundles"])
    sys.stdout.write("%d of %d as expected (%d vectors, %d pack bundles)\n" % (total - bad, total, len(manifest["vectors"]), len(pack["bundles"])))
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
