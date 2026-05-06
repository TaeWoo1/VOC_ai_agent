"""Golden-fixture tests for the Phase 1 deterministic metrics layer.

The fixture ``tests/fixtures/phase1_reports/oy_browser_20rows.json`` is a
frozen export of the 20 OliveYoung ``browser_scrape`` rows as of 2026-04-22,
AFTER profile-code curation, option-dictionary curation, and the final
data-refresh step documented in the Phase 1 pivot plan. It is the canonical
contract for what the metrics layer must produce on real data.

Edge cases (empty input, missing rating, missing date, tie-breaking, mixed
channels) are covered with small synthetic inputs rather than extending the
fixture, so the fixture stays a pure snapshot of reality.
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import pytest

from src.voc.reporting.phase1.metrics import compute_metrics
from src.voc.reporting.phase1.schema import DeterministicMetrics


FIXTURE = (
    Path(__file__).parents[2]
    / "fixtures"
    / "phase1_reports"
    / "oy_browser_20rows.json"
)


@pytest.fixture(scope="module")
def rows() -> list[dict]:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def metrics(rows: list[dict]) -> DeterministicMetrics:
    return compute_metrics(rows)


# ---------------------------------------------------------------------------
# Golden fixture — exact numbers, frozen
# ---------------------------------------------------------------------------


class TestGoldenFixture:
    def test_fixture_is_intact(self, rows: list[dict]) -> None:
        """If this fails, someone re-exported the fixture — review why."""
        assert len(rows) == 20
        assert {r["source_channel"] for r in rows} == {"oliveyoung"}
        assert {r["source_method"] for r in rows} == {"browser_scrape"}

    def test_top_level_counts(self, metrics: DeterministicMetrics) -> None:
        assert metrics.total_reviews == 20
        assert metrics.n_products == 2
        assert metrics.channels == {"oliveyoung": 20}
        assert metrics.languages == {"ko": 20}

    def test_rating_overall(self, metrics: DeterministicMetrics) -> None:
        r = metrics.rating
        assert r.n == 20
        assert r.missing == 0
        assert r.avg_raw == 4.85
        assert r.distribution_raw == {4: 3, 5: 17}

    def test_time_window(self, metrics: DeterministicMetrics) -> None:
        tw = metrics.time_window
        assert tw.start_date == date(2026, 3, 26)
        assert tw.end_date == date(2026, 4, 20)
        assert tw.days_span == 26
        assert tw.missing_dates == 0

    def test_per_product_order_and_split(self, metrics: DeterministicMetrics) -> None:
        """Dominant product must come first; minority product second."""
        assert [p.product_id for p in metrics.per_product] == [
            "A000000238828",
            "A000000205145",
        ]
        a, b = metrics.per_product
        assert a.n_reviews == 18
        assert a.pct_of_total == 0.9
        assert b.n_reviews == 2
        assert b.pct_of_total == 0.1

    def test_per_product_shade_distribution(self, metrics: DeterministicMetrics) -> None:
        a, b = metrics.per_product
        # Expected ordering: n desc, then shade asc for tie-break.
        #   n=5: 베어리, 샤이
        #   n=3: 소프티
        #   n=2: 레이지, 퓨리티
        #   n=1: NEW S/S 팬시
        assert [(s.shade, s.n) for s in a.shades] == [
            ("베어리", 5),
            ("샤이", 5),
            ("소프티", 3),
            ("레이지", 2),
            ("퓨리티", 2),
            ("NEW S/S 팬시", 1),
        ]
        assert [(s.shade, s.n) for s in b.shades] == [("베어리", 2)]

    def test_per_product_rating(self, metrics: DeterministicMetrics) -> None:
        """Both products are high-rated; asserting dominant's distribution
        protects against a bug that mis-groups rows by product."""
        a = metrics.per_product[0]
        assert a.rating.n == 18
        # 18 rows sum must match: dominant has 3 fours + (18-3)=15 fives.
        # 4×3 + 5×15 = 87 → avg 4.8333...
        assert a.rating.avg_raw == pytest.approx(4.8333, abs=1e-4)
        assert a.rating.distribution_raw == {4: 3, 5: 15}

    def test_dominant_product(self, metrics: DeterministicMetrics) -> None:
        dp = metrics.dominant_product
        assert dp is not None
        assert dp.product_id == "A000000238828"
        assert dp.channel == "oliveyoung"
        assert dp.n_reviews == 18
        assert dp.pct_of_total == 0.9

    def test_segments_normalized_skin_type(self, metrics: DeterministicMetrics) -> None:
        # Derived from the curated profile-code seed + DictionarySegmentNormalizer.
        assert metrics.segments.normalized_skin_type == {
            "combination": 8,
            "dry": 5,
            "oily": 2,
            "sensitive": 3,
            "unknown": 2,
        }
        # age_group is not exposed by OY → enrich sets unknown for every row
        assert metrics.segments.normalized_age_group == {"unknown": 20}

    def test_channel_signals(self, metrics: DeterministicMetrics) -> None:
        cs = metrics.channel_signals
        assert cs.photo_attached is None  # no coupang rows in fixture
        assert cs.oy_has_photo is not None
        assert (cs.oy_has_photo.true, cs.oy_has_photo.false, cs.oy_has_photo.missing) \
            == (10, 10, 0)
        assert cs.oy_review_type == {"GIFT": 1, "NORMAL": 13, "OFFLINE": 6}
        assert cs.oy_is_repurchase is not None
        # The operational finding: every API flag is False for these 20 rows.
        assert (cs.oy_is_repurchase.true, cs.oy_is_repurchase.false) == (0, 20)

    def test_roundtrips_through_pydantic(self, metrics: DeterministicMetrics) -> None:
        """Schema stability: serialize → parse → compare. Catches accidental
        ``Any``-typed fields that silently accept garbage."""
        payload = metrics.model_dump(mode="json")
        restored = DeterministicMetrics.model_validate(payload)
        assert restored == metrics


# ---------------------------------------------------------------------------
# Edge cases — small synthetic inputs
# ---------------------------------------------------------------------------


class TestEdgeCases:
    def test_empty_input(self) -> None:
        m = compute_metrics([])
        assert m.total_reviews == 0
        assert m.n_products == 0
        assert m.channels == {}
        assert m.languages == {}
        assert m.rating.n == 0
        assert m.rating.missing == 0
        assert m.rating.avg_raw is None
        assert m.rating.distribution_raw == {}
        assert m.time_window.start_date is None
        assert m.time_window.days_span is None
        assert m.per_product == []
        assert m.dominant_product is None

    def test_all_ratings_missing(self) -> None:
        rows = [
            {"review_id": "r1", "source_channel": "coupang",
             "rating_raw": None, "review_date": "2026-04-01"},
            {"review_id": "r2", "source_channel": "coupang",
             "rating_raw": None, "review_date": "2026-04-02"},
        ]
        m = compute_metrics(rows)
        assert m.rating.n == 0
        assert m.rating.missing == 2
        assert m.rating.avg_raw is None

    def test_missing_dates(self) -> None:
        rows = [
            {"review_id": "r1", "rating_raw": 5, "review_date": "2026-04-01"},
            {"review_id": "r2", "rating_raw": 5, "review_date": None},
            {"review_id": "r3", "rating_raw": 5, "review_date": "not-a-date"},
        ]
        m = compute_metrics(rows)
        assert m.time_window.start_date == date(2026, 4, 1)
        assert m.time_window.end_date == date(2026, 4, 1)
        assert m.time_window.days_span == 1
        assert m.time_window.missing_dates == 2

    def test_rows_without_product_id_are_dropped_from_per_product(self) -> None:
        rows = [
            {"review_id": "r1", "source_channel": "coupang",
             "product_external_id": "p1", "rating_raw": 5},
            {"review_id": "r2", "source_channel": "coupang",
             "product_external_id": None, "rating_raw": 4},
        ]
        m = compute_metrics(rows)
        assert m.total_reviews == 2
        assert m.n_products == 1
        assert m.per_product[0].product_id == "p1"
        assert m.per_product[0].n_reviews == 1

    def test_dominant_product_tie_breaks_by_id(self) -> None:
        """n_reviews tie → product_id ascending wins."""
        rows = [
            {"review_id": "r1", "source_channel": "coupang",
             "product_external_id": "zzz", "rating_raw": 5},
            {"review_id": "r2", "source_channel": "coupang",
             "product_external_id": "aaa", "rating_raw": 5},
        ]
        m = compute_metrics(rows)
        assert m.dominant_product is not None
        assert m.dominant_product.product_id == "aaa"

    def test_mixed_channels_both_photo_buckets_populated(self) -> None:
        rows = [
            {"review_id": "c1", "source_channel": "coupang",
             "rating_raw": 5, "channel_meta": {"photo_attached": True}},
            {"review_id": "c2", "source_channel": "coupang",
             "rating_raw": 4, "channel_meta": {"photo_attached": False}},
            {"review_id": "o1", "source_channel": "oliveyoung",
             "rating_raw": 5, "raw_metadata": {"oy_has_photo": True}},
        ]
        m = compute_metrics(rows)
        assert m.channels == {"coupang": 2, "oliveyoung": 1}
        assert m.channel_signals.photo_attached is not None
        assert (m.channel_signals.photo_attached.true,
                m.channel_signals.photo_attached.false) == (1, 1)
        assert m.channel_signals.oy_has_photo is not None
        assert m.channel_signals.oy_has_photo.true == 1

    def test_channel_signals_none_when_channel_absent(self) -> None:
        rows = [
            {"review_id": "c1", "source_channel": "coupang",
             "rating_raw": 5, "channel_meta": {"photo_attached": True}},
        ]
        m = compute_metrics(rows)
        assert m.channel_signals.oy_has_photo is None
        assert m.channel_signals.oy_review_type is None
        assert m.channel_signals.oy_is_repurchase is None
