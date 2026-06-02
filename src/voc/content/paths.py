"""Run-directory allocation and slug derivation for the content engine.

Every end-to-end VOC pipeline run lands under a single human-readable run
directory:

    outputs/{YYYY-MM-DD}_{product_slug}_run-{NNN}/

Subdirectories `seller_report/`, `buyer_content/{ko,en}/`, and `shared/`
group the artifacts; `manifest.json` lives at the run root. This module
owns only the *path layer* — slug derivation, run-number allocation,
and well-known subdirectory names. It does not write content; it does
not read analysis_report.json. Both responsibilities live in
`src.voc.content.manifest` and downstream modules.

Why a separate path module
--------------------------
Slug rules and run-number allocation are reused from CLI entrypoints,
the seller-PDF runner, and the future buyer-content runner. Locking
them in one place prevents drift (e.g. one runner using underscores
and another using hyphens) and lets us write a single suite of unit
tests for the contract.

Allocation strategy
-------------------
`allocate_run_dir` picks the lowest unused integer N (1-indexed,
zero-padded to width 3 with growth past 999) for the given (date, slug)
prefix. The `mkdir(exist_ok=False)` call is the allocation marker:
two concurrent runs racing to claim `_run-007` will see one mkdir win
and the other raise FileExistsError, at which point the loser bumps to
`_run-008`. No external lock is required.

Failed runs stay on disk for audit. The allocator never reuses a
directory, even if it is empty.
"""
from __future__ import annotations

import re
import unicodedata
from hashlib import sha256
from pathlib import Path

# Public well-known subdirectory names. Kept as constants (not strings
# scattered across modules) so renaming is a one-line change.
SHARED_SUBDIR = "shared"
PROVENANCE_SUBDIR = "shared/provenance"
SELLER_REPORT_SUBDIR = "seller_report"
BUYER_CONTENT_SUBDIR = "buyer_content"
MANIFEST_FILENAME = "manifest.json"

# Slug constraints. Tight on purpose — anything that does not survive
# `[a-z0-9-]+` is dropped. Length cap keeps `_run-NNN` suffix legible
# inside a 95-char terminal column even on 4-digit run numbers.
_SLUG_ALLOWED_RE = re.compile(r"[^a-z0-9-]+")
_SLUG_COLLAPSE_RE = re.compile(r"-+")
SLUG_MAX_LEN = 64
SLUG_FALLBACK_PREFIX = "product"

# Run-number formatting. 3-digit zero-padded by default; if N > 999 the
# allocator emits the natural width (no truncation, no leading zeros
# beyond width 3). Tests assert both `001` and `1000` formats.
RUN_NUMBER_MIN_WIDTH = 3

# Korean Hangul (jamo) → ASCII transliteration is intentionally NOT
# attempted here. Korean product names commonly arrive *with* English
# tokens already (e.g. "롬앤 베러댄치크 03"); the regex strips Hangul
# and keeps the ASCII tokens. When no ASCII survives, we fall back to
# a sha256-derived stub keyed off the source URL or raw name. This is
# deterministic, stable across runs, and avoids guessing romanization.


def _hash_fallback(seed: str) -> str:
    """Deterministic 12-char slug stub when nothing romanizable survives.
    Format: `product-{12-hex}`. Stable across calls with the same seed."""
    digest = sha256(seed.encode("utf-8")).hexdigest()[:12]
    return f"{SLUG_FALLBACK_PREFIX}-{digest}"


