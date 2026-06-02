"""Tests for the cardnews render CLI's default out-dir derivation.

Pure-Python — does not launch Playwright or touch the filesystem.
"""
from __future__ import annotations

from pathlib import Path

from cardnews.render import _default_out_dir_for_report


def test_default_out_dir_under_canonical_run_package(tmp_path: Path) -> None:
    """The canonical run-package layout resolves to
    `<run>/cardnews/<lang>/` — siblings to `shared/analysis_report.json`."""
    run = (
        tmp_path
        / "outputs"
        / "content_packages"
        / "2026-04-30_mediheal_pad_run-010"
    )
    report = run / "shared" / "analysis_report.json"
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text("{}", encoding="utf-8")

    derived = _default_out_dir_for_report(report)
    assert derived is not None
    assert derived == (run / "cardnews" / "ko").resolve()


def test_default_out_dir_respects_lang(tmp_path: Path) -> None:
    """`--lang en` produces the `en` sibling, not `ko`."""
    run = tmp_path / "outputs" / "content_packages" / "run_x"
    report = run / "shared" / "analysis_report.json"
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text("{}", encoding="utf-8")

    derived = _default_out_dir_for_report(report, lang="en")
    assert derived == (run / "cardnews" / "en").resolve()


def test_default_out_dir_returns_none_for_offpattern_paths(
    tmp_path: Path,
) -> None:
    """Reports outside the canonical layout get no default — the CLI
    then forces an explicit `--out-dir`."""
    # Wrong filename
    p1 = tmp_path / "outputs" / "content_packages" / "run_x" / "shared" / "report.json"
    p1.parent.mkdir(parents=True, exist_ok=True)
    p1.write_text("{}", encoding="utf-8")
    assert _default_out_dir_for_report(p1) is None

    # Wrong subdir name
    p2 = tmp_path / "outputs" / "content_packages" / "run_x" / "raw" / "analysis_report.json"
    p2.parent.mkdir(parents=True, exist_ok=True)
    p2.write_text("{}", encoding="utf-8")
    assert _default_out_dir_for_report(p2) is None

    # Wrong root segment
    p3 = tmp_path / "elsewhere" / "shared" / "analysis_report.json"
    p3.parent.mkdir(parents=True, exist_ok=True)
    p3.write_text("{}", encoding="utf-8")
    assert _default_out_dir_for_report(p3) is None
