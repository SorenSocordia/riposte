"""The host-neutral bridge: one proposed tool call in, one Riposte check out.

The decision is never made in Python. ``NodeChecker`` runs the bundled engine (``riposte-action --check``, built from
``products/adapters/src`` by ``npm run build``) and returns its disposition verbatim:

    pass-through  the tool is not a declared action: do nothing
    hold          FAIL or INSUFFICIENT_DATA at gate/autonomy: wait until a person resolves it
    review        PASS at gate: a person reviews it before it runs
    surface       FAIL or INSUFFICIENT_DATA at advise: show it in-flow; do not hold
    record        FAIL or INSUFFICIENT_DATA at record: book of record only; nothing in-flow; do not hold
    proceed       nothing to do

A failed check fails to the SAFEST rung (2026-10-05, the policy-error ruling; it reverses the old "fail open"): when the
check itself cannot run (no node, a missing or broken policy, a timeout, malformed arguments), a CONSEQUENTIAL call (the
policy's rule for it is gate or autonomy; with no readable rule, a tool name that moves money or files something) is held
with a degraded check whose text names the problem and the fix, and any other call proceeds, with the error reported
through ``on_error`` ("governance degraded"). ``RIPOSTE_ACTION_ON_ERROR=open`` (or ``on_policy_error="open"``) restores
the old fail-open behaviour, loudly: every affected call logs a warning saying so. The same rule as the Claude Code hook
(src/degraded.ts); ``CONSEQUENTIAL_WORDS`` is that file's list (a test holds the two equal).
"""
from __future__ import annotations

import json
import logging
import os
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, Mapping, Optional, Protocol

log = logging.getLogger("riposte_adapters")

ON_ERROR_ENV = "RIPOSTE_ACTION_ON_ERROR"
# src/degraded.ts CONSEQUENTIAL_WORDS (tests/test_core.py holds the two lists equal)
CONSEQUENTIAL_WORDS = (
    "pay", "pays", "paid", "payment", "payments", "payout", "payouts", "payroll", "transfer", "transfers", "wire", "wires", "remit",
    "remittance", "refund", "refunds", "disburse", "disbursement", "charge", "charges", "withdraw", "withdrawal", "settle",
    "settlement", "capture", "purchase", "buy", "sell", "trade", "ach", "sepa", "swift", "apply", "approve", "submit", "filing",
    "lodge",
)

DISPOSITIONS = ("pass-through", "hold", "review", "surface", "record", "proceed")
HOLDING = ("hold", "review")

NO_RETRY = (
    "This call is held for a person. Do not retry it. Tell the person what is held and why; "
    "they resolve it, or dispute the finding with the command in the notice."
)


class RiposteError(RuntimeError):
    """The check could not run (never a verdict: a verdict is a Check)."""


@dataclass(frozen=True)
class Check:
    """One check, as the engine returned it. ``raw`` is the full JSON of ``riposte-action --check``."""

    matched: bool
    tool: str
    disposition: str
    raw: Mapping[str, Any] = field(default_factory=dict, compare=False)

    @classmethod
    def from_json(cls, d: Mapping[str, Any]) -> "Check":
        disposition = d.get("disposition")
        if disposition not in DISPOSITIONS:
            raise RiposteError(f"unknown disposition {disposition!r}")
        return cls(matched=bool(d.get("matched")), tool=str(d.get("tool", "")), disposition=disposition, raw=d)

    @property
    def holds(self) -> bool:
        return self.disposition in HOLDING

    @property
    def text(self) -> str:
        return str((self.raw.get("delivery") or {}).get("text", "")).rstrip()

    @property
    def verdict_id(self) -> Optional[str]:
        return (self.raw.get("verdict") or {}).get("verdict_id")

    @property
    def call_hash(self) -> Optional[str]:
        return self.raw.get("call_hash")

    @property
    def level(self) -> Optional[str]:
        return (self.raw.get("notice") or {}).get("level")

    @property
    def facts(self) -> Mapping[str, Any]:
        return (self.raw.get("delivery") or {}).get("facts") or {}

    @property
    def facts_hash(self) -> Optional[str]:
        return (self.raw.get("delivery") or {}).get("facts_hash")

    @property
    def degraded(self) -> Optional[Mapping[str, Any]]:
        """Set on a check made because the real one could not run (the safest rung): the class, the error, the fix."""
        return self.raw.get("degraded")

    def info(self) -> Dict[str, Any]:
        """A compact, JSON-safe summary for a host's result/metadata slot."""
        return {
            "riposte": self.disposition,
            "tool": self.tool,
            "verdict_id": self.verdict_id,
            "level": self.level,
            "outcome": self.facts.get("outcome"),
            "facts_hash": self.facts_hash,
            "text": self.text,
        }