def slugify(name: str | None, source_url: str | None = None) -> str:
    """Derive a filesystem-safe, lowercase, hyphenated slug.

    Rules:
      - NFKD-normalize, drop combining marks, lowercase.
      - Replace any character outside `[a-z0-9]` with `-`.
      - Collapse multiple `-` into one; strip leading/trailing `-`.
      - If the result is empty, fall back to a sha256-derived stub
        keyed off `source_url or name`. Both being None/empty raises
        ValueError — slug derivation must always have *some* seed.
      - Truncate to SLUG_MAX_LEN at a `-` boundary when possible
        (so we never bisect a token mid-word).

    The function is pure and idempotent: `slugify(slugify(x)) == slugify(x)`
    for any input that already passes the rules.
    """
    if not name and not source_url:
        raise ValueError("slugify requires at least one of name/source_url")
    raw = name or ""
    # NFKD splits accented chars into base + combining mark; the
    # encode/decode round-trip drops the combining marks. Idempotent
    # for already-ASCII input.
    normalized = unicodedata.normalize("NFKD", raw)
    ascii_only = normalized.encode("ascii", "ignore").decode("ascii").lower()
    # Replace every non-allowed char with a single `-`, then collapse.
    hyphenated = _SLUG_ALLOWED_RE.sub("-", ascii_only)
    collapsed = _SLUG_COLLAPSE_RE.sub("-", hyphenated).strip("-")

    if not collapsed:
        seed = source_url or name or ""
        return _hash_fallback(seed)

    if len(collapsed) <= SLUG_MAX_LEN:
        return collapsed

    # Truncate at the last `-` that fits inside SLUG_MAX_LEN to avoid
    # bisecting a token. If no `-` exists in the prefix, hard-cut.
    head = collapsed[:SLUG_MAX_LEN]
    last_hyphen = head.rfind("-")
    if last_hyphen <= 0:
        return head.rstrip("-") or _hash_fallback(source_url or name or "")
    return head[:last_hyphen]


def format_run_dirname(date: str, slug: str, run_number: int) -> str:
    """Compose the run directory basename. Public so tests and callers
    can predict the path without duplicating the format string.

    Width grows past 999 naturally: `_run-1000`, not `_run-_1000`.
    """
    if run_number < 1:
        raise ValueError(f"run_number must be >= 1, got {run_number}")
    width = max(RUN_NUMBER_MIN_WIDTH, len(str(run_number)))
    return f"{date}_{slug}_run-{run_number:0{width}d}"


def allocate_run_dir(
    date: str,
    slug: str,
    base: Path | str = "outputs",
    *,
    create_subdirs: bool = True,
) -> Path:
    """Allocate the next free run directory and create it on disk.

    `date` must already be formatted `YYYY-MM-DD`; this module does not
    pick the timezone for you. Callers using UTC should pass
    `datetime.now(timezone.utc).strftime("%Y-%m-%d")`.

    Returns the absolute Path to the newly-created run directory.
    Standard subdirectories are created when `create_subdirs=True`
    (the default — we want them to exist before anything tries to
    write under them).

    Race-safe: `mkdir(exist_ok=False)` is the allocation marker.
    """
    base_path = Path(base)
    base_path.mkdir(parents=True, exist_ok=True)
    n = 1
    while True:
        candidate = base_path / format_run_dirname(date, slug, n)
        try:
            candidate.mkdir(exist_ok=False)
        except FileExistsError:
            n += 1
            continue
        if create_subdirs:
            (candidate / SHARED_SUBDIR).mkdir(exist_ok=True)
            (candidate / PROVENANCE_SUBDIR).mkdir(exist_ok=True)
            (candidate / SELLER_REPORT_SUBDIR).mkdir(exist_ok=True)
            (candidate / BUYER_CONTENT_SUBDIR).mkdir(exist_ok=True)
        return candidate.resolve()


def is_safe_relative_path(path: str) -> bool:
    """True when a manifest artifact path is well-formed.

    Manifest paths are *always* relative to the run root. Reject:
      - absolute paths
      - any segment equal to `..` (parent traversal)
      - any segment crossing protected zones (`/tmp/`, `docs/`, etc.)
      - empty paths

    The check is purely lexical (no filesystem touch) so manifest
    integrity tests can run without writing fixtures.
    """
    if not path:
        return False
    if path.startswith("/") or path.startswith("\\"):
        return False
    parts = path.replace("\\", "/").split("/")
    if any(p == ".." for p in parts):
        return False
    forbidden = {"tmp", "docs"}
    if parts and parts[0] in forbidden:
        return False
    return True
