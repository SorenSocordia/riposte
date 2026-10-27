"""The SARIF the built riposte-sarif bin writes, validated by the `jsonschema` package (Draft 4, formats checked) against the
OASIS SARIF 2.1.0 schema in test/fixtures/sarif: an independent check of the TypeScript suite's validator. Skipped without
jsonschema, node or the bin.
"""
import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

jsonschema = pytest.importorskip("jsonschema")

ROOT = Path(__file__).resolve().parents[2]
FIX = ROOT / "test" / "fixtures" / "sarif"
BIN = ROOT / "bin" / "riposte-sarif.mjs"
pytestmark = pytest.mark.skipif(shutil.which("node") is None or not BIN.exists(), reason=f"needs node and {BIN} (npm run build)")
FIXTURES = ["clean-invoice.json", "invoice-over-contract.json", "payapp-retainage.json", "invoice-missing-totals.json"]


def run_bin(cwd, *args):
    env = {k: v for k, v in os.environ.items() if not k.startswith(("RIPOSTE_", "RECEIPTS_", "GITHUB_", "INPUT_"))}
    env.update(HOME=str(cwd), USERPROFILE=str(cwd))
    return subprocess.run(["node", str(BIN), *args], cwd=cwd, env=env, capture_output=True, text=True, encoding="utf-8", timeout=60)


def validator():
    schema = json.loads((FIX / "sarif-schema-2.1.0.json").read_text(encoding="utf-8"))
    cls = jsonschema.Draft4Validator
    cls.check_schema(schema)
    return cls(schema, format_checker=cls.FORMAT_CHECKER)


def test_bin_output_validates_against_the_oasis_schema(tmp_path):
    (tmp_path / "docs").mkdir()
    for f in FIXTURES:
        shutil.copy(FIX / f, tmp_path / "docs" / f)
    (tmp_path / "docs" / "broken.json").write_text('{"invoice_number": ', encoding="utf-8")
    p = run_bin(tmp_path, "--files", "docs/*.json", "--category", "riposte-verify")
    assert p.returncode == 1, p.stderr  # FAILs present (fail-on defaults to insufficient-data)
    log = json.loads((tmp_path / "riposte.sarif").read_text(encoding="utf-8"))
    errors = sorted(validator().iter_errors(log), key=lambda e: list(e.path))
    assert [f"{list(e.path)}: {e.message}" for e in errors] == []
    results = log["runs"][0]["results"]
    assert {r["level"] for r in results} == {"error", "warning"}
    assert all(r["level"] == "warning" for r in results if r["properties"]["riposte"]["answer"] == "INSUFFICIENT_DATA")
    assert log["runs"][0]["invocations"][0]["toolExecutionNotifications"][0]["message"]["text"].startswith("docs/broken.json: not checked")


def test_the_validator_catches_a_broken_log(tmp_path):
    (tmp_path / "docs").mkdir()
    shutil.copy(FIX / "invoice-over-contract.json", tmp_path / "docs" / "x.json")
    run_bin(tmp_path, "--files", "docs/x.json")
    log = json.loads((tmp_path / "riposte.sarif").read_text(encoding="utf-8"))
    log["runs"][0]["results"][0]["level"] = "fatal"
    del log["runs"][0]["results"][0]["message"]
    log["runs"][0]["results"][0]["locations"][0]["physicalLocation"]["region"]["startLine"] = 0
    messages = " | ".join(e.message for e in validator().iter_errors(log))
    assert "'fatal' is not one of" in messages
    assert "'message' is a required property" in messages
    assert "less than the minimum" in messages
