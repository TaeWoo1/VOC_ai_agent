"""Manifest writer for the content engine run directory.

`manifest.json` lives at the run root and records the analysis-report hash,
every artifact's relative path + sha256, the safety status, and the run
config. It is the single document an operator (or a future re-render
script) reads to know what was produced.

This Phase A scaffold writes a *report-only* manifest: seller PDF +
shared analysis + provenance, with all buyer-content artifacts marked
`status: "skipped"` and `path: null`. Phase B and beyond fill those in
as channels and validators come online.

Hard rules enforced here (test-asserted):

- Every artifact path is relative to the run root and starts with one of
  `seller_report/`, `buyer_content/`, `shared/`. No `..`, no absolute
  paths, no `/tmp` or `docs/` prefix.
- For status=="ok", both `path` and `sha256` are non-null and the file
  exists under the run root with a matching digest.
- For status in {"failed", "skipped"}, both `path` and `sha256` may be
  null. They are not required to exist.
- `requires_human_review` is hard-pinned to True. Phase A does not
  expose a knob to disable it; that gate is part of the v1 contract.

Why a separate module
---------------------
Manifest shape is the contract every downstream tool (re-render CLI,
operator review UI, future affiliate/disclosure surfacing) reads. A
single writer + a single validator keeps the schema honest. The
ARTIFACT_KEYS_PHASE_A list freezes the Phase A surface so tests can
assert no artifact is silently dropped or renamed.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from src.voc.content.paths import (
    BUYER_CONTENT_SUBDIR,
    MANIFEST_FILENAME,
    PROVENANCE_SUBDIR,
    SELLER_REPORT_SUBDIR,
    SHARED_SUBDIR,
    is_safe_relative_path,
)

MANIFEST_SCHEMA_VERSION = "1.2"

ArtifactStatus = Literal["ok", "failed", "skipped"]
_ALLOWED_STATUSES = ("ok", "failed", "skipped")

# Frozen artifact key list (top-level, manifest schema 1.2).
#
# Migration history:
#   1.0 → 1.1: ADD consumer_insight_brief_json; RENAME instagram_cardnews_json
#              → skeleton_cardnews_json.
#   1.1 → 1.2: ADD editorial_cardnews_json (Phase D1, KO Instagram);
#              ADD safety.editorial_polish_used + safety.fallback_to_skeleton
#              so an operator scanning the manifest can tell which
#              cardnews artifact ships without diffing files.
#
# Pre-v1 ship: breaking change is acceptable, no fallback shim.
# Tests assert the renamed surface.
ARTIFACT_KEYS_PHASE_A: tuple[str, ...] = (
    "seller_report_ko_pdf",
    "interview_hooks_json",
    "consumer_insight_brief_json",
)

BUYER_CONTENT_ARTIFACT_KEYS_PHASE_A: tuple[str, ...] = (
    "skeleton_cardnews_json",
    "editorial_cardnews_json",
    "buyer_journey_cardnews_json",
    "instagram_cardnews_md",
    "threads_md",
    "x_md",
    "image_prompts_txt",
    "safety_report_json",
)

SUPPORTED_LANGS_PHASE_A: tuple[str, ...] = ("ko", "en")


def compute_sha256(path: Path) -> str:
    """Return the hex sha256 of the file at `path`. Streaming read so
    large PDFs don't balloon memory. Errors propagate."""
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


@dataclass
class ArtifactRecord:
    """One artifact entry in the manifest. `path` is relative to the
    run root; absolute paths are rejected at validation time."""
    status: ArtifactStatus
    path: str | None = None
    sha256: str | None = None
    bytes: int | None = None
    notes: str | None = None

    def to_dict(self) -> dict:
        d: dict = {"status": self.status, "path": self.path, "sha256": self.sha256}
        if self.bytes is not None:
            d["bytes"] = self.bytes
        if self.notes:
            d["notes"] = self.notes
        return d


