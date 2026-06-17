"""Discord outreach operator bot — v0.1 (CLI-first, read-only).

A thin operator surface over the outreach_packet workflow. It READS the
per-packet status.json / send_log.md files and produces operator-facing
summaries and the next Claude prompt. It never sends email, never runs
collection, never writes to target packet files, and never commits.

See README.md for scope and the explicit non-goals.
"""

__version__ = "0.1.0"
