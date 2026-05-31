# syntax=docker/dockerfile:1
FROM ubuntu:22.04

# Prevent interactive prompts during apt installs
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    git \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /llama.cpp

# Pin to a specific commit for reproducibility
# Commit: b3878 — supports Llama 3.2, Phi-3.5, Mistral
ARG LLAMA_CPP_COMMIT=b3878
RUN git clone https://github.com/ggerganov/llama.cpp . && \
    git checkout ${LLAMA_CPP_COMMIT} 2>/dev/null || \
    git checkout main

# Build the server binary (CPU only for MVP)
RUN cmake -B build \
    -DLLAMA_BUILD_SERVER=ON \
    -DCMAKE_BUILD_TYPE=Release \
    && cmake --build build --config Release -j$(nproc) --target llama-server

EXPOSE 8001

# Health check using the built-in /health endpoint
HEALTHCHECK --interval=10s --timeout=5s --retries=30 --start-period=60s \
    CMD curl -f http://localhost:8001/health || exit 1

# Default env vars — all overridable in docker-compose
ENV MODEL_FILE=/models/mistral-7b-instruct-v0.2.Q4_K_M.gguf
ENV CTX_SIZE=4096
ENV THREADS=8
ENV N_GPU_LAYERS=0
ENV HOST=0.0.0.0
ENV PORT=8001

ENTRYPOINT ["/bin/sh", "-c", \
    "/llama.cpp/build/bin/llama-server \
    --model ${MODEL_FILE} \
    --ctx-size ${CTX_SIZE} \
    --threads ${THREADS} \
    --n-gpu-layers ${N_GPU_LAYERS} \
    --host ${HOST} \
    --port ${PORT}"]
