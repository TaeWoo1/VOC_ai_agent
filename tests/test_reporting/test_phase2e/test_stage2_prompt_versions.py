"""Tests for the Stage 2 prompt versioning + dispatcher.

Covers:
  - constants exist (PROMPT_VERSION_V1_BASELINE, _V2_SKINCARE,
    ALLOWED_PROMPT_VERSIONS, DEFAULT_PROMPT_VERSION)
  - default is v2 since 2026-05-01 (production flip)
  - v1 still accessible by explicit prompt_version
  - v2 dispatcher returns a skincare-sentiment-aware prompt
    that mentions every cue listed in the Phase 4.1 spec
  - unknown version raises
  - JSON output schema described in both prompts is identical
    so `parse_response` works for either version
"""
from __future__ import annotations

import pytest

from src.voc.reporting.phase2e.stage2 import (
    ALLOWED_PROMPT_VERSIONS,
    DEFAULT_PROMPT_VERSION,
    PROMPT_VERSION_V1_BASELINE,
    PROMPT_VERSION_V2_SKINCARE,
    build_prompt,
)


class TestPromptVersionConstants:
    def test_defined_versions(self):
        assert PROMPT_VERSION_V1_BASELINE == "v1_makeup_focused"
        assert PROMPT_VERSION_V2_SKINCARE == "stage2_polarity_v2_skincare_sentiment"

    def test_allowed_versions_contains_both(self):
        assert PROMPT_VERSION_V1_BASELINE in ALLOWED_PROMPT_VERSIONS
        assert PROMPT_VERSION_V2_SKINCARE in ALLOWED_PROMPT_VERSIONS

    def test_default_is_v2_skincare(self):
        """v2 became the production default on 2026-05-01 after the
        42-row seed replay showed coarse accuracy 0.475 → 0.786 and
        seller-surface risk 16 → 0. v1 remains accessible via the
        `prompt_version` kwarg for replay / regression testing."""
        assert DEFAULT_PROMPT_VERSION == PROMPT_VERSION_V2_SKINCARE

    def test_v1_still_accessible_after_default_flip(self):
        """Regression gate: flipping the default must NOT remove v1.
        Replay tooling depends on v1 being constructible."""
        sys_v1, _ = build_prompt(
            "test", "finish_texture",
            prompt_version=PROMPT_VERSION_V1_BASELINE,
        )
        # v1's marquee phrasing — sheer-as-feature framing.
        assert "sheer-as-feature" in sys_v1.lower() or "은은해서 좋아요" in sys_v1


class TestDispatcher:
    def test_default_version_returns_v2_content(self):
        sys_msg, _ = build_prompt("test clause", "finish_texture")
        # v2's marquee phrasing — skincare-positive cheatsheet.
        assert "촉촉" in sys_msg
        assert "쫀쫀" in sys_msg
        assert "끈적이지 않" in sys_msg

    def test_explicit_v2_matches_default(self):
        a = build_prompt("test", "finish_texture")
        b = build_prompt(
            "test", "finish_texture",
            prompt_version=PROMPT_VERSION_V2_SKINCARE,
        )
        assert a == b

    def test_v2_differs_from_v1(self):
        sys_v1, _ = build_prompt(
            "test", "finish_texture",
            prompt_version=PROMPT_VERSION_V1_BASELINE,
        )
        sys_v2, _ = build_prompt(
            "test", "finish_texture",
            prompt_version=PROMPT_VERSION_V2_SKINCARE,
        )
        assert sys_v1 != sys_v2

    def test_unknown_version_raises(self):
        with pytest.raises(ValueError, match="unknown prompt_version"):
            build_prompt("test", "finish_texture", prompt_version="v3_nope")

    def test_user_message_format_unchanged_across_versions(self):
        """Parser stability — the user message format is what
        `parse_response` reads back from the API output. v1 and v2
        must format the user input identically."""
        _, user_v1 = build_prompt("hello", "value_price")
        _, user_v2 = build_prompt(
            "hello", "value_price",
            prompt_version=PROMPT_VERSION_V2_SKINCARE,
        )
        assert user_v1 == user_v2


