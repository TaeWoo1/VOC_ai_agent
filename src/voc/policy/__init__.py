"""Policy / compliance guard — single chokepoint for ToS, PII, and consent rules.

Every Ingest Worker batch passes through guard.check() before persistence. ToS
allowlist is declarative (allowlist.py); PII redaction is deterministic regex
(pii.py); owner-consent records are checked at connection-create time
(consent.py). Adapters MUST NOT bypass the guard. See plan §C.2 step 2.

Empty in M0; guard + pii + allowlist + consent land in M2.
"""
