"""Eval dataset loader and validator.

HYBRID: Loader skeleton scaffolded. Validation rules are SELF.
"""

from __future__ import annotations

import json
from pathlib import Path

EVAL_DATA_DIR = Path(__file__).resolve().parents[3] / "eval_data"


def load_eval_queries(path: Path | None = None) -> list[dict]:
    """Load evaluation queries from JSON.

    Args:
        path: Path to eval queries JSON file.
              Defaults to eval_data/queries/eval_queries_v1.json.

    Returns:
        List of eval query dicts.

    TODO: Validate against EvalQuery schema
    TODO: Check query_language field is valid
    TODO: Verify all taxonomy categories are represented
    TODO: Warn if fewer than 12 queries
    """
    path = path or EVAL_DATA_DIR / "queries" / "eval_queries_v1.json"
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def load_gold_references(path: Path | None = None) -> list[dict]:
    """Load gold references from JSON.

    Args:
        path: Path to gold references JSON file.

    Returns:
        List of gold reference dicts.

    TODO: Validate against GoldReference schema
    TODO: Cross-check query_ids match eval queries
    TODO: Verify evidence_ids exist in annotations
    """
    path = path or EVAL_DATA_DIR / "gold" / "gold_references_v1.json"
    with open(path, encoding="utf-8") as f:
        return json.load(f)
