from prometheus_client import (
    CONTENT_TYPE_LATEST,
    Counter,
    Gauge,
    Histogram,
    generate_latest,
    make_asgi_app,
)

ttft_seconds = Histogram(
    "llm_ttft_seconds",
    "Time to first token in seconds",
    labelnames=["model"],
    buckets=[0.1, 0.3, 0.5, 1.0, 2.0, 5.0, 10.0],
)

tokens_generated_total = Counter(
    "llm_tokens_generated_total",
    "Total number of tokens generated",
    labelnames=["model"],
)

requests_total = Counter(
    "llm_requests_total",
    "Total number of inference requests",
    labelnames=["model", "status_code"],
)

request_duration_seconds = Histogram(
    "llm_request_duration_seconds",
    "End-to-end request duration in seconds",
    labelnames=["endpoint"],
    buckets=[0.1, 0.5, 1.0, 2.0, 5.0, 10.0, 30.0, 60.0],
)

tokens_per_second = Gauge(
    "llm_tokens_per_second",
    "Current tokens per second throughput",
    labelnames=["model"],
)

errors_total = Counter(
    "llm_errors_total",
    "Total number of errors by type",
    labelnames=["error_type"],
)

cache_hits_total = Counter(
    "llm_cache_hits_total",
    "Total semantic cache hits",
    labelnames=["model"],
)

cache_misses_total = Counter(
    "llm_cache_misses_total",
    "Total semantic cache misses",
    labelnames=["model"],
)

cache_lookup_seconds = Histogram(
    "llm_cache_lookup_seconds",
    "Time spent on cache lookup",
    buckets=[0.001, 0.005, 0.01, 0.05, 0.1, 0.5],
)

queue_depth = Gauge(
    "llm_queue_depth",
    "Current number of requests waiting in queue",
)


def get_metrics_app():
    return make_asgi_app()
