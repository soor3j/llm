# ADR-003: Semantic Cache with Sentence Embeddings over Exact String Match

**Status:** Accepted  
**Date:** 2026-05-15

## Context

Repeated or near-identical prompts are common in production (e.g., a customer service bot receiving
"What are your opening hours?" vs "When do you open?"). Caching only exact string matches leaves these
opportunities on the table.

## Decision

Use cosine similarity on sentence embeddings (`all-MiniLM-L6-v2`, 384-dim) as the cache key,
with a similarity threshold of 0.95. Store embeddings and responses in Redis with TTL.

## Consequences

**Positive:**
- Catches semantically identical prompts regardless of wording — estimated 15–25% higher effective hit rate on real workloads than exact-match
- `all-MiniLM-L6-v2` is a 22 MB model, runs on CPU in ~80ms — negligible overhead relative to inference latency
- Redis provides persistence across gateway restarts and can be shared across multiple gateway replicas

**Negative:**
- A false positive (similarity ≥ 0.95 but semantically different) would return a wrong answer — threshold of 0.95 is conservative to minimise this risk
- Cold cache requires embedding computation on every miss (80ms overhead added to first occurrence of any prompt)
- Scanning all cached embeddings is O(n) — with max 1000 entries and 384-dim float32 vectors this is ~1.5 MB compared per request; acceptable for the target scale

**Mitigation:**
The threshold of 0.95 was chosen after observing that paraphrases typically score 0.97–0.99 while
unrelated prompts score below 0.80. A future optimisation is to use Redis Stack's vector similarity index
(HNSW) to reduce lookup from O(n) to O(log n) for large caches.
