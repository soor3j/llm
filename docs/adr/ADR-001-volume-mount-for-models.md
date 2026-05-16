# ADR-001: Volume Mount for Model Distribution

**Status:** Accepted  
**Date:** 2026-05-15

## Context

The inference server must load a large quantized model file (~4 GB for Mistral 7B Q4_K_M) at startup.
There are two primary options for getting the model into the container:

1. **Volume mount** — operator downloads the model to their host machine and mounts the directory read-only into the container
2. **Baked into the image** — model is downloaded during `docker build` and embedded in the image layer

## Decision

Use volume mount (Option 1).

## Consequences

**Positive:**
- Docker image remains under 2 GB (base Ubuntu + llama.cpp binary only)
- Model swaps require only changing `MODEL_FILE` in `.env` — no image rebuild
- `docker pull` and `docker build` are fast during CI and demos
- Model file is not duplicated between image layers and disk

**Negative:**
- Operator must download the model manually before first run
- `MODEL_PATH` must be set correctly in `.env` — unclear error if forgotten
- Not zero-config for a first-time user

**Mitigation:**
The README Quickstart makes the download command explicit as step 1.
Phase 2 roadmap includes an optional `entrypoint.sh` that auto-downloads from Hugging Face Hub when `MODEL_FILE` is not found, giving operators a zero-config alternative.
