"""Tests for src.voc.content.paths.

Covers slugify rules and run-dir allocation. Filesystem behavior is
exercised against a tmp_path fixture; we never write under outputs/
during tests.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from src.voc.content.paths import (
    SLUG_FALLBACK_PREFIX,
    SLUG_MAX_LEN,
    allocate_run_dir,
    format_run_dirname,
    is_safe_relative_path,
    slugify,
)


# ---------------------------------------------------------------------------
# slugify
# ---------------------------------------------------------------------------


class TestSlugifyBasics:
    def test_lowercases_and_hyphenates(self):
        assert slugify("Romand Better Than Cheek") == "romand-better-than-cheek"

    def test_drops_double_hyphens(self):
        assert slugify("a   b---c") == "a-b-c"

    def test_strips_leading_and_trailing_hyphens(self):
        assert slugify("---hello world---") == "hello-world"

    def test_keeps_alphanumeric(self):
        assert slugify("3CE Velvet Lip Tint 03") == "3ce-velvet-lip-tint-03"

    def test_idempotent(self):
        once = slugify("Romand Better Than Cheek 03")
        twice = slugify(once)
        assert once == twice


class TestSlugifyKorean:
    def test_strips_hangul_keeps_ascii_tokens(self):
        # Mixed name: "롬앤 베러댄치크 03" → no romanized hangul, ASCII "03" survives
        assert slugify("롬앤 베러댄치크 03") == "03"

    def test_pure_hangul_falls_back_to_hash_stub(self):
        out = slugify("롬앤 베러댄치크", source_url="https://example.com/p/12345")
        assert out.startswith(f"{SLUG_FALLBACK_PREFIX}-")
        # 12 hex chars after prefix
        suffix = out[len(SLUG_FALLBACK_PREFIX) + 1:]
        assert len(suffix) == 12
        assert all(c in "0123456789abcdef" for c in suffix)

    def test_hash_fallback_is_deterministic(self):
        a = slugify("롬앤", source_url="https://x.com/p/1")
        b = slugify("롬앤", source_url="https://x.com/p/1")
        assert a == b

    def test_hash_fallback_differs_per_seed(self):
        a = slugify("롬앤", source_url="https://x.com/p/1")
        b = slugify("롬앤", source_url="https://x.com/p/2")
        assert a != b


class TestSlugifyEdgeCases:
    def test_empty_inputs_raise(self):
        with pytest.raises(ValueError):
            slugify(None, None)
        with pytest.raises(ValueError):
            slugify("", None)

    def test_empty_name_with_url_falls_back(self):
        out = slugify("", source_url="https://example.com")
        assert out.startswith(f"{SLUG_FALLBACK_PREFIX}-")

    def test_only_special_chars_falls_back(self):
        out = slugify("!!!@@@###", source_url="seed")
        assert out.startswith(f"{SLUG_FALLBACK_PREFIX}-")

    def test_truncation_at_hyphen_boundary(self):
        long_name = "alpha-" * 20  # 120 chars before slugify
        out = slugify(long_name)
        assert len(out) <= SLUG_MAX_LEN
        assert not out.endswith("-")
        # Truncation must not bisect a token: every segment is 'alpha'
        for seg in out.split("-"):
            assert seg == "alpha"

    def test_no_dot_or_slash_survives(self):
        out = slugify("foo/bar.baz")
        assert "/" not in out
        assert "." not in out
        assert out == "foo-bar-baz"

    def test_unicode_combining_marks_dropped(self):
        # café → cafe (NFKD strips combining acute)
        assert slugify("Café Latte") == "cafe-latte"


# ---------------------------------------------------------------------------
# format_run_dirname
# ---------------------------------------------------------------------------


class TestFormatRunDirname:
    def test_three_digit_padding(self):
        assert format_run_dirname("2026-04-29", "abc", 1) == "2026-04-29_abc_run-001"
        assert format_run_dirname("2026-04-29", "abc", 7) == "2026-04-29_abc_run-007"
        assert format_run_dirname("2026-04-29", "abc", 999) == "2026-04-29_abc_run-999"

    def test_grows_past_999(self):
        assert format_run_dirname("2026-04-29", "abc", 1000) == "2026-04-29_abc_run-1000"
        assert format_run_dirname("2026-04-29", "abc", 12345) == "2026-04-29_abc_run-12345"

    def test_rejects_zero_and_negative(self):
        with pytest.raises(ValueError):
            format_run_dirname("2026-04-29", "abc", 0)
        with pytest.raises(ValueError):
            format_run_dirname("2026-04-29", "abc", -1)


# ---------------------------------------------------------------------------
# allocate_run_dir
# ---------------------------------------------------------------------------


class TestAllocateRunDir:
    def test_creates_run_001_when_empty(self, tmp_path: Path):
        out = allocate_run_dir("2026-04-29", "demo", base=tmp_path)
        assert out.name == "2026-04-29_demo_run-001"
        assert out.is_dir()

    def test_creates_subdirs_by_default(self, tmp_path: Path):
        out = allocate_run_dir("2026-04-29", "demo", base=tmp_path)
        assert (out / "shared").is_dir()
        assert (out / "shared" / "provenance").is_dir()
        assert (out / "seller_report").is_dir()
        assert (out / "buyer_content").is_dir()

    def test_skips_subdirs_when_disabled(self, tmp_path: Path):
        out = allocate_run_dir(
            "2026-04-29", "demo", base=tmp_path, create_subdirs=False
        )
        assert out.is_dir()
        assert not (out / "shared").exists()

    def test_increments_run_number_on_collision(self, tmp_path: Path):
        a = allocate_run_dir("2026-04-29", "demo", base=tmp_path)
        b = allocate_run_dir("2026-04-29", "demo", base=tmp_path)
        c = allocate_run_dir("2026-04-29", "demo", base=tmp_path)
        assert a.name == "2026-04-29_demo_run-001"
        assert b.name == "2026-04-29_demo_run-002"
        assert c.name == "2026-04-29_demo_run-003"

    def test_increments_skip_pre_existing_runs(self, tmp_path: Path):
        # Manually create _run-001 and _run-003; allocator should
        # claim _run-002 first, then _run-004.
        (tmp_path / "2026-04-29_demo_run-001").mkdir()
        (tmp_path / "2026-04-29_demo_run-003").mkdir()
        a = allocate_run_dir("2026-04-29", "demo", base=tmp_path)
        b = allocate_run_dir("2026-04-29", "demo", base=tmp_path)
        assert a.name == "2026-04-29_demo_run-002"
        assert b.name == "2026-04-29_demo_run-004"

    def test_different_dates_get_independent_counters(self, tmp_path: Path):
        a = allocate_run_dir("2026-04-29", "demo", base=tmp_path)
        b = allocate_run_dir("2026-04-30", "demo", base=tmp_path)
        assert a.name.endswith("_run-001")
        assert b.name.endswith("_run-001")

    def test_creates_base_if_missing(self, tmp_path: Path):
        base = tmp_path / "nested" / "outputs"
        out = allocate_run_dir("2026-04-29", "demo", base=base)
        assert out.is_dir()
        assert out.parent == base

    def test_returns_absolute_path(self, tmp_path: Path):
        out = allocate_run_dir("2026-04-29", "demo", base=tmp_path)
        assert out.is_absolute()


# ---------------------------------------------------------------------------
# is_safe_relative_path
# ---------------------------------------------------------------------------


class TestIsSafeRelativePath:
    @pytest.mark.parametrize(
        "path",
        [
            "seller_report/seller_report_ko.pdf",
            "shared/analysis_report.json",
            "shared/provenance/snapshot.json",
            "buyer_content/ko/instagram_cardnews.json",
        ],
    )
    def test_valid_paths(self, path: str):
        assert is_safe_relative_path(path) is True

    @pytest.mark.parametrize(
        "path",
        [
            "",
            "/etc/passwd",
            "/tmp/scratch.json",
            "tmp/scratch.json",
            "docs/leaked.pdf",
            "../escape.json",
            "shared/../../etc/passwd",
            "\\windows\\style",
        ],
    )
    def test_rejects_unsafe(self, path: str):
        assert is_safe_relative_path(path) is False
