"""The host-neutral bridge: one proposed tool call in, one Riposte check out.

The decision is never made in Python. ``NodeChecker`` runs the bundled engine (``riposte-action --check``, built from
``products/adapters/src`` by ``npm run build``) and returns its disposition verbatim:

    pass-through  the tool is not a declared action: do nothing
    hold          FAIL or ABSTAIN at gate/autonomy: wait until a person resolves it
    review        PASS at gate: a person reviews it before it runs
    surface       FAIL or ABSTAIN at advise: show it in-flow; do not hold
    record        FAIL or ABSTAIN at record: book of record only; nothing in-flow; do not hold
    proceed       nothing to do

Adapters fail OPEN: if the check itself errors (no node, a broken policy, a timeout), the tool call proceeds and the error
is reported through ``on_error`` (default: a logging warning). Riposte's own failures never hold the host hostage.
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
    log.warning("riposte: check failed, failing open (the tool call proceeds): %s", e)


def safe_check(checker: Checker, tool: str, arguments: Mapping[str, Any], on_error: Callable[[BaseException], None] = _warn) -> Optional[Check]:
    """The check, or None when the check itself failed (the caller then proceeds: fail open)."""
    try:
        return checker.check(tool, arguments)
    except Exception as e:  # noqa: BLE001 - failing open is the contract
        on_error(e)
        return None


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
