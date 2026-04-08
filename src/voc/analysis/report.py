"""Eval report generator — markdown and JSON output.

HYBRID: Markdown generation skeleton scaffolded.
Report structure and content design are SELF.
"""

from __future__ import annotations

import json
from pathlib import Path


def generate_markdown_report(eval_report: dict, failure_report: dict) -> str:
    """Generate a markdown report from eval + failure analysis results.

    Args:
        eval_report: Structured eval results dict.
        failure_report: Failure taxonomy classification dict.

    Returns:
        Markdown string.

    TODO: Design report structure (sections, tables, highlights)
    TODO: Include failure matrix (failure type × query category)
    TODO: Include top-3 failure root cause analysis
    TODO: Include experiment comparison if available
    """
    raise NotImplementedError("Design report structure")


def save_json_report(report: dict, output_dir: Path) -> Path:
    """Save eval report as timestamped JSON.

    Args:
        report: Full report dict.
        output_dir: Directory to save to.

    Returns:
        Path to saved file.

    TODO: Add timestamp to filename for regression tracking
    """
    raise NotImplementedError("Implement JSON report saving")
