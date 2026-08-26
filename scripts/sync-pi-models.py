#!/usr/bin/env python3
"""
Sync attest-ai's model catalog into ~/.pi/agent/models.json.

Usage:
    python3 scripts/sync-pi-models.py [--api-key atai_...]

Fetches GET http://localhost:8080/v1/models (which proxies OpenRouter)
and rewrites the "attest-ai" provider block in ~/.pi/agent/models.json.
All other providers in models.json are left untouched.
"""

import argparse
import json
import os
import sys
import urllib.request
import urllib.error
from pathlib import Path

GATEWAY = "http://localhost:8080"
MODELS_JSON = Path.home() / ".pi" / "agent" / "models.json"

# Compat block applied to every model — tells pi not to require finish_reason
# from our proxy (it infers stop from stream end instead).
PROVIDER_COMPAT = {
    "supportsDeveloperRole": False,
    "supportsFinishReason": False,
    "supportsStore": False,
}

# Models to exclude (content-safety, embed, image-gen, etc.)
EXCLUDE_KEYWORDS = [
    "embed", "content-safety", "moderation", "whisper",
    "dall-e", "tts", "vision-only", "rerank",
]

# Optional: only include free models. Set to False to include all.
FREE_ONLY = False


def fetch_models(api_key: str) -> list[dict]:
    req = urllib.request.Request(
        f"{GATEWAY}/v1/models",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())
            return data.get("data", [])
    except urllib.error.HTTPError as e:
        print(f"Error fetching models: HTTP {e.code} {e.reason}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error fetching models: {e}", file=sys.stderr)
        sys.exit(1)


def model_to_pi(m: dict, *, free_only: bool = False) -> dict | None:
    model_id = m.get("id", "")  # already "openrouter/..."
    name = m.get("name", model_id)
    pricing = m.get("pricing", {})
    ctx = m.get("context_length") or 4096

    # Skip unwanted model types
    id_lower = model_id.lower()
    if any(kw in id_lower for kw in EXCLUDE_KEYWORDS):
        return None

    if free_only and not model_id.endswith(":free"):
        return None

    prompt_price = float(pricing.get("prompt", 0) or 0) * 1_000_000
    completion_price = float(pricing.get("completion", 0) or 0) * 1_000_000

    # Reasonable cap on maxTokens
    max_tokens = min(ctx // 4, 32768)

    return {
        "id": model_id,
        "name": name,
        "reasoning": False,
        "input": ["text"],
        "cost": {
            "input": round(prompt_price, 4),
            "output": round(completion_price, 4),
            "cacheRead": 0,
            "cacheWrite": 0,
        },
        "contextWindow": ctx,
        "maxTokens": max_tokens,
    }


def main():
    parser = argparse.ArgumentParser(description="Sync attest-ai models into pi")
    parser.add_argument("--api-key", default=os.getenv("ATTEST_AI_KEY", ""))
    parser.add_argument("--free-only", action="store_true", help="Only include :free models")
    parser.add_argument("--verified", action="store_true", help="Smoke-test each model before adding")
    parser.add_argument("--gateway", default=GATEWAY)
    args = parser.parse_args()

    gateway = args.gateway
    free_only = args.free_only

    if not args.api_key:
        print("Pass --api-key atai_... or set ATTEST_AI_KEY env var", file=sys.stderr)
        sys.exit(1)

    print(f"Fetching models from {gateway}/v1/models ...")
    raw = fetch_models(args.api_key)
    print(f"  Got {len(raw)} models from OpenRouter")

    pi_models = []
    for m in raw:
        entry = model_to_pi(m, free_only=free_only)
        if entry:
            pi_models.append(entry)

    print(f"  {len(pi_models)} models after filtering")

    if args.verified:
        print("  Smoke-testing each model (this may take a while) ...")
        import urllib.request as _ur
        import time as _time

        def _probe(model_id):
            payload = json.dumps({
                "model": model_id,
                "messages": [{"role": "user", "content": "Say hi."}],
                "stream": False,
            }).encode()
            req = _ur.Request(
                f"{gateway}/v1/chat/completions",
                data=payload,
                headers={"Authorization": f"Bearer {args.api_key}", "Content-Type": "application/json"},
                method="POST",
            )
            try:
                with _ur.urlopen(req, timeout=45) as r:
                    body = json.loads(r.read())
                    content = body.get("choices", [{}])[0].get("message", {}).get("content", "") or ""
                    return not content.startswith("Agent error:")
            except Exception:
                return False

        verified = []
        for entry in pi_models:
            ok = _probe(entry["id"])
            mark = "✓" if ok else "✗"
            print(f"    {mark} {entry['id']}")
            if ok:
                verified.append(entry)
        pi_models = verified
        print(f"  {len(pi_models)} models passed verification")

    print(f"  Keeping {len(pi_models)} models")

    # Load existing models.json (create if absent)
    existing = {"providers": {}}
    if MODELS_JSON.exists():
        try:
            existing = json.loads(MODELS_JSON.read_text())
        except Exception:
            pass

    existing.setdefault("providers", {})
    existing["providers"]["attest-ai"] = {
        "name": "attest-ai",
        "baseUrl": f"{gateway}/v1",
        "api": "openai-completions",
        "compat": PROVIDER_COMPAT,
        "models": pi_models,
    }

    MODELS_JSON.write_text(json.dumps(existing, indent=2) + "\n")
    print(f"  Written to {MODELS_JSON}")
    print(f"\nDone. Restart pi to pick up the new model list.")


if __name__ == "__main__":
    main()
