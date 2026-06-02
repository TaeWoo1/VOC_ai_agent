"""Promotion-strip helper for raw_metadata → channel_meta source-of-truth rule.

Connectors copy a fixed set of raw_metadata keys into a typed channel_meta
instance. To enforce the no-duplication rule (Phase 1 design refinement §C.2),
the promoted keys MUST then be removed from raw_metadata before persistence.
"""

from __future__ import annotations

from typing import Any


def strip_promoted_keys(
    raw_metadata: dict[str, Any], promoted_keys: set[str]
) -> dict[str, Any]:
    """Return a new dict with `promoted_keys` removed from `raw_metadata`.

    Idempotent on missing keys; does not mutate the input dict.
    """
    return {k: v for k, v in raw_metadata.items() if k not in promoted_keys}
