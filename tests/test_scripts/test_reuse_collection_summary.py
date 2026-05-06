"""Tests for the analysis-only re-run path:
`run_phase2e_pipeline.py --reuse-collection-summary <path>`.

These cover only the CLI / argument-validation surface. The end-to-end
re-run (Stage 1/2/3 over an existing DB without re-scraping) requires
a populated SQLite DB and OPENAI_API_KEY, neither of which is
available in CI; the safe-regeneration command is documented in the
final operator report and exercised by the live operator.

What we DO assert here:
  - The flag is exposed in --help.
  - --reuse-collection-summary <missing> exits 2 with a clear message.
  - Without --stub-llm and without OPENAI_API_KEY, the pipeline fails
    fast with exit 2 BEFORE any DB / network work.
  - The collection_summary file the operator passes is not mutated by
    a fail-fast path (the validator returns before touching disk).
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
PIPELINE = REPO / "scripts" / "run_phase2e_pipeline.py"


def _run(argv: list[str], env_overrides: dict[str, str] | None = None):
    env = {k: v for k, v in os.environ.items() if k != "OPENAI_API_KEY"}
    env["PYTHONPATH"] = str(REPO)
    if env_overrides:
        env.update(env_overrides)
    return subprocess.run(
        [sys.executable, str(PIPELINE), *argv],
        capture_output=True, text=True, cwd=str(REPO), env=env,
    )


def test_help_exposes_reuse_collection_summary_flag():
    proc = _run(["--help"])
    assert proc.returncode == 0
    assert "--reuse-collection-summary" in proc.stdout
    # The help text must state the implication so an operator running
    # `--help` knows the flag pulls in --skip-scrape.
    assert "Implies --skip-scrape" in proc.stdout


def test_missing_reuse_summary_path_fails_fast(tmp_path: Path):
    missing = tmp_path / "does-not-exist.json"
    proc = _run([
        "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=A000000000001",
        "--reuse-collection-summary", str(missing),
        "--stub-llm",
    ])
    assert proc.returncode == 2
    assert "missing file" in proc.stderr or "missing file" in proc.stdout


def test_missing_openai_key_fails_fast_without_stub_llm(tmp_path: Path):
    """Real pipeline runs hitting the LLM must refuse early when no
    key is set. --stub-llm path is the explicit opt-out."""
    # Build a minimal valid prior collection_summary so we get past
    # the file-existence check and reach the OPENAI_API_KEY validator.
    cs = {
        "schema_version": "1.0",
        "product_url": "https://example.invalid/p",
        "primary_sort": "DATETIME_DESC",
        "sorts_attempted": [
            "DATETIME_DESC", "RATING_ASC", "RATING_DESC",
            "USEFUL_SCORE_DESC", "RECOMMENDED_DESC",
        ],
        "sorts_succeeded": [
            "DATETIME_DESC", "RATING_ASC", "RATING_DESC",
            "USEFUL_SCORE_DESC", "RECOMMENDED_DESC",
        ],
        "sorts_failed": [],
        "partial_success": False,
        "per_sort": {},
        "analysis_status": "completed",
    }
    cs_path = tmp_path / "collection_summary.json"
    cs_path.write_text(json.dumps(cs), encoding="utf-8")
    pre_mtime = cs_path.stat().st_mtime
    pre_bytes = cs_path.read_bytes()

    proc = _run([
        "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=A000000000001",
        "--reuse-collection-summary", str(cs_path),
        "--multi-sort",
        "--corpus-mode", "observable_multi_sort",
    ])
    assert proc.returncode == 2
    combined = proc.stderr + proc.stdout
    assert "OPENAI_API_KEY" in combined
    # Validator must abort before mutating the prior summary file.
    assert cs_path.read_bytes() == pre_bytes
    assert cs_path.stat().st_mtime == pre_mtime


def test_stub_llm_path_does_not_require_openai_key(tmp_path: Path):
    """The --stub-llm escape hatch must NOT be gated on
    OPENAI_API_KEY; it would defeat the purpose of stub mode."""
    cs_path = tmp_path / "collection_summary.json"
    cs_path.write_text(json.dumps({"sorts_succeeded": []}), encoding="utf-8")
    proc = _run([
        "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=A000000000001",
        "--reuse-collection-summary", str(cs_path),
        "--multi-sort",
        "--corpus-mode", "observable_multi_sort",
        "--stub-llm",
    ])
    # Will fail later (no DB, no run dir), but the OPENAI_API_KEY
    # gate must NOT be the cause.
    combined = proc.stderr + proc.stdout
    assert "OPENAI_API_KEY is not set" not in combined
