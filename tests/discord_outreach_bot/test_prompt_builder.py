"""prompt_builder: state->move mapping and generated-prompt content.

Uses synthetic in-memory Target objects (no files, no network). Asserts the
prompts carry concrete packet data and the standing guardrails, and that
terminal/parked packets steer toward the next target rather than drafting.
"""

import unittest
from pathlib import Path

import prompt_builder as pb
from status_reader import Target

_DUMMY = Path("/tmp/nonexistent_packet")


def _target(slug: str, status: dict) -> Target:
    return Target(slug=slug, path=_DUMMY, status=status,
                  send_log_text=None, present_files=set())


class StateMappingTest(unittest.TestCase):
    def test_scheduled_maps_to_follow_up(self) -> None:
        self.assertEqual(pb.step_for("SCHEDULED").command, "outreach:follow_up")
        self.assertIn("outreach:follow_up", pb.next_action_line("SCHEDULED"))

    def test_sent_maps_to_follow_up(self) -> None:
        # SENT is now first-class: same next-move + gate as SCHEDULED.
        step = pb.step_for("SENT")
        self.assertEqual(step.command, "outreach:follow_up")
        self.assertEqual(step.gate, pb.RED)
        self.assertIn("outreach:follow_up", pb.next_action_line("SENT"))

    def test_sent_next_action_not_degraded(self) -> None:
        # The bug this fixes: SENT used to fall through to UNKNOWN.
        line = pb.next_action_line("SENT")
        self.assertNotIn("could not be determined", line)

    def test_explicit_follow_up_stage_resolves_to_scheduled(self) -> None:
        # follow_up is shared by SCHEDULED + SENT; the canonical state wins.
        self.assertEqual(pb.COMMAND_FROM_STATE["follow_up"], "SCHEDULED")

    def test_red_and_green_gates(self) -> None:
        self.assertEqual(pb.step_for("COLLECTION_READY").gate, pb.RED)
        self.assertEqual(pb.step_for("ANGLE_APPROVED").gate, pb.GREEN)


class ScheduledPromptTest(unittest.TestCase):
    def setUp(self) -> None:
        self.t = _target("snature_x", {
            "brand": "에스네이처", "goods_no": "A000000156230", "state": "SCHEDULED",
            "product_name": "테스트 수분크림",
            "send": {
                "recipient_primary": "mkt@snature.kr",
                "scheduled_send_time": "2026-06-01 11:00 KST",
                "follow_up_due": "2026-06-08",
            },
            "response": None,
        })
        self.p = pb.build_prompt(self.t)

    def test_move_is_follow_up(self) -> None:
        self.assertIn("outreach:follow_up", self.p)

    def test_includes_recipient(self) -> None:
        self.assertIn("mkt@snature.kr", self.p)

    def test_includes_scheduled_time(self) -> None:
        self.assertIn("2026-06-01 11:00 KST", self.p)

    def test_includes_follow_up_due(self) -> None:
        self.assertIn("2026-06-08", self.p)

    def test_includes_response_status(self) -> None:
        self.assertIn("(none recorded)", self.p)

    def test_includes_no_send_guardrail(self) -> None:
        self.assertIn("NEVER sends", self.p)
        # red-gate / approval language present for follow_up
        self.assertIn("Operator approval required", self.p)


class SentPromptTest(unittest.TestCase):
    def setUp(self) -> None:
        self.t = _target("snature_sent", {
            "brand": "에스네이처", "goods_no": "A000000156230", "state": "SENT",
            "product_name": "테스트 수분크림",
            "send": {
                "status": "SENT",
                "recipient_primary": "mkt@snature.kr",
                "sent_time": "2026-06-01 11:00 KST",
                "follow_up_due": "2026-06-08",
            },
            "response": None,
        })
        self.p = pb.build_prompt(self.t)

    def test_move_is_follow_up(self) -> None:
        self.assertIn("outreach:follow_up", self.p)

    def test_not_degraded(self) -> None:
        self.assertNotIn("could not be determined", self.p)

    def test_includes_sent_time_and_recipient(self) -> None:
        self.assertIn("2026-06-01 11:00 KST", self.p)
        self.assertIn("mkt@snature.kr", self.p)

    def test_includes_follow_up_due(self) -> None:
        self.assertIn("2026-06-08", self.p)

    def test_follow_up_guardrail_language(self) -> None:
        # red-gate approval language + no-send guardrail present for SENT
        self.assertIn("Operator approval required", self.p)
        self.assertIn("NEVER sends", self.p)
        self.assertIn("NEW", self.p)  # re-send / alt-channel needs NEW approval


