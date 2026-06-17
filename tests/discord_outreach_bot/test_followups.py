"""followups: due-today / overdue / upcoming classification.

Synthetic packets give deterministic date math against a fixed `today`. A
second, tolerant block checks the real packets IF they reflect the expected
due dates — it never writes and skips gracefully if the data has moved on.
"""

import datetime as dt
import json
import tempfile
import unittest
from pathlib import Path

import followups as fu
import status_reader as sr

TODAY = dt.date(2026, 6, 8)


def _write_status(targets: Path, slug: str, brand: str, due: str) -> None:
    d = targets / slug
    d.mkdir(parents=True, exist_ok=True)
    (d / "status.json").write_text(json.dumps({
        "brand": brand, "goods_no": "A1", "slug": slug, "state": "SCHEDULED",
        "send": {"recipient_primary": f"{slug}@test.kr", "follow_up_due": due},
        "response": None,
    }), encoding="utf-8")


class SyntheticFollowupTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.targets = Path(self._tmp.name)
        _write_status(self.targets, "overdue_v1", "오버듀", "2026-06-05")    # -3
        _write_status(self.targets, "today_v1", "투데이", "2026-06-08")      # 0
        _write_status(self.targets, "upcoming_v1", "업커밍", "2026-06-10")   # +2

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_classification_buckets(self) -> None:
        rows = {r.slug: r for r in fu.collect_followups(TODAY, self.targets)}
        self.assertEqual(rows["overdue_v1"].days_remaining, -3)
        self.assertEqual(rows["today_v1"].days_remaining, 0)
        self.assertEqual(rows["upcoming_v1"].days_remaining, 2)

    def test_format_labels(self) -> None:
        rows = fu.collect_followups(TODAY, self.targets)
        out = fu.format_followups(rows, TODAY)
        self.assertIn("OVERDUE by 3d", out)
        self.assertIn("DUE TODAY", out)
        self.assertIn("in 2d", out)
        # sorted soonest-due first
        self.assertLess(out.index("오버듀"), out.index("업커밍"))


class RealDataTolerantTest(unittest.TestCase):
    """Read-only checks against the live packets; skip if data has moved."""

    def _real(self, slug: str):
        return sr.get_target(slug, None)

    def test_snature_whipd_due_2026_06_08(self) -> None:
        for slug in ("snature_aqua_squalane_cream_v1", "whipd_vegan_pack_cleanser_v1"):
            t = self._real(slug)
            if t is None or t.follow_up_due != "2026-06-08":
                self.skipTest(f"{slug} not at the expected due date")
            rows = {r.slug: r for r in fu.collect_followups(dt.date(2026, 6, 8))}
            self.assertIn(slug, rows)
            self.assertEqual(rows[slug].days_remaining, 0)  # due today

    def test_menokin_overdue_if_present(self) -> None:
        t = self._real("menokin_quick_bubble_mask_v2")
        due = fu._parse_date(t.follow_up_due) if t else None
        if due is None:
            self.skipTest("menokin v2 has no parseable follow-up date")
        # at a today strictly after the due date, it must read as overdue
        rows = {r.slug: r for r in fu.collect_followups(due + dt.timedelta(days=1))}
        self.assertLess(rows["menokin_quick_bubble_mask_v2"].days_remaining, 0)


if __name__ == "__main__":
    unittest.main()
