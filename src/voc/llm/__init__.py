"""LLM — single chokepoint for all LLM calls with per-account budget enforcement.

All Analysis Worker code routes through llm/client.py. Per-account daily/monthly
token caps enforced via llm/budget.py. Ingest Worker, adapters, ingestion, and
policy MUST NOT import this package — enforced by import-linter. See plan §C.4.

Empty in M0; client + budget land in M4.
"""
