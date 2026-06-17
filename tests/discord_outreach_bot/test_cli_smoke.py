"""CLI smoke: each command exits 0 against the real (read-only) packets.

Runs the CLI in a subprocess from the repo root. No flags that send, collect,
render, or write are exercised — these are all read-only commands. Skips
gracefully if the reference packet is absent.
"""

import os
import subprocess
import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
CLI = REPO_ROOT / "ops" / "discord_outreach_bot" / "cli.py"
SLUG = "snature_aqua_squalane_cream_v1"
PACKET = REPO_ROOT / "outputs" / "outreach" / "new_targets" / SLUG


def _run(*args: str) -> subprocess.CompletedProcess:
    env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
    return subprocess.run(
        [sys.executable, str(CLI), *args],
        cwd=str(REPO_ROOT), capture_output=True, text=True,
        encoding="utf-8", env=env, timeout=60,
    )


class CliSmokeTest(unittest.TestCase):
    def setUp(self) -> None:
        if not PACKET.is_dir():
            self.skipTest(f"reference packet {SLUG} not present")

    def test_list_targets_exit_0(self) -> None:
        r = _run("list_targets")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("outreach target", r.stdout)

    def test_show_status_exit_0(self) -> None:
        r = _run("show_status", SLUG)
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_next_action_exit_0(self) -> None:
        r = _run("next_action", SLUG)
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_build_prompt_exit_0(self) -> None:
        r = _run("build_prompt", SLUG)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("outreach_packet workflow", r.stdout)

    def test_validate_packet_exit_0(self) -> None:
        # snature has all files required for its state -> exit 0
        r = _run("validate_packet", SLUG)
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_sent_next_action_not_degraded(self) -> None:
        # If snature is recorded SENT, show_status/next_action must render a
        # real next move, not the old "state could not be determined" line.
        status = _run("show_status", SLUG).stdout + _run("next_action", SLUG).stdout
        if "SENT" not in status:
            self.skipTest("snature not in SENT state")
        self.assertNotIn("could not be determined", status)
        self.assertIn("outreach:follow_up", status)


if __name__ == "__main__":
    unittest.main()
