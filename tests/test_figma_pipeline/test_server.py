"""Tests for the local Figma cardnews data server.

Loads `scripts/serve_figma_cardnews.py` via importlib and exercises:
  - the pure helpers `find_latest_approved`, `find_by_run_id`,
    `_split_body`, `_row_to_response` directly;
  - the HTTP endpoints by spinning up a `ThreadingHTTPServer` on
    a free local port for the duration of each test.
"""
from __future__ import annotations

import csv
import importlib.util
import json
import socket
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

import pytest


REPO = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def srv():
    sys.path.insert(0, str(REPO))
    spec = importlib.util.spec_from_file_location(
        "srv", REPO / "scripts" / "serve_figma_cardnews.py",
    )
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _free_port() -> int:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def _write_csv(path: Path, rows: list[dict], srv) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(srv.SHEET_COLUMNS))
        w.writeheader()
        for r in rows:
            w.writerow({c: str(r.get(c, "")) for c in srv.SHEET_COLUMNS})


def _row(srv, **overrides) -> dict:
    base = {c: "" for c in srv.SHEET_COLUMNS}
    base.update({
        "date": "2026-04-30",
        "run_id": "run_001",
        "product_name": "Test product",
        "goods_no": "A000000999999",
        "category": "패드",
        "profile_id": "skincare_pad",
        "review_count": "100",
        "confidence": "high",
        "card01_title": "Hook title",
        "card01_body": "subtitle line\n• bullet A\n• bullet B\n※ footer",
        "card07_title": "Method",
        "card07_body": "근거 설명\n• 출처: 리뷰\n※ 결과 보장 자료가 아닙니다",
        "copy_status": "copy_pending",
        "design_status": "design_pending",
    })
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------


class TestFindLatestApproved:
    def test_returns_none_when_empty(self, srv):
        assert srv.find_latest_approved([]) is None

    def test_skips_pending(self, srv):
        rows = [_row(srv, run_id="r1", copy_status="copy_pending")]
        assert srv.find_latest_approved(rows) is None

    def test_returns_approved(self, srv):
        rows = [_row(srv, run_id="r1", copy_status="copy_approved")]
        out = srv.find_latest_approved(rows)
        assert out["run_id"] == "r1"

    def test_excludes_publish_ready(self, srv):
        rows = [_row(
            srv, run_id="r1",
            copy_status="copy_approved",
            design_status="publish_ready",
        )]
        # Already published — must not be re-served as "latest".
        assert srv.find_latest_approved(rows) is None

    def test_excludes_rejected(self, srv):
        rows = [_row(
            srv, run_id="r1",
            copy_status="copy_approved",
            design_status="rejected",
        )]
        assert srv.find_latest_approved(rows) is None

    def test_picks_most_recent_date(self, srv):
        rows = [
            _row(srv, run_id="old", date="2026-04-29",
                 copy_status="copy_approved"),
            _row(srv, run_id="new", date="2026-04-30",
                 copy_status="copy_approved"),
        ]
        assert srv.find_latest_approved(rows)["run_id"] == "new"

    def test_ties_break_on_run_id_desc(self, srv):
        rows = [
            _row(srv, run_id="run_a", date="2026-04-30",
                 copy_status="copy_approved"),
            _row(srv, run_id="run_b", date="2026-04-30",
                 copy_status="copy_approved"),
        ]
        # Lex desc → "run_b" wins.
        assert srv.find_latest_approved(rows)["run_id"] == "run_b"

    def test_design_review_needed_still_eligible(self, srv):
        # Once approved on copy, the row is eligible for the
        # plugin even if a previous Figma generation flagged it
        # for visual_review_needed — the plugin can re-clone.
        rows = [_row(
            srv, run_id="r1",
            copy_status="copy_approved",
            design_status="visual_review_needed",
        )]
        assert srv.find_latest_approved(rows)["run_id"] == "r1"


class TestFindByRunId:
    def test_match(self, srv):
        rows = [_row(srv, run_id="r1"), _row(srv, run_id="r2")]
        assert srv.find_by_run_id(rows, "r2")["run_id"] == "r2"

    def test_no_match(self, srv):
        rows = [_row(srv, run_id="r1")]
        assert srv.find_by_run_id(rows, "missing") is None

    def test_empty_run_id(self, srv):
        rows = [_row(srv, run_id="r1")]
        assert srv.find_by_run_id(rows, "") is None
        assert srv.find_by_run_id(rows, None) is None  # type: ignore


class TestSplitBody:
    def test_round_trip(self, srv):
        body = "리뷰 2,029건 정리\n• A\n• B\n※ disclaimer"
        out = srv._split_body(body)
        assert out["subtitle"] == "리뷰 2,029건 정리"
        assert out["bullets"] == ["A", "B"]
        assert out["footer_note"] == "disclaimer"

    def test_no_subtitle(self, srv):
        out = srv._split_body("• A\n• B")
        assert out["subtitle"] == ""
        assert out["bullets"] == ["A", "B"]
        assert out["footer_note"] == ""

    def test_empty(self, srv):
        out = srv._split_body("")
        assert out == {"subtitle": "", "bullets": [], "footer_note": ""}
        out2 = srv._split_body(None)
        assert out2 == {"subtitle": "", "bullets": [], "footer_note": ""}

    def test_handles_check_marker(self, srv):
        out = srv._split_body("✓ approved\n— rejected")
        assert out["bullets"] == ["approved", "rejected"]


