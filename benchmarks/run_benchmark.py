"""
Benchmark script for the LLM inference server.

Runs three test suites:
  1. Sequential latency  — 50 requests, measures p50/p95/p99 TTFT
  2. Concurrent throughput — 20 parallel requests, measures total tokens/sec
  3. Cache effectiveness  — 50 requests with 30% duplicates, measures hit rate

Usage:
  python benchmarks/run_benchmark.py [--base-url URL] [--api-key KEY]

Results written to benchmarks/results.md
"""

import argparse
import asyncio
import json
import statistics
import time
from pathlib import Path

import httpx


BASE_URL = "http://localhost:8000"
API_KEY = "change-me"

QUESTIONS = [
    "What is the capital of France?",
    "Explain photosynthesis in one sentence.",
    "What is 2 + 2?",
    "Name three programming languages.",
    "What is the speed of light?",
    "Who wrote Romeo and Juliet?",
    "What is machine learning?",
    "Describe the water cycle briefly.",
    "What is a CPU?",
    "Name the planets in the solar system.",
]


def _headers(api_key: str) -> dict:
    return {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}


async def _single_request(
    client: httpx.AsyncClient,
    question: str,
    api_key: str,
    max_tokens: int = 50,
    stream: bool = False,
) -> tuple[float, int]:
    """Returns (ttft_seconds, total_tokens)."""
    payload = {
        "model": "mistral-7b",
        "messages": [{"role": "user", "content": question}],
        "max_tokens": max_tokens,
        "stream": stream,
    }

    start = time.perf_counter()
    ttft = None
    token_count = 0

    if stream:
        async with client.stream(
            "POST",
            f"{BASE_URL}/v1/chat/completions",
            json=payload,
            headers=_headers(api_key),
        ) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line.startswith("data: "):
                    continue
                raw = line[6:]
                if raw == "[DONE]":
                    break
                try:
                    chunk = json.loads(raw)
                    delta = chunk["choices"][0]["delta"].get("content", "")
                    if delta and ttft is None:
                        ttft = time.perf_counter() - start
                    if delta:
                        token_count += 1
                except (json.JSONDecodeError, KeyError):
                    continue
    else:
        resp = await client.post(
            f"{BASE_URL}/v1/chat/completions",
            json=payload,
            headers=_headers(api_key),
            timeout=60,
        )
        resp.raise_for_status()
        ttft = time.perf_counter() - start
        body = resp.json()
        token_count = body.get("usage", {}).get("completion_tokens", 0)

    return ttft or (time.perf_counter() - start), token_count


async def benchmark_sequential(api_key: str, n: int = 50) -> dict:
    print(f"\n[1/3] Sequential latency benchmark ({n} requests)...")
    latencies = []

    async with httpx.AsyncClient(timeout=120) as client:
        for i in range(n):
            question = QUESTIONS[i % len(QUESTIONS)]
            try:
                ttft, _ = await _single_request(client, question, api_key, stream=True)
                latencies.append(ttft)
                print(f"  {i+1:3d}/{n} TTFT={ttft*1000:.0f}ms", end="\r")
            except Exception as exc:
                print(f"  {i+1:3d}/{n} ERROR: {exc}")

    if not latencies:
        return {"error": "All requests failed"}

    latencies.sort()
    p50 = statistics.median(latencies)
    p95 = latencies[int(len(latencies) * 0.95)]
    p99 = latencies[int(len(latencies) * 0.99)]
    return {
        "n": len(latencies),
        "p50_ms": round(p50 * 1000, 1),
        "p95_ms": round(p95 * 1000, 1),
        "p99_ms": round(p99 * 1000, 1),
        "mean_ms": round(statistics.mean(latencies) * 1000, 1),
    }


