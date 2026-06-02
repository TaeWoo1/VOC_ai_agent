"""Tests for scripts/audit_tone_mismatch_proposals.py (dry-run prototype).

Scope: helper-function unit tests + dry-run artifact shape check using
a fake DB. Does not call any LLM API and does not require any SDK.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import sqlite3
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPT_PATH = REPO_ROOT / "scripts" / "audit_tone_mismatch_proposals.py"
BATCH_PATH = REPO_ROOT / "eval_data" / "phase1" / "tone_mismatch_audit" / "batch_v1.json"
RUBRIC_PATH = REPO_ROOT / "docs" / "phase2_tone_mismatch_rubric.md"


def _load_script_module():
    """Load the script as a module without requiring scripts/ to be a package."""
    spec = importlib.util.spec_from_file_location(
        "audit_tone_mismatch_proposals", SCRIPT_PATH,
    )
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    sys.modules["audit_tone_mismatch_proposals"] = mod
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def audit_mod():
    return _load_script_module()


class TestFixtureShape:
    def test_fixture_loads(self):
        assert BATCH_PATH.is_file(), f"fixture missing at {BATCH_PATH}"
        batch = json.loads(BATCH_PATH.read_text(encoding="utf-8"))
        assert batch["version"] == "1.0"
        assert isinstance(batch["rows"], list)
        assert len(batch["rows"]) == 12

    def test_fixture_bucket_counts(self):
        batch = json.loads(BATCH_PATH.read_text(encoding="utf-8"))
        buckets = [r["bucket"] for r in batch["rows"]]
        assert buckets.count("FN_anchor") == 4
        assert buckets.count("TP_anchor") == 3
        # 5 controls total, across multiple control sub-buckets
        control_count = sum(1 for b in buckets if b.startswith("control_"))
        assert control_count == 5

    def test_fixture_no_duplicated_text(self):
        """Fixture must only carry review_ids + buckets, not review bodies."""
        batch = json.loads(BATCH_PATH.read_text(encoding="utf-8"))
        for r in batch["rows"]:
            assert set(r.keys()) == {"review_id", "bucket"}

    def test_fixture_no_duplicate_ids(self):
        batch = json.loads(BATCH_PATH.read_text(encoding="utf-8"))
        ids = [r["review_id"] for r in batch["rows"]]
        assert len(ids) == len(set(ids))

    def test_load_fixture_function(self, audit_mod):
        """Script-side loader validates buckets and uniqueness."""
        rows = audit_mod.load_fixture(BATCH_PATH)
        assert len(rows) == 12
        for r in rows:
            assert r["bucket"] in audit_mod.VALID_BUCKETS

    def test_load_fixture_rejects_unknown_bucket(self, audit_mod, tmp_path):
        bad = tmp_path / "bad.json"
        bad.write_text(json.dumps({
            "version": "1.0",
            "rows": [{"review_id": "abc", "bucket": "not_a_real_bucket"}],
        }))
        with pytest.raises(ValueError, match="invalid bucket"):
            audit_mod.load_fixture(bad)

    def test_load_fixture_rejects_duplicate_ids(self, audit_mod, tmp_path):
        bad = tmp_path / "dup.json"
        bad.write_text(json.dumps({
            "version": "1.0",
            "rows": [
                {"review_id": "abc", "bucket": "FN_anchor"},
                {"review_id": "abc", "bucket": "TP_anchor"},
            ],
        }))
        with pytest.raises(ValueError, match="duplicate review_id"):
            audit_mod.load_fixture(bad)


class TestRubricExtraction:
    def test_rubric_file_present(self):
        assert RUBRIC_PATH.is_file()

    def test_extract_returns_body(self, audit_mod):
        text = RUBRIC_PATH.read_text(encoding="utf-8")
        body = audit_mod.extract_rubric_sections(text)
        assert body
        # §1 section header should be at the top (or very near it)
        assert body.startswith("## 1.")

    def test_extract_excludes_appendices(self, audit_mod):
        text = RUBRIC_PATH.read_text(encoding="utf-8")
        body = audit_mod.extract_rubric_sections(text)
        # Appendix markers must NOT appear in the extracted body
        assert "## 부록 A" not in body
        assert "## 부록 B" not in body
        assert "## 부록 C" not in body

    def test_extract_includes_sections_1_through_9(self, audit_mod):
        text = RUBRIC_PATH.read_text(encoding="utf-8")
        body = audit_mod.extract_rubric_sections(text)
        # All body sections should be present
        for marker in ("## 1.", "## 2.", "## 3.", "## 4.",
                       "## 5.", "## 6.", "## 7.", "## 8.", "## 9."):
            assert marker in body, f"missing section {marker}"

    def test_extract_raises_on_missing_start(self, audit_mod):
        with pytest.raises(ValueError, match="§1"):
            audit_mod.extract_rubric_sections("## 부록 A — nothing before\n")

    def test_extract_raises_on_missing_appendix(self, audit_mod):
        with pytest.raises(ValueError, match="부록"):
            audit_mod.extract_rubric_sections("## 1. Body only\n\nMore text\n")


class TestDryRunOutputShape:
    """End-to-end dry-run execution against a synthetic in-memory DB-like
    input — verifies the artifact structure without needing real DB data.
    """

    def test_build_dry_run_records_shape(self, audit_mod):
        fixture_rows = [
            {"review_id": "rid_a", "bucket": "FN_anchor"},
            {"review_id": "rid_b", "bucket": "control_positive_fit"},
        ]
        rows_by_id = {
            "rid_a": {"review_id": "rid_a", "text": "가을 웜인 저에게는",
                      "rating_raw": 3.0},
            "rid_b": {"review_id": "rid_b", "text": "쿨톤인 나한테도 잘 맞아요",
                      "rating_raw": 5.0},
        }
        golden = {"rid_a": {"concerns": ["tone_mismatch"]}}
        sha = hashlib.sha256(b"fake_rubric_body").hexdigest()
        out = audit_mod.build_dry_run_records(
            fixture_rows=fixture_rows,
            rows_by_id=rows_by_id,
            golden_labels=golden,
            rubric_sha256=sha,
        )
        assert len(out) == 2

        # Required fields per row (existing_concerns now lives under a
        # more explicit human-context-only key)
        for record in out:
            for field in ("review_id", "bucket", "rating", "text",
                          "existing_concerns_human_context_only",
                          "prompt_version",
                          "rubric_sha256", "user_input_payload"):
                assert field in record, f"missing field {field}"
            assert record["prompt_version"] == audit_mod.PROMPT_VERSION
            assert record["rubric_sha256"] == sha

        # Row-level human-context metadata still carries golden concerns
        assert out[0]["existing_concerns_human_context_only"] == ["tone_mismatch"]
        assert out[1]["existing_concerns_human_context_only"] == []

    def test_user_input_payload_never_contains_existing_concerns(self, audit_mod):
        """CRITICAL anti-leak test: the payload sent to the LLM must not
        carry golden labels for the row being classified. Including them
        (even filtered) reveals the answer via presence/absence of the
        target class."""
        fixture_rows = [
            {"review_id": "rid_a", "bucket": "FN_anchor"},
            {"review_id": "rid_b", "bucket": "control_positive_fit"},
        ]
        rows_by_id = {
            "rid_a": {"review_id": "rid_a", "text": "...", "rating_raw": 3.0},
            "rid_b": {"review_id": "rid_b", "text": "...", "rating_raw": 5.0},
        }
        golden = {
            "rid_a": {"concerns": ["tone_mismatch", "pigment_complaint"]},
            "rid_b": {"concerns": ["packaging_complaint"]},
        }
        out = audit_mod.build_dry_run_records(
            fixture_rows=fixture_rows,
            rows_by_id=rows_by_id,
            golden_labels=golden,
            rubric_sha256="x" * 64,
        )
        for record in out:
            payload = record["user_input_payload"]
            # Hard anti-leak assertions
            assert "existing_concerns" not in payload, \
                f"LEAK: 'existing_concerns' in user_input_payload for {record['review_id']}"
            assert "concerns" not in payload, \
                f"LEAK: 'concerns' in user_input_payload for {record['review_id']}"
            assert "tone_mismatch" not in str(payload), \
                f"LEAK: target class appears in payload for {record['review_id']}"
            # Payload keys should be exactly the intended three
            assert set(payload.keys()) == {"review_id", "text", "rating"}

    def test_compose_user_payload_signature_excludes_existing_concerns(
        self, audit_mod,
    ):
        """Direct test of the helper: no existing_concerns param and no
        leakage in output."""
        payload = audit_mod.compose_user_payload(
            review_id="x", text="sample", rating=4.0,
        )
        assert set(payload.keys()) == {"review_id", "text", "rating"}
        assert "existing_concerns" not in payload
        # And the function signature should not accept existing_concerns
        import inspect
        sig = inspect.signature(audit_mod.compose_user_payload)
        assert "existing_concerns" not in sig.parameters

    def test_system_prompt_includes_rubric_and_schema(self, audit_mod):
        rubric_stub = "## 1. test\n\n## 9. 끝"
        prompt = audit_mod.compose_system_prompt(rubric_stub)
        assert rubric_stub in prompt
        assert "tone_mismatch" in prompt
        assert "borderline_yes" in prompt
        assert "evidence_phrase" in prompt
        # Output schema must reference all three gates
        assert "q1_self_tone" in prompt
        assert "q2_mismatch" in prompt
        assert "q3_framing" in prompt

    def test_system_prompt_clarifies_yes_low_confidence(self, audit_mod):
        """Rule 1 must distinguish 'verdict=NO' from 'yes/low-confidence'
        so the LLM doesn't collapse the borderline signal."""
        prompt = audit_mod.compose_system_prompt("## 1. stub\n")
        # Key phrase that makes the distinction explicit
        assert "Stop ONLY at a verdict of NO" in prompt
        assert "yes/low-confidence" in prompt
        # The clarification must connect low confidence to borderline_yes
        assert "borderline_yes" in prompt
        # And must explicitly forbid the collapse
        assert "do NOT collapse" in prompt or "do not collapse" in prompt.lower()

    def test_system_prompt_contains_borderline_yes_trigger(self, audit_mod):
        """The borderline_yes trigger condition from §9 must be inlined
        in STRICT RULES for prominence — LLMs don't reliably cross-reference."""
        prompt = audit_mod.compose_system_prompt("## 1. stub\n")
        # All three conjunctive conditions must appear near each other
        assert "ALL THREE" in prompt
        assert "Q1 verdict=yes AND confidence=high" in prompt
        assert "Q2/Q3" in prompt
        assert "confidence=low" in prompt
        assert "no gate contradicts" in prompt

    def test_system_prompt_requires_all_fields_emitted(self, audit_mod):
        """JSON robustness: every schema field must be emitted, null for
        empty — prevents the most common validation failure."""
        prompt = audit_mod.compose_system_prompt("## 1. stub\n")
        assert "Always emit every schema field" in prompt
        assert "null" in prompt
        assert "Never omit a field" in prompt

    def test_system_prompt_contains_rule_9_no_evidence_contract(self, audit_mod):
        """v4 Rule 9: NO / n/a verdicts must use confidence=absent +
        evidence_phrase=null; no semantic placeholders."""
        prompt = audit_mod.compose_system_prompt("## 1. stub\n")
        # The rule itself
        assert "verdict` is `no`" in prompt or "`verdict` is `no`" in prompt
        assert "n/a" in prompt
        assert 'confidence` to `"absent"' in prompt
        assert "`evidence_phrase` to `null`" in prompt
        # The explicit placeholder-prohibition — the exact strings that
        # caused the v3 row-9 and row-1 failures
        assert '"없음"' in prompt
        assert '"..."' in prompt
        # And the explanation of WHY
        assert "no positive evidence to cite" in prompt or \
               "there is no phrase to cite" in prompt

    def test_prompt_version_is_v4(self, audit_mod):
        """Contract change → version bump."""
        assert audit_mod.PROMPT_VERSION == "tone_mismatch_v4"

    def test_live_mode_requires_env_var(
        self, audit_mod, capsys, monkeypatch, tmp_path: Path,
    ):
        """--live without OPENAI_API_KEY anywhere (shell OR .env) must
        fail fast with no partial output.

        Important: point REPO_ROOT at a tmp dir (no .env there) so the
        .env auto-loader can't repopulate the env var from the real
        repo-root .env. Also defensively patch call_llm to raise — if
        the env check leaks and any API path is hit, this test must NOT
        make real API calls."""
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        monkeypatch.setattr(audit_mod, "REPO_ROOT", tmp_path)

        def explode_if_called(**kwargs):
            raise AssertionError(
                "call_llm invoked — env check must have failed before this"
            )
        monkeypatch.setattr(audit_mod, "call_llm", explode_if_called)

        rc = audit_mod.main(["--live"])
        assert rc == 2
        captured = capsys.readouterr()
        assert "OPENAI_API_KEY" in captured.err
        assert "No partial output" in captured.err or "no partial" in captured.err.lower()

    def test_no_top_level_sdk_import(self):
        """SDK must be lazy-imported inside call_llm, not at module top level.
        Protects dry-run and tests from requiring the SDK on disk."""
        src = SCRIPT_PATH.read_text(encoding="utf-8")
        # Top-level import lines (not inside functions) must not import openai
        for line in src.splitlines():
            stripped = line.lstrip()
            # skip lines inside functions — use indentation heuristic
            if line.startswith("    "):
                continue
            assert not stripped.startswith("import openai"), \
                "openai must be lazy-imported inside call_llm"
            assert not stripped.startswith("from openai"), \
                "openai must be lazy-imported inside call_llm"
            assert not stripped.startswith("import anthropic")
            assert not stripped.startswith("from anthropic")