class ParkedPromptTest(unittest.TestCase):
    def setUp(self) -> None:
        self.t = _target("laundryou_x", {
            "brand": "런드리유", "goods_no": "A000000190417", "state": "PARKED",
            "parked": {
                "reason": "claim-risk gate failed — skin-reaction-dominated reservation pool.",
                "reactivation_condition": "only if a non-skin-reaction angle is later validated.",
            },
        })
        self.p = pb.build_prompt(self.t)

    def test_does_not_suggest_drafting(self) -> None:
        self.assertNotIn("outreach:draft_packet", self.p)
        self.assertIn("Do NOT reopen or draft", self.p)

    def test_suggests_select_next_target(self) -> None:
        self.assertIn("candidate_check", self.p)
        self.assertIn("NEXT target", self.p)

    def test_includes_park_reason(self) -> None:
        self.assertIn("claim-risk gate failed", self.p)


class CollectionReadyPromptTest(unittest.TestCase):
    def setUp(self) -> None:
        self.t = _target("collect_x", {
            "brand": "테스트", "goods_no": "A1", "state": "COLLECTION_READY",
            "collection_plan": {
                "proposed_command": "PYTHONPATH=. python3 scripts/ingest_oliveyoung_browser_phase1.py ...",
                "preflight_required": ["verify HEAD", "CDP reachable at 127.0.0.1:9222"],
            },
        })
        self.p = pb.build_prompt(self.t)

    def test_red_gate_warning(self) -> None:
        self.assertIn(pb.RED, self.p)
        self.assertIn("Operator approval required", self.p)
        self.assertIn("LIVE collection", self.p)

    def test_preflight_and_collection_caution(self) -> None:
        self.assertIn("pre-flight", self.p.lower())
        self.assertIn("127.0.0.1:9222", self.p)
        self.assertIn("DO NOT run unless", self.p)


class NewCandidatePromptTest(unittest.TestCase):
    def setUp(self) -> None:
        self.p = pb.build_new_candidate_prompt(
            brand="가가밀라노", product="테스트 클렌저 100ml", goods_no="A000000999999")

    def test_includes_identity(self) -> None:
        self.assertIn("가가밀라노", self.p)
        self.assertIn("테스트 클렌저 100ml", self.p)
        self.assertIn("A000000999999", self.p)

    def test_move_is_candidate_check(self) -> None:
        self.assertIn("outreach:candidate_check", self.p)

    def test_is_read_only_no_folder(self) -> None:
        self.assertIn("NO packet folder exists yet", self.p)
        self.assertIn("does NOT create any files", self.p)

    def test_carries_guardrails(self) -> None:
        self.assertIn("NEVER sends", self.p)

    def test_optional_slug_placeholder(self) -> None:
        self.assertIn("operator chooses", self.p)  # no slug given
        p2 = pb.build_new_candidate_prompt("B", "P", "G", slug="b_p_v1")
        self.assertIn("b_p_v1", p2)


class StageMismatchTest(unittest.TestCase):
    def test_explicit_stage_mismatch_warns(self) -> None:
        t = _target("snature_x", {"brand": "에스네이처", "goods_no": "A1",
                                  "state": "SCHEDULED", "send": {}})
        p = pb.build_prompt(t, stage="collect_execute")
        self.assertIn("NOTE: requested stage", p)
        self.assertIn("Confirm this is intentional", p)

    def test_unknown_stage_errors(self) -> None:
        t = _target("x", {"state": "SCHEDULED"})
        p = pb.build_prompt(t, stage="not_a_real_stage")
        self.assertIn("unknown stage", p)


if __name__ == "__main__":
    unittest.main()
