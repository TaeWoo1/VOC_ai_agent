"""Coverage for scripts/build_review_ops_package_index.py.

Read-only behavior: writes index.html only, never touches run_dirs.
"""

from __future__ import annotations

import json
from pathlib import Path

from scripts.build_review_ops_package_index import main as build_main


def _seed_run_dir(
    parent: Path,
    name: str,
    *,
    with_review_ops: bool = True,
    with_seller_pdf: bool = True,
    with_cardnews: bool = True,
    display_name: str = "테스트 제품",
    brand_name: str | None = "테스트브랜드",
    profile_id: str = "skincare_pad",
) -> Path:
    rd = parent / name
    (rd / "shared").mkdir(parents=True)
    (rd / "shared" / "analysis_report.json").write_text(
        json.dumps(
            {
                "schema_version": "analysis_report.v1",
                "product": {
                    "display_product_name": display_name,
                    "selected_profile_id": profile_id,
                },
                "corpus": {
                    "n_reviews_total": 1234,
                    "observation_window": {"start": "2024-01-01", "end": "2026-04-30"},
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    if with_review_ops:
        (rd / "shared" / "review_ops_analysis.json").write_text(
            json.dumps(
                {
                    "schema_version": "review_ops_analysis.v1",
                    "product": {
                        "display_product_name": display_name,
                        "brand_name": brand_name,
                        "selected_profile_id": profile_id,
                        "analysis_period": {
                            "start": "2024-01-01",
                            "end": "2026-04-30",
                        },
                    },
                    "metrics": {
                        "total_reviews": 1234,
                        "average_rating": 4.21,
                    },
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        (rd / "review_ops").mkdir(parents=True)
        (rd / "review_ops" / "review_ops_report.html").write_text(
            "<html>review ops</html>", encoding="utf-8"
        )
    if with_seller_pdf:
        (rd / "seller_report").mkdir(parents=True)
        (rd / "seller_report" / "seller_report_ko.pdf").write_text(
            "fake-pdf", encoding="utf-8"
        )
    if with_cardnews:
        (rd / "buyer_content" / "ko").mkdir(parents=True)
        (rd / "buyer_content" / "ko" / "buyer_journey_cardnews.json").write_text(
            "{}", encoding="utf-8"
        )
    return rd


def _read_index(package_dir: Path) -> str:
    return (package_dir / "index.html").read_text(encoding="utf-8")


# ── happy path ────────────────────────────────────────────────────────


def test_index_lists_every_supplied_run(tmp_path):
    runs_root = tmp_path / "outputs"
    runs_root.mkdir()
    a = _seed_run_dir(runs_root, "run_a", display_name="제품 A")
    b = _seed_run_dir(runs_root, "run_b", display_name="제품 B")
    pkg = tmp_path / "pkg"
    rc = build_main([
        "--package-dir", str(pkg),
        "--run-dir", str(a),
        "--run-dir", str(b),
    ])
    assert rc == 0
    html = _read_index(pkg)
    assert "제품 A" in html
    assert "제품 B" in html
    assert "Review Ops Pilot Package Index" in html


def test_complete_run_links_all_five_artifacts(tmp_path):
    runs_root = tmp_path / "outputs"
    runs_root.mkdir()
    rd = _seed_run_dir(runs_root, "run_full")
    pkg = tmp_path / "pkg"
    build_main(["--package-dir", str(pkg), "--run-dir", str(rd)])
    html = _read_index(pkg)
    # All 5 artifacts should appear as links by relative path.
    assert "shared/analysis_report.json" in html
    assert "seller_report_ko.pdf" in html
    assert "buyer_journey_cardnews.json" in html
    assert "review_ops_report.html" in html
    assert "review_ops_analysis.json" in html
    # QA status is "ready".
    assert "qa-ready" in html
    assert ">ready<" in html


# ── partial / missing artifacts ───────────────────────────────────────


def test_missing_seller_pdf_shows_not_found(tmp_path):
    runs_root = tmp_path / "outputs"
    runs_root.mkdir()
    rd = _seed_run_dir(runs_root, "no_pdf", with_seller_pdf=False)
    pkg = tmp_path / "pkg"
    build_main(["--package-dir", str(pkg), "--run-dir", str(rd)])
    html = _read_index(pkg)
    assert "not found" in html
    # Status is partial because pdf is the only missing artifact.
    assert ">partial<" in html


def test_missing_cardnews_shows_not_found(tmp_path):
    runs_root = tmp_path / "outputs"
    runs_root.mkdir()
    rd = _seed_run_dir(runs_root, "no_cn", with_cardnews=False)
    pkg = tmp_path / "pkg"
    build_main(["--package-dir", str(pkg), "--run-dir", str(rd)])
    html = _read_index(pkg)
    assert "not found" in html


def test_missing_review_ops_shows_not_generated(tmp_path):
    runs_root = tmp_path / "outputs"
    runs_root.mkdir()
    rd = _seed_run_dir(runs_root, "no_ro", with_review_ops=False)
    pkg = tmp_path / "pkg"
    build_main(["--package-dir", str(pkg), "--run-dir", str(rd)])
    html = _read_index(pkg)
    assert "not generated" in html


def test_falls_back_to_analysis_report_when_review_ops_missing(tmp_path):
    runs_root = tmp_path / "outputs"
    runs_root.mkdir()
    rd = _seed_run_dir(
        runs_root, "fallback", with_review_ops=False, display_name="대체 제품명"
    )
    pkg = tmp_path / "pkg"
    build_main(["--package-dir", str(pkg), "--run-dir", str(rd)])
    html = _read_index(pkg)
    # Product name is sourced from analysis_report.product when review_ops JSON is absent.
    assert "대체 제품명" in html
    # n_reviews_total in analysis_report fed metrics column.
    assert "1,234" in html


def test_run_dir_without_analysis_report_is_marked_missing(tmp_path):
    runs_root = tmp_path / "outputs"
    runs_root.mkdir()
    bad = runs_root / "no_base"
    bad.mkdir()
    pkg = tmp_path / "pkg"
    rc = build_main(["--package-dir", str(pkg), "--run-dir", str(bad)])
    # Returns 0 still — the row is rendered with status=missing rather than crashing.
    assert rc == 0
    html = _read_index(pkg)
    assert ">missing<" in html
    assert "missing shared/analysis_report.json" in html


# ── runs-file input mode ──────────────────────────────────────────────


def test_runs_file_input_mode(tmp_path):
    runs_root = tmp_path / "outputs"
    runs_root.mkdir()
    a = _seed_run_dir(runs_root, "f_run_a")
    b = _seed_run_dir(runs_root, "f_run_b")
    runs_txt = tmp_path / "runs.txt"
    runs_txt.write_text(
        f"# pilot brand-20 selection\n{a}\n{b}\n", encoding="utf-8"
    )
    pkg = tmp_path / "pkg"
    rc = build_main([
        "--package-dir", str(pkg),
        "--runs-file", str(runs_txt),
    ])
    assert rc == 0
    html = _read_index(pkg)
    assert a.name in html or "f_run_a" in html
    assert b.name in html or "f_run_b" in html


def test_no_inputs_returns_nonzero(tmp_path, capsys):
    pkg = tmp_path / "pkg"
    rc = build_main(["--package-dir", str(pkg)])
    assert rc == 1
    assert "no run_dirs supplied" in capsys.readouterr().err


def test_index_prefers_review_ops_header_title_over_raw_display_name(tmp_path):
    runs_root = tmp_path / "outputs"
    runs_root.mkdir()
    rd = runs_root / "promo"
    (rd / "shared").mkdir(parents=True)
    (rd / "shared" / "analysis_report.json").write_text(
        json.dumps({"product": {"display_product_name": "[프로모] 깨끗한 제품 (기획)"}}),
        encoding="utf-8",
    )
    (rd / "shared" / "review_ops_analysis.json").write_text(
        json.dumps(
            {
                "product": {
                    "display_product_name": "[프로모] 깨끗한 제품 (기획)",
                    "header_title": "깨끗한 제품",
                },
                "metrics": {"total_reviews": 10, "average_rating": 4.0},
            }
        ),
        encoding="utf-8",
    )
    pkg = tmp_path / "pkg"
    build_main(["--package-dir", str(pkg), "--run-dir", str(rd)])
    html = _read_index(pkg)
    assert "깨끗한 제품" in html
    # The raw promo prefix should not appear in the product cell.
    assert "[프로모]" not in html


def _seed_cardnews_package(
    parent: Path,
    slug: str,
    *,
    page_count: int = 13,
    analysis_report_sha256: str | None = None,
    include_cover: bool = True,
) -> Path:
    """Create a minimal outputs/content_packages/<slug>/cardnews/ko/ tree:
    pages/01_cover.png … 0N_*.png + manifest.json. Returns the cardnews dir.
    """
    cn_dir = parent / "outputs" / "content_packages" / slug / "cardnews" / "ko"
    pages = cn_dir / "pages"
    pages.mkdir(parents=True)
    if include_cover:
        (pages / "01_cover.png").write_bytes(b"\x89PNG\r\n")
    for i in range(2, page_count + 1):
        (pages / f"{i:02d}_page.png").write_bytes(b"\x89PNG\r\n")
    manifest = {"page_count": page_count, "schema_version": "1.0"}
    if analysis_report_sha256:
        manifest["analysis_report_sha256"] = analysis_report_sha256
    (cn_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False), encoding="utf-8"
    )
    return cn_dir


def test_index_shows_cardnews_png_pages_when_present(tmp_path, monkeypatch):
    runs_root = tmp_path / "outputs"
    runs_root.mkdir()
    rd = _seed_run_dir(runs_root, "run_with_pngs")
    # Match by basename: cardnews package slug == run_dir basename.
    _seed_cardnews_package(tmp_path, "run_with_pngs", page_count=13)

    # Point the scanner at the tmp_path content_packages root.
    import scripts.build_review_ops_package_index as mod
    monkeypatch.setattr(
        mod, "DEFAULT_CONTENT_PACKAGES_ROOT",
        tmp_path / "outputs" / "content_packages",
    )

    pkg = tmp_path / "pkg"
    rc = build_main(["--package-dir", str(pkg), "--run-dir", str(rd)])
    assert rc == 0
    html = _read_index(pkg)
    assert "13 pages" in html
    # Header column for the new section is present.
    assert "Consumer · cardnews PNG" in html


def test_index_links_cover_png_when_present(tmp_path, monkeypatch):
    runs_root = tmp_path / "outputs"
    runs_root.mkdir()
    rd = _seed_run_dir(runs_root, "run_cover")
    _seed_cardnews_package(tmp_path, "run_cover", page_count=5)

    import scripts.build_review_ops_package_index as mod
    monkeypatch.setattr(
        mod, "DEFAULT_CONTENT_PACKAGES_ROOT",
        tmp_path / "outputs" / "content_packages",
    )

    pkg = tmp_path / "pkg"
    build_main(["--package-dir", str(pkg), "--run-dir", str(rd)])
    html = _read_index(pkg)
    assert "01_cover.png" in html
    assert "5 pages" in html


def test_index_shows_cardnews_images_not_found_when_only_json(tmp_path):
    runs_root = tmp_path / "outputs"
    runs_root.mkdir()
    rd = _seed_run_dir(runs_root, "json_only")
    # JSON exists (from _seed_run_dir; default with_review_ops adds review_ops too,
    # but the buyer cardnews JSON also exists by helper default).
    pkg = tmp_path / "pkg"
    build_main(["--package-dir", str(pkg), "--run-dir", str(rd)])
    html = _read_index(pkg)
    assert "cardnews images not found" in html
    # JSON source link still present.
    assert "buyer_journey_cardnews.json" in html


def test_index_handles_missing_both_json_and_png(tmp_path):
    runs_root = tmp_path / "outputs"
    runs_root.mkdir()
    rd = _seed_run_dir(runs_root, "neither", with_cardnews=False, with_review_ops=False)
    pkg = tmp_path / "pkg"
    rc = build_main(["--package-dir", str(pkg), "--run-dir", str(rd)])
    assert rc == 0
    html = _read_index(pkg)
    # JSON column shows not found; PNG column shows the cardnews-specific message.
    assert "not found" in html
    assert "cardnews images not found" in html


def test_index_matches_via_sha256_when_basename_differs(tmp_path, monkeypatch):
    runs_root = tmp_path / "outputs"
    runs_root.mkdir()
    rd = _seed_run_dir(runs_root, "weird_basename_run")
    # Compute the analysis_report sha256 the same way cardnews/render.py does:
    # canonical JSON (ensure_ascii=False, sort_keys=True), NOT raw file bytes.
    import hashlib
    ar = rd / "shared" / "analysis_report.json"
    payload = json.loads(ar.read_text(encoding="utf-8"))
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    sha = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    # Cardnews package slug deliberately doesn't match the run_dir basename.
    _seed_cardnews_package(
        tmp_path, "totally_different_slug",
        page_count=7, analysis_report_sha256=sha,
    )

    import scripts.build_review_ops_package_index as mod
    monkeypatch.setattr(
        mod, "DEFAULT_CONTENT_PACKAGES_ROOT",
        tmp_path / "outputs" / "content_packages",
    )

    pkg = tmp_path / "pkg"
    build_main(["--package-dir", str(pkg), "--run-dir", str(rd)])
    html = _read_index(pkg)
    assert "7 pages" in html
    assert "01_cover.png" in html


def test_index_falls_back_to_basename_when_sha_missing_in_manifest(tmp_path, monkeypatch):
    runs_root = tmp_path / "outputs"
    runs_root.mkdir()
    rd = _seed_run_dir(runs_root, "fallback_basename")
    # Manifest has no sha — match must come from basename equality.
    _seed_cardnews_package(
        tmp_path, "fallback_basename",
        page_count=4, analysis_report_sha256=None,
    )

    import scripts.build_review_ops_package_index as mod
    monkeypatch.setattr(
        mod, "DEFAULT_CONTENT_PACKAGES_ROOT",
        tmp_path / "outputs" / "content_packages",
    )

    pkg = tmp_path / "pkg"
    build_main(["--package-dir", str(pkg), "--run-dir", str(rd)])
    html = _read_index(pkg)
    assert "4 pages" in html


def test_index_qa_status_unchanged_by_cardnews_png_presence(tmp_path, monkeypatch):
    """Adding rendered PNGs must not flip the existing ready/partial gate."""
    runs_root = tmp_path / "outputs"
    runs_root.mkdir()
    # Complete (ready) run + matching PNG package → still ready.
    rd_full = _seed_run_dir(runs_root, "qa_ready")
    _seed_cardnews_package(tmp_path, "qa_ready", page_count=10)
    # Run missing seller PDF (partial) + matching PNG package → still partial.
    rd_partial = _seed_run_dir(runs_root, "qa_partial", with_seller_pdf=False)
    _seed_cardnews_package(tmp_path, "qa_partial", page_count=10)

    import scripts.build_review_ops_package_index as mod
    monkeypatch.setattr(
        mod, "DEFAULT_CONTENT_PACKAGES_ROOT",
        tmp_path / "outputs" / "content_packages",
    )

    pkg = tmp_path / "pkg"
    build_main([
        "--package-dir", str(pkg),
        "--run-dir", str(rd_full),
        "--run-dir", str(rd_partial),
    ])
    html = _read_index(pkg)
    assert ">ready<" in html
    assert ">partial<" in html


def test_brand_metrics_period_pulled_from_review_ops_when_present(tmp_path):
    runs_root = tmp_path / "outputs"
    runs_root.mkdir()
    rd = _seed_run_dir(runs_root, "rich", brand_name="브랜드X")
    pkg = tmp_path / "pkg"
    build_main(["--package-dir", str(pkg), "--run-dir", str(rd)])
    html = _read_index(pkg)
    assert "브랜드X" in html
    assert "★4.21" in html
    assert "2024-01-01" in html and "2026-04-30" in html