@dataclass
class ManifestBuildContext:
    """Inputs for building a manifest.

    `run_dir` is an absolute path. `analysis_report_path` is *relative
    to the run root* (e.g. `shared/analysis_report.json`). The product
    block is taken verbatim from the analysis report or from CLI flags;
    we don't re-derive it here.

    `collection` (manifest 1.3, optional) carries scrape-side
    provenance the seller pipeline knows but the content engine
    didn't previously thread through. Surfaces under top-level
    `collection` in the resulting manifest. Recommended fields:
      - product_url, goodsNo
      - corpus_mode (observable_multi_sort / primary_only)
      - sorts_attempted, sorts_succeeded (lists of sort_type strings)
      - partial_success (bool)
      - review_count_collected (int) — pre-dedup raw count
      - review_count_analyzed  (int) — n_reviews fed to analysis
    Unknown keys are accepted verbatim — additive contract.
    """
    run_dir: Path
    product: dict
    analysis_report_path: str
    analysis_report_extras: dict = field(default_factory=dict)
    config: dict = field(default_factory=dict)
    languages: tuple[str, ...] = SUPPORTED_LANGS_PHASE_A
    run_started_at: str | None = None
    run_completed_at: str | None = None
    collection: dict = field(default_factory=dict)


def _utc_iso_now() -> str:
    """ISO-8601 UTC timestamp with second precision (`Z` suffix)."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _record_for_existing_file(
    run_dir: Path,
    relative_path: str,
) -> ArtifactRecord:
    """Build an `ok` record for a file that already exists on disk
    under the run root. Used when the seller-report runner has
    already written the PDF and we want to register it."""
    abs_path = run_dir / relative_path
    if not abs_path.is_file():
        raise FileNotFoundError(f"manifest: artifact not on disk: {abs_path}")
    return ArtifactRecord(
        status="ok",
        path=relative_path,
        sha256=compute_sha256(abs_path),
        bytes=abs_path.stat().st_size,
    )


def detect_seller_artifacts(run_dir: Path) -> dict[str, ArtifactRecord]:
    """Detect seller-side artifacts already on disk under `run_dir`.

    Manifest 1.3 reliability fix — the seller PDF is generated by the
    Phase 2E subprocess (`run_phase2e_pipeline.py`); the content
    engine that writes the manifest doesn't know about it. Without
    this detection step, the manifest records the seller PDF as
    `skipped` even when it physically exists, breaking provenance.

    Returns a `{key: ArtifactRecord}` map suitable for passing as
    individual records into `build_phase_a_manifest`. Keys checked:
      - `seller_report_ko_pdf`  → `seller_report/seller_report_ko.pdf`
      - `interview_hooks_json`  → `shared/interview_hooks.json`

    Missing files yield no entry (caller falls through to the
    default skipped record). The function is read-only.
    """
    found: dict[str, ArtifactRecord] = {}
    seller_pdf = run_dir / SELLER_REPORT_SUBDIR / "seller_report_ko.pdf"
    if seller_pdf.is_file():
        rel = f"{SELLER_REPORT_SUBDIR}/seller_report_ko.pdf"
        found["seller_report_ko_pdf"] = ArtifactRecord(
            status="ok",
            path=rel,
            sha256=compute_sha256(seller_pdf),
            bytes=seller_pdf.stat().st_size,
        )
    hooks_json = run_dir / SHARED_SUBDIR / "interview_hooks.json"
    if hooks_json.is_file():
        rel = f"{SHARED_SUBDIR}/interview_hooks.json"
        found["interview_hooks_json"] = ArtifactRecord(
            status="ok",
            path=rel,
            sha256=compute_sha256(hooks_json),
            bytes=hooks_json.stat().st_size,
        )
    return found


def skipped_record(notes: str | None = None) -> ArtifactRecord:
    """Sugar for the common `status="skipped"` shape used when the
    Phase A scaffold writes a manifest before Phase B fills in
    buyer content."""
    return ArtifactRecord(status="skipped", notes=notes)


def failed_record(notes: str) -> ArtifactRecord:
    """Sugar for the common failure shape — `notes` is required so a
    failed artifact always carries operator-readable reason."""
    return ArtifactRecord(status="failed", notes=notes)


def build_phase_a_manifest(
    ctx: ManifestBuildContext,
    *,
    seller_report_record: ArtifactRecord | None = None,
    interview_hooks_record: ArtifactRecord | None = None,
    consumer_insight_brief_record: ArtifactRecord | None = None,
    provenance_records: dict[str, ArtifactRecord] | None = None,
    buyer_content_records: dict[str, dict[str, ArtifactRecord]] | None = None,
    safety_blocking_flags: list[str] | None = None,
    safety_advisory_flags: list[str] | None = None,
    safety_editorial_polish_used: bool = False,
    safety_fallback_to_skeleton: bool = False,
) -> dict:
    """Construct a Phase A manifest dict in canonical shape.

    Phase A defaults: every buyer_content artifact is `skipped` (Phase
    B fills them in selectively). Seller report, interview hooks,
    and provenance default to `skipped` if no record is provided so
    the scaffold can be written before any artifact actually exists.

    `buyer_content_records` is a `{lang: {key: ArtifactRecord}}` map
    that overrides the default `skipped` fill on a per-key basis.
    Phase B uses it to mark `ko/instagram_cardnews_json` as `ok` (or
    `failed`) without disturbing the rest of the buyer_content slots.
    Unknown keys are ignored so an experimental Phase D channel can
    be wired through without requiring this function to know about it.

    `safety.requires_human_review` is hard-pinned to True. There is
    intentionally no kwarg to set it False.
    """
    seller_report_record = seller_report_record or skipped_record(
        "Phase A scaffold: seller report not generated by content engine"
    )
    interview_hooks_record = interview_hooks_record or skipped_record(
        "Phase A scaffold: interview hooks not generated yet"
    )
    consumer_insight_brief_record = consumer_insight_brief_record or skipped_record(
        "Phase C: consumer insight brief not generated yet"
    )
    provenance_records = provenance_records or {}

    artifacts: dict = {
        "seller_report_ko_pdf": seller_report_record.to_dict(),
        "interview_hooks_json": interview_hooks_record.to_dict(),
        "consumer_insight_brief_json": consumer_insight_brief_record.to_dict(),
        "buyer_content": {},
    }
    for lang in ctx.languages:
        artifacts["buyer_content"][lang] = {
            key: skipped_record(
                "Phase A scaffold: buyer content generation not implemented yet"
            ).to_dict()
            for key in BUYER_CONTENT_ARTIFACT_KEYS_PHASE_A
        }

    # Phase B+ overrides: caller can mark specific buyer_content
    # artifacts as ok/failed/skipped without touching the rest.
    if buyer_content_records:
        for lang, lang_overrides in buyer_content_records.items():
            artifacts["buyer_content"].setdefault(lang, {})
            for key, rec in lang_overrides.items():
                if key not in BUYER_CONTENT_ARTIFACT_KEYS_PHASE_A:
                    # Defensive: ignore keys outside the frozen Phase A
                    # surface so a typo can't silently corrupt the
                    # manifest. Test-asserted.
                    continue
                artifacts["buyer_content"][lang][key] = rec.to_dict()

    provenance_block: dict = {}
    for key in ("corpus_provenance", "snapshot", "comparability"):
        rec = provenance_records.get(key) or skipped_record(
            f"Phase A scaffold: {key} not registered yet"
        )
        provenance_block[key] = rec.to_dict()

    analysis_report_block = {
        "path": ctx.analysis_report_path,
        "sha256": None,
        **ctx.analysis_report_extras,
    }
    abs_report = ctx.run_dir / ctx.analysis_report_path
    if abs_report.is_file():
        analysis_report_block["sha256"] = compute_sha256(abs_report)
        analysis_report_block["bytes"] = abs_report.stat().st_size

    manifest = {
        "schema_version": MANIFEST_SCHEMA_VERSION,
        "run_dir": ctx.run_dir.name,
        "run_started_at": ctx.run_started_at or _utc_iso_now(),
        "run_completed_at": ctx.run_completed_at or _utc_iso_now(),
        "product": dict(ctx.product),
        "analysis_report": analysis_report_block,
        "artifacts": artifacts,
        "provenance": provenance_block,
        "safety": {
            "requires_human_review": True,
            "blocking_flags": list(safety_blocking_flags or []),
            "advisory_flags": list(safety_advisory_flags or []),
            "editorial_polish_used": bool(safety_editorial_polish_used),
            "fallback_to_skeleton": bool(safety_fallback_to_skeleton),
        },
        "config": dict(ctx.config),
    }
    # Manifest 1.3 — additive collection block. Empty dict is dropped
    # so legacy manifests stay byte-for-byte identical when callers
    # don't supply scrape-side provenance.
    if ctx.collection:
        manifest["collection"] = dict(ctx.collection)
    return manifest


def write_manifest(run_dir: Path, manifest: dict) -> Path:
    """Atomically write `manifest.json` to the run root.

    Uses write-temp-then-rename so a partially-written manifest never
    appears if the process is killed mid-write. Returns the manifest
    path (always `<run_dir>/manifest.json`).
    """
    if not run_dir.is_dir():
        raise FileNotFoundError(f"manifest: run_dir does not exist: {run_dir}")
    target = run_dir / MANIFEST_FILENAME
    tmp = run_dir / (MANIFEST_FILENAME + ".tmp")
    payload = json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=False)
    tmp.write_text(payload + "\n", encoding="utf-8")
    tmp.replace(target)
    return target


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


class ManifestIntegrityError(ValueError):
    """Raised by validate_manifest when an invariant is violated.

    Test code asserts on the message prefix; if you change the
    prefixes, update tests in lockstep.
    """


_ARTIFACT_PATH_PREFIX_ALLOWLIST = (
    SELLER_REPORT_SUBDIR + "/",
    BUYER_CONTENT_SUBDIR + "/",
    SHARED_SUBDIR + "/",
    PROVENANCE_SUBDIR + "/",  # subset of shared/, but kept explicit
)


def _validate_artifact_record(
    artifact_key: str,
    record: dict,
    run_dir: Path,
    *,
    require_under_subdir_prefix: bool = True,
) -> None:
    """Validate one artifact dict.

    `require_under_subdir_prefix=True` enforces the `seller_report/` /
    `buyer_content/` / `shared/` prefix. Set False for nested
    provenance keys whose prefix is already validated by the parent.
    """
    status = record.get("status")
    if status not in _ALLOWED_STATUSES:
        raise ManifestIntegrityError(
            f"artifact[{artifact_key}].status must be one of {_ALLOWED_STATUSES}, "
            f"got {status!r}"
        )
    path = record.get("path")
    sha = record.get("sha256")

    if status == "ok":
        if not path or not sha:
            raise ManifestIntegrityError(
                f"artifact[{artifact_key}] status=ok requires path+sha256, "
                f"got path={path!r} sha256={sha!r}"
            )
        if not is_safe_relative_path(path):
            raise ManifestIntegrityError(
                f"artifact[{artifact_key}].path is not a safe relative path: {path!r}"
            )
        if require_under_subdir_prefix and not path.startswith(
            _ARTIFACT_PATH_PREFIX_ALLOWLIST
        ):
            raise ManifestIntegrityError(
                f"artifact[{artifact_key}].path must start with one of "
                f"{_ARTIFACT_PATH_PREFIX_ALLOWLIST}, got {path!r}"
            )
        abs_path = run_dir / path
        if not abs_path.is_file():
            raise ManifestIntegrityError(
                f"artifact[{artifact_key}] status=ok but file missing: {abs_path}"
            )
        actual_sha = compute_sha256(abs_path)
        if actual_sha != sha:
            raise ManifestIntegrityError(
                f"artifact[{artifact_key}] sha256 mismatch: "
                f"recorded={sha} actual={actual_sha}"
            )
    else:
        # failed / skipped: path and sha may be null. If a path is
        # provided regardless, it must still be safe; we don't want
        # operator-readable notes to leak through as paths.
        if path is not None and not is_safe_relative_path(path):
            raise ManifestIntegrityError(
                f"artifact[{artifact_key}].path is not a safe relative path: {path!r}"
            )


def validate_manifest(manifest: dict, run_dir: Path) -> None:
    """Assert manifest invariants. Raises ManifestIntegrityError on
    the first violation; tests rely on that fail-fast behavior.

    Invariants checked:
      - schema_version present
      - safety.requires_human_review is True
      - every artifact entry conforms to status/path/sha256 rules
      - provenance entries conform (path may sit anywhere under shared/)
      - analysis_report.path, when present, is safe and under shared/
    """
    if manifest.get("schema_version") != MANIFEST_SCHEMA_VERSION:
        raise ManifestIntegrityError(
            f"schema_version must be {MANIFEST_SCHEMA_VERSION!r}, "
            f"got {manifest.get('schema_version')!r}"
        )
    safety = manifest.get("safety") or {}
    if safety.get("requires_human_review") is not True:
        raise ManifestIntegrityError(
            "safety.requires_human_review must be True (Phase A invariant)"
        )
    # Phase D1 (manifest 1.2): editorial_polish_used + fallback_to_skeleton
    # are required booleans. The runner sets them; default-built manifest
    # carries False/False from the kwargs.
    for key in ("editorial_polish_used", "fallback_to_skeleton"):
        if key not in safety:
            raise ManifestIntegrityError(
                f"safety.{key} required in manifest schema {MANIFEST_SCHEMA_VERSION}"
            )
        if not isinstance(safety[key], bool):
            raise ManifestIntegrityError(
                f"safety.{key} must be bool, got {type(safety[key]).__name__}"
            )

    analysis_report = manifest.get("analysis_report") or {}
    ar_path = analysis_report.get("path")
    if ar_path is not None:
        if not is_safe_relative_path(ar_path):
            raise ManifestIntegrityError(
                f"analysis_report.path is not a safe relative path: {ar_path!r}"
            )
        if not ar_path.startswith(SHARED_SUBDIR + "/"):
            raise ManifestIntegrityError(
                f"analysis_report.path must live under {SHARED_SUBDIR}/, got {ar_path!r}"
            )

    artifacts = manifest.get("artifacts") or {}
    for key in ARTIFACT_KEYS_PHASE_A:
        if key not in artifacts:
            raise ManifestIntegrityError(f"missing required artifact key: {key}")
        _validate_artifact_record(key, artifacts[key], run_dir)

    buyer_content = artifacts.get("buyer_content") or {}
    for lang, lang_block in buyer_content.items():
        if not isinstance(lang_block, dict):
            raise ManifestIntegrityError(
                f"artifacts.buyer_content[{lang!r}] must be a dict"
            )
        for key in BUYER_CONTENT_ARTIFACT_KEYS_PHASE_A:
            if key not in lang_block:
                raise ManifestIntegrityError(
                    f"missing buyer_content[{lang}].{key}"
                )
            _validate_artifact_record(
                f"buyer_content[{lang}].{key}",
                lang_block[key],
                run_dir,
            )

    provenance = manifest.get("provenance") or {}
    for key, record in provenance.items():
        _validate_artifact_record(
            f"provenance.{key}",
            record,
            run_dir,
            require_under_subdir_prefix=True,
        )


def select_shipping_cardnews(
    manifest: dict,
    lang: str = "ko",
) -> str | None:
    """Return the relative path of the cardnews artifact that should
    ship for the given language, or None if no cardnews is `ok`.

    Selection rule (Run-003 QA pass-5):
      1. If `buyer_journey_cardnews_json.status == "ok"` → buyer-journey
         (10-15 slide layout — primary publishable artifact)
      2. Else if `editorial_cardnews_json.status == "ok"` → editorial
         (legacy 7-slide; fallback only)
      3. Else if `skeleton_cardnews_json.status == "ok"` → skeleton
         (legacy 7-slide; last-resort fallback)
      4. Else None

    Path is relative to run_dir; callers join against run_dir.
    """
    buyer_content = ((manifest.get("artifacts") or {}).get("buyer_content") or {})
    block = buyer_content.get(lang) or {}
    buyer_journey = block.get("buyer_journey_cardnews_json") or {}
    if buyer_journey.get("status") == "ok" and buyer_journey.get("path"):
        return buyer_journey["path"]
    editorial = block.get("editorial_cardnews_json") or {}
    if editorial.get("status") == "ok" and editorial.get("path"):
        return editorial["path"]
    skeleton = block.get("skeleton_cardnews_json") or {}
    if skeleton.get("status") == "ok" and skeleton.get("path"):
        return skeleton["path"]
    return None


def cardnews_presentation_summary(
    manifest: dict,
    lang: str = "ko",
) -> dict:
    """Operator-facing summary of which cardnews artifact ships and
    which legacy artifacts exist as fallbacks.

    Run-003 QA pass-5: downstream consumers (cardnews → Figma /
    Claude / etc.) need to know which JSON is the primary surface
    so they don't accidentally render the 7-slide legacy.
    """
    buyer_content = ((manifest.get("artifacts") or {}).get("buyer_content") or {})
    block = buyer_content.get(lang) or {}
    primary_path = select_shipping_cardnews(manifest, lang=lang)
    primary_kind = None
    if primary_path:
        if primary_path.endswith("buyer_journey_cardnews.json"):
            primary_kind = "buyer_journey_cardnews_json"
        elif primary_path.endswith("editorial_cardnews.json"):
            primary_kind = "editorial_cardnews_json"
        elif primary_path.endswith("instagram_cardnews.json"):
            primary_kind = "skeleton_cardnews_json"

    legacy_present = []
    for k in ("editorial_cardnews_json", "skeleton_cardnews_json"):
        rec = block.get(k) or {}
        if rec.get("status") == "ok" and k != primary_kind:
            legacy_present.append({"kind": k, "path": rec.get("path")})

    return {
        "lang": lang,
        "primary_kind": primary_kind,
        "primary_path": primary_path,
        "legacy_fallbacks_present": legacy_present,
    }