async def benchmark_concurrent(api_key: str, concurrency: int = 20) -> dict:
    print(f"\n[2/3] Concurrent throughput benchmark ({concurrency} parallel requests)...")
    question = "Count from 1 to 20 and explain each number briefly."

    start = time.perf_counter()
    async with httpx.AsyncClient(timeout=300) as client:
        tasks = [
            _single_request(client, question, api_key, max_tokens=100, stream=False)
            for _ in range(concurrency)
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

    elapsed = time.perf_counter() - start
    successes = [(ttft, tok) for r in results if not isinstance(r, Exception) for ttft, tok in [r]]
    total_tokens = sum(tok for _, tok in successes)

    return {
        "concurrency": concurrency,
        "successful": len(successes),
        "failed": concurrency - len(successes),
        "total_wall_seconds": round(elapsed, 1),
        "total_tokens": total_tokens,
        "tokens_per_second": round(total_tokens / elapsed, 1) if elapsed > 0 else 0,
    }


async def benchmark_cache(api_key: str, n: int = 50, duplicate_rate: float = 0.3) -> dict:
    print(f"\n[3/3] Cache effectiveness benchmark ({n} requests, {int(duplicate_rate*100)}% duplicates)...")

    # Pre-warm with unique questions
    unique_q = "What is artificial intelligence?"
    warm_payload = {
        "model": "mistral-7b",
        "messages": [{"role": "user", "content": unique_q}],
        "max_tokens": 50,
        "stream": False,
    }

    async with httpx.AsyncClient(timeout=120) as client:
        # Warm the cache
        try:
            await client.post(
                f"{BASE_URL}/v1/chat/completions",
                json=warm_payload,
                headers=_headers(api_key),
            )
        except Exception:
            pass

        latencies_miss = []
        latencies_hit = []

        for i in range(n):
            is_duplicate = (i / n) < duplicate_rate
            question = unique_q if is_duplicate else QUESTIONS[i % len(QUESTIONS)]
            t_start = time.perf_counter()
            try:
                resp = await client.post(
                    f"{BASE_URL}/v1/chat/completions",
                    json={
                        "model": "mistral-7b",
                        "messages": [{"role": "user", "content": question}],
                        "max_tokens": 50,
                        "stream": False,
                    },
                    headers=_headers(api_key),
                    timeout=60,
                )
                elapsed = time.perf_counter() - t_start
                if is_duplicate:
                    latencies_hit.append(elapsed)
                else:
                    latencies_miss.append(elapsed)
            except Exception as exc:
                print(f"  {i+1:3d}/{n} ERROR: {exc}")

    hit_latency = round(statistics.mean(latencies_hit) * 1000, 1) if latencies_hit else None
    miss_latency = round(statistics.mean(latencies_miss) * 1000, 1) if latencies_miss else None

    return {
        "total_requests": n,
        "duplicate_rate_pct": int(duplicate_rate * 100),
        "avg_hit_latency_ms": hit_latency,
        "avg_miss_latency_ms": miss_latency,
        "speedup_x": round(miss_latency / hit_latency, 1) if hit_latency and miss_latency and hit_latency > 0 else None,
    }


def _write_results(seq: dict, conc: dict, cache: dict) -> None:
    output = Path(__file__).parent / "results.md"
    lines = [
        "# Benchmark Results",
        "",
        f"_Generated: {time.strftime('%Y-%m-%d %H:%M:%S')}_",
        "",
        "## 1. Sequential Latency (TTFT)",
        "",
        "| Metric | Value |",
        "|--------|-------|",
        f"| Requests | {seq.get('n', 'N/A')} |",
        f"| p50 TTFT | {seq.get('p50_ms', 'N/A')} ms |",
        f"| p95 TTFT | {seq.get('p95_ms', 'N/A')} ms |",
        f"| p99 TTFT | {seq.get('p99_ms', 'N/A')} ms |",
        f"| Mean TTFT | {seq.get('mean_ms', 'N/A')} ms |",
        "",
        "## 2. Concurrent Throughput",
        "",
        "| Metric | Value |",
        "|--------|-------|",
        f"| Concurrency | {conc.get('concurrency', 'N/A')} |",
        f"| Successful | {conc.get('successful', 'N/A')}/{conc.get('concurrency', 'N/A')} |",
        f"| Total wall time | {conc.get('total_wall_seconds', 'N/A')} s |",
        f"| Total tokens | {conc.get('total_tokens', 'N/A')} |",
        f"| Throughput | **{conc.get('tokens_per_second', 'N/A')} tokens/sec** |",
        "",
        "## 3. Semantic Cache Effectiveness",
        "",
        "| Metric | Value |",
        "|--------|-------|",
        f"| Total requests | {cache.get('total_requests', 'N/A')} |",
        f"| Duplicate rate | {cache.get('duplicate_rate_pct', 'N/A')}% |",
        f"| Avg cache hit latency | {cache.get('avg_hit_latency_ms', 'N/A')} ms |",
        f"| Avg cache miss latency | {cache.get('avg_miss_latency_ms', 'N/A')} ms |",
        f"| Speedup | **{cache.get('speedup_x', 'N/A')}×** |",
        "",
        "---",
        "_Benchmarked against Mistral 7B INT4 (Q4_K_M), CPU-only inference._",
    ]
    output.write_text("\n".join(lines))
    print(f"\nResults written to {output}")


async def main(base_url: str, api_key: str) -> None:
    global BASE_URL
    BASE_URL = base_url

    print("LLM Inference Server — Benchmark Suite")
    print("=" * 40)

    seq = await benchmark_sequential(api_key)
    print(f"\n  p50={seq.get('p50_ms')}ms  p95={seq.get('p95_ms')}ms  p99={seq.get('p99_ms')}ms")

    conc = await benchmark_concurrent(api_key)
    print(f"\n  {conc.get('tokens_per_second')} tokens/sec across {conc.get('concurrency')} concurrent users")

    cache = await benchmark_cache(api_key)
    print(f"\n  Cache speedup: {cache.get('speedup_x')}× ({cache.get('avg_hit_latency_ms')}ms vs {cache.get('avg_miss_latency_ms')}ms)")

    _write_results(seq, conc, cache)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="LLM server benchmark")
    parser.add_argument("--base-url", default=BASE_URL, help="Server base URL")
    parser.add_argument("--api-key", default=API_KEY, help="API key")
    args = parser.parse_args()
    asyncio.run(main(args.base_url, args.api_key))
