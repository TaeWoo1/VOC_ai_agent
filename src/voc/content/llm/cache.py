"""Disk-backed cache for editorial polish output.

Cache key (sha256-hex) is computed by `compute_cache_key` from:
  skeleton sha256 + brief sha256 + selected angle id + model +
  temperature + system prompt version + polish mode + style_seed

When any of these change the key changes, so the next run is forced
to re-call the LLM. Identical inputs hit the cache and skip the LLM.

Validator runs **before** cache write — invalid output is never
cached. So a cache hit always corresponds to a previously-validated
editorial JSON.

Layout:
    {cache_dir}/
        ab/
            ab12...{full sha}.json
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

DEFAULT_CACHE_SUBDIR = ".cache/voc-content-engine/polish"
ENV_CACHE_DIR = "VOC_CONTENT_LLM_CACHE_DIR"


def default_cache_dir() -> Path:
    """User-level default cache directory.

    Order of preference:
      1. `VOC_CONTENT_LLM_CACHE_DIR` env var
      2. `~/.cache/voc-content-engine/polish`
    """
    env = os.environ.get(ENV_CACHE_DIR)
    if env:
        return Path(env).expanduser()
    return Path.home() / DEFAULT_CACHE_SUBDIR


def compute_cache_key(
    *,
    skeleton_sha256: str,
    brief_sha256: str,
    selected_angle_id: str,
    model: str,
    temperature: float,
    system_prompt_version: str,
    polish_mode: str,
    style_seed: int | None,
) -> str:
    """Return a stable hex sha256 for the polish input set.

    `style_seed` is included even when None — `None` and `0` produce
    different keys. `temperature` is round-tripped through `repr` so
    floats with trailing zeros don't drift between runs.
    """
    seed_part = "none" if style_seed is None else str(int(style_seed))
    payload = "|".join([
        skeleton_sha256,
        brief_sha256,
        selected_angle_id,
        model,
        repr(float(temperature)),
        system_prompt_version,
        polish_mode,
        seed_part,
    ])
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


class PolishCache:
    """Atomic disk cache. JSON-only.

    `set` writes via temp-file-then-replace so a crash mid-write
    leaves the previous value (or absence) intact. `get` returns
    None on missing key, on read errors, and on JSON-decode errors
    — corrupt cache files behave as misses, not crashes.
    """

    def __init__(self, cache_dir: Path | str | None = None):
        self.cache_dir = Path(cache_dir) if cache_dir else default_cache_dir()
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    def _key_path(self, key: str) -> Path:
        # Two-char shard prevents giant flat directories on hot products.
        shard = key[:2] if len(key) >= 2 else "00"
        return self.cache_dir / shard / f"{key}.json"

    def get(self, key: str) -> dict | None:
        path = self._key_path(key)
        if not path.is_file():
            return None
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None

    def set(self, key: str, value: dict) -> Path:
        path = self._key_path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(
            json.dumps(value, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        tmp.replace(path)
        return path

    def has(self, key: str) -> bool:
        return self._key_path(key).is_file()
