"""In-memory request tracker for the admin Queue view.

This is intentionally simple: a dict of in-flight requests keyed by
trace_id, plus a fixed-size deque of recently completed requests.
The chat router pushes start/complete events through this. The admin
console pulls a snapshot to render the Queue section.
"""

import time
from collections import deque
from typing import Any


class QueueTracker:
    def __init__(self, history: int = 100) -> None:
        self._inflight: dict[str, dict] = {}
        self._completed: deque = deque(maxlen=history)

    def start(
        self,
        trace_id: str,
        model: str,
        endpoint: str = "/v1/chat/completions",
    ) -> None:
        self._inflight[trace_id] = {
            "trace_id": trace_id,
            "model": model,
            "endpoint": endpoint,
            "started_at": time.time(),
        }

    def complete(
        self,
        trace_id: str,
        status: int,
        tokens: int = 0,
    ) -> None:
        entry = self._inflight.pop(trace_id, None)
        if entry is None:
            return
        now = time.time()
        entry.update(
            {
                "ended_at": now,
                "latency_ms": int((now - entry["started_at"]) * 1000),
                "status": status,
                "tokens": tokens,
            }
        )
        self._completed.append(entry)

    def snapshot(self) -> dict[str, Any]:
        now = time.time()
        inflight = [
            {**v, "elapsed_ms": int((now - v["started_at"]) * 1000)}
            for v in self._inflight.values()
        ]
        completed = list(self._completed)
        # Recent latency stats (p50/p95) from the last completed batch.
        latencies = sorted(c["latency_ms"] for c in completed if "latency_ms" in c)
        p50 = latencies[len(latencies) // 2] if latencies else None
        p95_idx = max(0, int(len(latencies) * 0.95) - 1) if latencies else None
        p95 = latencies[p95_idx] if p95_idx is not None and latencies else None
        return {
            "in_flight": len(self._inflight),
            "inflight": inflight,
            "recent": completed[-20:],
            "completed_total": len(completed),
            "latency_p50_ms": p50,
            "latency_p95_ms": p95,
        }
