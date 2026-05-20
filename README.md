<div align="center">

# LLM Inference Server

### A production-grade, self-hosted Large Language Model inference server  
### with an OpenAI-compatible REST API

---

**Run your own AI — privately, securely, for free.**  
No cloud API costs. No data leaving your machine. Full observability included.

[What Is This?](#what-is-this-non-technical-explanation) • [Architecture](#architecture) • [Quickstart](#quickstart-5-minutes) • [API Reference](#api-reference) • [How It Works](#how-every-component-works) • [Configuration](#configuration) • [Testing](#testing) • [Observability](#observability) • [Design Decisions](#architecture-decision-records) • [Roadmap](#roadmap) • [FAQ](#faq) • [Glossary](#glossary)

</div>

---

## What Is This? (Non-Technical Explanation)

> **Skip to [Quickstart](#quickstart-5-minutes) if you already know what LLMs are.**

### The Problem This Solves

When you use ChatGPT, Claude, or Gemini, every message you type is sent to a remote company's server. For most use cases that's fine — but not for everyone:

- A **hospital** asking an AI to help draft patient notes cannot send those notes to OpenAI — HIPAA prohibits it.
- A **law firm** reviewing contracts cannot send privileged client communications to a third-party cloud service.
- A **startup** building an AI product and paying $0.02 per 1,000 tokens will spend thousands of dollars per month at scale.
- A **researcher** who needs reproducible, offline results cannot rely on a cloud service that can change without notice.

### The Solution

This project lets you run a powerful AI model **entirely on your own computer or server**. Your prompts never leave your machine. It speaks the exact same language as ChatGPT's API — so any code or tool already built for OpenAI works here without modification, just by changing one URL.

```
BEFORE:  client = OpenAI(base_url="https://api.openai.com/v1",  api_key="sk-...")
AFTER:   client = OpenAI(base_url="http://localhost:8000/v1",   api_key="your-local-key")
```

That's the only change. Everything else stays the same.

### What "Production-Grade" Means

This isn't a toy demo. It includes the same infrastructure patterns used in real-world AI services:

| Feature | Why It Matters |
|---------|---------------|
| **API key authentication** | Only authorized callers can use the server |
| **Rate limiting** | Prevents any single user from flooding the server |
| **Semantic caching** | Identical or similar questions return instantly without re-running AI inference |
| **Real-time metrics** | Know exactly how fast your AI is, how many requests it handles, and when something goes wrong |
| **Visual dashboards** | Grafana charts showing latency, throughput, and cache hit rates in real-time |
| **Single-command deploy** | `docker compose up` and everything starts automatically |
| **Streaming responses** | Text appears word-by-word as it's generated, just like ChatGPT |

### What Model Does It Run?

By default it runs **Mistral 7B Instruct** — a 7-billion-parameter open-source language model that:
- Fits in **8 GB of RAM** (using INT4 quantization, the model is compressed from 14 GB to ~4.1 GB)
- Runs on a **regular CPU** — no GPU required
- Produces answers of similar quality to GPT-3.5 for most tasks
- Is completely **free to use commercially**

---

## Architecture

### High-Level Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        YOUR MACHINE                             │
│                                                                 │
│   Client (Python SDK / curl / any HTTP tool)                    │
│            │                                                    │
│            │  POST /v1/chat/completions                         │
│            │  Authorization: Bearer your-key                   │
│            ▼                                                    │
│   ┌─────────────────────────────────────────────────────┐      │
│   │              FastAPI Gateway  :8000                  │      │
│   │                                                      │      │
│   │  1. Auth middleware  ──── validates Bearer token     │      │
│   │  2. Rate limiter     ──── checks token bucket/Redis  │      │
│   │  3. Semantic cache   ──── cosine similarity lookup   │      │
│   │  4. Route to engine  ──── if cache miss              │      │
│   │  5. Stream response  ──── SSE back to client         │      │
│   │  6. Update metrics   ──── Prometheus counters        │      │
│   └──────────────┬──────────────────────┬───────────────┘      │
│                  │                      │                       │
│     cache miss   │           ┌──────────▼──────────┐           │
│                  │           │       Redis :6379    │           │
│                  │           │  ┌─────────────────┐ │           │
│                  │           │  │  Semantic Cache  │ │           │
│                  │           │  │  (embeddings +   │ │           │
│                  │           │  │   responses)     │ │           │
│                  │           │  └─────────────────┘ │           │
│                  │           │  ┌─────────────────┐ │           │
│                  │           │  │  Rate Limit      │ │           │
│                  │           │  │  (token bucket   │ │           │
│                  │           │  │   per API key)   │ │           │
│                  │           │  └─────────────────┘ │           │
│                  │           └─────────────────────-┘           │
│                  ▼                                              │
│   ┌──────────────────────────────────┐                         │
│   │   llama.cpp Engine  :8001        │                         │
│   │   (internal only — no host port) │                         │
│   │                                  │                         │
│   │   Mistral 7B INT4 model          │                         │
│   │   ~/models/ ──── read-only mount │                         │
│   │   Generates tokens via C++       │                         │
│   └──────────────────────────────────┘                         │
│                  │                                              │
│   ┌──────────────▼───────────────────────────────────────┐     │
│   │  Prometheus :9090  ──scrapes──►  Grafana :3000        │     │
│   │  (metrics store)                 (6-panel dashboard)  │     │
│   └──────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────┘
```

### Request Lifecycle (Step by Step)

Every time a client sends a message, here is the exact sequence of events:

```
Client sends:  POST /v1/chat/completions
               {"messages": [{"role": "user", "content": "Why is the sky blue?"}]}
               Authorization: Bearer sk-your-key

Step 1 ─── Auth Middleware
           ├── Does the Authorization header exist? ──── No → 401 Unauthorized
           └── Does it match the configured API_KEY? ─── No → 401 Unauthorized
               Uses secrets.compare_digest() to prevent timing attacks ✓

Step 2 ─── Rate Limiter
           ├── Is Redis available? ────────────────────── No → skip (graceful)
           ├── How many requests has this key made in the last 60s?
           └── Count >= RATE_LIMIT_RPM (60)? ──────────── Yes → 429 Too Many Requests
               Returns Retry-After header so client knows when to retry ✓

Step 3 ─── Semantic Cache Lookup
           ├── Is Redis available? ────────────────────── No → skip to Step 4
           ├── Encode "Why is the sky blue?" → 384-dim float32 vector
           ├── Compare against all cached embeddings (cosine similarity)
           └── Best score >= 0.95? ───────────────────── Yes → return cached answer in <50ms ✓
                                                         No  → proceed to Step 4

Step 4 ─── Inference Engine
           ├── Format message using Mistral chat template:
           │   <s>[INST] Why is the sky blue? [/INST]
           ├── POST to llama.cpp:8001/completion
           └── stream=true? ─── Yes → yield tokens via SSE as they are generated
                              ─ No  → wait for full response, return JSON

Step 5 ─── Cache the Response
           ├── Store embedding vector in Redis (key: cache:emb:<timestamp>)
           ├── Store full response JSON in Redis (key: cache:resp:<timestamp>)
           └── Set TTL = CACHE_TTL_SECONDS (1 hour default)

Step 6 ─── Update Prometheus Metrics
           ├── llm_ttft_seconds: how long until first token
           ├── llm_tokens_generated_total: how many tokens were produced
           ├── llm_requests_total: increment request counter (model, status_code labels)
           └── llm_cache_misses_total: increment miss counter

Client receives:
{
  "id": "chatcmpl-a3f92b1e",
  "object": "chat.completion",
  "model": "mistral-7b",
  "choices": [{
    "index": 0,
    "message": {"role": "assistant", "content": "The sky is blue because..."},
    "finish_reason": "stop"
  }],
  "usage": {"prompt_tokens": 8, "completion_tokens": 47, "total_tokens": 55}
}
```

### Service Dependency Graph

```
grafana
  └── depends_on: prometheus
        └── depends_on: gateway (healthy)
              └── depends_on: llama-cpp (healthy) ← waits up to 5 min for model load
                             redis (started)       ← optional; gateway starts without it
```

---

## Quickstart (5 Minutes)

### Prerequisites

| Requirement | Minimum | Recommended |
|-------------|---------|-------------|
| RAM | 8 GB | 16 GB |
| Disk space | 6 GB | 10 GB |
| Docker Desktop | Any | Latest |
| OS | Windows 10 / macOS 12 / Ubuntu 20.04 | — |

> **No GPU required.** The server runs entirely on CPU.

### Step 1 — Download the Model (~4.1 GB)

<details>
<summary><b>Linux / macOS</b></summary>

```bash
mkdir -p ~/models
wget -P ~/models \
  "https://huggingface.co/TheBloke/Mistral-7B-Instruct-v0.2-GGUF/resolve/main/mistral-7b-instruct-v0.2.Q4_K_M.gguf"
```

Or with curl:
```bash
curl -L -o ~/models/mistral-7b-instruct-v0.2.Q4_K_M.gguf \
  "https://huggingface.co/TheBloke/Mistral-7B-Instruct-v0.2-GGUF/resolve/main/mistral-7b-instruct-v0.2.Q4_K_M.gguf"
```
</details>

<details>
<summary><b>Windows (PowerShell)</b></summary>

```powershell
New-Item -ItemType Directory -Path "$env:USERPROFILE\models" -Force
Invoke-WebRequest `
  -Uri "https://huggingface.co/TheBloke/Mistral-7B-Instruct-v0.2-GGUF/resolve/main/mistral-7b-instruct-v0.2.Q4_K_M.gguf" `
  -OutFile "$env:USERPROFILE\models\mistral-7b-instruct-v0.2.Q4_K_M.gguf"
```
</details>

### Step 2 — Configure Environment

```bash
cp .env.example .env
```

Open `.env` and fill in the two required fields:

```bash
# Generate a secure key:
# Linux/Mac:  python3 -c "import secrets; print(secrets.token_urlsafe(32))"
# Windows:    python -c "import secrets; print(secrets.token_urlsafe(32))"

API_KEY=your-generated-secret-key-here

# Linux/Mac: the directory you created in Step 1
MODEL_PATH=/home/yourname/models

# Windows: use backslash path
MODEL_PATH=C:\Users\yourname\models
```

### Step 3 — Start the Stack

```bash
docker compose up --build
```

**What happens during the first run:**
1. Docker builds the gateway image (Python + dependencies, ~2 min)
2. Docker builds the llama-cpp image (compiles C++ from source, ~5–10 min)
3. llama.cpp loads the 4.1 GB model into memory (~30s)
4. Redis starts up (~1s)
5. Gateway connects to all services and begins serving requests

Watch the logs to know when everything is ready:
```bash
# In another terminal:
docker compose logs -f gateway
# Look for: {"event": "server_ready", "port": 8000}
```

### Step 4 — Verify It's Working

```bash
# Health check (no auth required)
curl http://localhost:8000/health

# Expected response:
# {"status":"ok","engine":"llamacpp","model_loaded":true}
```

### Step 5 — Make Your First AI Request

<details>
<summary><b>Using curl</b></summary>

```bash
curl -X POST http://localhost:8000/v1/chat/completions \
  -H "Authorization: Bearer your-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "mistral-7b",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "Explain quantum computing in one paragraph."}
    ],
    "max_tokens": 200
  }'