class Checker(Protocol):
    def check(self, tool: str, arguments: Mapping[str, Any]) -> Check: ...


def default_cli() -> Path:
    """``RIPOSTE_ACTION_CLI``, else the bundle next to this package (packages/adapters/bin/riposte-action.mjs)."""
    env = os.environ.get("RIPOSTE_ACTION_CLI")
    if env:
        return Path(env)
    return Path(__file__).resolve().parents[2] / "bin" / "riposte-action.mjs"


class NodeChecker:
    """Checks a call by running ``node riposte-action.mjs --check --policy <policy>`` (the engine, not a re-implementation)."""

    def __init__(
        self,
        policy: str | os.PathLike[str],
        *,
        cli: str | os.PathLike[str] | None = None,
        node: str = "node",
        timeout: float = 15.0,
        audience: Optional[str] = None,
        moment: Optional[str] = None,
    ) -> None:
        self.policy = str(policy)
        self.cli = str(cli) if cli is not None else str(default_cli())
        self.node = node
        self.timeout = timeout
        self.audience = audience
        self.moment = moment

    def argv(self) -> list[str]:
        a = [self.node, self.cli, "--check", "--policy", self.policy]
        if self.audience:
            a += ["--audience", self.audience]
        if self.moment:
            a += ["--moment", self.moment]
        return a

    def check(self, tool: str, arguments: Mapping[str, Any]) -> Check:
        payload = json.dumps({"tool": tool, "arguments": dict(arguments or {})}, default=str)
        try:
            p = subprocess.run(self.argv(), input=payload, capture_output=True, text=True, encoding="utf-8", timeout=self.timeout)
        except (OSError, subprocess.SubprocessError) as e:
            raise RiposteError(f"riposte-action could not run: {e}") from e
        if p.returncode != 0:
            raise RiposteError(f"riposte-action --check exited {p.returncode}: {p.stderr.strip()}")
        try:
            return Check.from_json(json.loads(p.stdout))
        except (ValueError, TypeError) as e:
            raise RiposteError(f"riposte-action --check printed something that is not a check: {e}") from e


def _warn(e: BaseException) -> None:
    log.warning("riposte: governance degraded, the check could not run: %s", e)


