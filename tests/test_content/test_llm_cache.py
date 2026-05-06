"""Tests for src.voc.content.llm.cache and llm.client.MockLLMClient."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from src.voc.content.llm.cache import (
    DEFAULT_CACHE_SUBDIR,
    ENV_CACHE_DIR,
    PolishCache,
    compute_cache_key,
    default_cache_dir,
)
from src.voc.content.llm.client import MockLLMClient


# ---------------------------------------------------------------------------
# compute_cache_key
# ---------------------------------------------------------------------------


def _base_kwargs() -> dict:
    return dict(
        skeleton_sha256="a" * 64,
        brief_sha256="b" * 64,
        selected_angle_id="h2",
        model="claude-haiku-4-5",
        temperature=0.3,
        system_prompt_version="v1",
        polish_mode="full",
        style_seed=None,
    )


class TestComputeCacheKey:
    def test_returns_sha256_hex(self):
        key = compute_cache_key(**_base_kwargs())
        assert len(key) == 64
        assert all(c in "0123456789abcdef" for c in key)

    def test_deterministic(self):
        a = compute_cache_key(**_base_kwargs())
        b = compute_cache_key(**_base_kwargs())
        assert a == b

    def test_different_skeleton_different_key(self):
        a = compute_cache_key(**_base_kwargs())
        kw = _base_kwargs()
        kw["skeleton_sha256"] = "c" * 64
        b = compute_cache_key(**kw)
        assert a != b

    def test_different_brief_different_key(self):
        a = compute_cache_key(**_base_kwargs())
        kw = _base_kwargs()
        kw["brief_sha256"] = "c" * 64
        b = compute_cache_key(**kw)
        assert a != b

    def test_different_angle_id_different_key(self):
        a = compute_cache_key(**_base_kwargs())
        kw = _base_kwargs()
        kw["selected_angle_id"] = "h6"
        b = compute_cache_key(**kw)
        assert a != b

    def test_different_temperature_different_key(self):
        a = compute_cache_key(**_base_kwargs())
        kw = _base_kwargs()
        kw["temperature"] = 0.4
        b = compute_cache_key(**kw)
        assert a != b

    def test_different_model_different_key(self):
        a = compute_cache_key(**_base_kwargs())
        kw = _base_kwargs()
        kw["model"] = "claude-sonnet-4-6"
        b = compute_cache_key(**kw)
        assert a != b

    def test_different_polish_mode_different_key(self):
        a = compute_cache_key(**_base_kwargs())
        kw = _base_kwargs()
        kw["polish_mode"] = "hook_only"
        b = compute_cache_key(**kw)
        assert a != b

    def test_different_prompt_version_different_key(self):
        a = compute_cache_key(**_base_kwargs())
        kw = _base_kwargs()
        kw["system_prompt_version"] = "v2"
        b = compute_cache_key(**kw)
        assert a != b

    def test_different_style_seed_different_key(self):
        kw = _base_kwargs()
        kw["style_seed"] = 1
        a = compute_cache_key(**kw)
        kw["style_seed"] = 2
        b = compute_cache_key(**kw)
        assert a != b

    def test_seed_none_vs_zero_different(self):
        kw_none = _base_kwargs()
        kw_zero = {**kw_none, "style_seed": 0}
        assert compute_cache_key(**kw_none) != compute_cache_key(**kw_zero)


# ---------------------------------------------------------------------------
# PolishCache
# ---------------------------------------------------------------------------


class TestPolishCache:
    def test_set_then_get_roundtrips(self, tmp_path: Path):
        cache = PolishCache(tmp_path)
        cache.set("key1", {"foo": "bar"})
        assert cache.get("key1") == {"foo": "bar"}

    def test_missing_key_returns_none(self, tmp_path: Path):
        cache = PolishCache(tmp_path)
        assert cache.get("nope") is None

    def test_has_reflects_presence(self, tmp_path: Path):
        cache = PolishCache(tmp_path)
        assert cache.has("k") is False
        cache.set("k", {})
        assert cache.has("k") is True

    def test_corrupt_file_is_a_miss(self, tmp_path: Path):
        cache = PolishCache(tmp_path)
        cache.set("k", {"x": 1})
        # Corrupt the cache entry
        path = cache._key_path("k")
        path.write_text("not valid json", encoding="utf-8")
        assert cache.get("k") is None

    def test_atomic_write_no_temp_left(self, tmp_path: Path):
        cache = PolishCache(tmp_path)
        cache.set("k", {"x": 1})
        # No .tmp leftover
        for p in tmp_path.rglob("*.tmp"):
            pytest.fail(f"unexpected .tmp file: {p}")

    def test_default_cache_dir_uses_env_when_set(
        self, tmp_path: Path, monkeypatch
    ):
        monkeypatch.setenv(ENV_CACHE_DIR, str(tmp_path / "custom"))
        assert default_cache_dir() == tmp_path / "custom"

    def test_default_cache_dir_falls_back_to_home(self, monkeypatch):
        monkeypatch.delenv(ENV_CACHE_DIR, raising=False)
        # Just verify the path ends with the expected subdir.
        d = default_cache_dir()
        assert str(d).endswith(DEFAULT_CACHE_SUBDIR)

    def test_keys_with_different_first_two_chars_shard(self, tmp_path: Path):
        cache = PolishCache(tmp_path)
        cache.set("ab12345", {"a": 1})
        cache.set("cd67890", {"a": 2})
        assert cache._key_path("ab12345").parent.name == "ab"
        assert cache._key_path("cd67890").parent.name == "cd"


# ---------------------------------------------------------------------------
# MockLLMClient
# ---------------------------------------------------------------------------


class TestMockLLMClient:
    def test_returns_queued_string(self):
        m = MockLLMClient(["hello"])
        assert m.complete(system="s", user="u") == "hello"

    def test_records_calls(self):
        m = MockLLMClient(["a", "b"])
        m.complete(system="sys1", user="usr1")
        m.complete(system="sys2", user="usr2")
        assert m.call_count == 2
        assert m.calls[0] == {"system": "sys1", "user": "usr1"}
        assert m.calls[1] == {"system": "sys2", "user": "usr2"}

    def test_raises_queued_exception(self):
        class CustomError(Exception):
            pass
        m = MockLLMClient([CustomError("boom")])
        with pytest.raises(CustomError):
            m.complete(system="s", user="u")

    def test_queue_exhausted_raises_runtime(self):
        m = MockLLMClient([])
        with pytest.raises(RuntimeError, match="queue empty"):
            m.complete(system="s", user="u")

    def test_model_and_temperature_attributes(self):
        m = MockLLMClient([], model="custom", temperature=0.7)
        assert m.model == "custom"
        assert m.temperature == 0.7
