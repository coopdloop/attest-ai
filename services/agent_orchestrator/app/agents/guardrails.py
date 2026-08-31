"""
Guardrail evaluation for harness-defined agents.

Guardrails are declared per-harness (see config/harnesses/*.yaml) with an id,
description, and action:

    block        — refuse the tool call; the model is told the call was denied
    warn         — allow, but record a warning event
    throttle     — enforce the harness rate_limit_rps before the call proceeds
    require      — allow; treated as a soft requirement (recorded, not enforced)
    require_log  — allow; force-log the call

Evaluation is intentionally conservative: unknown guardrail ids are ignored so a
harness can declare custom guardrails without breaking execution.
"""

from __future__ import annotations

import ipaddress
import re
import time
from dataclasses import dataclass, field
from typing import Any

# Tool-name substrings that imply active network probing (not passive OSINT).
_ACTIVE_SCAN_PATTERNS = (
    "active", "scan", "portscan", "port_scan", "nmap", "brute", "bruteforce",
    "exploit", "zone_transfer", "axfr", "fuzz",
)

# Heuristic markers that a target looks like production.
_PROD_MARKERS = ("prod", "production", "www.", "api.", ".com", ".io", ".net", ".gov", ".mil")

# Arg keys that commonly carry a target host/url.
_TARGET_KEYS = ("target", "url", "host", "hostname", "domain", "ip", "address", "endpoint")


@dataclass
class GuardrailDecision:
    allowed: bool
    action: str            # block | warn | throttle | require | require_log | allow
    guardrail_id: str
    detail: str = ""


@dataclass
class GuardrailEngine:
    guardrails: list[dict[str, Any]] = field(default_factory=list)
    roe_scope: dict[str, Any] = field(default_factory=dict)
    _last_call_ts: float = 0.0

    @classmethod
    def from_harness(cls, harness: dict[str, Any]) -> "GuardrailEngine":
        definition = harness.get("definition", harness) or {}
        return cls(
            guardrails=definition.get("guardrails", []) or [],
            roe_scope=definition.get("roe_scope", {}) or {},
        )

    @property
    def active(self) -> bool:
        return bool(self.guardrails)

    def _find(self, guardrail_id: str) -> dict[str, Any] | None:
        for g in self.guardrails:
            if g.get("id") == guardrail_id:
                return g
        return None

    def _extract_targets(self, args: dict[str, Any]) -> list[str]:
        targets: list[str] = []
        for k, v in (args or {}).items():
            if isinstance(v, str) and (k.lower() in _TARGET_KEYS or any(t in k.lower() for t in _TARGET_KEYS)):
                targets.append(v)
            elif isinstance(v, dict):
                targets.extend(self._extract_targets(v))
        return targets

    def _in_denylist(self, target: str) -> bool:
        """True if target is an RFC1918 / loopback / link-local address."""
        host = target.split("//")[-1].split("/")[0].split(":")[0]
        try:
            ip = ipaddress.ip_address(host)
            return ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved
        except ValueError:
            return False

    def _in_allowlist(self, target: str) -> bool:
        allow = self.roe_scope.get("allowlist") or self.roe_scope.get("extra", {}).get("allowlist") or []
        if not allow:
            return False
        host = target.split("//")[-1].split("/")[0].split(":")[0].lower()
        for entry in allow:
            e = str(entry).lower()
            if host == e or host.endswith("." + e):
                return True
        return False

    def evaluate_tool_call(
        self, fn_name: str, args: dict[str, Any], context_overrides: dict[str, Any] | None = None,
    ) -> list[GuardrailDecision]:
        """Return the decisions that apply to a tool call. Any decision with
        allowed=False should stop the call. Non-blocking decisions are recorded."""
        decisions: list[GuardrailDecision] = []
        overrides = context_overrides or {}
        targets = self._extract_targets(args)

        # scope_check (block): every target must be allow-listed and not deny-listed.
        if (g := self._find("scope_check")):
            for t in targets:
                if self._in_denylist(t):
                    decisions.append(GuardrailDecision(False, "block", "scope_check",
                                     f"target '{t}' is in the reserved/private denylist"))
                    break
                allow = self.roe_scope.get("allowlist") or self.roe_scope.get("extra", {}).get("allowlist") or []
                if allow and not self._in_allowlist(t):
                    decisions.append(GuardrailDecision(False, "block", "scope_check",
                                     f"target '{t}' is not in the scope allowlist"))
                    break

        # no_active_scan (block): reject tools that imply active probing.
        if (g := self._find("no_active_scan")) and not self.roe_scope.get("allow_active_scanning", False):
            low = fn_name.lower()
            if any(p in low for p in _ACTIVE_SCAN_PATTERNS):
                decisions.append(GuardrailDecision(False, "block", "no_active_scan",
                                 f"tool '{fn_name}' looks like an active scan"))

        # authorization_check (block): require an authorization token in overrides/args.
        if self._find("authorization_check") and self.roe_scope.get("require_authorization_token", False):
            token = overrides.get("authorization_token") or (args or {}).get("authorization_token")
            if not token:
                decisions.append(GuardrailDecision(False, "block", "authorization_check",
                                 "no authorization_token provided for an authorized-testing harness"))

        # no_production_targets (warn): heuristic production detection.
        if self._find("no_production_targets"):
            for t in targets:
                low = t.lower()
                if any(m in low for m in _PROD_MARKERS):
                    decisions.append(GuardrailDecision(True, "warn", "no_production_targets",
                                     f"target '{t}' may be a production system"))
                    break

        # require / require_log — recorded, not enforced.
        for gid in ("transcript_required", "require_log"):
            if self._find(gid):
                decisions.append(GuardrailDecision(True, "require_log", gid, "call recorded per policy"))

        return decisions

    async def throttle(self) -> float:
        """Enforce rate_limit_rps if a throttle guardrail is declared. Returns
        the seconds slept (0 if no throttle applies)."""
        if not self._find("rate_limit"):
            return 0.0
        rps = self.roe_scope.get("rate_limit_rps", 0) or 0
        if rps <= 0:
            return 0.0
        min_interval = 1.0 / rps
        now = time.monotonic()
        elapsed = now - self._last_call_ts
        slept = 0.0
        if self._last_call_ts and elapsed < min_interval:
            slept = min_interval - elapsed
            import asyncio
            await asyncio.sleep(slept)
        self._last_call_ts = time.monotonic()
        return slept