class TestRowToResponse:
    def test_emits_seven_slides(self, srv):
        out = srv._row_to_response(_row(srv))
        assert out["schema_version"] == "1.0"
        assert len(out["slides"]) == 7
        for i, s in enumerate(out["slides"], start=1):
            assert s["slide_no"] == i

    def test_card01_fields_unpacked(self, srv):
        out = srv._row_to_response(_row(srv))
        s1 = out["slides"][0]
        assert s1["title"] == "Hook title"
        assert s1["subtitle"] == "subtitle line"
        assert s1["bullets"] == ["bullet A", "bullet B"]
        assert s1["footer_note"] == "footer"
        assert s1["body_raw"]  # original verbatim body kept

    def test_includes_top_level_row_fields(self, srv):
        out = srv._row_to_response(_row(srv))
        assert out["row"]["run_id"] == "run_001"
        assert out["row"]["category"] == "패드"
        assert out["row"]["confidence"] == "high"


# ---------------------------------------------------------------------------
# HTTP server (live, on a free port)
# ---------------------------------------------------------------------------


@pytest.fixture
def live_server(tmp_path: Path, srv):
    csv_path = tmp_path / "sheet.csv"
    rows = [
        _row(srv, run_id="r_pending", copy_status="copy_pending"),
        _row(srv, run_id="r_approved_old",
             date="2026-04-28", copy_status="copy_approved"),
        _row(srv, run_id="r_approved_new",
             date="2026-04-30", copy_status="copy_approved"),
        _row(srv, run_id="r_published",
             copy_status="copy_approved", design_status="publish_ready"),
    ]
    _write_csv(csv_path, rows, srv)

    port = _free_port()
    server = srv.make_server(csv_path=csv_path, host="127.0.0.1", port=port)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    # Briefly wait for bind.
    time.sleep(0.05)
    base_url = f"http://127.0.0.1:{port}"
    try:
        yield {"base_url": base_url, "csv_path": csv_path, "rows": rows}
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2.0)


def _get(url: str) -> tuple[int, dict]:
    try:
        with urllib.request.urlopen(url, timeout=2.0) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode("utf-8"))


class TestHttpEndpoints:
    def test_health_ok(self, live_server):
        status, body = _get(f"{live_server['base_url']}/health")
        assert status == 200
        assert body["ok"] is True
        assert body["csv_exists"] is True
        assert body["row_count"] == 4

    def test_latest_approved_returns_newest_eligible(self, live_server):
        status, body = _get(
            f"{live_server['base_url']}/cardnews/latest-approved",
        )
        assert status == 200
        assert body["row"]["run_id"] == "r_approved_new"
        assert len(body["slides"]) == 7

    def test_latest_approved_skips_published(self, live_server):
        # If the only approved row had been published, we'd 404.
        # Sanity: the newest non-published approved is r_approved_new.
        status, body = _get(
            f"{live_server['base_url']}/cardnews/latest-approved",
        )
        assert body["row"]["run_id"] != "r_published"

    def test_run_id_lookup(self, live_server):
        status, body = _get(
            f"{live_server['base_url']}/cardnews/r_approved_old",
        )
        assert status == 200
        assert body["row"]["run_id"] == "r_approved_old"

    def test_run_id_404(self, live_server):
        status, body = _get(
            f"{live_server['base_url']}/cardnews/missing",
        )
        assert status == 404
        assert body["error"] == "run_id_not_found"

    def test_unknown_path_404(self, live_server):
        status, body = _get(f"{live_server['base_url']}/foo/bar")
        assert status == 404
        assert body["error"] == "unknown_path"

    def test_cors_headers_present(self, live_server):
        with urllib.request.urlopen(
            f"{live_server['base_url']}/health", timeout=2.0,
        ) as resp:
            assert resp.headers.get("Access-Control-Allow-Origin") == "*"

    def test_latest_approved_404_when_no_approved(
        self, tmp_path: Path, srv,
    ):
        # Spin up a fresh server with all-pending rows.
        csv_path = tmp_path / "sheet.csv"
        _write_csv(csv_path, [_row(srv, copy_status="copy_pending")], srv)
        port = _free_port()
        s = srv.make_server(csv_path=csv_path, host="127.0.0.1", port=port)
        t = threading.Thread(target=s.serve_forever, daemon=True)
        t.start()
        time.sleep(0.05)
        try:
            status, body = _get(
                f"http://127.0.0.1:{port}/cardnews/latest-approved",
            )
        finally:
            s.shutdown()
            s.server_close()
            t.join(timeout=2.0)
        assert status == 404
        assert body["error"] == "no_approved_row"