```
</details>

<details>
<summary><b>Using the OpenAI Python SDK</b></summary>

```python
from openai import OpenAI

# Point the SDK at your local server instead of OpenAI
client = OpenAI(
    base_url="http://localhost:8000/v1",
    api_key="your-key-here"  # must match API_KEY in your .env
)

# Non-streaming request (waits for the full response)
response = client.chat.completions.create(
    model="mistral-7b",
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "What is the capital of Japan?"}
    ],
    max_tokens=100
)
print(response.choices[0].message.content)

# Streaming request (text appears word-by-word)
for chunk in client.chat.completions.create(
    model="mistral-7b",
    messages=[{"role": "user", "content": "Tell me a short story about a robot."}],
    max_tokens=300,
    stream=True,
):
    print(chunk.choices[0].delta.content or "", end="", flush=True)
```
</details>

<details>
<summary><b>Using Node.js / TypeScript</b></summary>

```typescript
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://localhost:8000/v1",
  apiKey: "your-key-here",
});

const response = await client.chat.completions.create({
  model: "mistral-7b",
  messages: [{ role: "user", content: "Summarize the French Revolution in 3 bullet points." }],
  max_tokens: 200,
});

console.log(response.choices[0].message.content);
```
</details>

### Step 6 — Open the Observability Dashboard

| Service | URL | Credentials |
|---------|-----|-------------|
| Grafana Dashboard | http://localhost:3000 | admin / admin |
| Prometheus Metrics | http://localhost:9090 | none |
| Raw Metrics (text) | http://localhost:8000/metrics | none |
| API Documentation | http://localhost:8000/docs | none |

---

## Repository Structure

```
llm-inference-server/
│
├── gateway/                          # FastAPI application (the "brain")
│   ├── main.py                       # App entrypoint + startup/shutdown lifecycle
│   ├── config.py                     # All settings loaded from environment variables
│   ├── schemas.py                    # Pydantic data models (OpenAI-compatible)
│   ├── metrics.py                    # Prometheus metric definitions
│   ├── Dockerfile                    # Multi-stage container build
│   ├── pyproject.toml                # Python dependencies (uv/pip)
│   │
│   ├── routers/                      # HTTP endpoint handlers
│   │   ├── chat.py                   # POST /v1/chat/completions (main inference)
│   │   ├── health.py                 # GET /health (liveness check)
│   │   └── models.py                 # GET /v1/models (list available models)
│   │
│   ├── middleware/                   # Request processing pipeline
│   │   ├── auth.py                   # Bearer token validation (timing-safe)
│   │   └── rate_limit.py             # Token bucket rate limiter (Redis)
│   │
│   └── services/                     # External service integrations
│       ├── engine.py                 # HTTP client for llama.cpp
│       ├── cache.py                  # Semantic cache (embeddings + Redis)
│       └── streaming.py              # SSE (Server-Sent Events) format helpers
│
├── llama-cpp-server/                 # AI inference engine container
│   └── Dockerfile                    # Ubuntu + CMake build of llama.cpp
│
├── tests/                            # Test suite (13 integration tests)
│   ├── conftest.py                   # pytest fixtures + mock engine setup
│   ├── test_auth.py                  # 5 authentication tests
│   └── test_chat.py                  # 8 inference + streaming tests
│
├── prometheus/
│   └── prometheus.yml                # Scrape configuration (gateway:8000/metrics)
│
├── grafana/
│   ├── dashboards/
│   │   └── llm-inference.json        # 6-panel Grafana dashboard (auto-provisioned)
│   └── provisioning/
│       ├── datasources/              # Prometheus data source config
│       └── dashboards/               # Dashboard auto-load config
│
├── benchmarks/
│   └── run_benchmark.py              # 3-suite load testing script
│
├── docs/
│   └── adr/                          # Architecture Decision Records
│       ├── ADR-001-volume-mount-for-models.md
│       ├── ADR-002-fastapi-over-flask.md
│       ├── ADR-003-semantic-cache-design.md
│       └── ADR-004-llama-cpp-for-mvp.md
│
├── .github/
│   └── workflows/
│       └── ci.yml                    # GitHub Actions: lint + test + Docker build
│
├── docker-compose.yml                # All 5 services orchestrated
├── .env.example                      # Environment variable template (copy to .env)
└── .gitignore                        # Excludes .env, models, __pycache__
```

---

## How Every Component Works

### 1. The Gateway (`gateway/`)

The gateway is the only publicly exposed service. Every request flows through it.

#### 1a. Application Entrypoint (`main.py`)

When the server starts, it runs a **lifespan context manager** that initializes all shared resources exactly once:

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    # --- STARTUP ---
    app.state.engine_client = LlamaCppClient(host=..., port=8001)

    try:
        r = aioredis.Redis(...)
        await r.ping()                           # Verify Redis is alive
        app.state.redis_client = r
        app.state.cache = await SemanticCache.create(r, settings)
        # ↑ This downloads and loads the 22MB all-MiniLM-L6-v2 model
    except Exception:
        log.warning("redis_unavailable")         # Redis is optional — server keeps running

    yield  # ← server is now serving requests

    # --- SHUTDOWN ---
    await app.state.redis_client.aclose()        # Clean connection teardown
```

