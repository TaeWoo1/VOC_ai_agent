"""Observability — Prometheus metrics, OTel tracing scaffolding, dependency-aware health checks.

Extends the existing src/voc/logging.py JSON logger with bound context
(tenant/workspace/connection/run/job/channel/stage). Metrics exposed on a
separate admin port, not the public API. See plan (prior round) §9.

Empty in M0; metrics + health land in M2/M3.
"""