def _words(name: str) -> list[str]:
    import re
    return [w.lower() for w in re.split(r"[^A-Za-z0-9]+", re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", name)) if w]


def classify_call(tool: str, policy_path: Optional[str] = None) -> tuple[str, str]:
    """(class, why) for a call whose check could not run: "consequential", "record-advise" or "pass-through"."""
    rules = None
    valid = False
    if policy_path:
        try:
            p = json.loads(Path(policy_path).read_text(encoding="utf-8"))
            if isinstance(p, dict) and isinstance(p.get("actions"), list):
                rules = [a for a in p["actions"] if isinstance(a, dict)]
                valid = p.get("policy_version") == "riposte-action-policy-v0" and all(
                    isinstance(a.get("tool"), str) and a.get("level") in ("record", "advise", "gate", "autonomy") for a in rules
                ) and len(rules) == len(p["actions"])
        except (OSError, ValueError):
            rules = None
    if rules is not None:
        rule = next((a for a in rules if a.get("tool") == tool), None)
        if rule is not None:
            lv = rule.get("level")
            if lv in ("gate", "autonomy"):
                return "consequential", f"the policy's rule for {tool} sets rung {lv}"
            if lv in ("record", "advise"):
                return "record-advise", f"the policy's rule for {tool} sets rung {lv}"
            return "consequential", f"the policy's rule for {tool} has a rung that cannot be read ({lv!r})"
        if valid:
            return "pass-through", f"{tool} is not a declared action"
    words = _words(tool)
    hit = next((w for w in words if w in CONSEQUENTIAL_WORDS), None)
    own = _words(tool.split("__")[-1])
    if hit is None and own[:1] == ["file"]:
        hit = "file"
    if hit:
        return "consequential", f'the policy cannot say, and the tool name\'s word "{hit}" moves money or files something'
    return "record-advise", "the policy cannot say, and nothing in the tool name moves money or files something"


def degraded_check(tool: str, error: BaseException, why: str) -> Check:
    """The check a held consequential call gets when the real check could not run: disposition hold, its text the fix."""
    text = (
        f"Riposte held this {tool} call: governance degraded, the check could not run ({error}). While the action policy "
        f"cannot be applied, calls that move money or file something are held and other calls proceed ({why}). "
        "Fix: repair the setup (riposte-action --doctor checks it), then retry through a person."
    )
    return Check(matched=True, tool=tool, disposition="hold", raw={"degraded": {"class": "consequential", "why": why, "error": str(error)}, "delivery": {"text": text}})


def safe_check(
    checker: Checker,
    tool: str,
    arguments: Mapping[str, Any],
    on_error: Callable[[BaseException], None] = _warn,
    *,
    on_policy_error: Optional[str] = None,
) -> Optional[Check]:
    """The check; or, when the check itself failed, the safest rung: a degraded hold for a consequential call, else None
    (the caller proceeds). ``on_policy_error="open"`` (or RIPOSTE_ACTION_ON_ERROR=open) restores fail-open, loudly."""
    try:
        return checker.check(tool, arguments)
    except Exception as e:  # noqa: BLE001 - every failure of the check is an equipment error: the safest rung below
        on_error(e)
        mode = (on_policy_error or os.environ.get(ON_ERROR_ENV, "") or "hold").strip().lower()
        cls, why = classify_call(tool, getattr(checker, "policy", None))
        if mode == "open":
            log.warning("riposte: %s=open: failing OPEN on a failed check, as the operator chose (the old behaviour); %s is not held (%s)", ON_ERROR_ENV, tool, cls)
            return None
        return degraded_check(tool, e, why) if cls == "consequential" else None


class HoldMemory:
    """The loop guard: how often an identical call (by the engine's call hash) was already held in this process."""

    def __init__(self) -> None:
        self._n: Dict[str, int] = {}

    def seen(self, key: Optional[str]) -> int:
        return self._n.get(key or "", 0)

    def mark(self, key: Optional[str]) -> None:
        k = key or ""
        self._n[k] = self._n.get(k, 0) + 1


def hold_message(check: Check, *, repeat: bool, rejected_by_person: bool = False, reason: Optional[str] = None) -> str:
    """What the agent is told when a held call does not run. Facts first (the delivery text), then the instruction."""
    what = "held" if check.disposition == "hold" else "sent for review"
    if repeat:
        head = f"Already {what} once: Riposte will not ask again for this exact call."
    elif rejected_by_person:
        head = f"A person declined this {check.tool} call{': ' + reason if reason else ''}."
    else:
        head = f"Riposte {what} this {check.tool} call for a person; it did not run."
    return f"{head}\n{check.text}\n{NO_RETRY}"


def default_on_notice(check: Check) -> None:
    level = logging.INFO if check.disposition == "record" else logging.WARNING
    log.log(level, "riposte %s: %s", check.disposition, check.text)