class TestDryRunEndToEndWithTempDB:
    """Run main() end-to-end against a tiny synthetic DB. Confirms the
    artifact is written and well-formed without needing the production DB.
    """

    def _make_tmp_db(self, tmp_path: Path, rows: list[dict]) -> Path:
        """Create a minimal phase1_reviews table matching the real schema
        well enough for the repository's ``query()`` to return rows.
        """
        # Re-use the real migration to get the canonical schema
        from src.voc.persistence.migrations import init_db
        db_path = tmp_path / "test_audit.db"
        conn = init_db(str(db_path))
        try:
            cur = conn.cursor()
            for r in rows:
                cur.execute("""
                    INSERT INTO phase1_reviews
                      (review_id, source_channel, source_method, text,
                       content_fingerprint, rating_raw,
                       collected_at, ingested_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    r["review_id"],
                    r.get("channel", "coupang"),
                    r.get("method", "csv"),
                    r["text"],
                    r["review_id"],  # fingerprint placeholder
                    r.get("rating", 3.0),
                    "2026-04-24T00:00:00Z",
                    "2026-04-24T00:00:00Z",
                ))
            conn.commit()
        finally:
            conn.close()
        return db_path

    def _make_fixture(self, tmp_path: Path, rows: list[dict]) -> Path:
        p = tmp_path / "batch.json"
        p.write_text(json.dumps({
            "version": "1.0", "rows": rows,
        }, ensure_ascii=False))
        return p

    def test_dry_run_writes_artifact_with_expected_shape(
        self, audit_mod, tmp_path: Path,
    ):
        # 2-row synthetic batch (one FN, one control)
        synthetic = [
            {"review_id": "synth_fn_1", "text": "웜톤인데 핑크끼가 강해서 아쉬워요",
             "rating": 3.0},
            {"review_id": "synth_ctrl_1", "text": "쿨톤에 잘 맞아요",
             "rating": 5.0},
        ]
        db_path = self._make_tmp_db(tmp_path, synthetic)
        fx_path = self._make_fixture(tmp_path, [
            {"review_id": "synth_fn_1", "bucket": "FN_anchor"},
            {"review_id": "synth_ctrl_1", "bucket": "control_positive_fit"},
        ])
        out_dir = tmp_path / "out"
        # Use an empty golden — script must handle missing gracefully
        empty_golden = tmp_path / "empty_golden.json"
        empty_golden.write_text(json.dumps({"labels": {}}))

        rc = audit_mod.main([
            "--batch", str(fx_path),
            "--rubric", str(RUBRIC_PATH),
            "--golden", str(empty_golden),
            "--db", str(db_path),
            "--output-dir", str(out_dir),
        ])
        assert rc == 0

        artifacts = list(out_dir.glob("dry_run_*.json"))
        assert len(artifacts) == 1, artifacts
        doc = json.loads(artifacts[0].read_text(encoding="utf-8"))

        # Top-level shape
        assert "run_metadata" in doc
        assert "rows" in doc
        meta = doc["run_metadata"]
        assert meta["mode"] == "dry_run"
        assert meta["n_rows"] == 2
        assert meta["prompt_version"] == audit_mod.PROMPT_VERSION
        assert len(meta["rubric_sha256"]) == 64   # sha256 hex digest
        assert meta["rubric_body_chars"] > 100    # real rubric, not stub
        assert "system_prompt" in meta
        assert "tone_mismatch" in meta["system_prompt"]

        # Per-row shape
        rows = doc["rows"]
        assert len(rows) == 2
        for row in rows:
            for field in ("review_id", "bucket", "rating", "text",
                          "existing_concerns_human_context_only",
                          "prompt_version",
                          "rubric_sha256", "user_input_payload"):
                assert field in row, f"row missing {field}"
            # Anti-leak: user_input_payload must NOT carry concerns
            assert "existing_concerns" not in row["user_input_payload"]
            assert "concerns" not in row["user_input_payload"]
            # Every row shares the same rubric hash and prompt version
            assert row["rubric_sha256"] == meta["rubric_sha256"]
            assert row["prompt_version"] == audit_mod.PROMPT_VERSION

    def test_dry_run_rejects_missing_review_ids(
        self, audit_mod, tmp_path: Path,
    ):
        # DB has nothing; fixture asks for a row
        db_path = self._make_tmp_db(tmp_path, rows=[])
        fx_path = self._make_fixture(tmp_path, [
            {"review_id": "doesnt_exist", "bucket": "FN_anchor"},
        ])
        rc = audit_mod.main([
            "--batch", str(fx_path),
            "--rubric", str(RUBRIC_PATH),
            "--golden", str(tmp_path / "no_golden.json"),
            "--db", str(db_path),
            "--output-dir", str(tmp_path / "out"),
        ])
        assert rc == 2


class TestValidateProposal:
    """Validation logic — unit tests of validate_proposal()."""

    VALID_SAMPLE = {
        "review_id": "rid_x",
        "tone_mismatch": "yes",
        "rationale_ko": "체크 1, 2, 3 모두 yes",
        "gate_trace": {
            "q1_self_tone": {"verdict": "yes", "confidence": "high",
                             "evidence_phrase": "웜톤인"},
            "q2_mismatch":  {"verdict": "yes", "confidence": "high",
                             "evidence_phrase": "핑크끼"},
            "q3_framing":   {"verdict": "concern", "confidence": "high",
                             "evidence_phrase": "아쉬워요"},
        },
        "ambiguity_axis": None,
        "adjacent_class_flag": None,
    }

    TEXT_WITH_EVIDENCE = "저는 웜톤인데 핑크끼가 너무 강해서 아쉬워요."

    def test_valid(self, audit_mod):
        raw = json.dumps(self.VALID_SAMPLE, ensure_ascii=False)
        parsed, status, issues = audit_mod.validate_proposal(
            raw=raw, text=self.TEXT_WITH_EVIDENCE,
        )
        assert status == "valid"
        assert issues == []
        assert parsed["tone_mismatch"] == "yes"

    def test_invalid_json(self, audit_mod):
        parsed, status, issues = audit_mod.validate_proposal(
            raw="not json {", text="whatever",
        )
        assert parsed is None
        assert status == "invalid_json"
        assert any("JSON parse" in i for i in issues)

    def test_invalid_schema_missing_field(self, audit_mod):
        bad = dict(self.VALID_SAMPLE)
        del bad["rationale_ko"]
        raw = json.dumps(bad, ensure_ascii=False)
        _, status, issues = audit_mod.validate_proposal(
            raw=raw, text=self.TEXT_WITH_EVIDENCE,
        )
        assert status == "invalid_schema"
        assert any("rationale_ko" in i for i in issues)

    def test_invalid_tone_value(self, audit_mod):
        bad = dict(self.VALID_SAMPLE)
        bad["tone_mismatch"] = "maybe"
        raw = json.dumps(bad, ensure_ascii=False)
        _, status, issues = audit_mod.validate_proposal(
            raw=raw, text=self.TEXT_WITH_EVIDENCE,
        )
        assert status == "invalid_value"
        assert any("maybe" in i for i in issues)

    def test_gate_trace_missing_gate(self, audit_mod):
        bad = json.loads(json.dumps(self.VALID_SAMPLE))
        del bad["gate_trace"]["q2_mismatch"]
        raw = json.dumps(bad, ensure_ascii=False)
        _, status, issues = audit_mod.validate_proposal(
            raw=raw, text=self.TEXT_WITH_EVIDENCE,
        )
        assert status == "invalid_schema"
        assert any("q2_mismatch" in i for i in issues)

    def test_evidence_hallucination(self, audit_mod):
        """Phrase that isn't a substring of the text → flagged."""
        bad = json.loads(json.dumps(self.VALID_SAMPLE))
        bad["gate_trace"]["q1_self_tone"]["evidence_phrase"] = "쿨톤인"  # not in text
        raw = json.dumps(bad, ensure_ascii=False)
        parsed, status, issues = audit_mod.validate_proposal(
            raw=raw, text=self.TEXT_WITH_EVIDENCE,
        )
        assert status == "evidence_hallucination"
        assert parsed is not None
        assert any("q1_self_tone" in i and "substring" in i for i in issues)

    def test_evidence_absent_is_allowed(self, audit_mod):
        """confidence=absent skips the substring check (per Rule 8).

        All three gates need to be absent here because setting only one
        to absent while leaving others with phrases that don't appear in
        the (unrelated) text would still produce hallucination flags on
        the non-absent gates.
        """
        ok = json.loads(json.dumps(self.VALID_SAMPLE))
        for g in ("q1_self_tone", "q2_mismatch", "q3_framing"):
            ok["gate_trace"][g] = {
                "verdict": "no" if g == "q1_self_tone" else "n/a",
                "confidence": "absent",
                "evidence_phrase": None,
            }
        ok["tone_mismatch"] = "no"
        raw = json.dumps(ok, ensure_ascii=False)
        _, status, _ = audit_mod.validate_proposal(
            raw=raw, text="unrelated text",
        )
        assert status == "valid"

    def test_rule_9_rejects_placeholder_on_no_verdict(self, audit_mod):
        """Row-9 regression: verdict=no with confidence=high + placeholder
        evidence_phrase must be flagged even if the phrase happens to
        (not) appear in text."""
        bad = json.loads(json.dumps(self.VALID_SAMPLE))
        # Mirror the actual v3 row-9 failure
        bad["gate_trace"]["q2_mismatch"] = {
            "verdict": "no", "confidence": "high",
            "evidence_phrase": "없음",
        }
        bad["tone_mismatch"] = "no"
        raw = json.dumps(bad, ensure_ascii=False)
        _, status, issues = audit_mod.validate_proposal(
            raw=raw, text=self.TEXT_WITH_EVIDENCE,
        )
        assert status == "evidence_hallucination"
        # Issue message must identify both the rule and the gate
        joined = " ".join(issues)
        assert "Rule 9" in joined
        assert "q2_mismatch" in joined

    def test_rule_9_rejects_dot_placeholder_on_no_verdict(self, audit_mod):
        """Row-1 regression: '...' placeholder on verdict=no must be
        flagged even though it IS a substring of many texts."""
        bad = json.loads(json.dumps(self.VALID_SAMPLE))
        bad["gate_trace"]["q2_mismatch"] = {
            "verdict": "no", "confidence": "high",
            "evidence_phrase": "...",
        }
        bad["tone_mismatch"] = "no"
        raw = json.dumps(bad, ensure_ascii=False)
        # Text explicitly contains "..." so substring check alone would PASS
        text = "저는 웜톤인데 ... 잘 모르겠어요"
        _, status, issues = audit_mod.validate_proposal(raw=raw, text=text)
        assert status == "evidence_hallucination"
        assert any("Rule 9" in i for i in issues)

    def test_rule_9_rejects_empty_string_on_no_verdict(self, audit_mod):
        """Empty string is not null; Rule 9 requires null specifically."""
        bad = json.loads(json.dumps(self.VALID_SAMPLE))
        bad["gate_trace"]["q2_mismatch"] = {
            "verdict": "no", "confidence": "high",
            "evidence_phrase": "",
        }
        bad["tone_mismatch"] = "no"
        raw = json.dumps(bad, ensure_ascii=False)
        _, status, issues = audit_mod.validate_proposal(
            raw=raw, text="anything",
        )
        assert status == "evidence_hallucination"
        assert any("Rule 9" in i for i in issues)

    def test_rule_9_rejects_non_absent_confidence_on_no_verdict(self, audit_mod):
        """Confidence=high/low on a NO verdict is a Rule 9 violation even
        if evidence_phrase is properly null."""
        bad = json.loads(json.dumps(self.VALID_SAMPLE))
        bad["gate_trace"]["q2_mismatch"] = {
            "verdict": "no", "confidence": "high",
            "evidence_phrase": None,
        }
        bad["tone_mismatch"] = "no"
        raw = json.dumps(bad, ensure_ascii=False)
        _, status, issues = audit_mod.validate_proposal(
            raw=raw, text="anything",
        )
        assert status == "evidence_hallucination"
        assert any("confidence" in i and "Rule 9" in i for i in issues)

    def test_rule_9_q3_na_also_covered(self, audit_mod):
        """Q3 verdict=n/a must follow the same no-evidence contract."""
        bad = json.loads(json.dumps(self.VALID_SAMPLE))
        bad["gate_trace"]["q3_framing"] = {
            "verdict": "n/a", "confidence": "high",
            "evidence_phrase": "해당 없음",
        }
        bad["tone_mismatch"] = "no"
        raw = json.dumps(bad, ensure_ascii=False)
        _, status, issues = audit_mod.validate_proposal(
            raw=raw, text="anything",
        )
        assert status == "evidence_hallucination"
        assert any("Rule 9" in i and "q3_framing" in i for i in issues)

    def test_rule_9_q3_resolution_still_allows_evidence(self, audit_mod):
        """Q3 verdict=resolution is NOT covered by Rule 9 — resolution
        describes a reviewer state change that can be cited from text."""
        ok = json.loads(json.dumps(self.VALID_SAMPLE))
        ok["gate_trace"]["q3_framing"] = {
            "verdict": "resolution", "confidence": "high",
            "evidence_phrase": "아쉬워요",  # in TEXT_WITH_EVIDENCE
        }
        ok["tone_mismatch"] = "no"
        raw = json.dumps(ok, ensure_ascii=False)
        _, status, _ = audit_mod.validate_proposal(
            raw=raw, text=self.TEXT_WITH_EVIDENCE,
        )
        assert status == "valid"


class TestLiveModeWithMockedClient:
    """End-to-end live-mode tests with the LLM call mocked at module level.

    No network, no real OpenAI call. The real call_llm is replaced with
    a deterministic fake via monkeypatch.
    """

    def _make_tmp_db(self, tmp_path: Path, rows: list[dict]) -> Path:
        from src.voc.persistence.migrations import init_db
        db_path = tmp_path / "test_live.db"
        conn = init_db(str(db_path))
        try:
            cur = conn.cursor()
            for r in rows:
                cur.execute("""
                    INSERT INTO phase1_reviews
                      (review_id, source_channel, source_method, text,
                       content_fingerprint, rating_raw,
                       collected_at, ingested_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    r["review_id"], "coupang", "csv", r["text"],
                    r["review_id"], r.get("rating", 3.0),
                    "2026-04-24T00:00:00Z", "2026-04-24T00:00:00Z",
                ))
            conn.commit()
        finally:
            conn.close()
        return db_path

    def _make_fixture(self, tmp_path: Path, rows: list[dict]) -> Path:
        p = tmp_path / "batch.json"
        p.write_text(json.dumps({"version": "1.0", "rows": rows},
                                ensure_ascii=False))
        return p

    def _valid_response(self, review_id: str, phrase_in_text: str) -> str:
        return json.dumps({
            "review_id": review_id,
            "tone_mismatch": "yes",
            "rationale_ko": "체크 1/2/3 모두 명확.",
            "gate_trace": {
                "q1_self_tone": {"verdict": "yes", "confidence": "high",
                                 "evidence_phrase": phrase_in_text},
                "q2_mismatch":  {"verdict": "yes", "confidence": "high",
                                 "evidence_phrase": phrase_in_text},
                "q3_framing":   {"verdict": "concern", "confidence": "high",
                                 "evidence_phrase": phrase_in_text},
            },
            "ambiguity_axis": None,
            "adjacent_class_flag": None,
        }, ensure_ascii=False)

    def test_live_mode_produces_proposals_file(
        self, audit_mod, tmp_path: Path, monkeypatch,
    ):
        synthetic_text = "웜톤인 저는 핑크끼가 강해 아쉬워요"
        db_path = self._make_tmp_db(tmp_path, [
            {"review_id": "synth_a", "text": synthetic_text, "rating": 3.0},
        ])
        fx_path = self._make_fixture(tmp_path, [
            {"review_id": "synth_a", "bucket": "FN_anchor"},
        ])

        # Mock the LLM call — return a valid response using a phrase
        # that IS in the synthetic text (so substring check passes)
        def fake_call(**kwargs):
            payload = kwargs["user_payload"]
            return self._valid_response(payload["review_id"], "웜톤인"), None

        monkeypatch.setattr(audit_mod, "call_llm", fake_call)
        monkeypatch.setenv("OPENAI_API_KEY", "test-key-not-real")

        out_dir = tmp_path / "out"
        empty_golden = tmp_path / "empty_golden.json"
        empty_golden.write_text(json.dumps({"labels": {}}))

        rc = audit_mod.main([
            "--live",
            "--batch", str(fx_path),
            "--rubric", str(RUBRIC_PATH),
            "--golden", str(empty_golden),
            "--db", str(db_path),
            "--output-dir", str(out_dir),
            "--model", "fake-model",
        ])
        assert rc == 0

        artifacts = list(out_dir.glob("proposals_*.json"))
        assert len(artifacts) == 1
        doc = json.loads(artifacts[0].read_text(encoding="utf-8"))
        assert doc["run_metadata"]["mode"] == "live"
        assert doc["run_metadata"]["model_id"] == "fake-model"
        assert doc["run_metadata"]["n_rows"] == 1
        assert doc["run_metadata"]["validation_status_counts"] == {"valid": 1}

        row = doc["rows"][0]
        assert row["validation_status"] == "valid"
        assert row["parsed"]["tone_mismatch"] == "yes"
        assert row["issues"] == []
        assert row["retries"] == 0

    def test_live_mode_flags_invalid_json_without_crash(
        self, audit_mod, tmp_path: Path, monkeypatch,
    ):
        db_path = self._make_tmp_db(tmp_path, [
            {"review_id": "synth_b", "text": "웜톤인 저는 아쉬워요", "rating": 3.0},
        ])
        fx_path = self._make_fixture(tmp_path, [
            {"review_id": "synth_b", "bucket": "FN_anchor"},
        ])

        # Return malformed JSON both times (initial + retry)
        def fake_call(**kwargs):
            return "this is not json", None

        monkeypatch.setattr(audit_mod, "call_llm", fake_call)
        monkeypatch.setenv("OPENAI_API_KEY", "test-key")

        out_dir = tmp_path / "out"
        rc = audit_mod.main([
            "--live", "--batch", str(fx_path),
            "--rubric", str(RUBRIC_PATH),
            "--golden", str(tmp_path / "none.json"),
            "--db", str(db_path),
            "--output-dir", str(out_dir),
        ])
        assert rc == 0   # script does NOT crash on bad LLM output
        arts = list(out_dir.glob("proposals_*.json"))
        doc = json.loads(arts[0].read_text(encoding="utf-8"))
        row = doc["rows"][0]
        assert row["validation_status"] == "invalid_json"
        assert row["raw_output"] == "this is not json"
        assert row["retries"] == 1   # exactly one retry

    def test_live_mode_flags_evidence_hallucination(
        self, audit_mod, tmp_path: Path, monkeypatch,
    ):
        text = "웜톤인 저는 발색이 아쉬워요"
        db_path = self._make_tmp_db(tmp_path, [
            {"review_id": "synth_c", "text": text, "rating": 3.0},
        ])
        fx_path = self._make_fixture(tmp_path, [
            {"review_id": "synth_c", "bucket": "FN_anchor"},
        ])

        # Evidence phrase "쿨톤인" is NOT in text — should flag
        def fake_call(**kwargs):
            payload = kwargs["user_payload"]
            return self._valid_response(payload["review_id"], "쿨톤인"), None

        monkeypatch.setattr(audit_mod, "call_llm", fake_call)
        monkeypatch.setenv("OPENAI_API_KEY", "test-key")

        rc = audit_mod.main([
            "--live", "--batch", str(fx_path),
            "--rubric", str(RUBRIC_PATH),
            "--golden", str(tmp_path / "none.json"),
            "--db", str(db_path),
            "--output-dir", str(tmp_path / "out"),
        ])
        assert rc == 0
        arts = list((tmp_path / "out").glob("proposals_*.json"))
        row = json.loads(arts[0].read_text())["rows"][0]
        assert row["validation_status"] == "evidence_hallucination"
        assert any("substring" in i for i in row["issues"])

    def test_live_mode_captures_api_error_without_dropping_row(
        self, audit_mod, tmp_path: Path, monkeypatch,
    ):
        db_path = self._make_tmp_db(tmp_path, [
            {"review_id": "synth_d", "text": "abc", "rating": 3.0},
        ])
        fx_path = self._make_fixture(tmp_path, [
            {"review_id": "synth_d", "bucket": "FN_anchor"},
        ])

        # API always errors — script must not drop the row; record it.
        def fake_call(**kwargs):
            return "", RuntimeError("simulated rate limit")

        monkeypatch.setattr(audit_mod, "call_llm", fake_call)
        monkeypatch.setenv("OPENAI_API_KEY", "test-key")

        rc = audit_mod.main([
            "--live", "--batch", str(fx_path),
            "--rubric", str(RUBRIC_PATH),
            "--golden", str(tmp_path / "none.json"),
            "--db", str(db_path),
            "--output-dir", str(tmp_path / "out"),
        ])
        assert rc == 0
        arts = list((tmp_path / "out").glob("proposals_*.json"))
        doc = json.loads(arts[0].read_text())
        assert doc["run_metadata"]["n_rows"] == 1
        row = doc["rows"][0]
        assert row["validation_status"] == "api_error"
        assert row["retries"] == 1
        assert any("rate limit" in i for i in row["issues"])

    def test_dry_run_behavior_unchanged(
        self, audit_mod, tmp_path: Path, monkeypatch,
    ):
        """Sanity: dry-run path must not call the LLM or require env var."""
        # Explicitly remove env var — dry-run shouldn't need it
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)

        # Fail loudly if anything tries to call the LLM during dry-run
        def explode_if_called(**kwargs):
            raise AssertionError("call_llm was invoked during dry-run")
        monkeypatch.setattr(audit_mod, "call_llm", explode_if_called)

        db_path = self._make_tmp_db(tmp_path, [
            {"review_id": "synth_e", "text": "아무 텍스트", "rating": 3.0},
        ])
        fx_path = self._make_fixture(tmp_path, [
            {"review_id": "synth_e", "bucket": "FN_anchor"},
        ])
        rc = audit_mod.main([
            "--batch", str(fx_path),   # no --live
            "--rubric", str(RUBRIC_PATH),
            "--golden", str(tmp_path / "none.json"),
            "--db", str(db_path),
            "--output-dir", str(tmp_path / "out"),
        ])
        assert rc == 0
        arts = list((tmp_path / "out").glob("dry_run_*.json"))
        assert len(arts) == 1
        assert not list((tmp_path / "out").glob("proposals_*.json"))


class TestDotenvLoading:
    """--live must be able to pick up OPENAI_API_KEY from .env when the
    shell env is empty, and shell env must win when both are set."""

    def _make_tmp_env(self, tmp_path: Path, key_value: str) -> Path:
        env_file = tmp_path / ".env"
        env_file.write_text(f"OPENAI_API_KEY={key_value}\n", encoding="utf-8")
        return env_file

    def _make_fixture_and_db(self, tmp_path: Path, audit_mod):
        """Shared test helpers — produces a 1-row fixture + DB."""
        from src.voc.persistence.migrations import init_db
        db_path = tmp_path / "dotenv_test.db"
        conn = init_db(str(db_path))
        try:
            conn.execute("""
                INSERT INTO phase1_reviews
                  (review_id, source_channel, source_method, text,
                   content_fingerprint, rating_raw,
                   collected_at, ingested_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                "dotenv_row", "coupang", "csv", "아무 텍스트",
                "dotenv_row", 3.0,
                "2026-04-24T00:00:00Z", "2026-04-24T00:00:00Z",
            ))
            conn.commit()
        finally:
            conn.close()
        fx = tmp_path / "batch.json"
        fx.write_text(json.dumps({
            "version": "1.0",
            "rows": [{"review_id": "dotenv_row", "bucket": "FN_anchor"}],
        }, ensure_ascii=False))
        return db_path, fx

    def test_live_reads_api_key_from_dotenv_when_shell_empty(
        self, audit_mod, tmp_path: Path, monkeypatch,
    ):
        """Shell env has no OPENAI_API_KEY, but .env does — should work."""
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        # Point REPO_ROOT at tmp_path so `_load_dotenv_if_available` finds
        # the temp .env via the repo-root path.
        monkeypatch.setattr(audit_mod, "REPO_ROOT", tmp_path)
        self._make_tmp_env(tmp_path, "dotenv-sourced-key")

        db_path, fx = self._make_fixture_and_db(tmp_path, audit_mod)

        # Capture the key actually passed to call_llm to prove .env was used
        captured: dict = {}
        def fake_call(**kwargs):
            captured["api_key"] = kwargs["api_key"]
            return json.dumps({
                "review_id": "dotenv_row",
                "tone_mismatch": "no",
                "rationale_ko": "체크 1 NO",
                "gate_trace": {
                    "q1_self_tone": {"verdict": "no", "confidence": "absent",
                                     "evidence_phrase": None},
                    "q2_mismatch":  {"verdict": "n/a", "confidence": "absent",
                                     "evidence_phrase": None},
                    "q3_framing":   {"verdict": "n/a", "confidence": "absent",
                                     "evidence_phrase": None},
                },
                "ambiguity_axis": None, "adjacent_class_flag": None,
            }, ensure_ascii=False), None
        monkeypatch.setattr(audit_mod, "call_llm", fake_call)

        rc = audit_mod.main([
            "--live",
            "--batch", str(fx),
            "--rubric", str(RUBRIC_PATH),
            "--golden", str(tmp_path / "none.json"),
            "--db", str(db_path),
            "--output-dir", str(tmp_path / "out"),
        ])
        assert rc == 0
        assert captured.get("api_key") == "dotenv-sourced-key"

    def test_shell_env_takes_precedence_over_dotenv(
        self, audit_mod, tmp_path: Path, monkeypatch,
    ):
        """When both shell and .env have the key, shell wins."""
        monkeypatch.setenv("OPENAI_API_KEY", "shell-wins-key")
        monkeypatch.setattr(audit_mod, "REPO_ROOT", tmp_path)
        self._make_tmp_env(tmp_path, "dotenv-loses-key")

        db_path, fx = self._make_fixture_and_db(tmp_path, audit_mod)

        captured: dict = {}
        def fake_call(**kwargs):
            captured["api_key"] = kwargs["api_key"]
            return json.dumps({
                "review_id": "dotenv_row",
                "tone_mismatch": "no",
                "rationale_ko": "no",
                "gate_trace": {
                    "q1_self_tone": {"verdict": "no", "confidence": "absent",
                                     "evidence_phrase": None},
                    "q2_mismatch":  {"verdict": "n/a", "confidence": "absent",
                                     "evidence_phrase": None},
                    "q3_framing":   {"verdict": "n/a", "confidence": "absent",
                                     "evidence_phrase": None},
                },
                "ambiguity_axis": None, "adjacent_class_flag": None,
            }, ensure_ascii=False), None
        monkeypatch.setattr(audit_mod, "call_llm", fake_call)

        rc = audit_mod.main([
            "--live",
            "--batch", str(fx),
            "--rubric", str(RUBRIC_PATH),
            "--golden", str(tmp_path / "none.json"),
            "--db", str(db_path),
            "--output-dir", str(tmp_path / "out"),
        ])
        assert rc == 0
        assert captured.get("api_key") == "shell-wins-key"

    def test_missing_key_everywhere_still_fails_clear(
        self, audit_mod, tmp_path: Path, monkeypatch,
    ):
        """No shell env AND no .env AND no fallback — must fail loudly."""
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        monkeypatch.setattr(audit_mod, "REPO_ROOT", tmp_path)
        # Deliberately do NOT create a .env file.
        # Also prevent load_dotenv from searching cwd upward by chdir'ing
        # to a clean temp directory.
        monkeypatch.chdir(tmp_path)

        db_path, fx = self._make_fixture_and_db(tmp_path, audit_mod)
        rc = audit_mod.main([
            "--live",
            "--batch", str(fx),
            "--rubric", str(RUBRIC_PATH),
            "--golden", str(tmp_path / "none.json"),
            "--db", str(db_path),
            "--output-dir", str(tmp_path / "out"),
        ])
        assert rc == 2
        # Must NOT have written a proposals file
        assert not list((tmp_path / "out").glob("proposals_*.json")) \
            if (tmp_path / "out").is_dir() else True
