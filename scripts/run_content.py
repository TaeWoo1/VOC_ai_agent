"""Content-engine entrypoint.

Reads an existing `analysis_report.json` (the single source of truth),
allocates a run directory under `outputs/` if one wasn't supplied,
copies the analysis report + canonical schema into `shared/`, and
writes a manifest. In Phase B (default) it also generates a Korean
Instagram cardnews JSON under `buyer_content/ko/` from the analysis
report; everything else under `buyer_content/` stays `skipped`.

This script DOES NOT:
  - run the scraper
  - touch the database
  - call any LLM
  - generate buyer content for Threads, X, or English
  - regenerate the seller PDF
  - modify the source analysis_report.json

It is a pure consumer of `analysis_report.json` and a pure writer of
files under the run directory. Run it after the seller-side analysis
pipeline has produced an analysis report.

Usage:
    # Default (Phase B): generate KO Instagram cardnews
    python scripts/run_content.py \\
        --report path/to/analysis_report.json \\
        --lang ko,en \\
        --channels instagram,threads,x \\
        --mock

    # Re-render into an existing run dir
    python scripts/run_content.py \\
        --report path/to/analysis_report.json \\
        --run-dir outputs/2026-04-29_romand-better-than-cheek_run-001

    # Phase A scaffold-only mode (manifest + skipped slots, no cardnews)
    python scripts/run_content.py \\
        --report path/to/analysis_report.json \\
        --phase a

The `--run-dir` flag points the script at an *existing* run directory
(re-render scenario). Without it, a new run dir is allocated under
`--output-base` (default: `outputs/`).

Failure mode for cardnews generation: if the analysis report has too
little material to satisfy the 2-bullet floor on any required slide,
or if the validator surfaces blocking flags, the run continues — the
manifest records `skeleton_cardnews_json.status = "failed"` with a
short reason in `notes`. Other artifacts and the manifest itself
remain valid. The CLI exit code stays 0; only top-level setup
errors (missing report, bad CLI args) raise SystemExit.

Phase C+ will add LLM polish, Threads, X, and English channels.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

from src.voc.content.angle_selection import (  # noqa: E402
    ANGLE_MODES,
    DEFAULT_ANGLE_MODE,
    AngleSelectionError,
    select_angle,
)
from src.voc.content.cardnews_generator import (  # noqa: E402
    CardnewsGenerationError,
    generate_instagram_cardnews_ko,
)
from src.voc.content.insight_brief import (  # noqa: E402
    INSIGHT_BRIEF_FILENAME,
    InsightBriefGenerationError,
    generate_consumer_insight_brief,
    validate_consumer_insight_brief,
)
from src.voc.content.llm.cache import PolishCache, default_cache_dir  # noqa: E402
from src.voc.content.llm.client import (  # noqa: E402
    DEFAULT_MODEL,
    DEFAULT_TEMPERATURE,
    AnthropicLLMClient,
    LLMClient,
)
from src.voc.content.manifest import (  # noqa: E402
    SUPPORTED_LANGS_PHASE_A,
    ArtifactRecord,
    ManifestBuildContext,
    build_phase_a_manifest,
    compute_sha256,
    detect_seller_artifacts,
    failed_record,
    skipped_record,
    validate_manifest,
    write_manifest,
)
from src.voc.content.paths import (  # noqa: E402
    BUYER_CONTENT_SUBDIR,
    SHARED_SUBDIR,
    allocate_run_dir,
    slugify,
)
from src.voc.content.polish.common import (  # noqa: E402
    DEFAULT_MAX_RETRIES,
    DEFAULT_POLISH_MODE,
    POLISH_MODES,
    PolishResult,
)
from src.voc.content.polish.instagram_ko import (  # noqa: E402
    polish_instagram_cardnews_ko,
)
from src.voc.content.schemas import (  # noqa: E402
    ANALYSIS_REPORT_SCHEMA_PATH,
    CONSUMER_INSIGHT_BRIEF_SCHEMA_PATH,
)
from src.voc.content.validators import (  # noqa: E402
    CardnewsValidationResult,
    validate_instagram_cardnews_ko,
)

DEFAULT_OUTPUT_BASE = REPO / "outputs"
ANALYSIS_REPORT_FILENAME = "analysis_report.json"
ANALYSIS_REPORT_SCHEMA_FILENAME = "analysis_report.schema.json"
CONSUMER_INSIGHT_BRIEF_SCHEMA_FILENAME = "consumer_insight_brief.schema.json"

INSTAGRAM_CARDNEWS_FILENAME = "instagram_cardnews.json"
INSTAGRAM_CARDNEWS_RELPATH_KO = (
    f"{BUYER_CONTENT_SUBDIR}/ko/{INSTAGRAM_CARDNEWS_FILENAME}"
)
EDITORIAL_CARDNEWS_FILENAME = "editorial_cardnews.json"
EDITORIAL_CARDNEWS_RELPATH_KO = (
    f"{BUYER_CONTENT_SUBDIR}/ko/{EDITORIAL_CARDNEWS_FILENAME}"
)
BUYER_JOURNEY_CARDNEWS_FILENAME = "buyer_journey_cardnews.json"
BUYER_JOURNEY_CARDNEWS_RELPATH_KO = (
    f"{BUYER_CONTENT_SUBDIR}/ko/{BUYER_JOURNEY_CARDNEWS_FILENAME}"
)
CONSUMER_INSIGHT_BRIEF_RELPATH = f"{SHARED_SUBDIR}/{INSIGHT_BRIEF_FILENAME}"

# Env var that lets `--llm-model` default move to a non-Haiku model
# without changing CLI invocation in production.
ENV_LLM_MODEL = "VOC_CONTENT_LLM_MODEL"
ENV_LLM_TEMPERATURE = "VOC_CONTENT_LLM_TEMPERATURE"


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="run_content",
        description="Allocate run dir, copy analysis report, generate "
                    "buyer-facing content (Phase B: KO Instagram cardnews "
                    "only), and write the manifest.",
    )
    p.add_argument(
        "--report",
        required=True,
        type=Path,
        help="Path to an existing analysis_report.json (single source of truth).",
    )
    p.add_argument(
        "--lang",
        default="ko",
        help="Comma-separated languages (default: ko). Phase B only generates "
             "KO content; other languages are reserved as `skipped` slots.",
    )
    p.add_argument(
        "--channels",
        default="instagram,threads,x",
        help="Comma-separated channels (default: instagram,threads,x). "
             "Phase B only generates the Instagram cardnews; Threads/X stay "
             "as `skipped` slots.",
    )
    p.add_argument(
        "--mock",
        action="store_true",
        help="Mock mode (no LLM, no network). Phase B is mock-only by design; "
             "this flag is accepted for forward-compat with Phase C+.",
    )
    p.add_argument(
        "--phase",
        default="b",
        choices=("a", "b"),
        help="`a` = scaffold-only (no cardnews). `b` = generate KO Instagram "
             "cardnews when ko in --lang and instagram in --channels (default).",
    )
    # ---------------- Phase D1 polish flags ----------------
    p.add_argument(
        "--no-llm",
        action="store_true",
        help="Skip the editorial LLM polish layer entirely. The skeleton "
             "cardnews is generated normally; editorial_cardnews_json "
             "is recorded as `skipped`.",
    )
    p.add_argument(
        "--llm-model",
        default=None,
        help=f"LLM model id. Default: {DEFAULT_MODEL}. Env override: "
             f"{ENV_LLM_MODEL}.",
    )
    p.add_argument(
        "--llm-temperature",
        type=float,
        default=None,
        help=f"LLM sampling temperature. Default: {DEFAULT_TEMPERATURE}. "
             f"Env override: {ENV_LLM_TEMPERATURE}.",
    )
    p.add_argument(
        "--llm-cache-dir",
        type=Path,
        default=None,
        help="Disk cache for editorial polish output. Defaults to "
             "~/.cache/voc-content-engine/polish (or VOC_CONTENT_LLM_CACHE_DIR).",
    )
    p.add_argument(
        "--angle-mode",
        default=DEFAULT_ANGLE_MODE,
        choices=ANGLE_MODES,
        help="How to pick the editorial angle from brief.angle_candidates. "
             "Default: auto.",
    )
    p.add_argument(
        "--polish-mode",
        default=DEFAULT_POLISH_MODE,
        choices=POLISH_MODES,
        help="`full` polishes every slide; `hook_only` polishes just slide 1. "
             "Default: full.",
    )
    p.add_argument(
        "--style-seed",
        type=int,
        default=None,
        help="Optional integer seed used as a phrasing-variation hint to "
             "the LLM. Different seeds produce different cache keys and "
             "may yield different polish output for the same skeleton+brief.",
    )
    p.add_argument(
        "--max-retries",
        type=int,
        default=DEFAULT_MAX_RETRIES,
        help=f"How many times to retry the polish call when validation "
             f"blocks. Default: {DEFAULT_MAX_RETRIES}.",
    )
    p.add_argument(
        "--run-dir",
        type=Path,
        default=None,
        help="Existing run directory to (re-)render into. If omitted, a new "
             "run dir is allocated under --output-base.",
    )
    p.add_argument(
        "--output-base",
        type=Path,
        default=DEFAULT_OUTPUT_BASE,
        help=f"Base directory for new run dirs (default: {DEFAULT_OUTPUT_BASE}).",
    )
    p.add_argument(
        "--product-name",
        default=None,
        help="Override product name for slug derivation. If omitted, the "
             "script reads product.name_ko / product.slug from the report.",
    )
    p.add_argument(
        "--product-slug",
        default=None,
        help="Override the derived slug entirely (e.g. for testing).",
    )
    p.add_argument(
        "--date",
        default=None,
        help="UTC date prefix YYYY-MM-DD (default: today UTC). Used only "
             "when allocating a new run dir.",
    )
    return p.parse_args(argv)


def _load_analysis_report(path: Path) -> dict:
    if not path.is_file():
        raise FileNotFoundError(f"analysis_report not found: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def _resolve_slug(args: argparse.Namespace, report: dict) -> str:
    if args.product_slug:
        return args.product_slug
    product = report.get("product") or {}
    if args.product_name:
        return slugify(args.product_name, source_url=product.get("source_url"))
    existing_slug = product.get("slug")
    if existing_slug:
        # Re-pass through slugify so callers can't smuggle an unsafe
        # slug into the path layer via a hand-edited analysis report.
        return slugify(existing_slug, source_url=product.get("source_url"))
    name = product.get("name_ko") or product.get("name_en")
    return slugify(name, source_url=product.get("source_url"))


def _resolve_run_dir(args: argparse.Namespace, slug: str) -> Path:
    if args.run_dir:
        run_dir = args.run_dir.resolve()
        if not run_dir.is_dir():
            raise FileNotFoundError(f"--run-dir does not exist: {run_dir}")
        # Guarantee subdirs exist (re-render into a partial layout).
        for sub in ("shared", "shared/provenance", "seller_report", "buyer_content"):
            (run_dir / sub).mkdir(parents=True, exist_ok=True)
        return run_dir
    date_str = args.date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return allocate_run_dir(date_str, slug, base=args.output_base)


def _copy_inputs_into_shared(report_src: Path, run_dir: Path) -> Path:
    """Copy the analysis report + canonical schemas into the run's
    shared/. Both `analysis_report.schema.json` and
    `consumer_insight_brief.schema.json` are copied so a re-render
    against a stale run dir can validate against the schema versions
    it was authored under, regardless of repo-side schema drift.

    Returns the relative path to the copied analysis_report.json.
    """
    shared = run_dir / SHARED_SUBDIR
    shared.mkdir(parents=True, exist_ok=True)
    target_report = shared / ANALYSIS_REPORT_FILENAME
    if report_src.resolve() != target_report.resolve():
        shutil.copy2(report_src, target_report)
    shutil.copy2(
        ANALYSIS_REPORT_SCHEMA_PATH,
        shared / ANALYSIS_REPORT_SCHEMA_FILENAME,
    )
    shutil.copy2(
        CONSUMER_INSIGHT_BRIEF_SCHEMA_PATH,
        shared / CONSUMER_INSIGHT_BRIEF_SCHEMA_FILENAME,
    )
    return Path(SHARED_SUBDIR) / ANALYSIS_REPORT_FILENAME


def _extract_analysis_report_extras(report: dict) -> dict:
    """Surface a few cheap-to-read provenance fields onto the manifest
    so an operator scanning manifest.json sees the headline numbers
    without opening the analysis report itself."""
    out: dict = {}
    if (sv := report.get("schema_version")) is not None:
        out["schema_version"] = sv
    corpus = report.get("corpus") or {}
    for key in ("n_reviews_total", "confidence_level", "signal_stability"):
        if (v := corpus.get(key)) is not None:
            out[key] = v
    return out


def _extract_collection_provenance(report: dict, run_dir: Path) -> dict:
    """Build the manifest 1.3 `collection` block from whatever scrape-
    provenance is reachable. The seller pipeline writes a few of these
    fields into the corpus block of the analysis report; others can be
    derived from the product source URL.

    Best-effort: missing fields are simply omitted. Never raises.
    """
    out: dict = {}
    product = report.get("product") or {}
    corpus = report.get("corpus") or {}
    url = product.get("source_url")
    if url:
        out["product_url"] = url
        # goodsNo extraction — OliveYoung URL pattern: ?goodsNo=A0000…
        import re as _re
        m = _re.search(r"[?&]goodsNo=([A-Za-z0-9]+)", url)
        if m:
            out["goodsNo"] = m.group(1)
    if (s := corpus.get("sampling_strategy")):
        # Map analysis-report sampling_strategy → manifest corpus_mode
        out["corpus_mode"] = (
            "observable_multi_sort"
            if s == "observable_multi_sort_corpus" else
            "primary_only"
        )
    if (n := corpus.get("n_reviews_analyzed")) is not None:
        out["review_count_analyzed"] = int(n)
    if (n := corpus.get("n_reviews_total")) is not None:
        out["review_count_collected"] = int(n)
    if (ps := corpus.get("primary_sort")):
        out["primary_sort"] = ps
    # Sorts attempted/succeeded — the analysis report does not yet
    # surface this directly. We probe a sidecar if it exists.
    sidecar = run_dir / SHARED_SUBDIR / "collection_summary.json"
    if sidecar.is_file():
        try:
            data = json.loads(sidecar.read_text(encoding="utf-8"))
            for key in ("sorts_attempted", "sorts_succeeded",
                        "partial_success"):
                if key in data:
                    out[key] = data[key]
        except (OSError, json.JSONDecodeError):
            pass
    return out


def _summarize_validation_failure(result) -> str:
    """One-line operator-readable summary of why validation blocked.
    Works for both CardnewsValidationResult and BriefValidationResult
    (both expose `.blocking`)."""
    blocking = getattr(result, "blocking", ())
    rules = sorted({f.rule for f in blocking})
    locs = [f"{f.rule}@{f.location}" for f in blocking[:3]]
    head = ", ".join(locs)
    extra = "" if len(blocking) <= 3 else f" (+{len(blocking) - 3} more)"
    return f"validation blocked by {len(rules)} rule(s): {head}{extra}"


def _attempt_consumer_insight_brief(
    report: dict,
    run_dir: Path,
) -> tuple[ArtifactRecord, dict | None, list[str]]:
    """Try to generate, validate, and write the consumer insight brief.

    Returns:
        (record, brief_dict_or_none, advisory_flag_rules) — the brief
        dict is returned so the cardnews generator can consume it
        without re-loading from disk. `record` is what the manifest
        registers under top-level `consumer_insight_brief_json`.

    Never raises. Generation/validation problems become a `failed`
    record with a `notes` field; the run continues — Phase B's
    skeleton cardnews can still be produced from the analysis report
    directly when no brief is available.
    """
    advisory_rules: list[str] = []
    target_rel = CONSUMER_INSIGHT_BRIEF_RELPATH
    target_abs = run_dir / target_rel
    target_abs.parent.mkdir(parents=True, exist_ok=True)

    # 1. Generate
    try:
        brief = generate_consumer_insight_brief(report)
    except InsightBriefGenerationError as exc:
        return (
            failed_record(f"insight brief generation failed: {exc}"),
            None,
            advisory_rules,
        )

    # 2. Validate
    result = validate_consumer_insight_brief(brief)
    advisory_rules.extend(sorted({f.rule for f in result.advisory}))
    if not result.ok:
        target_abs.write_text(
            json.dumps(brief, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        return (
            ArtifactRecord(
                status="failed",
                path=target_rel,
                sha256=compute_sha256(target_abs),
                bytes=target_abs.stat().st_size,
                notes=_summarize_validation_failure(result),
            ),
            None,
            advisory_rules,
        )

    # 3. Write
    target_abs.write_text(
        json.dumps(brief, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    record = ArtifactRecord(
        status="ok",
        path=target_rel,
        sha256=compute_sha256(target_abs),
        bytes=target_abs.stat().st_size,
    )
    return record, brief, advisory_rules


def _attempt_instagram_cardnews_ko(
    report: dict,
    run_dir: Path,
    brief: dict | None = None,
) -> tuple[ArtifactRecord, list[str]]:
    """Try to generate, validate, and write the KO Instagram cardnews.

    `brief` (Phase C+): when supplied, the cardnews generator prefers
    the brief over the analysis report for hook subtitle, slide-6
    best_for/not_for, and confidence_level. Without a brief, behavior
    is unchanged from Phase B.

    Returns:
        (record, advisory_flag_rules) — `record` is what the manifest
        registers under buyer_content.ko.skeleton_cardnews_json;
        `advisory_flag_rules` is a list of rule strings to merge
        into manifest.safety.advisory_flags.

    Never raises. Generation/validation problems become a `failed`
    record with a `notes` field; the calling pipeline continues.
    """
    advisory_rules: list[str] = []
    target_rel = INSTAGRAM_CARDNEWS_RELPATH_KO
    target_abs = run_dir / target_rel
    target_abs.parent.mkdir(parents=True, exist_ok=True)

    # 1. Generate
    try:
        cardnews = generate_instagram_cardnews_ko(report, brief=brief)
    except CardnewsGenerationError as exc:
        return failed_record(f"cardnews generation failed: {exc}"), advisory_rules

    # 2. Validate (defense-in-depth even though generator should already conform)
    result = validate_instagram_cardnews_ko(cardnews)
    advisory_rules.extend(sorted({f.rule for f in result.advisory}))

    if not result.ok:
        # Write the failed JSON for operator inspection — it's still
        # useful diagnostically. Path is recorded but status=failed
        # so manifest validation skips the sha existence check.
        target_abs.write_text(
            json.dumps(cardnews, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        return (
            ArtifactRecord(
                status="failed",
                path=target_rel,
                sha256=compute_sha256(target_abs),
                bytes=target_abs.stat().st_size,
                notes=_summarize_validation_failure(result),
            ),
            advisory_rules,
        )

    # 3. Write
    target_abs.write_text(
        json.dumps(cardnews, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    record = ArtifactRecord(
        status="ok",
        path=target_rel,
        sha256=compute_sha256(target_abs),
        bytes=target_abs.stat().st_size,
    )
    return record, advisory_rules


def _attempt_buyer_journey_cardnews_ko(
    report: dict,
    run_dir: Path,
    *,
    sorts_succeeded: list[str] | None = None,
    sorts_failed: list[str] | None = None,
    sorts_attempted: list[str] | None = None,
    partial_success: bool | None = None,
) -> ArtifactRecord:
    """Emit the 10-15 slide buyer-journey cardnews JSON.

    Additive surface — does NOT replace the existing skeleton /
    editorial cardnews. The buyer-journey JSON is the contract a
    downstream design skill (Figma / Claude / etc.) consumes to
    produce a richer narrative deck. See cardnews_buyer_journey.py
    for the slide schema.

    Never raises. On failure the function returns a `failed` record
    so the manifest still validates.
    """
    target_rel = BUYER_JOURNEY_CARDNEWS_RELPATH_KO
    target_abs = run_dir / target_rel
    target_abs.parent.mkdir(parents=True, exist_ok=True)

    try:
        from src.voc.content.cardnews_buyer_journey import (
            build_buyer_journey_cardnews,
        )
        cardnews = build_buyer_journey_cardnews(
            report,
            sorts_attempted=sorts_attempted,
            sorts_succeeded=sorts_succeeded,
            sorts_failed=sorts_failed,
            partial_success=partial_success,
        )
    except (ValueError, KeyError, TypeError) as exc:
        return failed_record(
            f"buyer journey cardnews build failed: {exc}",
        )

    target_abs.write_text(
        json.dumps(cardnews, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return ArtifactRecord(
        status="ok",
        path=target_rel,
        sha256=compute_sha256(target_abs),
        bytes=target_abs.stat().st_size,
    )


def _make_llm_client_factory(*, model: str, temperature: float):
    """Return a zero-arg callable that builds an LLMClient.

    Module-level seam so tests can monkeypatch this function to
    inject a `MockLLMClient` without touching the runner's code path.
    Production: returns an `AnthropicLLMClient`. Construction errors
    (missing API key, missing SDK) propagate to the caller, which
    catches and registers a `failed` editorial record.
    """
    def _factory() -> LLMClient:
        return AnthropicLLMClient(model=model, temperature=temperature)
    return _factory


def _resolve_llm_settings(args: argparse.Namespace) -> tuple[str, float, Path]:
    """Resolve `--llm-model`, `--llm-temperature`, `--llm-cache-dir`
    against env-var overrides and built-in defaults."""
    import os as _os
    model = args.llm_model or _os.environ.get(ENV_LLM_MODEL) or DEFAULT_MODEL
    if args.llm_temperature is not None:
        temperature = float(args.llm_temperature)
    elif (env_t := _os.environ.get(ENV_LLM_TEMPERATURE)):
        try:
            temperature = float(env_t)
        except ValueError:
            temperature = DEFAULT_TEMPERATURE
    else:
        temperature = DEFAULT_TEMPERATURE
    cache_dir = args.llm_cache_dir or default_cache_dir()
    return model, temperature, Path(cache_dir)


def _attempt_editorial_polish(
    report: dict,
    brief: dict,
    run_dir: Path,
    *,
    args: argparse.Namespace,
    llm_client_factory,
) -> tuple[ArtifactRecord, list[str], bool, bool]:
    """Run the Phase D1 editorial polish.

    Returns `(record, advisory_rules, editorial_polish_used,
    fallback_to_skeleton)`.

      - `record` registers under buyer_content.ko.editorial_cardnews_json.
      - `editorial_polish_used` is True iff a polish was attempted
        (even if it failed). False only when scope blocked the call.
      - `fallback_to_skeleton` is True iff the polish was attempted
        and ended in failure → the skeleton is the shipping artifact.

    Never raises. Bad LLM keys / network errors / validator failures
    all become `status="failed"` records.
    """
    advisory_rules: list[str] = []
    target_rel = EDITORIAL_CARDNEWS_RELPATH_KO
    target_abs = run_dir / target_rel
    target_abs.parent.mkdir(parents=True, exist_ok=True)

    # 1. Pick angle from the brief (deterministic).
    candidates = list(brief.get("angle_candidates") or [])
    suggestions = (
        ((brief.get("channel_angle_recommendations") or {}).get("instagram") or {})
        .get("suggested_angle_ids")
    )
    try:
        selected = select_angle(candidates, suggestions, mode=args.angle_mode)
    except AngleSelectionError as exc:
        return (
            failed_record(f"angle selection failed: {exc}"),
            advisory_rules,
            True, True,
        )

    # 2. Build the LLM client. Failure (e.g. missing API key /
    # missing anthropic SDK) → graceful no-polish fallback: persist
    # the deterministic skeleton as the editorial artifact so
    # downstream consumers (manifest readers, content viewers) see a
    # valid cardnews JSON at the editorial path. This mirrors the
    # contract that "editorial_cardnews_json.status == ok" means
    # "the file at .path is a valid cardnews"; the deterministic
    # skeleton already satisfies that schema.
    try:
        llm_client = llm_client_factory()
    except Exception as exc:
        try:
            skeleton = generate_instagram_cardnews_ko(report, brief=brief)
            target_abs.write_text(
                json.dumps(skeleton, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            note = (
                f"LLM unavailable ({type(exc).__name__}: {exc}); "
                f"persisted deterministic skeleton as editorial fallback "
                f"(no LLM polish applied)."
            )
            return (
                ArtifactRecord(
                    status="ok",
                    path=target_rel,
                    sha256=compute_sha256(target_abs),
                    bytes=target_abs.stat().st_size,
                    notes=note,
                ),
                advisory_rules,
                False,  # editorial_polish_used: no polish was attempted
                True,   # fallback_to_skeleton: the shipping artifact IS the skeleton
            )
        except Exception as inner_exc:
            return (
                failed_record(
                    f"LLM unavailable AND skeleton fallback failed: "
                    f"{type(exc).__name__}: {exc}; "
                    f"fallback_error={type(inner_exc).__name__}: {inner_exc}"
                ),
                advisory_rules,
                True, True,
            )

    # 3. Regenerate skeleton in-process for the polish layer to consume.
    # We already wrote it to disk in the cardnews step; re-using the
    # dict avoids a redundant read.
    try:
        skeleton = generate_instagram_cardnews_ko(report, brief=brief)
    except CardnewsGenerationError as exc:
        return (
            failed_record(f"editorial polish: skeleton regen failed: {exc}"),
            advisory_rules,
            True, True,
        )

    cache = PolishCache(args.llm_cache_dir or default_cache_dir())
    result: PolishResult = polish_instagram_cardnews_ko(
        skeleton, brief, selected,
        llm_client=llm_client,
        cache=cache,
        polish_mode=args.polish_mode,
        max_retries=int(args.max_retries),
        style_seed=args.style_seed,
        analysis_report=report,
    )

    # 4. Persist editorial JSON for operator audit (even on failure).
    if result.cardnews is not None:
        target_abs.write_text(
            json.dumps(result.cardnews, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        rec_path: str | None = target_rel
        rec_sha: str | None = compute_sha256(target_abs)
        rec_bytes: int | None = target_abs.stat().st_size
    else:
        rec_path, rec_sha, rec_bytes = None, None, None

    if result.status == "ok":
        record = ArtifactRecord(
            status="ok", path=rec_path, sha256=rec_sha, bytes=rec_bytes,
        )
    else:
        notes_parts = [result.notes or "editorial polish failed"]
        for f in (result.blocking_flags or ())[:3]:
            notes_parts.append(f"{f.rule}@{f.location}")
        record = ArtifactRecord(
            status="failed",
            path=rec_path,
            sha256=rec_sha,
            bytes=rec_bytes,
            notes="; ".join(notes_parts),
        )

    advisory_rules.extend(sorted({f.rule for f in (result.advisory_flags or ())}))
    return record, advisory_rules, True, result.fallback_used


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    languages = tuple(s.strip() for s in args.lang.split(",") if s.strip())
    channels = tuple(s.strip() for s in args.channels.split(",") if s.strip())
    if not languages:
        raise SystemExit("--lang must list at least one language")
    if not channels:
        raise SystemExit("--channels must list at least one channel")
    unsupported = [l for l in languages if l not in SUPPORTED_LANGS_PHASE_A]
    if unsupported:
        raise SystemExit(
            f"Supported langs {SUPPORTED_LANGS_PHASE_A}; got {unsupported}"
        )

    report_path = args.report.resolve()
    report = _load_analysis_report(report_path)
    slug = _resolve_slug(args, report)
    run_dir = _resolve_run_dir(args, slug)
    analysis_report_relpath = _copy_inputs_into_shared(report_path, run_dir)

    product = dict(report.get("product") or {})
    product.setdefault("slug", slug)

    # Phase C: generate the consumer insight brief BEFORE cardnews.
    # Brief failure is isolated — the cardnews generator falls back
    # to reading analysis_report directly when no brief is supplied.
    advisory_flags: list[str] = []
    brief_status_for_log: str = "skipped"
    brief_record: ArtifactRecord
    brief: dict | None = None
    if args.phase == "b":
        brief_record, brief, brief_advisory = _attempt_consumer_insight_brief(
            report, run_dir
        )
        brief_status_for_log = brief_record.status
        advisory_flags.extend(brief_advisory)
    else:
        brief_record = skipped_record(
            "Phase A scaffold mode: consumer insight brief not generated"
        )

    # Phase B: try to generate KO Instagram cardnews when scope matches.
    buyer_content_records: dict[str, dict[str, ArtifactRecord]] = {}
    cardnews_status_for_log: str = "skipped"
    skeleton_ok = False
    if (
        args.phase == "b"
        and "ko" in languages
        and "instagram" in channels
    ):
        rec, advisory = _attempt_instagram_cardnews_ko(report, run_dir, brief=brief)
        cardnews_status_for_log = rec.status
        skeleton_ok = rec.status == "ok"
        buyer_content_records.setdefault("ko", {})["skeleton_cardnews_json"] = rec
        advisory_flags.extend(advisory)
        # Buyer-journey cardnews JSON: 10-15 slide narrative for a
        # downstream design skill (Figma / Claude / etc.) to consume.
        # Gated on `skeleton_ok` so a sparse report that can't even
        # produce the 7-slide scaffold also doesn't emit a richer
        # journey JSON — the operator gets a single, consistent
        # "skipped" signal across both cardnews artifacts.
        if skeleton_ok:
            bj_rec = _attempt_buyer_journey_cardnews_ko(report, run_dir)
        else:
            bj_rec = skipped_record(
                "buyer_journey_cardnews skipped because skeleton "
                "cardnews was not generated successfully"
            )
        buyer_content_records.setdefault("ko", {})[
            "buyer_journey_cardnews_json"
        ] = bj_rec
    else:
        # Explicit skipped record carrying a phase-aware reason.
        reason = (
            "Phase A scaffold mode: cardnews not generated"
            if args.phase == "a"
            else "Phase B: ko/instagram out of --lang/--channels scope"
        )
        if "ko" in languages:
            buyer_content_records.setdefault("ko", {})[
                "skeleton_cardnews_json"
            ] = skipped_record(reason)

    # Phase D1: editorial polish for KO Instagram, gated on
    # (--no-llm OFF, scope matches, skeleton+brief both ok).
    editorial_status_for_log: str = "skipped"
    editorial_polish_used: bool = False
    fallback_to_skeleton: bool = False
    polish_blocked_reason: str | None = None
    if args.no_llm:
        polish_blocked_reason = "Phase D1: --no-llm flag set"
    elif args.phase != "b":
        polish_blocked_reason = (
            "Phase A scaffold mode: editorial polish not run"
        )
    elif "ko" not in languages or "instagram" not in channels:
        polish_blocked_reason = (
            "Phase D1: ko/instagram out of --lang/--channels scope"
        )
    elif not skeleton_ok:
        polish_blocked_reason = (
            "Phase D1: skeleton cardnews not ok — editorial polish skipped"
        )
    elif brief is None:
        polish_blocked_reason = (
            "Phase D1: brief unavailable — editorial polish skipped"
        )

    if polish_blocked_reason is None:
        # Build factory closure so client construction failures surface
        # as `failed` records rather than crashing the run.
        model, temperature, _cache_dir = _resolve_llm_settings(args)
        factory = _make_llm_client_factory(model=model, temperature=temperature)

        rec_e, advisory_e, polish_used, fallback_used = (
            _attempt_editorial_polish(
                report, brief, run_dir,
                args=args,
                llm_client_factory=factory,
            )
        )
        editorial_status_for_log = rec_e.status
        editorial_polish_used = polish_used
        fallback_to_skeleton = fallback_used
        buyer_content_records.setdefault("ko", {})[
            "editorial_cardnews_json"
        ] = rec_e
        advisory_flags.extend(advisory_e)
    else:
        if "ko" in languages:
            buyer_content_records.setdefault("ko", {})[
                "editorial_cardnews_json"
            ] = skipped_record(polish_blocked_reason)

    ctx = ManifestBuildContext(
        run_dir=run_dir,
        product=product,
        analysis_report_path=str(analysis_report_relpath).replace("\\", "/"),
        analysis_report_extras=_extract_analysis_report_extras(report),
        languages=languages,
        config={
            "affiliate_enabled": False,
            "image_style": "editorial_pastel",
            "languages": list(languages),
            "channels": list(channels),
            "mock": bool(args.mock),
            "phase": args.phase.upper(),
            "no_llm": bool(args.no_llm),
            "angle_mode": args.angle_mode,
            "polish_mode": args.polish_mode,
            "style_seed": args.style_seed,
        },
        collection=_extract_collection_provenance(report, run_dir),
    )

    # Manifest 1.3 — auto-detect seller-side artifacts on disk so the
    # manifest reflects reality. Without this, the seller PDF (written
    # by a separate subprocess) shows status=skipped even when present.
    detected = detect_seller_artifacts(run_dir)

    manifest = build_phase_a_manifest(
        ctx,
        seller_report_record=detected.get("seller_report_ko_pdf"),
        interview_hooks_record=detected.get("interview_hooks_json"),
        consumer_insight_brief_record=brief_record,
        buyer_content_records=buyer_content_records or None,
        safety_advisory_flags=advisory_flags or None,
        safety_editorial_polish_used=editorial_polish_used,
        safety_fallback_to_skeleton=fallback_to_skeleton,
    )
    validate_manifest(manifest, run_dir)
    manifest_path = write_manifest(run_dir, manifest)

    print(f"run_dir: {run_dir}")
    print(f"manifest: {manifest_path}")
    print(f"analysis_report: {run_dir / analysis_report_relpath}")
    print(f"consumer_insight_brief: {brief_status_for_log}")
    print(f"ko/skeleton_cardnews: {cardnews_status_for_log}")
    print(f"ko/editorial_cardnews: {editorial_status_for_log}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
