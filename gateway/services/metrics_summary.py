"""Real-time rollup of Prometheus counters/histograms for the dashboard.

This is the single source of truth for the values shown in the workspace
MetricsRail, MetricsView, and admin OverviewSection. Both /v1/metrics/summary
(user-facing) and /admin/metrics/summary (admin-only) return this payload.
"""

from __future__ import annotations

import time
from typing import Any

from prometheus_client import REGISTRY

_BOOT_TS = time.time()


def _collect_samples() -> dict[str, list[tuple[dict, float]]]:
    samples: dict[str, list[tuple[dict, float]]] = {}
    for collector in REGISTRY.collect():
        for sample in collector.samples:
            samples.setdefault(sample.name, []).append((sample.labels, sample.value))
    return samples


def _sum(samples: dict, name: str) -> float:
    return sum(v for _, v in samples.get(name, []))


def _last_gauge(samples: dict, name: str) -> float:
    rows = samples.get(name, [])
    return rows[-1][1] if rows else 0.0


def _process_memory_mb() -> float:
    """RSS in MB from /proc/self/status (Linux container)."""
    try:
        with open("/proc/self/status") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    return round(int(line.split()[1]) / 1024, 1)
    except (OSError, ValueError, IndexError):
        pass
    return 0.0


def build_summary(app_state) -> dict[str, Any]:
    s = _collect_samples()

    total_requests = _sum(s, "llm_requests_total")
    hits = _sum(s, "llm_cache_hits_total")
    misses = _sum(s, "llm_cache_misses_total")
    cache_total = hits + misses
    cache_hit_rate = (hits / cache_total) if cache_total > 0 else 0.0

    tokens_total = _sum(s, "llm_tokens_generated_total")
    tps = _last_gauge(s, "llm_tokens_per_second")

    ttft_sum = _sum(s, "llm_ttft_seconds_sum")
    ttft_count = _sum(s, "llm_ttft_seconds_count")
    ttft_mean_ms = int((ttft_sum / ttft_count) * 1000) if ttft_count > 0 else 0

    errors = _sum(s, "llm_errors_total")
    error_rate = (errors / total_requests) if total_requests > 0 else 0.0

    queue_depth = _last_gauge(s, "llm_queue_depth")

    tracker = getattr(app_state, "queue_tracker", None)
    inflight = tracker.snapshot()["in_flight"] if tracker is not None else 0

    uptime_sec = int(time.time() - _BOOT_TS)
    rpm = (total_requests / uptime_sec * 60) if uptime_sec > 0 else 0.0

    return {
        "total_requests": int(total_requests),
        "requests_per_min": round(rpm, 1),
        "tokens_total": int(tokens_total),
        "tokens_per_sec": round(tps, 2),
        "cache_hit_rate": round(cache_hit_rate, 4),
        "cache_hits": int(hits),
        "cache_misses": int(misses),
        "ttft_mean_ms": ttft_mean_ms,
        "errors": int(errors),
        "error_rate": round(error_rate, 4),
        "queue_depth": int(queue_depth),
        "in_flight": inflight,
        "memory_mb": _process_memory_mb(),
        "uptime_sec": uptime_sec,
    }