**Key design: graceful degradation.** If Redis is unavailable, the server starts anyway — caching and rate limiting are simply disabled. The LLM inference still works. This means a Redis outage doesn't take down the entire service.

The application then mounts three routes:
- `/health` — no auth
- `/v1/chat/completions` — auth + rate limit required
- `/v1/models` — auth required
- `/metrics` — no auth (Prometheus scraping endpoint)

#### 1b. Configuration (`config.py`)

All configuration is loaded from environment variables using [pydantic-settings](https://docs.pydantic.dev/latest/concepts/pydantic_settings/). The `@lru_cache` decorator ensures settings are parsed only once at startup:

```python
class Settings(BaseSettings):
    api_key: str                           # Required — server won't start without it
    admin_api_key: str = ""                # Optional separate key for admin endpoints

    engine_host: str = "localhost"         # llama.cpp hostname
    engine_port: int = 8001               # llama.cpp port

    rate_limit_rpm: int = 60              # Max requests per minute per API key
    cache_similarity_threshold: float = 0.95  # Cosine similarity threshold
    cache_ttl_seconds: int = 3600         # Cache entry lifetime (1 hour)

@lru_cache
def get_settings() -> Settings:
    return Settings()                     # Called via Depends() in every endpoint
```

#### 1c. Data Schemas (`schemas.py`)

Every piece of data that enters or leaves the API is validated by Pydantic v2 models. This ensures:
- Invalid requests are rejected with helpful error messages automatically
- Response data is always correctly typed and structured
- The API is 100% compatible with OpenAI's Chat Completions format

```python
class ChatCompletionRequest(BaseModel):
    model: str
    messages: list[ChatMessage]           # list of {role, content} objects
    max_tokens: int | None = None
    temperature: float = 1.0             # 0.0 = deterministic, 2.0 = very random
    top_p: float = 1.0
    stream: bool = False                  # true = SSE streaming response
    stop: list[str] | str | None = None   # stop sequences

class ChatCompletionResponse(BaseModel):
    id: str = Field(default_factory=...)  # auto-generated unique ID
    object: Literal["chat.completion"] = "chat.completion"
    created: int = Field(...)             # Unix timestamp
    model: str
    choices: list[Choice]                 # the actual AI-generated content
    usage: Usage                          # token counts for billing/monitoring
```

#### 1d. Chat Completions Router (`routers/chat.py`)

This is the main endpoint — every inference request goes through here.

```
POST /v1/chat/completions
  │
  ├── Non-streaming (stream: false)
  │     │
  │     ├── Check cache → HIT → return cached ChatCompletionResponse (< 50ms)
  │     │
  │     └── MISS → engine.generate() → build response → store in cache → return
  │
  └── Streaming (stream: true)
        │
        └── return StreamingResponse(async_generator)
              │
              ├── yield: opening role delta ("role": "assistant")
              ├── yield: token chunk ("content": "The") ← TTFT measured here
              ├── yield: token chunk ("content": " sky")
              ├── yield: ...
              ├── yield: stop chunk ("finish_reason": "stop")
              └── yield: "data: [DONE]\n\n"
```

The streaming path uses Python async generators — tokens are yielded to the client as they arrive from the engine, character by character, with no buffering. This is what creates the "typing" effect seen in ChatGPT.

**Metrics are recorded in a `finally` block** so they always update even if the request fails mid-stream.

#### 1e. Authentication Middleware (`middleware/auth.py`)

```python
def verify_api_key(credentials, settings) -> str:
    if credentials is None:
        raise 401  # Missing Authorization header

    # ⚠️ IMPORTANT: secrets.compare_digest prevents timing attacks
    # A naive == comparison leaks information about how many characters match
    # because it returns faster for completely wrong keys than for "almost right" keys
    if not secrets.compare_digest(credentials.credentials, settings.api_key):
        raise 401  # Wrong key

    return credentials.credentials  # Returns key for downstream logging
```

**Why `secrets.compare_digest()`?** A regular string comparison (`a == b`) short-circuits — it returns `False` as soon as it finds the first mismatching character. This means an attacker can measure response times to determine how many characters of their guess are correct. `compare_digest` always takes the same amount of time regardless of where the strings differ, making this attack impossible.

#### 1f. Rate Limiter (`middleware/rate_limit.py`)

Implements a **sliding window rate limiter** using Redis sorted sets (ZSETs):

```
Redis key: "rate_limit:<first 16 chars of api_key>"

ZSET structure: { "1716811234.567": 1716811234.567,  ← score = timestamp
                  "1716811235.892": 1716811235.892,
                  "1716811298.001": 1716811298.001, ... }

Algorithm:
  1. Remove all entries with score < (now - 60 seconds)  [ZREMRANGEBYSCORE]
  2. Count remaining entries                              [ZCARD]
  3. Add current timestamp                               [ZADD]
  4. Set key expiry to 60 seconds                        [EXPIRE]

  If count (before add) >= RATE_LIMIT_RPM → return 429 with Retry-After header
```

This approach is more accurate than a fixed window because there's no "burst at window boundary" problem — it truly limits to N requests in any 60-second window.

#### 1g. Inference Engine Client (`services/engine.py`)

The engine client is a thin HTTP wrapper around the llama.cpp server. Before sending a request, it formats the conversation using the **Mistral chat template**:

```
Input messages:
  [{"role": "system", "content": "You are helpful."},
   {"role": "user", "content": "Hello!"}]

Output prompt (Mistral format):
  <s>[INST] You are helpful.

  Hello! [/INST]

Why this matters:
  Mistral 7B Instruct was trained to follow this exact format.
  If you send raw text without these tokens, the model produces
  low-quality or confused responses.
```

For streaming, it connects to llama.cpp's SSE endpoint and parses `data: {...}` lines as they arrive:

```python
async with client.stream("POST", ".../completion", json=payload) as response:
    async for line in response.aiter_lines():
        if not line.startswith("data: "):
            continue
        chunk = json.loads(line[6:])
        if chunk.get("content"):
            yield chunk["content"]    # ← each yielded token is forwarded to the client
        if chunk.get("stop"):
            break
```

#### 1h. Semantic Cache (`services/cache.py`)

This is one of the most sophisticated components. Instead of exact string matching, it uses **semantic similarity** — two questions that mean the same thing return the same cached answer.

```
How it works:

  "What is the capital of France?"  ─── embed ──► [0.12, -0.34, 0.89, ...]  (384 numbers)
  "What's France's capital city?"   ─── embed ──► [0.11, -0.35, 0.88, ...]  (384 numbers)

  Cosine similarity between these two vectors: 0.98  ✓  (>= threshold 0.95 → CACHE HIT)

  "How do I make pasta?"            ─── embed ──► [-0.67, 0.23, -0.12, ...] (384 numbers)

  Cosine similarity with France question: 0.12  ✗  (< 0.95 → CACHE MISS, run inference)

Storage in Redis:
  cache:emb:1716811234567  →  [binary blob of 384 float32 values]
  cache:resp:1716811234567 →  {full JSON response}  (TTL: 3600 seconds)
  cache:index              →  [1716811234567, 1716811289012, ...]  (ordered list)

Eviction:
  If index length > 1000 entries → remove the oldest entry (FIFO)
```

**The embedding model** (`all-MiniLM-L6-v2`) is a 22 MB neural network that converts text into a 384-dimensional vector where similar meanings are geometrically close together. It runs on CPU in ~80ms — negligible compared to AI inference which takes seconds.

---

### 2. The Inference Engine (`llama-cpp-server/`)

The llama.cpp server is built from source in Docker during the first `docker compose up`:

```dockerfile
FROM ubuntu:22.04

# Install build dependencies
RUN apt-get install -y cmake build-essential libcurl4-openssl-dev

# Clone and compile llama.cpp
RUN git clone https://github.com/ggerganov/llama.cpp
RUN cmake -B build -DLLAMA_BUILD_SERVER=ON
RUN cmake --build build --config Release -j$(nproc)

# At runtime, the model file is passed via environment variable
CMD llama-server -m $MODEL_FILE --port $PORT --ctx-size $CTX_SIZE --threads $THREADS
```

The resulting container:
- Listens on `:8001` (internal Docker network only — never exposed to the host)
- Accepts OpenAI-style `/completion` requests
- Supports both full and streaming responses via SSE
- Responds to `/health` for Docker health checks

**Why llama.cpp?** See [ADR-004](#adr-004-llamacpp-for-mvp-over-vllm).

---

### 3. Metrics (`gateway/metrics.py`)

Nine Prometheus metrics are defined and updated throughout the request lifecycle:

| Metric Name | Type | Labels | What It Measures |
|------------|------|--------|-----------------|
| `llm_ttft_seconds` | Histogram | `model` | Time from request start to first token (measures responsiveness) |
| `llm_tokens_generated_total` | Counter | `model` | Total tokens produced since startup |
| `llm_requests_total` | Counter | `model`, `status_code` | All requests, tagged with success/error |
| `llm_request_duration_seconds` | Histogram | `endpoint` | Full round-trip time per request |
| `llm_tokens_per_second` | Gauge | `model` | Current throughput (updated after each request) |
| `llm_errors_total` | Counter | `error_type` | Errors by class name (for debugging) |
| `llm_cache_hits_total` | Counter | `model` | How often the cache saved an inference call |
| `llm_cache_misses_total` | Counter | `model` | How often the cache was bypassed |
| `llm_cache_lookup_seconds` | Histogram | _(none)_ | Time spent computing cosine similarity |

**Histogram buckets** are tuned for LLM workloads:
- TTFT: `[0.1, 0.3, 0.5, 1.0, 2.0, 5.0, 10.0]` seconds
- Request duration: `[0.1, 0.5, 1.0, 2.0, 5.0, 10.0, 30.0, 60.0]` seconds

---

### 4. Docker Compose Orchestration

Five services are defined in `docker-compose.yml`:

<details>
<summary><b>Show full service dependency and port map</b></summary>

```
Host machine ports exposed:
  :8000 → gateway     (public API)
  :3000 → grafana     (dashboards)
  :9090 → prometheus  (metrics UI — optional, typically internal)

Internal Docker network (inference-net) — NOT reachable from outside:
  :8001 → llama-cpp   (inference engine)
  :6379 → redis       (cache + rate limit)

Startup order:
  redis        → starts first (no dependencies)
  llama-cpp    → starts after redis (independent, but loads model for ~30s)
  gateway      → starts ONLY when llama-cpp is HEALTHY (model loaded)
  prometheus   → starts after gateway is available
  grafana      → starts after prometheus

Health checks:
  gateway:    curl http://localhost:8000/health     every 15s
  llama-cpp:  curl http://localhost:8001/health     every 10s (30 retries = 5 min timeout)
  redis:      redis-cli ping                        every 10s
```
</details>

**Security note:** Only ports 8000 and 3000 are published to the host. The inference engine and Redis are completely isolated on the internal Docker network — they cannot be accessed from outside the container environment.

---

## API Reference

### Authentication

All endpoints (except `/health` and `/metrics`) require a Bearer token:

```http
Authorization: Bearer your-api-key-here
```

Missing or invalid tokens return:
```json
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer

{"error": {"message": "Invalid API key", "type": "auth_error"}}
```

---

### `POST /v1/chat/completions`

The main inference endpoint. 100% compatible with OpenAI's Chat Completions API.

**Request body:**

```json
{
  "model": "mistral-7b",
  "messages": [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user",   "content": "Hello!"},
    {"role": "assistant", "content": "Hi there! How can I help you today?"},
    {"role": "user",   "content": "What is the capital of France?"}
  ],
  "max_tokens": 512,
  "temperature": 0.7,
  "top_p": 1.0,
  "stream": false,
  "stop": ["\n\n", "Human:"],
  "presence_penalty": 0.0,
  "frequency_penalty": 0.0
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `model` | string | required | Model identifier (use `"mistral-7b"`) |
| `messages` | array | required | Conversation history. Roles: `system`, `user`, `assistant` |
| `max_tokens` | int | 512 | Maximum tokens to generate |
| `temperature` | float | 1.0 | Randomness. `0.0` = deterministic, `2.0` = very random. `0.7` recommended |
| `top_p` | float | 1.0 | Nucleus sampling. `0.9` means consider only top 90% probability tokens |
| `stream` | bool | false | Enable Server-Sent Events streaming |
| `stop` | string or array | null | Stop generation when these strings are encountered |
| `presence_penalty` | float | 0.0 | Penalize new tokens that already appear in the text (range: -2 to 2) |
| `frequency_penalty` | float | 0.0 | Penalize tokens based on how often they've appeared (range: -2 to 2) |

**Non-streaming response:**

```json
{
  "id": "chatcmpl-a3f92b1e",
  "object": "chat.completion",
  "created": 1716811234,
  "model": "mistral-7b",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "The capital of France is Paris."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 28,
    "completion_tokens": 8,
    "total_tokens": 36
  }
}
```

**Streaming response (`stream: true`):**

```
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache

data: {"id":"chatcmpl-a3f92b1e","object":"chat.completion.chunk","model":"mistral-7b","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}

data: {"id":"chatcmpl-a3f92b1e","object":"chat.completion.chunk","model":"mistral-7b","choices":[{"index":0,"delta":{"content":"The"},"finish_reason":null}]}

data: {"id":"chatcmpl-a3f92b1e","object":"chat.completion.chunk","model":"mistral-7b","choices":[{"index":0,"delta":{"content":" capital"},"finish_reason":null}]}

data: {"id":"chatcmpl-a3f92b1e","object":"chat.completion.chunk","model":"mistral-7b","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

---

### `GET /v1/models`

Returns the list of loaded models. Requires authentication.

```bash
curl http://localhost:8000/v1/models \
  -H "Authorization: Bearer your-key"
```

```json
{
  "object": "list",
  "data": [
    {
      "id": "mistral-7b",
      "object": "model",
      "created": 1716811234,
      "owned_by": "local",
      "context_length": 4096,
      "quantization": "Q4_K_M"
    }
  ]
}
```

---

### `GET /health`

Liveness check. No authentication required. Returns engine status.

```bash
curl http://localhost:8000/health
```

```json
{"status": "ok", "engine": "llamacpp", "model_loaded": true}
```

| `status` value | Meaning |
|----------------|---------|
| `"ok"` | All systems operational |
| `"degraded"` | Engine unreachable but gateway is still running |

---

### `GET /metrics`

Prometheus scrape endpoint. Returns metrics in Prometheus text format. No authentication required (intended for internal scraping only).

```bash
curl http://localhost:8000/metrics
```

```
# HELP llm_ttft_seconds Time to first token in seconds
# TYPE llm_ttft_seconds histogram
llm_ttft_seconds_bucket{le="0.1",model="mistral-7b"} 0.0
llm_ttft_seconds_bucket{le="0.3",model="mistral-7b"} 2.0
...
llm_tokens_generated_total{model="mistral-7b"} 1247.0
llm_requests_total{model="mistral-7b",status_code="200"} 42.0
```

---

### `POST /v1/cache/clear`

Clears all entries from the semantic cache. Requires the admin API key.

```bash
curl -X POST http://localhost:8000/v1/cache/clear \
  -H "Authorization: Bearer your-admin-key"
```

```json
{"cleared": 47, "message": "Cache cleared successfully"}
```

---

### Error Reference

All errors follow the OpenAI error schema for drop-in compatibility:

```json
{"error": {"message": "Human-readable description", "type": "machine_readable_type"}}
```

| HTTP Code | `type` | Cause | What to do |
|-----------|--------|-------|-----------|
| `401` | `auth_error` | Missing, invalid, or wrong-scheme Authorization header | Check your API key and use `Bearer` scheme |
| `422` | `validation_error` | Request body fails schema validation | Check the request body against the API schema |
| `429` | `rate_limit_error` | Exceeded `RATE_LIMIT_RPM` requests in 60 seconds | Wait for `Retry-After` seconds before retrying |
| `500` | `inference_error` | Unexpected error during token generation | Check gateway logs: `docker compose logs gateway` |
| `502` | `engine_error` | llama.cpp server is unreachable | Check engine: `docker compose logs llama-cpp` |

---

## Configuration

All configuration is via environment variables. Copy `.env.example` to `.env` and edit:

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `API_KEY` | Secret key clients must send as Bearer token | `python -c "import secrets; print(secrets.token_urlsafe(32))"` |
| `MODEL_PATH` | Absolute path on the **host** machine to the directory containing your GGUF file | `/home/user/models` or `C:\Users\user\models` |

### Model Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MODEL_FILE` | `mistral-7b-instruct-v0.2.Q4_K_M.gguf` | GGUF filename (must be inside `MODEL_PATH`) |
| `MODEL_NAME` | `mistral-7b` | Model ID returned by `/v1/models` and used in request `model` field |
| `CONTEXT_LENGTH` | `4096` | Maximum context window in tokens. Reduce to `2048` if running out of RAM |
| `MAX_TOKENS_DEFAULT` | `512` | Default `max_tokens` when the client doesn't specify |
| `N_GPU_LAYERS` | `0` | Number of transformer layers to offload to GPU. `0` = CPU only. Set to `99` to use GPU fully |
| `THREADS` | `8` | CPU threads for llama.cpp. Set to your CPU's physical core count |

### Rate Limiting & Caching

| Variable | Default | Description |
|----------|---------|-------------|
| `RATE_LIMIT_RPM` | `60` | Max requests per minute per API key. Set to `0` to disable |
| `CACHE_TTL_SECONDS` | `3600` | How long cached responses live (1 hour) |
| `CACHE_SIMILARITY_THRESHOLD` | `0.95` | Cosine similarity score required for a cache hit. Range: `0.0`–`1.0`. Lower = more aggressive caching, higher = more selective |
| `ADMIN_API_KEY` | _(same as API_KEY)_ | Separate key for admin endpoints like `/v1/cache/clear`. Falls back to `API_KEY` if unset |

### Observability

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `INFO` | Log verbosity: `DEBUG`, `INFO`, `WARNING`, `ERROR` |
| `GRAFANA_PASSWORD` | `admin` | Grafana admin password |
| `ALERT_WEBHOOK_URL` | _(empty)_ | Webhook URL for alerts. Leave empty to disable |

---

## Testing

### Running the Test Suite

```bash
cd gateway
pip install uv
uv pip install -e ".[dev]"

cd ..
pytest tests/ -v
```

Expected output:
```
tests/test_auth.py::test_missing_auth_header_returns_401     PASSED
tests/test_auth.py::test_invalid_api_key_returns_401         PASSED
tests/test_auth.py::test_invalid_scheme_returns_401          PASSED
tests/test_auth.py::test_health_requires_no_auth             PASSED
tests/test_auth.py::test_metrics_requires_no_auth            PASSED
tests/test_chat.py::test_chat_completion_returns_401_with_invalid_key   PASSED
tests/test_chat.py::test_chat_completion_returns_401_with_no_auth_header PASSED
tests/test_chat.py::test_chat_completion_returns_200_with_valid_key      PASSED
tests/test_chat.py::test_streaming_returns_sse_content_type              PASSED
tests/test_chat.py::test_streaming_yields_multiple_chunks                PASSED
tests/test_chat.py::test_health_endpoint                                 PASSED
tests/test_chat.py::test_models_endpoint_requires_auth                   PASSED
tests/test_chat.py::test_models_endpoint_returns_model_list              PASSED

============================= 13 passed in 0.17s ==============================
```

### How the Tests Work

Tests use FastAPI's `ASGITransport` to call the full application stack in-process — no actual network calls, no Docker required. The app state is seeded manually in `conftest.py` because the lifespan context doesn't run in test mode:

```python
@pytest.fixture
async def client():
    # Manually set what the lifespan would normally set
    mock_engine = MagicMock()
    mock_engine.generate = AsyncMock(return_value={
        "content": "", "tokens_evaluated": 0, "tokens_predicted": 0
    })

    app.state.engine_client = mock_engine
    app.state.redis_client = None   # disable rate limiting
    app.state.cache = None          # disable caching

    async with AsyncClient(transport=ASGITransport(app=app), ...) as ac:
        yield ac
```

Individual tests can override the mock per-test:

```python
async def test_chat_completion_returns_200_with_valid_key(client):
    # Override the default mock to return specific content
    app.state.engine_client.generate = AsyncMock(return_value={
        "content": "Hello there, how are you?",
        "tokens_evaluated": 10,
        "tokens_predicted": 6,
    })

    response = await client.post("/v1/chat/completions", json=..., headers=AUTH)
    assert response.status_code == 200
    assert response.json()["choices"][0]["message"]["content"] == "Hello there, how are you?"
```

### Test Coverage

| Area | Tests | Coverage |
|------|-------|---------|
| Auth (missing key) | `test_missing_auth_header_returns_401` | ✅ |
| Auth (wrong key) | `test_invalid_api_key_returns_401` | ✅ |
| Auth (wrong scheme) | `test_invalid_scheme_returns_401` | ✅ |
| Health endpoint (no auth) | `test_health_requires_no_auth` | ✅ |
| Metrics endpoint (no auth) | `test_metrics_requires_no_auth` | ✅ |
| Chat completions (auth rejection) | `test_chat_completion_returns_401_*` | ✅ |
| Chat completions (success) | `test_chat_completion_returns_200_with_valid_key` | ✅ |
| Response schema validation | Part of `test_chat_completion_returns_200_*` | ✅ |
| Streaming content-type | `test_streaming_returns_sse_content_type` | ✅ |
| Streaming chunk format | `test_streaming_yields_multiple_chunks` | ✅ |
| Streaming [DONE] sentinel | `test_streaming_yields_multiple_chunks` | ✅ |
| Models list | `test_models_endpoint_returns_model_list` | ✅ |
| Models auth | `test_models_endpoint_requires_auth` | ✅ |

---

## Observability

### Grafana Dashboard

The 6-panel dashboard auto-provisions when Grafana starts. Access at **http://localhost:3000** (admin/admin):

| Panel | Metric | Description |
|-------|--------|-------------|
| **Request Rate** | `rate(llm_requests_total[1m])` | Requests per second, live |
| **TTFT (p50/p95/p99)** | `histogram_quantile(0.95, llm_ttft_seconds_bucket)` | Latency percentiles |
| **Tokens/sec** | `llm_tokens_per_second` | Current throughput gauge |
| **Cache Hit Rate** | `cache_hits / (cache_hits + cache_misses)` | % of requests served from cache |
| **Error Rate** | `rate(llm_errors_total[5m])` | Errors per second |
| **Request Duration** | `histogram_quantile(0.99, llm_request_duration_seconds_bucket)` | p99 end-to-end latency |

### Prometheus Queries (for custom dashboards)

```promql
# Requests per second
rate(llm_requests_total[1m])

# p95 time to first token
histogram_quantile(0.95, rate(llm_ttft_seconds_bucket[5m]))

# Cache hit rate percentage
100 * rate(llm_cache_hits_total[5m])
    / (rate(llm_cache_hits_total[5m]) + rate(llm_cache_misses_total[5m]))

# Average tokens per second over last 5 minutes
avg_over_time(llm_tokens_per_second[5m])

# Error rate by type
rate(llm_errors_total[5m])
```

---

## Benchmarking

Run the built-in benchmark suite against a live stack:

```bash
# Make sure docker compose is running first
python benchmarks/run_benchmark.py \
  --base-url http://localhost:8000 \
  --api-key your-key-here
```

**Three test suites:**

| Suite | What It Does | Measures |
|-------|-------------|----------|
| **Sequential Latency** | 50 requests one at a time, 10 rotating questions | p50/p95/p99 TTFT |
| **Concurrent Throughput** | 20 parallel requests simultaneously | total tokens/second |
| **Cache Effectiveness** | 50 requests with 30% duplicates, pre-warmed cache | cache hit vs miss latency, speedup factor |

Results are written to `benchmarks/results.md`.

**Expected numbers on consumer hardware (Intel Core i7, 16 GB RAM, CPU-only):**

| Metric | Expected Range |
|--------|---------------|
| p50 TTFT | 300–800ms |
| p95 TTFT | 800ms–2s |
| Tokens/sec (sequential) | 10–20 |
| Cache hit latency | 30–80ms |
| Cache miss latency | 1–4s |
| Cache speedup | 20–60× |

---

## Development Setup

### Local Development (without Docker)

```bash
# 1. Install Python 3.11 and uv
pip install uv

# 2. Install all dependencies including dev tools
cd gateway
uv pip install -e ".[dev]"

# 3. Start Redis separately (Docker is easiest)
docker run -d -p 6379:6379 redis:7-alpine

# 4. Start llama.cpp server (must be compiled — see llama-cpp-server/Dockerfile)
./llama.cpp/build/bin/llama-server \
  -m ~/models/mistral-7b-instruct-v0.2.Q4_K_M.gguf \
  --port 8001 -c 4096 -t 8

# 5. Start the gateway
cd ..
API_KEY=dev-key \
ENGINE_HOST=localhost \
REDIS_HOST=localhost \
uv run uvicorn gateway.main:app --reload --port 8000
```

### Linting and Formatting

```bash
# Check for style issues
uv run ruff check gateway/ tests/

# Auto-fix import sorting and simple issues
uv run ruff check --fix gateway/ tests/

# Format code
uv run black gateway/ tests/

# Run all checks (same as CI)
uv run ruff check gateway/ tests/ && uv run black --check gateway/ tests/
```

### Adding a New Endpoint

1. Create a new file in `gateway/routers/` (e.g., `embeddings.py`)
2. Define an `APIRouter` with `Depends(verify_api_key)` if auth is required
3. Register it in `gateway/main.py`:  
   `app.include_router(embeddings.router, prefix="/v1")`
4. Add Pydantic request/response schemas to `gateway/schemas.py`
5. Write tests in `tests/test_embeddings.py`

### Changing the AI Model

To use a different GGUF model:

1. Download the GGUF file to your `MODEL_PATH` directory
2. Edit `.env`:
   ```
   MODEL_FILE=your-new-model.gguf
   MODEL_NAME=your-model-name
   ```
3. Restart the stack: `docker compose restart llama-cpp gateway`

**Important:** The Mistral chat template is hardcoded in `gateway/services/engine.py`. Other models (Llama 3, Phi-3, Gemma) use different templates. Edit `_format_mistral_prompt()` if you switch models.

---

## Architecture Decision Records

All significant design choices are documented in `docs/adr/`. Here is a summary:

### ADR-001: Volume Mount for Model Distribution

**Decision:** Mount the model file from the host instead of embedding it in the Docker image.

**The Trade-off:**

| Option | Pro | Con |
|--------|-----|-----|
| **Volume mount** (chosen) | Image is only ~2GB; model swaps are instant; fast CI | User must download model manually before first run |
| Bake into image | Zero-setup for the user | 4+ GB image; every code change triggers a 4GB re-download |

**Why:** A 4 GB model embedded in a Docker image would make every code change require re-downloading and re-pushing gigabytes of data. With a volume mount, you rebuild only the ~2 GB code image and the model stays untouched.

📄 [Full ADR](docs/adr/ADR-001-volume-mount-for-models.md)

---

### ADR-002: FastAPI over Flask

**Decision:** Use FastAPI + uvicorn (async ASGI) instead of Flask (sync WSGI).

**The Trade-off:**

| | FastAPI (chosen) | Flask |
|-|---------|-------|
| Streaming SSE | Native async generators | Requires threads or gevent |
| Concurrency | Async event loop handles many connections | Blocked by one request per worker thread |
| Request validation | Pydantic v2 built-in | Manual or third-party |
| OpenAPI docs | Auto-generated at `/docs` | Manual |

**Why:** Server-Sent Events streaming is a first-class requirement — the AI model generates tokens one at a time and they must reach the client immediately. Flask's synchronous model would require a thread per connection, which doesn't scale. FastAPI's async generators yield tokens directly to the HTTP response with zero buffering.

📄 [Full ADR](docs/adr/ADR-002-fastapi-over-flask.md)

---

### ADR-003: Semantic Cache with Sentence Embeddings

**Decision:** Cache responses using vector similarity (cosine ≥ 0.95) instead of exact string matching.

**The Key Insight:** Real-world users ask the same question in many different ways:
- `"What is the capital of France?"`
- `"What's France's capital?"`
- `"Tell me the capital city of France"`
- `"France capital?"`

Exact string matching treats all of these as different. Semantic caching recognizes they are the same question and serves a single cached answer — estimated **15–25% higher effective hit rate** than exact matching on real workloads.

**The Risk:** A false positive (similarity ≥ 0.95 but actually different meaning) would return a wrong answer. The 0.95 threshold is conservative — paraphrases typically score 0.97–0.99, while unrelated prompts score below 0.80.

📄 [Full ADR](docs/adr/ADR-003-semantic-cache-design.md)

---

### ADR-004: llama.cpp for MVP over vLLM

**Decision:** Use llama.cpp (CPU, GGUF INT4) as the inference backend, with vLLM (GPU) as a Phase 2 upgrade.

**The Trade-off:**

| | llama.cpp (chosen for MVP) | vLLM (Phase 2) |
|-|--------|------|
| Hardware needed | Any laptop with 8 GB RAM | NVIDIA GPU (A10G or better) |
| Throughput | 10–15 tokens/sec (CPU) | 100–200+ tokens/sec (GPU) |
| Setup complexity | `docker compose up` | Requires GPU drivers, CUDA |
| Model format | GGUF (quantized) | SafeTensors (full precision or GPTQ) |
| Upgrade path | Change one env var | Change one env var |

**Why:** The MVP target is demoing on a developer laptop without specialized hardware. The adapter pattern means upgrading to vLLM in Phase 2 only requires changing `INFERENCE_BACKEND=vllm` in `.env` — no gateway code changes needed.

📄 [Full ADR](docs/adr/ADR-004-llama-cpp-for-mvp.md)

---

## Roadmap

### Phase 2 (GPU Support + Scalability)

- [ ] **vLLM GPU backend** — set `INFERENCE_BACKEND=vllm` + `ENGINE_HOST=vllm-container`, no gateway code changes needed (adapter pattern)
- [ ] **`asyncio.Queue` request queue** — configurable depth, backpressure handling, `queue_depth` Prometheus metric (already defined in `metrics.py`)
- [ ] **Multi-model hot-swap** — serve multiple models, route by `model` field in request
- [ ] **HuggingFace Hub auto-download** — zero-config model acquisition with resume support (eliminates manual step 1 from quickstart)
- [ ] **Grafana alerts** — webhook notification when p99 TTFT > 3s

### Phase 3 (Advanced Features)

- [ ] **LoRA adapter loading** — fine-tuned model adapters without full model reloads
- [ ] **Multi-key API key management** — per-user keys with individual rate limits
- [ ] **Request priority queue** — premium users skip the queue
- [ ] **Structured output (JSON mode)** — guaranteed JSON schema-conformant responses
- [ ] **Function calling** — OpenAI-compatible tool/function calling support
- [ ] **Embeddings endpoint** — `POST /v1/embeddings` using the same sentence-transformer model

---

## FAQ

<details>
<summary><b>Can I use models other than Mistral 7B?</b></summary>

Yes — any GGUF-format model that llama.cpp supports. Popular alternatives:
- `Llama-3.2-3B-Instruct.Q4_K_M.gguf` — faster, less accurate, only 2 GB RAM
- `Llama-3.1-8B-Instruct.Q4_K_M.gguf` — similar quality to Mistral, 5 GB RAM
- `Phi-3.5-mini-instruct.Q4_K_M.gguf` — Microsoft's compact model, 2.5 GB RAM

Download from [HuggingFace TheBloke](https://huggingface.co/TheBloke) or [Bartowski's collection](https://huggingface.co/bartowski). After downloading, update `MODEL_FILE` and `MODEL_NAME` in `.env`.

**Note:** Each model uses a different chat template. You will need to update `_format_mistral_prompt()` in `gateway/services/engine.py` to match your model's template.
</details>

<details>
<summary><b>Can I use a GPU?</b></summary>

Yes. Set `N_GPU_LAYERS=99` in your `.env` to offload all layers to GPU. This requires:
1. NVIDIA GPU with 8+ GB VRAM
2. NVIDIA drivers installed on the host
3. The `llama-cpp-server/Dockerfile` to be rebuilt with CUDA support (uncomment the CUDA build flags)
4. Docker with NVIDIA Container Toolkit

vLLM support (for maximum GPU performance) is planned for Phase 2 and will not require Dockerfile changes.
</details>

<details>
<summary><b>Why is the first request slow?</b></summary>

Three reasons:
1. **Model loading** — llama.cpp reads the 4.1 GB model from disk into RAM on first startup (~30 seconds). Subsequent requests don't reload the model.
2. **Cold sentence-transformer** — the first cache lookup computes an embedding (80ms) and finds no cached entries. Subsequent similar requests get cache hits.
3. **CPU warmup** — the first inference call is sometimes slower due to CPU cache warmup.

After warmup, expect consistent latency.
</details>

<details>
<summary><b>What happens if Redis goes down?</b></summary>

The gateway handles Redis unavailability gracefully:
- **Caching is disabled** — all requests go directly to the inference engine
- **Rate limiting is disabled** — requests are not rate-checked
- **Inference still works** — the gateway continues serving AI requests normally

When Redis comes back, reconnection is automatic on the next container restart.
</details>

<details>
<summary><b>How do I scale this horizontally?</b></summary>

The current MVP runs as a single-node stack. For horizontal scaling:
1. **Multiple gateway replicas** — the gateway is stateless (all state is in Redis); run N replicas behind a load balancer
2. **Shared Redis** — all replicas point to the same Redis instance (cache and rate limits are consistent across replicas)
3. **Shared model volume** — all llama.cpp containers mount the same model directory read-only
4. Phase 2's async request queue will support multiple engine replicas with a dispatcher
</details>

<details>
<summary><b>Is this HIPAA/GDPR compliant?</b></summary>

**Technically:** This server processes all data locally — no external API calls, no telemetry, no data transmission. The data never leaves the machine it runs on.

**Legally:** HIPAA/GDPR compliance depends on your broader infrastructure (how the server itself is deployed, who has access, audit logging, encryption at rest, etc.) — not just the software. Consult your compliance team before deploying this in a regulated environment.
</details>

<details>
<summary><b>Can I use the OpenAI JavaScript/TypeScript SDK?</b></summary>

Yes:
```typescript
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://localhost:8000/v1",
  apiKey: "your-local-key",
});
```

Any library that supports a custom `base_url` and follows the OpenAI API schema will work.
</details>

<details>
<summary><b>How is this different from Ollama or LM Studio?</b></summary>

| | This project | Ollama | LM Studio |
|-|-------------|--------|-----------|
| OpenAI API compatibility | Full | Partial | Partial |
| Semantic caching | Yes | No | No |
| Rate limiting | Yes | No | No |
| Prometheus metrics | Yes | No | No |
| Grafana dashboards | Yes | No | No |
| Docker Compose | Yes | No | No |
| Authentication | Yes | No | Optional |
| Target use case | Production server | Local dev | Local dev |

Ollama and LM Studio are excellent for personal local use. This project is designed as a **production-ready server** — something you'd deploy for a team or in a private cloud, not just on your own laptop.
</details>

---

## Glossary

**ASGI (Asynchronous Server Gateway Interface)** — The Python web server standard that allows truly async request handling. FastAPI and uvicorn use ASGI. The older standard (WSGI) was synchronous — one request blocked until it completed.

**Bearer Token** — An HTTP authentication scheme where the client sends a secret key in the `Authorization` header: `Authorization: Bearer <key>`. "Bearer" means whoever holds (bears) the token is allowed in.

**Cosine Similarity** — A measure of how similar two vectors are, ranging from -1 (opposite) to 1 (identical). When comparing sentence embeddings, a score of 0.95 means "these two sentences mean the same thing," while 0.2 means "these sentences are unrelated."

**Docker Compose** — A tool for defining and running multi-container Docker applications using a single YAML file (`docker-compose.yml`). `docker compose up` starts all five services in this project.

**Embedding** — A high-dimensional vector (list of numbers) that represents the meaning of a piece of text. The `all-MiniLM-L6-v2` model converts any text into 384 numbers. Similar meanings produce vectors that are geometrically close together.

**Grafana** — An open-source dashboard and visualization tool. Connects to Prometheus and displays metrics as real-time charts and graphs.

**GGUF** — "GPT-Generated Unified Format" — a file format used by llama.cpp to store quantized AI models. Replaces the older GGML format. Files end in `.gguf`.

**HTTP 429 Too Many Requests** — The HTTP status code returned when a client exceeds the rate limit. The response includes a `Retry-After` header indicating how many seconds to wait.

**INT4 Quantization** — A compression technique that stores model weights as 4-bit integers instead of 32-bit floats, reducing model size by ~8x with minimal quality loss. "Q4_K_M" in the model filename refers to a specific 4-bit quantization method.

**JSON Schema** — A standard for describing the structure of JSON data. Pydantic uses JSON Schema internally to validate request and response bodies.

**lifespan** — FastAPI's mechanism for running code once at startup and once at shutdown (as opposed to on every request). Used here to initialize the engine client, Redis connection, and embedding model.

**llama.cpp** — An open-source C++ library and server for running quantized LLMs on CPU (and GPU). Developed by Georgi Gerganov. Supports hundreds of model architectures including Mistral, Llama, Phi, and Gemma.

**Mistral 7B Instruct** — A 7-billion-parameter open-source language model developed by Mistral AI, fine-tuned to follow instructions. The "7B" refers to the number of parameters; "Instruct" means it's tuned for chat/Q&A tasks.

**Pydantic** — A Python library for data validation using type annotations. Version 2 is used here for all request/response schemas. Invalid data is rejected automatically with descriptive error messages.

**Prometheus** — An open-source monitoring system that collects time-series metrics. It "scrapes" (polls) the `/metrics` endpoint on a schedule and stores the values for querying.

**Rate Limiting** — Restricting how many requests a client can make in a time window. This project uses a "token bucket" algorithm implemented with Redis to allow 60 requests per minute per API key by default.

**Redis** — An open-source in-memory data store. Used here for two purposes: the semantic cache (storing embeddings and responses) and rate limiting state (storing request counts per API key).

**Semantic Cache** — A cache that stores AI responses indexed by the *meaning* of the question, not the exact text. Two questions that mean the same thing return the same cached answer.

**Server-Sent Events (SSE)** — A one-way HTTP streaming protocol where the server pushes data to the client over a long-lived connection. Used here to stream AI-generated tokens as they are produced (`Content-Type: text/event-stream`).

**Sliding Window Rate Limiter** — A rate limiting algorithm that counts requests in a rolling time window (e.g., the last 60 seconds), as opposed to a fixed window which resets at clock boundaries. More accurate and fair.

**structlog** — A Python logging library that produces structured JSON log lines instead of unstructured text, making logs easier to search and analyze.

**TTFT (Time to First Token)** — The latency between sending a request and receiving the first token of the response. For streaming responses, this is the most user-perceptible latency measure.

**Token Bucket** — A rate limiting algorithm that allows bursting up to a maximum rate, analogous to a bucket that fills at a constant rate but can be drained at burst speed.

**uvicorn** — A fast ASGI web server for Python. Runs the FastAPI application and handles HTTP connections. Named after "unicorn" (fast) + "uv" (libuv, the async I/O library).

**vLLM** — A high-throughput LLM inference library developed at UC Berkeley. Uses "PagedAttention" for efficient GPU memory management. Planned for Phase 2 as the GPU inference backend.

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Make your changes following the coding rules in `.claude/CLAUDE.md`
4. Run tests: `pytest tests/ -v`
5. Run linters: `ruff check . && black --check .`
6. Submit a pull request

**Coding rules:**
- No blocking I/O in request handlers (use `await` for all I/O)
- No bare `except` — always catch specific exceptions
- No `print()` — use `structlog`
- All config from environment variables via `get_settings()`
- All responses validated through Pydantic schemas

---

## License

MIT License — see [LICENSE](LICENSE) file for full text.

Free to use, modify, and distribute for any purpose including commercial use.

---

<div align="center">

**Built with Python 3.11 + FastAPI + llama.cpp + Redis + Prometheus + Grafana**

*Self-hosted AI — no data leaves your machine.*

</div>
