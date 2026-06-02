"""LLM plumbing for the content engine polish layer.

`client.py` exposes the LLMClient Protocol plus two implementations:
  - MockLLMClient (script-driven, used by tests)
  - AnthropicLLMClient (lazy import of `anthropic`, used in production)

`cache.py` exposes PolishCache — a disk-backed sha256-keyed cache so
identical (skeleton + brief + angle + model + temperature + seed)
re-runs skip the LLM call entirely.
"""
from __future__ import annotations
