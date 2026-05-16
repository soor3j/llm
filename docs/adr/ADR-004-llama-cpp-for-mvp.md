# ADR-004: llama.cpp for MVP Inference Backend

**Status:** Accepted  
**Date:** 2026-05-15

## Context

The server must run inference on the Mistral 7B model. Two primary options exist:

1. **vLLM** — high-throughput inference framework with PagedAttention; requires NVIDIA GPU
2. **llama.cpp** — C++ implementation supporting CPU + Apple Silicon + NVIDIA GPU via quantized GGUF models

## Decision

Use llama.cpp as the MVP inference backend, with vLLM as Phase 2 when GPU is available.

## Consequences

**Positive:**
- Runs on any laptop with 8 GB RAM — no GPU required for development, demo, or CI
- GGUF INT4 quantization (Q4_K_M) reduces Mistral 7B from 14 GB to 4.1 GB
- llama.cpp exposes an OpenAI-compatible HTTP server — the gateway's `LlamaCppClient` is a thin wrapper
- Swapping to vLLM in Phase 2 requires only changing `INFERENCE_BACKEND=vllm` and pointing `ENGINE_HOST` to the vLLM container — no gateway code changes (adapter pattern)

**Negative:**
- CPU inference throughput (~10–15 tokens/sec on a laptop) is lower than GPU inference (~100+ tokens/sec with vLLM)
- No continuous batching in CPU mode — concurrent requests queue sequentially through llama.cpp
- GGUF format only; HuggingFace safetensors models require conversion

**Mitigation:**
For the MVP target of 60 tokens/sec on 16 GB RAM, llama.cpp with `THREADS=8` meets the requirement
on modern consumer hardware. The vLLM upgrade path is documented in the Phase 2 roadmap and requires
only Docker Compose configuration changes.
