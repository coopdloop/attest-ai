#!/usr/bin/env python3
"""
Smoke-test every free model on the attest-ai gateway.

Usage:
    python3 scripts/test-models.py --api-key atai_...
    python3 scripts/test-models.py --api-key atai_... --all        # include paid
    python3 scripts/test-models.py --api-key atai_... --workers 5  # parallelism

Outputs a table: model | status | latency | first ~80 chars of response or error
"""

import argparse
import json
import os
import sys
import time
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

GATEWAY = "http://localhost:8080"
TEST_MESSAGE = "Reply with exactly three words."
TIMEOUT = 60  # seconds per model

GREEN  = "\033[32m"
RED    = "\033[31m"
YELLOW = "\033[33m"
RESET  = "\033[0m"
BOLD   = "\033[1m"


def fetch_models(api_key: str, free_only: bool, gateway: str = GATEWAY) -> list[str]:
    req = urllib.request.Request(
        f"{gateway}/v1/models",
        headers={"Authorization": f"Bearer {api_key}"},
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        data = json.loads(r.read())
    ids = [m["id"] for m in data.get("data", [])]
    if free_only:
        ids = [i for i in ids if i.endswith(":free")]
    # skip embed / safety / non-chat models
    skip = ["embed", "content-safety", "moderation", "whisper", "dall-e", "tts", "rerank"]
    ids = [i for i in ids if not any(s in i.lower() for s in skip)]
    return sorted(ids)


def test_model(model_id: str, api_key: str, gateway: str = GATEWAY) -> dict:
    payload = json.dumps({
        "model": model_id,
        "messages": [{"role": "user", "content": TEST_MESSAGE}],
        "stream": False,
    }).encode()
    req = urllib.request.Request(
        f"{gateway}/v1/chat/completions",
        data=payload,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            elapsed = time.monotonic() - t0
            body = json.loads(r.read())
            content = (
                body.get("choices", [{}])[0]
                    .get("message", {})
                    .get("content", "")
                or ""
            )
            # Gateway returns HTTP 200 even when the upstream model errored
            if content.startswith("Agent error:"):
                return {"ok": False, "latency": elapsed, "text": content[:100]}
            return {"ok": True, "latency": elapsed, "text": content[:100]}
    except urllib.error.HTTPError as e:
        elapsed = time.monotonic() - t0
        try:
            detail = json.loads(e.read()).get("detail") or e.reason
        except Exception:
            detail = e.reason
        return {"ok": False, "latency": elapsed, "text": str(detail)[:100]}
    except Exception as e:
        elapsed = time.monotonic() - t0
        return {"ok": False, "latency": elapsed, "text": str(e)[:100]}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--api-key", default=os.getenv("ATTEST_AI_KEY", ""))
    parser.add_argument("--all", action="store_true", help="Test paid models too")
    parser.add_argument("--workers", type=int, default=4, help="Parallel workers")
    parser.add_argument("--gateway", default=GATEWAY)
    args = parser.parse_args()

    if not args.api_key:
        print("Pass --api-key atai_... or set ATTEST_AI_KEY", file=sys.stderr)
        sys.exit(1)

    gateway = args.gateway
    free_only = not args.all
    print(f"Fetching {'free ' if free_only else ''}models from {gateway}/v1/models ...")
    models = fetch_models(args.api_key, free_only, gateway=gateway)
    print(f"Found {len(models)} models to test ({args.workers} workers, {TIMEOUT}s timeout each)\n")

    col_w = max(len(m) for m in models) + 2

    header = f"{'MODEL':<{col_w}}  {'STATUS':<8}  {'LATENCY':>8}  RESPONSE"
    print(BOLD + header + RESET)
    print("─" * min(len(header) + 30, 120))

    results = {}
    futures = {}
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for m in models:
            futures[pool.submit(test_model, m, args.api_key, gateway)] = m

        completed = 0
        for future in as_completed(futures):
            model_id = futures[future]
            result = future.result()
            results[model_id] = result
            completed += 1

            ok = result["ok"]
            lat = f"{result['latency']:.1f}s"
            text = result["text"].replace("\n", " ")
            status_str = f"{GREEN}OK{RESET}    " if ok else f"{RED}FAIL{RESET}  "
            print(f"{model_id:<{col_w}}  {status_str}  {lat:>8}  {text}")
            sys.stdout.flush()

    # Summary
    ok_count = sum(1 for r in results.values() if r["ok"])
    fail_count = len(results) - ok_count
    print("\n" + "─" * min(len(header) + 30, 120))
    print(f"{BOLD}Results: {GREEN}{ok_count} passed{RESET}{BOLD}, {RED}{fail_count} failed{RESET}{BOLD} / {len(results)} total{RESET}")

    if fail_count:
        print(f"\n{YELLOW}Failed models:{RESET}")
        for m, r in sorted(results.items()):
            if not r["ok"]:
                print(f"  {m}: {r['text']}")


if __name__ == "__main__":
    main()