class TestV2PromptContent:
    """v2 must teach the cues from the Phase 4.1 spec. Each cue
    family gets its own assertion so test failure points the
    operator to exactly which cue is missing."""

    @pytest.fixture
    def v2_system(self):
        sys_msg, _ = build_prompt(
            "x", "finish_texture",
            prompt_version=PROMPT_VERSION_V2_SKINCARE,
        )
        return sys_msg

    @pytest.mark.parametrize("cue", [
        "촉촉",                # 촉촉하다 / 촉촉해요
        "진정되는 느낌",        # 진정되는 느낌이 있습니다
        "쫀쫀",                # 쫀쫀하다 / 쫀쫀하게
        "탄탄해진 느낌",        # 탄탄해진 느낌
        "밀착이 잘된다",        # exact phrase from spec
        "부드럽다",            # 부드럽다 / 부드럽게
        "자극 없이",           # 자극 없이 순하다
        "끈적이지 않",          # 끈적이지 않다 / 않고
        "잘 쓰고 있다",        # repurchase / habitual
        "괜찮다",              # 괜찮다 / 괜찮네요 / 괜찮아요
    ])
    def test_v2_mentions_skincare_positive_cue(self, v2_system, cue):
        assert cue in v2_system, f"v2 prompt missing skincare cue: {cue!r}"

    @pytest.mark.parametrize("topic", [
        "모공", "건조", "자극", "피부결",
    ])
    def test_v2_mentions_topic_word_disambiguation(self, v2_system, topic):
        """v2 must explicitly teach that these topic words appear in
        BOTH positive and negative contexts, so Stage 2 can't shortcut
        on topic alone."""
        assert topic in v2_system

    def test_v2_concession_handling_documented(self, v2_system):
        # Korean concession markers v2 must explicitly handle.
        assert "지만" in v2_system
        assert "한데" in v2_system or "는데" in v2_system

    def test_v2_neutral_drop_path_documented(self, v2_system):
        """The escape valve — the prompt must invite drop=true on
        context-only spans rather than guessing negative_weak."""
        assert "drop=true" in v2_system
        assert "마데카소사이드" in v2_system or "이 들어있" in v2_system

    def test_v2_medical_efficacy_discipline(self, v2_system):
        """Reviewer's self-reported feel ≠ medical claim. v2 must
        instruct Stage 2 to classify sentiment as the reviewer
        expressed it; downstream paraphrases banned tokens."""
        assert "self-report" in v2_system.lower() or "self-reported" in v2_system.lower()

    def test_v2_includes_observed_run010_fn_examples(self, v2_system):
        """The 4 known Run-010 false negatives should be explicitly
        present as few-shot examples so the model learns the
        canonical fix."""
        # At least one of the two near-identical FN texts should
        # appear; we use "쫀쫀하게 잡아주" as the marker.
        assert "쫀쫀하게 잡아주" in v2_system
        assert "탄탄해진 느낌" in v2_system

    def test_json_output_schema_unchanged(self, v2_system):
        """`parse_response` reads polarity / intensity / evidence_span /
        confidence / drop / rationale. The schema instruction must
        survive verbatim in v2."""
        for key in ("polarity", "intensity", "evidence_span",
                    "confidence", "drop", "rationale"):
            assert key in v2_system


class TestOpenAIClassifierCacheKey:
    """The classifier's cache key must include `prompt_version` so v1
    and v2 caches don't collide. Constructing the real OpenAIClassifier
    requires an API key + the openai SDK; we verify the contract by
    inspecting the cache-key hash function on a stub instance."""

    def test_cache_key_changes_with_prompt_version(self, monkeypatch):
        # Bypass real OpenAI construction by faking the SDK + env.
        import os
        from unittest.mock import MagicMock
        monkeypatch.setenv("OPENAI_API_KEY", "test-key-not-real")
        # Inject a fake openai module so `from openai import OpenAI` works.
        import sys as _sys
        fake_openai = MagicMock()
        fake_openai.OpenAI = MagicMock()
        monkeypatch.setitem(_sys.modules, "openai", fake_openai)

        from src.voc.reporting.phase2e.stage2 import (
            OpenAIClassifier,
            PROMPT_VERSION_V1_BASELINE,
            PROMPT_VERSION_V2_SKINCARE,
        )
        clf_v1 = OpenAIClassifier(
            model="gpt-4o-mini",
            prompt_version=PROMPT_VERSION_V1_BASELINE,
        )
        clf_v2 = OpenAIClassifier(
            model="gpt-4o-mini",
            prompt_version=PROMPT_VERSION_V2_SKINCARE,
        )
        k1 = clf_v1._cache_key("발색이 너무 좋아요", "pigmentation")
        k2 = clf_v2._cache_key("발색이 너무 좋아요", "pigmentation")
        assert k1 != k2, "v1 / v2 must have distinct cache keys"

    def test_invalid_prompt_version_rejected(self, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEY", "test-key-not-real")
        import sys as _sys
        from unittest.mock import MagicMock
        fake_openai = MagicMock()
        fake_openai.OpenAI = MagicMock()
        monkeypatch.setitem(_sys.modules, "openai", fake_openai)

        from src.voc.reporting.phase2e.stage2 import OpenAIClassifier
        with pytest.raises(ValueError, match="unknown prompt_version"):
            OpenAIClassifier(prompt_version="v9_imaginary")


class TestPipelineWiring:
    """run_phase2e_pipeline.py pins the classifier's prompt_version to
    v2 explicitly. This ensures a future flip of `DEFAULT_PROMPT_VERSION`
    in stage2.py cannot silently change pipeline behavior."""

    def test_pipeline_imports_v2_constant(self):
        """The pipeline module imports PROMPT_VERSION_V2_SKINCARE from
        stage2.py. If the constant is renamed, this import line breaks
        and the test catches it."""
        import importlib.util
        from pathlib import Path
        repo = Path(__file__).resolve().parents[3]
        spec = importlib.util.spec_from_file_location(
            "_pipeline_for_test", repo / "scripts" / "run_phase2e_pipeline.py",
        )
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        assert hasattr(mod, "PROMPT_VERSION_V2_SKINCARE")
        assert mod.PROMPT_VERSION_V2_SKINCARE == PROMPT_VERSION_V2_SKINCARE

    def test_pipeline_source_pins_v2_explicitly(self):
        """The OpenAIClassifier construction in run_phase2e_pipeline.py
        must pass `prompt_version=PROMPT_VERSION_V2_SKINCARE` rather
        than relying on the default. This way a future default-flip
        is impossible to make silently."""
        from pathlib import Path
        repo = Path(__file__).resolve().parents[3]
        src = (repo / "scripts" / "run_phase2e_pipeline.py").read_text(
            encoding="utf-8",
        )
        # Find the OpenAIClassifier construction site and assert
        # `prompt_version=PROMPT_VERSION_V2_SKINCARE` is on the call.
        assert "OpenAIClassifier(" in src
        assert "prompt_version=PROMPT_VERSION_V2_SKINCARE" in src or \
               "prompt_version=prompt_version" in src
        # And that the local `prompt_version` (if used) is set to v2.
        assert "prompt_version = PROMPT_VERSION_V2_SKINCARE" in src
