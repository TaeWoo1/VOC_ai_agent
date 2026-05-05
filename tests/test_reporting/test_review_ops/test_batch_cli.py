from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from scripts.run_review_ops_batch import main as batch_main
from src.voc.persistence.migrations import init_db

PRODUCT_URL = "https://example.test/p/abc"


def _seed_run_dir(parent: Path, name: str, *, source_url: str = PRODUCT_URL) -> Path:
    run_dir = parent / name
    (run_dir / "shared").mkdir(parents=True)
    (run_dir / "manifest.json").write_text(
        json.dumps(
            {
                "schema_version": "manifest.v1",
                "run_dir": run_dir.name,
                "product": {"slug": name, "source_url": source_url},
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    (run_dir / "shared" / "analysis_report.json").write_text(
        json.dumps(
            {
                "schema_version": "analysis_report.v1",
                "generated_at": "2026-05-04T00:00:00Z",
                "product": {
                    "slug": name,
                    "display_product_name": f"테스트 제품 {name}",
                    "raw_product_name": f"테스트 제품 {name}",
                    "source_url": source_url,
                    "selected_profile_id": "skincare_pad",
                },
                "corpus": {"observation_window": {"start": None, "end": None}},
                "attributes": [],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    return run_dir


def _seed_db_with_two_rows(db_path: Path, *, product_url: str = PRODUCT_URL) -> None:
    init_db(str(db_path)).close()
    conn = sqlite3.connect(str(db_path))
    try:
        conn.executemany(
            """
            INSERT INTO phase1_reviews (
                review_id, source_channel, source_method, text,
                rating_raw, review_date, content_fingerprint, is_duplicate,
                product_keyword, channel_meta_json, raw_metadata_json,
                collected_at, ingested_at
            ) VALUES (?, 'oliveyoung', 'api', ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
            """,
            [
                (
                    "rev_aaaaaaaaaaaa",
                    "촉촉하고 발림성이 좋아요. 재구매 의사 있어요.",
                    5.0,
                    "2026-04-01",
                    "fp1",
                    product_url,
                    "{}",
                    "{}",
                    "2026-05-04T00:00:00Z",
                    "2026-05-04T00:00:00Z",
                ),
                (
                    "rev_bbbbbbbbbbbb",
                    "용기 펌프가 잘 안 나와요. 사용감은 좋은데 아쉬워요.",
                    2.0,
                    "2024-08-12",
                    "fp2",
                    product_url,
                    "{}",
                    "{}",
                    "2026-05-04T00:00:00Z",
                    "2026-05-04T00:00:00Z",
                ),
            ],
        )
        conn.commit()
    finally:
        conn.close()


# ── per-run-dir mode ──────────────────────────────────────────────────


def test_batch_processes_valid_skips_missing_and_continues(tmp_path, capsys):
    outputs = tmp_path / "outputs"
    outputs.mkdir()
    valid_a = _seed_run_dir(outputs, "valid_a")
    valid_b = _seed_run_dir(outputs, "valid_b")
    skipped = outputs / "no_analysis_report"
    skipped.mkdir()
    db_path = tmp_path / "voc.db"
    _seed_db_with_two_rows(db_path)

    rc = batch_main(
        [
            "--run-dir",
            str(valid_a),
            "--run-dir",
            str(skipped),  # explicit but missing analysis_report → skipped
            "--run-dir",
            str(valid_b),
            "--db-path",
            str(db_path),
        ]
    )
    assert rc == 0  # at least one success

    captured = capsys.readouterr()
    summary = json.loads(captured.out)
    assert summary["total_candidates"] == 3
    assert summary["succeeded"] == 2
    assert summary["skipped"] == 1
    assert summary["failed"] == 0

    # Per-run status preserved (in argv order).
    by_run = {r["run_dir"]: r for r in summary["results"]}
    assert by_run[str(valid_a)]["status"] == "success"
    assert by_run[str(valid_b)]["status"] == "success"
    assert by_run[str(skipped)]["status"] == "skipped"
    assert "missing shared/analysis_report.json" in by_run[str(skipped)]["error_message"]

    # Valid runs produced both artifacts.
    for run in (valid_a, valid_b):
        assert (run / "shared" / "review_ops_analysis.json").exists()
        assert (run / "review_ops" / "review_ops_report.html").exists()
        result = by_run[str(run)]
        assert result["html_path"] and result["json_path"]
        assert result["reviews_loaded"] == 2
        assert result["asset_counts"]["risk"] >= 1

    # Skipped run wrote nothing.
    assert not (skipped / "shared" / "review_ops_analysis.json").exists()
    assert not (skipped / "review_ops" / "review_ops_report.html").exists()

    # Per-run log lines went to stderr (one per candidate).
    err = captured.err
    assert err.count("[review_ops][batch]") == 3
    assert "valid_a: success" in err
    assert "valid_b: success" in err
    assert "no_analysis_report: skipped" in err


def test_individual_failure_does_not_stop_later_runs(tmp_path, capsys, monkeypatch):
    """If process_run_dir returns failed for one run, the batch still runs the next."""
    outputs = tmp_path / "outputs"
    outputs.mkdir()
    bad = _seed_run_dir(outputs, "bad_run")
    good = _seed_run_dir(outputs, "good_run")
    db_path = tmp_path / "voc.db"
    _seed_db_with_two_rows(db_path)

    # Inject a banned phrase only when processing the "bad" run, by
    # poisoning landing_copy.generate via monkeypatch. The check uses the
    # current run_dir from process_run_dir's stack frame indirectly: simpler
    # to poison unconditionally and verify the second run still tries.
    from src.voc.reporting.review_ops import landing_copy as lc

    original_generate = lc.generate
    call_state = {"count": 0}

    def poisoned_generate(**kwargs):
        call_state["count"] += 1
        items = list(original_generate(**kwargs))
        if call_state["count"] == 1:
            # First processed run → inject a banned phrase to fail safety.
            items.insert(
                0,
                {
                    "topic": "test",
                    "section_hint": "FAQ",
                    "copy": "이 제품은 제품 결함 가능성 안내",
                    "rationale": "test",
                    "source_cluster_id": None,
                    "source_review_ids": [],
                },
            )
        return items

    monkeypatch.setattr(lc, "generate", poisoned_generate)

    rc = batch_main(
        [
            "--run-dir",
            str(bad),
            "--run-dir",
            str(good),
            "--db-path",
            str(db_path),
        ]
    )
    # At least one success → exit 0.
    assert rc == 0

    summary = json.loads(capsys.readouterr().out)
    assert summary["total_candidates"] == 2
    assert summary["succeeded"] == 1
    assert summary["failed"] == 1
    by_run = {r["run_dir"]: r for r in summary["results"]}
    assert by_run[str(bad)]["status"] == "failed"
    assert "safety validation failed" in (by_run[str(bad)]["error_message"] or "")
    assert by_run[str(good)]["status"] == "success"

    # Bad run produced no artifacts (fail-closed).
    assert not (bad / "shared" / "review_ops_analysis.json").exists()
    # Good run produced both.
    assert (good / "shared" / "review_ops_analysis.json").exists()
    assert (good / "review_ops" / "review_ops_report.html").exists()


def test_only_failures_returns_nonzero(tmp_path, capsys):
    outputs = tmp_path / "outputs"
    outputs.mkdir()
    skipped = outputs / "empty_dir"
    skipped.mkdir()

    rc = batch_main(["--run-dir", str(skipped)])
    assert rc == 1
    summary = json.loads(capsys.readouterr().out)
    assert summary["succeeded"] == 0
    assert summary["skipped"] == 1


# ── outputs-dir scan mode ─────────────────────────────────────────────


def test_outputs_dir_scan_picks_up_only_dirs_with_analysis_report(tmp_path, capsys):
    outputs = tmp_path / "outputs"
    outputs.mkdir()
    valid = _seed_run_dir(outputs, "z_valid")  # sorted ascending → comes after junk
    (outputs / "a_no_shared").mkdir()
    (outputs / ".DS_Store").write_text("noise", encoding="utf-8")  # not a dir
    db_path = tmp_path / "voc.db"
    _seed_db_with_two_rows(db_path)

    rc = batch_main(
        [
            "--outputs-dir",
            str(outputs),
            "--db-path",
            str(db_path),
        ]
    )
    assert rc == 0
    summary = json.loads(capsys.readouterr().out)
    # Junk file & analysis-less dir filtered out at discovery stage.
    assert summary["total_candidates"] == 1
    assert summary["results"][0]["run_dir"] == str(valid)
    assert summary["results"][0]["status"] == "success"


def test_limit_caps_discovered_run_dirs(tmp_path, capsys):
    outputs = tmp_path / "outputs"
    outputs.mkdir()
    _seed_run_dir(outputs, "run_a")
    _seed_run_dir(outputs, "run_b")
    _seed_run_dir(outputs, "run_c")
    db_path = tmp_path / "voc.db"
    _seed_db_with_two_rows(db_path)

    rc = batch_main(
        [
            "--outputs-dir",
            str(outputs),
            "--limit",
            "2",
            "--db-path",
            str(db_path),
        ]
    )
    assert rc == 0
    summary = json.loads(capsys.readouterr().out)
    assert summary["total_candidates"] == 2
    # Sorted ascending → run_a, run_b.
    names = [Path(r["run_dir"]).name for r in summary["results"]]
    assert names == ["run_a", "run_b"]


def test_db_missing_still_succeeds_via_graceful_degrade(tmp_path, capsys):
    outputs = tmp_path / "outputs"
    outputs.mkdir()
    valid = _seed_run_dir(outputs, "valid")

    rc = batch_main(
        [
            "--run-dir",
            str(valid),
            "--db-path",
            str(tmp_path / "does_not_exist.db"),
        ]
    )
    assert rc == 0
    summary = json.loads(capsys.readouterr().out)
    result = summary["results"][0]
    assert result["status"] == "success"
    # No reviews loaded but the report still rendered.
    assert result["reviews_loaded"] == 0
    assert (valid / "shared" / "review_ops_analysis.json").exists()


# ── single-CLI behavior preserved through the refactor ───────────────


def _seed_run_dir_with_slug(parent: Path, name: str, slug: str) -> Path:
    """Seed a run_dir whose analysis_report has a specific product.slug."""
    run_dir = parent / name
    (run_dir / "shared").mkdir(parents=True)
    (run_dir / "manifest.json").write_text(
        json.dumps(
            {
                "schema_version": "manifest.v1",
                "run_dir": run_dir.name,
                "product": {"slug": slug, "source_url": f"https://x.test/{slug}"},
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    (run_dir / "shared" / "analysis_report.json").write_text(
        json.dumps(
            {
                "schema_version": "analysis_report.v1",
                "generated_at": "2026-05-04T00:00:00Z",
                "product": {
                    "slug": slug,
                    "display_product_name": f"테스트 {slug}",
                    "raw_product_name": f"테스트 {slug}",
                    "source_url": f"https://x.test/{slug}",
                    "selected_profile_id": "skincare_pad",
                },
                "corpus": {"observation_window": {"start": None, "end": None}},
                "attributes": [],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    return run_dir


# ── newest-per-product dedup ──────────────────────────────────────────


def test_default_no_dedup_keeps_all_run_dirs(tmp_path, capsys):
    outputs = tmp_path / "outputs"
    outputs.mkdir()
    _seed_run_dir_with_slug(outputs, "2026-04-29_run-001", "prod-A")
    _seed_run_dir_with_slug(outputs, "2026-05-01_run-002", "prod-A")
    _seed_run_dir_with_slug(outputs, "2026-05-02_run-001", "prod-B")
    db_path = tmp_path / "voc.db"
    _seed_db_with_two_rows(db_path)

    rc = batch_main(["--outputs-dir", str(outputs), "--db-path", str(db_path)])
    assert rc == 0
    summary = json.loads(capsys.readouterr().out)
    assert summary["total_candidates"] == 3  # no collapsing


def test_newest_per_product_collapses_duplicates_for_same_slug(tmp_path, capsys):
    outputs = tmp_path / "outputs"
    outputs.mkdir()
    _seed_run_dir_with_slug(outputs, "2026-04-29_run-001", "prod-A")
    _seed_run_dir_with_slug(outputs, "2026-05-01_run-002", "prod-A")
    _seed_run_dir_with_slug(outputs, "2026-05-03_run-007", "prod-A")
    db_path = tmp_path / "voc.db"
    _seed_db_with_two_rows(db_path)

    rc = batch_main(
        [
            "--outputs-dir",
            str(outputs),
            "--newest-per-product",
            "--db-path",
            str(db_path),
        ]
    )
    assert rc == 0
    summary = json.loads(capsys.readouterr().out)
    assert summary["total_candidates"] == 1
    # Lex-newest run_dir kept (run-007 > run-002 > run-001 by date prefix).
    assert summary["results"][0]["run_dir"].endswith("2026-05-03_run-007")


def test_newest_per_product_keeps_one_per_distinct_product(tmp_path, capsys):
    outputs = tmp_path / "outputs"
    outputs.mkdir()
    _seed_run_dir_with_slug(outputs, "2026-04-29_run-001", "prod-A")
    _seed_run_dir_with_slug(outputs, "2026-05-02_run-005", "prod-A")
    _seed_run_dir_with_slug(outputs, "2026-04-30_run-001", "prod-B")
    _seed_run_dir_with_slug(outputs, "2026-05-01_run-003", "prod-C")
    db_path = tmp_path / "voc.db"
    _seed_db_with_two_rows(db_path)

    rc = batch_main(
        [
            "--outputs-dir",
            str(outputs),
            "--newest-per-product",
            "--db-path",
            str(db_path),
        ]
    )
    assert rc == 0
    summary = json.loads(capsys.readouterr().out)
    assert summary["total_candidates"] == 3  # one per slug
    names = sorted(Path(r["run_dir"]).name for r in summary["results"])
    assert names == [
        "2026-04-30_run-001",  # prod-B (only one)
        "2026-05-01_run-003",  # prod-C (only one)
        "2026-05-02_run-005",  # prod-A (newest)
    ]


def test_limit_applies_after_newest_per_product_dedup(tmp_path, capsys):
    outputs = tmp_path / "outputs"
    outputs.mkdir()
    _seed_run_dir_with_slug(outputs, "2026-04-29_run-001", "prod-A")
    _seed_run_dir_with_slug(outputs, "2026-05-02_run-005", "prod-A")  # newest A
    _seed_run_dir_with_slug(outputs, "2026-04-30_run-001", "prod-B")  # only B
    _seed_run_dir_with_slug(outputs, "2026-05-01_run-003", "prod-C")  # only C
    db_path = tmp_path / "voc.db"
    _seed_db_with_two_rows(db_path)

    rc = batch_main(
        [
            "--outputs-dir",
            str(outputs),
            "--newest-per-product",
            "--limit",
            "2",
            "--db-path",
            str(db_path),
        ]
    )
    assert rc == 0
    summary = json.loads(capsys.readouterr().out)
    # 4 raw → 3 after dedup → 2 after limit. Sorted ascending → first two by name.
    assert summary["total_candidates"] == 2
    names = [Path(r["run_dir"]).name for r in summary["results"]]
    assert names == ["2026-04-30_run-001", "2026-05-01_run-003"]


def test_newest_per_product_falls_back_to_run_dir_name_hash(tmp_path, capsys):
    """When analysis_report is malformed and manifest lacks product info,
    identity should fall back to the 'product-XXXX' hash in the run_dir name."""
    outputs = tmp_path / "outputs"
    outputs.mkdir()
    # Two run_dirs with the same product hash in their name but no readable
    # product slug anywhere → must collapse to one.
    for name in ("2026-04-29_product-aaa111_run-001", "2026-05-02_product-aaa111_run-007"):
        rd = outputs / name
        (rd / "shared").mkdir(parents=True)
        # Malformed analysis_report.json — present but unreadable.
        (rd / "shared" / "analysis_report.json").write_text(
            "{not valid json", encoding="utf-8"
        )
        # Manifest without product info.
        (rd / "manifest.json").write_text("{}", encoding="utf-8")
    db_path = tmp_path / "voc.db"
    _seed_db_with_two_rows(db_path)

    batch_main(
        [
            "--outputs-dir",
            str(outputs),
            "--newest-per-product",
            "--db-path",
            str(db_path),
        ]
    )
    # The two run_dirs share fallback identity 'name:product-aaa111' → 1 kept.
    summary = json.loads(capsys.readouterr().out)
    assert summary["total_candidates"] == 1
    assert summary["results"][0]["run_dir"].endswith(
        "2026-05-02_product-aaa111_run-007"
    )
    # Both runs failed to load (malformed analysis_report) but the dedup
    # itself still happened cleanly without crashing — process_run_dir
    # may mark this as failed but the batch must not blow up.
    assert summary["failed"] + summary["succeeded"] == 1
    # rc may be 0 or 1 depending on whether the kept run succeeds. Don't pin.


def test_run_dir_explicit_mode_also_respects_newest_per_product(tmp_path, capsys):
    outputs = tmp_path / "outputs"
    outputs.mkdir()
    a1 = _seed_run_dir_with_slug(outputs, "2026-04-29_run-001", "prod-A")
    a2 = _seed_run_dir_with_slug(outputs, "2026-05-02_run-005", "prod-A")
    db_path = tmp_path / "voc.db"
    _seed_db_with_two_rows(db_path)

    rc = batch_main(
        [
            "--run-dir", str(a1),
            "--run-dir", str(a2),
            "--newest-per-product",
            "--db-path", str(db_path),
        ]
    )
    assert rc == 0
    summary = json.loads(capsys.readouterr().out)
    assert summary["total_candidates"] == 1
    assert summary["results"][0]["run_dir"] == str(a2)


def test_single_cli_stdout_format_unchanged_after_pipeline_extraction(tmp_path, capsys):
    """Walking-skeleton CLI assertions still hold after delegating to process_run_dir."""
    from scripts.generate_review_ops_report import main as single_main

    outputs = tmp_path / "outputs"
    outputs.mkdir()
    run_dir = _seed_run_dir(outputs, "valid")
    db_path = tmp_path / "voc.db"
    _seed_db_with_two_rows(db_path)

    rc = single_main(["--run-dir", str(run_dir), "--db-path", str(db_path)])
    assert rc == 0
    out = capsys.readouterr().out
    assert "db_status=ok" in out
    assert "reviews_loaded=2" in out
    assert "wrote " in out
