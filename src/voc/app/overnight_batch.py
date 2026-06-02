"""Helpers for the overnight OliveYoung batch runner.

This module owns the *classification* and *aggregation* logic that
turns one product's pipeline / republish / inspect outcome into a
summary row, and that turns a batch's worth of rows into a final
`summary.json` plus a resumable `failed_products.csv`.

The shell runner (`scripts/run_oy_top8_interview_batch.sh`) handles
orchestration only — preflight, pipeline invocation, sleep jitter.
Everything that needs to be tested or reasoned about (status
classification, auth detection, JSON aggregation) lives here.

Why separated
-------------
The previous overnight batch had three quiet bugs:

  1. summary.tsv rows could shift columns when a status string
     contained whitespace, because the bash printf used positional
     args and an empty exit code propagated as `""`.
  2. anti-bot / scraper_subprocess_failed logs were not promoted to
     a product-level status; operators saw `pipeline_failed` and had
     to grep logs to know whether to re-login.
  3. there was no resumable artifact — failed products had to be
     hand-typed back into the input CSV.

This module fixes all three by producing a typed `ProductOutcome`
record per product, then aggregating those into JSON + CSV
artifacts that downstream tools can re-consume.

Public CLI
----------
Two subcommands keyed off the same TSV/JSON files:

    python3 -m src.voc.app.overnight_batch classify \\
        --batch-dir logs/batch_runs/<BATCH_ID> \\
        --rank 3 --profile base_makeup --goodsNo A000... \\
        --slug tirtir_red_cushion --run-dir outputs/... \\
        --pipeline-exit 0 --republish-exit 0 --inspect-exit 0 \\
        --log-path logs/batch_runs/<BATCH_ID>/3_*.log

    python3 -m src.voc.app.overnight_batch finalize \\
        --batch-dir logs/batch_runs/<BATCH_ID>

`classify` writes one row to `summary.tsv` and one sidecar JSON
under `<batch_dir>/products/<rank>_<goodsNo>.json`. `finalize`
reads all sidecars and writes `summary.json` + `failed_products.csv`.
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any


# Product-level status enum (string sentinels — kept stable for
# downstream tooling and tests).
STATUS_PUBLISHABLE = "publishable"
STATUS_FINAL_SAMPLE_READY = "final_sample_ready"
STATUS_COMPLETED_WITH_WARNINGS = "completed_with_warnings"
STATUS_INSUFFICIENT_CORPUS = "insufficient_corpus"
STATUS_PIPELINE_FAILED = "pipeline_failed"
STATUS_AUTH_REQUIRED = "auth_required"
STATUS_ANTI_BOT_PAUSE_REQUIRED = "anti_bot_pause_required"
STATUS_PREFLIGHT_FAILED = "preflight_failed"
STATUS_SKIPPED = "skipped"

# A status counts as "needs operator re-login" (the auth-failure
# bucket) when it's one of these. Used by --stop-after-auth-failures
# and by the failed_products.csv extractor.
AUTH_BUCKET_STATUSES = frozenset(
    {STATUS_AUTH_REQUIRED, STATUS_ANTI_BOT_PAUSE_REQUIRED, STATUS_PREFLIGHT_FAILED}
)

# Statuses that go into failed_products.csv for resume. We include
# `pipeline_failed` and `insufficient_corpus` too — operators usually
# want to retry both after re-login or session refresh.
RESUMABLE_STATUSES = frozenset(
    {
        STATUS_AUTH_REQUIRED,
        STATUS_ANTI_BOT_PAUSE_REQUIRED,
        STATUS_PREFLIGHT_FAILED,
        STATUS_PIPELINE_FAILED,
        STATUS_INSUFFICIENT_CORPUS,
    }
)

# When pipeline / republish / inspect was NOT run, exit code is
# always 999 — never empty, never None. The bash runner relies on
# this sentinel to keep TSV columns aligned.
EXIT_NOT_RUN = 999

# Quality-gate thresholds. `INSUFFICIENT_CORPUS_FLOOR` is the lower
# bound below which a run is "sample-only" — not pipeline-failed,
# but not strong enough for the final product brief either.
INSUFFICIENT_CORPUS_FLOOR = 300
FINAL_SAMPLE_READY_FLOOR = 500


# Log substrings that escalate a sort failure to a product-level
# auth/anti-bot status. Drawn from real failure logs in
# logs/batch_runs/oy_top8_real_*/4_A0..71261_*.log and 2_A0..05555_*.log.
_ANTI_BOT_LOG_PATTERNS = (
    r"classified as 'anti_bot'",
    r"classified as \"anti_bot\"",
    r"status=scraper_subprocess_failed",
    r"anti_bot_pause_required",
)
_AUTH_WALL_LOG_PATTERNS = (
    r"auth_wall",
    r"auth_required",
    r"login_required",
    r"Re-establish auth",
    r"re-establish auth",
)


@dataclass
class ProductOutcome:
    """One product's full classification record. Serialized to a
    sidecar JSON under `<batch_dir>/products/<rank>_<goodsNo>.json`.
    Field order is intentional — sidecar JSON is human-readable.
    """

    rank: str
    profile: str
    goodsNo: str
    slug: str
    run_dir: str
    pipeline_exit: int
    republish_exit: int
    inspect_exit: int
    status: str

    # Quality / collection details (best-effort from
    # collection_summary.json + analysis_report.json + log file).
    review_count_analyzed: int | None = None
    sorts_succeeded: list[str] = field(default_factory=list)
    sorts_failed: list[str] = field(default_factory=list)
    partial_success: bool | None = None
    failure_reason: str | None = None
    pdf_exists: bool = False
    manifest_exists: bool = False
    cardnews_exists: bool = False
    log_path: str | None = None
    auth_indicator: bool = False

    def to_tsv_row(self) -> str:
        """Format the canonical 9-field TSV row for summary.tsv.

        Field count is invariant. Exit codes are always numeric.
        Status is the LAST field — never split, never quoted, never
        contains whitespace.
        """
        fields_ = [
            str(self.rank),
            str(self.profile),
            str(self.goodsNo),
            str(self.slug),
            str(self.run_dir),
            str(int(self.pipeline_exit)),
            str(int(self.republish_exit)),
            str(int(self.inspect_exit)),
            str(self.status),
        ]
        # Hard guard against status with embedded whitespace or tabs
        # — that's the bug the prior runner had.
        for f in fields_:
            assert "\t" not in f, f"TSV field contains tab: {f!r}"
            assert "\n" not in f, f"TSV field contains newline: {f!r}"
        assert len(fields_) == 9
        return "\t".join(fields_)


TSV_HEADER = (
    "rank\tprofile\tgoodsNo\tslug\trun_dir\tpipeline_exit\trepublish_exit\t"
    "inspect_exit\tstatus"
)


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    except (OSError, json.JSONDecodeError):
        return None


def is_auth_failure_log(log_text: str) -> bool:
    """Return True iff the product log shows auth-wall or anti-bot
    classification. Used to escalate a pipeline_failed exit into
    `auth_required` / `anti_bot_pause_required`, which is what tells
    the operator to re-login (vs. re-running blindly).
    """
    if not log_text:
        return False
    for pat in _ANTI_BOT_LOG_PATTERNS + _AUTH_WALL_LOG_PATTERNS:
        if re.search(pat, log_text):
            return True
    return False


def _classify_auth_subtype(log_text: str) -> str:
    """Map a log to either `auth_required` or
    `anti_bot_pause_required`. We prefer `anti_bot_pause_required`
    when the scraper subprocess itself was flagged anti-bot — this
    distinguishes "operator must re-login" from "session is too
    fingerprinted, needs cooldown."
    """
    if not log_text:
        return STATUS_PIPELINE_FAILED
    for pat in _ANTI_BOT_LOG_PATTERNS:
        if re.search(pat, log_text):
            return STATUS_ANTI_BOT_PAUSE_REQUIRED
    for pat in _AUTH_WALL_LOG_PATTERNS:
        if re.search(pat, log_text):
            return STATUS_AUTH_REQUIRED
    return STATUS_PIPELINE_FAILED


def _check_artifacts(run_dir: Path) -> tuple[bool, bool, bool]:
    """Return (pdf_exists, manifest_exists, cardnews_exists)."""
    pdf = (run_dir / "seller_report" / "seller_report_ko.pdf").is_file()
    manifest = (run_dir / "manifest.json").is_file()
    cardnews_dir = run_dir / "buyer_content" / "ko"
    cardnews_alt = run_dir / "cardnews"
    cardnews = (
        (cardnews_dir.is_dir() and any(cardnews_dir.iterdir()))
        or (cardnews_alt.is_dir() and any(cardnews_alt.iterdir()))
    )
    return pdf, manifest, cardnews


def classify_product_outcome(
    *,
    rank: str,
    profile: str,
    goodsNo: str,
    slug: str,
    run_dir: Path | str,
    pipeline_exit: int,
    republish_exit: int,
    inspect_exit: int,
    log_path: Path | str | None = None,
    log_text: str | None = None,
    preflight_ok: bool = True,
    skipped: bool = False,
) -> ProductOutcome:
    """Build a ProductOutcome record by reading run-dir artifacts and
    the product log. The function is pure-ish: it does no network
    I/O and no DB access. It only reads files under `run_dir` and
    the log path.

    Status precedence (top wins):
      preflight_failed → skipped → auth_required / anti_bot_pause_required
      → pipeline_failed → insufficient_corpus → completed_with_warnings
      → publishable → final_sample_ready

    `final_sample_ready` is a SUPERSET of `publishable` (it implies
    publishable + ≥500 analyzed reviews + RATING_ASC succeeded +
    no partial_success). The runner picks the strongest status.
    """
    run_dir_p = Path(run_dir)
    if log_text is None and log_path is not None:
        try:
            log_text = Path(log_path).read_text(encoding="utf-8", errors="replace")
        except OSError:
            log_text = ""
    log_text = log_text or ""

    collection = _read_json(run_dir_p / "shared" / "collection_summary.json") or {}
    review_count = collection.get("review_count_analyzed")
    sorts_succeeded = list(collection.get("sorts_succeeded") or [])
    sorts_failed = list(collection.get("sorts_failed") or [])
    partial_success = collection.get("partial_success")

    pdf_exists, manifest_exists, cardnews_exists = _check_artifacts(run_dir_p)

    auth_indicator = is_auth_failure_log(log_text)

    base = ProductOutcome(
        rank=str(rank),
        profile=str(profile),
        goodsNo=str(goodsNo),
        slug=str(slug),
        run_dir=str(run_dir_p),
        pipeline_exit=int(pipeline_exit),
        republish_exit=int(republish_exit),
        inspect_exit=int(inspect_exit),
        status=STATUS_PIPELINE_FAILED,
        review_count_analyzed=review_count,
        sorts_succeeded=sorts_succeeded,
        sorts_failed=sorts_failed,
        partial_success=partial_success,
        pdf_exists=pdf_exists,
        manifest_exists=manifest_exists,
        cardnews_exists=cardnews_exists,
        log_path=str(log_path) if log_path else None,
        auth_indicator=auth_indicator,
    )

    if not preflight_ok:
        base.status = STATUS_PREFLIGHT_FAILED
        base.failure_reason = "cdp_or_session_preflight_failed"
        return base

    if skipped:
        base.status = STATUS_SKIPPED
        base.failure_reason = "skipped_by_runner"
        return base

    if pipeline_exit != 0:
        if auth_indicator:
            base.status = _classify_auth_subtype(log_text)
            base.failure_reason = (
                "anti_bot_classification" if base.status == STATUS_ANTI_BOT_PAUSE_REQUIRED
                else "auth_wall_detected"
            )
        else:
            base.status = STATUS_PIPELINE_FAILED
            base.failure_reason = f"pipeline_exit={pipeline_exit}"
        return base

    # Pipeline succeeded. Analyze quality.
    inspect_passed = bool(re.search(r"all checks passed", log_text))

    # Insufficient-corpus rule (per spec §F):
    #   review_count_analyzed < 300 OR RATING_ASC missing from
    #   sorts_succeeded → insufficient_corpus.
    rating_asc_succeeded = "RATING_ASC" in sorts_succeeded
    if (
        (review_count is not None and review_count < INSUFFICIENT_CORPUS_FLOOR)
        or not rating_asc_succeeded
    ):
        base.status = STATUS_INSUFFICIENT_CORPUS
        base.failure_reason = (
            "rating_asc_missing"
            if not rating_asc_succeeded
            else f"review_count_analyzed={review_count}<{INSUFFICIENT_CORPUS_FLOOR}"
        )
        return base

    if not inspect_passed:
        base.status = STATUS_COMPLETED_WITH_WARNINGS
        base.failure_reason = "inspect_warnings_present"
        return base

    # All inspect checks passed. Check for "final sample ready"
    # promotion: ≥500 reviews, partial_success=False, RATING_ASC
    # succeeded, all artifacts present.
    if (
        review_count is not None
        and review_count >= FINAL_SAMPLE_READY_FLOOR
        and partial_success is False
        and rating_asc_succeeded
        and pdf_exists
        and manifest_exists
        and cardnews_exists
    ):
        base.status = STATUS_FINAL_SAMPLE_READY
        return base

    base.status = STATUS_PUBLISHABLE
    return base


# ---------- Input parsing -------------------------------------------------

# Two CSV shapes are accepted:
#   4-column (the original input):
#     rank,profile,goodsNo,slug
#   8-column (the failed_products.csv resume file):
#     rank,profile,goodsNo,slug,reason,last_status,run_dir,log_path
# In the 8-column case the runner treats `reason / last_status / run_dir
# / log_path` as informational only; pipeline runs fresh.
_INPUT_BASE_COLS = ("rank", "profile", "goodsNo", "slug")


def parse_batch_input_csv(path: Path | str) -> list[dict[str, str]]:
    """Read a batch input CSV and return one dict per product row.

    Accepts both the canonical 4-column input and the wider 8-column
    failed_products.csv shape. Empty rows are skipped. Header row is
    detected by the first column being literally `rank`.
    """
    p = Path(path)
    rows: list[dict[str, str]] = []
    with p.open(encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh)
        for r in reader:
            if not r.get("goodsNo"):
                continue
            entry = {
                col: (r.get(col) or "").strip() for col in _INPUT_BASE_COLS
            }
            for extra in ("reason", "last_status", "run_dir", "log_path"):
                if r.get(extra):
                    entry[extra] = r[extra].strip()
            if not entry["rank"] or not entry["goodsNo"]:
                continue
            rows.append(entry)
    return rows


# ---------- Aggregation: summary.json + failed_products.csv ---------------


def aggregate_summary_json(
    outcomes: list[ProductOutcome],
    *,
    batch_id: str,
    requested_max_reviews_per_sort: int | None,
) -> dict[str, Any]:
    """Reduce a list of ProductOutcome rows into a summary.json
    payload. The payload is operator-readable and is the canonical
    *machine* artifact that summary.tsv is a pretty-printed view of.
    """
    counts: dict[str, int] = {
        "total": len(outcomes),
        STATUS_PUBLISHABLE: 0,
        STATUS_FINAL_SAMPLE_READY: 0,
        STATUS_COMPLETED_WITH_WARNINGS: 0,
        STATUS_INSUFFICIENT_CORPUS: 0,
        STATUS_PIPELINE_FAILED: 0,
        STATUS_AUTH_REQUIRED: 0,
        STATUS_ANTI_BOT_PAUSE_REQUIRED: 0,
        STATUS_PREFLIGHT_FAILED: 0,
        STATUS_SKIPPED: 0,
    }
    for o in outcomes:
        if o.status in counts:
            counts[o.status] += 1

    products_payload = []
    for o in outcomes:
        d = asdict(o)
        # Drop noisy fields that are pure log paths from the JSON
        # body — keep them on the per-product sidecar.
        d.pop("auth_indicator", None)
        products_payload.append(d)

    cap = (
        5 * int(requested_max_reviews_per_sort)
        if requested_max_reviews_per_sort is not None
        else None
    )

    return {
        "schema_version": "1.0",
        "batch_id": batch_id,
        "requested_max_reviews_per_sort": requested_max_reviews_per_sort,
        "theoretical_raw_cap_per_product": cap,
        "counts": counts,
        "products": products_payload,
    }


_FAILED_CSV_HEADER = (
    "rank", "profile", "goodsNo", "slug",
    "reason", "last_status", "run_dir", "log_path",
)


def extract_failed_products_csv_rows(
    outcomes: list[ProductOutcome],
) -> list[dict[str, str]]:
    """Pick the products that should land in failed_products.csv for
    a resume run. See RESUMABLE_STATUSES for the membership rule.
    """
    rows: list[dict[str, str]] = []
    for o in outcomes:
        if o.status not in RESUMABLE_STATUSES:
            continue
        rows.append(
            {
                "rank": o.rank,
                "profile": o.profile,
                "goodsNo": o.goodsNo,
                "slug": o.slug,
                "reason": o.failure_reason or "",
                "last_status": o.status,
                "run_dir": o.run_dir,
                "log_path": o.log_path or "",
            }
        )
    return rows


def write_failed_products_csv(
    rows: list[dict[str, str]],
    out_path: Path | str,
) -> Path:
    p = Path(out_path)
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(_FAILED_CSV_HEADER))
        writer.writeheader()
        for r in rows:
            writer.writerow(r)
    return p


# ---------- TSV: authoritative regeneration + validation ------------------


def _read_outcome_sidecars(products_dir: Path) -> list[ProductOutcome]:
    """Load every `<rank>_<goodsNo>.json` sidecar under products_dir.
    Sorted by integer rank where possible, then by goodsNo to keep
    the order stable for tests.
    """
    outcomes: list[ProductOutcome] = []
    if not products_dir.is_dir():
        return outcomes
    for sidecar in sorted(products_dir.glob("*.json")):
        data = _read_json(sidecar) or {}
        valid = {
            k: v
            for k, v in data.items()
            if k in ProductOutcome.__dataclass_fields__
        }
        try:
            outcomes.append(ProductOutcome(**valid))
        except TypeError:
            # malformed sidecar — skip rather than crash finalize.
            continue

    def _rank_key(o: ProductOutcome) -> tuple[int, str]:
        try:
            return (int(o.rank), o.goodsNo)
        except (TypeError, ValueError):
            return (10**9, o.goodsNo)

    outcomes.sort(key=_rank_key)
    return outcomes


def regenerate_summary_tsv_from_sidecars(batch_dir: Path | str) -> Path:
    """Build `summary.tsv` from the per-product sidecar JSONs under
    `<batch_dir>/products/`. This is the authoritative TSV path: the
    bash runner does not append rows during the loop, because the
    bash↔python boundary made it possible for column counts to drift.

    Atomic: writes to a `.tmp` and renames, so a partial run never
    leaves an unparseable summary.tsv.
    """
    batch_p = Path(batch_dir)
    products_dir = batch_p / "products"
    summary_tsv = batch_p / "summary.tsv"
    tmp = summary_tsv.with_suffix(".tsv.tmp")

    outcomes = _read_outcome_sidecars(products_dir)

    with tmp.open("w", encoding="utf-8") as fh:
        fh.write(TSV_HEADER + "\n")
        for o in outcomes:
            fh.write(o.to_tsv_row() + "\n")

    tmp.replace(summary_tsv)
    return summary_tsv


def validate_summary_tsv(path: Path | str) -> list[str]:
    """Return a list of error strings for any line in summary.tsv
    that doesn't satisfy the 9-field invariant. Empty list = OK.

    We read line-by-line on the actual file (not on the
    ProductOutcome objects) so this catches any divergence introduced
    by manual edits or external tooling.
    """
    p = Path(path)
    if not p.is_file():
        return [f"summary.tsv missing at {p}"]
    errors: list[str] = []
    with p.open(encoding="utf-8") as fh:
        for lineno, raw in enumerate(fh, 1):
            line = raw.rstrip("\n")
            if line == "":
                continue
            field_count = len(line.split("\t"))
            if field_count != 9:
                errors.append(
                    f"line {lineno}: expected 9 tab-separated fields, got {field_count}: {line!r}"
                )
    return errors


def validate_tsv_json_consistency(
    tsv_path: Path | str,
    json_path: Path | str,
) -> list[str]:
    """Cross-check that every row in summary.tsv appears in
    summary.json with matching exit codes and status. Both files are
    derived from the same sidecars, so any drift signals corruption.
    """
    tsv_p = Path(tsv_path)
    json_p = Path(json_path)
    if not tsv_p.is_file():
        return [f"summary.tsv missing at {tsv_p}"]
    if not json_p.is_file():
        return [f"summary.json missing at {json_p}"]

    summary = _read_json(json_p) or {}
    products_by_goodsNo = {
        p.get("goodsNo"): p for p in (summary.get("products") or [])
    }

    errors: list[str] = []
    with tsv_p.open(encoding="utf-8") as fh:
        header = fh.readline().rstrip("\n").split("\t")
        if header != TSV_HEADER.split("\t"):
            errors.append(f"summary.tsv header mismatch: {header}")
        for lineno, raw in enumerate(fh, 2):
            line = raw.rstrip("\n")
            if not line:
                continue
            parts = line.split("\t")
            if len(parts) != 9:
                errors.append(f"line {lineno}: field count {len(parts)} != 9")
                continue
            (rank, profile, goodsNo, slug, run_dir,
             p_exit, r_exit, i_exit, status) = parts
            ref = products_by_goodsNo.get(goodsNo)
            if ref is None:
                errors.append(f"line {lineno}: goodsNo={goodsNo} missing from summary.json")
                continue
            if str(ref.get("pipeline_exit")) != p_exit:
                errors.append(
                    f"line {lineno}: pipeline_exit mismatch tsv={p_exit} json={ref.get('pipeline_exit')}"
                )
            if str(ref.get("republish_exit")) != r_exit:
                errors.append(
                    f"line {lineno}: republish_exit mismatch tsv={r_exit} json={ref.get('republish_exit')}"
                )
            if str(ref.get("inspect_exit")) != i_exit:
                errors.append(
                    f"line {lineno}: inspect_exit mismatch tsv={i_exit} json={ref.get('inspect_exit')}"
                )
            if str(ref.get("status")) != status:
                errors.append(
                    f"line {lineno}: status mismatch tsv={status} json={ref.get('status')}"
                )
    return errors


# ---------- CLI -----------------------------------------------------------


def _classify_cmd(args: argparse.Namespace) -> int:
    """Write the per-product sidecar JSON. We deliberately do NOT
    append to `summary.tsv` here — that file is regenerated
    authoritatively by `finalize` from sidecars, eliminating the
    bash↔python TSV-write boundary that produced shifted columns in
    earlier runs.

    A best-effort `progress.tsv` (one line per product) is appended
    so operators can `tail -F` during a long batch. progress.tsv is
    NOT validated; the authoritative file is summary.tsv.
    """
    batch_dir = Path(args.batch_dir)
    products_dir = batch_dir / "products"
    products_dir.mkdir(parents=True, exist_ok=True)

    outcome = classify_product_outcome(
        rank=args.rank,
        profile=args.profile,
        goodsNo=args.goodsNo,
        slug=args.slug,
        run_dir=args.run_dir,
        pipeline_exit=int(args.pipeline_exit),
        republish_exit=int(args.republish_exit),
        inspect_exit=int(args.inspect_exit),
        log_path=args.log_path,
        preflight_ok=not args.preflight_failed,
        skipped=args.skipped,
    )

    sidecar = products_dir / f"{outcome.rank}_{outcome.goodsNo}.json"
    sidecar.write_text(
        json.dumps(asdict(outcome), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    progress = batch_dir / "progress.tsv"
    if not progress.is_file():
        progress.write_text(TSV_HEADER + "\n", encoding="utf-8")
    with progress.open("a", encoding="utf-8") as fh:
        fh.write(outcome.to_tsv_row() + "\n")

    print(json.dumps({"status": outcome.status,
                       "auth_indicator": outcome.auth_indicator,
                       "review_count_analyzed": outcome.review_count_analyzed},
                      ensure_ascii=False))
    return 0


def _finalize_cmd(args: argparse.Namespace) -> int:
    """Authoritative end-of-batch step.

    1. Read every sidecar in `products/`.
    2. Aggregate to `summary.json`.
    3. Regenerate `summary.tsv` from sidecars (atomic write).
    4. Write `failed_products.csv`.
    5. Validate every row of summary.tsv has 9 tab-separated fields
       AND that every TSV row's exit codes / status match summary.json.
    6. Exit nonzero if validation fails.

    Step 5 is the defense-in-depth check the user asked for: it
    catches both invariant violations (field count) and semantic
    drift (TSV ↔ JSON disagreement).
    """
    batch_dir = Path(args.batch_dir)
    products_dir = batch_dir / "products"
    if not products_dir.is_dir():
        print(f"no products/ dir under {batch_dir}", file=sys.stderr)
        return 2

    outcomes = _read_outcome_sidecars(products_dir)

    summary = aggregate_summary_json(
        outcomes,
        batch_id=args.batch_id or batch_dir.name,
        requested_max_reviews_per_sort=args.requested_max_reviews_per_sort,
    )
    summary_json_path = batch_dir / "summary.json"
    summary_json_path.write_text(
        json.dumps(summary, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    summary_tsv_path = regenerate_summary_tsv_from_sidecars(batch_dir)

    failed_rows = extract_failed_products_csv_rows(outcomes)
    failed_csv_path = write_failed_products_csv(
        failed_rows, batch_dir / "failed_products.csv"
    )

    tsv_errors = validate_summary_tsv(summary_tsv_path)
    consistency_errors = validate_tsv_json_consistency(
        summary_tsv_path, summary_json_path
    )
    all_errors = tsv_errors + consistency_errors

    payload = {
        "summary_json": str(summary_json_path),
        "summary_tsv": str(summary_tsv_path),
        "failed_products_csv": str(failed_csv_path),
        "failed_count": len(failed_rows),
        "counts": summary["counts"],
        "validation_errors": all_errors,
    }
    print(json.dumps(payload, ensure_ascii=False))

    if all_errors:
        for err in all_errors:
            print(f"VALIDATION_ERROR: {err}", file=sys.stderr)
        return 3
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n", 1)[0])
    sub = p.add_subparsers(dest="cmd", required=True)

    cl = sub.add_parser("classify", help="Classify one product's outcome.")
    cl.add_argument("--batch-dir", required=True)
    cl.add_argument("--rank", required=True)
    cl.add_argument("--profile", required=True)
    cl.add_argument("--goodsNo", required=True)
    cl.add_argument("--slug", required=True)
    cl.add_argument("--run-dir", required=True)
    cl.add_argument("--pipeline-exit", required=True)
    cl.add_argument("--republish-exit", default=str(EXIT_NOT_RUN))
    cl.add_argument("--inspect-exit", default=str(EXIT_NOT_RUN))
    cl.add_argument("--log-path", default=None)
    cl.add_argument("--preflight-failed", action="store_true")
    cl.add_argument("--skipped", action="store_true")
    cl.set_defaults(func=_classify_cmd)

    fi = sub.add_parser("finalize", help="Write summary.json + failed_products.csv.")
    fi.add_argument("--batch-dir", required=True)
    fi.add_argument("--batch-id", default=None)
    fi.add_argument(
        "--requested-max-reviews-per-sort", type=int, default=None,
    )
    fi.set_defaults(func=_finalize_cmd)

    args = p.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())


__all__ = [
    "STATUS_PUBLISHABLE",
    "STATUS_FINAL_SAMPLE_READY",
    "STATUS_COMPLETED_WITH_WARNINGS",
    "STATUS_INSUFFICIENT_CORPUS",
    "STATUS_PIPELINE_FAILED",
    "STATUS_AUTH_REQUIRED",
    "STATUS_ANTI_BOT_PAUSE_REQUIRED",
    "STATUS_PREFLIGHT_FAILED",
    "STATUS_SKIPPED",
    "AUTH_BUCKET_STATUSES",
    "RESUMABLE_STATUSES",
    "EXIT_NOT_RUN",
    "INSUFFICIENT_CORPUS_FLOOR",
    "FINAL_SAMPLE_READY_FLOOR",
    "TSV_HEADER",
    "ProductOutcome",
    "is_auth_failure_log",
    "classify_product_outcome",
    "parse_batch_input_csv",
    "aggregate_summary_json",
    "extract_failed_products_csv_rows",
    "write_failed_products_csv",
    "regenerate_summary_tsv_from_sidecars",
    "validate_summary_tsv",
    "validate_tsv_json_consistency",
    "main",
]
