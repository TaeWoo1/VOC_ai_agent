"""status_reader: discovery + status.json + legacy send_log.md parsing.

All filesystem use is confined to a tempfile dir. Nothing under
outputs/outreach/new_targets/ is read or written by these tests.
"""

import json
import tempfile
import unittest
from pathlib import Path

import status_reader as sr


def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


class StatusReaderTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.targets = Path(self._tmp.name)

        # A: status.json-based packet
        _write(
            self.targets / "alpha_v1" / "status.json",
            json.dumps({
                "brand": "알파 (Alpha)",
                "goods_no": "A000000000001",
                "slug": "alpha_v1",
                "state": "SCHEDULED",
                "send": {"recipient_primary": "mkt@alpha.kr",
                         "follow_up_due": "2026-06-08"},
                "response": None,
            }),
        )
        # B: legacy send_log.md only — table-format brand + follow_up_due
        _write(
            self.targets / "bravo_v1" / "send_log.md",
            "# Send Log — 브라보 마스크\n\n"
            "| status | **SCHEDULED** |\n"
            "| brand / product | 브라보 / 브라보 클렌징 마스크 |\n"
            "| follow_up_due | **2026-06-05** |\n",
        )
        # C: legacy send_log.md only — prose-format follow-up due
        _write(
            self.targets / "charlie_v1" / "send_log.md",
            "# Send log — 찰리 토너\n\n"
            "## Send status\n"
            "- **SCHEDULED** — operator scheduled.\n"
            "- Follow-up due: 2026.06.08\n",
        )

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_discover_targets(self) -> None:
        targets = sr.discover_targets(self.targets)
        self.assertEqual([t.slug for t in targets], ["alpha_v1", "bravo_v1", "charlie_v1"])

    def test_load_status_json_target(self) -> None:
        t = sr.get_target("alpha_v1", self.targets)
        self.assertIsNotNone(t)
        self.assertTrue(t.has_status_json)
        self.assertEqual(t.state, "SCHEDULED")
        self.assertEqual(t.brand, "알파 (Alpha)")
        self.assertEqual(t.recipient, "mkt@alpha.kr")
        self.assertEqual(t.follow_up_due, "2026-06-08")

    def test_legacy_send_log_only_target(self) -> None:
        t = sr.get_target("bravo_v1", self.targets)
        self.assertIsNotNone(t)
        self.assertFalse(t.has_status_json)
        # state inferred from the send_log body
        self.assertEqual(t.state, "SCHEDULED")

    def test_brand_fallback_from_send_log(self) -> None:
        # table-format "| brand / product | 브라보 / ... |"
        bravo = sr.get_target("bravo_v1", self.targets)
        self.assertEqual(bravo.brand, "브라보")
        # heading-format "# Send log — 찰리 토너"
        charlie = sr.get_target("charlie_v1", self.targets)
        self.assertEqual(charlie.brand, "찰리 토너")

    def test_follow_up_due_table_and_prose(self) -> None:
        bravo = sr.get_target("bravo_v1", self.targets)   # table cell, dashes
        self.assertEqual(bravo.follow_up_due, "2026-06-05")
        charlie = sr.get_target("charlie_v1", self.targets)  # prose, dots
        self.assertEqual(charlie.follow_up_due, "2026-06-08")

    def test_missing_target_returns_none(self) -> None:
        self.assertIsNone(sr.get_target("does_not_exist", self.targets))


if __name__ == "__main__":
    unittest.main()
