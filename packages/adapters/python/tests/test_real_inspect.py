"""The scorer inside a REAL Inspect eval (skipped when inspect_ai is not installed).

Not yet run: inspect_ai was not installed on the machine this was written on, so this test is written from Inspect's source
(model/_providers/mockllm.py: `custom_outputs`, an iterable of ModelOutput; scorer/_metric.py) and docs, and is unverified
until someone runs it with inspect_ai installed. No network and no model API: mockllm returns three scripted outputs. The
outputs need no references, so the expected values hold whichever sample each output lands on.
"""
import json
import math
import os
import shutil
from pathlib import Path

import importlib.metadata

import pytest

try:  # the installed distribution, not the contract fake test_inspect_scorer.py may have put in sys.modules
    INSPECT_VERSION = importlib.metadata.version("inspect_ai")
except importlib.metadata.PackageNotFoundError:
    pytest.skip("inspect_ai is not installed", allow_module_level=True)

from riposte_adapters.scoring import default_score_cli  # noqa: E402

pytestmark = pytest.mark.skipif(shutil.which("node") is None or not default_score_cli().exists(), reason="needs node and bin/riposte-score.mjs")
FIX = Path(__file__).resolve().parents[2] / "test" / "fixtures" / "sarif"


def test_real_eval_pass_fail_abstain(monkeypatch, tmp_path):
    for k in list(os.environ):
        if k.startswith(("RIPOSTE_", "RECEIPTS_")):
            monkeypatch.delenv(k, raising=False)
    from inspect_ai import Task, eval as inspect_eval
    from inspect_ai.dataset import Sample
    from inspect_ai.model import ModelOutput, get_model
    from inspect_ai.solver import generate

    from riposte_adapters.inspect_scorer import riposte_scorer

    clean = json.loads((FIX / "clean-invoice.json").read_text(encoding="utf-8"))["extraction"]
    wrong_total = {**clean, "totals": {**clean["totals"], "total": 1700}}
    missing = json.loads((FIX / "invoice-missing-totals.json").read_text(encoding="utf-8"))
    outputs = [ModelOutput.from_content(model="mockllm/model", content=json.dumps(d)) for d in (clean, wrong_total, missing)]
    model = get_model("mockllm/model", custom_outputs=outputs)
    task = Task(dataset=[Sample(input=f"invoice {i}", target="") for i in range(3)], solver=generate(), scorer=riposte_scorer("invoice", references_key=None))
    log = inspect_eval(task, model=model, log_dir=str(tmp_path), max_samples=1)[0]
    assert log.status == "success"
    values = sorted(s.scores["riposte"].value for s in log.samples)
    assert values == ["C", "I", "N"]
    metrics = log.results.scores[0].metrics
    assert metrics["decided_pass_rate"].value == 0.5
    assert math.isclose(metrics["abstain_rate"].value, 1 / 3)
    for s in log.samples:
        r = s.scores["riposte"].metadata["riposte"]
        assert r["replay"] == f"riposte-verify replay riposte-proof-{r['verdict_id']}.json"
