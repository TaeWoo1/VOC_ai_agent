"""Tests for src.voc.app.retry_queue (atomic JSON queue helpers)."""
from __future__ import annotations

import json
from pathlib import Path

from src.voc.app import retry_queue


# ---------------------------------------------------------------------------
# make_entry
# ---------------------------------------------------------------------------


class TestMakeEntry:
    def test_required_fields_populated(self):
        e = retry_queue.make_entry(
            product_url="https://example.com/x?goodsNo=A1",
            goods_no="A1",
            sort_type="RATING_ASC",
            failure_reason="anti_bot",
            last_status="blocked",
            run_dir="/tmp/run",
            attempted_at="2026-04-30T12:00:00Z",
        )
        for f in retry_queue.REQUIRED_FIELDS:
            assert f in e, f"missing required field {f!r}"
        assert e["product_url"] == "https://example.com/x?goodsNo=A1"
        assert e["goods_no"] == "A1"
        assert e["sort_type"] == "RATING_ASC"
        assert e["failure_reason"] == "anti_bot"
        assert e["last_status"] == "blocked"
        assert e["run_dir"] == "/tmp/run"
        assert e["attempted_at"] == "2026-04-30T12:00:00Z"

    def test_extra_payload_attached(self):
        e = retry_queue.make_entry(
            product_url="x", goods_no="A1", sort_type="X",
            failure_reason="y", last_status="z",
            extra={"cap": "100", "role": "signal"},
        )
        assert e["extra"] == {"cap": "100", "role": "signal"}

    def test_run_dir_optional(self):
        e = retry_queue.make_entry(
            product_url="x", goods_no="A1", sort_type="X",
            failure_reason="y", last_status="z",
        )
        assert e["run_dir"] is None

    def test_attempted_at_defaults_to_now_utc(self):
        e = retry_queue.make_entry(
            product_url="x", goods_no="A1", sort_type="X",
            failure_reason="y", last_status="z",
        )
        assert e["attempted_at"].endswith("Z")
        # ISO-8601-ish; not parsing because tests should not depend
        # on tz library shape.
        assert "T" in e["attempted_at"]


# ---------------------------------------------------------------------------
# load / save / append
# ---------------------------------------------------------------------------


class TestLoadSaveAppend:
    def test_load_missing_file_returns_empty(self, tmp_path: Path):
        assert retry_queue.load(tmp_path / "absent.json") == []

    def test_load_empty_file_returns_empty(self, tmp_path: Path):
        p = tmp_path / "q.json"
        p.write_text("", encoding="utf-8")
        assert retry_queue.load(p) == []

    def test_load_corrupt_file_returns_empty(self, tmp_path: Path):
        p = tmp_path / "q.json"
        p.write_text("{not json", encoding="utf-8")
        assert retry_queue.load(p) == []

    def test_load_non_list_returns_empty(self, tmp_path: Path):
        p = tmp_path / "q.json"
        p.write_text(json.dumps({"oops": 1}), encoding="utf-8")
        assert retry_queue.load(p) == []

    def test_load_list_of_dicts_passes_through(self, tmp_path: Path):
        p = tmp_path / "q.json"
        items = [{"goods_no": "A1", "sort_type": "X"}]
        p.write_text(json.dumps(items), encoding="utf-8")
        assert retry_queue.load(p) == items

    def test_save_creates_parent(self, tmp_path: Path):
        p = tmp_path / "deep" / "deeper" / "q.json"
        retry_queue.save(p, [{"a": 1}])
        assert p.is_file()
        assert json.loads(p.read_text()) == [{"a": 1}]

    def test_save_is_atomic_no_tmp_left_on_success(self, tmp_path: Path):
        p = tmp_path / "q.json"
        retry_queue.save(p, [{"a": 1}])
        # No leftover .tmp* siblings.
        leftovers = [
            x for x in tmp_path.iterdir()
            if x.name != p.name and x.suffix in (".tmp", ".part")
        ]
        assert leftovers == []

    def test_append_extends_existing(self, tmp_path: Path):
        p = tmp_path / "q.json"
        e1 = retry_queue.make_entry(
            product_url="x", goods_no="A1", sort_type="X",
            failure_reason="y", last_status="z",
        )
        e2 = retry_queue.make_entry(
            product_url="x", goods_no="A2", sort_type="Y",
            failure_reason="y", last_status="z",
        )
        retry_queue.append(p, e1)
        retry_queue.append(p, e2)
        items = retry_queue.load(p)
        assert len(items) == 2
        assert items[0]["goods_no"] == "A1"
        assert items[1]["goods_no"] == "A2"

    def test_append_creates_file_when_absent(self, tmp_path: Path):
        p = tmp_path / "fresh.json"
        e = retry_queue.make_entry(
            product_url="x", goods_no="A1", sort_type="X",
            failure_reason="y", last_status="z",
        )
        retry_queue.append(p, e)
        assert p.is_file()
        assert len(retry_queue.load(p)) == 1


# ---------------------------------------------------------------------------
# remove_matching
# ---------------------------------------------------------------------------


class TestRemoveMatching:
    def _seed(self, p: Path) -> None:
        items = [
            {"product_url": "u1", "goods_no": "A1", "sort_type": "X"},
            {"product_url": "u1", "goods_no": "A1", "sort_type": "Y"},
            {"product_url": "u2", "goods_no": "A2", "sort_type": "X"},
        ]
        retry_queue.save(p, items)

    def test_filter_by_sort_type(self, tmp_path: Path):
        p = tmp_path / "q.json"
        self._seed(p)
        n = retry_queue.remove_matching(p, sort_type="X")
        assert n == 2
        remaining = retry_queue.load(p)
        assert len(remaining) == 1
        assert remaining[0]["sort_type"] == "Y"

    def test_filter_by_goods_no_and_sort_type(self, tmp_path: Path):
        p = tmp_path / "q.json"
        self._seed(p)
        n = retry_queue.remove_matching(p, goods_no="A1", sort_type="X")
        assert n == 1
        remaining = retry_queue.load(p)
        sorts = sorted(r["sort_type"] for r in remaining)
        assert sorts == ["X", "Y"]
        # The remaining X belongs to A2.
        x_remaining = [r for r in remaining if r["sort_type"] == "X"][0]
        assert x_remaining["goods_no"] == "A2"

    def test_no_match_returns_zero(self, tmp_path: Path):
        p = tmp_path / "q.json"
        self._seed(p)
        n = retry_queue.remove_matching(p, sort_type="ZZZ_NOT_HERE")
        assert n == 0
        assert len(retry_queue.load(p)) == 3

    def test_empty_queue_returns_zero(self, tmp_path: Path):
        p = tmp_path / "q.json"
        n = retry_queue.remove_matching(p, sort_type="X")
        assert n == 0
        # File never created.
        assert not p.is_file()
