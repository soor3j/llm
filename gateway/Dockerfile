# syntax=docker/dockerfile:1

# ---- Stage 1: dependency builder ----
FROM python:3.11-slim AS builder

WORKDIR /build

# Install uv
RUN pip install --no-cache-dir uv

# Build context is repo root — pyproject.toml is in gateway/
COPY gateway/pyproject.toml .
RUN uv pip install --system --no-cache -r pyproject.toml 2>/dev/null || \
    uv pip install --system --no-cache \
        fastapi \
        "uvicorn[standard]" \
        httpx \
        "pydantic>=2.7" \
        "pydantic-settings>=2.3" \
        python-multipart \
        structlog \
        prometheus-client \
        redis \
        sentence-transformers \
        numpy \
        bcrypt

# Pre-download the sentence-transformers embedding model at BUILD time.
# Without this, the model has to be downloaded from HuggingFace Hub on every
# fresh container startup — which can hang for many minutes on slow networks.
# Baking it into the image makes the container start instantly and work offline.
ENV HF_HOME=/opt/hf-cache
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"

# ---- Stage 2: runtime ----
FROM python:3.11-slim AS runtime

# Non-root user (security requirement)
RUN addgroup --system appgroup && adduser --system --ingroup appgroup appuser

WORKDIR /app

# Copy installed packages from builder
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# Copy gateway package as a proper subdirectory so imports work:
# from gateway.config import ... → /app/gateway/config.py ✓
COPY gateway/ ./gateway/

# Copy the pre-downloaded embedding model from the builder stage so
# sentence-transformers loads it from disk instead of hitting HF Hub.
COPY --from=builder /opt/hf-cache /opt/hf-cache
RUN chmod -R a+rX /opt/hf-cache

ENV HF_HOME=/opt/hf-cache
ENV TRANSFORMERS_CACHE=/opt/hf-cache
ENV HOME=/tmp

USER appuser

EXPOSE 8000

CMD ["uvicorn", "gateway.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
