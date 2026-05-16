# syntax=docker/dockerfile:1

# ---- Stage 1: dependency builder ----
FROM python:3.11-slim AS builder

WORKDIR /build

# Install uv
RUN pip install --no-cache-dir uv

COPY pyproject.toml .
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

# ---- Stage 2: runtime ----
FROM python:3.11-slim AS runtime

# Non-root user (security requirement)
RUN addgroup --system appgroup && adduser --system --ingroup appgroup appuser

WORKDIR /app

# Copy installed packages from builder
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# Copy application source
COPY . .

USER appuser

EXPOSE 8000

CMD ["uvicorn", "gateway.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
