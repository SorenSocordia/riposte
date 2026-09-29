import json
import shutil
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from riposte_adapters import Check, default_cli  # noqa: E402

BIN = default_cli()
HAVE_ENGINE = shutil.which("node") is not None and BIN.exists()
needs_engine = pytest.mark.skipif(not HAVE_ENGINE, reason=f"needs node and the bundled engine at {BIN} (npm run build)")


def fake_check(disposition: str, tool: str = "mcp__bank__transfer", call_hash: str = "h1") -> Check:
    return Check(
        matched=disposition != "pass-through",
        tool=tool,
        disposition=disposition,
        raw={
            "call_hash": call_hash,
            "verdict": {"verdict_id": "v" * 32},
            "notice": {"level": "gate"},
            "delivery": {"text": f"RIPOSTE: {disposition} notice for {tool}\n", "facts": {"outcome": "FAIL"}, "facts_hash": "f" * 64},
        },
    )


class FakeChecker:
    def __init__(self, disposition: str = "hold", error: Exception | None = None):
        self.disposition = disposition
        self.error = error
        self.calls: list[tuple[str, dict]] = []

    def check(self, tool, arguments):
        self.calls.append((tool, dict(arguments)))
        if self.error:
            raise self.error
        return fake_check(self.disposition, tool)


@pytest.fixture
def policy_file(tmp_path):
    made = []

    def make(level: str, allowed: dict | None, tier: str = "severe", tool: str = "mcp__bank__transfer") -> Path:
        rule = {"tool": tool, "level": level, "tier": tier, "set_by": "test"}
        if allowed is not None:
            rule["sources"] = {"allowed": allowed}
        made.append(level)
        p = tmp_path / f"policy-{len(made)}-{level}.json"  # unique: a checker keeps pointing at its own policy
        p.write_text(json.dumps({"policy_version": "riposte-action-policy-v0", "actions": [rule]}), encoding="utf-8")
        return p

    return make
